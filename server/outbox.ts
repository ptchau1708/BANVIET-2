import { getSql, isDatabaseConfigured } from './db.ts';
import { isLtiEnabled } from './ltiConfig.ts';
import {
  type AgsScoreOutboxPayload,
  type XapiOutboxPayload,
  dispatchAgsScore,
  dispatchXapiStatement,
} from './ltiServices.ts';

export const OUTBOX_MAX_ATTEMPTS = 10;

// Backoff delays in minutes after attempt #1, #2, #3, #4+ (1m, 5m, 30m, 2h)
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;

export function getOutboxBackoffMinutes(failedAttemptNumber: number): number {
  if (failedAttemptNumber <= 1) return RETRY_DELAYS_MINUTES[0]; // 1 min
  if (failedAttemptNumber === 2) return RETRY_DELAYS_MINUTES[1]; // 5 min
  if (failedAttemptNumber === 3) return RETRY_DELAYS_MINUTES[2]; // 30 min
  return RETRY_DELAYS_MINUTES[3]; // 2 hours
}

export type OutboxKind = 'ags_score' | 'xapi';

export async function enqueueOutboxEvent(
  kind: OutboxKind,
  payload: AgsScoreOutboxPayload | XapiOutboxPayload
): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const sql = getSql();
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO banviet.outbox (kind, payload, attempts, next_at)
    VALUES (${kind}, ${sql.json(payload as never)}, 0, NOW())
    RETURNING id
  `;

  // Fire-and-forget immediate delivery attempt; failures remain scheduled in banviet.outbox
  void flushOutboxNow().catch((err) => {
    console.error('[Outbox immediate flush error]', err);
  });

  return rows[0]?.id ?? null;
}

let flushing = false;

export interface OutboxFlushResult {
  processed: number;
  sent: number;
  failed: number;
  lastError: string | null;
}

export async function flushOutboxNow(limit = 20): Promise<OutboxFlushResult> {
  if (!isDatabaseConfigured() || !isLtiEnabled() || flushing) {
    return { processed: 0, sent: 0, failed: 0, lastError: null };
  }

  flushing = true;
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;

  try {
    const sql = getSql();
    const pendingRows = await sql<
      Array<{
        id: string;
        kind: OutboxKind;
        payload: Record<string, unknown>;
        attempts: number;
      }>
    >`
      SELECT id, kind, payload, attempts
      FROM banviet.outbox
      WHERE sent_at IS NULL
        AND attempts < ${OUTBOX_MAX_ATTEMPTS}
        AND (next_at IS NULL OR next_at <= NOW())
      ORDER BY next_at ASC NULLS FIRST, id ASC
      LIMIT ${limit}
    `;

    for (const row of pendingRows) {
      processed++;
      try {
        if (row.kind === 'ags_score') {
          await dispatchAgsScore(row.payload as unknown as AgsScoreOutboxPayload);
        } else if (row.kind === 'xapi') {
          await dispatchXapiStatement(row.payload as unknown as XapiOutboxPayload);
        } else {
          throw new Error(`Loại outbox không hỗ trợ: ${String(row.kind)}`);
        }

        await sql`
          UPDATE banviet.outbox
          SET sent_at = NOW(), last_error = NULL
          WHERE id = ${row.id}
        `;
        sent++;
      } catch (err) {
        const nextAttempts = Number(row.attempts || 0) + 1;
        const delayMin = getOutboxBackoffMinutes(nextAttempts);
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        lastError = message;
        failed++;

        await sql`
          UPDATE banviet.outbox
          SET
            attempts = ${nextAttempts},
            next_at = NOW() + (${delayMin} * INTERVAL '1 minute'),
            last_error = ${message}
          WHERE id = ${row.id}
        `;
      }
    }
  } finally {
    flushing = false;
  }

  return { processed, sent, failed, lastError };
}

export async function retryAllPendingOutbox(): Promise<OutboxFlushResult> {
  if (!isDatabaseConfigured()) {
    return { processed: 0, sent: 0, failed: 0, lastError: 'Chưa cấu hình DATABASE_URL.' };
  }
  if (!isLtiEnabled()) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      lastError: 'Tính năng LTI đang tạm tắt vì chưa cấu hình đủ biến OPEN-EDU.',
    };
  }
  const sql = getSql();
  // Reset next_at to NOW() for unsent rows (and allow 1 fresh retry if a row previously hit max attempts)
  await sql`
    UPDATE banviet.outbox
    SET
      next_at = NOW(),
      attempts = LEAST(attempts, ${OUTBOX_MAX_ATTEMPTS - 1})
    WHERE sent_at IS NULL
  `;
  return flushOutboxNow(50);
}

export async function cleanupExpiredLtiNonces(): Promise<number> {
  if (!isDatabaseConfigured() || !isLtiEnabled()) return 0;
  const sql = getSql();
  const deleted = await sql<Array<{ nonce: string }>>`
    DELETE FROM banviet.lti_nonces
    WHERE expires_at < NOW()
    RETURNING nonce
  `;
  return deleted.length;
}

let workersStarted = false;

export function startLtiBackgroundWorkers(): void {
  if (workersStarted) return;
  workersStarted = true;

  // Poll banviet.outbox every 60 seconds
  const outboxTimer = setInterval(() => {
    void flushOutboxNow().catch((err) => {
      console.error('[Outbox worker error]', err);
    });
  }, 60 * 1000);
  outboxTimer.unref?.();

  // Delete expired banviet.lti_nonces every 1 hour
  const nonceTimer = setInterval(() => {
    void cleanupExpiredLtiNonces().catch((err) => {
      console.error('[LTI nonce cleanup error]', err);
    });
  }, 60 * 60 * 1000);
  nonceTimer.unref?.();
}
