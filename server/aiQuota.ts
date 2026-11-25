export type AiEndpointKind = 'goi-y' | 'kiem-tra-dan-y' | 'gop-y-bai';

export const OPENROUTER_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const STEP4_RESERVE_REQUESTS = 5;
export const AI_CALL_TIMEOUT_MS = 15_000;

export interface OpenRouterQuotaSnapshot {
  provider: 'openrouter' | 'gemini' | 'none';
  configured: boolean;
  remainingToday: number | null;
  dailyLimit: number | null;
  reserveForStep4: number;
  checkedAt: string | null;
  error: string | null;
}

interface CacheEntry {
  snapshot: OpenRouterQuotaSnapshot;
  expiresAtMs: number;
}

let cachedEntry: CacheEntry | null = null;
let sessionAutoFallbackCount = 0;

export class AiTimeoutError extends Error {
  code = 'AI_TIMEOUT';
  constructor(ms: number) {
    super(`Yêu cầu AI vượt quá ${Math.round(ms / 1000)} giây.`);
    this.name = 'AiTimeoutError';
  }
}

export function resetAiQuotaCacheForTest(): void {
  cachedEntry = null;
  sessionAutoFallbackCount = 0;
}

export function recordSessionAutoFallback(): number {
  sessionAutoFallbackCount += 1;
  return sessionAutoFallbackCount;
}

export function getSessionAutoFallbackCount(): number {
  return sessionAutoFallbackCount;
}

export function hasOpenRouterApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.OPENROUTER_API_KEY?.trim() ?? '';
  return key.length > 0;
}

export function hasGeminiApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.GEMINI_API_KEY?.trim() ?? '';
  return key.length > 0 && key !== 'MY_GEMINI_API_KEY';
}

function extractOpenRouterRemaining(payload: unknown): {
  remaining: number | null;
  limit: number | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { remaining: null, limit: null };
  }
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;

  const freeDaily =
    data.free_model_daily_requests && typeof data.free_model_daily_requests === 'object'
      ? (data.free_model_daily_requests as Record<string, unknown>)
      : root.free_model_daily_requests && typeof root.free_model_daily_requests === 'object'
        ? (root.free_model_daily_requests as Record<string, unknown>)
        : null;

  if (freeDaily) {
    const rem = Number(freeDaily.remaining);
    const lim = Number(freeDaily.limit ?? freeDaily.total ?? freeDaily.max);
    return {
      remaining: Number.isFinite(rem) ? Math.max(0, Math.floor(rem)) : null,
      limit: Number.isFinite(lim) ? Math.max(0, Math.floor(lim)) : null,
    };
  }

  // Fallback to limit_remaining if free_model_daily_requests is absent
  const limitRem = Number(data.limit_remaining);
  const limitTotal = Number(data.limit);
  return {
    remaining: Number.isFinite(limitRem) ? Math.max(0, Math.floor(limitRem)) : null,
    limit: Number.isFinite(limitTotal) ? Math.max(0, Math.floor(limitTotal)) : null,
  };
}

/**
 * Fetches and caches (5 minutes) the app's AI key remaining quota.
 * For OpenRouter, calls `GET https://openrouter.ai/api/v1/key` and reads
 * `free_model_daily_requests.remaining`.
 */
