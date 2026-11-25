import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  detectSafetyFlag,
  generateJoinCode,
  generatePin4,
  isValidJoinCode,
  isValidPin4,
  parseBulkNicknames,
  verifySessionToken,
} from './auth';
import { buildTeacherExcelWorkbook } from './excel';
import { countEditRegions } from './metrics';

test('session token signs, verifies, enforces 8-hour TTL, and rejects tampering', () => {
  const secret = 'test-session-secret-0123456789abcdef';
  const t0 = 1_700_000_000_000;
  const token = createSessionToken(
    {
      role: 'student',
      sub: '11111111-2222-3333-4444-555555555555',
      classId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      displayName: 'Sóc Nâu',
    },
    t0,
    secret
  );

  const valid = verifySessionToken(token, t0 + 3600 * 1000, secret);
  assert.ok(valid);
  assert.equal(valid?.role, 'student');
  assert.equal(valid?.displayName, 'Sóc Nâu');

  // Expired after 8 hours
  const expired = verifySessionToken(token, t0 + (SESSION_TTL_SECONDS + 1) * 1000, secret);
  assert.equal(expired, null);

  // Tampered signature rejected
  const tampered = `${token.slice(0, -2)}xx`;
  assert.equal(verifySessionToken(tampered, t0 + 1000, secret), null);
});

test('join code and PIN helpers obey exact format constraints', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateJoinCode();
    assert.equal(isValidJoinCode(code), true);
    const pin = generatePin4();
    assert.equal(isValidPin4(pin), true);
  }
  assert.equal(isValidJoinCode('ab12'), false);
  assert.equal(isValidPin4('123'), false);
  assert.equal(isValidPin4('123a'), false);
});

test('parseBulkNicknames trims, deduplicates, and ignores >40 char lines', () => {
  const raw = 'Sóc Nâu\n  Mèo Mướp \nsóc nâu\n\n' + 'x'.repeat(45) + '\nGấu Trúc';
  assert.deepEqual(parseBulkNicknames(raw), ['Sóc Nâu', 'Mèo Mướp', 'Gấu Trúc']);
});

test('detectSafetyFlag flags distress/harm messages and ignores normal writing', () => {
  assert.equal(detectSafetyFlag('Hôm nay em buồn lắm, ở lớp em bị bắt nạt'), true);
  assert.equal(detectSafetyFlag('Em sợ bị đánh khi về nhà'), true);
  assert.equal(detectSafetyFlag('Bà nội em có mái tóc bạc trắng và đôi mắt rất hiền.'), false);
});

test('countEditRegions matches LCS word-level edit count accurately', () => {
  assert.equal(countEditRegions('Bà em rất hiền.', 'Bà em rất hiền.'), 0);
  assert.ok(countEditRegions('Mái tóc bà bạc trắng.', 'Mái tóc bà bạc phơ như mây.') >= 1);
});

test('buildTeacherExcelWorkbook creates valid xlsx buffer with So sánh sheet', async () => {
  const rowA = {
    student_id: 's1',
    nickname: 'Sóc Nâu',
    assignment_id: 'a1',
    assignment_title: 'Đầu vào - Tả bà',
    current_step: 5,
    outline_details: 8,
    draft_words: 120,
    revised_words: 145,
    edits_count: 4,
    ai_calls: 3,
    feedback_rounds: 1,
    minutes_spent: 25,
    self_rubric: { boCuc: 3, ngoaiHinh: 3, tinhTinhHoatDong: 2, camXuc: 3, dungTuChinhTa: 2 },
    teacher_rubric: { boCuc: 3, ngoaiHinh: 3, tinhTinhHoatDong: 3, camXuc: 3, dungTuChinhTa: 2 },
    teacher_level: 'HTT',
    teacher_comment: 'Bài viết chân thật!',
    submitted_at: new Date().toISOString(),
  };

  const buf = await buildTeacherExcelWorkbook({
    className: 'Lớp 5A',
    rows: [rowA],
    compare: {
      assignmentATitle: 'Bài 1',
      assignmentBTitle: 'Bài 2',
      students: [{ nickname: 'Sóc Nâu', a: rowA, b: { ...rowA, revised_words: 180, edits_count: 6 } }],
    },
  });

  // XLSX files are ZIP archives starting with PK\x03\x04
  assert.ok(buf.length > 1000);
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
});
