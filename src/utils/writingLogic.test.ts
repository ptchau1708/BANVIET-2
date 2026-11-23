import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHighlightedSegments,
  canNavigateToStep,
  computeWordDiff,
  countOutlineDetails,
  countParagraphs,
  countWords,
  createEmptyProject,
  getMaxUnlockedStep,
  shouldBlockPaste,
  syncObservationsToOutline,
} from './writingLogic';
import { createSampleGrandmaProject } from '../data/sampleData';

test('countWords and countParagraphs handle Vietnamese text with diacritics', () => {
  const sample = 'Bà nội em rất hiền.\n\nMái tóc bà bạc trắng, búi gọn sau gáy.';
  assert.equal(countWords(sample), 14);
  assert.equal(countParagraphs(sample), 2);
  assert.equal(countWords('   '), 0);
  assert.equal(countParagraphs('   '), 0);
});

test('shouldBlockPaste blocks pasted text strictly longer than 30 characters', () => {
  assert.equal(shouldBlockPaste('a'.repeat(30)), false);
  assert.equal(shouldBlockPaste('a'.repeat(31)), true);
  assert.equal(shouldBlockPaste('  ngắn thôi  '), false);
});

test('sequential step gating enforces finishing previous steps while allowing going back', () => {
  const p = createEmptyProject();
  assert.equal(getMaxUnlockedStep(p), 1);
  assert.equal(canNavigateToStep(p, 2), false);

  // Fill Step 1
  p.personChoice = 'Bà';
  p.observations.ngoaiHinh = ['Mái tóc bạc trắng'];
  p.observations.tinhTinh = ['Rất hiền hậu'];
  assert.equal(getMaxUnlockedStep(p), 2);
  assert.equal(canNavigateToStep(p, 2), true);
  assert.equal(canNavigateToStep(p, 3), false);

  // Fill Step 2 structurally (3 parts, >=3 appearance, >=2 personality/activity)
  p.outline = {
    moBai: 'Giới thiệu bà nội',
    ngoaiHinh: ['Tóc bạc', 'Dáng còng', 'Mắt hiền'],
    tinhTinhHoatDong: ['Hiền hậu', 'Tưới hoa buổi sáng'],
    ketBai: 'Em yêu bà nội',
  };
  assert.equal(getMaxUnlockedStep(p), 3);
  assert.equal(countOutlineDetails(p.outline), 7);

  // Draft must be locked to unlock Step 4
  p.draftText = 'Bà nội em rất hiền.';
  assert.equal(getMaxUnlockedStep(p), 3);
  p.draftLocked = true;
  assert.equal(getMaxUnlockedStep(p), 4);

  // Step 5 unlocks when all 6 self-check items are answered
  p.selfCheck = {
    duBaPhan: 'co',
    baNetNgoaiHinh: 'co',
    viecLamLoiNoi: 'co',
    hinhAnhSoSanh: 'chua',
    ketBaiTinhCam: 'co',
    suaChinhTa: 'co',
  };
  assert.equal(getMaxUnlockedStep(p), 5);
  p.currentStep = 5;
  assert.equal(canNavigateToStep(p, 1), true);
  assert.equal(canNavigateToStep(p, 3), true);
});

test('syncObservationsToOutline carries Step 1 notes without duplicating existing items', () => {
  const synced = syncObservationsToOutline(
    {
      ngoaiHinh: ['Tóc bạc', 'Mắt hiền'],
      tinhTinh: ['Hiền hậu'],
      hoatDongLoiNoi: ['Tưới hoa buổi sáng'],
      tinhCam: ['Yêu quý bà'],
    },
    {
      moBai: '',
      ngoaiHinh: ['Tóc bạc'],
      tinhTinhHoatDong: [],
      ketBai: '',
    },
    'Bà'
  );
  assert.deepEqual(synced.ngoaiHinh, ['Tóc bạc', 'Mắt hiền']);
  assert.deepEqual(synced.tinhTinhHoatDong, ['Hiền hậu', 'Tưới hoa buổi sáng']);
  assert.equal(synced.ketBai, 'Yêu quý bà');
  assert.ok(synced.moBai.includes('bà'));
});

test('computeWordDiff detects additions, removals, and counts edited spots', () => {
  const draft = 'Mái tóc bà bạc trắng. Em rất yêu bà.';
  const revised = 'Mái tóc bà bạc phơ như mây. Em vô cùng yêu quý bà nội.';
  const diff = computeWordDiff(draft, revised);
  assert.ok(diff.changeCount >= 2);
  assert.ok(diff.addedWords > 0);
  assert.ok(diff.removedWords > 0);
  assert.equal(diff.tokens.some((t) => t.type === 'added'), true);
  assert.equal(diff.tokens.some((t) => t.type === 'removed'), true);

  const identical = computeWordDiff(draft, draft);
  assert.equal(identical.changeCount, 0);
});

test('buildHighlightedSegments highlights matching trich_doan excerpts cleanly', () => {
  const essay = 'Mái tóc bà đã bạc trắng. Bàn tay bà gầy gầy, nổi rõ gân xanh.';
  const segments = buildHighlightedSegments(essay, [
    { trich_doan: 'bạc trắng', loai: 'dung_tu', cau_hoi_goi_y: 'Thử thêm hình ảnh so sánh?' },
    { trich_doan: 'nổi rõ gân xanh', loai: 'chi_tiet', cau_hoi_goi_y: 'Bàn tay bà ấm thế nào?' },
  ]);
  const highlighted = segments.filter((s) => s.suggestionIndex !== null);
  assert.equal(highlighted.length, 2);
  assert.equal(highlighted[0].text, 'bạc trắng');
  assert.equal(highlighted[1].text, 'nổi rõ gân xanh');
});

test('sample grandma project satisfies Step 1 and Step 2 readiness cleanly', () => {
  const sample = createSampleGrandmaProject();
  assert.equal(sample.personChoice, 'Bà');
  assert.equal(getMaxUnlockedStep(sample), 3);
  assert.ok(countWords(sample.draftText) > 100);
});
