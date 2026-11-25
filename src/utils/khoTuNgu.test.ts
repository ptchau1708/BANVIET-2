import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  AI_LIMIT_REACHED_LABEL,
  FALLBACK_GENTLE_NOTICE,
  KhoTuDatabase,
  STEP4_PEER_TEACHER_HINT,
  STEP4_TOMORROW_NOTICE,
  buildLocalOutlineCheckFallback,
  collectAllSoSanhItems,
  collectTopicItemsForPrompt,
  computeAiKhoRatio,
  extractKhoTuStats,
  hasOutlineCheckEvaluation,
  mapPersonToTopicId,
  mapSelfCheckKeyToKhoHelper,
  mapStep1BoxToKhoTarget,
  mapWordTopicToKhoTarget,
  mergeKhoTuIntoOutlineCheck,
  mergeKhoTuStats,
  pickFallbackWordBank,
  pickUnseenQuestion,
} from './khoTuNgu.ts';
import { buildTeacherExcelWorkbook } from '../../server/excel.ts';

const KHO_PATH = path.resolve(process.cwd(), 'public', 'kho-tu-ngu-ta-nguoi.json');
const db = JSON.parse(fs.readFileSync(KHO_PATH, 'utf8')) as KhoTuDatabase;

test('public/kho-tu-ngu-ta-nguoi.json is intact with all 7 groups', () => {
  assert.equal(db.groups.length, 7);
  const groupIds = db.groups.map((g) => g.id);
  assert.deepEqual(groupIds, [
    'ngoai-hinh',
    'tinh-tinh',
    'hoat-dong',
    'tinh-cam',
    'theo-nguoi',
    'khung-cau',
    'quan-sat',
  ]);
  assert.equal(db.tong_so_muc, 1355);
});

test('exact Vietnamese copy constants match requirements', () => {
  assert.equal(FALLBACK_GENTLE_NOTICE, 'Bạn Viết đang nghỉ, đây là gợi ý trong kho cho em.');
  assert.equal(AI_LIMIT_REACHED_LABEL, 'Hết lượt hôm nay – mai em hỏi tiếp nhé');
  assert.equal(STEP4_TOMORROW_NOTICE, 'Ngày mai em có thể nhờ Bạn Viết đọc lại.');
  assert.ok(STEP4_PEER_TEACHER_HINT.includes('bạn cùng bàn'));
});

test('mapPersonToTopicId maps common Grade 5 roles to theo-nguoi topic ids', () => {
  assert.equal(mapPersonToTopicId('Bà ngoại'), 'ong-ba');
  assert.equal(mapPersonToTopicId('Ông nội'), 'ong-ba');
  assert.equal(mapPersonToTopicId('Mẹ'), 'me');
  assert.equal(mapPersonToTopicId('Bố'), 'bo');
  assert.equal(mapPersonToTopicId('Cô giáo'), 'thay-co');
  assert.equal(mapPersonToTopicId('Bạn thân'), 'ban-be');
  assert.equal(mapPersonToTopicId('Em bé'), 'em-be');
  assert.equal(mapPersonToTopicId('Chú công an'), 'nguoi-lao-dong');
});

test('mapStep1BoxToKhoTarget and mapWordTopicToKhoTarget map accurately', () => {
  const nh = mapStep1BoxToKhoTarget('ngoaiHinh', 'Bà ngoại');
  assert.equal(nh.groupId, 'ngoai-hinh');
  assert.equal(nh.quanSatTopicId, 'ngoai-hinh-q');
  assert.equal(nh.personTopicId, 'ong-ba');

  const hd = mapStep1BoxToKhoTarget('hoatDongLoiNoi', 'Mẹ');
  assert.equal(hd.groupId, 'hoat-dong');
  assert.equal(hd.quanSatTopicId, 'hoat-dong-q');

  const hair = mapWordTopicToKhoTarget('Mái tóc', 'Mẹ');
  assert.equal(hair.groupId, 'ngoai-hinh');
  assert.equal(hair.topicId, 'mai-toc');

  const voice = mapWordTopicToKhoTarget('Giọng nói & nụ cười', 'Cô giáo');
  assert.equal(voice.groupId, 'ngoai-hinh');
  assert.equal(voice.topicId, 'giong-noi');
});

