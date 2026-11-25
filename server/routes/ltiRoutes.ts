import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  createSessionToken,
  generateJoinCode,
  isValidUuid,
} from '../auth.ts';
import { getSql, isDatabaseConfigured } from '../db.ts';
import {
  LTI_CLAIMS,
  getLtiConfig,
  isLtiEnabled,
  isTrustedPlatformServiceUrl,
  normalizeOrigin,
  type LtiPlatformConfig,
} from '../ltiConfig.ts';
import { getPublicJwks } from '../ltiKeys.ts';

const PLACEHOLDER_TEACHER_OPENEDU_ID = '00000000-0000-0000-0000-000000000000';
const LTI_PARENT_ORIGIN_TTL_MS = 10 * 60 * 1000;

const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const ltiLoginParentOrigins = new Map<string, { origin: string; expiresAt: number }>();

function extractVerifiedRequestParentOrigin(
  req: Request,
  allowedOrigins: readonly string[]
): string {
  if (allowedOrigins.length === 0) return '';
  const candidates = [req.headers.origin, req.headers.referer];
  for (const raw of candidates) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const normalized = normalizeOrigin(raw);
    if (normalized && allowedOrigins.includes(normalized)) {
      return normalized;
    }
  }
  return '';
}

function recordLtiLoginParentOrigin(state: string, origin: string): void {
  const now = Date.now();
  // Prune expired entries opportunistically
  if (ltiLoginParentOrigins.size > 200) {
    for (const [key, entry] of ltiLoginParentOrigins.entries()) {
      if (entry.expiresAt <= now) ltiLoginParentOrigins.delete(key);
    }
  }
  if (origin) {
    ltiLoginParentOrigins.set(state, { origin, expiresAt: now + LTI_PARENT_ORIGIN_TTL_MS });
  }
}

function consumeLtiLoginParentOrigin(
  state: string,
  allowedOrigins: readonly string[]
): string {
  const entry = ltiLoginParentOrigins.get(state);
  ltiLoginParentOrigins.delete(state);
  if (!entry || entry.expiresAt <= Date.now()) return '';
  return allowedOrigins.includes(entry.origin) ? entry.origin : '';
}

function getRemoteJwks(jwksUri: string) {
  let cached = remoteJwksCache.get(jwksUri);
  if (!cached) {
    cached = createRemoteJWKSet(new URL(jwksUri));
    remoteJwksCache.set(jwksUri, cached);
  }
  return cached;
}

