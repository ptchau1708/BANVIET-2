import {
  EssaySuggestion,
  ObservationNotes,
  OutlineData,
  SelfCheckState,
  StepNumber,
  WritingProject,
} from '../types';

export const PASTE_LIMIT_CHARS = 30;
export const MAX_ESSAY_CHARS = 3000;
export const MAX_MESSAGE_CHARS = 300;
export const MAX_ESSAY_REVIEWS = 3;

export function getDisplayPersonName(project: Pick<WritingProject, 'personChoice' | 'customPersonLabel'>): string {
  if (project.personChoice === 'Người khác') {
    return project.customPersonLabel.trim() || 'người thân';
  }
  return project.personChoice || '';
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function countParagraphs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/\n\s*\n+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

export function countOutlineDetails(outline: OutlineData): number {
  const mo = outline.moBai.trim() ? 1 : 0;
  const ket = outline.ketBai.trim() ? 1 : 0;
  const ngoai = outline.ngoaiHinh.filter((x) => x.trim().length > 0).length;
  const tinh = outline.tinhTinhHoatDong.filter((x) => x.trim().length > 0).length;
  return mo + ket + ngoai + tinh;
}

export function shouldBlockPaste(pastedText: string): boolean {
  return pastedText.trim().length > PASTE_LIMIT_CHARS;
}

export function isStep1Complete(project: WritingProject): boolean {
  const person = getDisplayPersonName(project);
  if (!person) return false;
  const filledBoxes = [
    project.observations.ngoaiHinh.length > 0,
    project.observations.tinhTinh.length > 0,
    project.observations.hoatDongLoiNoi.length > 0,
    project.observations.tinhCam.length > 0,
  ].filter(Boolean).length;
  return filledBoxes >= 2;
}

export function isOutlineStructurallyReady(outline: OutlineData): boolean {
  const hasMo = outline.moBai.trim().length > 0;
  const hasKet = outline.ketBai.trim().length > 0;
  const ngoaiCount = outline.ngoaiHinh.filter((x) => x.trim().length > 0).length;
  const tinhCount = outline.tinhTinhHoatDong.filter((x) => x.trim().length > 0).length;
  return hasMo && hasKet && ngoaiCount >= 3 && tinhCount >= 2;
}

export function isStep2Complete(project: WritingProject): boolean {
  if (!isStep1Complete(project)) return false;
  if (
    project.outlineCheck &&
    project.outlineCheck.du_3_phan &&
    project.outlineCheck.so_chi_tiet_ngoai_hinh >= 3 &&
    project.outlineCheck.so_chi_tiet_tinh_tinh_hoat_dong >= 2
  ) {
    return true;
  }
  return isOutlineStructurallyReady(project.outline);
}

export function isStep3Complete(project: WritingProject): boolean {
  return isStep2Complete(project) && project.draftLocked && project.draftText.trim().length > 0;
}

export function countAnsweredSelfChecks(selfCheck: SelfCheckState): number {
  return Object.values(selfCheck).filter((v) => v === 'co' || v === 'chua').length;
}

export function isStep4Complete(project: WritingProject): boolean {
  if (!isStep3Complete(project)) return false;
  return countAnsweredSelfChecks(project.selfCheck) === 6;
}

export function getMaxUnlockedStep(project: WritingProject): StepNumber {
  if (!isStep1Complete(project)) return 1;
  if (!isStep2Complete(project)) return 2;
  if (!isStep3Complete(project)) return 3;
  if (!isStep4Complete(project)) return 4;
  return 5;
}

export function canNavigateToStep(project: WritingProject, target: StepNumber): boolean {
  if (target <= project.currentStep) return true;
  return target <= getMaxUnlockedStep(project);
}

export function syncObservationsToOutline(
  obs: ObservationNotes,
  current: OutlineData,
  personLabel: string
): OutlineData {
  const mergeUnique = (existing: string[], incoming: string[]) => {
    const seen = new Set(existing.map((s) => s.trim().toLowerCase()));
    const merged = [...existing];
    for (const item of incoming) {
      const cleaned = item.trim();
      if (cleaned && !seen.has(cleaned.toLowerCase())) {
        seen.add(cleaned.toLowerCase());
        merged.push(cleaned);
      }
    }
    return merged;
  };

  const ngoaiHinh = mergeUnique(current.ngoaiHinh, obs.ngoaiHinh);
  const tinhTinhHoatDong = mergeUnique(current.tinhTinhHoatDong, [
    ...obs.tinhTinh,
    ...obs.hoatDongLoiNoi,
  ]);
  const ketBai =
    current.ketBai.trim() ||
    (obs.tinhCam.length > 0 ? obs.tinhCam.join('; ') : '');
  const moBai =
    current.moBai.trim() ||
    (personLabel ? `Giới thiệu ${personLabel.toLowerCase()} (người em yêu quý nhất)` : '');

  return {
    moBai,
    ngoaiHinh,
    tinhTinhHoatDong,
    ketBai,
  };
}

export interface DiffToken {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export interface WordDiffResult {
  tokens: DiffToken[];
  changeCount: number;
  addedWords: number;
  removedWords: number;
}

function tokenizeForDiff(text: string): string[] {
  if (!text) return [];
  // Keep words and whitespace/newlines as separate tokens so paragraph formatting stays intact
  return text.match(/\S+|\s+/g) ?? [];
}

/**
 * Computes a clean word-level diff between locked draft and revised text using LCS.
 * Returns diff tokens plus the count of distinct edited spots (contiguous change groups).
 */
export function computeWordDiff(draft: string, revised: string): WordDiffResult {
  const a = tokenizeForDiff(draft.trim());
  const b = tokenizeForDiff(revised.trim());

  const n = a.length;
  const m = b.length;

  // Build LCS table (essay is <= 3000 chars, roughly <= 700 words, so O(nm) is < 5ms)
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const rawTokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rawTokens.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawTokens.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      rawTokens.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    rawTokens.push({ type: 'removed', text: a[i++] });
  }
  while (j < m) {
    rawTokens.push({ type: 'added', text: b[j++] });
  }

  // Merge adjacent tokens of the same type
  const merged: DiffToken[] = [];
  for (const tok of rawTokens) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === tok.type) {
      prev.text += tok.text;
    } else {
      merged.push({ ...tok });
    }
  }

  // Count distinct edited spots (each contiguous run of non-same tokens with at least one non-whitespace char)
  let changeCount = 0;
  let inChangeRun = false;
  let addedWords = 0;
  let removedWords = 0;

  for (const tok of merged) {
    const isWhitespaceOnly = tok.text.trim().length === 0;
    if (tok.type === 'same') {
      if (!isWhitespaceOnly) {
        inChangeRun = false;
      }
    } else {
      if (tok.type === 'added') addedWords += countWords(tok.text);
      if (tok.type === 'removed') removedWords += countWords(tok.text);
      if (!isWhitespaceOnly && !inChangeRun) {
        changeCount++;
        inChangeRun = true;
      }
    }
  }

  return { tokens: merged, changeCount, addedWords, removedWords };
}

