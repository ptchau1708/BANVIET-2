import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runGoiY, runGopYBai, runKiemTraDanY } from './server/gemini.ts';
import {
  RATE_LIMIT_MAX_CALLS,
  RATE_LIMIT_WINDOW_MS,
  createRateLimiter,
  validateGoiYPayload,
  validateGopYBaiPayload,
  validateKiemTraDanYPayload,
} from './server/validation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '32kb' }));

const ipLimiter = createRateLimiter(RATE_LIMIT_MAX_CALLS, RATE_LIMIT_WINDOW_MS);

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const result = ipLimiter.check(getClientIp(req));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
    res.status(429).json({
      error: `Em đã dùng hết 30 lượt hỏi Bạn Viết trong giờ này rồi. Mình nghỉ ngơi khoảng ${minutes} phút rồi tiếp tục nhé!`,
    });
    return;
  }
  next();
}

function handleApiError(res: Response, err: unknown) {
  const message =
    err instanceof Error ? err.message : 'Bạn Viết đang bận một chút. Em thử lại sau nhé!';
  console.error('[BanViet API error]', err);

  const lower = message.toLowerCase();
  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    res.status(502).json({
      error:
        'Khóa GEMINI_API_KEY chưa hợp lệ hoặc chưa có quyền. Hãy kiểm tra lại trong Settings > Secrets.',
    });
    return;
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    res.status(429).json({
      error: 'Bạn Viết đang hơi quá tải lúc này. Em chờ một lát rồi bấm thử lại nhé!',
    });
    return;
  }

  res.status(500).json({ error: message });
}

// Endpoint 1: Step 1 & Step 2 guiding questions, chat, and word bank
app.post('/api/goi-y', rateLimitMiddleware, async (req: Request, res: Response) => {
  const validation = validateGoiYPayload(req.body);
  if (!validation.ok || !validation.data) {
    res.status(400).json({ error: validation.error || 'Yêu cầu chưa hợp lệ.' });
    return;
  }

  try {
    const output = await runGoiY(validation.data);
    res.json(output);
  } catch (err) {
    handleApiError(res, err);
  }
});

// Endpoint 2: Step 2 outline check returning strict JSON schema
app.post('/api/kiem-tra-dan-y', rateLimitMiddleware, async (req: Request, res: Response) => {
  const validation = validateKiemTraDanYPayload(req.body);
  if (!validation.ok || !validation.data) {
    res.status(400).json({ error: validation.error || 'Dàn ý chưa hợp lệ.' });
    return;
  }

  try {
    const output = await runKiemTraDanY(validation.data);
    res.json(output);
  } catch (err) {
    handleApiError(res, err);
  }
});

// Endpoint 3: Step 4 essay review returning strict JSON schema (max 3/essay)
app.post('/api/gop-y-bai', rateLimitMiddleware, async (req: Request, res: Response) => {
  const validation = validateGopYBaiPayload(req.body);
  if (!validation.ok || !validation.data) {
    res.status(400).json({ error: validation.error || 'Bài văn chưa hợp lệ.' });
    return;
  }

  try {
    const output = await runGopYBai(validation.data);
    res.json(output);
  } catch (err) {
    handleApiError(res, err);
  }
});

// Explicitly block any other /api/* route (no generic Gemini proxy)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Đường dẫn API không tồn tại.' });
});

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bạn Viết server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
