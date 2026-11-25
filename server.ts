import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAiRouter } from './server/routes/aiRoutes.ts';
import { createAuthRouter } from './server/routes/authRoutes.ts';
import { createLtiRouter } from './server/routes/ltiRoutes.ts';
import { createStudentRouter } from './server/routes/studentRoutes.ts';
import { createTeacherRouter } from './server/routes/teacherRoutes.ts';
import {
  getAppEnvMode,
  getCspHeaderForEnv,
  isLtiEnabled,
} from './server/ltiConfig.ts';
import { isDatabaseConfigured } from './server/db.ts';
import { startLtiBackgroundWorkers } from './server/outbox.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Never emit X-Frame-Options.
// Only send CSP frame-ancestors (with OPENEDU_WEB_ORIGIN & OPENEDU_TEACHER_ORIGIN) when APP_ENV=production.
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  const csp = getCspHeaderForEnv();
  if (csp) {
    res.setHeader('Content-Security-Policy', csp);
  } else {
    res.removeHeader('Content-Security-Policy');
  }
  next();
});

// Lightweight Render health check (never touches PostgreSQL)
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).type('text/plain').send('ok');
});

// Mount LTI 1.3 Tool endpoints (/.well-known/jwks.json, /lti/jwks, /lti/login, /lti/launch)
app.use(createLtiRouter());

// Mount authentication, student, teacher, and strictly scoped 3 AI routes
app.use(createAuthRouter());
app.use(createStudentRouter());
app.use(createTeacherRouter());
app.use(createAiRouter());

// Explicitly block any other /api/* route (no generic Gemini proxy)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Đường dẫn API không tồn tại.' });
});

async function startServer() {
  const httpServer = http.createServer(app);
  startLtiBackgroundWorkers();

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = fs.existsSync(path.resolve(__dirname, 'dist'))
      ? path.resolve(__dirname, 'dist')
      : path.resolve(__dirname, '..', 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const googleEnabled = Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
    );
    const activeCsp = getCspHeaderForEnv() ?? '(none - preview/testing)';
    console.log(
      `Bạn Viết server listening on http://0.0.0.0:${PORT} | APP_ENV=${getAppEnvMode()} DB=${isDatabaseConfigured() ? 'on' : 'off'} GoogleOAuth=${googleEnabled ? 'on' : 'off'} LTI=${isLtiEnabled() ? 'on' : 'off'} | CSP=${activeCsp}`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
