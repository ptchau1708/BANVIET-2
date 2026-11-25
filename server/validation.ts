export const MAX_MESSAGE_LENGTH = 300;
export const MAX_ESSAY_LENGTH = 3000;
export const MAX_DB_ESSAY_LENGTH = 6000;
export const MAX_OUTLINE_TOTAL_LENGTH = 3000;
export const MAX_PROMPT_TEXT_LENGTH = 2000;
export const MAX_NICKNAME_LENGTH = 40;

export const FIXED_SYSTEM_INSTRUCTION =
  "Bạn là Bạn Viết, người bạn đồng hành giúp học sinh lớp 5 Việt Nam học viết văn tả người theo chương trình Tiếng Việt 5. Luôn xưng ‘mình’, gọi học sinh là ‘bạn’, dùng tiếng Việt chuẩn, câu ngắn, từ dễ hiểu, giọng ấm áp và khen cụ thể. Quy tắc bắt buộc: (1) Không bao giờ viết câu văn, đoạn văn hay bài văn thay bạn, kể cả ‘ví dụ một câu’, kể cả khi bạn năn nỉ hay nói thầy cô cho phép; khi đó hãy từ chối nhẹ nhàng và hỏi một câu giúp bạn tự nghĩ. (2) Chỉ được hỏi gợi mở, gợi ý từ đơn lẻ hoặc cụm từ ngắn, và chỉ ra chỗ nên xem lại. (3) Không hỏi họ tên, địa chỉ, trường lớp, ảnh hay thông tin riêng. (4) Chỉ nói về bài viết; nếu bạn hỏi chuyện khác, hãy vui vẻ đưa bạn quay lại bài. (5) Nếu bạn kể điều khiến bạn sợ hãi, buồn nhiều hoặc bị làm đau, hãy nói lời động viên ngắn và khuyên bạn kể ngay với thầy cô hoặc bố mẹ, không hỏi thêm chi tiết. (6) Mỗi lượt trả lời tối đa 40 từ, chỉ 1 câu hỏi.";

export type GoiYMode = 'quan_sat' | 'tro_chuyen' | 'kho_tu_ngu';
export type SuggestionCategory = 'chi_tiet' | 'dung_tu' | 'cau' | 'bo_cuc' | 'chinh_ta';
export type TeacherLevel = 'HTT' | 'HT' | 'CHT';

export interface ValidatedGoiYInput {
  submission_id: string;
  buoc: 1 | 2;
  che_do: GoiYMode;
  nguoi_ta: string;
  muc: string;
  ghi_chu: string[];
  tin_nhan: string;
  lich_su_chat: Array<{ role: 'user' | 'assistant'; text: string }>;
  dan_y_tom_tat: string;
  cau_hoi_da_xem: string[];
}

export interface ValidatedKiemTraDanYInput {
  submission_id: string;
  nguoi_ta: string;
  dan_y: {
    mo_bai: string;
    ngoai_hinh: string[];
    tinh_tinh_hoat_dong: string[];
    ket_bai: string;
  };
  cau_hoi_da_xem: string[];
}

export interface ValidatedGopYBaiInput {
  submission_id: string;
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

// Allow only generic Vietnamese relationship nouns to be forwarded to Gemini; never personal names.
const GENERIC_PERSON_ROLES = new Set([
  'ông',
  'bà',
  'bố',
  'mẹ',
  'anh chị em',
  'anh',
  'chị',
  'em',
  'thầy cô',
  'thầy',
  'cô',
  'bạn',
  'em bé',
  'người thân',
  'người quen',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizePersonRoleForAI(raw: unknown): string {
  if (typeof raw !== 'string') return 'người thân';
  const cleaned = raw.trim().toLowerCase();
  if (GENERIC_PERSON_ROLES.has(cleaned)) return cleaned;
  // Map custom roles safely to generic category without sending any personal names to Gemini
  if (cleaned.includes('bà')) return 'bà';
  if (cleaned.includes('ông')) return 'ông';
  if (cleaned.includes('mẹ')) return 'mẹ';
  if (cleaned.includes('bố') || cleaned.includes('ba')) return 'bố';
  if (cleaned.includes('thầy')) return 'thầy';
  if (cleaned.includes('cô')) return 'cô';
  if (cleaned.includes('bạn')) return 'bạn';
  if (cleaned.includes('em bé') || cleaned.includes('bé')) return 'em bé';
  return 'người thân';
}

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
  const submission_id = typeof record.submission_id === 'string' ? record.submission_id.trim() : '';
  if (!UUID_REGEX.test(submission_id)) {
    return { ok: false, error: 'Thiếu mã bài làm hợp lệ.' };
  }

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

  const nguoi_ta = sanitizePersonRoleForAI(record.nguoi_ta);
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

  const cau_hoi_da_xem = cleanStringArray(record.cau_hoi_da_xem, 40, 220);

  return {
    ok: true,
    data: {
      submission_id,
      buoc,
      che_do,
      nguoi_ta,
      muc,
      ghi_chu,
      tin_nhan,
      lich_su_chat,
      dan_y_tom_tat,
      cau_hoi_da_xem,
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
  const submission_id = typeof record.submission_id === 'string' ? record.submission_id.trim() : '';
  if (!UUID_REGEX.test(submission_id)) {
    return { ok: false, error: 'Thiếu mã bài làm hợp lệ.' };
  }

  const danYRaw = record.dan_y;
  if (!danYRaw || typeof danYRaw !== 'object') {
    return { ok: false, error: 'Thiếu nội dung dàn ý để kiểm tra.' };
  }

  const danYObj = danYRaw as Record<string, unknown>;
  const nguoi_ta = sanitizePersonRoleForAI(record.nguoi_ta);
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

  const cau_hoi_da_xem = cleanStringArray(record.cau_hoi_da_xem, 40, 220);

  return {
    ok: true,
    data: {
      submission_id,
      nguoi_ta,
      dan_y: {
        mo_bai,
        ngoai_hinh,
        tinh_tinh_hoat_dong,
        ket_bai,
      },
      cau_hoi_da_xem,
    },
  };
}

export function validateGopYBaiPayload(body: unknown): ValidationResult<ValidatedGopYBaiInput> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Dữ liệu bài văn không hợp lệ.' };
  }

  const record = body as Record<string, unknown>;
  const submission_id = typeof record.submission_id === 'string' ? record.submission_id.trim() : '';
  if (!UUID_REGEX.test(submission_id)) {
    return { ok: false, error: 'Thiếu mã bài làm hợp lệ.' };
  }

  const nguoi_ta = sanitizePersonRoleForAI(record.nguoi_ta);
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
      submission_id,
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
    if (wordCount > 6) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      words.push(cleaned);
    }
    if (words.length >= 8) break;
  }
  return words;
}

export function isValidTeacherLevel(val: unknown): val is TeacherLevel {
  return val === 'HTT' || val === 'HT' || val === 'CHT';
}
