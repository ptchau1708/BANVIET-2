import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ListTree,
  Lock,
  X,
} from 'lucide-react';
import { WritingProject } from '../types';
import {
  MAX_ESSAY_CHARS,
  countParagraphs,
  countWords,
  getDisplayPersonName,
  shouldBlockPaste,
} from '../utils/writingLogic';

interface Step3WriteProps {
  project: WritingProject;
  onChangeDraft: (nextText: string) => void;
  onLockDraft: () => void;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export const Step3Write: React.FC<Step3WriteProps> = ({
  project,
  onChangeDraft,
  onLockDraft,
  onPrevStep,
  onNextStep,
}) => {
  const [pasteReminder, setPasteReminder] = useState(false);
  const [showMobileOutline, setShowMobileOutline] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  const personLabel = getDisplayPersonName(project);
  const wordCount = countWords(project.draftText);
  const paragraphCount = countParagraphs(project.draftText);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (shouldBlockPaste(pasted)) {
      e.preventDefault();
      setPasteReminder(true);
    }
  };

  const renderOutlineContent = () => (
    <div className="space-y-5">
      <div>
        <h3 className="font-bold text-[#14532D] mb-1">1. Mở bài</h3>
        <p className="text-[#1C2A24] bg-[#F6FAF7] rounded-xl p-3.5 border border-[#E2ECE6]">
          {project.outline.moBai || 'Chưa ghi'}
        </p>
      </div>

      <div>
        <h3 className="font-bold text-[#14532D] mb-1.5">2a. Tả ngoại hình</h3>
        <ul className="list-disc list-inside space-y-1.5 text-[#1C2A24] bg-[#F6FAF7] rounded-xl p-3.5 border border-[#E2ECE6]">
          {project.outline.ngoaiHinh.map((item, idx) => (
            <li key={`o-nh-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-bold text-[#14532D] mb-1.5">2b. Tả tính tình, hoạt động</h3>
        <ul className="list-disc list-inside space-y-1.5 text-[#1C2A24] bg-[#F6FAF7] rounded-xl p-3.5 border border-[#E2ECE6]">
          {project.outline.tinhTinhHoatDong.map((item, idx) => (
            <li key={`o-tt-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-bold text-[#14532D] mb-1">3. Kết bài</h3>
        <p className="text-[#1C2A24] bg-[#F6FAF7] rounded-xl p-3.5 border border-[#E2ECE6]">
          {project.outline.ketBai || 'Chưa ghi'}
        </p>
      </div>

      {project.savedWords.length > 0 && (
        <div className="pt-2 border-t border-[#EDF3EF]">
          <h3 className="font-bold text-[#14532D] mb-2 flex items-center gap-2">
            <BookOpen className="w-5 h-5" aria-hidden="true" />
            <span>Kho từ riêng của em</span>
          </h3>
          <p className="text-[#334155] leading-relaxed">
            {project.savedWords.join(' · ')}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header — ZERO AI controls here */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-[#1C2A24] text-balance">
            Tự viết bài văn tả {personLabel.toLowerCase()}
          </h1>
          <p className="text-[#4B6358]">
            Đây là giờ tự viết của riêng em. Em nhìn dàn ý bên cạnh và tự gõ từng câu văn thật chân thật nhé!
          </p>
        </div>

        {/* Mobile outline toggle button */}
        <button
          type="button"
          onClick={() => setShowMobileOutline(true)}
          className="lg:hidden inline-flex items-center justify-center gap-2 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#ECFDF5] text-[#14532D] border border-[#86EFAC] font-semibold hover:bg-[#DCFCE7] whitespace-nowrap cursor-pointer"
        >
          <ListTree className="w-5 h-5" aria-hidden="true" />
          <span>Xem dàn ý của em</span>
        </button>
      </div>

      {/* Gentle paste reminder */}
      {pasteReminder && (
        <div
          role="status"
          className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-4 flex items-center justify-between gap-4 text-[#78350F]"
        >
          <p className="font-semibold">
            Em tự gõ nhé! Tự gõ từng chữ giúp bài văn mang đúng giọng điệu của riêng em.
          </p>
          <button
            type="button"
            onClick={() => setPasteReminder(false)}
            aria-label="Đóng lời nhắc tự gõ"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-[#FEF3C7] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Main Split: Left 8 cols Editor, Right 4 cols Outline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        <section className="lg:col-span-8 rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EDF3EF]">
            <div className="flex flex-wrap items-center gap-3 text-[#4B6358] tabular-nums">
              <span>
                <strong className="text-[#1C2A24]">{wordCount}</strong> từ
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-[#1C2A24]">{paragraphCount}</strong> đoạn
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {project.draftText.length}/{MAX_ESSAY_CHARS} ký tự
              </span>
            </div>

            {project.draftLocked && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#15803D]">
                <Lock className="w-4 h-4" aria-hidden="true" />
                <span>Đã lưu bản nháp cố định</span>
              </span>
            )}
          </div>

          <label htmlFor="step3-draft-editor" className="sr-only">
            Ô soạn thảo bản nháp bài văn tả {personLabel}
          </label>
          <textarea
            id="step3-draft-editor"
            rows={14}
            maxLength={MAX_ESSAY_CHARS}
            readOnly={project.draftLocked}
            value={project.draftText}
            onChange={(e) => {
              if (project.draftLocked) return;
              setPasteReminder(false);
              onChangeDraft(e.target.value);
            }}
            onPaste={handlePaste}
            placeholder={`Em bắt đầu viết mở bài tả ${personLabel.toLowerCase()} ở đây…\n\nNhấn phím Enter hai lần để tách sang đoạn thân bài và kết bài nhé!`}
            className={`w-full p-4 sm:p-5 rounded-xl border text-[19px] leading-[1.8] focus:outline-none ${
              project.draftLocked
                ? 'bg-[#F8FAF9] border-[#DDE7E2] text-[#334155] cursor-default'
                : 'bg-[#FCFDFC] border-[#CBD5E1] text-[#1C2A24] focus:ring-2 focus:ring-[#15803D]'
            }`}
          />

          {project.draftLocked ? (
            <div className="rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-[#14532D] font-medium flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>
                  Bản nháp đã được khóa để giữ làm kỷ niệm. Giờ em sang Bước 4 để tự sửa trên bản sao nhé!
                </span>
              </p>
              <button
                type="button"
                onClick={onNextStep}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Sang bước 4: Tự sửa</span>
                <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
              <p className="text-[16px] text-[#4B6358]">
                Mẹo: Tách rõ 3 phần Mở bài, Thân bài, Kết bài bằng dòng trống cho dễ đọc.
              </p>
              <button
                type="button"
                disabled={wordCount < 15}
                onClick={() => setShowLockConfirm(true)}
                className="inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                <span>Xong bản nháp</span>
              </button>
            </div>
          )}
        </section>

        {/* Desktop Side Outline Panel */}
        <aside className="hidden lg:block lg:col-span-4 rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4 sticky top-20">
          <h2 className="text-xl font-bold text-[#1C2A24] flex items-center gap-2">
            <ListTree className="w-5 h-5 text-[#15803D]" aria-hidden="true" />
            <span>Dàn ý của em</span>
          </h2>
          {renderOutlineContent()}
        </aside>
      </div>

      {/* Bottom back nav */}
      <div className="flex items-center justify-between rounded-2xl bg-white border border-[#DDE7E2] p-5">
        <button
          type="button"
          onClick={onPrevStep}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại Bước 2</span>
        </button>

        {!project.draftLocked && wordCount < 15 && (
          <p className="text-[16px] text-[#4B6358]">
            Em hãy viết ít nhất 15 từ trước khi bấm “Xong bản nháp” nhé.
          </p>
        )}
      </div>

      {/* Mobile Outline Drawer */}
      {showMobileOutline && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-outline-title"
        >
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between gap-4 border-b border-[#DDE7E2] pb-3">
              <h2 id="mobile-outline-title" className="text-xl font-bold text-[#1C2A24]">
                Dàn ý của em
              </h2>
              <button
                type="button"
                onClick={() => setShowMobileOutline(false)}
                aria-label="Đóng dàn ý"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-[#F1F5F9] cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            {renderOutlineContent()}
            <button
              type="button"
              onClick={() => setShowMobileOutline(false)}
              className="w-full min-h-[48px] rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] cursor-pointer"
            >
              Đóng để viết tiếp
            </button>
          </div>
        </div>
      )}

      {/* Lock Draft Confirmation Modal */}
      {showLockConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lock-draft-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 border border-[#DDE7E2] shadow-xl space-y-4">
            <h2 id="lock-draft-title" className="text-xl font-bold text-[#1C2A24]">
              Lưu cố định bản nháp này?
            </h2>
            <p className="text-[#334155]">
              Khi bấm xác nhận, bản nháp sẽ được giữ nguyên không sửa nữa để sau này em so sánh xem mình đã tiến bộ bao nhiêu ở Bước 4 (Tự sửa).
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLockConfirm(false)}
                className="flex-1 min-h-[48px] rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer"
              >
                Viết thêm chút nữa
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLockConfirm(false);
                  onLockDraft();
                }}
                className="flex-1 min-h-[48px] rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] cursor-pointer"
              >
                Lưu bản nháp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
