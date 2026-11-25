import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { extractKhoTuStats } from '../../src/utils/khoTuNgu.ts';
import { getAppAiQuotaSnapshot, getSessionAutoFallbackCount } from '../aiQuota.ts';
import {
  generateJoinCode,
  generatePin4,
  isValidPin4,
  isValidUuid,
  parseBulkNicknames,
  requireAuth,
  requireRole,
} from '../auth.ts';
import { formatDatabaseError, getSql, isDatabaseConfigured } from '../db.ts';
import { buildTeacherExcelWorkbook, type ExportSubmissionRow } from '../excel.ts';
import {
  getAppEnvMode,
  getCspHeaderForEnv,
  getLtiConfig,
  getLtiSecretStatus,
} from '../ltiConfig.ts';
import { buildAgsScorePayload, sumTeacherRubricScore } from '../ltiServices.ts';
import { OUTBOX_MAX_ATTEMPTS, enqueueOutboxEvent, retryAllPendingOutbox } from '../outbox.ts';
import { MAX_PROMPT_TEXT_LENGTH, isValidTeacherLevel } from '../validation.ts';
import { getAppBaseUrl } from './ltiRoutes.ts';

async function verifyTeacherOwnsClass(teacherId: string, classId: string) {
  const sql = getSql();
  const rows = await sql<
    Array<{
      id: string;
      teacher_id: string;
      name: string;
      join_code: string;
      ai_enabled: boolean;
      ai_daily_limit: number;
    }>
  >`
    SELECT id, teacher_id, name, join_code, ai_enabled, ai_daily_limit
    FROM banviet.classes
    WHERE id = ${classId}
    LIMIT 1
  `;
  if (rows.length === 0) return { ok: false as const, status: 404, error: 'Không tìm thấy lớp học.' };
  if (rows[0].teacher_id !== teacherId) {
    return { ok: false as const, status: 403, error: 'Bạn không có quyền truy cập lớp học này.' };
  }
  return { ok: true as const, cls: rows[0] };
}