test('mapSelfCheckKeyToKhoHelper links all 6 Step 4 checklist rows to matching Word Bank sections', () => {
  const keys = [
    'duBaPhan',
    'baNetNgoaiHinh',
    'viecLamLoiNoi',
    'hinhAnhSoSanh',
    'ketBaiTinhCam',
    'suaChinhTa',
  ] as const;

  for (const key of keys) {
    const helper = mapSelfCheckKeyToKhoHelper(key, 'Bà ngoại');
    assert.ok(helper.buttonLabel.length > 5);
    assert.ok(helper.groupId.length > 0);
    assert.equal(helper.personTopicId, 'ong-ba');
  }

  const soSanh = mapSelfCheckKeyToKhoHelper('hinhAnhSoSanh', 'Bà ngoại');
  assert.equal(soSanh.soSanhOnly, true);

  const chinhTa = mapSelfCheckKeyToKhoHelper('suaChinhTa', 'Mẹ');
  assert.ok(Array.isArray(chinhTa.checklistTips) && chinhTa.checklistTips.length >= 3);

  const soSanhSections = collectAllSoSanhItems(db, 'Bà ngoại');
  assert.ok(soSanhSections.length >= 3);
  assert.ok(soSanhSections.some((s) => s.items.length > 0));
});

test('collectTopicItemsForPrompt returns 30–38 deduplicated items from matching topic', () => {
  const res = collectTopicItemsForPrompt(db, {
    topicLabel: 'Ánh mắt & khuôn mặt',
    personRole: 'Mẹ',
    minItems: 30,
    maxItems: 38,
  });
  assert.equal(res.groupId, 'ngoai-hinh');
  assert.ok(res.items.length >= 30 && res.items.length <= 38, `Expected 30..38, got ${res.items.length}`);
  const lowerSet = new Set(res.items.map((x) => x.toLowerCase()));
  assert.equal(lowerSet.size, res.items.length);
});

test('pickFallbackWordBank returns 6–8 short Grade 5 words/phrases', () => {
  const res = pickFallbackWordBank(db, {
    topicLabel: 'Tính tình',
    personRole: 'Bà ngoại',
    count: 8,
  });
  assert.equal(res.groupId, 'tinh-tinh');
  assert.equal(res.tu_ngu.length, 8);
  assert.ok(res.tra_loi.includes('Bà ngoại'));
});

test('pickUnseenQuestion avoids repeating previously seen questions', () => {
  const first = pickUnseenQuestion(db, {
    boxOrTopic: 'ngoaiHinh',
    personRole: 'Mẹ',
    seenQuestions: [],
  });
  assert.ok(first.question.length > 5);

  const second = pickUnseenQuestion(db, {
    boxOrTopic: 'ngoaiHinh',
    personRole: 'Mẹ',
    seenQuestions: [first.question],
  });
  assert.notEqual(second.question, first.question);

  const third = pickUnseenQuestion(db, {
    boxOrTopic: 'ngoaiHinh',
    personRole: 'Mẹ',
    seenQuestions: [first.question, second.question],
  });
  assert.notEqual(third.question, first.question);
  assert.notEqual(third.question, second.question);
});

test('buildLocalOutlineCheckFallback evaluates missing parts and supplies unseen questions', () => {
  const result = buildLocalOutlineCheckFallback(db, {
    nguoiTa: 'Bố',
    danY: {
      mo_bai: '',
      ngoai_hinh: ['dáng cao gầy'],
      tinh_tinh_hoat_dong: [],
      ket_bai: 'Em rất yêu bố',
    },
    seenQuestions: [],
  });
  assert.equal(result.du_3_phan, false);
  assert.equal(result.so_chi_tiet_ngoai_hinh, 1);
  assert.equal(result.so_chi_tiet_tinh_tinh_hoat_dong, 0);
  assert.ok(result.phan_con_thieu.length >= 3);
  assert.ok(result.cau_hoi_goi_y.length >= 1 && result.cau_hoi_goi_y.length <= 2);
});

