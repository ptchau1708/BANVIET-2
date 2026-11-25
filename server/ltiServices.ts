import {
  LTI_AGS_SCORE_SCOPE,
  OPENEDU_XAPI_SCOPE,
  getLtiConfig,
  isTrustedPlatformServiceUrl,
} from './ltiConfig.ts';
import { signClientAssertionJwt } from './ltiKeys.ts';

interface CachedAccessToken {
  accessToken: string;
  expiresAtMs: number;
  scopeKey: string;
}

const tokenCache = new Map<string, CachedAccessToken>();

export function clearAccessTokenCache(): void {
  tokenCache.clear();
}

export async function getPlatformAccessToken(
  scopes: string[] = [LTI_AGS_SCORE_SCOPE, OPENEDU_XAPI_SCOPE]
): Promise<string> {
  const cfg = getLtiConfig();
  if (!cfg.clientId) {
    throw new Error('Chưa cấu hình LTI_CLIENT_ID trong Secrets.');
  }

  const normalizedScopes = Array.from(new Set(scopes.map((s) => s.trim()).filter(Boolean))).sort();
  const scopeStr = normalizedScopes.join(' ');
  const cached = tokenCache.get(scopeStr);
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) {
    return cached.accessToken;
  }

  const assertion = await signClientAssertionJwt({
    clientId: cfg.clientId,
    tokenEndpoint: cfg.tokenEndpoint,
  });

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope: scopeStr,
  });

  const res = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  let parsed: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    // non-JSON response handled below
  }

  if (!res.ok || !parsed.access_token) {
    throw new Error(
      `OPEN-EDU /token lỗi (${res.status}): ${parsed.error_description || parsed.error || text.slice(0, 200)}`
    );
  }

  const expiresInSec = Number(parsed.expires_in ?? 3600);
  const ttlMs = Math.max(60, Number.isFinite(expiresInSec) ? expiresInSec : 3600) * 1000;
  tokenCache.set(scopeStr, {
    accessToken: parsed.access_token,
    expiresAtMs: Date.now() + ttlMs,
    scopeKey: scopeStr,
  });

  return parsed.access_token;
}

export interface AgsScoreOutboxPayload {
  lineitemUrl: string;
  score: {
    userId: string;
    scoreGiven: number;
    scoreMaximum: number;
    activityProgress: 'Completed';
    gradingProgress: 'FullyGraded';
    timestamp: string;
  };
}

export interface XapiMetricsSummary {
  outline_details: number;
  draft_words: number;
  revised_words: number;
  edits_count: number;
  ai_calls: number;
  feedback_rounds: number;
  minutes_spent: number;
}

export interface XapiOutboxPayload {
  endpoint: string;
  statement: Record<string, unknown>;
}

export function sumTeacherRubricScore(rubric: Record<string, unknown> | null | undefined): number {
  if (!rubric || typeof rubric !== 'object') return 0;
  const keys = ['boCuc', 'ngoaiHinh', 'tinhTinhHoatDong', 'camXuc', 'dungTuChinhTa'] as const;
  let total = 0;
  for (const key of keys) {
    const val = Number(rubric[key] ?? 0);
    if (Number.isFinite(val) && val > 0) {
      total += Math.min(3, Math.max(0, Math.round(val)));
    }
  }
  return Math.min(15, Math.max(0, total));
}

export function buildAgsScorePayload(params: {
  lineitemUrl: string;
  openEduSub: string;
  scoreGiven: number;
  timestamp?: string;
}): AgsScoreOutboxPayload {
  const clamped = Math.max(0, Math.min(15, Number(params.scoreGiven) || 0));
  return {
    lineitemUrl: params.lineitemUrl,
    score: {
      userId: params.openEduSub,
      scoreGiven: clamped,
      scoreMaximum: 15,
      activityProgress: 'Completed',
      gradingProgress: 'FullyGraded',
      timestamp: params.timestamp ?? new Date().toISOString(),
    },
  };
}

/**
 * Builds a privacy-safe xAPI statement for OPEN-EDU.
 * NEVER includes essay text, observations, outline text, or personal names.
 */
