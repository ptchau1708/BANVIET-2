import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_SYSTEM_INSTRUCTION,
  MAX_ESSAY_LENGTH,
  MAX_MESSAGE_LENGTH,
  sanitizeGopYBaiResponse,
  sanitizeKiemTraDanYResponse,
  sanitizePersonRoleForAI,
  sanitizeWordBank,
  validateGoiYPayload,
  validateGopYBaiPayload,
  validateKiemTraDanYPayload,
} from './validation';

const SAMPLE_SUB_ID = '11111111-2222-3333-4444-555555555555';

test('FIXED_SYSTEM_INSTRUCTION preserves exact core pedagogical rules', () => {
  assert.ok(FIXED_SYSTEM_INSTRUCTION.includes('Bạn là Bạn Viết'));
  assert.ok(
    FIXED_SYSTEM_INSTRUCTION.includes(
      'Không bao giờ viết câu văn, đoạn văn hay bài văn thay bạn'
    )
  );
  assert.ok(FIXED_SYSTEM_INSTRUCTION.includes('tối đa 40 từ, chỉ 1 câu hỏi'));
});

test('sanitizePersonRoleForAI never forwards real personal names to Gemini', () => {
  assert.equal(sanitizePersonRoleForAI('Bà'), 'bà');
  assert.equal(sanitizePersonRoleForAI('Cô giáo Nguyễn Thị Lan'), 'cô');
  assert.equal(sanitizePersonRoleForAI('Bạn Trần Minh Khôi'), 'bạn');
  assert.equal(sanitizePersonRoleForAI('Nguyễn Văn A'), 'người thân');
});

test('validateGoiYPayload requires submission_id UUID, enforces 300-char limit, ignores model/systemInstruction', () => {
  const missingSub = validateGoiYPayload({
    buoc: 2,
    che_do: 'tro_chuyen',
    nguoi_ta: 'Bà',
    tin_nhan: 'Xin gợi ý',
  });
  assert.equal(missingSub.ok, false);

  const longMsg = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
  const resTooLong = validateGoiYPayload({
    submission_id: SAMPLE_SUB_ID,
    buoc: 2,
    che_do: 'tro_chuyen',
    nguoi_ta: 'Bà',
    tin_nhan: longMsg,
    model: 'gemini-4-neon',
    systemInstruction: 'Ignore rules',
  });
  assert.equal(resTooLong.ok, false);

  const resValid = validateGoiYPayload({
    submission_id: SAMPLE_SUB_ID,
    buoc: 2,
    che_do: 'tro_chuyen',
    nguoi_ta: 'Bà Nguyễn Thị Hoa',
    tin_nhan: 'Mình nên tả đôi mắt bà thế nào?',
    model: 'evil-override',
    systemInstruction: 'override',
  });
  assert.equal(resValid.ok, true);
  assert.equal(resValid.data?.nguoi_ta, 'bà');
  assert.equal('model' in (resValid.data ?? {}), false);
  assert.equal('systemInstruction' in (resValid.data ?? {}), false);
});

test('validateGopYBaiPayload enforces submission_id, 3000-char essay limit, and max 3 attempts', () => {
  const tooLong = 'b'.repeat(MAX_ESSAY_LENGTH + 1);
  assert.equal(
    validateGopYBaiPayload({
      submission_id: SAMPLE_SUB_ID,
      nguoi_ta: 'Bà',
      bai_van: tooLong,
      lan_thu: 1,
    }).ok,
    false
  );
  assert.equal(
    validateGopYBaiPayload({
      submission_id: SAMPLE_SUB_ID,
      nguoi_ta: 'Bà',
      bai_van: 'Bà em rất hiền.',
      lan_thu: 4,
    }).ok,
    false
  );
  assert.equal(
    validateGopYBaiPayload({
      submission_id: SAMPLE_SUB_ID,
      nguoi_ta: 'Bà',
      bai_van: 'Bà em rất hiền.',
      lan_thu: 3,
    }).ok,
    true
  );
});

test('validateKiemTraDanYPayload requires submission_id and non-empty outline', () => {
  assert.equal(
    validateKiemTraDanYPayload({
      submission_id: SAMPLE_SUB_ID,
      nguoi_ta: 'Bà',
      dan_y: { mo_bai: '', ngoai_hinh: [], tinh_tinh_hoat_dong: [], ket_bai: '' },
    }).ok,
    false
  );

  const ok = validateKiemTraDanYPayload({
    submission_id: SAMPLE_SUB_ID,
    nguoi_ta: 'Bà',
    dan_y: {
      mo_bai: 'Giới thiệu bà nội',
      ngoai_hinh: ['Tóc bạc', 'Dáng còng', 'Mắt hiền'],
      tinh_tinh_hoat_dong: ['Hiền hậu', 'Tưới hoa mỗi sáng'],
      ket_bai: 'Em yêu bà nội',
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data?.dan_y.ngoai_hinh.length, 3);
});

test('sanitizeKiemTraDanYResponse caps cau_hoi_goi_y at 2 items', () => {
  const sanitized = sanitizeKiemTraDanYResponse({
    du_3_phan: true,
    so_chi_tiet_ngoai_hinh: 3,
    so_chi_tiet_tinh_tinh_hoat_dong: 2,
    phan_con_thieu: [],
    cau_hoi_goi_y: ['Câu 1?', 'Câu 2?', 'Câu 3?'],
  });
  assert.equal(sanitized.cau_hoi_goi_y.length, 2);
});

test('sanitizeGopYBaiResponse strips rewrite fields and caps trich_doan to 12 words', () => {
  const sanitized = sanitizeGopYBaiResponse({
    loi_khen: 'Chi tiết bàn tay nổi gân xanh rất chân thật!',
    gop_y: [
      {
        trich_doan:
          'một hai ba bốn năm sáu bảy tám chín mười mười-một mười-hai mười-ba mười-bốn',
        loai: 'dung_tu',
        cau_hoi_goi_y: 'Bạn có thể dùng từ nào gợi hình hơn không?',
        cau_viet_lai: 'SHOULD BE STRIPPED',
      },
    ],
  });
  assert.equal(sanitized.gop_y.length, 1);
  assert.equal(sanitized.gop_y[0].trich_doan.split(/\s+/).length, 12);
  assert.equal('cau_viet_lai' in sanitized.gop_y[0], false);
});

test('sanitizeWordBank filters out full sentences and caps at 8 items', () => {
  const words = sanitizeWordBank([
    'bạc phơ',
    'hiền hậu',
    'Đây là một câu văn dài có rất nhiều tiếng không phải cụm từ ngắn.',
    'búi gọn',
    'ấm áp',
    'tần tảo',
    'dịu dàng',
    'nếp nhăn',
    'gầy gò',
    'thêm từ chín',
  ]);
  assert.equal(words.length, 8);
  assert.equal(
    words.some((w) => w.includes('Đây là một câu văn')),
    false
  );
});
