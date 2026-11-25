import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from 'jose';
import {
  DEFAULT_LTI_ISSUER,
  LTI_CLAIMS,
  buildFrameAncestorsCsp,
  getAppEnvMode,
  getCspHeaderForEnv,
  getLtiConfig,
  getLtiSecretStatus,
  isLtiEnabled,
  isProductionAppEnv,
  isTrustedPlatformServiceUrl,
  type LtiPlatformConfig,
} from './ltiConfig.ts';
import {
  extractPublicRsaJwk,
  getPublicJwks,
  signClientAssertionJwt,
} from './ltiKeys.ts';
import {
  buildAgsScorePayload,
  buildScoresUrl,
  buildXapiStatementPayload,
  sumTeacherRubricScore,
} from './ltiServices.ts';
import { getOutboxBackoffMinutes } from './outbox.ts';
import { validateLtiLaunchClaims } from './routes/ltiRoutes.ts';

const TEST_CFG: LtiPlatformConfig = {
  issuer: DEFAULT_LTI_ISSUER,
  jwksUri: `${DEFAULT_LTI_ISSUER}/jwks`,
  tokenEndpoint: `${DEFAULT_LTI_ISSUER}/token`,
  openEduWebOrigin: 'https://open-edu.vn',
  openEduTeacherOrigin: 'https://teacher.open-edu.vn',
  allowedFrameOrigins: ['https://open-edu.vn', 'https://teacher.open-edu.vn'],
  authorizationEndpoint: 'https://open-edu.vn/lti/auth',
  clientId: 'banviet-client-123',
  deploymentId: '1',
};

test('extractPublicRsaJwk strips all private RSA parameters and signClientAssertionJwt verifies via RS256', async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  privateJwk.kid = 'banviet-key-1';
  const rawPrivateJson = JSON.stringify(privateJwk);

  const jwks = getPublicJwks(rawPrivateJson);
  assert.equal(jwks.keys.length, 1);
  const pub = jwks.keys[0] as unknown as Record<string, unknown>;
  assert.equal(pub.kty, 'RSA');
  assert.equal(pub.alg, 'RS256');
  assert.equal(pub.use, 'sig');
  assert.equal(pub.kid, 'banviet-key-1');
  assert.ok(typeof pub.n === 'string' && pub.n.length > 50);
  assert.ok(typeof pub.e === 'string');

  // Verify private material is strictly absent
  for (const secretField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
    assert.equal(pub[secretField], undefined, `Public JWK must not expose ${secretField}`);
  }

  // Sign client_assertion and verify with extracted public key
  const nowSec = Math.floor(Date.now() / 1000);
  const assertion = await signClientAssertionJwt({
    clientId: TEST_CFG.clientId,
    tokenEndpoint: TEST_CFG.tokenEndpoint,
    rawPrivateJwk: rawPrivateJson,
    nowSec,
  });

  const publicKey = await importJWK(extractPublicRsaJwk(privateJwk), 'RS256');
  const verified = await jwtVerify(assertion, publicKey, {
    algorithms: ['RS256'],
    issuer: TEST_CFG.clientId,
    subject: TEST_CFG.clientId,
    audience: TEST_CFG.tokenEndpoint,
  });

  assert.equal(verified.protectedHeader.alg, 'RS256');
  assert.equal(verified.protectedHeader.kid, 'banviet-key-1');
  assert.equal(verified.payload.exp, nowSec + 300);
  assert.ok(typeof verified.payload.jti === 'string' && verified.payload.jti.length >= 16);
});

