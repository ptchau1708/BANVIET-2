import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MessageSquare,
  Save,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { SelfCheckState, SelfRatingState } from '../types';
import {
  DbAiEvent,
  TeacherSubmissionDetail,
  fetchTeacherSubmissionDetail,
  gradeStudentSubmission,
  toggleAiEventFlag,
} from '../utils/api';
import { computeWordDiff, countWords } from '../utils/writingLogic';
import { computeAiKhoRatio, extractKhoTuStats } from '../utils/khoTuNgu';

interface TeacherSubmissionReviewProps {
  submissionId: string;
  onBack: () => void;
  onGraded: () => void;
  onSessionExpired: () => void;
}

const RUBRIC_CRITERIA: Array<{ key: keyof SelfRatingState; label: string; desc: string }> = [
  {
    key: 'boCuc',
    label: '1. Bố cục 3 phần',
    desc: 'Có đủ Mở bài, Thân bài (ngoại hình + tính tình/hoạt động) và Kết bài rõ ràng.',
  },
  {
    key: 'ngoaiHinh',
    label: '2. Tả ngoại hình',
    desc: 'Chọn được chi tiết tiêu biểu, gợi tả rõ nét khuôn mặt, dáng vẻ, mái tóc…',
  },
  {
    key: 'tinhTinhHoatDong',
    label: '3. Tính tình & hoạt động',
    desc: 'Nêu được việc làm, cử chỉ hoặc lời nói thể hiện tính cách người được tả.',
  },
  {
    key: 'camXuc',
    label: '4. Tình cảm chân thật',
    desc: 'Thể hiện được sự yêu quý, kính trọng hoặc gắn bó tự nhiên của học sinh.',
  },
  {
    key: 'dungTuChinhTa',
    label: '5. Dùng từ, câu & chính tả',
    desc: 'Câu văn rõ ý, có từ ngữ gợi tả hoặc hình ảnh so sánh, ít lỗi chính tả.',
  },
];

const SELF_CHECK_LABELS: Array<{ key: keyof SelfCheckState; label: string }> = [
  { key: 'duBaPhan', label: 'Đủ 3 phần Mở bài – Thân bài – Kết bài' },
  { key: 'baNetNgoaiHinh', label: 'Có ít nhất 3 chi tiết tả ngoại hình' },
  { key: 'viecLamLoiNoi', label: 'Có kể việc làm hoặc lời nói' },
  { key: 'hinhAnhSoSanh', label: 'Có hình ảnh so sánh hoặc từ gợi tả' },
  { key: 'ketBaiTinhCam', label: 'Kết bài nêu được tình cảm của em' },
  { key: 'suaChinhTa', label: 'Đã soát lỗi chính tả và dấu câu' },
];

const LEVEL_OPTIONS: Array<{
  value: 'HTT' | 'HT' | 'CHT';
  short: string;
  label: string;
  activeClass: string;
}> = [
  {
    value: 'HTT',
    short: 'HTT',
    label: 'Hoàn thành tốt',
    activeClass: 'bg-[#15803D] text-white border-[#15803D]',
  },
  {
    value: 'HT',
    short: 'HT',
    label: 'Hoàn thành',
    activeClass: 'bg-[#0369A1] text-white border-[#0369A1]',
  },
  {
    value: 'CHT',
    short: 'CHT',
    label: 'Chưa hoàn thành',
    activeClass: 'bg-[#B45309] text-white border-[#B45309]',
  },
];