export interface HighlightSegment {
  text: string;
  suggestionIndex: number | null;
}

/**
 * Splits essay text into safe plain/highlighted segments matching AI `trich_doan` excerpts.
 * Never produces HTML strings; safe to render directly in React JSX.
 */
export function buildHighlightedSegments(
  essay: string,
  suggestions: EssaySuggestion[]
): HighlightSegment[] {
  if (!essay) return [];
  if (!suggestions.length) return [{ text: essay, suggestionIndex: null }];

  const lowerEssay = essay.toLowerCase();
  const ranges: Array<{ start: number; end: number; suggestionIndex: number }> = [];

  suggestions.forEach((s, idx) => {
    const quote = s.trich_doan.trim();
    if (!quote) return;
    const pos = lowerEssay.indexOf(quote.toLowerCase());
    if (pos !== -1) {
      ranges.push({ start: pos, end: pos + quote.length, suggestionIndex: idx });
    }
  });

  if (ranges.length === 0) {
    return [{ text: essay, suggestionIndex: null }];
  }

  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // skip overlapping match
    if (range.start > cursor) {
      segments.push({ text: essay.slice(cursor, range.start), suggestionIndex: null });
    }
    segments.push({
      text: essay.slice(range.start, range.end),
      suggestionIndex: range.suggestionIndex,
    });
    cursor = range.end;
  }

  if (cursor < essay.length) {
    segments.push({ text: essay.slice(cursor), suggestionIndex: null });
  }

  return segments;
}

export function createEmptyProject(): WritingProject {
  return {
    id: `bv-${Date.now()}`,
    currentStep: 1,
    personChoice: '',
    customPersonLabel: '',
    observations: {
      ngoaiHinh: [],
      tinhTinh: [],
      hoatDongLoiNoi: [],
      tinhCam: [],
    },
    observationPrompts: {},
    observationPromptMeta: {},
    outline: {
      moBai: '',
      ngoaiHinh: [],
      tinhTinhHoatDong: [],
      ketBai: '',
    },
    outlineSyncedFromStep1: false,
    outlineCheck: null,
    chatMessages: [],
    suggestedWords: [],
    suggestedWordTopic: 'Mái tóc',
    suggestedWordSource: undefined,
    suggestedWordNotice: null,
    savedWords: [],
    khoTuStats: {
      mo_kho: 0,
      goi_y_tu_kho: 0,
      tu_da_luu: 0,
      auto_fallback: 0,
    },
    seenKhoQuestions: [],
    draftText: '',
    draftLocked: false,
    draftLockedAt: null,
    revisedText: '',
    selfCheck: {
      duBaPhan: null,
      baNetNgoaiHinh: null,
      viecLamLoiNoi: null,
      hinhAnhSoSanh: null,
      ketBaiTinhCam: null,
      suaChinhTa: null,
    },
    essayReviews: [],
    selfRating: {
      boCuc: 0,
      ngoaiHinh: 0,
      tinhTinhHoatDong: 0,
      camXuc: 0,
      dungTuChinhTa: 0,
    },
    aiCallCount: 0,
    feedbackHistory: [],
    lastSavedAt: null,
  };
}
