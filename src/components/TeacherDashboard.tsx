import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookPlus,
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  KeyRound,
  LayoutGrid,
  Link2,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import {
  TeacherAssignmentRow,
  TeacherClassSummary,
  TeacherProfile,
  TeacherStudentRow,
  TrackerStudentRow,
  bulkCreateStudents,
  createClassAssignment,
  createTeacherClass,
  downloadTeacherExcel,
  fetchAssignmentTracker,
  fetchClassAssignments,
  fetchClassStudents,
  resetStudentPin,
  updateTeacherClass,
} from '../utils/api';
import { TeacherSubmissionReview } from './TeacherSubmissionReview';
import { TeacherLtiConnection } from './TeacherLtiConnection';
import { computeAiKhoRatio } from '../utils/khoTuNgu';

interface TeacherDashboardProps {
  teacher: TeacherProfile;
  classes: TeacherClassSummary[];
  onRefreshClasses: () => Promise<void>;
  onSessionExpired: () => void;
}

type TabKey = 'tracker' | 'assignments' | 'students' | 'settings' | 'lti';

interface PrintableSlip {
  id: string;
  nickname: string;
  pin: string;
  joinCode: string;
  className: string;
}

function fmtShortDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  teacher,
  classes,
  onRefreshClasses,
  onSessionExpired,
}) => {
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id ?? '');
  const [activeTab, setActiveTab] = useState<TabKey>(classes.length > 0 ? 'tracker' : 'lti');
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  // Create class state
  const [showCreateClass, setShowCreateClass] = useState(classes.length === 0);
  const [newClassName, setNewClassName] = useState('');
  const [creatingClass, setCreatingClass] = useState(false);

  // Data per class
  const [assignments, setAssignments] = useState<TeacherAssignmentRow[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [trackerRows, setTrackerRows] = useState<TrackerStudentRow[]>([]);
  const [students, setStudents] = useState<TeacherStudentRow[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // Assignment form
  const [assTitle, setAssTitle] = useState('');
  const [assPrompt, setAssPrompt] = useState('');
  const [assOpens, setAssOpens] = useState('');
  const [assCloses, setAssCloses] = useState('');
  const [creatingAss, setCreatingAss] = useState(false);

  // Bulk students + printable slips
  const [bulkNicknames, setBulkNicknames] = useState('');
  const [fixedPin, setFixedPin] = useState('');
  const [creatingStudents, setCreatingStudents] = useState(false);
  const [loginSlips, setLoginSlips] = useState<PrintableSlip[]>([]);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Class settings
  const [editClassName, setEditClassName] = useState('');
  const [editAiEnabled, setEditAiEnabled] = useState(true);
  const [editAiLimit, setEditAiLimit] = useState(5);
  const [savingSettings, setSavingSettings] = useState(false);

  // Excel export
  const [exportAssignmentId, setExportAssignmentId] = useState('');
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [exportingXlsx, setExportingXlsx] = useState(false);

  // Status banners
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? classes[0] ?? null;

  useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
      setShowCreateClass(false);
    }
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (selectedClass) {
      setEditClassName(selectedClass.name);
      setEditAiEnabled(selectedClass.ai_enabled);
      setEditAiLimit(selectedClass.ai_daily_limit);
    }
  }, [selectedClass]);

  const handleApiError = useCallback(
    (err: unknown, fallback: string) => {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        onSessionExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : fallback);
    },
    [onSessionExpired]
  );

  const loadClassData = useCallback(async () => {
    if (!selectedClass) return;
    setLoadingTab(true);
    setErrorMsg(null);
    try {
      const [assRes, stRes] = await Promise.all([
        fetchClassAssignments(selectedClass.id),
        fetchClassStudents(selectedClass.id),
      ]);
      setAssignments(assRes.assignments);
      setStudents(stRes.students);

      const nextAssId =
        assRes.assignments.find((a) => a.id === selectedAssignmentId)?.id ??
        assRes.assignments[0]?.id ??
        '';
      setSelectedAssignmentId(nextAssId);

      if (nextAssId) {
        const trackRes = await fetchAssignmentTracker(nextAssId);
        setTrackerRows(trackRes.rows);
      } else {
        setTrackerRows([]);
      }
    } catch (err) {
      handleApiError(err, 'Không tải được dữ liệu lớp học.');
    } finally {
      setLoadingTab(false);
    }
  }, [selectedClass, selectedAssignmentId, handleApiError]);

  useEffect(() => {
    setSelectedSubmissionId(null);
    setLoginSlips([]);
    setNoticeMsg(null);
    void loadClassData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.id]);

  const loadTrackerForAssignment = async (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    if (!assignmentId) {
      setTrackerRows([]);
      return;
    }
    setLoadingTab(true);
    setErrorMsg(null);
    try {
      const res = await fetchAssignmentTracker(assignmentId);
      setTrackerRows(res.rows);
    } catch (err) {
      handleApiError(err, 'Không tải được bảng tiến độ.');
    } finally {
      setLoadingTab(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    setCreatingClass(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await createTeacherClass({ name: newClassName.trim() });
      setNewClassName('');
      setShowCreateClass(false);
      await onRefreshClasses();
      setSelectedClassId(res.class.id);
      setNoticeMsg(`Đã tạo lớp "${res.class.name}" với mã lớp ${res.class.join_code}.`);
    } catch (err) {
      handleApiError(err, 'Không tạo được lớp học.');
    } finally {
      setCreatingClass(false);
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass || !assTitle.trim()) return;
    setCreatingAss(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await createClassAssignment(selectedClass.id, {
        title: assTitle.trim(),
        prompt_text: assPrompt.trim(),
        opens_at: assOpens ? new Date(assOpens).toISOString() : null,
        closes_at: assCloses ? new Date(assCloses).toISOString() : null,
      });
      setAssTitle('');
      setAssPrompt('');
      setAssOpens('');
      setAssCloses('');
      await loadClassData();
      await onRefreshClasses();
      setSelectedAssignmentId(res.assignment.id);
      setNoticeMsg(`Đã giao bài "${res.assignment.title}" cho lớp ${selectedClass.name}.`);
    } catch (err) {
      handleApiError(err, 'Không tạo được bài tập.');
    } finally {
      setCreatingAss(false);
    }
  };

  const handleBulkCreateStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass || !bulkNicknames.trim()) return;
    if (fixedPin.trim() && !/^\d{4}$/.test(fixedPin.trim())) {
      setErrorMsg('Mã PIN cố định phải gồm đúng 4 chữ số (hoặc để trống để tạo ngẫu nhiên).');
      return;
    }
    setCreatingStudents(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await bulkCreateStudents(selectedClass.id, {
        nicknamesText: bulkNicknames,
        fixedPin: fixedPin.trim() || undefined,
      });
      setBulkNicknames('');
      setFixedPin('');
      const newSlips: PrintableSlip[] = res.created.map((c) => ({
        id: c.id,
        nickname: c.nickname,
        pin: c.pin,
        joinCode: res.joinCode,
        className: res.className,
      }));
      setLoginSlips((prev) => [...newSlips, ...prev]);
      await loadClassData();
      await onRefreshClasses();
      const skipText =
        res.skipped.length > 0 ? ` (bỏ qua ${res.skipped.length} biệt danh trùng/không hợp lệ)` : '';
      setNoticeMsg(
        `Đã thêm ${res.created.length} học sinh${skipText}. Bấm "In phiếu đăng nhập" để phát cho các em!`
      );
    } catch (err) {
      handleApiError(err, 'Không thêm được danh sách học sinh.');
    } finally {
      setCreatingStudents(false);
    }
  };

  const handleResetPin = async (student: TeacherStudentRow) => {
    setResettingId(student.id);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await resetStudentPin(student.id);
      setLoginSlips((prev) => [
        {
          id: res.studentId,
          nickname: res.nickname,
          pin: res.pin,
          joinCode: res.joinCode,
          className: res.className,
        },
        ...prev.filter((s) => s.id !== res.studentId),
      ]);
      await loadClassData();
      setNoticeMsg(`Đã đặt lại PIN mới cho ${res.nickname}: ${res.pin} (và đã mở khóa tài khoản nếu bị khóa).`);
    } catch (err) {
      handleApiError(err, 'Không đặt lại được mã PIN.');
    } finally {
      setResettingId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    setSavingSettings(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await updateTeacherClass(selectedClass.id, {
        name: editClassName.trim() || selectedClass.name,
        ai_enabled: editAiEnabled,
        ai_daily_limit: Math.max(0, Math.min(100, Math.round(editAiLimit))),
      });
      await onRefreshClasses();
      setNoticeMsg('Đã lưu cài đặt lớp học.');
    } catch (err) {
      handleApiError(err, 'Không lưu được cài đặt lớp.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleExportExcel = async () => {
    if (!selectedClass) return;
    if ((compareA && !compareB) || (!compareA && compareB)) {
      setErrorMsg('Để tạo sheet So sánh, vui lòng chọn đủ cả Bài 1 (đầu vào) và Bài 2 (đầu ra).');
      return;
    }
    if (compareA && compareB && compareA === compareB) {
      setErrorMsg('Vui lòng chọn 2 bài khác nhau để so sánh.');
      return;
    }
    setExportingXlsx(true);
    setErrorMsg(null);
    try {
      await downloadTeacherExcel({
        classId: selectedClass.id,
        assignmentId: exportAssignmentId || undefined,
        compareA: compareA || undefined,
        compareB: compareB || undefined,
      });
      setNoticeMsg('Đã tải xuống tệp báo cáo Excel (.xlsx).');
    } catch (err) {
      handleApiError(err, 'Không xuất được tệp Excel.');
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleCopyJoinCode = async () => {
    if (!selectedClass) return;
    try {
      await navigator.clipboard.writeText(selectedClass.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  if (selectedSubmissionId) {
    return (
      <TeacherSubmissionReview
        submissionId={selectedSubmissionId}
        onBack={() => setSelectedSubmissionId(null)}
        onGraded={() => {
          if (selectedAssignmentId) {
            void loadTrackerForAssignment(selectedAssignmentId);
          }
          void onRefreshClasses();
        }}
        onSessionExpired={onSessionExpired}
      />
    );
  }

  const flaggedInTracker = trackerRows.reduce((acc, r) => acc + (r.flagged_count || 0), 0);
  const submittedInTracker = trackerRows.filter((r) => Boolean(r.submitted_at)).length;
  const startedInTracker = trackerRows.filter((r) => Boolean(r.submission_id)).length;

  return (
    <div className="space-y-6">
      {/* Printable Login Slips (visible only when printing from Students tab) */}
      {loginSlips.length > 0 && (
        <div className="hidden print:block space-y-4">
          <h1 className="text-xl font-bold text-black">
            Phiếu đăng nhập Bạn Viết — {selectedClass?.name}
          </h1>
          <div className="grid grid-cols-2 gap-4">
            {loginSlips.map((slip) => (
              <div
                key={slip.id}
                className="border-2 border-dashed border-[#475569] rounded-xl p-4 space-y-1.5 break-inside-avoid text-black"
              >
                <div className="text-sm font-semibold">BẠN VIẾT · PHIẾU ĐĂNG NHẬP</div>
                <div>
                  Lớp: <strong>{slip.className}</strong>
                </div>
                <div>
                  Mã lớp: <strong className="text-lg tracking-widest">{slip.joinCode}</strong>
                </div>
                <div>
                  Biệt danh: <strong>{slip.nickname}</strong>
                </div>
                <div>
                  Mã PIN (4 số): <strong className="text-xl tracking-widest">{slip.pin}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main interactive dashboard (hidden when printing login slips) */}
      <div className={loginSlips.length > 0 ? 'no-print space-y-6' : 'space-y-6'}>
        {/* Top Class Selector & Actions */}
        <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[15px] text-[#0369A1] font-semibold">
              Giáo viên: {teacher.display_name || teacher.email || 'Tài khoản Google'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {classes.length > 0 ? (
                <select
                  aria-label="Chọn lớp học"
                  value={selectedClass?.id ?? ''}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-[#FCFDFC] font-bold text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#0369A1]"
                >
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} (Mã: {cls.join_code} · {cls.student_count} HS
                      {cls.flagged_count > 0 ? ` · ${cls.flagged_count} cảnh báo` : ''})
                    </option>
                  ))}
                </select>
              ) : (
                <h1 className="text-xl font-bold text-[#1C2A24]">Chưa có lớp học nào</h1>
              )}

              {selectedClass && (
                <button
                  type="button"
                  onClick={handleCopyJoinCode}
                  className="inline-flex items-center gap-1.5 min-h-[46px] px-3.5 py-2 rounded-xl bg-[#ECFDF5] border border-[#86EFAC] text-[#14532D] font-bold tracking-wider cursor-pointer"
                  title="Sao chép mã lớp"
                >
                  {copiedCode ? (
                    <Check className="w-4 h-4 text-[#15803D]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#15803D]" aria-hidden="true" />
                  )}
                  <span>{selectedClass.join_code}</span>
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateClass((prev) => !prev)}
            className="inline-flex items-center justify-center gap-2 min-h-[46px] px-5 py-2.5 rounded-xl bg-[#0369A1] text-white font-bold hover:bg-[#075985] transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            <span>Tạo lớp mới</span>
          </button>
        </section>

        {/* Inline Create Class Form */}
        {showCreateClass && (
          <form
            onSubmit={handleCreateClass}
            className="rounded-2xl bg-[#F0F9FF] border border-[#BAE6FD] p-5 flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
          >
            <div className="flex-1 space-y-1.5">
              <label htmlFor="new-class-name" className="block font-bold text-[#0C4A6E]">
                Tên lớp học mới
              </label>
              <input
                id="new-class-name"
                type="text"
                maxLength={80}
                required
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="Ví dụ: Lớp 5A1 – Trường TH Chu Văn An"
                className="w-full min-h-[48px] px-4 py-2 rounded-xl border border-[#7DD3FC] bg-white text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#0369A1]"
              />
            </div>
            <button
              type="submit"
              disabled={creatingClass || !newClassName.trim()}
              className="inline-flex items-center justify-center gap-2 min-h-[48px] px-6 py-2.5 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#94A3B8] cursor-pointer whitespace-nowrap"
            >
              {creatingClass && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
              <span>Tạo lớp</span>
            </button>
          </form>
        )}

        {errorMsg && (
          <div role="alert" className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] p-4 text-[#991B1B] font-medium">
            {errorMsg}
          </div>
        )}

        {noticeMsg && (
          <div role="status" className="rounded-xl bg-[#ECFDF5] border border-[#86EFAC] p-4 text-[#14532D] font-medium flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        )}

        {/* Navigation Tabs (Kết nối OPEN-EDU always accessible) */}
        <div
          role="tablist"
          aria-label="Chức năng quản lý lớp"
          className="flex flex-wrap gap-2 border-b border-[#DDE7E2] pb-3"
        >
          {[
            ...(selectedClass
              ? [
                  { key: 'tracker' as TabKey, label: 'Theo dõi & Chấm bài', icon: LayoutGrid },
                  { key: 'assignments' as TabKey, label: `Giao bài (${assignments.length})`, icon: BookPlus },
                  { key: 'students' as TabKey, label: `Học sinh (${students.length})`, icon: Users },
                  { key: 'settings' as TabKey, label: 'Cài đặt & Xuất Excel', icon: Settings },
                ]
              : []),
            { key: 'lti' as TabKey, label: 'Kết nối OPEN-EDU', icon: Link2 },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => {
                  setActiveTab(t.key);
                  setErrorMsg(null);
                }}
                className={`inline-flex items-center gap-2 min-h-[46px] px-4 py-2 rounded-xl font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#15803D] text-white'
                    : 'bg-white border border-[#DDE7E2] text-[#1C2A24] hover:bg-[#ECFDF5]'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'lti' && (
          <TeacherLtiConnection onSessionExpired={onSessionExpired} />
        )}

        {selectedClass && activeTab !== 'lti' && (
          <>

            {/* TAB 1: TRACKER */}
            {activeTab === 'tracker' && (
              <section className="space-y-5">
                <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3 flex-1">
                    <label htmlFor="tracker-assignment-select" className="font-bold text-[#1C2A24]">
                      Chọn bài tập:
                    </label>
                    {assignments.length > 0 ? (
                      <select
                        id="tracker-assignment-select"
                        value={selectedAssignmentId}
                        onChange={(e) => void loadTrackerForAssignment(e.target.value)}
                        className="min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-[#FCFDFC] font-semibold text-[#1C2A24] flex-1 max-w-md"
                      >
                        {assignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[#4B6358]">Lớp chưa có bài tập nào.</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {assignments.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setActiveTab('assignments')}
                        className="inline-flex items-center gap-2 min-h-[46px] px-4 py-2 rounded-xl bg-[#15803D] text-white font-bold cursor-pointer"
                      >
                        <BookPlus className="w-5 h-5" aria-hidden="true" />
                        <span>Giao bài ngay</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void loadTrackerForAssignment(selectedAssignmentId)}
                        className="inline-flex items-center gap-2 min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingTab ? 'animate-spin' : ''}`} aria-hidden="true" />
                        <span>Làm mới</span>
                      </button>
                    )}
                  </div>
                </div>

                {assignments.length > 0 && (
                  <>
                    {/* Quick KPI strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl bg-white border border-[#DDE7E2] p-4">
                        <div className="text-2xl font-bold text-[#1C2A24] tabular-nums">
                          {trackerRows.length}
                        </div>
                        <div className="text-[15px] text-[#4B6358]">Tổng học sinh</div>
                      </div>
                      <div className="rounded-xl bg-white border border-[#DDE7E2] p-4">
                        <div className="text-2xl font-bold text-[#0369A1] tabular-nums">
                          {startedInTracker}
                        </div>
                        <div className="text-[15px] text-[#4B6358]">Đã bắt đầu</div>
                      </div>
                      <div className="rounded-xl bg-white border border-[#DDE7E2] p-4">
                        <div className="text-2xl font-bold text-[#15803D] tabular-nums">
                          {submittedInTracker}
                        </div>
                        <div className="text-[15px] text-[#4B6358]">Đã hoàn thành</div>
                      </div>
                      <div className="rounded-xl bg-white border border-[#DDE7E2] p-4">
                        <div
                          className={`text-2xl font-bold tabular-nums ${
                            flaggedInTracker > 0 ? 'text-[#B91C1C]' : 'text-[#4B6358]'
                          }`}
                        >
                          {flaggedInTracker}
                        </div>
                        <div className="text-[15px] text-[#4B6358]">Cảnh báo cần lưu ý</div>
                      </div>
                    </div>

                    {/* Progress Matrix Table */}
                    <div className="rounded-2xl bg-white border border-[#DDE7E2] overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[760px]">
                          <thead>
                            <tr className="bg-[#F6FAF7] border-b border-[#DDE7E2] text-[15px] text-[#4B6358]">
                              <th className="py-3.5 px-4 font-bold">Học sinh</th>
                              <th className="py-3.5 px-2 text-center font-bold">B1 Quan sát</th>
                              <th className="py-3.5 px-2 text-center font-bold">B2 Lập ý</th>
                              <th className="py-3.5 px-2 text-center font-bold">B3 Viết</th>
                              <th className="py-3.5 px-2 text-center font-bold">B4 Tự sửa</th>
                              <th className="py-3.5 px-2 text-center font-bold">B5 Chia sẻ</th>
                              <th className="py-3.5 px-3 text-center font-bold">Mức đạt</th>
                              <th className="py-3.5 px-4 text-right font-bold">Bài làm</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EEF2F0] text-[16px]">
                            {trackerRows.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="py-8 text-center text-[#4B6358]">
                                  Chưa có học sinh nào trong lớp. Hãy sang thẻ “Học sinh” để thêm danh sách biệt danh.
                                </td>
                              </tr>
                            ) : (
                              trackerRows.map((row) => (
                                <tr
                                  key={row.student_id}
                                  className={
                                    row.flagged_count > 0
                                      ? 'bg-[#FEF2F2]/60 hover:bg-[#FEF2F2]'
                                      : 'hover:bg-[#F8FAF9]'
                                  }
                                >
                                  <td className="py-3.5 px-4 font-semibold text-[#1C2A24]">
                                    <div className="flex items-center gap-2">
                                      <span>{row.nickname}</span>
                                      {row.flagged_count > 0 && (
                                        <span
                                          title={`Có ${row.flagged_count} tin nhắn cần giáo viên lưu ý`}
                                          className="inline-flex items-center gap-1 text-[#B91C1C] text-[14px] font-bold"
                                        >
                                          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                          <span>{row.flagged_count}</span>
                                        </span>
                                      )}
                                    </div>
                                    {row.submission_id && (() => {
                                      const ratio = computeAiKhoRatio(
                                        row.ai_calls,
                                        row.kho_suggestions_count ?? 0
                                      );
                                      return (
                                        <div className="text-[13px] text-[#64748B] font-normal tabular-nums space-y-0.5">
                                          <div>
                                            {row.revised_words || row.draft_words} từ · {row.edits_count} sửa
                                          </div>
                                          <div>
                                            AI: <strong className="text-[#15803D]">{ratio.aiCount}</strong> / Kho:{' '}
                                            <strong className="text-[#0369A1]">{ratio.khoCount}</strong>
                                            {ratio.total > 0
                                              ? ` (${ratio.aiPercent}% / ${ratio.khoPercent}%)`
                                              : ''}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </td>

                                  {[1, 2, 3, 4, 5].map((step) => {
                                    const started = Boolean(row.submission_id);
                                    const completed =
                                      started &&
                                      (row.current_step > step ||
                                        (step === 5 && Boolean(row.submitted_at)) ||
                                        (step === 3 && Boolean(row.draft_locked_at)));
                                    const active = started && !completed && row.current_step === step;

                                    return (
                                      <td key={step} className="py-3 px-2 text-center">
                                        <span
                                          className={`inline-block w-full max-w-[78px] py-1.5 rounded-lg text-[14px] font-bold ${
                                            completed
                                              ? 'bg-[#DCFCE7] text-[#14532D]'
                                              : active
                                                ? 'bg-[#E0F2FE] text-[#075985]'
                                                : 'bg-[#F1F5F9] text-[#94A3B8]'
                                          }`}
                                        >
                                          {completed ? 'Xong' : active ? 'Đang làm' : '—'}
                                        </span>
                                      </td>
                                    );
                                  })}

                                  <td className="py-3 px-3 text-center font-bold">
                                    {row.teacher_level ? (
                                      <span
                                        className={
                                          row.teacher_level === 'HTT'
                                            ? 'text-[#15803D]'
                                            : row.teacher_level === 'HT'
                                              ? 'text-[#0369A1]'
                                              : 'text-[#B45309]'
                                        }
                                      >
                                        {row.teacher_level}
                                      </span>
                                    ) : (
                                      <span className="text-[#94A3B8] font-normal">—</span>
                                    )}
                                  </td>

                                  <td className="py-3 px-4 text-right">
                                    {row.submission_id ? (
                                      <button
                                        type="button"
                                        onClick={() => setSelectedSubmissionId(row.submission_id)}
                                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#0369A1] text-white text-[15px] font-semibold hover:bg-[#075985] cursor-pointer whitespace-nowrap"
                                      >
                                        Xem & Chấm
                                      </button>
                                    ) : (
                                      <span className="text-[15px] text-[#94A3B8]">Chưa làm</span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* TAB 2: ASSIGNMENTS */}
            {activeTab === 'assignments' && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={handleCreateAssignment}
                  className="lg:col-span-5 rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4 h-fit"
                >
                  <h2 className="text-xl font-bold text-[#1C2A24]">Giao bài viết mới</h2>

                  <div className="space-y-1.5">
                    <label htmlFor="ass-title" className="block font-semibold text-[#1C2A24]">
                      Tên bài tập
                    </label>
                    <input
                      id="ass-title"
                      type="text"
                      required
                      maxLength={200}
                      value={assTitle}
                      onChange={(e) => setAssTitle(e.target.value)}
                      placeholder="Ví dụ: Tả một người thân trong gia đình em"
                      className="w-full min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label htmlFor="ass-prompt" className="block font-semibold text-[#1C2A24]">
                        Đề bài & dặn dò của thầy/cô
                      </label>
                      <span className="text-[14px] text-[#64748B] tabular-nums">
                        {assPrompt.length}/2000
                      </span>
                    </div>
                    <textarea
                      id="ass-prompt"
                      rows={4}
                      maxLength={2000}
                      value={assPrompt}
                      onChange={(e) => setAssPrompt(e.target.value)}
                      placeholder="Gợi ý: Hãy tả một người thân mà em yêu quý nhất (ông, bà, bố, mẹ, anh chị...). Chú ý tả chi tiết ngoại hình tiêu biểu và một kỷ niệm hoặc việc làm đáng nhớ."
                      className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="ass-opens" className="block text-[15px] font-semibold text-[#1C2A24]">
                        Ngày mở (tuỳ chọn)
                      </label>
                      <input
                        id="ass-opens"
                        type="datetime-local"
                        value={assOpens}
                        onChange={(e) => setAssOpens(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[15px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="ass-closes" className="block text-[15px] font-semibold text-[#1C2A24]">
                        Hạn nộp (tuỳ chọn)
                      </label>
                      <input
                        id="ass-closes"
                        type="datetime-local"
                        value={assCloses}
                        onChange={(e) => setAssCloses(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[15px]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={creatingAss || !assTitle.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#94A3B8] cursor-pointer"
                  >
                    {creatingAss ? (
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <BookPlus className="w-5 h-5" aria-hidden="true" />
                    )}
                    <span>Giao bài cho lớp</span>
                  </button>
                </form>

                <div className="lg:col-span-7 space-y-4">
                  <h2 className="text-xl font-bold text-[#1C2A24]">
                    Danh sách bài đã giao ({assignments.length})
                  </h2>
                  {assignments.length === 0 ? (
                    <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 text-[#4B6358]">
                      Lớp chưa có bài tập nào. Thầy/cô tạo bài viết đầu tiên ở khung bên trái nhé!
                    </div>
                  ) : (
                    assignments.map((a) => (
                      <article
                        key={a.id}
                        className="rounded-2xl bg-white border border-[#DDE7E2] p-5 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <h3 className="text-xl font-bold text-[#1C2A24]">{a.title}</h3>
                            <p className="text-[15px] text-[#64748B] tabular-nums">
                              Tạo ngày {fmtShortDate(a.created_at)}
                              {a.opens_at ? ` · Mở: ${fmtShortDate(a.opens_at)}` : ''}
                              {a.closes_at ? ` · Hạn: ${fmtShortDate(a.closes_at)}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab('tracker');
                              void loadTrackerForAssignment(a.id);
                            }}
                            className="min-h-[42px] px-4 py-2 rounded-xl border border-[#0369A1] text-[#075985] font-semibold hover:bg-[#E0F2FE] cursor-pointer whitespace-nowrap text-[15px]"
                          >
                            Xem tiến độ
                          </button>
                        </div>

                        {a.prompt_text && (
                          <p className="text-[16px] text-[#334155] whitespace-pre-wrap">
                            {a.prompt_text}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-4 text-[15px] text-[#4B6358] pt-1 tabular-nums">
                          <span>Đã bắt đầu: {a.started_count} HS</span>
                          <span>·</span>
                          <span className="text-[#15803D] font-semibold">
                            Đã nộp: {a.submitted_count} HS
                          </span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            )}

            {/* TAB 3: STUDENTS & LOGIN SLIPS */}
            {activeTab === 'students' && (
              <section className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Bulk Paste Form */}
                  <form
                    onSubmit={handleBulkCreateStudents}
                    className="lg:col-span-5 rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4 h-fit"
                  >
                    <div>
                      <h2 className="text-xl font-bold text-[#1C2A24]">Thêm học sinh hàng loạt</h2>
                      <p className="text-[15px] text-[#4B6358] mt-1">
                        Khuyên dùng biệt danh hoặc tên gọi ngắn (≤40 ký tự) để bảo vệ thông tin cá nhân của học sinh.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="bulk-nicknames" className="block font-semibold text-[#1C2A24]">
                        Dán danh sách biệt danh (mỗi dòng 1 em)
                      </label>
                      <textarea
                        id="bulk-nicknames"
                        rows={6}
                        value={bulkNicknames}
                        onChange={(e) => setBulkNicknames(e.target.value)}
                        placeholder={'Bé Gấu\nSóc Nhỏ\nMèo Mướp\nThỏ Trắng'}
                        className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="fixed-pin-input" className="block font-semibold text-[#1C2A24]">
                        Mã PIN 4 số chung (tuỳ chọn)
                      </label>
                      <input
                        id="fixed-pin-input"
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={fixedPin}
                        onChange={(e) => setFixedPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="Để trống để tự tạo PIN riêng cho từng em"
                        className="w-full min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={creatingStudents || !bulkNicknames.trim()}
                      className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#94A3B8] cursor-pointer"
                    >
                      {creatingStudents ? (
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Users className="w-5 h-5" aria-hidden="true" />
                      )}
                      <span>Thêm danh sách học sinh</span>
                    </button>
                  </form>

                  {/* Roster & Printable Login Slips */}
                  <div className="lg:col-span-7 space-y-5">
                    {loginSlips.length > 0 && (
                      <div className="rounded-2xl bg-[#ECFDF5] border border-[#86EFAC] p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-bold text-[#14532D]">
                              Phiếu đăng nhập sẵn sàng in ({loginSlips.length})
                            </h3>
                            <p className="text-[15px] text-[#166534]">
                              Mã PIN chỉ hiển thị một lần sau khi tạo hoặc đặt lại. Hãy in ngay để phát cho học sinh!
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => window.print()}
                            className="inline-flex items-center gap-2 min-h-[46px] px-5 py-2.5 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] cursor-pointer whitespace-nowrap"
                          >
                            <Printer className="w-5 h-5" aria-hidden="true" />
                            <span>In phiếu đăng nhập</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                          {loginSlips.map((slip) => (
                            <div
                              key={slip.id}
                              className="rounded-xl bg-white border border-[#86EFAC] p-3.5 text-[15px]"
                            >
                              <div className="font-bold text-[#1C2A24]">{slip.nickname}</div>
                              <div className="text-[#4B6358] tabular-nums">
                                Mã lớp: <strong>{slip.joinCode}</strong> · PIN:{' '}
                                <strong className="text-[#15803D] text-[17px]">{slip.pin}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl bg-white border border-[#DDE7E2] overflow-hidden">
                      <div className="px-5 py-4 border-b border-[#DDE7E2] flex items-center justify-between gap-2">
                        <h3 className="text-xl font-bold text-[#1C2A24]">
                          Danh sách lớp ({students.length} học sinh)
                        </h3>
                        <span className="text-[15px] text-[#4B6358]">
                          Mã lớp: <strong className="text-[#14532D]">{selectedClass.join_code}</strong>
                        </span>
                      </div>

                      {students.length === 0 ? (
                        <div className="p-6 text-[#4B6358]">
                          Chưa có học sinh nào. Hãy dán danh sách biệt danh ở khung bên trái.
                        </div>
                      ) : (
                        <div className="divide-y divide-[#EEF2F0]">
                          {students.map((st) => {
                            const isLocked =
                              Boolean(st.locked_until) &&
                              new Date(st.locked_until!).getTime() > Date.now();
                            return (
                              <div
                                key={st.id}
                                className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3"
                              >
                                <div>
                                  <div className="font-bold text-[#1C2A24]">{st.nickname}</div>
                                  <div className="text-[14px] text-[#64748B]">
                                    {isLocked ? (
                                      <span className="text-[#B91C1C] font-semibold">
                                        Đang tạm khóa do nhập sai PIN 5 lần
                                      </span>
                                    ) : st.failed_pin > 0 ? (
                                      <span>Nhập sai PIN {st.failed_pin}/5 lần</span>
                                    ) : (
                                      <span>Đang hoạt động</span>
                                    )}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  disabled={resettingId === st.id}
                                  onClick={() => void handleResetPin(st)}
                                  className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] text-[15px] font-semibold hover:bg-[#F1F5F9] cursor-pointer whitespace-nowrap"
                                >
                                  {resettingId === st.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <KeyRound className="w-4 h-4 text-[#0369A1]" aria-hidden="true" />
                                  )}
                                  <span>Đặt lại PIN</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 4: CLASS SETTINGS & EXCEL EXPORT */}
            {activeTab === 'settings' && (
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Class AI Settings */}
                <form
                  onSubmit={handleSaveSettings}
                  className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-5"
                >
                  <div className="flex items-center gap-2.5">
                    <Settings className="w-6 h-6 text-[#0369A1]" aria-hidden="true" />
                    <h2 className="text-xl font-bold text-[#1C2A24]">Cài đặt lớp học & Trợ lý AI</h2>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="edit-class-name" className="block font-semibold text-[#1C2A24]">
                      Tên lớp
                    </label>
                    <input
                      id="edit-class-name"
                      type="text"
                      maxLength={80}
                      value={editClassName}
                      onChange={(e) => setEditClassName(e.target.value)}
                      className="w-full min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white"
                    />
                  </div>

                  <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-bold text-[#1C2A24]">Bật trợ lý AI Bạn Viết cho lớp</div>
                      <p className="text-[15px] text-[#4B6358]">
                        Khi tắt, học sinh vẫn xem được kho từ ngữ có sẵn và tự động dùng gợi ý trong kho mà không gọi AI.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Bật trợ lý AI cho lớp"
                      checked={editAiEnabled}
                      onChange={(e) => setEditAiEnabled(e.target.checked)}
                      className="w-6 h-6 accent-[#15803D] cursor-pointer shrink-0"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="edit-ai-limit" className="font-semibold text-[#1C2A24]">
                        Giới hạn lượt AI / học sinh / ngày (0–100)
                      </label>
                      <span className="font-bold text-[#15803D] tabular-nums">
                        {editAiLimit} lượt/ngày
                      </span>
                    </div>
                    <input
                      id="edit-ai-limit"
                      type="number"
                      min={0}
                      max={100}
                      value={editAiLimit}
                      onChange={(e) =>
                        setEditAiLimit(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                      }
                      className="w-full min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white tabular-nums"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#94A3B8] cursor-pointer"
                  >
                    {savingSettings && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
                    <span>Lưu cài đặt lớp</span>
                  </button>
                </form>

                {/* Excel Export */}
                <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-5">
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="w-6 h-6 text-[#15803D]" aria-hidden="true" />
                    <h2 className="text-xl font-bold text-[#1C2A24]">Xuất báo cáo Excel (.xlsx)</h2>
                  </div>

                  <p className="text-[16px] text-[#4B6358]">
                    Xuất danh sách biệt danh, các chỉ số viết (số chi tiết dàn ý, số từ nháp/sửa, chỗ tự sửa, lượt AI, số phút), điểm tự đánh giá, rubric giáo viên, mức đạt và nhận xét.
                  </p>

                  <div className="space-y-1.5">
                    <label htmlFor="export-scope" className="block font-semibold text-[#1C2A24]">
                      Phạm vi xuất dữ liệu
                    </label>
                    <select
                      id="export-scope"
                      value={exportAssignmentId}
                      onChange={(e) => setExportAssignmentId(e.target.value)}
                      className="w-full min-h-[46px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white"
                    >
                      <option value="">Toàn bộ các bài trong lớp {selectedClass.name}</option>
                      {assignments.map((a) => (
                        <option key={a.id} value={a.id}>
                          Chỉ bài: {a.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 space-y-3">
                    <div className="font-bold text-[#14532D]">
                      So sánh tiến bộ giữa 2 bài (tạo thêm sheet “So sánh”)
                    </div>
                    <p className="text-[15px] text-[#4B6358]">
                      Chọn 1 bài đầu vào và 1 bài đầu ra để đặt kết quả từng học sinh cạnh nhau.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        aria-label="Chọn bài đầu vào"
                        value={compareA}
                        onChange={(e) => setCompareA(e.target.value)}
                        className="min-h-[44px] px-3 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[15px]"
                      >
                        <option value="">-- Bài 1 (Đầu vào) --</option>
                        {assignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Chọn bài đầu ra"
                        value={compareB}
                        onChange={(e) => setCompareB(e.target.value)}
                        className="min-h-[44px] px-3 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[15px]"
                      >
                        <option value="">-- Bài 2 (Đầu ra) --</option>
                        {assignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={exportingXlsx}
                    onClick={() => void handleExportExcel()}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#0369A1] text-white font-bold hover:bg-[#075985] disabled:bg-[#94A3B8] cursor-pointer"
                  >
                    {exportingXlsx ? (
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
                    )}
                    <span>Tải tệp Excel (.xlsx)</span>
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
