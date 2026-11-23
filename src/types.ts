export type StepNumber = 1 | 2 | 3 | 4 | 5;

export type PersonChoice =
  | 'Ông'
  | 'Bà'
  | 'Bố'
  | 'Mẹ'
  | 'Anh chị em'
  | 'Thầy cô'
  | 'Bạn'
  | 'Em bé'
  | 'Người khác';

export type ObservationBoxKey =
  | 'ngoaiHinh'
  | 'tinhTinh'
  | 'hoatDongLoiNoi'
  | 'tinhCam';

export interface ObservationNotes {
  ngoaiHinh: string[];
  tinhTinh: string[];
  hoatDongLoiNoi: string[];
  tinhCam: string[];
}

export interface OutlineData {
  moBai: string;
  ngoaiHinh: string[];
  tinhTinhHoatDong: string[];
  ketBai: string;
}

export interface OutlineCheckResult {
  du_3_phan: boolean;
  so_chi_tiet_ngoai_hinh: number;
  so_chi_tiet_tinh_tinh_hoat_dong: number;
  phan_con_thieu: string[];
  cau_hoi_goi_y: string[];
  checkedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export type SuggestionCategory =
  | 'chi_tiet'
  | 'dung_tu'
  | 'cau'
  | 'bo_cuc'
  | 'chinh_ta';

export interface EssaySuggestion {
  trich_doan: string;
  loai: SuggestionCategory;
  cau_hoi_goi_y: string;
}

export interface EssayReviewResult {
  id: string;
  attemptNumber: number;
  loi_khen: string;
  gop_y: EssaySuggestion[];
  timestamp: string;
}

export type SelfCheckAnswer = 'co' | 'chua' | null;

export interface SelfCheckState {
  duBaPhan: SelfCheckAnswer;
  baNetNgoaiHinh: SelfCheckAnswer;
  viecLamLoiNoi: SelfCheckAnswer;
  hinhAnhSoSanh: SelfCheckAnswer;
  ketBaiTinhCam: SelfCheckAnswer;
  suaChinhTa: SelfCheckAnswer;
}

export interface SelfRatingState {
  boCuc: number;
  ngoaiHinh: number;
  tinhTinhHoatDong: number;
  camXuc: number;
  dungTuChinhTa: number;
}

export type FeedbackHistoryKind =
  | 'quan_sat'
  | 'tro_chuyen'
  | 'kho_tu_ngu'
  | 'kiem_tra_dan_y'
  | 'gop_y_bai';

export interface FeedbackHistoryItem {
  id: string;
  step: 1 | 2 | 4;
  kind: FeedbackHistoryKind;
  title: string;
  promptSummary?: string;
  responseSummary: string;
  details?: string[];
  timestamp: string;
}

export interface WritingProject {
  id: string;
  currentStep: StepNumber;
  personChoice: PersonChoice | '';
  customPersonLabel: string;
  observations: ObservationNotes;
  observationPrompts: Partial<Record<ObservationBoxKey, string>>;
  outline: OutlineData;
  outlineSyncedFromStep1: boolean;
  outlineCheck: OutlineCheckResult | null;
  chatMessages: ChatMessage[];
  suggestedWords: string[];
  suggestedWordTopic: string;
  savedWords: string[];
  draftText: string;
  draftLocked: boolean;
  draftLockedAt: string | null;
  revisedText: string;
  selfCheck: SelfCheckState;
  essayReviews: EssayReviewResult[];
  selfRating: SelfRatingState;
  aiCallCount: number;
  feedbackHistory: FeedbackHistoryItem[];
  lastSavedAt: string | null;
}
