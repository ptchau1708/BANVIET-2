import type { ObservationBoxKey, OutlineData, SelfCheckState } from '../types';

export type SuggestionSource = 'ai' | 'kho';

export interface KhoTuTopic {
  id: string;
  name: string;
  words?: string[];
  phrases?: string[];
  so_sanh?: string[];
  cau_hoi?: string[];
  ghi_chu?: string;
}

export interface KhoTuGroup {
  id: string;
  name: string;
  topics: KhoTuTopic[];
}

export interface KhoTuDatabase {
  version: string;
  title: string;
  mo_ta: string;
  nguyen_tac: string;
  tong_so_muc: number;
  groups: KhoTuGroup[];
}

export interface KhoTuStats {
  mo_kho: number;
  goi_y_tu_kho: number;
  tu_da_luu: number;
  auto_fallback?: number;
}

export const DEFAULT_KHO_TU_STATS: KhoTuStats = {
  mo_kho: 0,
  goi_y_tu_kho: 0,
  tu_da_luu: 0,
  auto_fallback: 0,
};

export const FALLBACK_GENTLE_NOTICE = 'Bạn Viết đang nghỉ, đây là gợi ý trong kho cho em.';
export const AI_LIMIT_REACHED_LABEL = 'Hết lượt hôm nay – mai em hỏi tiếp nhé';
export const STEP4_TOMORROW_NOTICE = 'Ngày mai em có thể nhờ Bạn Viết đọc lại.';
export const STEP4_PEER_TEACHER_HINT =
  'Em có thể nhờ bạn cùng bàn hoặc thầy/cô đọc giúp bài văn của mình nhé!';

function normalizeText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFC');
}

function asNonNegativeInt(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Safely reads `outline_check.kho_tu` from a submission's JSONB `outline_check` column.
 */
export function extractKhoTuStats(outlineCheck: unknown): KhoTuStats {
  if (!outlineCheck || typeof outlineCheck !== 'object') {
    return { ...DEFAULT_KHO_TU_STATS };
  }
  const rec = outlineCheck as Record<string, unknown>;
  const raw = rec.kho_tu;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_KHO_TU_STATS };
  }
  const kt = raw as Record<string, unknown>;
  return {
    mo_kho: asNonNegativeInt(kt.mo_kho),
    goi_y_tu_kho: asNonNegativeInt(kt.goi_y_tu_kho),
    tu_da_luu: asNonNegativeInt(kt.tu_da_luu),
    auto_fallback: asNonNegativeInt(kt.auto_fallback),
  };
}

/**
 * Merges two `KhoTuStats` objects by keeping the maximum monotonic count for each field,
 * ensuring client autosaves never overwrite server-side fallback increments (or vice versa).
 */
export function mergeKhoTuStats(a: KhoTuStats, b: Partial<KhoTuStats> | null | undefined): KhoTuStats {
  if (!b) return { ...a };
  return {
    mo_kho: Math.max(asNonNegativeInt(a.mo_kho), asNonNegativeInt(b.mo_kho)),
    goi_y_tu_kho: Math.max(asNonNegativeInt(a.goi_y_tu_kho), asNonNegativeInt(b.goi_y_tu_kho)),
    tu_da_luu: Math.max(asNonNegativeInt(a.tu_da_luu), asNonNegativeInt(b.tu_da_luu)),
    auto_fallback: Math.max(
      asNonNegativeInt(a.auto_fallback),
      asNonNegativeInt(b.auto_fallback)
    ),
  };
}

/**
 * Preserves `kho_tu` inside `outline_check` JSONB even when the outline check result itself is null.
 */
export function mergeKhoTuIntoOutlineCheck(
  outlineCheckPayload: Record<string, unknown> | null,
  khoTuStats: KhoTuStats
): Record<string, unknown> | null {
  const hasAnyStats =
    khoTuStats.mo_kho > 0 ||
    khoTuStats.goi_y_tu_kho > 0 ||
    khoTuStats.tu_da_luu > 0 ||
    (khoTuStats.auto_fallback ?? 0) > 0;

  if (!outlineCheckPayload && !hasAnyStats) {
    return null;
  }

  return {
    ...(outlineCheckPayload ?? {}),
    kho_tu: {
      mo_kho: asNonNegativeInt(khoTuStats.mo_kho),
      goi_y_tu_kho: asNonNegativeInt(khoTuStats.goi_y_tu_kho),
      tu_da_luu: asNonNegativeInt(khoTuStats.tu_da_luu),
      ...(asNonNegativeInt(khoTuStats.auto_fallback) > 0
        ? { auto_fallback: asNonNegativeInt(khoTuStats.auto_fallback) }
        : {}),
    },
  };
}

