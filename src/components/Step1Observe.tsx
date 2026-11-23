import React, { useState } from 'react';
import { ArrowRight, HelpCircle, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  ObservationBoxKey,
  PersonChoice,
  WritingProject,
} from '../types';
import { getDisplayPersonName, isStep1Complete } from '../utils/writingLogic';
import { MascotSpeech } from './MascotAvatar';

const PERSON_OPTIONS: PersonChoice[] = [
  'Ông',
  'Bà',
  'Bố',
  'Mẹ',
  'Anh chị em',
  'Thầy cô',
  'Bạn',
  'Em bé',
  'Người khác',
];

interface BoxConfig {
  key: ObservationBoxKey;
  title: string;
  hint: string;
  placeholder: string;
}

const OBSERVATION_BOXES: BoxConfig[] = [
  {
    key: 'ngoaiHinh',
    title: 'Ngoại hình',
    hint: 'Ghi vài nét nổi bật về dáng người, mái tóc, khuôn mặt, đôi mắt, bàn tay…',
    placeholder: 'Ví dụ: tóc bạc búi gọn, đôi mắt hiền…',
  },
  {
    key: 'tinhTinh',
    title: 'Tính tình',
    hint: 'Người ấy có tính cách gì nổi bật? (hiền hậu, vui tính, nghiêm khắc, chăm chỉ…)',
    placeholder: 'Ví dụ: rất hiền và kiên nhẫn…',
  },
  {
    key: 'hoatDongLoiNoi',
    title: 'Hoạt động, lời nói',
    hint: 'Người ấy thường làm gì hằng ngày? Hay nói câu gì quen thuộc với em?',
    placeholder: 'Ví dụ: sáng tưới hoa, hay hỏi chuyện ở lớp…',
  },
  {
    key: 'tinhCam',
    title: 'Tình cảm của em',
    hint: 'Em cảm thấy thế nào khi ở bên người ấy? Em mong ước điều gì cho người ấy?',
    placeholder: 'Ví dụ: rất yêu quý, mong bà luôn khỏe mạnh…',
  },
];

interface Step1ObserveProps {
  project: WritingProject;
  onSelectPerson: (choice: PersonChoice) => void;
  onChangeCustomPerson: (label: string) => void;
  onAddNote: (box: ObservationBoxKey, note: string) => void;
  onRemoveNote: (box: ObservationBoxKey, index: number) => void;
  onAskMemoryPrompt: (box: ObservationBoxKey, boxTitle: string) => Promise<void>;
  loadingBox: ObservationBoxKey | null;
  errorMsg: string | null;
  onNextStep: () => void;
}

