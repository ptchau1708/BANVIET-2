import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  GitCompare,
  Loader2,
  MessageSquareHeart,
  X,
} from 'lucide-react';
import {
  SelfCheckAnswer,
  SelfCheckState,
  SuggestionCategory,
  WritingProject,
} from '../types';
import {
  MAX_ESSAY_CHARS,
  MAX_ESSAY_REVIEWS,
  buildHighlightedSegments,
  computeWordDiff,
  countAnsweredSelfChecks,
  countWords,
  getDisplayPersonName,
  isStep4Complete,
} from '../utils/writingLogic';
import { MascotSpeech } from './MascotAvatar';

const SELF_CHECK_QUESTIONS: Array<{ key: keyof SelfCheckState; label: string }> = [
  { key: 'duBaPhan', label: 'Bài có đủ mở bài, thân bài, kết bài chưa?' },
  {
    key: 'baNetNgoaiHinh',
    label: 'Em đã tả ít nhất 3 nét ngoại hình riêng của người đó chưa?',
  },
  {
    key: 'viecLamLoiNoi',
    label: 'Em có tả việc làm hoặc lời nói để thấy tính tình chưa?',
  },
  {
    key: 'hinhAnhSoSanh',
    label: 'Em có dùng ít nhất 1 hình ảnh so sánh chưa?',
  },
  {
    key: 'ketBaiTinhCam',
    label: 'Kết bài có nói tình cảm của em chưa?',
  },
  {
    key: 'suaChinhTa',
    label: 'Em đã đọc lại để sửa lỗi chính tả chưa?',
  },
];

const CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  chi_tiet: 'Chi tiết',
  dung_tu: 'Dùng từ',
  cau: 'Đặt câu',
  bo_cuc: 'Bố cục',
  chinh_ta: 'Chính tả',
};

interface Step4ReviseProps {
  project: WritingProject;
  onChangeRevised: (nextText: string) => void;
  onUpdateSelfCheck: (key: keyof SelfCheckState, value: SelfCheckAnswer) => void;
  onRequestEssayReview: () => Promise<void>;
  loadingReview: boolean;
  errorMsg: string | null;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export const Step4Revise: React.FC<Step4ReviseProps> = ({
  project,
  onChangeRevised,
  onUpdateSelfCheck,
  onRequestEssayReview,
  loadingReview,
  errorMsg,
  onPrevStep,
  onNextStep,
}) => {
  const [showDiff, setShowDiff] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState<number | null>(null);

  const personLabel = getDisplayPersonName(project);
  const latestReview =
    project.essayReviews.length > 0
      ? project.essayReviews[project.essayReviews.length - 1]
      : null;
  const remainingReviews = Math.max(0, MAX_ESSAY_REVIEWS - project.essayReviews.length);

  const diffResult = useMemo(
    () => computeWordDiff(project.draftText, project.revisedText),
    [project.draftText, project.revisedText]
  );

  const highlightedSegments = useMemo(
    () =>
      latestReview
        ? buildHighlightedSegments(project.revisedText, latestReview.gop_y)
        : [],
    [project.revisedText, latestReview]
  );

  const answeredCount = countAnsweredSelfChecks(project.selfCheck);
  const canProceed = isStep4Complete(project);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-[#1C2A24] text-balance">
            Tự sửa bài văn tả {personLabel.toLowerCase()}
          </h1>
          <p className="text-[#4B6358]">
            Em sửa thoải mái trên bản sửa này — bản nháp gốc vẫn được giữ nguyên để em so sánh.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowDiff((prev) => !prev)}
          aria-pressed={showDiff}
          className={`inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showDiff
              ? 'bg-[#14532D] text-white'
              : 'bg-white text-[#14532D] border border-[#86EFAC] hover:bg-[#ECFDF5]'
          }`}
        >
          <GitCompare className="w-5 h-5" aria-hidden="true" />
          <span>{showDiff ? 'Ẩn so sánh' : 'Xem mình đã sửa gì'}</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-5 py-4 text-[#991B1B]"
        >
          {errorMsg}
        </div>
      )}

