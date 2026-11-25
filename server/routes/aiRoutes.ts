import { Router, type Request, type Response } from 'express';
import {
  FALLBACK_GENTLE_NOTICE,
  STEP4_PEER_TEACHER_HINT,
  STEP4_TOMORROW_NOTICE,
  buildLocalOutlineCheckFallback,
  extractKhoTuStats,
  mergeKhoTuIntoOutlineCheck,
  pickFallbackWordBank,
  pickUnseenQuestion,
  type KhoTuStats,
} from '../../src/utils/khoTuNgu.ts';
import {
  canAppAiServeEndpoint,
  getAppAiQuotaSnapshot,
  isFallbackableAiError,
  recordSessionAutoFallback,
  type AiEndpointKind,
} from '../aiQuota.ts';
import { detectSafetyFlag, requireAuth, requireRole } from '../auth.ts';
import { formatDatabaseError, getSql } from '../db.ts';
import { runGoiY, runGopYBai, runKiemTraDanY } from '../gemini.ts';
import { getServerKhoTuDb } from '../khoTuServer.ts';
import { recomputeAndUpsertMetrics } from '../metrics.ts';
import {
  validateGoiYPayload,
  validateGopYBaiPayload,
  validateKiemTraDanYPayload,
} from '../validation.ts';

type FallbackReason =
  | 'class_ai_disabled'
  | 'student_daily_limit'
  | 'app_quota_exhausted'
  | 'reserved_for_step4'
  | 'no_key'
  | 'ai_error';

interface StudentSubmissionAiContext {
  ok: true;
  submissionId: string;
  studentId: string;
  aiEnabled: boolean;
  aiDailyLimit: number;
  aiUsedToday: number;
  appAiRemaining: number | null;
  canCallAi: boolean;
  fallbackReason?: FallbackReason;
}

interface StudentAccessFailure {
  ok: false;
  status: number;
  error: string;
}

/**
 * Checks authorization and runs the mandatory 3-step AI availability check in order:
 * (a) classes.ai_enabled
 * (b) ai_usage_daily < classes.ai_daily_limit
 * (c) App AI key remaining quota (OpenRouter cached 5 min, >= 5 reserved for Step 4)
 */