/**
 * Checks if an `outline_check` JSONB record actually contains a completed outline evaluation
 * (as opposed to only storing `kho_tu` counters).
 */
export function hasOutlineCheckEvaluation(outlineCheck: unknown): boolean {
  if (!outlineCheck || typeof outlineCheck !== 'object') return false;
  const rec = outlineCheck as Record<string, unknown>;
  return typeof rec.du_3_phan === 'boolean';
}

/**
 * Maps a Vietnamese person role (Ông, Bà, Bố, Mẹ, Thầy cô, Bạn, Em bé, ...) to `theo-nguoi` topic ID.
 */
export function mapPersonToTopicId(personRole: string): string {
  const norm = normalizeText(personRole);
  if (!norm) return 'ong-ba';
  const words = norm.split(/[\s,.;:/()-]+/).filter(Boolean);
  const hasWord = (w: string) => words.includes(w);

  // Check workers / professions first (e.g., "Chú công an", "Cô lao công", "Bác nông dân")
  if (
    norm.includes('công an') ||
    norm.includes('công nhân') ||
    norm.includes('lao công') ||
    norm.includes('nông dân') ||
    norm.includes('bác sĩ') ||
    norm.includes('y tá') ||
    norm.includes('bộ đội') ||
    norm.includes('bảo vệ') ||
    norm.includes('tài xế') ||
    norm.includes('người lao động')
  ) {
    return 'nguoi-lao-dong';
  }

  if (hasWord('ông') || hasWord('bà')) return 'ong-ba';
  if (hasWord('bố') || hasWord('cha') || hasWord('ba')) return 'bo';
  if (hasWord('mẹ') || hasWord('má')) return 'me';
  if (norm.includes('em bé') || hasWord('bé')) return 'em-be';
  if (hasWord('thầy') || hasWord('cô')) return 'thay-co';
  if (hasWord('bạn')) return 'ban-be';
  if (hasWord('anh') || hasWord('chị') || hasWord('em')) return 'anh-chi-em';
  return 'nguoi-lao-dong';
}

export interface KhoTopicTarget {
  groupId: string;
  topicId?: string;
  relatedTopicIds: string[];
  quanSatTopicId: string;
  personTopicId: string;
}

/**
 * Maps Step 1 observation box key or Vietnamese label to the matching Word Bank group/topics.
 */