export async function getAppAiQuotaSnapshot(options?: {
  forceRefresh?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}): Promise<OpenRouterQuotaSnapshot> {
  const env = options?.env ?? process.env;
  const nowFn = options?.nowMs ?? (() => Date.now());
  const now = nowFn();

  if (!options?.forceRefresh && cachedEntry && now < cachedEntry.expiresAtMs) {
    return cachedEntry.snapshot;
  }

  const openRouterKey = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (openRouterKey) {
    const fetchFn = options?.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetchFn('https://openrouter.ai/api/v1/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        const snapshot: OpenRouterQuotaSnapshot = {
          provider: 'openrouter',
          configured: true,
          remainingToday: resp.status === 403 || resp.status === 429 ? 0 : null,
          dailyLimit: null,
          reserveForStep4: STEP4_RESERVE_REQUESTS,
          checkedAt: new Date(now).toISOString(),
          error: `OpenRouter key HTTP ${resp.status}`,
        };
        cachedEntry = { snapshot, expiresAtMs: now + OPENROUTER_KEY_CACHE_TTL_MS };
        return snapshot;
      }

      const json = (await resp.json()) as unknown;
      const parsed = extractOpenRouterRemaining(json);
      const snapshot: OpenRouterQuotaSnapshot = {
        provider: 'openrouter',
        configured: true,
        remainingToday: parsed.remaining,
        dailyLimit: parsed.limit,
        reserveForStep4: STEP4_RESERVE_REQUESTS,
        checkedAt: new Date(now).toISOString(),
        error: null,
      };
      cachedEntry = { snapshot, expiresAtMs: now + OPENROUTER_KEY_CACHE_TTL_MS };
      return snapshot;
    } catch (err) {
      const snapshot: OpenRouterQuotaSnapshot = {
        provider: 'openrouter',
        configured: true,
        remainingToday: null,
        dailyLimit: null,
        reserveForStep4: STEP4_RESERVE_REQUESTS,
        checkedAt: new Date(now).toISOString(),
        error: err instanceof Error ? err.message : 'Không kiểm tra được hạn mức OpenRouter.',
      };
      // Cache briefly (1 minute) on transient network failure
      cachedEntry = { snapshot, expiresAtMs: now + 60_000 };
      return snapshot;
    } finally {
      clearTimeout(timer);
    }
  }

  if (hasGeminiApiKey(env)) {
    const snapshot: OpenRouterQuotaSnapshot = {
      provider: 'gemini',
      configured: true,
      remainingToday: null,
      dailyLimit: null,
      reserveForStep4: STEP4_RESERVE_REQUESTS,
      checkedAt: new Date(now).toISOString(),
      error: null,
    };
    cachedEntry = { snapshot, expiresAtMs: now + OPENROUTER_KEY_CACHE_TTL_MS };
    return snapshot;
  }

  const snapshot: OpenRouterQuotaSnapshot = {
    provider: 'none',
    configured: false,
    remainingToday: 0,
    dailyLimit: 0,
    reserveForStep4: STEP4_RESERVE_REQUESTS,
    checkedAt: new Date(now).toISOString(),
    error: 'Chưa cấu hình khóa AI (GEMINI_API_KEY hoặc OPENROUTER_API_KEY).',
  };
  cachedEntry = { snapshot, expiresAtMs: now + 60_000 };
  return snapshot;
}

/**
 * Evaluates step (c) of the 3-step AI check:
 * - If no AI key is configured -> false (fallback to Word Bank).
 * - If OpenRouter remainingToday is known:
 *   - Step 4 ('gop-y-bai') can use down to remainingToday >= 1.
 *   - Step 1 & Step 2 ('goi-y', 'kiem-tra-dan-y') require remainingToday > 5
 *     so at least 5 requests are always reserved for Step 4 "Đọc giúp".
 */
export function canAppAiServeEndpoint(
  endpoint: AiEndpointKind,
  snapshot: OpenRouterQuotaSnapshot
): {
  allowed: boolean;
  reason?: 'no_key' | 'app_quota_exhausted' | 'reserved_for_step4';
} {
  if (!snapshot.configured || snapshot.provider === 'none') {
    return { allowed: false, reason: 'no_key' };
  }

  if (snapshot.remainingToday !== null) {
    if (snapshot.remainingToday <= 0) {
      return { allowed: false, reason: 'app_quota_exhausted' };
    }
    if (endpoint !== 'gop-y-bai' && snapshot.remainingToday <= snapshot.reserveForStep4) {
      return { allowed: false, reason: 'reserved_for_step4' };
    }
  }

  return { allowed: true };
}

/**
 * Decrements cached OpenRouter remainingToday locally by 1 after a successful call
 * (keeps cache accurate between 5-minute refreshes).
 */
export function decrementCachedOpenRouterQuota(): void {
  if (
    cachedEntry &&
    cachedEntry.snapshot.provider === 'openrouter' &&
    cachedEntry.snapshot.remainingToday !== null &&
    cachedEntry.snapshot.remainingToday > 0
  ) {
    cachedEntry.snapshot = {
      ...cachedEntry.snapshot,
      remainingToday: cachedEntry.snapshot.remainingToday - 1,
    };
  }
}

/**
 * Wraps an AI call promise with a hard timeout (default 15s) so slow responses trigger Word Bank fallback.
 */
export async function withAiTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = AI_CALL_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AiTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Determines whether an AI call error should trigger automatic silent fallback to the Word Bank
 * (429, 403, timeout > 15s, network error, missing key, provider error).
 */
export function isFallbackableAiError(err: unknown): boolean {
  if (!err) return true;
  if (err instanceof AiTimeoutError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  if (status === 429 || status === 403 || status === 401 || status === 408 || status >= 500) {
    return true;
  }

  return (
    msg.includes('429') ||
    msg.includes('403') ||
    msg.includes('resource_exhausted') ||
    msg.includes('permission_denied') ||
    msg.includes('api_key_invalid') ||
    msg.includes('timeout') ||
    msg.includes('vượt quá') ||
    msg.includes('aborted') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('chưa cấu hình khóa') ||
    msg.includes('openrouter') ||
    msg.includes('gemini')
  );
}
