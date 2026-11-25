import ExcelJS from 'exceljs';

export interface ExportSubmissionRow {
  student_id: string;
  nickname: string;
  assignment_id: string;
  assignment_title: string;
  current_step: number;
  outline_details: number;
  draft_words: number;
  revised_words: number;
  edits_count: number;
  ai_calls: number;
  kho_suggestions?: number;
  feedback_rounds: number;
  minutes_spent: number;
  self_rubric: Record<string, number> | null;
  teacher_rubric: Record<string, number> | null;
  teacher_level: string | null;
  teacher_comment: string | null;
  submitted_at: string | Date | null;
}

const RUBRIC_KEYS: Array<{ key: string; label: string }> = [
  { key: 'boCuc', label: 'Bố cục' },
  { key: 'ngoaiHinh', label: 'Ngoại hình' },
  { key: 'tinhTinhHoatDong', label: 'Tính tình/HĐ' },
  { key: 'camXuc', label: 'Cảm xúc' },
  { key: 'dungTuChinhTa', label: 'Từ/Câu/CT' },
];

function fmtDate(val: string | Date | null | undefined): string {
  if (!val) return '';
  try {
    return new Date(val).toLocaleString('vi-VN');
  } catch {
    return '';
  }
}

function getScore(rubric: Record<string, number> | null | undefined, key: string): number | string {
  if (!rubric || typeof rubric !== 'object') return '';
  const v = rubric[key];
  return typeof v === 'number' && v > 0 ? v : '';
}

function rubricTotal(rubric: Record<string, number> | null | undefined): number | string {
  if (!rubric || typeof rubric !== 'object') return '';
  const sum = RUBRIC_KEYS.reduce((acc, r) => acc + (Number(rubric[r.key]) || 0), 0);
  return sum > 0 ? sum : '';
}

export async function buildTeacherExcelWorkbook(params: {
  className: string;
  assignmentTitle?: string;
  rows: ExportSubmissionRow[];
  compare?: {
    assignmentATitle: string;
    assignmentBTitle: string;
    students: Array<{
      nickname: string;
      a?: ExportSubmissionRow;
      b?: ExportSubmissionRow;
    }>;
  };
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bạn Viết';
  wb.created = new Date();

  const sheetTitle = params.assignmentTitle ? 'Kết quả bài viết' : 'Tổng hợp cả lớp';
  const sheet = wb.addWorksheet(sheetTitle);

  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'Biệt danh', key: 'nickname', width: 22 },
  ];
  if (!params.assignmentTitle) {
    columns.push({ header: 'Bài tập', key: 'assignment_title', width: 28 });
  }
  columns.push(
    { header: 'Bước hiện tại', key: 'current_step', width: 14 },
    { header: 'Chi tiết dàn ý', key: 'outline_details', width: 15 },
    { header: 'Từ bản nháp', key: 'draft_words', width: 14 },
    { header: 'Từ bản sửa', key: 'revised_words', width: 14 },
    { header: 'Số chỗ tự sửa', key: 'edits_count', width: 15 },
    { header: 'Gợi ý AI', key: 'ai_calls', width: 12 },
    { header: 'Gợi ý kho', key: 'kho_suggestions', width: 12 },
    { header: 'Lần đọc giúp', key: 'feedback_rounds', width: 14 },
    { header: 'Phút làm bài', key: 'minutes_spent', width: 14 },
    ...RUBRIC_KEYS.map((r) => ({
      header: `Tự ĐG: ${r.label}`,
      key: `self_${r.key}`,
      width: 15,
    })),
    ...RUBRIC_KEYS.map((r) => ({
      header: `GV: ${r.label}`,
      key: `teacher_${r.key}`,
      width: 15,
    })),
    { header: 'Mức xếp loại', key: 'teacher_level', width: 14 },
    { header: 'Nhận xét của GV', key: 'teacher_comment', width: 34 },
    { header: 'Ngày nộp', key: 'submitted_at', width: 20 }
  );

  sheet.columns = columns;

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF15803D' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 28;

  for (const row of params.rows) {
    const entry: Record<string, unknown> = {
      nickname: row.nickname,
      assignment_title: row.assignment_title,
      current_step: row.current_step,
      outline_details: row.outline_details,
      draft_words: row.draft_words,
      revised_words: row.revised_words,
      edits_count: row.edits_count,
      ai_calls: row.ai_calls,
      kho_suggestions: Number(row.kho_suggestions ?? 0),
      feedback_rounds: row.feedback_rounds,
      minutes_spent: row.minutes_spent,
      teacher_level: row.teacher_level ?? '',
      teacher_comment: row.teacher_comment ?? '',
      submitted_at: fmtDate(row.submitted_at),
    };
    for (const r of RUBRIC_KEYS) {
      entry[`self_${r.key}`] = getScore(row.self_rubric, r.key);
      entry[`teacher_${r.key}`] = getScore(row.teacher_rubric, r.key);
    }
    sheet.addRow(entry);
  }

  // Optional "So sánh" sheet placing Assignment A (đầu vào) and Assignment B (đầu ra) side by side
  if (params.compare) {
    const cmp = wb.addWorksheet('So sánh');
    const aLabel = `Đầu vào (${params.compare.assignmentATitle})`;
    const bLabel = `Đầu ra (${params.compare.assignmentBTitle})`;

    cmp.columns = [
      { header: 'Biệt danh', key: 'nickname', width: 22 },
      { header: `${aLabel} - Từ bản sửa`, key: 'a_words', width: 18 },
      { header: `${bLabel} - Từ bản sửa`, key: 'b_words', width: 18 },
      { header: 'Chênh lệch từ', key: 'diff_words', width: 15 },
      { header: `${aLabel} - Chỗ tự sửa`, key: 'a_edits', width: 18 },
      { header: `${bLabel} - Chỗ tự sửa`, key: 'b_edits', width: 18 },
      { header: `${aLabel} - Lượt AI`, key: 'a_ai', width: 15 },
      { header: `${bLabel} - Lượt AI`, key: 'b_ai', width: 15 },
      { header: `${aLabel} - Điểm GV (/15)`, key: 'a_gv_total', width: 18 },
      { header: `${bLabel} - Điểm GV (/15)`, key: 'b_gv_total', width: 18 },
      { header: `${aLabel} - Mức`, key: 'a_level', width: 14 },
      { header: `${bLabel} - Mức`, key: 'b_level', width: 14 },
    ];

    const cmpHeader = cmp.getRow(1);
    cmpHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cmpHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0369A1' },
    };
    cmpHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cmpHeader.height = 30;

    for (const st of params.compare.students) {
      const aWords = st.a?.revised_words ?? 0;
      const bWords = st.b?.revised_words ?? 0;
      cmp.addRow({
        nickname: st.nickname,
        a_words: st.a ? aWords : '',
        b_words: st.b ? bWords : '',
        diff_words: st.a && st.b ? bWords - aWords : '',
        a_edits: st.a?.edits_count ?? '',
        b_edits: st.b?.edits_count ?? '',
        a_ai: st.a?.ai_calls ?? '',
        b_ai: st.b?.ai_calls ?? '',
        a_gv_total: rubricTotal(st.a?.teacher_rubric),
        b_gv_total: rubricTotal(st.b?.teacher_rubric),
        a_level: st.a?.teacher_level ?? '',
        b_level: st.b?.teacher_level ?? '',
      });
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