export const Step1Observe: React.FC<Step1ObserveProps> = ({
  project,
  onSelectPerson,
  onChangeCustomPerson,
  onAddNote,
  onRemoveNote,
  onAskMemoryPrompt,
  loadingBox,
  errorMsg,
  onNextStep,
}) => {
  const [draftInputs, setDraftInputs] = useState<Record<ObservationBoxKey, string>>({
    ngoaiHinh: '',
    tinhTinh: '',
    hoatDongLoiNoi: '',
    tinhCam: '',
  });

  const personLabel = getDisplayPersonName(project);
  const canProceed = isStep1Complete(project);

  const handleSubmitNote = (box: ObservationBoxKey, e: React.FormEvent) => {
    e.preventDefault();
    const val = draftInputs[box].trim();
    if (!val) return;
    onAddNote(box, val);
    setDraftInputs((prev) => ({ ...prev, [box]: '' }));
  };

  return (
    <div className="space-y-8">
      {/* Privacy reminder + Mascot welcome */}
      <section aria-label="Lời nhắc bảo vệ thông tin riêng tư">
        <MascotSpeech title="Chào bạn! Mình là Bạn Viết" tone="warm">
          <p className="font-medium text-[#78350F] flex items-start gap-2">
            <ShieldCheck className="w-6 h-6 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
            <span>
              Em hãy gọi người mình tả là bà, mẹ, cô…, không cần viết họ tên thật.
            </span>
          </p>
          <p className="mt-2 text-[#334155]">
            Mình sẽ đặt câu hỏi gợi nhớ để em tự tìm ra những chi tiết thật hay và tự viết nên bài văn của riêng mình nhé!
          </p>
        </MascotSpeech>
      </section>

      {/* Person selector */}
      <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-7 space-y-5">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-[#1C2A24] text-balance">
            1. Em muốn tả ai trong bài văn này?
          </h1>
          <p className="mt-1 text-[#4B6358]">
            Chọn một người quen thuộc mà em nhớ rõ hình dáng, cử chỉ và lời nói.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {PERSON_OPTIONS.map((option) => {
            const selected = project.personChoice === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onSelectPerson(option)}
                aria-pressed={selected}
                className={`min-h-[52px] px-4 py-3 rounded-xl font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  selected
                    ? 'bg-[#15803D] text-white shadow-sm'
                    : 'bg-[#F6FAF7] text-[#1C2A24] border border-[#DDE7E2] hover:bg-[#ECFDF5] hover:border-[#86EFAC]'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {project.personChoice === 'Người khác' && (
          <div className="pt-2 max-w-md">
            <label
              htmlFor="custom-person-input"
              className="block font-semibold text-[#1C2A24] mb-2"
            >
              Em gọi người đó là gì? (ví dụ: bác hàng xóm, chú bảo vệ…)
            </label>
            <input
              id="custom-person-input"
              type="text"
              maxLength={40}
              value={project.customPersonLabel}
              onChange={(e) => onChangeCustomPerson(e.target.value)}
              placeholder="Ví dụ: chú bảo vệ, bác hàng xóm…"
              className="w-full min-h-[50px] px-4 py-3 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </div>
        )}
      </section>

      {/* 4 Observation boxes */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-[#1C2A24]">
              2. Phiếu quan sát {personLabel ? `về ${personLabel.toLowerCase()}` : ''}
            </h2>
            <p className="text-[#4B6358]">
              Ghi nhanh các ý ngắn vào từng ô. Chưa cần viết thành câu dài đâu nhé!
            </p>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-5 py-4 text-[#991B1B]"
          >
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {OBSERVATION_BOXES.map((box) => {
            const items = project.observations[box.key];
            const aiPrompt = project.observationPrompts[box.key];
            const isLoading = loadingBox === box.key;

            return (
              <div
                key={box.key}
                className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-[#1C2A24]">{box.title}</h3>
                      <p className="text-[16px] text-[#4B6358] mt-0.5">{box.hint}</p>
                    </div>
                    <button
                      type="button"
                      disabled={isLoading || !personLabel}
                      onClick={() => onAskMemoryPrompt(box.key, box.title)}
                      className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-[#E0F2FE] text-[#075985] font-semibold hover:bg-[#BAE6FD] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      ) : (
                        <HelpCircle className="w-5 h-5" aria-hidden="true" />
                      )}
                      <span>Gợi ý cho em</span>
                    </button>
                  </div>

                  {aiPrompt && (
                    <MascotSpeech title="Bạn Viết hỏi gợi nhớ" size="sm">
                      <p>{aiPrompt}</p>
                    </MascotSpeech>
                  )}

                  {items.length > 0 ? (
                    <ul className="space-y-2.5">
                      {items.map((note, idx) => (
                        <li
                          key={`${box.key}-${idx}`}
                          className="flex items-start justify-between gap-3 rounded-xl bg-[#F6FAF7] border border-[#E2ECE6] px-4 py-3"
                        >
                          <span className="text-[#1C2A24] break-words">{note}</span>
                          <button
                            type="button"
                            onClick={() => onRemoveNote(box.key, idx)}
                            aria-label={`Xóa ý "${note}" ở ô ${box.title}`}
                            className="min-h-[40px] min-w-[40px] -mr-1.5 -my-1 flex items-center justify-center rounded-lg text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[16px] text-[#64748B] italic py-2">
                      Chưa có ý nào. Em ghi một ý ngắn bên dưới nhé!
                    </p>
                  )}
                </div>

                <form
                  onSubmit={(e) => handleSubmitNote(box.key, e)}
                  className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-[#EDF3EF]"
                >
                  <label htmlFor={`note-input-${box.key}`} className="sr-only">
                    Thêm ý vào ô {box.title}
                  </label>
                  <input
                    id={`note-input-${box.key}`}
                    type="text"
                    maxLength={160}
                    value={draftInputs[box.key]}
                    onChange={(e) =>
                      setDraftInputs((prev) => ({ ...prev, [box.key]: e.target.value }))
                    }
                    placeholder={box.placeholder}
                    className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-5 py-2.5 rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-5 h-5" aria-hidden="true" />
                    <span>Thêm ý</span>
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom next-step CTA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl bg-white border border-[#DDE7E2] p-5">
        <p className="text-[#4B6358]">
          {canProceed
            ? 'Tuyệt vời! Em đã có những quan sát ban đầu để chuyển sang bước Lập dàn ý.'
            : 'Để sang Bước 2 (Lập ý), em hãy chọn người cần tả và ghi ý vào ít nhất 2 ô quan sát nhé.'}
        </p>
        <button
          type="button"
          disabled={!canProceed}
          onClick={onNextStep}
          className="inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Sang bước 2: Lập ý</span>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
