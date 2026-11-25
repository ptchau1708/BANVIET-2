import {
  EssaySuggestion,
  KhoTuStats,
  OutlineData,
  SelfCheckState,
  SelfRatingState,
  SuggestionSource,
} from '../types';
import { clearSession, getAuthHeaders } from './session';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) {
      clearSession();
    }
    const msg =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : 'Không thể kết nối máy chủ lúc này. Em thử lại sau nhé!';
    throw new ApiError(msg, response.status);
  }
  return payload as T;
}

// ---------- Auth ----------

export interface AuthConfigResponse {
  appEnv?: 'production' | 'testing';
  databaseConfigured: boolean;
  googleConfigured: boolean;
  ltiEnabled?: boolean;
  openEduWebOrigin?: string;
  openEduTeacherOrigin?: string;
  openEduAllowedOrigins?: string[];
}

export function fetchAuthConfig(): Promise<AuthConfigResponse> {
  return requestJson<AuthConfigResponse>('/api/auth/config');
}

export function fetchGoogleAuthUrl(): Promise<{ url: string; redirectUri: string }> {
  return requestJson<{ url: string; redirectUri: string }>('/api/auth/google/url');
}

export interface ClassLookupResponse {
  classId: string;
  className: string;
  joinCode: string;
  students: Array<{ id: string; nickname: string }>;
}

export function lookupClassByJoinCode(joinCode: string): Promise<ClassLookupResponse> {
  return requestJson<ClassLookupResponse>('/api/auth/student/class-lookup', {
    method: 'POST',
    body: JSON.stringify({ joinCode }),
  });
}

export interface StudentLoginResponse {
  token: string;
  student: {
    id: string;
    nickname: string;
    classId: string;
    className: string;
  };
}