test('validateLtiLaunchClaims validates RS256 LTI 1.3 payload, maps given_name, ignores email, and blocks bad claims', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const studentSub = '11111111-2222-4333-8444-555555555555';
  const lineitemUrl = `${DEFAULT_LTI_ISSUER}/ags/class-5a/lineitems/item-9`;
  const xapiUrl = `${DEFAULT_LTI_ISSUER}/xapi/statements`;

  const idToken = await new SignJWT({
    nonce: 'nonce-abc-123',
    given_name: 'Bé Gấu',
    name: 'Nguyễn Bé Gấu',
    email: 'begau@openlms.edu',
    [LTI_CLAIMS.MESSAGE_TYPE]: 'LtiResourceLinkRequest',
    [LTI_CLAIMS.VERSION]: '1.3.0',
    [LTI_CLAIMS.DEPLOYMENT_ID]: '1',
    [LTI_CLAIMS.ROLES]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    [LTI_CLAIMS.CONTEXT]: { id: 'class-5a', label: 'Lớp 5A' },
    [LTI_CLAIMS.RESOURCE_LINK]: { id: 'rl-bai-1', title: 'Tả bà nội của em' },
    [LTI_CLAIMS.AGS_ENDPOINT]: { lineitem: lineitemUrl },
    [LTI_CLAIMS.OPENEDU_XAPI]: { endpoint: xapiUrl },
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(TEST_CFG.issuer)
    .setAudience(TEST_CFG.clientId)
    .setSubject(studentSub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  const { payload } = await jwtVerify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: TEST_CFG.issuer,
    audience: TEST_CFG.clientId,
  });

  const valid = validateLtiLaunchClaims(payload, TEST_CFG);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.claims.sub, studentSub);
    assert.equal(valid.claims.isInstructor, false);
    assert.equal(valid.claims.givenName, 'Bé Gấu');
    assert.equal(valid.claims.contextId, 'class-5a');
    assert.equal(valid.claims.resourceLinkId, 'rl-bai-1');
    assert.equal(valid.claims.lineitemUrl, lineitemUrl);
    assert.equal(valid.claims.xapiEndpoint, xapiUrl);
    // Email is never carried on ParsedLtiLaunchClaims
    assert.equal('email' in valid.claims, false);
  }

  // Wrong deployment_id -> rejected
  const wrongDeploy = validateLtiLaunchClaims(
    { ...payload, [LTI_CLAIMS.DEPLOYMENT_ID]: '999' },
    TEST_CFG
  );
  assert.equal(wrongDeploy.ok, false);

  // Wrong version -> rejected
  const wrongVersion = validateLtiLaunchClaims(
    { ...payload, [LTI_CLAIMS.VERSION]: '1.1.0' },
    TEST_CFG
  );
  assert.equal(wrongVersion.ok, false);

  // Untrusted SSRF lineitem URL is discarded
  const evilLineitem = validateLtiLaunchClaims(
    {
      ...payload,
      [LTI_CLAIMS.AGS_ENDPOINT]: { lineitem: 'http://169.254.169.254/latest/meta-data' },
    },
    TEST_CFG
  );
  assert.equal(evilLineitem.ok, true);
  if (evilLineitem.ok) {
    assert.equal(evilLineitem.claims.lineitemUrl, null);
  }
});

test('AGS score payload sums 5 rubric criteria out of 15 and appends /scores safely', () => {
  const total = sumTeacherRubricScore({
    boCuc: 3,
    ngoaiHinh: 3,
    tinhTinhHoatDong: 2,
    camXuc: 3,
    dungTuChinhTa: 2,
  });
  assert.equal(total, 13);

  const ags = buildAgsScorePayload({
    lineitemUrl: `${DEFAULT_LTI_ISSUER}/ags/c1/lineitems/li1`,
    openEduSub: '11111111-2222-4333-8444-555555555555',
    scoreGiven: total,
  });
  assert.equal(ags.score.scoreGiven, 13);
  assert.equal(ags.score.scoreMaximum, 15);
  assert.equal(ags.score.activityProgress, 'Completed');
  assert.equal(ags.score.gradingProgress, 'FullyGraded');
  assert.equal(
    buildScoresUrl(ags.lineitemUrl),
    `${DEFAULT_LTI_ISSUER}/ags/c1/lineitems/li1/scores`
  );
});

test('xAPI statement uses expected object.id, metrics extensions, and never leaks essay text', () => {
  const xapi = buildXapiStatementPayload({
    endpoint: `${DEFAULT_LTI_ISSUER}/xapi/statements`,
    issuer: DEFAULT_LTI_ISSUER,
    appBaseUrl: 'https://banviet.example.com/',
    openEduSub: '11111111-2222-4333-8444-555555555555',
    assignmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    step: 4,
    verbKind: 'completed',
    metrics: {
      outline_details: 8,
      draft_words: 145,
      revised_words: 170,
      edits_count: 6,
      ai_calls: 5,
      feedback_rounds: 2,
      minutes_spent: 18,
    },
  });

  const stmt = xapi.statement as Record<string, unknown>;
  const obj = stmt.object as Record<string, unknown>;
  assert.equal(
    obj.id,
    'https://banviet.example.com/bai/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/buoc/4'
  );
  const actor = stmt.actor as { account: { name: string } };
  assert.equal(actor.account.name, '11111111-2222-4333-8444-555555555555');
  const serialized = JSON.stringify(stmt);
  assert.equal(serialized.includes('draft_text'), false);
  assert.equal(serialized.includes('revised_text'), false);
  assert.equal(serialized.includes('"outline_details":8'), true);
});

