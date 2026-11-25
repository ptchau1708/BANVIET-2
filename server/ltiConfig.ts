export const DEFAULT_LTI_ISSUER = 'https://dhrkppsbamebiklosmzn.supabase.co/functions/v1/lti';

export const LTI_AGS_SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
export const OPENEDU_XAPI_SCOPE = 'https://open-edu.vn/lti/scope/xapi';

export const LTI_CLAIMS = {
  MESSAGE_TYPE: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  VERSION: 'https://purl.imsglobal.org/spec/lti/claim/version',
  DEPLOYMENT_ID: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  ROLES: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  CONTEXT: 'https://purl.imsglobal.org/spec/lti/claim/context',
  RESOURCE_LINK: 'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  TARGET_LINK_URI: 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  AGS_ENDPOINT: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  OPENEDU_XAPI: 'https://open-edu.vn/lti/claim/xapi',
  CUSTOM: 'https://purl.imsglobal.org/spec/lti/claim/custom',
} as const;

export interface LtiPlatformConfig {
  issuer: string;
  jwksUri: string;
  tokenEndpoint: string;
  openEduWebOrigin: string;
  openEduTeacherOrigin: string;
  allowedFrameOrigins: string[];
  authorizationEndpoint: string;
  clientId: string;
  deploymentId: string;
}

export function isProductionAppEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.APP_ENV ?? '').trim().toLowerCase() === 'production';
}

export function getAppEnvMode(env: NodeJS.ProcessEnv = process.env): 'production' | 'testing' {
  return isProductionAppEnv(env) ? 'production' : 'testing';
}

export function normalizeOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('*')) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function collectAllowedOrigins(rawOrigins: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  for (const raw of rawOrigins) {
    const normalized = normalizeOrigin(raw);
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}

export function getLtiConfig(env: NodeJS.ProcessEnv = process.env): LtiPlatformConfig {
  const issuer = (env.LTI_ISSUER?.trim() || DEFAULT_LTI_ISSUER).replace(/\/+$/, '');
  const openEduWebOrigin = normalizeOrigin(env.OPENEDU_WEB_ORIGIN);
  const openEduTeacherOrigin = normalizeOrigin(env.OPENEDU_TEACHER_ORIGIN);
  const allowedFrameOrigins = collectAllowedOrigins([openEduWebOrigin, openEduTeacherOrigin]);
  const clientId = env.LTI_CLIENT_ID?.trim() || '';
  const deploymentId = env.LTI_DEPLOYMENT_ID?.trim() || '';

  return {
    issuer,
    jwksUri: `${issuer}/jwks`,
    tokenEndpoint: `${issuer}/token`,
    openEduWebOrigin,
    openEduTeacherOrigin,
    allowedFrameOrigins,
    // OIDC authorization endpoint ALWAYS stays on OPENEDU_WEB_ORIGIN/lti/auth
    authorizationEndpoint: openEduWebOrigin ? `${openEduWebOrigin}/lti/auth` : '',
    clientId,
    deploymentId,
  };
}

export function isLtiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = getLtiConfig(env);
  return Boolean(cfg.clientId && cfg.deploymentId && cfg.openEduWebOrigin);
}

/**
 * Builds the production Content-Security-Policy frame-ancestors directive.
 * Strictly allows ONLY 'self' + OPENEDU_WEB_ORIGIN + OPENEDU_TEACHER_ORIGIN
 * (no AI Studio origins, never uses '*').
 */
export function buildFrameAncestorsCsp(
  openEduOrigins: string | readonly (string | undefined)[]
): string {
  const openEduList = Array.isArray(openEduOrigins) ? openEduOrigins : [openEduOrigins];
  const safeOrigins = collectAllowedOrigins(openEduList);
  if (safeOrigins.length === 0) {
    return "frame-ancestors 'self'";
  }
  return `frame-ancestors 'self' ${safeOrigins.join(' ')}`;
}

/**
 * Returns the Content-Security-Policy header value for the current APP_ENV:
 * - APP_ENV=production -> strict frame-ancestors with OPEN-EDU origins only
 * - Otherwise (AI Studio preview / testing) -> null (header omitted)
 */
export function getCspHeaderForEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProductionAppEnv(env)) return null;
  return buildFrameAncestorsCsp(getLtiConfig(env).allowedFrameOrigins);
}

/**
 * Validates that an outbound LTI service URL (AGS lineitem or xAPI endpoint)
 * stays strictly under the trusted OPEN-EDU platform issuer prefix (SSRF defense).
 */
export function isTrustedPlatformServiceUrl(rawUrl: string, issuer: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const target = new URL(rawUrl);
    const base = new URL(issuer);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
    if (target.origin !== base.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

export function getLtiSecretStatus(env: NodeJS.ProcessEnv = process.env): {
  LTI_CLIENT_ID: boolean;
  LTI_DEPLOYMENT_ID: boolean;
  OPENEDU_WEB_ORIGIN: boolean;
  OPENEDU_TEACHER_ORIGIN: boolean;
  TOOL_PRIVATE_JWK: boolean;
  DATABASE_URL: boolean;
  SESSION_SECRET: boolean;
  allReady: boolean;
} {
  const cfg = getLtiConfig(env);
  let hasValidJwk = false;
  const rawJwk = env.TOOL_PRIVATE_JWK?.trim();
  if (rawJwk) {
    try {
      const parsed = JSON.parse(rawJwk) as Record<string, unknown>;
      hasValidJwk =
        parsed.kty === 'RSA' &&
        typeof parsed.n === 'string' &&
        typeof parsed.e === 'string' &&
        typeof parsed.d === 'string';
    } catch {
      hasValidJwk = false;
    }
  }

  const status = {
    LTI_CLIENT_ID: Boolean(cfg.clientId),
    LTI_DEPLOYMENT_ID: Boolean(cfg.deploymentId),
    OPENEDU_WEB_ORIGIN: Boolean(cfg.openEduWebOrigin),
    OPENEDU_TEACHER_ORIGIN: Boolean(cfg.openEduTeacherOrigin),
    TOOL_PRIVATE_JWK: hasValidJwk,
    DATABASE_URL: Boolean(env.DATABASE_URL?.trim()),
    SESSION_SECRET: Boolean(env.SESSION_SECRET?.trim() && env.SESSION_SECRET.trim().length >= 16),
  };

  return {
    ...status,
    allReady:
      status.LTI_CLIENT_ID &&
      status.LTI_DEPLOYMENT_ID &&
      status.OPENEDU_WEB_ORIGIN &&
      status.TOOL_PRIVATE_JWK &&
      status.DATABASE_URL,
  };
}
