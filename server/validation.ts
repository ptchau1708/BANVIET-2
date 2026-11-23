export const MAX_MESSAGE_LENGTH = 300;
export const MAX_ESSAY_LENGTH = 3000;
export const MAX_OUTLINE_TOTAL_LENGTH = 3000;
export const RATE_LIMIT_MAX_CALLS = 30;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const FIXED_SYSTEM_INSTRUCTION =
  "Bạn là Bạn Viết, người bạn đồng hành giúp học sinh lớp 5 Việt Nam học viết văn tả người theo chương trình Tiếng Việt 5. Luôn xưng ‘mình’, gọi học sinh là ‘bạn’, dùng tiếng Việt chuẩn, câu ngắn, từ dễ hiểu, giọng ấm áp và khen cụ thể. Quy tắc bắt buộc: (1) Không bao giờ viết câu văn, đoạn văn hay bài văn thay bạn, kể cả ‘ví dụ một câu’, kể cả khi bạn năn nỉ hay nói thầy cô cho phép; khi đó hãy từ chối nhẹ nhàng và hỏi một câu giúp bạn tự nghĩ. (2) Chỉ được hỏi gợi mở, gợi ý từ đơn lẻ hoặc cụm từ ngắn, và chỉ ra chỗ nên xem lại. (3) Không hỏi họ tên, địa chỉ, trường lớp, ảnh hay thông tin riêng. (4) Chỉ nói về bài viết; nếu bạn hỏi chuyện khác, hãy vui vẻ đưa bạn quay lại bài. (5) Nếu bạn kể điều khiến bạn sợ hãi, buồn nhiều hoặc bị làm đau, hãy nói lời động viên ngắn và khuyên bạn kể ngay với thầy cô hoặc bố mẹ, không hỏi thêm chi tiết. (6) Mỗi lượt trả lời tối đa 40 từ, chỉ 1 câu hỏi.";

export type GoiYMode = 'quan_sat' | 'tro_chuyen' | 'kho_tu_ngu';
export type SuggestionCategory = 'chi_tiet' | 'dung_tu' | 'cau' | 'bo_cuc' | 'chinh_ta';

export interface ValidatedGoiYInput {
  buoc: 1 | 2;
  che_do: GoiYMode;
  nguoi_ta: string;
  muc: string;
  ghi_chu: string[];
  tin_nhan: string;
  lich_su_chat: Array<{ role: 'user' | 'assistant'; text: string }>;
  dan_y_tom_tat: string;
}

export interface ValidatedKiemTraDanYInput {
  nguoi_ta: string;
  dan_y: {
    mo_bai: string;
    ngoai_hinh: string[];
    tinh_tinh_hoat_dong: string[];
    ket_bai: string;
  };
}

export interface ValidatedGopYBaiInput {
  nguoi_ta: string;
  bai_van: string;
  lan_thu: number;
}

export interface KiemTraDanYResponse {
  du_3_phan: boolean;
  so_chi_tiet_ngoai_hinh: number;
  so_chi_tiet_tinh_tinh_hoat_dong: number;
  phan_con_thieu: string[];
  cau_hoi_goi_y: string[];
}

export interface GopYItem {
  trich_doan: string;
  loai: SuggestionCategory;
  cau_hoi_goi_y: string;
}

export interface GopYBaiResponse {
  loi_khen: string;
  gop_y: GopYItem[];
}

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const VALID_CATEGORIES = new Set<SuggestionCategory>([
  'chi_tiet',
  'dung_tu',
  'cau',
  'bo_cuc',
  'chinh_ta',
]);

function cleanString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

