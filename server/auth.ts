import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
export const MAX_FAILED_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MINUTES = 10;

export type UserRole = 'teacher' | 'student';

export interface SessionPayload {
  role: UserRole;
  sub: string; // teacher.id or student.id (UUID)
  classId?: string; // present for student tokens
  displayName: string;
  lti?: boolean;
  openeduSub?: string;
  xapiEndpoint?: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: SessionPayload;
    }
  }
}

let fallbackSecret: string | null = null;

function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (!fallbackSecret) {
    fallbackSecret = crypto.randomBytes(32).toString('hex');
  }
  return fallbackSecret;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
}

function signHmac(data: string, secret: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(data).digest());
}

export function createSessionToken(
  claims: Omit<SessionPayload, 'iat' | 'exp'>,
  nowMs = Date.now(),
  secretOverride?: string
): string {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const payload: SessionPayload = { ...claims, iat, exp };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signHmac(encodedPayload, secretOverride ?? getSessionSecret());
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  nowMs = Date.now(),
  secretOverride?: string
): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSig] = parts;
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = signHmac(encodedPayload, secretOverride ?? getSessionSecret());
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (
      (parsed.role !== 'teacher' && parsed.role !== 'student') ||
      typeof parsed.sub !== 'string' ||
      !parsed.sub ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createOAuthState(redirectUri: string, nowMs = Date.now()): string {
  const payload = {
    nonce: crypto.randomBytes(12).toString('hex'),
    redirectUri,
    exp: Math.floor(nowMs / 1000) + 600, // 10 min
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = signHmac(`oauth:${encoded}`, getSessionSecret());
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string, nowMs = Date.now()): { redirectUri: string } | null {
  if (!state || typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = signHmac(`oauth:${encoded}`, getSessionSecret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as {
      redirectUri?: string;
      exp?: number;
    };
    if (!parsed.redirectUri || typeof parsed.exp !== 'number') return null;
    if (Math.floor(nowMs / 1000) >= parsed.exp) return null;
    return { redirectUri: parsed.redirectUri };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' });
    return;
  }
  req.auth = payload;
  next();
}

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
      return;
    }
    if (req.auth.role !== role) {
      res.status(403).json({
        error:
          role === 'teacher'
            ? 'Chức năng này chỉ dành cho tài khoản giáo viên.'
            : 'Chức năng này chỉ dành cho tài khoản học sinh.',
      });
      return;
    }
    next();
  };
}

const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateJoinCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_CHARS[bytes[i] % JOIN_CODE_CHARS.length];
  }
  return code;
}

export function normalizeJoinCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidJoinCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

export function generatePin4(): string {
  const num = crypto.randomInt(0, 10000);
  return String(num).padStart(4, '0');
}

export function isValidPin4(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}$/.test(raw.trim());
}

export function parseBulkNicknames(rawText: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > 40) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
    if (result.length >= 100) break;
  }
  return result;
}

const SAFETY_PATTERNS: RegExp[] = [
  /\bbị\s+(đánh|đập|bắt\s+nạt|hành\s+hạ|làm\s+đau|bỏ\s+đói|nhốt|dọa|đe\s+dọa|xâm\s+hại)/i,
  /\blàm\s+đau\b/i,
  /\btự\s+(làm\s+đau|hại|tử|sát)\b/i,
  /\bmuốn\s+chết\b/i,
  /\bkhông\s+muốn\s+sống\b/i,
  /\bsợ\s+(hãi|lắm|quá|bị\s+đánh|về\s+nhà)\b/i,
  /\bbuồn\s+(lắm|quá|nhiều|rất\s+nhiều|khóc)\b/i,
  /\bkhóc\s+(nhiều|hoài|mãi|suốt)\b/i,
  /\bđánh\s+(em|mình|con|đập)\b/i,
  /\bcô\s+đơn\s+(quá|lắm)\b/i,
  /\bbỏ\s+nhà\s+đi\b/i,
];

/**
 * Detects signs of emotional distress, fear, bullying, or physical/emotional harm
 * in a student's message so the AI event is flagged for the teacher.
 */
export function detectSafetyFlag(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.normalize('NFC');
  return SAFETY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isValidUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
