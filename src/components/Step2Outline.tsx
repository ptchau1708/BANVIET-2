import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { OutlineData, WritingProject } from '../types';
import {
  MAX_MESSAGE_CHARS,
  getDisplayPersonName,
  isStep2Complete,
} from '../utils/writingLogic';
import { MascotAvatar, MascotSpeech } from './MascotAvatar';

const WORD_TOPICS = [
  'Mái tóc',
  'Đôi mắt & khuôn mặt',
  'Dáng người & bàn tay',
  'Giọng nói & nụ cười',
  'Tính tình',
  'Hoạt động hằng ngày',
  'Tình cảm của em',
];

interface Step2OutlineProps {
  project: WritingProject;
  onUpdateOutline: (next: OutlineData) => void;
  onSendChat: (message: string) => Promise<void>;
  onFetchWordBank: (topic: string) => Promise<void>;
  onToggleSavedWord: (word: string) => void;
  onCheckOutline: () => Promise<void>;
  loadingChat: boolean;
  loadingWords: boolean;
  loadingCheck: boolean;
  errorMsg: string | null;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export const Step2Outline: React.FC<Step2OutlineProps> = ({
  project,
  onUpdateOutline,
  onSendChat,
  onFetchWordBank,
  onToggleSavedWord,
  onCheckOutline,
  loadingChat,
  loadingWords,
  loadingCheck,
  errorMsg,
  onPrevStep,
  onNextStep,
}) => {
  const [newAppearance, setNewAppearance] = useState('');
  const [newPersonality, setNewPersonality] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [selectedTopic, setSelectedTopic] = useState(
    project.suggestedWordTopic || WORD_TOPICS[0]
  );

  const personLabel = getDisplayPersonName(project);
  const canProceed = isStep2Complete(project);
  const check = project.outlineCheck;

  const ngoaiCount = check
    ? check.so_chi_tiet_ngoai_hinh
    : project.outline.ngoaiHinh.filter((x) => x.trim()).length;
  const tinhCount = check
    ? check.so_chi_tiet_tinh_tinh_hoat_dong
    : project.outline.tinhTinhHoatDong.filter((x) => x.trim()).length;
  const hasAll3Parts = check
    ? check.du_3_phan
    : Boolean(
        project.outline.moBai.trim() &&
          project.outline.ketBai.trim() &&
          (project.outline.ngoaiHinh.length > 0 || project.outline.tinhTinhHoatDong.length > 0)
      );

  const addAppearance = (e: React.FormEvent) => {
    e.preventDefault();
    const val = newAppearance.trim();
    if (!val) return;
    onUpdateOutline({
      ...project.outline,
      ngoaiHinh: [...project.outline.ngoaiHinh, val],
    });
    setNewAppearance('');
  };

  const addPersonality = (e: React.FormEvent) => {
    e.preventDefault();
    const val = newPersonality.trim();
    if (!val) return;
    onUpdateOutline({
      ...project.outline,
      tinhTinhHoatDong: [...project.outline.tinhTinhHoatDong, val],
    });
    setNewPersonality('');
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || loadingChat) return;
    setChatInput('');
    await onSendChat(trimmed);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-[#1C2A24] text-balance">
            Sơ đồ dàn ý tả {personLabel.toLowerCase()}
          </h1>
          <p className="text-[#4B6358]">
            Các ý em ghi ở Bước 1 đã được đưa sẵn sang đây. Em có thể sắp xếp, thêm hoặc bớt ý cho rõ ràng.
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

      {/* Main 2-column desktop split: Left 7 cols Outline Diagram, Right 5 cols Bạn Viết Companion */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* LEFT: Visual 3-Part Outline Diagram */}
        <div className="lg:col-span-7 space-y-5">
          {/* Part 1: Mở bài */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-[#14532D]">1. Mở bài</h2>
              <span className="text-[16px] text-[#4B6358]">Giới thiệu người được tả</span>
            </div>
            <label htmlFor="outline-mo-bai" className="sr-only">
              Ý cho phần Mở bài
            </label>
            <textarea
              id="outline-mo-bai"
              rows={2}
              maxLength={500}
              value={project.outline.moBai}
              onChange={(e) =>
                onUpdateOutline({ ...project.outline, moBai: e.target.value })
              }
              placeholder="Ví dụ: Em định giới thiệu ai? Người ấy có quan hệ thế nào với em?"
              className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-[#FBFDFC] text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </section>

          {/* Visual connector arrow */}
          <div className="flex justify-center" aria-hidden="true">
            <div className="w-0.5 h-5 bg-[#B7D4C3]" />
          </div>

          {/* Part 2: Thân bài */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EDF3EF]">
              <h2 className="text-xl font-bold text-[#14532D]">2. Thân bài</h2>
              <span className="text-[16px] text-[#4B6358]">
                Gồm Tả ngoại hình và Tả tính tình, hoạt động
              </span>
            </div>

            {/* 2a. Tả ngoại hình */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-[#1C2A24]">2a. Tả ngoại hình</h3>
                <span className="text-[16px] text-[#4B6358] tabular-nums">
                  {project.outline.ngoaiHinh.length} ý · cần ít nhất 3 chi tiết
                </span>
              </div>

              {project.outline.ngoaiHinh.length > 0 ? (
                <ul className="space-y-2">
                  {project.outline.ngoaiHinh.map((item, idx) => (
                    <li
                      key={`nh-${idx}`}
                      className="flex items-start justify-between gap-3 rounded-xl bg-[#F6FAF7] border border-[#E2ECE6] px-4 py-2.5"
                    >
                      <span className="break-words">{item}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOutline({
                            ...project.outline,
                            ngoaiHinh: project.outline.ngoaiHinh.filter((_, i) => i !== idx),
                          })
                        }
                        aria-label={`Xóa chi tiết ngoại hình "${item}"`}
                        className="min-h-[40px] min-w-[40px] -mr-1.5 -my-1 flex items-center justify-center rounded-lg text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[16px] text-[#64748B] italic">
                  Chưa có ý ngoại hình nào. Em thêm ít nhất 3 nét riêng nhé!
                </p>
              )}

              <form onSubmit={addAppearance} className="flex flex-col sm:flex-row gap-2.5">
                <label htmlFor="add-outline-nh" className="sr-only">
                  Thêm chi tiết tả ngoại hình
                </label>
                <input
                  id="add-outline-nh"
                  type="text"
                  maxLength={200}
                  value={newAppearance}
                  onChange={(e) => setNewAppearance(e.target.value)}
                  placeholder="Thêm 1 chi tiết ngoại hình…"
                  className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#ECFDF5] text-[#14532D] border border-[#86EFAC] font-semibold hover:bg-[#DCFCE7] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-5 h-5" aria-hidden="true" />
                  <span>Thêm</span>
                </button>
              </form>
            </div>

            <div className="border-t border-[#EDF3EF]" />

            {/* 2b. Tả tính tình, hoạt động */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-[#1C2A24]">2b. Tả tính tình, hoạt động</h3>
                <span className="text-[16px] text-[#4B6358] tabular-nums">
                  {project.outline.tinhTinhHoatDong.length} ý · cần ít nhất 2 chi tiết
                </span>
              </div>

              {project.outline.tinhTinhHoatDong.length > 0 ? (
                <ul className="space-y-2">
                  {project.outline.tinhTinhHoatDong.map((item, idx) => (
                    <li
                      key={`tt-${idx}`}
                      className="flex items-start justify-between gap-3 rounded-xl bg-[#F6FAF7] border border-[#E2ECE6] px-4 py-2.5"
                    >
                      <span className="break-words">{item}</span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateOutline({
                            ...project.outline,
                            tinhTinhHoatDong: project.outline.tinhTinhHoatDong.filter(
                              (_, i) => i !== idx
                            ),
                          })
                        }
                        aria-label={`Xóa chi tiết tính tình hoạt động "${item}"`}
                        className="min-h-[40px] min-w-[40px] -mr-1.5 -my-1 flex items-center justify-center rounded-lg text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEE2E2] cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[16px] text-[#64748B] italic">
                  Chưa có ý về tính tình hoặc hoạt động. Em thêm ít nhất 2 chi tiết nhé!
                </p>
              )}

              <form onSubmit={addPersonality} className="flex flex-col sm:flex-row gap-2.5">
                <label htmlFor="add-outline-tt" className="sr-only">
                  Thêm chi tiết tả tính tình hoặc hoạt động
                </label>
                <input
                  id="add-outline-tt"
                  type="text"
                  maxLength={200}
                  value={newPersonality}
                  onChange={(e) => setNewPersonality(e.target.value)}
                  placeholder="Thêm 1 chi tiết tính tình, việc làm hoặc lời nói…"
                  className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#ECFDF5] text-[#14532D] border border-[#86EFAC] font-semibold hover:bg-[#DCFCE7] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-5 h-5" aria-hidden="true" />
                  <span>Thêm</span>
                </button>
              </form>
            </div>
          </section>

          {/* Visual connector arrow */}
          <div className="flex justify-center" aria-hidden="true">
            <div className="w-0.5 h-5 bg-[#B7D4C3]" />
          </div>

          {/* Part 3: Kết bài */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-[#14532D]">3. Kết bài</h2>
              <span className="text-[16px] text-[#4B6358]">Tình cảm của em</span>
            </div>
            <label htmlFor="outline-ket-bai" className="sr-only">
              Ý cho phần Kết bài
            </label>
            <textarea
              id="outline-ket-bai"
              rows={2}
              maxLength={500}
              value={project.outline.ketBai}
              onChange={(e) =>
                onUpdateOutline({ ...project.outline, ketBai: e.target.value })
              }
              placeholder="Ví dụ: Tình cảm của em với người ấy và mong ước của em…"
              className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-[#FBFDFC] text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </section>

          {/* Outline Check Badges Section */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#1C2A24]">Huy hiệu kiểm tra dàn ý</h2>
                <p className="text-[16px] text-[#4B6358]">
                  Không chấm điểm — chỉ giúp em xem dàn ý đã đủ ý để bắt đầu viết chưa.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingCheck}
                onClick={onCheckOutline}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-[#0369A1] text-white font-semibold hover:bg-[#075985] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {loadingCheck ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Award className="w-5 h-5" aria-hidden="true" />
                )}
                <span>Kiểm tra dàn ý</span>
              </button>
            </div>

            {/* 3 Achievement Badges (dual-coded icon + label, no numeric grade) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div
                className={`rounded-xl border p-4 flex items-start gap-3 ${
                  hasAll3Parts
                    ? 'bg-[#ECFDF5] border-[#86EFAC] text-[#14532D]'
                    : 'bg-[#F8FAFC] border-[#DDE7E2] text-[#475569]'
                }`}
              >
                {hasAll3Parts ? (
                  <CheckCircle2 className="w-6 h-6 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <CircleDashed className="w-6 h-6 text-[#94A3B8] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="font-bold">Đủ 3 phần</p>
                  <p className="text-[16px]">
                    {hasAll3Parts ? 'Đạt · Mở, Thân, Kết' : 'Cần đủ Mở, Thân, Kết'}
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 flex items-start gap-3 ${
                  ngoaiCount >= 3
                    ? 'bg-[#ECFDF5] border-[#86EFAC] text-[#14532D]'
                    : 'bg-[#F8FAFC] border-[#DDE7E2] text-[#475569]'
                }`}
              >
                {ngoaiCount >= 3 ? (
                  <CheckCircle2 className="w-6 h-6 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <CircleDashed className="w-6 h-6 text-[#94A3B8] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="font-bold">Ngoại hình</p>
                  <p className="text-[16px] tabular-nums">
                    {ngoaiCount}/3 chi tiết {ngoaiCount >= 3 ? '· Đạt' : '· Thêm ý'}
                  </p>
                </div>
              </div>

              <div
                className={`rounded-xl border p-4 flex items-start gap-3 ${
                  tinhCount >= 2
                    ? 'bg-[#ECFDF5] border-[#86EFAC] text-[#14532D]'
                    : 'bg-[#F8FAFC] border-[#DDE7E2] text-[#475569]'
                }`}
              >
                {tinhCount >= 2 ? (
                  <CheckCircle2 className="w-6 h-6 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <CircleDashed className="w-6 h-6 text-[#94A3B8] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="font-bold">Tính tình, hoạt động</p>
                  <p className="text-[16px] tabular-nums">
                    {tinhCount}/2 chi tiết {tinhCount >= 2 ? '· Đạt' : '· Thêm ý'}
                  </p>
                </div>
              </div>
            </div>

            {check && (
              <MascotSpeech
                title="Nhận xét dàn ý của Bạn Viết"
                tone={
                  check.du_3_phan &&
                  check.so_chi_tiet_ngoai_hinh >= 3 &&
                  check.so_chi_tiet_tinh_tinh_hoat_dong >= 2
                    ? 'success'
                    : 'warm'
                }
                size="sm"
              >
                {check.phan_con_thieu.length > 0 ? (
                  <div className="mb-2">
                    <p className="font-semibold">Phần nên bổ sung thêm:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {check.phan_con_thieu.map((missing, i) => (
                        <li key={i}>{missing}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="font-semibold text-[#15803D] mb-2">
                    Hoan hô! Dàn ý của bạn đã đủ các phần và chi tiết quan trọng rồi!
                  </p>
                )}
                {check.cau_hoi_goi_y.length > 0 && (
                  <div className="space-y-1.5">
                    {check.cau_hoi_goi_y.map((q, i) => (
                      <p key={i}>• {q}</p>
                    ))}
                  </div>
                )}
              </MascotSpeech>
            )}
          </section>
        </div>

        {/* RIGHT: Bạn Viết Chat + Kho từ ngữ */}
        <aside className="lg:col-span-5 space-y-6">
          {/* Kho từ ngữ */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <BookOpen className="w-6 h-6 text-[#15803D] shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-xl font-bold text-[#1C2A24]">Kho từ ngữ</h2>
                <p className="text-[16px] text-[#4B6358]">
                  Chọn phần đang làm để nhận 6–8 từ hoặc cụm từ ngắn (không phải câu).
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <label htmlFor="word-topic-select" className="sr-only">
                Chọn khía cạnh cần tìm từ ngữ
              </label>
              <select
                id="word-topic-select"
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                className="flex-1 min-h-[48px] px-3.5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
              >
                {WORD_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loadingWords}
                onClick={() => onFetchWordBank(selectedTopic)}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {loadingWords ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <BookOpen className="w-5 h-5" aria-hidden="true" />
                )}
                <span>Kho từ ngữ</span>
              </button>
            </div>

            {project.suggestedWords.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <p className="text-[16px] text-[#4B6358]">
                  Bấm vào từ em thích để lưu vào kho riêng ({project.suggestedWordTopic}):
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {project.suggestedWords.map((word) => {
                    const saved = project.savedWords.includes(word);
                    return (
                      <button
                        key={word}
                        type="button"
                        onClick={() => onToggleSavedWord(word)}
                        aria-pressed={saved}
                        className={`min-h-[44px] px-4 py-2 rounded-xl font-medium transition-colors cursor-pointer ${
                          saved
                            ? 'bg-[#15803D] text-white'
                            : 'bg-[#F0F7F3] text-[#14532D] border border-[#BBF7D0] hover:bg-[#DCFCE7]'
                        }`}
                      >
                        {saved ? `✓ ${word}` : `+ ${word}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#EDF3EF] space-y-2">
              <p className="font-semibold text-[#1C2A24]">
                Kho từ riêng của em ({project.savedWords.length})
              </p>
              {project.savedWords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {project.savedWords.map((word) => (
                    <button
                      key={`saved-${word}`}
                      type="button"
                      onClick={() => onToggleSavedWord(word)}
                      aria-label={`Bỏ từ "${word}" khỏi kho riêng`}
                      className="min-h-[42px] px-3.5 py-1.5 rounded-xl bg-[#FEF9C3] text-[#713F12] border border-[#FDE047] font-medium hover:bg-[#FEF08A] transition-colors cursor-pointer"
                    >
                      {word} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[16px] text-[#64748B]">
                  Chưa lưu từ nào. Em bấm “Kho từ ngữ” rồi chạm vào các từ hay nhé!
                </p>
              )}
            </div>
          </section>

          {/* Chat with Bạn Viết */}
          <section className="rounded-2xl bg-white border border-[#DDE7E2] p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <MascotAvatar size="sm" />
              <div>
                <h2 className="text-xl font-bold text-[#1C2A24] flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-[#15803D]" aria-hidden="true" />
                  <span>Trò chuyện với Bạn Viết</span>
                </h2>
                <p className="text-[16px] text-[#4B6358]">
                  Bạn Viết chỉ hỏi gợi mở ngắn gọn, không viết thay em.
                </p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
              {project.chatMessages.length === 0 ? (
                <p className="text-[16px] text-[#4B6358] bg-[#F6FAF7] rounded-xl p-4 border border-[#E2ECE6]">
                  Em đang phân vân tả chi tiết nào về {personLabel.toLowerCase()}? Nhắn cho mình biết nhé!
                </p>
              ) : (
                project.chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-[#15803D] text-white ml-6'
                        : 'bg-[#F0F7F3] text-[#1C2A24] border border-[#CDE2D6] mr-4'
                    }`}
                  >
                    <p className="text-[15px] font-semibold mb-0.5 opacity-85">
                      {msg.role === 'user' ? 'Em' : 'Bạn Viết'}
                    </p>
                    <p className="leading-relaxed break-words">{msg.text}</p>
                  </div>
                ))
              )}
              {loadingChat && (
                <div className="rounded-2xl px-4 py-3 bg-[#F0F7F3] border border-[#CDE2D6] mr-4 flex items-center gap-2 text-[#14532D]">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span>Bạn Viết đang suy nghĩ câu hỏi…</span>
                </div>
              )}
            </div>

            <form onSubmit={handleChatSubmit} className="space-y-2">
              <label htmlFor="chat-ban-viet-input" className="sr-only">
                Nhắn tin cho Bạn Viết (tối đa 300 ký tự)
              </label>
              <div className="flex gap-2">
                <input
                  id="chat-ban-viet-input"
                  type="text"
                  maxLength={MAX_MESSAGE_CHARS}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Hỏi Bạn Viết về ý muốn tả…"
                  className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-[#CBD5E1] bg-white focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
                <button
                  type="submit"
                  disabled={loadingChat || !chatInput.trim()}
                  aria-label="Gửi tin nhắn cho Bạn Viết"
                  className="min-h-[48px] min-w-[52px] px-4 rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Send className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <p className="text-[15px] text-[#64748B] text-right tabular-nums">
                {chatInput.length}/{MAX_MESSAGE_CHARS} ký tự
              </p>
            </form>
          </section>
        </aside>
      </div>

      {/* Bottom navigation */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl bg-white border border-[#DDE7E2] p-5">
        <button
          type="button"
          onClick={onPrevStep}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại Bước 1</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {!canProceed && (
            <p className="text-[16px] text-[#92400E]">
              Cần đủ 3 phần, ít nhất 3 ý ngoại hình và 2 ý tính tình, hoạt động.
            </p>
          )}
          <button
            type="button"
            disabled={!canProceed}
            onClick={onNextStep}
            className="inline-flex items-center justify-center gap-2 min-h-[52px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Sang bước 3: Tự viết</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