      {/* Diff comparison panel */}
      {showDiff && (
        <section
          aria-label="So sánh bản nháp và bản sửa"
          className="rounded-2xl bg-white border border-[#86EFAC] p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EDF3EF]">
            <h2 className="text-xl font-bold text-[#14532D]">
              So sánh bản nháp với bản sửa của em
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-[16px] text-[#334155] tabular-nums">
              <span>
                Số chỗ đã sửa: <strong className="text-[#15803D]">{diffResult.changeCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-[#15803D] font-medium">Màu xanh: phần thêm</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#B91C1C] line-through">Gạch ngang: phần bỏ</span>
            </div>
          </div>

          {diffResult.changeCount === 0 ? (
            <p className="text-[#4B6358]">
              Bản sửa hiện vẫn giống hệt bản nháp. Em thử thêm 1 hình ảnh so sánh hoặc thay một từ hay hơn rồi xem lại nhé!
            </p>
          ) : (
            <div className="rounded-xl bg-[#FBFDFC] border border-[#DDE7E2] p-5 text-[19px] leading-[1.85] whitespace-pre-wrap">
              {diffResult.tokens.map((tok, idx) => {
                if (tok.type === 'added') {
                  return (
                    <ins
                      key={idx}
                      className="no-underline bg-[#DCFCE7] text-[#14532D] px-1 rounded font-medium"
                    >
                      {tok.text}
                    </ins>
                  );
                }
                if (tok.type === 'removed') {
                  return (
                    <del
                      key={idx}
                      className="bg-[#FEE2E2] text-[#991B1B] px-1 rounded line-through"
                    >
                      {tok.text}
                    </del>
                  );
                }
                return <span key={idx}>{tok.text}</span>;
              })}
            </div>
          )}
        </section>
      )}

      {/* Main 2-column split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* LEFT: Editable revised text + Yellow Highlight finder */}
        <div className="lg:col-span-7 space-y-6">
          {/* Yellow Highlight Preview (when AI suggestions exist) */}
          {latestReview && latestReview.gop_y.length > 0 && (
            <section className="rounded-2xl bg-[#FFFDF5] border border-[#FDE68A] p-5 sm:p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#78350F] flex items-center gap-2">
                  <Eye className="w-5 h-5" aria-hidden="true" />
                  <span>Các chỗ Bạn Viết tô vàng để em xem lại</span>
                </h2>
              </div>
              <div className="text-[19px] leading-[1.85] whitespace-pre-wrap text-[#1C2A24] bg-white rounded-xl border border-[#FDE68A] p-4">
                {highlightedSegments.map((seg, idx) =>
                  seg.suggestionIndex !== null ? (
                    <mark
                      key={idx}
                      onClick={() => setActiveSuggestionIdx(seg.suggestionIndex)}
                      className={`cursor-pointer rounded px-1 py-0.5 transition-colors ${
                        activeSuggestionIdx === seg.suggestionIndex
                          ? 'bg-[#FDE047] text-[#1C2A24] font-semibold ring-2 ring-[#CA8A04]'
                          : 'bg-[#FEF08A] text-[#1C2A24] hover:bg-[#FDE047]'
                      }`}
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={idx}>{seg.text}</span>
                  )
                )}
              </div>
            </section>
          )}

          {/* Editable Revised Textarea */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="step4-revise-editor" className="text-xl font-bold text-[#1C2A24]">
                Bản sửa của em
              </label>
              <span className="text-[16px] text-[#4B6358] tabular-nums">
                {countWords(project.revisedText)} từ · {diffResult.changeCount} chỗ đã sửa
              </span>
            </div>
            <textarea
              id="step4-revise-editor"
              rows={13}
              maxLength={MAX_ESSAY_CHARS}
              value={project.revisedText}
              onChange={(e) => onChangeRevised(e.target.value)}
              className="w-full p-4 sm:p-5 rounded-xl border border-[#CBD5E1] bg-[#FCFDFC] text-[19px] leading-[1.8] text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </section>
        </div>

        {/* RIGHT: Self-check table + Bạn Viết essay review */}
        <aside className="lg:col-span-5 space-y-6">
          {/* Bạn Viết review panel */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-[#1C2A24]">Nhờ Bạn Viết đọc giúp</h2>
              <p className="text-[16px] text-[#4B6358] tabular-nums">
                Còn <strong className="text-[#15803D]">{remainingReviews}/{MAX_ESSAY_REVIEWS}</strong> lượt cho bài văn này. Bạn Viết chỉ khen cụ thể và hỏi gợi mở, không viết lại câu hộ em.
              </p>
            </div>

            <button
              type="button"
              disabled={loadingReview || remainingReviews <= 0 || !project.revisedText.trim()}
              onClick={onRequestEssayReview}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[52px] px-5 py-3 rounded-xl bg-[#0369A1] text-white font-bold hover:bg-[#075985] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {loadingReview ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquareHeart className="w-5 h-5" aria-hidden="true" />
              )}
              <span>
                {remainingReviews > 0
                  ? 'Nhờ Bạn Viết đọc giúp'
                  : 'Đã dùng đủ 3 lượt đọc giúp'}
              </span>
            </button>

            {latestReview && (
              <div className="space-y-4 pt-1">
                <MascotSpeech
                  title={`Lời khen của Bạn Viết (Lần ${latestReview.attemptNumber}/3)`}
                  tone="success"
                  size="sm"
                >
                  <p>{latestReview.loi_khen}</p>
                </MascotSpeech>

                <div className="space-y-3">
                  <p className="font-semibold text-[#1C2A24]">
                    Các chỗ nên xem lại ({latestReview.gop_y.length}):
                  </p>
                  {latestReview.gop_y.map((item, idx) => {
                    const isActive = activeSuggestionIdx === idx;
                    return (
                      <div
                        key={`gy-${idx}`}
                        onClick={() => setActiveSuggestionIdx(idx)}
                        className={`rounded-xl border p-4 space-y-2 transition-colors ${
                          isActive
                            ? 'bg-[#FEFCE8] border-[#CA8A04]'
                            : 'bg-[#F8FAF9] border-[#DDE7E2]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[16px]">
                          <span className="font-semibold text-[#075985]">
                            Mục {idx + 1} · {CATEGORY_LABELS[item.loai]}
                          </span>
                        </div>
                        <p className="text-[17px]">
                          Đoạn trích:{' '}
                          <mark className="bg-[#FEF08A] text-[#1C2A24] px-1.5 py-0.5 rounded font-medium">
                            “{item.trich_doan}”
                          </mark>
                        </p>
                        <p className="text-[#1C2A24]">{item.cau_hoi_goi_y}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* 6-item Self-Check Table (Có / Chưa) */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-[#1C2A24]">Bảng kiểm tự đánh dấu</h2>
              <span className="text-[16px] text-[#4B6358] tabular-nums">
                Đã rà {answeredCount}/6 mục
              </span>
            </div>

            <div className="divide-y divide-[#EDF3EF]">
              {SELF_CHECK_QUESTIONS.map((q) => {
                const val = project.selfCheck[q.key];
                return (
                  <div
                    key={q.key}
                    className="py-3.5 first:pt-1 last:pb-0 flex flex-col gap-3"
                  >
                    <p className="text-[#1C2A24] font-medium">{q.label}</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        aria-pressed={val === 'co'}
                        onClick={() => onUpdateSelfCheck(q.key, 'co')}
                        className={`min-h-[46px] rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          val === 'co'
                            ? 'bg-[#15803D] text-white'
                            : 'bg-[#F6FAF7] text-[#1C2A24] border border-[#DDE7E2] hover:bg-[#ECFDF5]'
                        }`}
                      >
                        <Check className="w-5 h-5" aria-hidden="true" />
                        <span>Có</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={val === 'chua'}
                        onClick={() => onUpdateSelfCheck(q.key, 'chua')}
                        className={`min-h-[46px] rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          val === 'chua'
                            ? 'bg-[#B45309] text-white'
                            : 'bg-[#F6FAF7] text-[#1C2A24] border border-[#DDE7E2] hover:bg-[#FFFBEB]'
                        }`}
                      >
                        <X className="w-5 h-5" aria-hidden="true" />
                        <span>Chưa</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      {/* Bottom Navigation */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl bg-white border border-[#DDE7E2] p-5">
        <button
          type="button"
          onClick={onPrevStep}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại Bước 3</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {!canProceed && (
            <p className="text-[16px] text-[#92400E]">
              Em hãy tự đánh dấu hết 6 câu trong Bảng kiểm trước khi sang Chia sẻ nhé.
            </p>
          )}
          <button
            type="button"
            disabled={!canProceed}
            onClick={onNextStep}
            className="inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Sang bước 5: Chia sẻ</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