async function evaluateAiPreChecks(
  studentId: string,
  submissionId: string,
  endpoint: AiEndpointKind
): Promise<StudentSubmissionAiContext | StudentAccessFailure> {
  const sql = getSql();

  const rows = await sql<
    Array<{
      submission_id: string;
      student_id: string;
      ai_enabled: boolean;
      ai_daily_limit: number;
    }>
  >`
    SELECT
      sub.id AS submission_id,
      sub.student_id,
      c.ai_enabled,
      c.ai_daily_limit
    FROM banviet.submissions sub
    JOIN banviet.students s ON s.id = sub.student_id
    JOIN banviet.classes c ON c.id = s.class_id
    WHERE sub.id = ${submissionId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Không tìm thấy bài làm.' };
  }

  const row = rows[0];
  if (row.student_id !== studentId) {
    return {
      ok: false,
      status: 403,
      error: 'Em chỉ được sử dụng Bạn Viết trên bài làm của chính mình.',
    };
  }

  const aiEnabled = Boolean(row.ai_enabled);
  const aiDailyLimit = Number(row.ai_daily_limit ?? 0);

  const usageRows = await sql<Array<{ count: number }>>`
    SELECT count
    FROM banviet.ai_usage_daily
    WHERE student_id = ${studentId} AND day = CURRENT_DATE
    LIMIT 1
  `;
  const aiUsedToday = Number(usageRows[0]?.count ?? 0);
  const appQuota = await getAppAiQuotaSnapshot();

  // Check (a): class AI enabled
  if (!aiEnabled) {
    return {
      ok: true,
      submissionId,
      studentId,
      aiEnabled,
      aiDailyLimit,
      aiUsedToday,
      appAiRemaining: appQuota.remainingToday,
      canCallAi: false,
      fallbackReason: 'class_ai_disabled',
    };
  }

  // Check (b): student daily quota
  if (aiUsedToday >= aiDailyLimit) {
    return {
      ok: true,
      submissionId,
      studentId,
      aiEnabled,
      aiDailyLimit,
      aiUsedToday,
      appAiRemaining: appQuota.remainingToday,
      canCallAi: false,
      fallbackReason: 'student_daily_limit',
    };
  }

  // Check (c): app AI key remaining quota (with 5 reserved for Step 4)
  const appGate = canAppAiServeEndpoint(endpoint, appQuota);
  if (!appGate.allowed) {
    return {
      ok: true,
      submissionId,
      studentId,
      aiEnabled,
      aiDailyLimit,
      aiUsedToday,
      appAiRemaining: appQuota.remainingToday,
      canCallAi: false,
      fallbackReason: appGate.reason ?? 'app_quota_exhausted',
    };
  }

  return {
    ok: true,
    submissionId,
    studentId,
    aiEnabled,
    aiDailyLimit,
    aiUsedToday,
    appAiRemaining: appQuota.remainingToday,
    canCallAi: true,
  };
}

/**
 * Increments `outline_check.kho_tu` in `banviet.submissions` when falling back to Word Bank.
 * NEVER inserts into `banviet.ai_events` and NEVER deducts `banviet.ai_usage_daily`.
 */
async function recordWordBankFallbackCounter(params: {
  submissionId: string;
  studentId: string;
  incrementGoiYTuKho: boolean;
  incrementAutoFallback: boolean;
}): Promise<KhoTuStats> {
  if (params.incrementAutoFallback) {
    recordSessionAutoFallback();
  }

  const sql = getSql();
  const rows = await sql<Array<{ outline_check: Record<string, unknown> | null }>>`
    SELECT outline_check
    FROM banviet.submissions
    WHERE id = ${params.submissionId} AND student_id = ${params.studentId}
    LIMIT 1
  `;

  const currentOutlineCheck =
    rows[0]?.outline_check && typeof rows[0].outline_check === 'object'
      ? { ...rows[0].outline_check }
      : null;
  const currentStats = extractKhoTuStats(currentOutlineCheck);
  const nextStats: KhoTuStats = {
    mo_kho: currentStats.mo_kho,
    goi_y_tu_kho: currentStats.goi_y_tu_kho + (params.incrementGoiYTuKho ? 1 : 0),
    tu_da_luu: currentStats.tu_da_luu,
    auto_fallback: (currentStats.auto_fallback ?? 0) + (params.incrementAutoFallback ? 1 : 0),
  };

  const mergedOutlineCheck = mergeKhoTuIntoOutlineCheck(currentOutlineCheck, nextStats);

  await sql`
    UPDATE banviet.submissions
    SET outline_check = ${mergedOutlineCheck ? sql.json(mergedOutlineCheck as never) : null},
        updated_at = NOW()
    WHERE id = ${params.submissionId} AND student_id = ${params.studentId}
  `;

  return nextStats;
}

async function recordAiEventAndUsage(params: {
  submissionId: string;
  studentId: string;
  step: number;
  endpoint: AiEndpointKind;
  requestText: string;
  responseJson: Record<string, unknown>;
  flagged: boolean;
}) {
  const sql = getSql();

  const usageRows = await sql<Array<{ count: number }>>`
    INSERT INTO banviet.ai_usage_daily (student_id, day, count)
    VALUES (${params.studentId}, CURRENT_DATE, 1)
    ON CONFLICT (student_id, day)
    DO UPDATE SET count = banviet.ai_usage_daily.count + 1
    RETURNING count
  `;

  const taggedResponse: Record<string, unknown> = {
    ...params.responseJson,
    nguon: 'ai',
  };

  const insertedEvent = await sql<
    Array<{ id: string; created_at: Date | string; flagged: boolean }>
  >`
    INSERT INTO banviet.ai_events (
      submission_id,
      student_id,
      step,
      endpoint,
      request_text,
      response_json,
      flagged
    )
    VALUES (
      ${params.submissionId},
      ${params.studentId},
      ${params.step},
      ${params.endpoint},
      ${params.requestText.slice(0, 3500)},
      ${sql.json(taggedResponse as never)},
      ${params.flagged}
    )
    RETURNING id, created_at, flagged
  `;

  await recomputeAndUpsertMetrics(sql, params.submissionId, 0);

  return {
    aiUsedToday: Number(usageRows[0]?.count ?? 1),
    event: insertedEvent[0],
  };
}

function buildGoiYKhoFallbackPayload(params: {
  che_do: 'quan_sat' | 'tro_chuyen' | 'kho_tu_ngu';
  muc: string;
  nguoi_ta: string;
  tin_nhan: string;
  cau_hoi_da_xem: string[];
}) {
  const db = getServerKhoTuDb();

  if (params.che_do === 'kho_tu_ngu') {
    const picked = pickFallbackWordBank(db, {
      topicLabel: params.muc || 'Ngoại hình',
      personRole: params.nguoi_ta,
      count: 8,
    });
    return {
      nguon: 'kho' as const,
      thong_bao: FALLBACK_GENTLE_NOTICE,
      tu_ngu: picked.tu_ngu,
      tra_loi: picked.tra_loi,
      kho_nhom_id: picked.groupId,
      kho_chu_de_id: picked.topicId,
    };
  }

  const pickedQ = pickUnseenQuestion(db, {
    boxOrTopic: params.muc || params.tin_nhan || 'ngoaiHinh',
    personRole: params.nguoi_ta,
    seenQuestions: params.cau_hoi_da_xem,
  });

  return {
    nguon: 'kho' as const,
    thong_bao: FALLBACK_GENTLE_NOTICE,
    tra_loi: pickedQ.question,
    kho_nhom_id: pickedQ.groupId,
    kho_chu_de_id: pickedQ.topicId,
  };
}

export function createAiRouter(): Router {
  const router = Router();

  // Endpoint 1: Step 1 & Step 2 guiding questions, chat, word bank
  router.post(
    '/api/goi-y',
    requireAuth,
    requireRole('student'),
    async (req: Request, res: Response) => {
      const validation = validateGoiYPayload(req.body);
      if (!validation.ok || !validation.data) {
        res.status(400).json({ error: validation.error || 'Yêu cầu chưa hợp lệ.' });
        return;
      }

      const data = validation.data;
      const studentId = req.auth!.sub;

      try {
        const ctx = await evaluateAiPreChecks(studentId, data.submission_id, 'goi-y');
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }

        const sendKhoFallback = async (reason: FallbackReason) => {
          const khoTuStats = await recordWordBankFallbackCounter({
            submissionId: data.submission_id,
            studentId,
            incrementGoiYTuKho: true,
            incrementAutoFallback: true,
          });
          const fallbackPayload = buildGoiYKhoFallbackPayload(data);
          res.json({
            ...fallbackPayload,
            fallback_reason: reason,
            aiUsedToday: ctx.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - ctx.aiUsedToday),
            appAiRemaining: ctx.appAiRemaining,
            khoTuStats,
          });
        };

        if (!ctx.canCallAi) {
          await sendKhoFallback(ctx.fallbackReason ?? 'app_quota_exhausted');
          return;
        }

        try {
          // Never forward student nickname, class name, or personal names to AI
          const output = await runGoiY(data);

          const requestSummary =
            data.che_do === 'tro_chuyen'
              ? data.tin_nhan
              : data.che_do === 'kho_tu_ngu'
                ? `[Kho từ ngữ: ${data.muc}] ${data.ghi_chu.join('; ')}`
                : `[Gợi nhớ ${data.muc}] ${data.ghi_chu.join('; ')}`;

          const combinedCheckText = [
            data.tin_nhan,
            ...data.ghi_chu,
            data.dan_y_tom_tat,
          ].join(' ');
          const flagged = detectSafetyFlag(combinedCheckText);

          const recorded = await recordAiEventAndUsage({
            submissionId: data.submission_id,
            studentId,
            step: data.buoc,
            endpoint: 'goi-y',
            requestText: requestSummary,
            responseJson: output as Record<string, unknown>,
            flagged,
          });

          const latestAppQuota = await getAppAiQuotaSnapshot();

          res.json({
            ...output,
            nguon: 'ai',
            aiUsedToday: recorded.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - recorded.aiUsedToday),
            appAiRemaining: latestAppQuota.remainingToday,
            eventId: recorded.event.id,
          });
        } catch (aiErr) {
          console.warn('[POST /api/goi-y AI error -> auto fallback to Word Bank]', aiErr);
          if (isFallbackableAiError(aiErr)) {
            await sendKhoFallback('ai_error');
            return;
          }
          await sendKhoFallback('ai_error');
        }
      } catch (err) {
        console.error('[POST /api/goi-y DB error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // Endpoint 2: Step 2 outline check
  router.post(
    '/api/kiem-tra-dan-y',
    requireAuth,
    requireRole('student'),
    async (req: Request, res: Response) => {
      const validation = validateKiemTraDanYPayload(req.body);
      if (!validation.ok || !validation.data) {
        res.status(400).json({ error: validation.error || 'Dàn ý chưa hợp lệ.' });
        return;
      }

      const data = validation.data;
      const studentId = req.auth!.sub;

      try {
        const ctx = await evaluateAiPreChecks(studentId, data.submission_id, 'kiem-tra-dan-y');
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }

        const sendKhoFallback = async (reason: FallbackReason) => {
          const khoTuStats = await recordWordBankFallbackCounter({
            submissionId: data.submission_id,
            studentId,
            incrementGoiYTuKho: true,
            incrementAutoFallback: true,
          });
          const db = getServerKhoTuDb();
          const localCheck = buildLocalOutlineCheckFallback(db, {
            nguoiTa: data.nguoi_ta,
            danY: data.dan_y,
            seenQuestions: data.cau_hoi_da_xem,
          });
          res.json({
            ...localCheck,
            nguon: 'kho',
            thong_bao: FALLBACK_GENTLE_NOTICE,
            fallback_reason: reason,
            aiUsedToday: ctx.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - ctx.aiUsedToday),
            appAiRemaining: ctx.appAiRemaining,
            khoTuStats,
          });
        };

        if (!ctx.canCallAi) {
          await sendKhoFallback(ctx.fallbackReason ?? 'app_quota_exhausted');
          return;
        }

        try {
          const output = await runKiemTraDanY(data);

          const requestSummary = [
            `Mở bài: ${data.dan_y.mo_bai}`,
            `Ngoại hình: ${data.dan_y.ngoai_hinh.join('; ')}`,
            `Tính tình/HĐ: ${data.dan_y.tinh_tinh_hoat_dong.join('; ')}`,
            `Kết bài: ${data.dan_y.ket_bai}`,
          ].join('\n');

          const flagged = detectSafetyFlag(requestSummary);

          const recorded = await recordAiEventAndUsage({
            submissionId: data.submission_id,
            studentId,
            step: 2,
            endpoint: 'kiem-tra-dan-y',
            requestText: requestSummary,
            responseJson: output as unknown as Record<string, unknown>,
            flagged,
          });

          const latestAppQuota = await getAppAiQuotaSnapshot();

          res.json({
            ...output,
            nguon: 'ai',
            aiUsedToday: recorded.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - recorded.aiUsedToday),
            appAiRemaining: latestAppQuota.remainingToday,
            eventId: recorded.event.id,
          });
        } catch (aiErr) {
          console.warn('[POST /api/kiem-tra-dan-y AI error -> auto fallback to Word Bank]', aiErr);
          await sendKhoFallback('ai_error');
        }
      } catch (err) {
        console.error('[POST /api/kiem-tra-dan-y DB error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  // Endpoint 3: Step 4 essay review (max 3 per submission)
  router.post(
    '/api/gop-y-bai',
    requireAuth,
    requireRole('student'),
    async (req: Request, res: Response) => {
      const validation = validateGopYBaiPayload(req.body);
      if (!validation.ok || !validation.data) {
        res.status(400).json({ error: validation.error || 'Bài văn chưa hợp lệ.' });
        return;
      }

      const data = validation.data;
      const studentId = req.auth!.sub;

      try {
        const ctx = await evaluateAiPreChecks(studentId, data.submission_id, 'gop-y-bai');
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }

        const sql = getSql();
        const priorReviews = await sql<Array<{ cnt: number }>>`
          SELECT COUNT(*)::int AS cnt
          FROM banviet.ai_events
          WHERE submission_id = ${data.submission_id}
            AND student_id = ${studentId}
            AND endpoint = 'gop-y-bai'
        `;
        const usedRounds = Number(priorReviews[0]?.cnt ?? 0);
        if (usedRounds >= 3) {
          res.status(400).json({
            error: 'Em đã dùng đủ 3 lần nhờ Bạn Viết đọc giúp cho bài văn này rồi nhé!',
          });
          return;
        }

        const sendStep4Unavailable = async (reason: FallbackReason) => {
          const khoTuStats = await recordWordBankFallbackCounter({
            submissionId: data.submission_id,
            studentId,
            incrementGoiYTuKho: false,
            incrementAutoFallback: true,
          });
          res.json({
            nguon: 'kho',
            aiUnavailable: true,
            fallback_reason: reason,
            thong_bao: STEP4_TOMORROW_NOTICE,
            goi_y_ban_be: STEP4_PEER_TEACHER_HINT,
            loi_khen: '',
            gop_y: [],
            aiUsedToday: ctx.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - ctx.aiUsedToday),
            appAiRemaining: ctx.appAiRemaining,
            khoTuStats,
          });
        };

        if (!ctx.canCallAi) {
          await sendStep4Unavailable(ctx.fallbackReason ?? 'app_quota_exhausted');
          return;
        }

        try {
          const output = await runGopYBai({
            ...data,
            lan_thu: usedRounds + 1,
          });

          const flagged = detectSafetyFlag(data.bai_van);

          const recorded = await recordAiEventAndUsage({
            submissionId: data.submission_id,
            studentId,
            step: 4,
            endpoint: 'gop-y-bai',
            requestText: data.bai_van,
            responseJson: output as unknown as Record<string, unknown>,
            flagged,
          });

          const latestAppQuota = await getAppAiQuotaSnapshot();

          res.json({
            ...output,
            nguon: 'ai',
            aiUnavailable: false,
            attemptNumber: usedRounds + 1,
            aiUsedToday: recorded.aiUsedToday,
            aiDailyLimit: ctx.aiDailyLimit,
            aiRemainingToday: Math.max(0, ctx.aiDailyLimit - recorded.aiUsedToday),
            appAiRemaining: latestAppQuota.remainingToday,
            eventId: recorded.event.id,
          });
        } catch (aiErr) {
          console.warn('[POST /api/gop-y-bai AI error -> Step 4 self-check mode]', aiErr);
          await sendStep4Unavailable('ai_error');
        }
      } catch (err) {
        console.error('[POST /api/gop-y-bai DB error]', err);
        const formatted = formatDatabaseError(err);
        res.status(formatted.status).json({ error: formatted.message });
      }
    }
  );

  return router;
}
