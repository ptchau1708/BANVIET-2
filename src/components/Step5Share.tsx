import React, { useMemo, useState } from 'react';
import { ArrowLeft, Printer, RotateCcw, Star } from 'lucide-react';
import { SelfRatingState, WritingProject } from '../types';
import {
  computeWordDiff,
  countOutlineDetails,
  countWords,
  getDisplayPersonName,
} from '../utils/writingLogic';
import { MascotSpeech } from './MascotAvatar';

const RATING_CRITERIA: Array<{ key: keyof SelfRatingState; label: string; hint: string }> = [
  { key: 'boCuc', label: 'Bố cục', hint: 'Rõ ràng 3 phần Mở bài, Thân bài, Kết bài' },
  { key: 'ngoaiHinh', label: 'Tả ngoại hình', hint: 'Có nét riêng giúp người nghe hình dung ra ngay' },
  {
    key: 'tinhTinhHoatDong',
    label: 'Tả tính tình, hoạt động',
    hint: 'Có việc làm, cử chỉ hoặc lời nói sinh động',
  },
  { key: 'camXuc', label: 'Cảm xúc', hint: 'Chân thật, thể hiện tình cảm của em' },
  {
    key: 'dungTuChinhTa',
    label: 'Dùng từ, đặt câu, chính tả',
    hint: 'Câu tròn ý, dùng từ hay, ít lỗi chính tả',
  },
];

interface Step5ShareProps {
  project: WritingProject;
  onUpdateRating: (key: keyof SelfRatingState, stars: number) => void;
  onPrevStep: () => void;
  onStartNewEssay: () => void;
}

