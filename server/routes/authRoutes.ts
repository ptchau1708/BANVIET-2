import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import {
  MAX_FAILED_PIN_ATTEMPTS,
  PIN_LOCKOUT_MINUTES,
  createOAuthState,
  createSessionToken,
  isValidJoinCode,
  isValidPin4,
  isValidUuid,
  normalizeJoinCode,
  verifyOAuthState,
} from '../auth.ts';
import { formatDatabaseError, getSql, isDatabaseConfigured } from '../db.ts';
import { getAppEnvMode, getLtiConfig, isLtiEnabled } from '../ltiConfig.ts';

function getAppBaseUrl(req: Request): string {
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

function renderOAuthResultHtml(payload: Record<string, unknown>, fallbackText: string): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <title>Đăng nhập Bạn Viết</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; background: #F6FAF7; color: #1C2A24; text-align: center; }
      .box { max-width: 420px; margin: 48px auto; background: #fff; border: 1px solid #DDE7E2; border-radius: 16px; padding: 24px; }
    </style>
  </head>
  <body>
    <div class="box">
      <p>${escapeHtml(fallbackText)}</p>
    </div>
    <script>
      (function () {
        var msg = ${safeJson};
        if (window.opener) {
          window.opener.postMessage(msg, window.location.origin);
          setTimeout(function () { window.close(); }, 300);
        } else if (msg.type === 'BANVIET_GOOGLE_AUTH_SUCCESS' && msg.token) {
          try {
            sessionStorage.setItem('banviet_session_token', msg.token);
            sessionStorage.setItem('banviet_session_role', 'teacher');
          } catch (e) {}
          window.location.href = '/giao-vien';
        }
      })();
    </script>
  </body>
</html>`;
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/api/auth/config', (_req: Request, res: Response) => {
    const googleConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
    );
    const ltiCfg = getLtiConfig();
    res.json({
      appEnv: getAppEnvMode(),
      databaseConfigured: isDatabaseConfigured(),
      googleConfigured,
      ltiEnabled: isLtiEnabled(),
      openEduWebOrigin: ltiCfg.openEduWebOrigin,
      openEduTeacherOrigin: ltiCfg.openEduTeacherOrigin,
      openEduAllowedOrigins: ltiCfg.allowedFrameOrigins,
    });
  });

  // Teacher Google OAuth Step 1: Return Google provider authorization URL directly
  router.get('/api/auth/google/url', (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.status(503).json({
        error:
          'Chưa cấu hình GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong Secrets của máy chủ.',
      });
      return;
    }

    const redirectUri = `${getAppBaseUrl(req)}/auth/google/callback`;
    const state = createOAuthState(redirectUri);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });

    res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
    });
  });

  // Teacher Google OAuth Step 2: Callback (both with and without trailing slash)
  const handleGoogleCallback = async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    if (typeof error === 'string' && error) {
      res
        .status(400)
        .send(
          renderOAuthResultHtml(
            {
              type: 'BANVIET_GOOGLE_AUTH_ERROR',
              error: 'Đăng nhập Google đã bị hủy hoặc từ chối.',
            },
            'Đăng nhập Google đã bị hủy. Bạn có thể đóng cửa sổ này.'
          )
        );
      return;
    }

    if (typeof code !== 'string' || typeof state !== 'string') {
      res
        .status(400)
        .send(
          renderOAuthResultHtml(
            { type: 'BANVIET_GOOGLE_AUTH_ERROR', error: 'Thiếu mã xác thực từ Google.' },
            'Thiếu mã xác thực từ Google.'
          )
        );
      return;
    }

    const verifiedState = verifyOAuthState(state);
    if (!verifiedState) {
      res
        .status(400)
        .send(
          renderOAuthResultHtml(
            {
              type: 'BANVIET_GOOGLE_AUTH_ERROR',
              error: 'Phiên xác thực Google đã hết hạn. Vui lòng bấm đăng nhập lại.',
            },
            'Phiên xác thực đã hết hạn. Vui lòng thử lại.'
          )
        );
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res
        .status(503)
        .send(
          renderOAuthResultHtml(
            { type: 'BANVIET_GOOGLE_AUTH_ERROR', error: 'Máy chủ chưa cấu hình Google OAuth.' },
            'Máy chủ chưa cấu hình Google OAuth.'
          )
        );
      return;
    }

    try {
      // Exchange authorization code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: verifiedState.redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson.error_description || 'Không đổi được mã xác thực Google.');
      }

      // Fetch verified user profile from Google OpenID Connect userinfo
      const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });

      const profile = (await userRes.json()) as {
        sub?: string;
        email?: string;
        name?: string;
      };

      if (!userRes.ok || !profile.sub) {
        throw new Error('Không lấy được thông tin tài khoản Google.');
      }

      const sql = getSql();
      const googleSub = profile.sub;
      const email = (profile.email ?? '').trim().slice(0, 200);
      const displayName = (profile.name ?? email ?? 'Giáo viên').trim().slice(0, 120);

      // Upsert teacher in banviet.teachers by google_sub
      const existing = await sql<
        Array<{ id: string; email: string | null; display_name: string | null }>
      >`
        SELECT id, email, display_name
        FROM banviet.teachers
        WHERE google_sub = ${googleSub}
        LIMIT 1
      `;

      let teacherId: string;
      let finalName = displayName;
      let finalEmail = email;

      if (existing.length > 0) {
        teacherId = existing[0].id;
        await sql`
          UPDATE banviet.teachers
          SET email = ${email || existing[0].email},
              display_name = ${displayName || existing[0].display_name}
          WHERE id = ${teacherId}
        `;
      } else {
        const inserted = await sql<Array<{ id: string }>>`
          INSERT INTO banviet.teachers (google_sub, email, display_name)
          VALUES (${googleSub}, ${email}, ${displayName})
          RETURNING id
        `;
        teacherId = inserted[0].id;
      }

      const sessionToken = createSessionToken({
        role: 'teacher',
        sub: teacherId,
        displayName: finalName,
      });

      res.send(
        renderOAuthResultHtml(
          {
            type: 'BANVIET_GOOGLE_AUTH_SUCCESS',
            token: sessionToken,
            teacher: {
              id: teacherId,
              email: finalEmail,
              displayName: finalName,
            },
          },
          'Đăng nhập thành công! Cửa sổ này sẽ tự đóng lại.'
        )
      );
    } catch (err) {
      console.error('[Google OAuth callback error]', err);
      const formatted = formatDatabaseError(err);
      const msg =
        err instanceof Error && formatted.status === 500 ? err.message : formatted.message;
      res
        .status(500)
        .send(
          renderOAuthResultHtml(
            { type: 'BANVIET_GOOGLE_AUTH_ERROR', error: msg },
            `Không thể hoàn tất đăng nhập: ${msg}`
          )
        );
    }
  };

  router.get(['/auth/google/callback', '/auth/google/callback/'], handleGoogleCallback);

  // Student Login Step 1: Lookup class by 6-char join_code and list student nicknames
  router.post('/api/auth/student/class-lookup', async (req: Request, res: Response) => {
    const code = normalizeJoinCode(req.body?.joinCode);
    if (!isValidJoinCode(code)) {
      res.status(400).json({
        error: 'Mã lớp gồm đúng 6 chữ cái hoặc số (ví dụ: AB12CD). Em kiểm tra lại nhé!',
      });
      return;
    }

    try {
      const sql = getSql();
      const classes = await sql<
        Array<{ id: string; name: string; join_code: string }>
      >`
        SELECT id, name, join_code
        FROM banviet.classes
        WHERE UPPER(join_code) = ${code}
        LIMIT 1
      `;

      if (classes.length === 0) {
        res.status(404).json({
          error: 'Không tìm thấy lớp có mã này. Em xem lại phiếu đăng nhập cô giáo phát nhé!',
        });
        return;
      }

      const cls = classes[0];
      const students = await sql<Array<{ id: string; nickname: string }>>`
        SELECT id, nickname
        FROM banviet.students
        WHERE class_id = ${cls.id}
        ORDER BY nickname ASC
      `;

      res.json({
        classId: cls.id,
        className: cls.name,
        joinCode: cls.join_code,
        students,
      });
    } catch (err) {
      console.error('[Student class lookup error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Student Login Step 2: Verify 4-digit PIN with bcrypt + 5-failure 10-min lockout
  router.post('/api/auth/student/login', async (req: Request, res: Response) => {
    const { classId, studentId, pin } = req.body ?? {};
    if (!isValidUuid(classId) || !isValidUuid(studentId)) {
      res.status(400).json({ error: 'Vui lòng chọn đúng lớp và biệt danh của em.' });
      return;
    }
    if (!isValidPin4(pin)) {
      res.status(400).json({ error: 'Mã PIN gồm đúng 4 chữ số. Em nhập lại nhé!' });
      return;
    }

    try {
      const sql = getSql();
      const rows = await sql<
        Array<{
          id: string;
          class_id: string;
          nickname: string;
          pin_hash: string | null;
          failed_pin: number | null;
          locked_until: Date | string | null;
          class_name: string;
        }>
      >`
        SELECT s.id, s.class_id, s.nickname, s.pin_hash, s.failed_pin, s.locked_until, c.name AS class_name
        FROM banviet.students s
        JOIN banviet.classes c ON c.id = s.class_id
        WHERE s.id = ${studentId} AND s.class_id = ${classId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        res.status(401).json({ error: 'Không tìm thấy tài khoản học sinh trong lớp này.' });
        return;
      }

      const student = rows[0];

      // Check active 10-minute lockout
      if (student.locked_until) {
        const lockTime = new Date(student.locked_until).getTime();
        const now = Date.now();
        if (lockTime > now) {
          const remainMin = Math.max(1, Math.ceil((lockTime - now) / 60000));
          res.status(423).json({
            error: `Em đã nhập sai PIN 5 lần nên tài khoản đang tạm khóa khoảng ${remainMin} phút. Em chờ một chút hoặc nhờ cô giáo đặt lại PIN nhé!`,
          });
          return;
        }
      }

      if (!student.pin_hash) {
        res.status(403).json({
          error: 'Tài khoản này chưa được đặt mã PIN. Em nhờ thầy/cô đặt PIN giúp nhé!',
        });
        return;
      }

      const match = await bcrypt.compare(pin.trim(), student.pin_hash);
      if (!match) {
        const currentFailed = Number(student.failed_pin ?? 0);
        // If previous lockout already expired, restart failure counter from 1
        const prevLockExpired =
          student.locked_until && new Date(student.locked_until).getTime() <= Date.now();
        const nextFailed = prevLockExpired ? 1 : currentFailed + 1;

        if (nextFailed >= MAX_FAILED_PIN_ATTEMPTS) {
          await sql`
            UPDATE banviet.students
            SET failed_pin = ${nextFailed},
                locked_until = NOW() + (${PIN_LOCKOUT_MINUTES} * INTERVAL '1 minute')
            WHERE id = ${student.id}
          `;
          res.status(423).json({
            error: `Em nhập sai PIN ${MAX_FAILED_PIN_ATTEMPTS} lần liên tiếp. Tài khoản tạm khóa ${PIN_LOCKOUT_MINUTES} phút, em hãy nghỉ một chút hoặc nhờ thầy/cô đặt lại PIN nhé!`,
          });
          return;
        }

        await sql`
          UPDATE banviet.students
          SET failed_pin = ${nextFailed},
              locked_until = NULL
          WHERE id = ${student.id}
        `;
        const left = MAX_FAILED_PIN_ATTEMPTS - nextFailed;
        res.status(401).json({
          error: `Mã PIN chưa đúng. Em còn ${left} lần thử nữa nhé!`,
        });
        return;
      }

      // Reset failed_pin & locked_until on successful login
      await sql`
        UPDATE banviet.students
        SET failed_pin = 0, locked_until = NULL
        WHERE id = ${student.id}
      `;

      const token = createSessionToken({
        role: 'student',
        sub: student.id,
        classId: student.class_id,
        displayName: student.nickname,
      });

      res.json({
        token,
        student: {
          id: student.id,
          nickname: student.nickname,
          classId: student.class_id,
          className: student.class_name,
        },
      });
    } catch (err) {
      console.error('[Student login error]', err);
      const formatted = formatDatabaseError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  return router;
}