export function createTeacherRouter(): Router {
  const router = Router();
  router.use('/api/teacher', requireAuth, requireRole('teacher'));

  // Teacher profile + list of their classes
  router.get('/api/teacher/me', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    try {
      const sql = getSql();
      const teachers = await sql<
        Array<{ id: string; email: string | null; display_name: string | null }>
      >`
        SELECT id, email, display_name
        FROM banviet.teachers
        WHERE id = ${teacherId}
        LIMIT 1
      `;
      if (teachers.length === 0) {
        res.status(401).json({ error: 'Tài khoản giáo viên không tồn tại.' });
        return;
      }

      const classes = await sql<
        Array<{
          id: string;
          name: string;
          join_code: string;
          ai_enabled: boolean;
          ai_daily_limit: number;
          created_at: Date | string;
          student_count: number;
          assignment_count: number;
          flagged_count: number;
        }>
      >`
        SELECT
          c.id,
          c.name,
          c.join_code,
          c.ai_enabled,
          c.ai_daily_limit,
          c.created_at,
          (SELECT COUNT(*)::int FROM banviet.students s WHERE s.class_id = c.id) AS student_count,
          (SELECT COUNT(*)::int FROM banviet.assignments a WHERE a.class_id = c.id) AS assignment_count,
          (
            SELECT COUNT(*)::int
            FROM banviet.ai_events e
            JOIN banviet.students s2 ON s2.id = e.student_id
            WHERE s2.class_id = c.id AND e.flagged = TRUE
          ) AS flagged_count
        FROM banviet.classes c
        WHERE c.teacher_id = ${teacherId}
        ORDER BY c.created_at DESC
      `;

      res.json({
        teacher: teachers[0],
        classes,
      });
    } catch (err) {
      console.error('[GET /api/teacher/me error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Create class with unique 6-char A-Z0-9 join_code
  router.post('/api/teacher/classes', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập tên lớp (ví dụ: Lớp 5A).' });
      return;
    }

    const aiEnabled = req.body?.ai_enabled !== false;
    const rawLimit = Number(req.body?.ai_daily_limit ?? 5);
    const aiDailyLimit = Number.isFinite(rawLimit)
      ? Math.max(0, Math.min(100, Math.floor(rawLimit)))
      : 5;

    try {
      const sql = getSql();
      // Retry up to 5 times in the rare event of a join_code collision
      for (let attempt = 0; attempt < 5; attempt++) {
        const joinCode = generateJoinCode();
        try {
          const rows = await sql<Array<Record<string, unknown>>>`
            INSERT INTO banviet.classes (teacher_id, name, join_code, ai_enabled, ai_daily_limit)
            VALUES (${teacherId}, ${name}, ${joinCode}, ${aiEnabled}, ${aiDailyLimit})
            RETURNING id, teacher_id, name, join_code, ai_enabled, ai_daily_limit, created_at
          `;
          res.status(201).json({ class: rows[0] });
          return;
        } catch (insertErr) {
          const pgErr = insertErr as { code?: string };
          if (pgErr?.code === '23505' && attempt < 4) continue;
          throw insertErr;
        }
      }
      res.status(500).json({ error: 'Không tạo được mã lớp duy nhất. Vui lòng thử lại.' });
    } catch (err) {
      console.error('[POST /api/teacher/classes error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Update class settings (name, ai_enabled, ai_daily_limit 0-100)
  router.patch('/api/teacher/classes/:classId', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { classId } = req.params;
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: 'Mã lớp không hợp lệ.' });
      return;
    }

    try {
      const check = await verifyTeacherOwnsClass(teacherId, classId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const nextName =
        typeof req.body?.name === 'string' && req.body.name.trim()
          ? req.body.name.trim().slice(0, 80)
          : check.cls.name;
      const nextAiEnabled =
        typeof req.body?.ai_enabled === 'boolean' ? req.body.ai_enabled : check.cls.ai_enabled;
      const rawLimit =
        req.body?.ai_daily_limit !== undefined
          ? Number(req.body.ai_daily_limit)
          : check.cls.ai_daily_limit;
      if (!Number.isFinite(rawLimit) || rawLimit < 0 || rawLimit > 100) {
        res.status(400).json({ error: 'Giới hạn lượt AI mỗi ngày phải từ 0 đến 100.' });
        return;
      }
      const nextLimit = Math.floor(rawLimit);

      const sql = getSql();
      const updated = await sql<Array<Record<string, unknown>>>`
        UPDATE banviet.classes
        SET name = ${nextName}, ai_enabled = ${nextAiEnabled}, ai_daily_limit = ${nextLimit}
        WHERE id = ${classId} AND teacher_id = ${teacherId}
        RETURNING id, name, join_code, ai_enabled, ai_daily_limit, created_at
      `;
      res.json({ class: updated[0] });
    } catch (err) {
      console.error('[PATCH class error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // List students in a class (never returns pin_hash)
  router.get('/api/teacher/classes/:classId/students', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { classId } = req.params;
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: 'Mã lớp không hợp lệ.' });
      return;
    }

    try {
      const check = await verifyTeacherOwnsClass(teacherId, classId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const sql = getSql();
      const students = await sql<Array<Record<string, unknown>>>`
        SELECT id, class_id, nickname, failed_pin, locked_until, created_at
        FROM banviet.students
        WHERE class_id = ${classId}
        ORDER BY nickname ASC
      `;
      res.json({ class: check.cls, students });
    } catch (err) {
      console.error('[GET students error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Bulk add nicknames (paste multiple lines) and generate bcrypt-hashed 4-digit PINs
  router.post(
    '/api/teacher/classes/:classId/students/bulk',
    async (req: Request, res: Response) => {
      const teacherId = req.auth!.sub;
      const { classId } = req.params;
      if (!isValidUuid(classId)) {
        res.status(400).json({ error: 'Mã lớp không hợp lệ.' });
        return;
      }

      const rawText = typeof req.body?.nicknamesText === 'string' ? req.body.nicknamesText : '';
      const nicknames = parseBulkNicknames(rawText);
      if (nicknames.length === 0) {
        res.status(400).json({
          error: 'Vui lòng nhập ít nhất 1 biệt danh (mỗi dòng 1 em, tối đa 40 ký tự).',
        });
        return;
      }

      const sharedPin =
        typeof req.body?.fixedPin === 'string' && req.body.fixedPin.trim()
          ? req.body.fixedPin.trim()
          : null;
      if (sharedPin && !isValidPin4(sharedPin)) {
        res.status(400).json({ error: 'Mã PIN cố định phải gồm đúng 4 chữ số.' });
        return;
      }

      try {
        const check = await verifyTeacherOwnsClass(teacherId, classId);
        if (!check.ok) {
          res.status(check.status).json({ error: check.error });
          return;
        }

        const sql = getSql();
        const created: Array<{ id: string; nickname: string; pin: string }> = [];
        const skipped: string[] = [];

        for (const nickname of nicknames) {
          const pin = sharedPin ?? generatePin4();
          const pinHash = await bcrypt.hash(pin, 10);
          try {
            const rows = await sql<Array<{ id: string; nickname: string }>>`
              INSERT INTO banviet.students (class_id, nickname, pin_hash)
              VALUES (${classId}, ${nickname}, ${pinHash})
              RETURNING id, nickname
            `;
            created.push({ id: rows[0].id, nickname: rows[0].nickname, pin });
          } catch (insErr) {
            const pgErr = insErr as { code?: string };
            if (pgErr?.code === '23505') {
              skipped.push(nickname);
            } else {
              throw insErr;
            }
          }
        }

        res.status(201).json({
          created,
          skipped,
          joinCode: check.cls.join_code,
          className: check.cls.name,
        });
      } catch (err) {
        console.error('[POST bulk students error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // Set or reset a student's 4-digit PIN (and clear lockout)
  router.post(
    '/api/teacher/students/:studentId/reset-pin',
    async (req: Request, res: Response) => {
      const teacherId = req.auth!.sub;
      const { studentId } = req.params;
      if (!isValidUuid(studentId)) {
        res.status(400).json({ error: 'Mã học sinh không hợp lệ.' });
        return;
      }

      const customPin =
        typeof req.body?.pin === 'string' && req.body.pin.trim() ? req.body.pin.trim() : null;
      if (customPin && !isValidPin4(customPin)) {
        res.status(400).json({ error: 'Mã PIN phải gồm đúng 4 chữ số.' });
        return;
      }

      try {
        const sql = getSql();
        const rows = await sql<
          Array<{
            id: string;
            nickname: string;
            teacher_id: string;
            class_name: string;
            join_code: string;
          }>
        >`
          SELECT s.id, s.nickname, c.teacher_id, c.name AS class_name, c.join_code
          FROM banviet.students s
          JOIN banviet.classes c ON c.id = s.class_id
          WHERE s.id = ${studentId}
          LIMIT 1
        `;

        if (rows.length === 0) {
          res.status(404).json({ error: 'Không tìm thấy học sinh.' });
          return;
        }
        if (rows[0].teacher_id !== teacherId) {
          res.status(403).json({ error: 'Bạn không có quyền đặt lại PIN cho học sinh lớp khác.' });
          return;
        }

        const newPin = customPin ?? generatePin4();
        const pinHash = await bcrypt.hash(newPin, 10);

        await sql`
          UPDATE banviet.students
          SET pin_hash = ${pinHash}, failed_pin = 0, locked_until = NULL
          WHERE id = ${studentId}
        `;

        res.json({
          studentId,
          nickname: rows[0].nickname,
          className: rows[0].class_name,
          joinCode: rows[0].join_code,
          pin: newPin,
        });
      } catch (err) {
        console.error('[POST reset-pin error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // List assignments in a class
  router.get('/api/teacher/classes/:classId/assignments', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { classId } = req.params;
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: 'Mã lớp không hợp lệ.' });
      return;
    }

    try {
      const check = await verifyTeacherOwnsClass(teacherId, classId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const sql = getSql();
      const assignments = await sql<Array<Record<string, unknown>>>`
        SELECT
          a.id,
          a.class_id,
          a.title,
          a.prompt_text,
          a.opens_at,
          a.closes_at,
          a.created_at,
          (SELECT COUNT(*)::int FROM banviet.submissions sub WHERE sub.assignment_id = a.id) AS started_count,
          (SELECT COUNT(*)::int FROM banviet.submissions sub WHERE sub.assignment_id = a.id AND sub.submitted_at IS NOT NULL) AS submitted_count
        FROM banviet.assignments a
        WHERE a.class_id = ${classId}
        ORDER BY a.created_at DESC
      `;

      res.json({ assignments });
    } catch (err) {
      console.error('[GET assignments error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Create assignment
  router.post('/api/teacher/classes/:classId/assignments', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { classId } = req.params;
    if (!isValidUuid(classId)) {
      res.status(400).json({ error: 'Mã lớp không hợp lệ.' });
      return;
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
    const promptText =
      typeof req.body?.prompt_text === 'string' ? req.body.prompt_text.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Vui lòng nhập tiêu đề bài viết.' });
      return;
    }
    if (promptText.length > MAX_PROMPT_TEXT_LENGTH) {
      res.status(400).json({
        error: `Đề bài tối đa ${MAX_PROMPT_TEXT_LENGTH} ký tự.`,
      });
      return;
    }

    const opensAt = req.body?.opens_at ? new Date(String(req.body.opens_at)) : null;
    const closesAt = req.body?.closes_at ? new Date(String(req.body.closes_at)) : null;
    if (opensAt && Number.isNaN(opensAt.getTime())) {
      res.status(400).json({ error: 'Thời gian mở không hợp lệ.' });
      return;
    }
    if (closesAt && Number.isNaN(closesAt.getTime())) {
      res.status(400).json({ error: 'Thời gian đóng không hợp lệ.' });
      return;
    }

    try {
      const check = await verifyTeacherOwnsClass(teacherId, classId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const sql = getSql();
      const rows = await sql<Array<Record<string, unknown>>>`
        INSERT INTO banviet.assignments (class_id, title, prompt_text, opens_at, closes_at)
        VALUES (${classId}, ${title}, ${promptText || null}, ${opensAt}, ${closesAt})
        RETURNING id, class_id, title, prompt_text, opens_at, closes_at, created_at
      `;
      res.status(201).json({ assignment: rows[0] });
    } catch (err) {
      console.error('[POST assignment error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Assignment tracking table: 1 row per student, step columns, metrics, flagged AI alerts
  router.get('/api/teacher/assignments/:assignmentId/tracker', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { assignmentId } = req.params;
    if (!isValidUuid(assignmentId)) {
      res.status(400).json({ error: 'Mã bài tập không hợp lệ.' });
      return;
    }

    try {
      const sql = getSql();
      const assignments = await sql<
        Array<{
          id: string;
          class_id: string;
          title: string;
          prompt_text: string | null;
          opens_at: Date | string | null;
          closes_at: Date | string | null;
          teacher_id: string;
        }>
      >`
        SELECT a.id, a.class_id, a.title, a.prompt_text, a.opens_at, a.closes_at, c.teacher_id
        FROM banviet.assignments a
        JOIN banviet.classes c ON c.id = a.class_id
        WHERE a.id = ${assignmentId}
        LIMIT 1
      `;

      if (assignments.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy bài tập.' });
        return;
      }
      if (assignments[0].teacher_id !== teacherId) {
        res.status(403).json({ error: 'Bạn không có quyền xem bài tập của lớp khác.' });
        return;
      }

      const assignment = assignments[0];
      const rows = await sql<Array<Record<string, unknown>>>`
        SELECT
          s.id AS student_id,
          s.nickname,
          sub.id AS submission_id,
          COALESCE(sub.current_step, 0) AS current_step,
          sub.draft_locked_at,
          sub.submitted_at,
          sub.teacher_level,
          sub.updated_at,
          COALESCE(m.outline_details, 0) AS outline_details,
          COALESCE(m.draft_words, 0) AS draft_words,
          COALESCE(m.revised_words, 0) AS revised_words,
          COALESCE(m.edits_count, 0) AS edits_count,
          COALESCE(m.ai_calls, 0) AS ai_calls,
          COALESCE(m.feedback_rounds, 0) AS feedback_rounds,
          COALESCE((sub.outline_check->'kho_tu'->>'goi_y_tu_kho')::int, 0) AS kho_suggestions_count,
          COALESCE((sub.outline_check->'kho_tu'->>'mo_kho')::int, 0) AS kho_mo_kho,
          COALESCE((sub.outline_check->'kho_tu'->>'tu_da_luu')::int, 0) AS kho_tu_da_luu,
          (
            SELECT COUNT(*)::int
            FROM banviet.ai_events e
            WHERE e.submission_id = sub.id AND e.flagged = TRUE
          ) AS flagged_count
        FROM banviet.students s
        LEFT JOIN banviet.submissions sub
          ON sub.student_id = s.id AND sub.assignment_id = ${assignmentId}
        LEFT JOIN banviet.metrics m
          ON m.submission_id = sub.id
        WHERE s.class_id = ${assignment.class_id}
        ORDER BY s.nickname ASC
      `;

      res.json({ assignment, rows });
    } catch (err) {
      console.error('[GET tracker error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // View full student submission detail (observations, outline, draft, revised, AI events, rubric)
  router.get('/api/teacher/submissions/:submissionId', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const { submissionId } = req.params;
    if (!isValidUuid(submissionId)) {
      res.status(400).json({ error: 'Mã bài làm không hợp lệ.' });
      return;
    }

    try {
      const sql = getSql();
      const rows = await sql<Array<Record<string, unknown>>>`
        SELECT
          sub.*,
          s.nickname,
          a.title AS assignment_title,
          a.prompt_text AS assignment_prompt,
          c.teacher_id,
          c.name AS class_name
        FROM banviet.submissions sub
        JOIN banviet.students s ON s.id = sub.student_id
        JOIN banviet.assignments a ON a.id = sub.assignment_id
        JOIN banviet.classes c ON c.id = a.class_id
        WHERE sub.id = ${submissionId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy bài làm.' });
        return;
      }
      if (rows[0].teacher_id !== teacherId) {
        res.status(403).json({ error: 'Bạn không có quyền xem bài làm của lớp khác.' });
        return;
      }

      const aiEvents = await sql<Array<Record<string, unknown>>>`
        SELECT id, step, endpoint, request_text, response_json, flagged, created_at
        FROM banviet.ai_events
        WHERE submission_id = ${submissionId}
        ORDER BY created_at ASC
      `;

      const metricsRows = await sql<Array<Record<string, unknown>>>`
        SELECT outline_details, draft_words, revised_words, edits_count, ai_calls, feedback_rounds, minutes_spent, updated_at
        FROM banviet.metrics
        WHERE submission_id = ${submissionId}
        LIMIT 1
      `;

      res.json({
        submission: rows[0],
        aiEvents,
        metrics: metricsRows[0] ?? null,
        khoTuStats: extractKhoTuStats(rows[0].outline_check),
      });
    } catch (err) {
      console.error('[GET teacher submission detail error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Grade submission: 5-criteria x 3-level teacher_rubric, teacher_level ('HTT'|'HT'|'CHT'), teacher_comment
  router.patch(
    '/api/teacher/submissions/:submissionId/grade',
    async (req: Request, res: Response) => {
      const teacherId = req.auth!.sub;
      const { submissionId } = req.params;
      if (!isValidUuid(submissionId)) {
        res.status(400).json({ error: 'Mã bài làm không hợp lệ.' });
        return;
      }

      const teacherLevel = req.body?.teacher_level ?? null;
      if (teacherLevel !== null && !isValidTeacherLevel(teacherLevel)) {
        res.status(400).json({ error: 'Mức xếp loại phải là HTT, HT hoặc CHT.' });
        return;
      }

      const teacherRubric =
        req.body?.teacher_rubric && typeof req.body.teacher_rubric === 'object'
          ? req.body.teacher_rubric
          : null;
      const teacherComment =
        typeof req.body?.teacher_comment === 'string'
          ? req.body.teacher_comment.trim().slice(0, 1500)
          : '';

      try {
        const sql = getSql();
        const ownership = await sql<
          Array<{
            teacher_id: string;
            openedu_user_id: string | null;
            openedu_lineitem_url: string | null;
          }>
        >`
          SELECT
            c.teacher_id,
            s.openedu_user_id,
            a.openedu_lineitem_url
          FROM banviet.submissions sub
          JOIN banviet.students s ON s.id = sub.student_id
          JOIN banviet.assignments a ON a.id = sub.assignment_id
          JOIN banviet.classes c ON c.id = a.class_id
          WHERE sub.id = ${submissionId}
          LIMIT 1
        `;

        if (ownership.length === 0) {
          res.status(404).json({ error: 'Không tìm thấy bài làm.' });
          return;
        }
        if (ownership[0].teacher_id !== teacherId) {
          res.status(403).json({ error: 'Bạn không có quyền chấm bài của lớp khác.' });
          return;
        }

        const updated = await sql<Array<Record<string, unknown>>>`
          UPDATE banviet.submissions
          SET
            teacher_rubric = ${teacherRubric ? sql.json(teacherRubric as never) : null},
            teacher_level = ${teacherLevel},
            teacher_comment = ${teacherComment || null},
            updated_at = NOW()
          WHERE id = ${submissionId}
          RETURNING id, teacher_rubric, teacher_level, teacher_comment, updated_at
        `;

        // If this student & assignment came from OPEN-EDU LTI with an AGS lineitem, enqueue score
        const studentOpenEduSub = ownership[0].openedu_user_id;
        const lineitemUrl = ownership[0].openedu_lineitem_url;
        let agsQueued = false;
        if (studentOpenEduSub && lineitemUrl && teacherRubric) {
          const scoreGiven = sumTeacherRubricScore(teacherRubric as Record<string, unknown>);
          const agsPayload = buildAgsScorePayload({
            lineitemUrl,
            openEduSub: studentOpenEduSub,
            scoreGiven,
          });
          await enqueueOutboxEvent('ags_score', agsPayload).catch((e) =>
            console.error('[AGS outbox enqueue error]', e)
          );
          agsQueued = true;
        }

        res.json({ submission: updated[0], agsQueued });
      } catch (err) {
        console.error('[PATCH grade error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // ONLY allowed UPDATE on banviet.ai_events: toggle flagged column
  router.patch('/api/teacher/ai-events/:eventId/flag', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      res.status(400).json({ error: 'Mã sự kiện AI không hợp lệ.' });
      return;
    }
    const flagged = Boolean(req.body?.flagged);

    try {
      const sql = getSql();
      const ownership = await sql<Array<{ teacher_id: string }>>`
        SELECT c.teacher_id
        FROM banviet.ai_events e
        JOIN banviet.students s ON s.id = e.student_id
        JOIN banviet.classes c ON c.id = s.class_id
        WHERE e.id = ${eventId}
        LIMIT 1
      `;
      if (ownership.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy sự kiện AI.' });
        return;
      }
      if (ownership[0].teacher_id !== teacherId) {
        res.status(403).json({ error: 'Bạn không có quyền cập nhật sự kiện của lớp khác.' });
        return;
      }

      const updated = await sql<Array<{ id: string; flagged: boolean }>>`
        UPDATE banviet.ai_events
        SET flagged = ${flagged}
        WHERE id = ${eventId}
        RETURNING id, flagged
      `;
      res.json({ event: updated[0] });
    } catch (err) {
      console.error('[PATCH ai_events flag error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Export Excel (.xlsx) by assignment or class + optional "So sánh" sheet (2 assignments)
  router.get('/api/teacher/export/xlsx', async (req: Request, res: Response) => {
    const teacherId = req.auth!.sub;
    const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
    const assignmentId =
      typeof req.query.assignmentId === 'string' && req.query.assignmentId
        ? req.query.assignmentId
        : null;
    const compareA =
      typeof req.query.compareA === 'string' && req.query.compareA ? req.query.compareA : null;
    const compareB =
      typeof req.query.compareB === 'string' && req.query.compareB ? req.query.compareB : null;

    if (!isValidUuid(classId)) {
      res.status(400).json({ error: 'Thiếu mã lớp hợp lệ để xuất Excel.' });
      return;
    }
    if (assignmentId && !isValidUuid(assignmentId)) {
      res.status(400).json({ error: 'Mã bài tập không hợp lệ.' });
      return;
    }
    if ((compareA && !isValidUuid(compareA)) || (compareB && !isValidUuid(compareB))) {
      res.status(400).json({ error: 'Mã bài so sánh không hợp lệ.' });
      return;
    }

    try {
      const check = await verifyTeacherOwnsClass(teacherId, classId);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }

      const sql = getSql();
      let assignmentTitle: string | undefined;

      if (assignmentId) {
        const aRows = await sql<Array<{ title: string }>>`
          SELECT title FROM banviet.assignments
          WHERE id = ${assignmentId} AND class_id = ${classId}
          LIMIT 1
        `;
        if (aRows.length === 0) {
          res.status(404).json({ error: 'Bài tập không thuộc lớp này.' });
          return;
        }
        assignmentTitle = aRows[0].title;
      }

      const rawRows = assignmentId
        ? await sql<ExportSubmissionRow[]>`
            SELECT
              s.id AS student_id,
              s.nickname,
              a.id AS assignment_id,
              a.title AS assignment_title,
              COALESCE(sub.current_step, 0) AS current_step,
              COALESCE(m.outline_details, 0) AS outline_details,
              COALESCE(m.draft_words, 0) AS draft_words,
              COALESCE(m.revised_words, 0) AS revised_words,
              COALESCE(m.edits_count, 0) AS edits_count,
              COALESCE(m.ai_calls, 0) AS ai_calls,
              COALESCE((sub.outline_check->'kho_tu'->>'goi_y_tu_kho')::int, 0) AS kho_suggestions,
              COALESCE(m.feedback_rounds, 0) AS feedback_rounds,
              COALESCE(m.minutes_spent, 0) AS minutes_spent,
              sub.self_rubric,
              sub.teacher_rubric,
              sub.teacher_level,
              sub.teacher_comment,
              sub.submitted_at
            FROM banviet.students s
            CROSS JOIN banviet.assignments a
            LEFT JOIN banviet.submissions sub
              ON sub.student_id = s.id AND sub.assignment_id = a.id
            LEFT JOIN banviet.metrics m
              ON m.submission_id = sub.id
            WHERE s.class_id = ${classId} AND a.id = ${assignmentId}
            ORDER BY s.nickname ASC
          `
        : await sql<ExportSubmissionRow[]>`
            SELECT
              s.id AS student_id,
              s.nickname,
              a.id AS assignment_id,
              a.title AS assignment_title,
              COALESCE(sub.current_step, 0) AS current_step,
              COALESCE(m.outline_details, 0) AS outline_details,
              COALESCE(m.draft_words, 0) AS draft_words,
              COALESCE(m.revised_words, 0) AS revised_words,
              COALESCE(m.edits_count, 0) AS edits_count,
              COALESCE(m.ai_calls, 0) AS ai_calls,
              COALESCE((sub.outline_check->'kho_tu'->>'goi_y_tu_kho')::int, 0) AS kho_suggestions,
              COALESCE(m.feedback_rounds, 0) AS feedback_rounds,
              COALESCE(m.minutes_spent, 0) AS minutes_spent,
              sub.self_rubric,
              sub.teacher_rubric,
              sub.teacher_level,
              sub.teacher_comment,
              sub.submitted_at
            FROM banviet.students s
            JOIN banviet.assignments a ON a.class_id = s.class_id
            LEFT JOIN banviet.submissions sub
              ON sub.student_id = s.id AND sub.assignment_id = a.id
            LEFT JOIN banviet.metrics m
              ON m.submission_id = sub.id
            WHERE s.class_id = ${classId}
            ORDER BY a.created_at ASC, s.nickname ASC
          `;

      let compareConfig:
        | {
            assignmentATitle: string;
            assignmentBTitle: string;
            students: Array<{
              nickname: string;
              a?: ExportSubmissionRow;
              b?: ExportSubmissionRow;
            }>;
          }
        | undefined;

      if (compareA && compareB) {
        const cmpAssigns = await sql<Array<{ id: string; title: string }>>`
          SELECT id, title
          FROM banviet.assignments
          WHERE class_id = ${classId} AND id IN (${compareA}, ${compareB})
        `;
        const aMeta = cmpAssigns.find((x) => x.id === compareA);
        const bMeta = cmpAssigns.find((x) => x.id === compareB);
        if (aMeta && bMeta) {
          const students = await sql<Array<{ id: string; nickname: string }>>`
            SELECT id, nickname
            FROM banviet.students
            WHERE class_id = ${classId}
            ORDER BY nickname ASC
          `;
          const cmpSubs = await sql<ExportSubmissionRow[]>`
            SELECT
              s.id AS student_id,
              s.nickname,
              a.id AS assignment_id,
              a.title AS assignment_title,
              COALESCE(sub.current_step, 0) AS current_step,
              COALESCE(m.outline_details, 0) AS outline_details,
              COALESCE(m.draft_words, 0) AS draft_words,
              COALESCE(m.revised_words, 0) AS revised_words,
              COALESCE(m.edits_count, 0) AS edits_count,
              COALESCE(m.ai_calls, 0) AS ai_calls,
              COALESCE((sub.outline_check->'kho_tu'->>'goi_y_tu_kho')::int, 0) AS kho_suggestions,
              COALESCE(m.feedback_rounds, 0) AS feedback_rounds,
              COALESCE(m.minutes_spent, 0) AS minutes_spent,
              sub.self_rubric,
              sub.teacher_rubric,
              sub.teacher_level,
              sub.teacher_comment,
              sub.submitted_at
            FROM banviet.students s
            JOIN banviet.assignments a ON a.class_id = s.class_id
            LEFT JOIN banviet.submissions sub
              ON sub.student_id = s.id AND sub.assignment_id = a.id
            LEFT JOIN banviet.metrics m
              ON m.submission_id = sub.id
            WHERE s.class_id = ${classId} AND a.id IN (${compareA}, ${compareB})
          `;

          compareConfig = {
            assignmentATitle: aMeta.title,
            assignmentBTitle: bMeta.title,
            students: students.map((st) => ({
              nickname: st.nickname,
              a: cmpSubs.find((r) => r.student_id === st.id && r.assignment_id === compareA),
              b: cmpSubs.find((r) => r.student_id === st.id && r.assignment_id === compareB),
            })),
          };
        }
      }

      const buffer = await buildTeacherExcelWorkbook({
        className: check.cls.name,
        assignmentTitle,
        rows: rawRows,
        compare: compareConfig,
      });

      const safeFilename = `ban-viet-${check.cls.join_code.toLowerCase()}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.send(buffer);
    } catch (err) {
      console.error('[GET export xlsx error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // LTI 1.3 Connection page status (copyable URLs, boolean secret readiness only, outbox counts & last error)
  router.get('/api/teacher/lti/status', async (req: Request, res: Response) => {
    const cfg = getLtiConfig();
    const secrets = getLtiSecretStatus();
    const baseUrl = getAppBaseUrl(req);

    let outbox = {
      pendingCount: 0,
      failedCount: 0,
      sentCount: 0,
      lastError: null as string | null,
      lastErrorKind: null as string | null,
      lastErrorAt: null as string | null,
    };

    let dbAutoFallbackCount = 0;

    if (isDatabaseConfigured()) {
      try {
        const sql = getSql();
        const counts = await sql<
          Array<{ pending_count: number; failed_count: number; sent_count: number }>
        >`
          SELECT
            COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts < ${OUTBOX_MAX_ATTEMPTS})::int AS pending_count,
            COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts >= ${OUTBOX_MAX_ATTEMPTS})::int AS failed_count,
            COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent_count
          FROM banviet.outbox
        `;
        const errRows = await sql<
          Array<{ kind: string; last_error: string | null; next_at: Date | string | null }>
        >`
          SELECT kind, last_error, next_at
          FROM banviet.outbox
          WHERE sent_at IS NULL AND last_error IS NOT NULL
          ORDER BY id DESC
          LIMIT 1
        `;
        outbox = {
          pendingCount: Number(counts[0]?.pending_count ?? 0),
          failedCount: Number(counts[0]?.failed_count ?? 0),
          sentCount: Number(counts[0]?.sent_count ?? 0),
          lastError: errRows[0]?.last_error ?? null,
          lastErrorKind: errRows[0]?.kind ?? null,
          lastErrorAt: errRows[0]?.next_at ? String(errRows[0].next_at) : null,
        };

        const fbRows = await sql<Array<{ total_fallback: number }>>`
          SELECT COALESCE(SUM((outline_check->'kho_tu'->>'auto_fallback')::int), 0)::int AS total_fallback
          FROM banviet.submissions
          WHERE outline_check ? 'kho_tu'
        `;
        dbAutoFallbackCount = Number(fbRows[0]?.total_fallback ?? 0);
      } catch (err) {
        console.error('[GET /api/teacher/lti/status outbox query error]', err);
        const formatted = formatDatabaseError(err);
        outbox.lastError = formatted.message;
      }
    }

    const appQuota = await getAppAiQuotaSnapshot();

    res.json({
      appEnv: getAppEnvMode(),
      frameAncestorsHeader: getCspHeaderForEnv(),
      endpoints: {
        loginUrl: `${baseUrl}/lti/login`,
        launchUrl: `${baseUrl}/lti/launch`,
        jwksUrl: `${baseUrl}/.well-known/jwks.json`,
        jwksAliasUrl: `${baseUrl}/lti/jwks`,
        issuer: cfg.issuer,
        authorizationEndpoint: cfg.authorizationEndpoint,
        openEduWebOrigin: cfg.openEduWebOrigin,
        openEduTeacherOrigin: cfg.openEduTeacherOrigin,
        clientId: cfg.clientId,
        deploymentId: cfg.deploymentId,
      },
      secrets,
      outbox,
      aiQuota: {
        provider: appQuota.provider,
        configured: appQuota.configured,
        remainingToday: appQuota.remainingToday,
        dailyLimit: appQuota.dailyLimit,
        reserveForStep4: appQuota.reserveForStep4,
        checkedAt: appQuota.checkedAt,
        error: appQuota.error,
        autoFallbackCount: Math.max(dbAutoFallbackCount, getSessionAutoFallbackCount()),
      },
    });
  });

  // Manual "Gửi lại ngay" trigger for pending/failed banviet.outbox items
  router.post('/api/teacher/lti/outbox/retry', async (_req: Request, res: Response) => {
    try {
      const result = await retryAllPendingOutbox();
      res.json(result);
    } catch (err) {
      console.error('[POST /api/teacher/lti/outbox/retry error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return router;
}