test('outbox retry schedule, CSP frame-ancestors, SSRF allowlist, and secret status work accurately', () => {
  assert.equal(getOutboxBackoffMinutes(1), 1);
  assert.equal(getOutboxBackoffMinutes(2), 5);
  assert.equal(getOutboxBackoffMinutes(3), 30);
  assert.equal(getOutboxBackoffMinutes(4), 120);
  assert.equal(getOutboxBackoffMinutes(9), 120);

  // Non-production (AI Studio preview / testing): MUST omit frame-ancestors CSP completely
  assert.equal(isProductionAppEnv({}), false);
  assert.equal(getAppEnvMode({}), 'testing');
  assert.equal(
    getCspHeaderForEnv({
      OPENEDU_WEB_ORIGIN: 'https://open-edu.vn',
      OPENEDU_TEACHER_ORIGIN: 'https://teacher.open-edu.vn',
    }),
    null
  );
  assert.equal(
    getCspHeaderForEnv({
      APP_ENV: 'staging',
      OPENEDU_WEB_ORIGIN: 'https://open-edu.vn',
    }),
    null
  );

  // Production (APP_ENV=production): ONLY 'self' + OPENEDU_WEB_ORIGIN + OPENEDU_TEACHER_ORIGIN (NO AI Studio, NO '*')
  assert.equal(isProductionAppEnv({ APP_ENV: 'production' }), true);
  assert.equal(getAppEnvMode({ APP_ENV: 'production' }), 'production');
  const prodCsp = getCspHeaderForEnv({
    APP_ENV: 'production',
    OPENEDU_WEB_ORIGIN: 'https://open-edu.vn/student',
    OPENEDU_TEACHER_ORIGIN: 'https://teacher.open-edu.vn/portal/',
  });
  assert.equal(
    prodCsp,
    "frame-ancestors 'self' https://open-edu.vn https://teacher.open-edu.vn"
  );
  assert.equal(prodCsp!.includes('*'), false);
  assert.equal(prodCsp!.includes('aistudio'), false);
  assert.equal(prodCsp!.includes('ai.studio'), false);

  // Deduplicates identical origins and strictly rejects '*' or non-http(s) schemes
  assert.equal(
    buildFrameAncestorsCsp([
      'https://open-edu.vn/',
      'https://open-edu.vn/other',
      '*',
      'https://*.evil.com',
      'javascript:alert(1)',
    ]),
    "frame-ancestors 'self' https://open-edu.vn"
  );
  assert.equal(buildFrameAncestorsCsp(['*', 'javascript:alert(1)']), "frame-ancestors 'self'");

  // isLtiEnabled returns false gracefully when LTI secrets are missing
  assert.equal(isLtiEnabled({}), false);
  assert.equal(isLtiEnabled({ OPENEDU_WEB_ORIGIN: 'https://open-edu.vn' }), false);
  assert.equal(
    isLtiEnabled({
      OPENEDU_WEB_ORIGIN: 'https://open-edu.vn',
      LTI_CLIENT_ID: 'cid',
      LTI_DEPLOYMENT_ID: '1',
    }),
    true
  );

  // OIDC authorization endpoint MUST remain OPENEDU_WEB_ORIGIN/lti/auth even when OPENEDU_TEACHER_ORIGIN is set
  const dualCfg = getLtiConfig({
    OPENEDU_WEB_ORIGIN: 'https://web.open-edu.vn/home',
    OPENEDU_TEACHER_ORIGIN: 'https://teacher.open-edu.vn/dashboard',
    LTI_CLIENT_ID: 'cid',
    LTI_DEPLOYMENT_ID: '1',
  });
  assert.equal(dualCfg.openEduWebOrigin, 'https://web.open-edu.vn');
  assert.equal(dualCfg.openEduTeacherOrigin, 'https://teacher.open-edu.vn');
  // allowedFrameOrigins for OPEN-EDU postMessage NEVER includes AI Studio origins
  assert.deepEqual(dualCfg.allowedFrameOrigins, [
    'https://web.open-edu.vn',
    'https://teacher.open-edu.vn',
  ]);
  assert.equal(dualCfg.authorizationEndpoint, 'https://web.open-edu.vn/lti/auth');

  assert.equal(
    isTrustedPlatformServiceUrl(`${DEFAULT_LTI_ISSUER}/ags/123/lineitems/456`, DEFAULT_LTI_ISSUER),
    true
  );
  assert.equal(
    isTrustedPlatformServiceUrl('https://evil.example.com/functions/v1/lti/ags', DEFAULT_LTI_ISSUER),
    false
  );
  assert.equal(
    isTrustedPlatformServiceUrl('http://127.0.0.1:5432/lti', DEFAULT_LTI_ISSUER),
    false
  );

  const secretCheck = getLtiSecretStatus({
    LTI_CLIENT_ID: 'cid',
    LTI_DEPLOYMENT_ID: '1',
    OPENEDU_WEB_ORIGIN: 'https://open-edu.vn',
    OPENEDU_TEACHER_ORIGIN: 'https://teacher.open-edu.vn',
    TOOL_PRIVATE_JWK: '{"kty":"RSA","n":"abc","e":"AQAB","d":"xyz"}',
    DATABASE_URL: 'postgres://test',
    SESSION_SECRET: '0123456789abcdef',
  });
  assert.equal(secretCheck.allReady, true);
  assert.equal(secretCheck.OPENEDU_WEB_ORIGIN, true);
  assert.equal(secretCheck.OPENEDU_TEACHER_ORIGIN, true);
  assert.equal(secretCheck.TOOL_PRIVATE_JWK, true);
});