const EMPTY_RUBRIC: SelfRatingState = {
  boCuc: 0,
  ngoaiHinh: 0,
  tinhTinhHoatDong: 0,
  camXuc: 0,
  dungTuChinhTa: 0,
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function summarizeAiResponse(ev: DbAiEvent): string {
  const resp = (ev.response_json ?? {}) as Record<string, unknown>;
  if (ev.endpoint === 'goi-y') {
    if (Array.isArray(resp.tu_ngu) && resp.tu_ngu.length > 0) {
      return `Kho từ ngữ: ${(resp.tu_ngu as string[]).join(', ')}`;
    }
    return typeof resp.tra_loi === 'string' ? resp.tra_loi : 'Đã gửi gợi ý.';
  }
  if (ev.endpoint === 'kiem-tra-dan-y') {
    const du3 = resp.du_3_phan ? 'Đủ 3 phần' : 'Chưa đủ 3 phần';
    const nh = Number(resp.so_chi_tiet_ngoai_hinh ?? 0);
    const tt = Number(resp.so_chi_tiet_tinh_tinh_hoat_dong ?? 0);
    const qs = Array.isArray(resp.cau_hoi_goi_y) ? (resp.cau_hoi_goi_y as string[]).join(' ') : '';
    return `${du3} · ${nh} ngoại hình · ${tt} tính tình/hoạt động. ${qs}`.trim();
  }
  const khen = typeof resp.loi_khen === 'string' ? resp.loi_khen : '';
  const items = Array.isArray(resp.gop_y)
    ? (resp.gop_y as Array<{ trich_doan?: string; cau_hoi_goi_y?: string }>)
        .map((g) => `• “${g.trich_doan ?? ''}” → ${g.cau_hoi_goi_y ?? ''}`)
        .join('\n')
    : '';
  return [khen, items].filter(Boolean).join('\n');
}

function endpointLabel(ep: DbAiEvent['endpoint']): string {
  if (ep === 'goi-y') return 'Gợi ý / Trò chuyện';
  if (ep === 'kiem-tra-dan-y') return 'Kiểm tra dàn ý';
  return 'Góp ý bài viết';
}

export const TeacherSubmissionReview: React.FC<TeacherSubmissionReviewProps> = ({
  submissionId,
  onBack,
  onGraded,
  onSessionExpired,
}) => {
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rubric, setRubric] = useState<SelfRatingState>(EMPTY_RUBRIC);
  const [level, setLevel] = useState<'HTT' | 'HT' | 'CHT' | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [togglingEventId, setTogglingEventId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    fetchTeacherSubmissionDetail(submissionId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setRubric({ ...EMPTY_RUBRIC, ...(data.submission.teacher_rubric ?? {}) });
        setLevel(data.submission.teacher_level ?? null);
        setComment(data.submission.teacher_comment ?? '');
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
          onSessionExpired();
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Không tải được chi tiết bài làm.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [submissionId, onSessionExpired]);

  const diffResult = useMemo(() => {
    const draft = detail?.submission.draft_text ?? '';
    const revised = detail?.submission.revised_text ?? '';
    if (!draft && !revised) return null;
    return computeWordDiff(draft, revised || draft);
  }, [detail]);

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      await gradeStudentSubmission(submissionId, {
        teacher_rubric: rubric,
        teacher_level: level,
        teacher_comment: comment.trim(),
      });
      setSavedNotice('Đã lưu kết quả chấm rubric và nhận xét cho học sinh.');
      onGraded();
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        onSessionExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Không lưu được kết quả chấm bài.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFlag = async (ev: DbAiEvent) => {
    setTogglingEventId(String(ev.id));
    try {
      const nextFlagged = !ev.flagged;
      await toggleAiEventFlag(ev.id, nextFlagged);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              aiEvents: prev.aiEvents.map((item) =>
                String(item.id) === String(ev.id) ? { ...item, flagged: nextFlagged } : item
              ),
            }
          : prev
      );
      onGraded();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không cập nhật được trạng thái cảnh báo.');
    } finally {
      setTogglingEventId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
        <Loader2 className="w-8 h-8 animate-spin text-[#0369A1]" aria-hidden="true" />
        <p>Đang mở bài làm của học sinh…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white font-semibold text-[#1C2A24] cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại bảng tiến độ</span>
        </button>
        <div role="alert" className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] p-5 text-[#991B1B]">
          {errorMsg || 'Không tìm thấy bài làm.'}
        </div>
      </div>
    );
  }

  const sub = detail.submission;
  const obs = (sub.observation ?? {}) as Record<string, unknown>;
  const out = (sub.outline ?? {}) as Record<string, unknown>;
  const metrics = detail.metrics;
  const flaggedEvents = detail.aiEvents.filter((e) => e.flagged);

  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-[#0369A1] hover:underline cursor-pointer mb-1"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Quay lại bảng tiến độ</span>
          </button>
          <h2 className="text-2xl font-bold text-[#1C2A24]">
            {sub.nickname} · <span className="text-[#15803D]">{sub.assignment_title}</span>
          </h2>
          <p className="text-[16px] text-[#4B6358]">
            Lớp {sub.class_name} · Đang ở Bước {sub.current_step}/5 ·{' '}
            {sub.submitted_at ? `Đã nộp lúc ${fmtTime(sub.submitted_at)}` : 'Chưa nộp bài'}
          </p>
        </div>

        {flaggedEvents.length > 0 && (
          <div className="rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] px-4 py-3 flex items-center gap-2.5 text-[#991B1B] font-semibold text-[16px]">
            <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>Có {flaggedEvents.length} tin nhắn AI cần giáo viên lưu ý</span>
          </div>
        )}
      </div>

      {/* Metrics summary strip */}
      {(() => {
        const khoStats = detail.khoTuStats ?? extractKhoTuStats(sub.outline_check);
        const aiCount = metrics?.ai_calls ?? detail.aiEvents.length;
        const ratio = computeAiKhoRatio(aiCount, khoStats.goi_y_tu_kho);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                { label: 'Chi tiết dàn ý', value: metrics?.outline_details ?? 0 },
                { label: 'Từ bản nháp', value: metrics?.draft_words ?? countWords(sub.draft_text ?? '') },
                {
                  label: 'Từ bản sửa',
                  value: metrics?.revised_words ?? countWords(sub.revised_text ?? ''),
                },
                { label: 'Chỗ tự sửa', value: metrics?.edits_count ?? diffResult?.changeCount ?? 0 },
                { label: 'Gợi ý AI', value: ratio.aiCount },
                { label: 'Gợi ý kho', value: ratio.khoCount },
                { label: 'Lượt góp ý bài', value: `${metrics?.feedback_rounds ?? 0}/3` },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl bg-white border border-[#DDE7E2] p-3.5 text-center"
                >
                  <div className="text-2xl font-bold text-[#14532D] tabular-nums">{item.value}</div>
                  <div className="text-[15px] text-[#4B6358] mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[15px] text-[#334E42]">
              <div className="font-medium tabular-nums">
                Tỷ lệ gợi ý:{' '}
                <strong className="text-[#15803D]">
                  AI {ratio.aiCount} ({ratio.aiPercent}%)
                </strong>
                {' · '}
                <strong className="text-[#0369A1]">
                  Kho từ {ratio.khoCount} ({ratio.khoPercent}%)
                </strong>
              </div>
              <div className="text-[#4B6358] tabular-nums">
                Mở kho từ: <strong>{khoStats.mo_kho}</strong> lần · Đã chọn từ trong kho:{' '}
                <strong>{khoStats.tu_da_luu}</strong> từ
                {(khoStats.auto_fallback ?? 0) > 0
                  ? ` · Tự chuyển sang kho: ${khoStats.auto_fallback ?? 0} lần`
                  : ''}
              </div>
            </div>
          </div>
        );
      })()}

      {errorMsg && (
        <div role="alert" className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] p-4 text-[#991B1B]">
          {errorMsg}
        </div>
      )}

      {/* 1. Observation & Outline */}
      <section className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-6 h-6 text-[#15803D]" aria-hidden="true" />
          <h3 className="text-xl font-bold text-[#1C2A24]">1. Phiếu quan sát & Dàn ý</h3>
        </div>

        <p className="text-[16px] text-[#4B6358]">
          Người được tả:{' '}
          <strong className="text-[#1C2A24]">
            {typeof obs.personChoice === 'string' && obs.personChoice
              ? obs.personChoice === 'Người khác'
                ? String(obs.customPersonLabel || 'Người thân')
                : obs.personChoice
              : 'Chưa chọn'}
          </strong>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 space-y-2">
            <h4 className="font-bold text-[#14532D]">Phiếu quan sát (Bước 1)</h4>
            <ul className="space-y-1.5 text-[16px] text-[#1C2A24]">
              <li>
                <strong>Ngoại hình:</strong> {asList(obs.ngoaiHinh).join('; ') || '—'}
              </li>
              <li>
                <strong>Tính tình:</strong> {asList(obs.tinhTinh).join('; ') || '—'}
              </li>
              <li>
                <strong>Hoạt động, lời nói:</strong> {asList(obs.hoatDongLoiNoi).join('; ') || '—'}
              </li>
              <li>
                <strong>Tình cảm:</strong> {asList(obs.tinhCam).join('; ') || '—'}
              </li>
            </ul>
          </div>

          <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 space-y-2">
            <h4 className="font-bold text-[#14532D]">Dàn ý 3 phần (Bước 2)</h4>
            <ul className="space-y-1.5 text-[16px] text-[#1C2A24]">
              <li>
                <strong>Mở bài:</strong>{' '}
                {typeof out.moBai === 'string' && out.moBai.trim() ? out.moBai : '—'}
              </li>
              <li>
                <strong>Thân bài – Ngoại hình:</strong> {asList(out.ngoaiHinh).join('; ') || '—'}
              </li>
              <li>
                <strong>Thân bài – Tính tình & hoạt động:</strong>{' '}
                {asList(out.tinhTinhHoatDong).join('; ') || '—'}
              </li>
              <li>
                <strong>Kết bài:</strong>{' '}
                {typeof out.ketBai === 'string' && out.ketBai.trim() ? out.ketBai : '—'}
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 2. Draft & Revised Essay with Diff Highlights */}
      <section className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6 text-[#15803D]" aria-hidden="true" />
            <h3 className="text-xl font-bold text-[#1C2A24]">
              2. Bản nháp & Bản tự sửa (tô màu chỗ sửa)
            </h3>
          </div>
          {diffResult && (
            <div className="flex flex-wrap items-center gap-3 text-[15px] text-[#4B6358]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-[#DCFCE7] border border-[#86EFAC]" />
                Thêm mới (+{diffResult.addedWords} từ)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded bg-[#FEE2E2] border border-[#FCA5A5]" />
                Đã bỏ (-{diffResult.removedWords} từ)
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl border border-[#DDE7E2] bg-[#FAFBF9] p-5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[15px] text-[#4B6358]">
              <span className="font-bold text-[#1C2A24]">Bản nháp (Bước 3)</span>
              <span>{sub.draft_locked_at ? `Đã khóa ${fmtTime(sub.draft_locked_at)}` : 'Chưa khóa'}</span>
            </div>
            <div className="font-serif text-[18px] leading-relaxed whitespace-pre-wrap text-[#1C2A24]">
              {sub.draft_text?.trim() ? sub.draft_text : <span className="text-[#64748B]">Học sinh chưa viết bản nháp.</span>}
            </div>
          </div>

          <div className="rounded-xl border border-[#86EFAC] bg-white p-5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[15px] text-[#4B6358]">
              <span className="font-bold text-[#14532D]">Bản tự sửa so với bản nháp (Bước 4)</span>
              <span className="tabular-nums">{diffResult?.changeCount ?? 0} chỗ chỉnh sửa</span>
            </div>
            <div className="font-serif text-[18px] leading-relaxed whitespace-pre-wrap text-[#1C2A24]">
              {diffResult ? (
                diffResult.tokens.map((tok, i) => {
                  if (tok.type === 'added') {
                    return (
                      <span
                        key={i}
                        className="bg-[#DCFCE7] text-[#14532D] px-0.5 rounded font-medium"
                      >
                        {tok.text}
                      </span>
                    );
                  }
                  if (tok.type === 'removed') {
                    return (
                      <span
                        key={i}
                        className="bg-[#FEE2E2] text-[#991B1B] line-through px-0.5 rounded"
                      >
                        {tok.text}
                      </span>
                    );
                  }
                  return <React.Fragment key={i}>{tok.text}</React.Fragment>;
                })
              ) : (
                <span className="text-[#64748B]">Học sinh chưa có bản tự sửa.</span>
              )}
            </div>
          </div>
        </div>

        {/* Student self-checklist summary */}
        {sub.self_checklist && (
          <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 space-y-2">
            <h4 className="font-bold text-[#1C2A24] text-[16px]">Phiếu tự kiểm tra của học sinh</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[15px]">
              {SELF_CHECK_LABELS.map((item) => {
                const ans = sub.self_checklist?.[item.key];
                return (
                  <div key={item.key} className="flex items-center gap-2">
                    <span
                      className={`font-bold ${
                        ans === 'co'
                          ? 'text-[#15803D]'
                          : ans === 'chua'
                            ? 'text-[#B45309]'
                            : 'text-[#64748B]'
                      }`}
                    >
                      {ans === 'co' ? '✓ Có' : ans === 'chua' ? '• Chưa' : '—'}
                    </span>
                    <span className="text-[#334155]">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 3. AI Conversation Log */}
      <section className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-[#0369A1]" aria-hidden="true" />
            <h3 className="text-xl font-bold text-[#1C2A24]">
              3. Toàn bộ cuộc trò chuyện với AI ({detail.aiEvents.length})
            </h3>
          </div>
        </div>

        {detail.aiEvents.length === 0 ? (
          <p className="text-[#4B6358]">Học sinh chưa gọi gợi ý AI nào cho bài viết này.</p>
        ) : (
          <div className="space-y-3">
            {detail.aiEvents.map((ev) => (
              <div
                key={String(ev.id)}
                className={`rounded-xl border p-4 space-y-2 ${
                  ev.flagged
                    ? 'border-[#FCA5A5] bg-[#FEF2F2]'
                    : 'border-[#DDE7E2] bg-[#FAFBF9]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                  <div className="flex flex-wrap items-center gap-2 font-semibold text-[#1C2A24]">
                    <span>Bước {ev.step}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#0369A1]">{endpointLabel(ev.endpoint)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#64748B] font-normal tabular-nums">
                      {fmtTime(ev.created_at)}
                    </span>
                    {ev.flagged && (
                      <span className="inline-flex items-center gap-1 text-[#B91C1C] font-bold">
                        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                        Cần lưu ý
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={togglingEventId === String(ev.id)}
                    onClick={() => handleToggleFlag(ev)}
                    className={`min-h-[38px] px-3 py-1 rounded-lg text-[14px] font-semibold border cursor-pointer transition-colors ${
                      ev.flagged
                        ? 'border-[#15803D] bg-white text-[#15803D] hover:bg-[#ECFDF5]'
                        : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F1F5F9]'
                    }`}
                  >
                    {ev.flagged ? 'Đánh dấu đã xem xét' : 'Gắn cờ cần lưu ý'}
                  </button>
                </div>

                {ev.request_text && (
                  <p className="text-[16px] text-[#334155]">
                    <strong>Học sinh gửi:</strong> {ev.request_text}
                  </p>
                )}

                <p className="text-[16px] text-[#1C2A24] whitespace-pre-wrap">
                  <strong>Bạn Viết phản hồi:</strong> {summarizeAiResponse(ev)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Teacher Rubric Grading & Comment */}
      <form
        onSubmit={handleSaveGrade}
        className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-6"
      >
        <div className="flex items-center gap-2.5">
          <Star className="w-6 h-6 text-[#D97706]" aria-hidden="true" />
          <h3 className="text-xl font-bold text-[#1C2A24]">
            4. Chấm điểm Rubric (5 tiêu chí × 3 mức) & Nhận xét
          </h3>
        </div>

        <div className="space-y-4">
          {RUBRIC_CRITERIA.map((c) => {
            const studentVal = sub.self_rubric?.[c.key] ?? 0;
            const teacherVal = rubric[c.key] ?? 0;
            return (
              <div
                key={c.key}
                className="rounded-xl border border-[#DDE7E2] bg-[#FAFBF9] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-[#1C2A24]">{c.label}</div>
                  <p className="text-[15px] text-[#4B6358]">{c.desc}</p>
                  <p className="text-[14px] text-[#0369A1]">
                    Học sinh tự đánh giá: {studentVal > 0 ? `${studentVal}/3 sao` : 'Chưa tự đánh giá'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  {[
                    { val: 1, label: '1 · Chưa đạt' },
                    { val: 2, label: '2 · Đạt' },
                    { val: 3, label: '3 · Tốt' },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setRubric((prev) => ({ ...prev, [c.key]: opt.val }))}
                      className={`min-h-[44px] px-4 py-2 rounded-xl border text-[16px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        teacherVal === opt.val
                          ? 'bg-[#15803D] text-white border-[#15803D]'
                          : 'bg-white text-[#1C2A24] border-[#CBD5E1] hover:bg-[#ECFDF5]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Overall Teacher Level */}
        <div className="space-y-2">
          <label className="block font-bold text-[#1C2A24]">Xếp mức chung</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LEVEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLevel(opt.value)}
                className={`min-h-[52px] px-4 py-3 rounded-xl border font-bold transition-colors cursor-pointer ${
                  level === opt.value
                    ? opt.activeClass
                    : 'bg-white text-[#1C2A24] border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                {opt.short} · {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Teacher Comment */}
        <div className="space-y-2">
          <label htmlFor="teacher-comment-input" className="block font-bold text-[#1C2A24]">
            Lời nhận xét gửi học sinh
          </label>
          <textarea
            id="teacher-comment-input"
            rows={4}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ví dụ: Con tả rất tình cảm về mái tóc và nụ cười của bà. Lần sau con thử thêm một lời nói của bà nữa nhé!"
            className="w-full rounded-xl border border-[#CBD5E1] bg-white px-4 py-3 text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
          />
        </div>

        {savedNotice && (
          <div
            role="status"
            className="rounded-xl bg-[#ECFDF5] border border-[#86EFAC] px-4 py-3 text-[#14532D] font-semibold flex items-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 min-h-[48px] px-6 py-2.5 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#94A3B8] transition-colors cursor-pointer"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-5 h-5" aria-hidden="true" />
            )}
            <span>Lưu kết quả chấm bài</span>
          </button>
        </div>
      </form>
    </div>
  );
};