export function loginStudentWithPin(params: {
  classId: string;
  studentId: string;
  pin: string;
}): Promise<StudentLoginResponse> {
  return requestJson<StudentLoginResponse>('/api/auth/student/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---------- Student Portal & Submissions ----------

export interface StudentProfile {
  id: string;
  nickname: string;
  classId: string;
  className: string;
  joinCode: string;
  aiEnabled: boolean;
  aiDailyLimit: number;
  aiUsedToday: number;
}

export interface StudentAssignmentSummary {
  id: string;
  title: string;
  prompt_text: string | null;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  submission_id: string | null;
  current_step: number | null;
  draft_locked_at: string | null;
  submitted_at: string | null;
  teacher_level: 'HTT' | 'HT' | 'CHT' | null;
  teacher_comment: string | null;
  updated_at: string | null;
}

export function fetchStudentMe(): Promise<{
  student: StudentProfile;
  assignments: StudentAssignmentSummary[];
}> {
  return requestJson('/api/student/me');
}

export interface DbAiEvent {
  id: number | string;
  step: number;
  endpoint: 'goi-y' | 'kiem-tra-dan-y' | 'gop-y-bai';
  request_text: string | null;
  response_json: Record<string, unknown> | null;
  flagged: boolean;
  created_at: string;
}

export interface DbMetrics {
  outline_details: number;
  draft_words: number;
  revised_words: number;
  edits_count: number;
  ai_calls: number;
  feedback_rounds: number;
  minutes_spent: number;
  updated_at?: string;
}

export interface StudentSubmissionPayload {
  assignment: {
    id: string;
    title: string;
    prompt_text: string | null;
    opens_at: string | null;
    closes_at: string | null;
  };
  aiSettings: {
    aiEnabled: boolean;
    aiDailyLimit: number;
    aiUsedToday: number;
    appAiRemaining?: number | null;
    aiAvailableForHints?: boolean;
    aiAvailableForStep4?: boolean;
  };
  submission: {
    id: string;
    assignment_id: string;
    student_id: string;
    current_step: number;
    observation: Record<string, unknown> | null;
    outline: Record<string, unknown> | null;
    outline_check: Record<string, unknown> | null;
    draft_text: string | null;
    draft_locked_at: string | null;
    revised_text: string | null;
    self_checklist: SelfCheckState | null;
    self_rubric: SelfRatingState | null;
    teacher_rubric: SelfRatingState | null;
    teacher_level: 'HTT' | 'HT' | 'CHT' | null;
    teacher_comment: string | null;
    submitted_at: string | null;
    updated_at: string | null;
  };
  aiEvents: DbAiEvent[];
  metrics: DbMetrics | null;
}

export function fetchStudentSubmission(assignmentId: string): Promise<StudentSubmissionPayload> {
  return requestJson(`/api/student/assignments/${assignmentId}/submission`);
}

export function saveStudentSubmission(
  submissionId: string,
  body: {
    current_step: number;
    observation: Record<string, unknown>;
    outline: Record<string, unknown>;
    outline_check: Record<string, unknown> | null;
    draft_text: string;
    revised_text: string;
    self_checklist: SelfCheckState;
    self_rubric: SelfRatingState;
    lock_draft?: boolean;
    mark_submitted?: boolean;
    step_completed?: boolean;
    delta_minutes?: number;
  }
): Promise<{
  saved: boolean;
  submission: {
    id: string;
    current_step: number;
    draft_locked_at: string | null;
    submitted_at: string | null;
    updated_at: string;
  };
  metrics: DbMetrics | null;
}> {
  return requestJson(`/api/student/submissions/${submissionId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// ---------- Student AI Endpoints (3 strictly scoped routes) ----------

export interface GoiYResponse {
  nguon?: SuggestionSource;
  thong_bao?: string;
  fallback_reason?: string;
  tra_loi?: string;
  tu_ngu?: string[];
  kho_nhom_id?: string;
  kho_chu_de_id?: string;
  aiUsedToday?: number;
  aiDailyLimit?: number;
  aiRemainingToday?: number;
  appAiRemaining?: number | null;
  khoTuStats?: KhoTuStats;
  eventId?: string | number;
}

export function fetchGoiY(params: {
  submission_id: string;
  buoc: 1 | 2;
  che_do: 'quan_sat' | 'tro_chuyen' | 'kho_tu_ngu';
  nguoi_ta: string;
  muc?: string;
  ghi_chu?: string[];
  tin_nhan?: string;
  lich_su_chat?: Array<{ role: 'user' | 'assistant'; text: string }>;
  dan_y_tom_tat?: string;
  cau_hoi_da_xem?: string[];
}): Promise<GoiYResponse> {
  return requestJson<GoiYResponse>('/api/goi-y', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface KiemTraDanYApiResponse {
  nguon?: SuggestionSource;
  thong_bao?: string;
  fallback_reason?: string;
  du_3_phan: boolean;
  so_chi_tiet_ngoai_hinh: number;
  so_chi_tiet_tinh_tinh_hoat_dong: number;
  phan_con_thieu: string[];
  cau_hoi_goi_y: string[];
  aiUsedToday?: number;
  aiDailyLimit?: number;
  aiRemainingToday?: number;
  appAiRemaining?: number | null;
  khoTuStats?: KhoTuStats;
}

export function fetchKiemTraDanY(params: {
  submission_id: string;
  nguoi_ta: string;
  dan_y: OutlineData;
  cau_hoi_da_xem?: string[];
}): Promise<KiemTraDanYApiResponse> {
  return requestJson<KiemTraDanYApiResponse>('/api/kiem-tra-dan-y', {
    method: 'POST',
    body: JSON.stringify({
      submission_id: params.submission_id,
      nguoi_ta: params.nguoi_ta,
      dan_y: {
        mo_bai: params.dan_y.moBai,
        ngoai_hinh: params.dan_y.ngoaiHinh,
        tinh_tinh_hoat_dong: params.dan_y.tinhTinhHoatDong,
        ket_bai: params.dan_y.ketBai,
      },
      cau_hoi_da_xem: params.cau_hoi_da_xem,
    }),
  });
}

export interface GopYBaiApiResponse {
  nguon?: SuggestionSource;
  aiUnavailable?: boolean;
  fallback_reason?: string;
  thong_bao?: string;
  goi_y_ban_be?: string;
  loi_khen: string;
  gop_y: EssaySuggestion[];
  attemptNumber?: number;
  aiUsedToday?: number;
  aiDailyLimit?: number;
  aiRemainingToday?: number;
  appAiRemaining?: number | null;
  khoTuStats?: KhoTuStats;
}

export function fetchGopYBai(params: {
  submission_id: string;
  nguoi_ta: string;
  bai_van: string;
  lan_thu: number;
}): Promise<GopYBaiApiResponse> {
  return requestJson<GopYBaiApiResponse>('/api/gop-y-bai', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---------- Teacher Portal API ----------

export interface TeacherProfile {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface TeacherClassSummary {
  id: string;
  name: string;
  join_code: string;
  ai_enabled: boolean;
  ai_daily_limit: number;
  created_at: string;
  student_count: number;
  assignment_count: number;
  flagged_count: number;
}

export interface TeacherStudentRow {
  id: string;
  class_id: string;
  nickname: string;
  failed_pin: number;
  locked_until: string | null;
  created_at: string;
}

export interface TeacherAssignmentRow {
  id: string;
  class_id: string;
  title: string;
  prompt_text: string | null;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  started_count: number;
  submitted_count: number;
}

export interface TrackerStudentRow {
  student_id: string;
  nickname: string;
  submission_id: string | null;
  current_step: number;
  draft_locked_at: string | null;
  submitted_at: string | null;
  teacher_level: 'HTT' | 'HT' | 'CHT' | null;
  updated_at: string | null;
  outline_details: number;
  draft_words: number;
  revised_words: number;
  edits_count: number;
  ai_calls: number;
  feedback_rounds: number;
  kho_suggestions_count?: number;
  kho_mo_kho?: number;
  kho_tu_da_luu?: number;
  flagged_count: number;
}

export interface TeacherSubmissionDetail {
  submission: {
    id: string;
    nickname: string;
    class_name: string;
    assignment_title: string;
    assignment_prompt: string | null;
    current_step: number;
    observation: Record<string, unknown> | null;
    outline: Record<string, unknown> | null;
    outline_check: Record<string, unknown> | null;
    draft_text: string | null;
    draft_locked_at: string | null;
    revised_text: string | null;
    self_checklist: SelfCheckState | null;
    self_rubric: SelfRatingState | null;
    teacher_rubric: SelfRatingState | null;
    teacher_level: 'HTT' | 'HT' | 'CHT' | null;
    teacher_comment: string | null;
    submitted_at: string | null;
    updated_at: string | null;
  };
  aiEvents: DbAiEvent[];
  metrics: DbMetrics | null;
  khoTuStats?: KhoTuStats;
}

export function fetchTeacherMe(): Promise<{
  teacher: TeacherProfile;
  classes: TeacherClassSummary[];
}> {
  return requestJson('/api/teacher/me');
}

export function createTeacherClass(body: {
  name: string;
  ai_enabled?: boolean;
  ai_daily_limit?: number;
}): Promise<{ class: TeacherClassSummary }> {
  return requestJson('/api/teacher/classes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateTeacherClass(
  classId: string,
  body: { name?: string; ai_enabled?: boolean; ai_daily_limit?: number }
): Promise<{ class: TeacherClassSummary }> {
  return requestJson(`/api/teacher/classes/${classId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function fetchClassStudents(
  classId: string
): Promise<{ class: TeacherClassSummary; students: TeacherStudentRow[] }> {
  return requestJson(`/api/teacher/classes/${classId}/students`);
}

export function bulkCreateStudents(
  classId: string,
  body: { nicknamesText: string; fixedPin?: string }
): Promise<{
  created: Array<{ id: string; nickname: string; pin: string }>;
  skipped: string[];
  joinCode: string;
  className: string;
}> {
  return requestJson(`/api/teacher/classes/${classId}/students/bulk`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resetStudentPin(
  studentId: string,
  pin?: string
): Promise<{
  studentId: string;
  nickname: string;
  className: string;
  joinCode: string;
  pin: string;
}> {
  return requestJson(`/api/teacher/students/${studentId}/reset-pin`, {
    method: 'POST',
    body: JSON.stringify(pin ? { pin } : {}),
  });
}

export function fetchClassAssignments(
  classId: string
): Promise<{ assignments: TeacherAssignmentRow[] }> {
  return requestJson(`/api/teacher/classes/${classId}/assignments`);
}

export function createClassAssignment(
  classId: string,
  body: {
    title: string;
    prompt_text: string;
    opens_at?: string | null;
    closes_at?: string | null;
  }
): Promise<{ assignment: TeacherAssignmentRow }> {
  return requestJson(`/api/teacher/classes/${classId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchAssignmentTracker(assignmentId: string): Promise<{
  assignment: TeacherAssignmentRow;
  rows: TrackerStudentRow[];
}> {
  return requestJson(`/api/teacher/assignments/${assignmentId}/tracker`);
}

export function fetchTeacherSubmissionDetail(
  submissionId: string
): Promise<TeacherSubmissionDetail> {
  return requestJson(`/api/teacher/submissions/${submissionId}`);
}

export function gradeStudentSubmission(
  submissionId: string,
  body: {
    teacher_rubric: SelfRatingState;
    teacher_level: 'HTT' | 'HT' | 'CHT' | null;
    teacher_comment: string;
  }
): Promise<{ submission: Record<string, unknown> }> {
  return requestJson(`/api/teacher/submissions/${submissionId}/grade`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function toggleAiEventFlag(
  eventId: number | string,
  flagged: boolean
): Promise<{ event: { id: string; flagged: boolean } }> {
  return requestJson(`/api/teacher/ai-events/${eventId}/flag`, {
    method: 'PATCH',
    body: JSON.stringify({ flagged }),
  });
}

export async function downloadTeacherExcel(params: {
  classId: string;
  assignmentId?: string;
  compareA?: string;
  compareB?: string;
}): Promise<void> {
  const qs = new URLSearchParams({ classId: params.classId });
  if (params.assignmentId) qs.set('assignmentId', params.assignmentId);
  if (params.compareA && params.compareB) {
    qs.set('compareA', params.compareA);
    qs.set('compareB', params.compareB);
  }

  const res = await fetch(`/api/teacher/export/xlsx?${qs.toString()}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || 'Không xuất được tệp Excel.');
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ban-viet-bao-cao.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ---------- Teacher LTI 1.3 Connection & Outbox ----------

export interface TeacherLtiStatusResponse {
  appEnv: 'production' | 'testing';
  frameAncestorsHeader: string | null;
  endpoints: {
    loginUrl: string;
    launchUrl: string;
    jwksUrl: string;
    jwksAliasUrl: string;
    issuer: string;
    authorizationEndpoint: string;
    openEduWebOrigin: string;
    openEduTeacherOrigin: string;
    clientId: string;
    deploymentId: string;
  };
  secrets: {
    LTI_CLIENT_ID: boolean;
    LTI_DEPLOYMENT_ID: boolean;
    OPENEDU_WEB_ORIGIN: boolean;
    OPENEDU_TEACHER_ORIGIN: boolean;
    TOOL_PRIVATE_JWK: boolean;
    DATABASE_URL: boolean;
    SESSION_SECRET: boolean;
    allReady: boolean;
  };
  outbox: {
    pendingCount: number;
    failedCount: number;
    sentCount: number;
    lastError: string | null;
    lastErrorKind: string | null;
    lastErrorAt: string | null;
  };
  aiQuota?: {
    provider: 'openrouter' | 'gemini' | 'none';
    configured: boolean;
    remainingToday: number | null;
    dailyLimit: number | null;
    reserveForStep4: number;
    checkedAt: string | null;
    error: string | null;
    autoFallbackCount: number;
  };
}

export function fetchTeacherLtiStatus(): Promise<TeacherLtiStatusResponse> {
  return requestJson<TeacherLtiStatusResponse>('/api/teacher/lti/status');
}

export function retryTeacherLtiOutbox(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  lastError: string | null;
}> {
  return requestJson('/api/teacher/lti/outbox/retry', {
    method: 'POST',
  });
}