test('kho_tu stats persist inside outline_check JSONB even when outline evaluation is null', () => {
  const mergedNull = mergeKhoTuIntoOutlineCheck(null, {
    mo_kho: 2,
    goi_y_tu_kho: 3,
    tu_da_luu: 4,
    auto_fallback: 1,
  });
  assert.ok(mergedNull !== null);
  assert.equal(hasOutlineCheckEvaluation(mergedNull), false);
  assert.deepEqual(extractKhoTuStats(mergedNull), {
    mo_kho: 2,
    goi_y_tu_kho: 3,
    tu_da_luu: 4,
    auto_fallback: 1,
  });

  const mergedEval = mergeKhoTuIntoOutlineCheck(
    {
      du_3_phan: true,
      so_chi_tiet_ngoai_hinh: 3,
      so_chi_tiet_tinh_tinh_hoat_dong: 2,
      phan_con_thieu: [],
      cau_hoi_goi_y: ['Hỏi thử?'],
    },
    { mo_kho: 1, goi_y_tu_kho: 2, tu_da_luu: 3, auto_fallback: 1 }
  );
  assert.equal(hasOutlineCheckEvaluation(mergedEval), true);

  const monotonic = mergeKhoTuStats(
    { mo_kho: 5, goi_y_tu_kho: 2, tu_da_luu: 1, auto_fallback: 1 },
    { mo_kho: 2, goi_y_tu_kho: 4, tu_da_luu: 3, auto_fallback: 0 }
  );
  assert.deepEqual(monotonic, {
    mo_kho: 5,
    goi_y_tu_kho: 4,
    tu_da_luu: 3,
    auto_fallback: 1,
  });
});

test('computeAiKhoRatio calculates accurate AI vs Kho percentages', () => {
  assert.deepEqual(computeAiKhoRatio(0, 0), {
    aiCount: 0,
    khoCount: 0,
    total: 0,
    aiPercent: 0,
    khoPercent: 0,
  });
  assert.deepEqual(computeAiKhoRatio(3, 1), {
    aiCount: 3,
    khoCount: 1,
    total: 4,
    aiPercent: 75,
    khoPercent: 25,
  });
});

test('buildTeacherExcelWorkbook includes exact "Gợi ý AI" and "Gợi ý kho" columns', async () => {
  const buffer = await buildTeacherExcelWorkbook({
    className: '5A',
    assignmentTitle: 'Tả người thân',
    rows: [
      {
        student_id: 's1',
        nickname: 'Minh Khôi',
        assignment_id: 'a1',
        assignment_title: 'Tả người thân',
        current_step: 5,
        outline_details: 6,
        draft_words: 150,
        revised_words: 180,
        edits_count: 12,
        ai_calls: 4,
        kho_suggestions: 7,
        feedback_rounds: 2,
        minutes_spent: 25,
        self_rubric: null,
        teacher_rubric: null,
        teacher_level: 'HTT',
        teacher_comment: 'Tốt',
        submitted_at: new Date().toISOString(),
      },
    ],
  });

  const wb = new ExcelJS.Workbook();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await wb.xlsx.load(ab);
  const sheet = wb.getWorksheet('Kết quả bài viết');
  assert.ok(sheet);
  const headers = (sheet.getRow(1).values as unknown[]).filter(Boolean);
  assert.ok(headers.includes('Gợi ý AI'), `Missing "Gợi ý AI" in headers: ${headers.join(', ')}`);
  assert.ok(headers.includes('Gợi ý kho'), `Missing "Gợi ý kho" in headers: ${headers.join(', ')}`);

  const aiIdx = headers.indexOf('Gợi ý AI') + 1;
  const khoIdx = headers.indexOf('Gợi ý kho') + 1;
  assert.equal(sheet.getRow(2).getCell(aiIdx).value, 4);
  assert.equal(sheet.getRow(2).getCell(khoIdx).value, 7);
});
