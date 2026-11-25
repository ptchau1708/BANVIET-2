import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiTimeoutError,
  OPENROUTER_KEY_CACHE_TTL_MS,
  STEP4_RESERVE_REQUESTS,
  canAppAiServeEndpoint,
  decrementCachedOpenRouterQuota,
  getAppAiQuotaSnapshot,
  isFallbackableAiError,
  resetAiQuotaCacheForTest,
  withAiTimeout,
} from './aiQuota.ts';
import { buildGroundedWordBankPrompt } from './gemini.ts';
import { FIXED_SYSTEM_INSTRUCTION } from './validation.ts';

test('getAppAiQuotaSnapshot reads OpenRouter free_model_daily_requests.remaining and caches for 5 minutes', async () => {
  resetAiQuotaCacheForTest();
  let fetchCalls = 0;
  let now = 1_700_000_000_000;

  const mockFetch = (async (url: string | URL | Request) => {
    fetchCalls += 1;
    assert.equal(String(url), 'https://openrouter.ai/api/v1/key');
    return new Response(
      JSON.stringify({
        data: {
          free_model_daily_requests: {
            remaining: fetchCalls === 1 ? 18 : 12,
            limit: 50,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const env = { OPENROUTER_API_KEY: 'sk-or-test-key' } as NodeJS.ProcessEnv;

  const first = await getAppAiQuotaSnapshot({ env, fetchImpl: mockFetch, nowMs: () => now });
  assert.equal(first.provider, 'openrouter');
  assert.equal(first.configured, true);
  assert.equal(first.remainingToday, 18);
  assert.equal(first.dailyLimit, 50);
  assert.equal(fetchCalls, 1);

  // Within 5 minutes -> served from cache without calling fetch again
  now += OPENROUTER_KEY_CACHE_TTL_MS - 1_000;
  const cached = await getAppAiQuotaSnapshot({ env, fetchImpl: mockFetch, nowMs: () => now });
  assert.equal(cached.remainingToday, 18);
  assert.equal(fetchCalls, 1);

  // Local decrement updates cached count accurately
  decrementCachedOpenRouterQuota();
  const afterDec = await getAppAiQuotaSnapshot({ env, fetchImpl: mockFetch, nowMs: () => now });
  assert.equal(afterDec.remainingToday, 17);
  assert.equal(fetchCalls, 1);

  // After 5 minutes -> refreshes from OpenRouter
  now += 2_000;
  const refreshed = await getAppAiQuotaSnapshot({ env, fetchImpl: mockFetch, nowMs: () => now });
  assert.equal(refreshed.remainingToday, 12);
  assert.equal(fetchCalls, 2);
});

test('canAppAiServeEndpoint reserves at least 5 requests for Step 4 "Đọc giúp"', () => {
  assert.equal(STEP4_RESERVE_REQUESTS, 5);

  const makeSnap = (remainingToday: number | null) => ({
    provider: 'openrouter' as const,
    configured: true,
    remainingToday,
    dailyLimit: 50,
    reserveForStep4: 5,
    checkedAt: new Date().toISOString(),
    error: null,
  });

  // Remaining = 6 -> all endpoints allowed
  assert.deepEqual(canAppAiServeEndpoint('goi-y', makeSnap(6)), { allowed: true });
  assert.deepEqual(canAppAiServeEndpoint('kiem-tra-dan-y', makeSnap(6)), { allowed: true });
  assert.deepEqual(canAppAiServeEndpoint('gop-y-bai', makeSnap(6)), { allowed: true });

  // Remaining = 5 -> Step 1 & Step 2 blocked (reserved for Step 4), Step 4 STILL allowed
  assert.deepEqual(canAppAiServeEndpoint('goi-y', makeSnap(5)), {
    allowed: false,
    reason: 'reserved_for_step4',
  });
  assert.deepEqual(canAppAiServeEndpoint('kiem-tra-dan-y', makeSnap(5)), {
    allowed: false,
    reason: 'reserved_for_step4',
  });
  assert.deepEqual(canAppAiServeEndpoint('gop-y-bai', makeSnap(5)), { allowed: true });

  // Remaining = 1 -> Step 4 STILL allowed
  assert.deepEqual(canAppAiServeEndpoint('gop-y-bai', makeSnap(1)), { allowed: true });

  // Remaining = 0 -> all blocked
  assert.deepEqual(canAppAiServeEndpoint('gop-y-bai', makeSnap(0)), {
    allowed: false,
    reason: 'app_quota_exhausted',
  });

  // No key configured -> all blocked
  assert.deepEqual(
    canAppAiServeEndpoint('gop-y-bai', {
      provider: 'none',
      configured: false,
      remainingToday: 0,
      dailyLimit: 0,
      reserveForStep4: 5,
      checkedAt: null,
      error: null,
    }),
    { allowed: false, reason: 'no_key' }
  );
});

test('withAiTimeout rejects slow calls with AiTimeoutError and isFallbackableAiError classifies failures', async () => {
  await assert.rejects(
    () => withAiTimeout(new Promise(() => {}), 30),
    (err: unknown) => err instanceof AiTimeoutError && isFallbackableAiError(err)
  );

  const err429 = Object.assign(new Error('Too Many Requests'), { status: 429 });
  const err403 = Object.assign(new Error('Forbidden'), { status: 403 });
  const errNet = new Error('fetch failed: ECONNRESET');

  assert.equal(isFallbackableAiError(err429), true);
  assert.equal(isFallbackableAiError(err403), true);
  assert.equal(isFallbackableAiError(errNet), true);
});

test('buildGroundedWordBankPrompt embeds 30–38 curated items, limits new words to 3, and preserves FIXED_SYSTEM_INSTRUCTION', () => {
  const built = buildGroundedWordBankPrompt({
    submission_id: 'sub-1',
    buoc: 2,
    nguoi_ta: 'Bà ngoại',
    che_do: 'kho_tu_ngu',
    muc: 'Mái tóc',
    ghi_chu: ['tóc bạc trắng'],
    tin_nhan: '',
    lich_su_chat: [],
    dan_y_tom_tat: '',
    cau_hoi_da_xem: [],
  });

  assert.ok(
    built.systemInstruction.includes(FIXED_SYSTEM_INSTRUCTION),
    'FIXED_SYSTEM_INSTRUCTION must remain intact'
  );
  assert.ok(built.systemInstruction.includes('TỐI ĐA 3'), 'Prompt must cap AI additions at 3 new words');
  assert.ok(
    built.bankItems.length >= 30 && built.bankItems.length <= 38,
    `Expected 30–38 grounded bank items, got ${built.bankItems.length}`
  );
  assert.ok(built.userContent.includes('<kho_tu_co_san>'));
});
