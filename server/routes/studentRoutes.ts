import { Router, type Request, type Response } from 'express';
import {
  extractKhoTuStats,
  mergeKhoTuIntoOutlineCheck,
  mergeKhoTuStats,
} from '../../src/utils/khoTuNgu.ts';
import { canAppAiServeEndpoint, getAppAiQuotaSnapshot } from '../aiQuota.ts';
import { isValidUuid, requireAuth, requireRole } from '../auth.ts';
import { formatDatabaseError, getSql } from '../db.ts';
import { getLtiConfig } from '../ltiConfig.ts';
import { buildXapiStatementPayload } from '../ltiServices.ts';
import { recomputeAndUpsertMetrics } from '../metrics.ts';
import { enqueueOutboxEvent } from '../outbox.ts';
import { MAX_DB_ESSAY_LENGTH } from '../validation.ts';
import { getAppBaseUrl } from './ltiRoutes.ts';

export function createStudentRouter(): Router {
  const router = Router();
  router.use('/api/student', requireAuth, requireRole('student'));

  // Student profile + class AI config + list of assignments ("Bài của em")
  router.get('/api/student/me', async (req: Request, res: Response) => {
    const studentId = req.auth!.sub;
    try {
      const sql = getSql();
      const studentRows = await sql<
        Array<{
          id: string;
          nickname: string;
          class_id: string;
          class_name: string;
          join_code: string;
          ai_enabled: boolean;
          ai_daily_limit: number;
        }>
      >`
        SELECT
          s.id,
          s.nickname,
          s.class_id,
          c.name AS class_name,
          c.join_code,
          c.ai_enabled,
          c.ai_daily_limit
        FROM banviet.students s
        JOIN banviet.classes c ON c.id = s.class_id
        WHERE s.id = ${studentId}
        LIMIT 1
      `;

      if (studentRows.length === 0) {
        res.status(401).json({ error: 'Tài khoản học sinh không còn tồn tại.' });
        return;
      }

      const student = studentRows[0];

      const usageRows = await sql<Array<{ count: number }>>`
        SELECT count
        FROM banviet.ai_usage_daily
        WHERE student_id = ${studentId} AND day = CURRENT_DATE
        LIMIT 1
      `;
      const aiUsedToday = Number(usageRows[0]?.count ?? 0);

      const assignments = await sql<
        Array<{
          id: string;
          title: string;
          prompt_text: string | null;
          opens_at: Date | string | null;
          closes_at: Date | string | null;
          created_at: Date | string;
          submission_id: string | null;
          current_step: number | null;
          draft_locked_at: Date | string | null;
          submitted_at: Date | string | null;
          teacher_level: string | null;
          teacher_comment: string | null;
          updated_at: Date | string | null;
        }>
      >`
        SELECT
          a.id,
          a.title,
          a.prompt_text,
          a.opens_at,
          a.closes_at,
          a.created_at,
          sub.id AS submission_id,
          sub.current_step,
          sub.draft_locked_at,
          sub.submitted_at,
          sub.teacher_level,
          sub.teacher_comment,
          sub.updated_at
        FROM banviet.assignments a
        LEFT JOIN banviet.submissions sub
          ON sub.assignment_id = a.id AND sub.student_id = ${studentId}
        WHERE a.class_id = ${student.class_id}
        ORDER BY a.created_at DESC
      `;

      res.json({
        student: {
          id: student.id,
          nickname: student.nickname,
          classId: student.class_id,
          className: student.class_name,
          joinCode: student.join_code,
          aiEnabled: Boolean(student.ai_enabled),
          aiDailyLimit: Number(student.ai_daily_limit ?? 0),
          aiUsedToday,
        },
        assignments,
      });
    } catch (err) {
      console.error('[GET /api/student/me error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Get or create submission for an assignment belonging to student's class
  router.get(
    '/api/student/assignments/:assignmentId/submission',
    async (req: Request, res: Response) => {
      const studentId = req.auth!.sub;
      const { assignmentId } = req.params;
      if (!isValidUuid(assignmentId)) {
        res.status(400).json({ error: 'Mã bài tập không hợp lệ.' });
        return;
      }

      try {
        const sql = getSql();
        // Verify student's class owns this assignment
        const rows = await sql<
          Array<{
            assignment_id: string;
            title: string;
            prompt_text: string | null;
            opens_at: Date | string | null;
            closes_at: Date | string | null;
            class_id: string;
            ai_enabled: boolean;
            ai_daily_limit: number;
          }>
        >`
          SELECT
            a.id AS assignment_id,
            a.title,
            a.prompt_text,
            a.opens_at,
            a.closes_at,
            a.class_id,
            c.ai_enabled,
            c.ai_daily_limit
          FROM banviet.assignments a
          JOIN banviet.classes c ON c.id = a.class_id
          JOIN banviet.students s ON s.class_id = c.id
          WHERE a.id = ${assignmentId} AND s.id = ${studentId}
          LIMIT 1
        `;

        if (rows.length === 0) {
          res.status(403).json({ error: 'Em không có quyền mở bài tập này.' });
          return;
        }

        const assignment = rows[0];

        // Ensure submission row exists
        await sql`
          INSERT INTO banviet.submissions (assignment_id, student_id, current_step)
          VALUES (${assignmentId}, ${studentId}, 1)
          ON CONFLICT (assignment_id, student_id) DO NOTHING
        `;

        const subRows = await sql<Array<Record<string, unknown>>>`
          SELECT
            id,
            assignment_id,
            student_id,
            current_step,
            observation,
            outline,
            outline_check,
            draft_text,
            draft_locked_at,
            revised_text,
            self_checklist,
            self_rubric,
            teacher_rubric,
            teacher_level,
            teacher_comment,
            submitted_at,
            created_at,
            updated_at
          FROM banviet.submissions
          WHERE assignment_id = ${assignmentId} AND student_id = ${studentId}
          LIMIT 1
        `;

        const submission = subRows[0];
        const submissionId = String(submission.id);

        const aiEvents = await sql<Array<Record<string, unknown>>>`
          SELECT id, step, endpoint, request_text, response_json, flagged, created_at
          FROM banviet.ai_events
          WHERE submission_id = ${submissionId} AND student_id = ${studentId}
          ORDER BY created_at ASC
        `;

        const usageRows = await sql<Array<{ count: number }>>`
          SELECT count
          FROM banviet.ai_usage_daily
          WHERE student_id = ${studentId} AND day = CURRENT_DATE
          LIMIT 1
        `;

        const metricsRows = await sql<Array<Record<string, unknown>>>`
          SELECT outline_details, draft_words, revised_words, edits_count, ai_calls, feedback_rounds, minutes_spent, updated_at
          FROM banviet.metrics
          WHERE submission_id = ${submissionId}
          LIMIT 1
        `;

        const aiUsedToday = Number(usageRows[0]?.count ?? 0);
        const aiDailyLimit = Number(assignment.ai_daily_limit ?? 0);
        const aiEnabled = Boolean(assignment.ai_enabled);
        const appQuota = await getAppAiQuotaSnapshot();
        const hintsGate = canAppAiServeEndpoint('goi-y', appQuota);
        const step4Gate = canAppAiServeEndpoint('gop-y-bai', appQuota);
        const hasStudentQuota = aiEnabled && aiUsedToday < aiDailyLimit;

        res.json({
          assignment: {
            id: assignment.assignment_id,
            title: assignment.title,
            prompt_text: assignment.prompt_text,
            opens_at: assignment.opens_at,
            closes_at: assignment.closes_at,
          },
          aiSettings: {
            aiEnabled,
            aiDailyLimit,
            aiUsedToday,
            appAiRemaining: appQuota.remainingToday,
            aiAvailableForHints: hasStudentQuota && hintsGate.allowed,
            aiAvailableForStep4: hasStudentQuota && step4Gate.allowed,
          },
          submission,
          aiEvents,
          metrics: metricsRows[0] ?? null,
        });
      } catch (err) {
        console.error('[GET submission error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // Save student submission progress + recompute metrics
  router.put('/api/student/submissions/:submissionId', async (req: Request, res: Response) => {
    const studentId = req.auth!.sub;
    const { submissionId } = req.params;
    if (!isValidUuid(submissionId)) {
      res.status(400).json({ error: 'Mã bài làm không hợp lệ.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const currentStep = Number(body.current_step ?? 1);
    if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > 5) {
      res.status(400).json({ error: 'Bước hiện tại phải nằm từ 1 đến 5.' });
      return;
    }

    const draftText = typeof body.draft_text === 'string' ? body.draft_text : '';
    const revisedText = typeof body.revised_text === 'string' ? body.revised_text : '';
    if (draftText.length > MAX_DB_ESSAY_LENGTH || revisedText.length > MAX_DB_ESSAY_LENGTH) {
      res.status(400).json({
        error: `Nội dung bài viết vượt quá giới hạn ${MAX_DB_ESSAY_LENGTH} ký tự.`,
      });
      return;
    }

    const observation = body.observation && typeof body.observation === 'object' ? body.observation : null;
    const outline = body.outline && typeof body.outline === 'object' ? body.outline : null;
    const outlineCheck =
      body.outline_check && typeof body.outline_check === 'object' ? body.outline_check : null;
    const selfChecklist =
      body.self_checklist && typeof body.self_checklist === 'object' ? body.self_checklist : null;
    const selfRubric =
      body.self_rubric && typeof body.self_rubric === 'object' ? body.self_rubric : null;

    const lockDraftNow = Boolean(body.lock_draft);
    const markSubmitted = Boolean(body.mark_submitted);
    const stepCompleted = Boolean(body.step_completed);
    const deltaMinutes =
      typeof body.delta_minutes === 'number' && Number.isFinite(body.delta_minutes)
        ? Math.max(0, Math.min(30, body.delta_minutes))
        : 0;

    try {
      const sql = getSql();
      const existingRows = await sql<
        Array<{
          id: string;
          assignment_id: string;
          student_id: string;
          current_step: number;
          outline_check: Record<string, unknown> | null;
          draft_text: string | null;
          draft_locked_at: Date | string | null;
          submitted_at: Date | string | null;
          openedu_user_id: string | null;
        }>
      >`
        SELECT
          sub.id,
          sub.assignment_id,
          sub.student_id,
          sub.current_step,
          sub.outline_check,
          sub.draft_text,
          sub.draft_locked_at,
          sub.submitted_at,
          s.openedu_user_id
        FROM banviet.submissions sub
        JOIN banviet.students s ON s.id = sub.student_id
        WHERE sub.id = ${submissionId}
        LIMIT 1
      `;

      if (existingRows.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy bài làm.' });
        return;
      }

      const existing = existingRows[0];
      if (existing.student_id !== studentId) {
        res.status(403).json({ error: 'Em chỉ được lưu bài làm của chính mình.' });
        return;
      }

      // Preserve and merge outline_check.kho_tu so counters are never overwritten
      const existingKhoTu = extractKhoTuStats(existing.outline_check);
      const incomingKhoTu = extractKhoTuStats(outlineCheck);
      const mergedKhoTu = mergeKhoTuStats(existingKhoTu, incomingKhoTu);
      const incomingOutlineWithoutKho =
        outlineCheck && typeof outlineCheck === 'object'
          ? (() => {
              const copy = { ...(outlineCheck as Record<string, unknown>) };
              delete copy.kho_tu;
              return Object.keys(copy).length > 0 ? copy : null;
            })()
          : null;
      const finalOutlineCheck = mergeKhoTuIntoOutlineCheck(incomingOutlineWithoutKho, mergedKhoTu);

      // Enforce immutable draft_text once draft_locked_at is set
      const alreadyLocked = Boolean(existing.draft_locked_at);
      const finalDraftText = alreadyLocked ? (existing.draft_text ?? '') : draftText;
      const shouldSetDraftLocked = !alreadyLocked && lockDraftNow && finalDraftText.trim().length > 0;
      const shouldSetSubmitted = !existing.submitted_at && (markSubmitted || currentStep === 5);

      const updated = await sql<Array<Record<string, unknown>>>`
        UPDATE banviet.submissions
        SET
          current_step = ${currentStep},
          observation = ${observation ? sql.json(observation as never) : null},
          outline = ${outline ? sql.json(outline as never) : null},
          outline_check = ${finalOutlineCheck ? sql.json(finalOutlineCheck as never) : null},
          draft_text = ${finalDraftText},
          draft_locked_at = CASE
            WHEN draft_locked_at IS NOT NULL THEN draft_locked_at
            WHEN ${shouldSetDraftLocked} THEN NOW()
            ELSE NULL
          END,
          revised_text = ${revisedText},
          self_checklist = ${selfChecklist ? sql.json(selfChecklist as never) : null},
          self_rubric = ${selfRubric ? sql.json(selfRubric as never) : null},
          submitted_at = CASE
            WHEN submitted_at IS NOT NULL THEN submitted_at
            WHEN ${shouldSetSubmitted} THEN NOW()
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE id = ${submissionId} AND student_id = ${studentId}
        RETURNING
          id,
          current_step,
          draft_locked_at,
          submitted_at,
          updated_at
      `;

      // Update metrics whenever a step completes, draft locks, or periodic save carries edits
      const metrics =
        stepCompleted || shouldSetDraftLocked || shouldSetSubmitted || deltaMinutes > 0
          ? await recomputeAndUpsertMetrics(sql, submissionId, deltaMinutes)
          : await recomputeAndUpsertMetrics(sql, submissionId, 0);

      // Enqueue xAPI statements into banviet.outbox for OPEN-EDU students (never sends essay text)
      const openEduSub = existing.openedu_user_id ?? req.auth?.openeduSub ?? null;
      if (openEduSub && metrics) {
        const ltiCfg = getLtiConfig();
        const xapiEndpoint = req.auth?.xapiEndpoint || `${ltiCfg.issuer}/xapi`;
        const appBaseUrl = getAppBaseUrl(req);
        const completedStepNum =
          currentStep > existing.current_step ? existing.current_step : currentStep;

        if (stepCompleted || shouldSetDraftLocked) {
          const stepPayload = buildXapiStatementPayload({
            endpoint: xapiEndpoint,
            issuer: ltiCfg.issuer,
            appBaseUrl,
            openEduSub,
            assignmentId: existing.assignment_id,
            step: completedStepNum,
            verbKind: 'completed',
            metrics,
          });
          await enqueueOutboxEvent('xapi', stepPayload).catch((e) =>
            console.error('[xAPI step enqueue error]', e)
          );
        }

        if (shouldSetSubmitted) {
          const submitPayload = buildXapiStatementPayload({
            endpoint: xapiEndpoint,
            issuer: ltiCfg.issuer,
            appBaseUrl,
            openEduSub,
            assignmentId: existing.assignment_id,
            step: 5,
            verbKind: 'submitted',
            metrics,
          });
          await enqueueOutboxEvent('xapi', submitPayload).catch((e) =>
            console.error('[xAPI submit enqueue error]', e)
          );
        }
      }

      res.json({
        saved: true,
        submission: updated[0],
        metrics,
      });
    } catch (err) {
      console.error('[PUT submission error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return router;
}