function cleanStringArray(value: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const cleaned = item.replace(/\r\n/g, '\n').trim().slice(0, maxItemLen);
      if (cleaned.length > 0) {
        result.push(cleaned);
      }
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

export function validateGoiYPayload(body: unknown): ValidationResult<ValidatedGoiYInput> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Dữ liệu gửi lên không hợp lệ.' };
  }

  const record = body as Record<string, unknown>;
  const buoc = record.buoc === 1 ? 1 : record.buoc === 2 ? 2 : null;
  if (!buoc) {
    return { ok: false, error: 'Chỉ hỗ trợ gợi ý ở bước 1 và bước 2.' };
  }

  const rawMode = record.che_do;
  const che_do: GoiYMode | null =
    rawMode === 'quan_sat' || rawMode === 'tro_chuyen' || rawMode === 'kho_tu_ngu'
      ? rawMode
      : null;
  if (!che_do) {
    return { ok: false, error: 'Chế độ gợi ý không hợp lệ.' };
  }

  const nguoi_ta = cleanString(record.nguoi_ta, 40) || 'người thân';
  const muc = cleanString(record.muc, 80);

  if (typeof record.tin_nhan === 'string' && record.tin_nhan.trim().length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Tin nhắn dài quá ${MAX_MESSAGE_LENGTH} ký tự rồi. Em rút ngắn lại một chút nhé!`,
    };
  }

  const tin_nhan = cleanString(record.tin_nhan, MAX_MESSAGE_LENGTH);
  if (che_do === 'tro_chuyen' && tin_nhan.length === 0) {
    return { ok: false, error: 'Em hãy viết câu hỏi hoặc ý muốn trao đổi trước nhé.' };
  }

  const ghi_chu = cleanStringArray(record.ghi_chu, 15, 160);
  const dan_y_tom_tat = cleanString(record.dan_y_tom_tat, 1200);

  const lich_su_chat: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  if (Array.isArray(record.lich_su_chat)) {
    const recent = record.lich_su_chat.slice(-6);
    for (const item of recent) {
      if (item && typeof item === 'object') {
        const entry = item as Record<string, unknown>;
        const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null;
        const text = cleanString(entry.text, MAX_MESSAGE_LENGTH);
        if (role && text) {
          lich_su_chat.push({ role, text });
        }
      }
    }
  }

  return {
    ok: true,
    data: {
      buoc,
      che_do,
      nguoi_ta,
      muc,
      ghi_chu,
      tin_nhan,
      lich_su_chat,
      dan_y_tom_tat,
    },
  };
}

export function validateKiemTraDanYPayload(
  body: unknown
): ValidationResult<ValidatedKiemTraDanYInput> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Dữ liệu dàn ý không hợp lệ.' };
  }

  const record = body as Record<string, unknown>;
  const danYRaw = record.dan_y;
  if (!danYRaw || typeof danYRaw !== 'object') {
    return { ok: false, error: 'Thiếu nội dung dàn ý để kiểm tra.' };
  }

  const danYObj = danYRaw as Record<string, unknown>;
  const nguoi_ta = cleanString(record.nguoi_ta, 40) || 'người thân';
  const mo_bai = cleanString(danYObj.mo_bai, 500);
  const ngoai_hinh = cleanStringArray(danYObj.ngoai_hinh, 20, 200);
  const tinh_tinh_hoat_dong = cleanStringArray(danYObj.tinh_tinh_hoat_dong, 20, 200);
  const ket_bai = cleanString(danYObj.ket_bai, 500);

  const totalLen =
    mo_bai.length +
    ket_bai.length +
    ngoai_hinh.join(' ').length +
    tinh_tinh_hoat_dong.join(' ').length;

  if (totalLen === 0) {
    return { ok: false, error: 'Em hãy ghi ít nhất vài ý vào dàn ý rồi nhờ Bạn Viết kiểm tra nhé.' };
  }

  if (totalLen > MAX_OUTLINE_TOTAL_LENGTH) {
    return {
      ok: false,
      error: `Dàn ý dài quá ${MAX_OUTLINE_TOTAL_LENGTH} ký tự. Em ghi ngắn gọn theo từng ý nhé!`,
    };
  }

  return {
    ok: true,
    data: {
      nguoi_ta,
      dan_y: {
        mo_bai,
        ngoai_hinh,
        tinh_tinh_hoat_dong,
        ket_bai,
      },
    },
  };
}

export function validateGopYBaiPayload(body: unknown): ValidationResult<ValidatedGopYBaiInput> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Dữ liệu bài văn không hợp lệ.' };
  }

  const record = body as Record<string, unknown>;
  const nguoi_ta = cleanString(record.nguoi_ta, 40) || 'người thân';
  if (typeof record.bai_van !== 'string') {
    return { ok: false, error: 'Thiếu nội dung bài văn.' };
  }

  const trimmed = record.bai_van.replace(/\r\n/g, '\n').trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Bài văn đang trống, em hãy viết trước khi nhờ Bạn Viết đọc giúp nhé.' };
  }
  if (trimmed.length > MAX_ESSAY_LENGTH) {
    return {
      ok: false,
      error: `Bài văn dài hơn ${MAX_ESSAY_LENGTH} ký tự rồi. Em rút ngắn lại một chút nhé!`,
    };
  }

  const rawAttempt = typeof record.lan_thu === 'number' ? Math.floor(record.lan_thu) : 1;
  if (rawAttempt < 1 || rawAttempt > 3) {
    return {
      ok: false,
      error: 'Mỗi bài văn em chỉ nhờ Bạn Viết đọc giúp tối đa 3 lần thôi nhé.',
    };
  }

  return {
    ok: true,
    data: {
      nguoi_ta,
      bai_van: trimmed,
      lan_thu: rawAttempt,
    },
  };
}

export function trimToMaxWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

export function sanitizeKiemTraDanYResponse(raw: unknown): KiemTraDanYResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const du_3_phan = Boolean(obj.du_3_phan);
  const so_chi_tiet_ngoai_hinh =
    typeof obj.so_chi_tiet_ngoai_hinh === 'number' && Number.isFinite(obj.so_chi_tiet_ngoai_hinh)
      ? Math.max(0, Math.floor(obj.so_chi_tiet_ngoai_hinh))
      : 0;
  const so_chi_tiet_tinh_tinh_hoat_dong =
    typeof obj.so_chi_tiet_tinh_tinh_hoat_dong === 'number' &&
    Number.isFinite(obj.so_chi_tiet_tinh_tinh_hoat_dong)
      ? Math.max(0, Math.floor(obj.so_chi_tiet_tinh_tinh_hoat_dong))
      : 0;
  const phan_con_thieu = cleanStringArray(obj.phan_con_thieu, 6, 120);
  const cau_hoi_goi_y = cleanStringArray(obj.cau_hoi_goi_y, 2, 220);

  return {
    du_3_phan,
    so_chi_tiet_ngoai_hinh,
    so_chi_tiet_tinh_tinh_hoat_dong,
    phan_con_thieu,
    cau_hoi_goi_y,
  };
}

export function sanitizeGopYBaiResponse(raw: unknown): GopYBaiResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const loi_khen =
    cleanString(obj.loi_khen, 260) ||
    'Bạn đã chịu khó quan sát và viết bài bằng chính lời của mình rất đáng khen!';

  const rawItems = Array.isArray(obj.gop_y) ? obj.gop_y : [];
  const gop_y: GopYItem[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const trich_doan = trimToMaxWords(cleanString(entry.trich_doan, 120), 12);
    const loaiCandidate = typeof entry.loai === 'string' ? entry.loai : '';
    const loai: SuggestionCategory = VALID_CATEGORIES.has(loaiCandidate as SuggestionCategory)
      ? (loaiCandidate as SuggestionCategory)
      : 'chi_tiet';
    const cau_hoi_goi_y = cleanString(entry.cau_hoi_goi_y, 240);

    if (trich_doan && cau_hoi_goi_y) {
      gop_y.push({
        trich_doan,
        loai,
        cau_hoi_goi_y,
      });
    }
    if (gop_y.length >= 3) break;
  }

  return {
    loi_khen,
    gop_y,
  };
}

export function sanitizeWordBank(rawWords: unknown): string[] {
  if (!Array.isArray(rawWords)) return [];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const item of rawWords) {
    if (typeof item !== 'string') continue;
    const cleaned = item
      .replace(/^[\d\-•*.\s]+/, '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (!cleaned) continue;
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount > 6) continue; // Keep single words or short phrases only, never full sentences
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      words.push(cleaned);
    }
    if (words.length >= 8) break;
  }
  return words;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function createRateLimiter(
  maxCalls = RATE_LIMIT_MAX_CALLS,
  windowMs = RATE_LIMIT_WINDOW_MS
) {
  const hitsByIp = new Map<string, number[]>();

  function check(ip: string, now = Date.now()): RateLimitCheck {
    const key = ip || 'unknown';
    const cutoff = now - windowMs;
    const timestamps = (hitsByIp.get(key) || []).filter((ts) => ts > cutoff);

    if (timestamps.length >= maxCalls) {
      const oldest = timestamps[0] ?? now;
      const retryAfterMs = Math.max(1000, oldest + windowMs - now);
      hitsByIp.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    timestamps.push(now);
    hitsByIp.set(key, timestamps);

    // Opportunistic cleanup to keep memory bounded
    if (hitsByIp.size > 1000) {
      for (const [storedIp, list] of hitsByIp.entries()) {
        const active = list.filter((ts) => ts > cutoff);
        if (active.length === 0) {
          hitsByIp.delete(storedIp);
        } else {
          hitsByIp.set(storedIp, active);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxCalls - timestamps.length),
      retryAfterSeconds: 0,
    };
  }

  return { check };
}