export const Step5Share: React.FC<Step5ShareProps> = ({
  project,
  onUpdateRating,
  onPrevStep,
  onStartNewEssay,
}) => {
  const [showNewConfirm, setShowNewConfirm] = useState(false);

  const personLabel = getDisplayPersonName(project);
  const outlineDetailCount = countOutlineDetails(project.outline);
  const draftWordCount = countWords(project.draftText);
  const revisedWordCount = countWords(project.revisedText);
  const diffResult = useMemo(
    () => computeWordDiff(project.draftText, project.revisedText),
    [project.draftText, project.revisedText]
  );

  const paragraphs = useMemo(
    () =>
      project.revisedText
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [project.revisedText]
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8">
      <div className="no-print">
        <MascotSpeech title="Chúc mừng bạn đã hoàn thành bài văn!" tone="success">
          <p>
            Bạn đã tự quan sát, tự lập dàn ý, tự viết và tự chỉnh sửa nên bài văn tả{' '}
            <strong>{personLabel.toLowerCase()}</strong> của riêng mình. Giờ hãy tự đánh giá bằng ngôi sao và đọc to bài văn thật tự tin nhé!
          </p>
        </MascotSpeech>
      </div>

      {/* Summary metrics strip */}
      <section aria-label="Tóm tắt hành trình viết bài" className="no-print">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5">
            <p className="text-[16px] text-[#4B6358]">Chi tiết dàn ý</p>
            <p className="text-3xl font-bold text-[#14532D] mt-1 tabular-nums">
              {outlineDetailCount}
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5">
            <p className="text-[16px] text-[#4B6358]">Số từ bản nháp</p>
            <p className="text-3xl font-bold text-[#1C2A24] mt-1 tabular-nums">
              {draftWordCount}
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5">
            <p className="text-[16px] text-[#4B6358]">Số từ bản sửa</p>
            <p className="text-3xl font-bold text-[#15803D] mt-1 tabular-nums">
              {revisedWordCount}
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5">
            <p className="text-[16px] text-[#4B6358]">Chỗ đã tự sửa</p>
            <p className="text-3xl font-bold text-[#0369A1] mt-1 tabular-nums">
              {diffResult.changeCount}
            </p>
          </div>
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5 col-span-2 sm:col-span-1">
            <p className="text-[16px] text-[#4B6358]">Lần nhờ AI</p>
            <p className="text-3xl font-bold text-[#B45309] mt-1 tabular-nums">
              {project.aiCallCount}
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Beautiful classroom read-aloud presentation sheet */}
        <article className="print-only-sheet lg:col-span-7 rounded-2xl bg-white border border-[#DDE7E2] p-6 sm:p-10 space-y-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E2ECE6]">
            <div>
              <p className="text-[16px] text-[#4B6358] no-print">Bản hoàn chỉnh để đọc trước lớp</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#1C2A24] mt-1 font-serif">
                Bài văn tả {personLabel.toLowerCase()}
              </h1>
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="no-print inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-5 h-5" aria-hidden="true" />
              <span>In / Lưu PDF</span>
            </button>
          </div>

          <div className="font-serif text-[21px] sm:text-[22px] leading-[1.9] text-[#1C2A24] space-y-5">
            {paragraphs.map((para, idx) => (
              <p key={idx} className="indent-8">
                {para}
              </p>
            ))}
          </div>

          <div className="pt-5 border-t border-[#E2ECE6] text-[16px] text-[#4B6358] flex flex-wrap items-center gap-3 tabular-nums">
            <span>{revisedWordCount} từ</span>
            <span aria-hidden="true">·</span>
            <span>{diffResult.changeCount} chỗ tự chỉnh sửa</span>
            <span aria-hidden="true">·</span>
            <span>Viết cùng Bạn Viết</span>
          </div>
        </article>

        {/* Self-evaluation 1-3 stars for 5 criteria */}
        <section className="no-print lg:col-span-5 rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-[#1C2A24]">Em tự đánh giá bài viết</h2>
            <p className="text-[16px] text-[#4B6358]">
              Chạm từ 1 đến 3 ngôi sao cho mỗi tiêu chí nhé!
            </p>
          </div>

          <div className="divide-y divide-[#EDF3EF]">
            {RATING_CRITERIA.map((criterion) => {
              const currentStars = project.selfRating[criterion.key];
              return (
                <div key={criterion.key} className="py-4 first:pt-1 last:pb-0 space-y-2.5">
                  <div>
                    <p className="font-bold text-[#1C2A24]">{criterion.label}</p>
                    <p className="text-[16px] text-[#4B6358]">{criterion.hint}</p>
                  </div>
                  <div
                    className="flex items-center gap-2"
                    role="group"
                    aria-label={`Tự đánh giá ${criterion.label}`}
                  >
                    {[1, 2, 3].map((starValue) => {
                      const filled = starValue <= currentStars;
                      return (
                        <button
                          key={starValue}
                          type="button"
                          onClick={() => onUpdateRating(criterion.key, starValue)}
                          aria-label={`${starValue} sao cho ${criterion.label}`}
                          aria-pressed={filled}
                          className={`min-h-[48px] min-w-[52px] px-3 rounded-xl border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                            filled
                              ? 'bg-[#FEF9C3] border-[#FACC15] text-[#B45309]'
                              : 'bg-[#F8FAFC] border-[#DDE7E2] text-[#94A3B8] hover:bg-[#FEFCE8]'
                          }`}
                        >
                          <Star
                            className={`w-6 h-6 ${filled ? 'fill-[#F59E0B] text-[#D97706]' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                    <span className="ml-2 text-[16px] text-[#4B6358] tabular-nums">
                      {currentStars > 0 ? `${currentStars}/3 sao` : 'Chưa chọn'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Bottom controls */}
      <div className="no-print flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl bg-white border border-[#DDE7E2] p-5">
        <button
          type="button"
          onClick={onPrevStep}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại Bước 4</span>
        </button>

        <button
          type="button"
          onClick={() => setShowNewConfirm(true)}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#15803D] bg-white text-[#15803D] font-semibold hover:bg-[#ECFDF5] whitespace-nowrap cursor-pointer"
        >
          <RotateCcw className="w-5 h-5" aria-hidden="true" />
          <span>Viết bài mới</span>
        </button>
      </div>

      {showNewConfirm && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-essay-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 border border-[#DDE7E2] shadow-xl space-y-4">
            <h2 id="new-essay-title" className="text-xl font-bold text-[#1C2A24]">
              Bắt đầu một bài văn mới?
            </h2>
            <p className="text-[#334155]">
              Nếu em muốn giữ lại bài hiện tại, hãy bấm “In / Lưu PDF” trước khi tạo bài mới nhé.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowNewConfirm(false)}
                className="flex-1 min-h-[48px] rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer"
              >
                Ở lại bài này
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewConfirm(false);
                  onStartNewEssay();
                }}
                className="flex-1 min-h-[48px] rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] cursor-pointer"
              >
                Tạo bài mới
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