export function mapStep1BoxToKhoTarget(
  boxOrLabel: ObservationBoxKey | string,
  personRole: string
): KhoTopicTarget {
  const norm = normalizeText(boxOrLabel);
  const personTopicId = mapPersonToTopicId(personRole);

  if (norm === 'ngoaihinh' || norm.includes('ngoại hình')) {
    return {
      groupId: 'ngoai-hinh',
      topicId: 'khuon-mat',
      relatedTopicIds: ['voc-dang', 'khuon-mat', 'mai-toc', 'doi-mat', 'rang-nu-cuoi', 'ban-tay'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }
  if (norm === 'tinhtinh' || norm.includes('tính tình') || norm.includes('tính cách')) {
    return {
      groupId: 'tinh-tinh',
      topicId: 'hien-hau',
      relatedTopicIds: ['hien-hau', 'yeu-thuong', 'cham-chi', 'vui-ve'],
      quanSatTopicId: 'tinh-tinh-q',
      personTopicId,
    };
  }
  if (
    norm === 'hoatdongloinoi' ||
    norm.includes('hoạt động') ||
    norm.includes('việc làm') ||
    norm.includes('lời nói')
  ) {
    return {
      groupId: 'hoat-dong',
      topicId: 'viec-nha',
      relatedTopicIds: ['viec-nha', 'cham-soc-em', 'cu-chi', 'so-thich'],
      quanSatTopicId: 'hoat-dong-q',
      personTopicId,
    };
  }
  if (norm === 'tinhcam' || norm.includes('tình cảm') || norm.includes('kết bài')) {
    return {
      groupId: 'tinh-cam',
      topicId: 'cam-xuc',
      relatedTopicIds: ['cam-xuc', 'mong-uoc'],
      quanSatTopicId: 'tinh-cam-q',
      personTopicId,
    };
  }

  return {
    groupId: 'ngoai-hinh',
    topicId: 'voc-dang',
    relatedTopicIds: ['voc-dang', 'khuon-mat', 'mai-toc'],
    quanSatTopicId: 'ngoai-hinh-q',
    personTopicId,
  };
}

/**
 * Maps a Step 2 Word Bank topic label (e.g. "Mái tóc", "Đôi mắt & khuôn mặt", "Tính tình", ...)
 * to the matching group and topic IDs in `kho-tu-ngu-ta-nguoi.json`.
 */
export function mapWordTopicToKhoTarget(topicLabel: string, personRole: string): KhoTopicTarget {
  const norm = normalizeText(topicLabel);
  const personTopicId = mapPersonToTopicId(personRole);

  if (norm.includes('tóc')) {
    return {
      groupId: 'ngoai-hinh',
      topicId: 'mai-toc',
      relatedTopicIds: ['mai-toc', 'khuon-mat'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }
  if (norm.includes('mắt') || norm.includes('khuôn mặt') || norm.includes('mặt')) {
    return {
      groupId: 'ngoai-hinh',
      topicId: 'doi-mat',
      relatedTopicIds: ['doi-mat', 'khuon-mat', 'long-may', 'mui'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }
  if (norm.includes('dáng') || norm.includes('bàn tay') || norm.includes('chân') || norm.includes('da')) {
    return {
      groupId: 'ngoai-hinh',
      topicId: 'voc-dang',
      relatedTopicIds: ['voc-dang', 'ban-tay', 'doi-chan-dang-di', 'lan-da'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }
  if (norm.includes('giọng') || norm.includes('cười') || norm.includes('miệng') || norm.includes('môi')) {
    return {
      groupId: 'ngoai-hinh',
      topicId: 'giong-noi',
      relatedTopicIds: ['giong-noi', 'rang-nu-cuoi', 'mieng-moi'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }
  if (norm.includes('tính tình') || norm.includes('tính cách')) {
    return {
      groupId: 'tinh-tinh',
      topicId: 'hien-hau',
      relatedTopicIds: ['hien-hau', 'yeu-thuong', 'cham-chi', 'vui-ve', 'nghiem-khac'],
      quanSatTopicId: 'tinh-tinh-q',
      personTopicId,
    };
  }
  if (norm.includes('hoạt động') || norm.includes('việc làm') || norm.includes('hằng ngày')) {
    return {
      groupId: 'hoat-dong',
      topicId: 'viec-nha',
      relatedTopicIds: ['viec-nha', 'cham-soc-em', 'cu-chi', 'nghe-nghiep', 'so-thich'],
      quanSatTopicId: 'hoat-dong-q',
      personTopicId,
    };
  }
  if (norm.includes('tình cảm') || norm.includes('kết bài')) {
    return {
      groupId: 'tinh-cam',
      topicId: 'cam-xuc',
      relatedTopicIds: ['cam-xuc', 'mong-uoc'],
      quanSatTopicId: 'tinh-cam-q',
      personTopicId,
    };
  }
  if (norm.includes('mở bài') || norm.includes('từ nối') || norm.includes('khung câu') || norm.includes('so sánh')) {
    return {
      groupId: 'khung-cau',
      topicId: norm.includes('so sánh') ? 'bien-phap' : 'mo-bai',
      relatedTopicIds: ['mo-bai', 'than-bai-noi', 'ket-bai', 'bien-phap'],
      quanSatTopicId: 'ngoai-hinh-q',
      personTopicId,
    };
  }

  return mapStep1BoxToKhoTarget(topicLabel, personRole);
}

export interface Step4SelfCheckKhoHelper {
  buttonLabel: string;
  hint: string;
  groupId: string;
  topicId?: string;
  soSanhOnly?: boolean;
  personTopicId: string;
  checklistTips?: string[];
}

/**
 * Maps each of the 6 Step 4 Self-Check items to the matching Word Bank section
 * when the student marks "Chưa".
 */
export function mapSelfCheckKeyToKhoHelper(
  key: keyof SelfCheckState,
  personRole: string
): Step4SelfCheckKhoHelper {
  const personTopicId = mapPersonToTopicId(personRole);

  switch (key) {
    case 'duBaPhan':
      return {
        buttonLabel: 'Mở kho Khung câu & Từ nối',
        hint: 'Xem gợi ý mở bài, từ nối chuyển đoạn và cách kết bài rõ ràng.',
        groupId: 'khung-cau',
        topicId: 'mo-bai',
        personTopicId,
      };
    case 'baNetNgoaiHinh':
      return {
        buttonLabel: 'Mở kho Tả ngoại hình',
        hint: 'Chọn thêm nét riêng về dáng người, mái tóc, khuôn mặt, đôi mắt hay bàn tay.',
        groupId: 'ngoai-hinh',
        topicId: 'khuon-mat',
        personTopicId,
      };
    case 'viecLamLoiNoi':
      return {
        buttonLabel: 'Mở kho Hoạt động & Tính tình',
        hint: 'Thêm việc làm hằng ngày, cử chỉ quen thuộc hoặc lời nói thể hiện tính cách.',
        groupId: 'hoat-dong',
        topicId: 'viec-nha',
        personTopicId,
      };
    case 'hinhAnhSoSanh':
      return {
        buttonLabel: 'Mở kho Hình ảnh so sánh',
        hint: 'Xem các gợi ý so sánh “như…”, “tựa như…” để câu văn sinh động hơn.',
        groupId: 'ngoai-hinh',
        topicId: 'mai-toc',
        soSanhOnly: true,
        personTopicId,
      };
    case 'ketBaiTinhCam':
      return {
        buttonLabel: 'Mở kho Tình cảm (kết bài)',
        hint: 'Tìm từ ngữ bày tỏ lòng yêu quý, biết ơn và mong ước của em ở kết bài.',
        groupId: 'tinh-cam',
        topicId: 'cam-xuc',
        personTopicId,
      };
    case 'suaChinhTa':
      return {
        buttonLabel: 'Mở kho Từ nối & Kiểm tra câu',
        hint: 'Đọc thầm từng câu để soát lỗi dấu thanh, viết hoa tên riêng, dấu chấm và dấu phẩy.',
        groupId: 'khung-cau',
        topicId: 'than-bai-noi',
        personTopicId,
        checklistTips: [
          'Viết hoa chữ cái đầu câu và danh từ riêng.',
          'Kiểm tra dấu hỏi / ngã, l / n, s / x, ch / tr, r / d / gi.',
          'Mỗi câu đã có dấu chấm (.) hoặc dấu chấm than (!) kết thúc chưa?',
        ],
      };
  }
}

export function findGroup(db: KhoTuDatabase, groupId: string): KhoTuGroup | undefined {
  return db.groups.find((g) => g.id === groupId);
}

export function findTopic(
  db: KhoTuDatabase,
  groupId: string,
  topicId: string
): KhoTuTopic | undefined {
  return findGroup(db, groupId)?.topics.find((t) => t.id === topicId);
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * Collects 30–40 curated items from the matching topic(s) and person topic
 * in `public/kho-tu-ngu-ta-nguoi.json` to ground the AI Word Bank prompt.
 */
export function collectTopicItemsForPrompt(
  db: KhoTuDatabase,
  params: {
    topicLabel: string;
    personRole: string;
    minItems?: number;
    maxItems?: number;
  }
): {
  items: string[];
  groupId: string;
  topicId?: string;
} {
  const maxItems = params.maxItems ?? 36;
  const minItems = params.minItems ?? 30;
  const target = mapWordTopicToKhoTarget(params.topicLabel, params.personRole);
  const pool: string[] = [];

  const pushTopic = (topic: KhoTuTopic | undefined) => {
    if (!topic) return;
    if (Array.isArray(topic.words)) pool.push(...topic.words);
    if (Array.isArray(topic.phrases)) pool.push(...topic.phrases);
    if (Array.isArray(topic.so_sanh)) pool.push(...topic.so_sanh);
  };

  for (const tid of target.relatedTopicIds) {
    pushTopic(findTopic(db, target.groupId, tid));
  }

  // Also include person-specific vocabulary from `theo-nguoi`
  pushTopic(findTopic(db, 'theo-nguoi', target.personTopicId));

  // If still fewer than minItems, pull additional topics from the same group
  let unique = dedupeStrings(pool);
  if (unique.length < minItems) {
    const group = findGroup(db, target.groupId);
    if (group) {
      for (const t of group.topics) {
        pushTopic(t);
      }
      unique = dedupeStrings(pool);
    }
  }

  return {
    items: unique.slice(0, maxItems),
    groupId: target.groupId,
    topicId: target.topicId,
  };
}

/**
 * Picks 6–8 short words/phrases from the matching topic in `kho-tu-ngu-ta-nguoi.json`
 * when AI is unavailable or fails on `che_do: 'kho_tu_ngu'`.
 */
export function pickFallbackWordBank(
  db: KhoTuDatabase,
  params: {
    topicLabel: string;
    personRole: string;
    count?: number;
  }
): {
  tu_ngu: string[];
  tra_loi: string;
  groupId: string;
  topicId?: string;
} {
  const count = params.count ?? 8;
  const collected = collectTopicItemsForPrompt(db, {
    topicLabel: params.topicLabel,
    personRole: params.personRole,
    minItems: 16,
    maxItems: 40,
  });

  // Prefer short words & phrases (<= 6 words) to stay strictly consistent with Grade 5 word bank rules
  const shortItems = collected.items.filter((item) => item.split(/\s+/).length <= 6);
  const selected = (shortItems.length > 0 ? shortItems : collected.items).slice(0, count);

  const topicObj = collected.topicId
    ? findTopic(db, collected.groupId, collected.topicId)
    : undefined;
  const topicName = topicObj?.name || params.topicLabel || 'chủ đề này';

  return {
    tu_ngu: selected,
    tra_loi: `Trong kho có các từ ngữ gợi tả về "${topicName}". Em chọn từ hợp nhất với ${params.personRole || 'người em tả'} nhé!`,
    groupId: collected.groupId,
    topicId: collected.topicId,
  };
}

/**
 * Picks an unseen `cau_hoi` (guiding question) from the matching topic in `kho-tu-ngu-ta-nguoi.json`.
 * Never repeats a previously seen question until all questions in the topic pool have been viewed.
 */
export function pickUnseenQuestion(
  db: KhoTuDatabase,
  params: {
    boxOrTopic: string;
    personRole: string;
    seenQuestions?: string[];
  }
): {
  question: string;
  groupId: string;
  topicId?: string;
} {
  const target = mapStep1BoxToKhoTarget(params.boxOrTopic, params.personRole);
  const questionsPool: string[] = [];

  // 1. Primary Step-1 observation questions for that box
  const qTopic = findTopic(db, 'quan-sat', target.quanSatTopicId);
  if (qTopic?.cau_hoi) {
    questionsPool.push(...qTopic.cau_hoi);
  }

  // 2. Person-specific questions
  const personTopic = findTopic(db, 'theo-nguoi', target.personTopicId);
  if (personTopic?.cau_hoi) {
    questionsPool.push(...personTopic.cau_hoi);
  }

  // 3. Topic-specific questions from the matched descriptive group
  for (const tid of target.relatedTopicIds) {
    const t = findTopic(db, target.groupId, tid);
    if (t?.cau_hoi) {
      questionsPool.push(...t.cau_hoi);
    }
  }

  // 4. Fallback across the entire group if needed
  const grp = findGroup(db, target.groupId);
  if (grp) {
    for (const t of grp.topics) {
      if (t.cau_hoi) questionsPool.push(...t.cau_hoi);
    }
  }

  const uniqueQuestions = dedupeStrings(questionsPool);
  const seenSet = new Set((params.seenQuestions ?? []).map((q) => normalizeText(q)));

  const unseen = uniqueQuestions.find((q) => !seenSet.has(normalizeText(q)));
  const chosen =
    unseen ??
    uniqueQuestions[0] ??
    'Em nhớ nhất chi tiết nhỏ nào ở người ấy khi ở bên cạnh em?';

  return {
    question: chosen,
    groupId: target.groupId,
    topicId: target.topicId,
  };
}

/**
 * Deterministic local outline check + unseen questions from `kho-tu-ngu-ta-nguoi.json`
 * when AI cannot be called for `/api/kiem-tra-dan-y`.
 */
export function buildLocalOutlineCheckFallback(
  db: KhoTuDatabase,
  params: {
    nguoiTa: string;
    danY: {
      mo_bai: string;
      ngoai_hinh: string[];
      tinh_tinh_hoat_dong: string[];
      ket_bai: string;
    };
    seenQuestions?: string[];
  }
): {
  du_3_phan: boolean;
  so_chi_tiet_ngoai_hinh: number;
  so_chi_tiet_tinh_tinh_hoat_dong: number;
  phan_con_thieu: string[];
  cau_hoi_goi_y: string[];
} {
  const hasMo = params.danY.mo_bai.trim().length > 0;
  const hasKet = params.danY.ket_bai.trim().length > 0;
  const nhCount = params.danY.ngoai_hinh.filter((x) => x.trim().length > 0).length;
  const ttCount = params.danY.tinh_tinh_hoat_dong.filter((x) => x.trim().length > 0).length;
  const hasThan = nhCount > 0 || ttCount > 0;
  const du_3_phan = hasMo && hasThan && hasKet;

  const phan_con_thieu: string[] = [];
  const cau_hoi_goi_y: string[] = [];
  const seen = [...(params.seenQuestions ?? [])];

  if (!hasMo) {
    phan_con_thieu.push('Chưa có ý cho phần Mở bài (giới thiệu người được tả).');
  }
  if (nhCount < 3) {
    phan_con_thieu.push(`Cần thêm chi tiết tả ngoại hình (hiện có ${nhCount}/3 chi tiết).`);
    const q = pickUnseenQuestion(db, {
      boxOrTopic: 'ngoaiHinh',
      personRole: params.nguoiTa,
      seenQuestions: seen,
    }).question;
    cau_hoi_goi_y.push(q);
    seen.push(q);
  }
  if (ttCount < 2) {
    phan_con_thieu.push(
      `Cần thêm chi tiết tả tính tình, việc làm hoặc lời nói (hiện có ${ttCount}/2 chi tiết).`
    );
    const q = pickUnseenQuestion(db, {
      boxOrTopic: 'hoatDongLoiNoi',
      personRole: params.nguoiTa,
      seenQuestions: seen,
    }).question;
    cau_hoi_goi_y.push(q);
    seen.push(q);
  }
  if (!hasKet) {
    phan_con_thieu.push('Chưa có ý cho phần Kết bài (tình cảm và mong ước của em).');
    if (cau_hoi_goi_y.length < 2) {
      const q = pickUnseenQuestion(db, {
        boxOrTopic: 'tinhCam',
        personRole: params.nguoiTa,
        seenQuestions: seen,
      }).question;
      cau_hoi_goi_y.push(q);
    }
  }

  if (cau_hoi_goi_y.length === 0) {
    const q = pickUnseenQuestion(db, {
      boxOrTopic: 'ngoaiHinh',
      personRole: params.nguoiTa,
      seenQuestions: seen,
    }).question;
    cau_hoi_goi_y.push(q);
  }

  return {
    du_3_phan,
    so_chi_tiet_ngoai_hinh: nhCount,
    so_chi_tiet_tinh_tinh_hoat_dong: ttCount,
    phan_con_thieu,
    cau_hoi_goi_y: cau_hoi_goi_y.slice(0, 2),
  };
}

/**
 * Collects all `so_sanh` (similes) across `ngoai-hinh`, `theo-nguoi`, and `khung-cau/bien-phap`
 * for the Step 4 "Hình ảnh so sánh" Word Bank view.
 */
export function collectAllSoSanhItems(
  db: KhoTuDatabase,
  personRole: string
): Array<{ topicName: string; items: string[] }> {
  const sections: Array<{ topicName: string; items: string[] }> = [];
  const personTopicId = mapPersonToTopicId(personRole);

  const personTopic = findTopic(db, 'theo-nguoi', personTopicId);
  if (personTopic?.so_sanh && personTopic.so_sanh.length > 0) {
    sections.push({
      topicName: `So sánh riêng cho ${personTopic.name}`,
      items: personTopic.so_sanh,
    });
  }

  const bienPhap = findTopic(db, 'khung-cau', 'bien-phap');
  if (bienPhap?.phrases && bienPhap.phrases.length > 0) {
    sections.push({
      topicName: bienPhap.name,
      items: bienPhap.phrases,
    });
  }

  const ngoaiHinhGroup = findGroup(db, 'ngoai-hinh');
  if (ngoaiHinhGroup) {
    for (const topic of ngoaiHinhGroup.topics) {
      if (topic.so_sanh && topic.so_sanh.length > 0) {
        sections.push({
          topicName: topic.name,
          items: topic.so_sanh,
        });
      }
    }
  }

  return sections;
}

/**
 * Computes AI vs Word Bank suggestion counts and percentage split for Teacher UI.
 */
export function computeAiKhoRatio(aiCount: number, khoCount: number): {
  aiCount: number;
  khoCount: number;
  total: number;
  aiPercent: number;
  khoPercent: number;
} {
  const safeAi = asNonNegativeInt(aiCount);
  const safeKho = asNonNegativeInt(khoCount);
  const total = safeAi + safeKho;
  if (total === 0) {
    return { aiCount: 0, khoCount: 0, total: 0, aiPercent: 0, khoPercent: 0 };
  }
  const aiPercent = Math.round((safeAi / total) * 100);
  const khoPercent = 100 - aiPercent;
  return {
    aiCount: safeAi,
    khoCount: safeKho,
    total,
    aiPercent,
    khoPercent,
  };
}