export function buildXapiStatementPayload(params: {
  endpoint: string;
  issuer: string;
  appBaseUrl: string;
  openEduSub: string;
  assignmentId: string;
  step: number;
  verbKind: 'completed' | 'submitted';
  metrics: XapiMetricsSummary;
  timestamp?: string;
}): XapiOutboxPayload {
  const safeStep = Math.max(1, Math.min(5, Math.round(params.step)));
  const cleanAppUrl = params.appBaseUrl.replace(/\/+$/, '');
  const verb =
    params.verbKind === 'submitted'
      ? {
          id: 'http://activitystrea.ms/schema/1.0/submit',
          display: { vi: 'đã nộp bài', 'en-US': 'submitted' },
        }
      : {
          id: 'http://adlnet.gov/expapi/verbs/completed',
          display: { vi: 'đã hoàn thành bước', 'en-US': 'completed' },
        };

  const statement = {
    actor: {
      objectType: 'Agent',
      account: {
        homePage: params.issuer,
        name: params.openEduSub,
      },
    },
    verb,
    object: {
      objectType: 'Activity',
      id: `${cleanAppUrl}/bai/${params.assignmentId}/buoc/${safeStep}`,
      definition: {
        name: { vi: `Bạn Viết — Bước ${safeStep}` },
        type: 'http://adlnet.gov/expapi/activities/lesson',
      },
    },
    result: {
      completion: true,
      extensions: {
        'https://banviet.app/xapi/metrics': {
          outline_details: Number(params.metrics.outline_details || 0),
          draft_words: Number(params.metrics.draft_words || 0),
          revised_words: Number(params.metrics.revised_words || 0),
          edits_count: Number(params.metrics.edits_count || 0),
          ai_calls: Number(params.metrics.ai_calls || 0),
          feedback_rounds: Number(params.metrics.feedback_rounds || 0),
          minutes_spent: Number(params.metrics.minutes_spent || 0),
        },
      },
    },
    timestamp: params.timestamp ?? new Date().toISOString(),
  };

  return {
    endpoint: params.endpoint,
    statement,
  };
}

export function buildScoresUrl(lineitemUrl: string): string {
  const parsed = new URL(lineitemUrl);
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = cleanPath.endsWith('/scores') ? cleanPath : `${cleanPath}/scores`;
  return parsed.toString();
}

export async function dispatchAgsScore(payload: AgsScoreOutboxPayload): Promise<void> {
  const cfg = getLtiConfig();
  if (!isTrustedPlatformServiceUrl(payload.lineitemUrl, cfg.issuer)) {
    throw new Error('URL cột điểm (lineitem) không thuộc OPEN-EDU issuer tin cậy.');
  }

  const scoresUrl = buildScoresUrl(payload.lineitemUrl);
  const token = await getPlatformAccessToken([LTI_AGS_SCORE_SCOPE, OPENEDU_XAPI_SCOPE]);

  const res = await fetch(scoresUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.ims.lis.v1.score+json',
    },
    body: JSON.stringify(payload.score),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gửi điểm AGS lỗi (${res.status}): ${errText.slice(0, 200)}`);
  }
}

export async function dispatchXapiStatement(payload: XapiOutboxPayload): Promise<void> {
  const cfg = getLtiConfig();
  const baseEndpoint = (payload.endpoint || `${cfg.issuer}/xapi`).replace(/\/+$/, '');
  const statementsUrl = baseEndpoint.endsWith('/statements')
    ? baseEndpoint
    : `${baseEndpoint}/statements`;

  if (!isTrustedPlatformServiceUrl(statementsUrl, cfg.issuer)) {
    throw new Error('URL xAPI không thuộc OPEN-EDU issuer tin cậy.');
  }

  const token = await getPlatformAccessToken([LTI_AGS_SCORE_SCOPE, OPENEDU_XAPI_SCOPE]);

  const res = await fetch(statementsUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Experience-API-Version': '1.0.3',
    },
    body: JSON.stringify([payload.statement]),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gửi xAPI lỗi (${res.status}): ${errText.slice(0, 200)}`);
  }
}
