import crypto from 'crypto';
import { SignJWT, importJWK, type JWK } from 'jose';

export interface PublicRsaJwk {
  kty: 'RSA';
  n: string;
  e: string;
  alg: 'RS256';
  use: 'sig';
  kid: string;
}

/**
 * Extracts strictly public RSA fields from a private or public JWK.
 * Guarantees private key material (d, p, q, dp, dq, qi, oth) is NEVER exposed.
 */
export function extractPublicRsaJwk(rawJwk: Record<string, unknown>): PublicRsaJwk {
  if (rawJwk.kty !== 'RSA' || typeof rawJwk.n !== 'string' || typeof rawJwk.e !== 'string') {
    throw new Error('TOOL_PRIVATE_JWK không phải khóa RSA JWK hợp lệ.');
  }
  const kid =
    typeof rawJwk.kid === 'string' && rawJwk.kid.trim()
      ? rawJwk.kid.trim()
      : crypto
          .createHash('sha256')
          .update(`${rawJwk.n}.${rawJwk.e}`)
          .digest('base64url')
          .slice(0, 16);

  return {
    kty: 'RSA',
    n: rawJwk.n,
    e: rawJwk.e,
    alg: 'RS256',
    use: 'sig',
    kid,
  };
}

export function parseToolPrivateJwk(rawJson?: string): {
  privateJwk: JWK;
  publicJwk: PublicRsaJwk;
} {
  const source = (rawJson ?? process.env.TOOL_PRIVATE_JWK ?? '').trim();
  if (!source) {
    throw new Error('Chưa cấu hình TOOL_PRIVATE_JWK trong Secrets của máy chủ.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    throw new Error('TOOL_PRIVATE_JWK không phải định dạng JSON hợp lệ.');
  }

  if (typeof parsed.d !== 'string' || !parsed.d) {
    throw new Error('TOOL_PRIVATE_JWK thiếu tham số khóa bí mật (d).');
  }

  const publicJwk = extractPublicRsaJwk(parsed);
  const privateJwk: JWK = {
    ...(parsed as JWK),
    alg: 'RS256',
    kid: publicJwk.kid,
  };

  return { privateJwk, publicJwk };
}

export function getPublicJwks(rawJson?: string): { keys: PublicRsaJwk[] } {
  const source = (rawJson ?? process.env.TOOL_PRIVATE_JWK ?? '').trim();
  if (!source) {
    return { keys: [] };
  }
  const { publicJwk } = parseToolPrivateJwk(source);
  return { keys: [publicJwk] };
}

/**
 * Signs an LTI 1.3 OAuth2 client_assertion JWT (RS256) using TOOL_PRIVATE_JWK.
 * Claims: iss = sub = clientId, aud = tokenEndpoint, exp = 5 minutes, random jti.
 */
export async function signClientAssertionJwt(params: {
  clientId: string;
  tokenEndpoint: string;
  rawPrivateJwk?: string;
  nowSec?: number;
}): Promise<string> {
  const { privateJwk, publicJwk } = parseToolPrivateJwk(params.rawPrivateJwk);
  const signingKey = await importJWK(privateJwk, 'RS256');
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: publicJwk.kid })
    .setIssuer(params.clientId)
    .setSubject(params.clientId)
    .setAudience(params.tokenEndpoint)
    .setIssuedAt(now)
    .setExpirationTime(now + 300) // 5 minutes
    .setJti(crypto.randomUUID())
    .sign(signingKey);
}