export function getAppBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFriendlyLtiErrorHtml(detail?: string): string {
  const safeDetail = detail ? `<p class="detail">${escapeHtml(detail)}</p>` : '';
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bạn Viết — Kết nối OPEN-EDU</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #F6FAF7; color: #1C2A24; font-size: 18px; line-height: 1.6; }
      .card { max-width: 480px; margin: 48px auto; background: #fff; border: 1px solid #DDE7E2; border-radius: 20px; padding: 28px; text-align: center; }
      h1 { font-size: 22px; color: #14532D; margin: 0 0 12px; }
      p { margin: 0 0 12px; color: #334155; }
      .detail { font-size: 15px; color: #64748B; margin-top: 12px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Em quay lại OPEN-EDU và bấm mở lại nhé</h1>
      <p>Phiên mở từ OPEN-EDU chưa hợp lệ hoặc đã hết hạn. Em chỉ cần quay lại OPEN-EDU và bấm vào bài viết một lần nữa.</p>
      ${safeDetail}
    </div>
  </body>
</html>`;
}

function renderLaunchHandoffHtml(params: {
  token: string;
  role: 'student' | 'teacher';
  targetPath: string;
  launchAssignmentId?: string | null;
  allowedOrigins: readonly string[];
  hintedParentOrigin?: string;
}): string {
  const safePayload = JSON.stringify({
    token: params.token,
    role: params.role,
    targetPath: params.targetPath,
    launchAssignmentId: params.launchAssignmentId ?? '',
    allowedOrigins: params.allowedOrigins,
    hintedParentOrigin: params.hintedParentOrigin ?? '',
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Đang mở Bạn Viết…</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #F6FAF7; color: #1C2A24; font-size: 18px; text-align: center; }
      .card { max-width: 420px; margin: 64px auto; background: #fff; border: 1px solid #DDE7E2; border-radius: 20px; padding: 28px; }
    </style>
  </head>
  <body>
    <div class="card">
      <p>Đang mở bài viết trên Bạn Viết…</p>
    </div>
    <script>
      (function () {
        var data = ${safePayload};
        try {
          window.sessionStorage.setItem('banviet_session_token', data.token);
          window.sessionStorage.setItem('banviet_session_role', data.role);
          window.sessionStorage.setItem('banviet_lti_mode', '1');
          var allowed = Array.isArray(data.allowedOrigins) ? data.allowedOrigins : [];
          var resolvedOrigin = '';
          if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
            var directParent = window.location.ancestorOrigins[0];
            if (allowed.indexOf(directParent) !== -1) {
              resolvedOrigin = directParent;
            }
          } else if (data.hintedParentOrigin && allowed.indexOf(data.hintedParentOrigin) !== -1) {
            resolvedOrigin = data.hintedParentOrigin;
          }
          if (resolvedOrigin) {
            window.sessionStorage.setItem('banviet_openedu_origin', resolvedOrigin);
          } else {
            window.sessionStorage.removeItem('banviet_openedu_origin');
          }
          if (data.launchAssignmentId) {
            window.sessionStorage.setItem('banviet_launch_assignment_id', data.launchAssignmentId);
          } else {
            window.sessionStorage.removeItem('banviet_launch_assignment_id');
          }
        } catch (e) {}
        window.location.replace(data.targetPath);
      })();
    </script>
  </body>
</html>`;
}

export interface ParsedLtiLaunchClaims {
  sub: string;
  nonce: string;
  isInstructor: boolean;
  givenName: string;
  displayName: string;
  contextId: string;
  contextTitle: string;
  resourceLinkId: string;
  resourceLinkTitle: string;
  resourceLinkDescription: string;
  lineitemUrl: string | null;
  xapiEndpoint: string;
}

const VALID_LTI_MESSAGE_TYPES = new Set([
  'LtiResourceLinkRequest',
  'LtiDeepLinkingRequest',
]);

export function validateLtiLaunchClaims(
  payload: JWTPayload,
  cfg: LtiPlatformConfig
): { ok: true; claims: ParsedLtiLaunchClaims } | { ok: false; reason: string } {
  const deploymentId = payload[LTI_CLAIMS.DEPLOYMENT_ID];
  if (typeof deploymentId !== 'string' || !deploymentId || deploymentId !== cfg.deploymentId) {
    return { ok: false, reason: 'deployment_id không khớp.' };
  }

  const version = payload[LTI_CLAIMS.VERSION];
  if (version !== '1.3.0') {
    return { ok: false, reason: 'Phiên bản LTI không phải 1.3.0.' };
  }

  const messageType = payload[LTI_CLAIMS.MESSAGE_TYPE];
  if (typeof messageType !== 'string' || !VALID_LTI_MESSAGE_TYPES.has(messageType)) {
    return { ok: false, reason: 'message_type không hợp lệ.' };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || !isValidUuid(sub)) {
    return { ok: false, reason: 'Thiếu mã người dùng (sub) hợp lệ.' };
  }

  const nonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : '';
  if (!nonce) {
    return { ok: false, reason: 'Thiếu nonce trong id_token.' };
  }

  const rawRoles = Array.isArray(payload[LTI_CLAIMS.ROLES])
    ? (payload[LTI_CLAIMS.ROLES] as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const isInstructor = rawRoles.some((r) =>
    /(?:^|[#/])(Instructor|Administrator|TeachingAssistant|Faculty|Staff)$/i.test(r.trim()) ||
    /instructor/i.test(r)
  );

  const rawGiven =
    typeof payload.given_name === 'string' ? payload.given_name.trim() : '';
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const givenName = (rawGiven || rawName || 'Bạn nhỏ').replace(/\s+/g, ' ').slice(0, 40);
  const displayName = (rawName || rawGiven || (isInstructor ? 'Giáo viên OPEN-EDU' : 'Bạn nhỏ'))
    .replace(/\s+/g, ' ')
    .slice(0, 120);

  const ctx = (payload[LTI_CLAIMS.CONTEXT] ?? {}) as Record<string, unknown>;
  const contextId = typeof ctx.id === 'string' ? ctx.id.trim().slice(0, 120) : '';
  const contextTitle =
    (typeof ctx.label === 'string' && ctx.label.trim()) ||
    (typeof ctx.title === 'string' && ctx.title.trim()) ||
    'Lớp OPEN-EDU';

  const rl = (payload[LTI_CLAIMS.RESOURCE_LINK] ?? {}) as Record<string, unknown>;
  const resourceLinkId = typeof rl.id === 'string' ? rl.id.trim().slice(0, 160) : '';
  const resourceLinkTitle =
    (typeof rl.title === 'string' && rl.title.trim()) || 'Bài văn tả người';
  const resourceLinkDescription =
    typeof rl.description === 'string' ? rl.description.trim().slice(0, 2000) : '';

  const ags = (payload[LTI_CLAIMS.AGS_ENDPOINT] ?? {}) as Record<string, unknown>;
  const rawLineitem = typeof ags.lineitem === 'string' ? ags.lineitem.trim() : '';
  const lineitemUrl =
    rawLineitem && isTrustedPlatformServiceUrl(rawLineitem, cfg.issuer) ? rawLineitem : null;

  const xapiClaim = (payload[LTI_CLAIMS.OPENEDU_XAPI] ?? {}) as Record<string, unknown>;
  const rawXapiUrl =
    (typeof xapiClaim.endpoint === 'string' && xapiClaim.endpoint.trim()) ||
    (typeof xapiClaim.statements_url === 'string' && xapiClaim.statements_url.trim()) ||
    (typeof xapiClaim.url === 'string' && xapiClaim.url.trim()) ||
    `${cfg.issuer}/xapi`;
  const xapiEndpoint = isTrustedPlatformServiceUrl(rawXapiUrl, cfg.issuer)
    ? rawXapiUrl
    : `${cfg.issuer}/xapi`;

  return {
    ok: true,
    claims: {
      sub,
      nonce,
      isInstructor,
      givenName,
      displayName,
      contextId,
      contextTitle: contextTitle.slice(0, 80),
      resourceLinkId,
      resourceLinkTitle: resourceLinkTitle.slice(0, 200),
      resourceLinkDescription,
      lineitemUrl,
      xapiEndpoint,
    },
  };
}

async function ensurePlaceholderTeacherId(): Promise<string> {
  const sql = getSql();
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM banviet.teachers
    WHERE openedu_user_id = ${PLACEHOLDER_TEACHER_OPENEDU_ID}
    LIMIT 1
  `;
  if (existing.length > 0) return existing[0].id;

  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO banviet.teachers (openedu_user_id, display_name)
    VALUES (${PLACEHOLDER_TEACHER_OPENEDU_ID}, ${'Giáo viên OPEN-EDU'})
    RETURNING id
  `;
  return inserted[0].id;
}

async function ensureClassForOpenEdu(params: {
  openEduClassId: string;
  classTitle: string;
  realTeacherId?: string;
}): Promise<{ id: string; name: string }> {
  const sql = getSql();
  const existing = await sql<Array<{ id: string; name: string; teacher_id: string }>>`
    SELECT id, name, teacher_id
    FROM banviet.classes
    WHERE openedu_class_id = ${params.openEduClassId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    // If the class was auto-created under the placeholder teacher before the instructor launched,
    // transfer ownership to the real OPEN-EDU instructor on first launch.
    if (params.realTeacherId && existing[0].teacher_id !== params.realTeacherId) {
      const placeholderRows = await sql<Array<{ id: string }>>`
        SELECT id FROM banviet.teachers
        WHERE openedu_user_id = ${PLACEHOLDER_TEACHER_OPENEDU_ID}
        LIMIT 1
      `;
      if (placeholderRows[0] && existing[0].teacher_id === placeholderRows[0].id) {
        await sql`
          UPDATE banviet.classes
          SET teacher_id = ${params.realTeacherId}
          WHERE id = ${existing[0].id}
        `;
      }
    }
    return { id: existing[0].id, name: existing[0].name };
  }

  const ownerTeacherId = params.realTeacherId ?? (await ensurePlaceholderTeacherId());
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode();
    try {
      const created = await sql<Array<{ id: string; name: string }>>`
        INSERT INTO banviet.classes (teacher_id, name, join_code, openedu_class_id, ai_enabled, ai_daily_limit)
        VALUES (${ownerTeacherId}, ${params.classTitle}, ${joinCode}, ${params.openEduClassId}, TRUE, 5)
        RETURNING id, name
      `;
      return created[0];
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('Không thể tạo lớp OPEN-EDU mới.');
}

async function ensureAssignmentForOpenEdu(params: {
  classId: string;
  resourceLinkId: string;
  title: string;
  description: string;
  lineitemUrl: string | null;
}): Promise<{ id: string; title: string }> {
  const sql = getSql();
  const existing = await sql<
    Array<{ id: string; title: string; openedu_lineitem_url: string | null }>
  >`
    SELECT id, title, openedu_lineitem_url
    FROM banviet.assignments
    WHERE class_id = ${params.classId}
      AND openedu_resource_link_id = ${params.resourceLinkId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    if (params.lineitemUrl && existing[0].openedu_lineitem_url !== params.lineitemUrl) {
      await sql`
        UPDATE banviet.assignments
        SET openedu_lineitem_url = ${params.lineitemUrl}
        WHERE id = ${existing[0].id}
      `;
    }
    return { id: existing[0].id, title: existing[0].title };
  }

  const created = await sql<Array<{ id: string; title: string }>>`
    INSERT INTO banviet.assignments (
      class_id,
      title,
      prompt_text,
      openedu_resource_link_id,
      openedu_lineitem_url
    )
    VALUES (
      ${params.classId},
      ${params.title},
      ${params.description || null},
      ${params.resourceLinkId},
      ${params.lineitemUrl}
    )
    RETURNING id, title
  `;
  return created[0];
}

async function ensureStudentForOpenEdu(params: {
  classId: string;
  openEduUserId: string;
  givenName: string;
}): Promise<{ id: string; nickname: string }> {
  const sql = getSql();
  const existing = await sql<Array<{ id: string; nickname: string; class_id: string }>>`
    SELECT id, nickname, class_id
    FROM banviet.students
    WHERE openedu_user_id = ${params.openEduUserId}
      AND class_id = ${params.classId}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return { id: existing[0].id, nickname: existing[0].nickname };
  }

  // Handle unique(class_id, nickname) gracefully if two students share the same given_name
  const baseName = params.givenName.trim().slice(0, 34) || 'Bạn nhỏ';
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate =
      attempt === 0 ? baseName : `${baseName} ${attempt + 1}`.slice(0, 40);
    try {
      const inserted = await sql<Array<{ id: string; nickname: string }>>`
        INSERT INTO banviet.students (class_id, nickname, openedu_user_id)
        VALUES (${params.classId}, ${candidate}, ${params.openEduUserId})
        RETURNING id, nickname
      `;
      return inserted[0];
    } catch (err) {
      const pgErr = err as { code?: string };
      if (pgErr?.code === '23505' && attempt < 5) continue;
      throw err;
    }
  }
  throw new Error('Không thể tạo tài khoản học sinh OPEN-EDU.');
}

export function createLtiRouter(): Router {
  const router = Router();

  // Public JWKS endpoint (both standard /.well-known/jwks.json and KET_NOI_LTI.md /lti/jwks)
  const handleJwks = (_req: Request, res: Response) => {
    try {
      const jwks = getPublicJwks();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(jwks);
    } catch (err) {
      console.error('[JWKS error]', err);
      res.status(500).json({ error: 'Khóa công khai của ứng dụng chưa hợp lệ.' });
    }
  };

  router.get('/.well-known/jwks.json', handleJwks);
  router.get('/lti/jwks', handleJwks);

  // 1) OIDC Third-Party Initiated Login (GET & POST /lti/login)
  const handleOidcLogin = async (req: Request, res: Response) => {
    const params = (req.method === 'POST' ? req.body : req.query) as Record<string, unknown>;
    const iss = typeof params?.iss === 'string' ? params.iss.trim() : '';
    const loginHint = typeof params?.login_hint === 'string' ? params.login_hint.trim() : '';
    const ltiMessageHint =
      typeof params?.lti_message_hint === 'string' ? params.lti_message_hint.trim() : '';
    const clientId = typeof params?.client_id === 'string' ? params.client_id.trim() : '';
    const ltiDeploymentId =
      typeof params?.lti_deployment_id === 'string' ? params.lti_deployment_id.trim() : '';

    const cfg = getLtiConfig();
    if (!isLtiEnabled() || !cfg.authorizationEndpoint || !isDatabaseConfigured()) {
      res
        .status(503)
        .send(
          renderFriendlyLtiErrorHtml(
            'Tính năng kết nối OPEN-EDU (LTI) hiện đang tắt do máy chủ chưa cấu hình đủ biến môi trường LTI.'
          )
        );
      return;
    }

    if (iss !== cfg.issuer) {
      res.status(400).send(renderFriendlyLtiErrorHtml());
      return;
    }

    if (clientId !== cfg.clientId) {
      res.status(400).send(renderFriendlyLtiErrorHtml());
      return;
    }

    if (ltiDeploymentId && cfg.deploymentId && ltiDeploymentId !== cfg.deploymentId) {
      res.status(400).send(renderFriendlyLtiErrorHtml());
      return;
    }

    if (!loginHint) {
      res.status(400).send(renderFriendlyLtiErrorHtml());
      return;
    }

    try {
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');

      const sql = getSql();
      await sql`
        INSERT INTO banviet.lti_nonces (nonce, state, expires_at)
        VALUES (${nonce}, ${state}, NOW() + INTERVAL '10 minutes')
      `;

      const parentOrigin = extractVerifiedRequestParentOrigin(req, cfg.allowedFrameOrigins);
      if (parentOrigin) {
        recordLtiLoginParentOrigin(state, parentOrigin);
      }

      const redirectUri = `${getAppBaseUrl(req)}/lti/launch`;
      const authUrl = new URL(cfg.authorizationEndpoint);
      authUrl.searchParams.set('scope', 'openid');
      authUrl.searchParams.set('response_type', 'id_token');
      authUrl.searchParams.set('response_mode', 'form_post');
      authUrl.searchParams.set('prompt', 'none');
      authUrl.searchParams.set('client_id', cfg.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('login_hint', loginHint);
      if (ltiMessageHint) {
        authUrl.searchParams.set('lti_message_hint', ltiMessageHint);
      }
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);

      res.redirect(302, authUrl.toString());
    } catch (err) {
      console.error('[LTI /lti/login error]', err);
      res.status(500).send(renderFriendlyLtiErrorHtml());
    }
  };

  router.get('/lti/login', handleOidcLogin);
  router.post('/lti/login', handleOidcLogin);

  // 2) LTI 1.3 Launch (POST /lti/launch)
  router.post('/lti/launch', async (req: Request, res: Response) => {
    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    const state = typeof req.body?.state === 'string' ? req.body.state.trim() : '';

    const cfg = getLtiConfig();
    if (!isLtiEnabled() || !isDatabaseConfigured()) {
      res
        .status(503)
        .send(
          renderFriendlyLtiErrorHtml(
            'Tính năng kết nối OPEN-EDU (LTI) hiện đang tắt do máy chủ chưa cấu hình đủ biến môi trường LTI.'
          )
        );
      return;
    }

    if (!idToken || !state) {
      res.status(400).send(renderFriendlyLtiErrorHtml());
      return;
    }

    try {
      const jwks = getRemoteJwks(cfg.jwksUri);
      const { payload } = await jwtVerify(idToken, jwks, {
        algorithms: ['RS256'],
        issuer: cfg.issuer,
        audience: cfg.clientId,
      });

      const validation = validateLtiLaunchClaims(payload, cfg);
      if (!validation.ok) {
        console.warn('[LTI launch claim rejected]', validation.reason);
        res.status(400).send(renderFriendlyLtiErrorHtml());
        return;
      }

      const claims = validation.claims;
      const sql = getSql();

      // Atomic one-time consumption of (state, nonce) in banviet.lti_nonces
      const consumed = await sql<Array<{ nonce: string }>>`
        UPDATE banviet.lti_nonces
        SET used_at = NOW()
        WHERE state = ${state}
          AND nonce = ${claims.nonce}
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING nonce
      `;

      if (consumed.length === 0) {
        console.warn('[LTI launch nonce replay or expired]');
        res.status(400).send(renderFriendlyLtiErrorHtml());
        return;
      }

      const hintedParentOrigin = consumeLtiLoginParentOrigin(state, cfg.allowedFrameOrigins);

      // Instructor Launch
      if (claims.isInstructor) {
        let teacherId: string;
        const existingTeachers = await sql<Array<{ id: string; display_name: string | null }>>`
          SELECT id, display_name
          FROM banviet.teachers
          WHERE openedu_user_id = ${claims.sub}
          LIMIT 1
        `;

        if (existingTeachers.length > 0) {
          teacherId = existingTeachers[0].id;
        } else {
          // Do NOT store email from LTI
          const inserted = await sql<Array<{ id: string }>>`
            INSERT INTO banviet.teachers (openedu_user_id, display_name)
            VALUES (${claims.sub}, ${claims.displayName})
            RETURNING id
          `;
          teacherId = inserted[0].id;
        }

        if (claims.contextId) {
          const cls = await ensureClassForOpenEdu({
            openEduClassId: claims.contextId,
            classTitle: claims.contextTitle,
            realTeacherId: teacherId,
          });
          if (claims.resourceLinkId) {
            await ensureAssignmentForOpenEdu({
              classId: cls.id,
              resourceLinkId: claims.resourceLinkId,
              title: claims.resourceLinkTitle,
              description: claims.resourceLinkDescription,
              lineitemUrl: claims.lineitemUrl,
            });
          }
        }

        const token = createSessionToken({
          role: 'teacher',
          sub: teacherId,
          displayName: claims.displayName,
          lti: true,
          openeduSub: claims.sub,
          xapiEndpoint: claims.xapiEndpoint,
        });

        res.send(
          renderLaunchHandoffHtml({
            token,
            role: 'teacher',
            targetPath: '/giao-vien',
            allowedOrigins: cfg.allowedFrameOrigins,
            hintedParentOrigin,
          })
        );
        return;
      }

      // Learner (Student) Launch
      const effectiveContextId = claims.contextId || `openedu-default-${cfg.deploymentId}`;
      const cls = await ensureClassForOpenEdu({
        openEduClassId: effectiveContextId,
        classTitle: claims.contextTitle,
      });

      const student = await ensureStudentForOpenEdu({
        classId: cls.id,
        openEduUserId: claims.sub,
        givenName: claims.givenName,
      });

      let launchAssignmentId: string | null = null;
      if (claims.resourceLinkId) {
        const assignment = await ensureAssignmentForOpenEdu({
          classId: cls.id,
          resourceLinkId: claims.resourceLinkId,
          title: claims.resourceLinkTitle,
          description: claims.resourceLinkDescription,
          lineitemUrl: claims.lineitemUrl,
        });
        launchAssignmentId = assignment.id;

        await sql`
          INSERT INTO banviet.submissions (assignment_id, student_id, current_step)
          VALUES (${assignment.id}, ${student.id}, 1)
          ON CONFLICT (assignment_id, student_id) DO NOTHING
        `;
      }

      const token = createSessionToken({
        role: 'student',
        sub: student.id,
        classId: cls.id,
        displayName: student.nickname,
        lti: true,
        openeduSub: claims.sub,
        xapiEndpoint: claims.xapiEndpoint,
      });

      res.send(
        renderLaunchHandoffHtml({
          token,
          role: 'student',
          targetPath: '/',
          launchAssignmentId,
          allowedOrigins: cfg.allowedFrameOrigins,
          hintedParentOrigin,
        })
      );
    } catch (err) {
      console.error('[LTI /lti/launch verification error]', err);
      res.status(400).send(renderFriendlyLtiErrorHtml());
    }
  });

  return router;
}
