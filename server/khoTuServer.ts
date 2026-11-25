import fs from 'node:fs';
import path from 'node:path';
import type { KhoTuDatabase } from '../src/utils/khoTuNgu.ts';

let cachedDb: KhoTuDatabase | null = null;

/**
 * Reads `public/kho-tu-ngu-ta-nguoi.json` once into server memory without ever modifying the file.
 */
export function getServerKhoTuDb(): KhoTuDatabase {
  if (cachedDb) return cachedDb;
  const publicPath = path.resolve(process.cwd(), 'public', 'kho-tu-ngu-ta-nguoi.json');
  const distPath = path.resolve(process.cwd(), 'dist', 'kho-tu-ngu-ta-nguoi.json');
  const filePath = fs.existsSync(publicPath) ? publicPath : distPath;
  const raw = fs.readFileSync(filePath, 'utf8');
  cachedDb = JSON.parse(raw) as KhoTuDatabase;
  return cachedDb;
}
