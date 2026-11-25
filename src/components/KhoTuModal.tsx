import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  HelpCircle,
  Loader2,
  Search,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  KhoTuDatabase,
  collectAllSoSanhItems,
  mapPersonToTopicId,
} from '../utils/khoTuNgu';

let cachedKhoTuDb: KhoTuDatabase | null = null;
let inflightLoad: Promise<KhoTuDatabase> | null = null;

async function loadKhoTuDatabase(): Promise<KhoTuDatabase> {
  if (cachedKhoTuDb) return cachedKhoTuDb;
  if (!inflightLoad) {
    inflightLoad = fetch('/kho-tu-ngu-ta-nguoi.json')
      .then((res) => {
        if (!res.ok) throw new Error('Không tải được kho từ ngữ.');
        return res.json() as Promise<KhoTuDatabase>;
      })
      .then((data) => {
        cachedKhoTuDb = data;
        return data;
      })
      .finally(() => {
        inflightLoad = null;
      });
  }
  return inflightLoad;
}

export interface KhoTuModalTarget {
  groupId?: string;
  topicId?: string;
  soSanhOnly?: boolean;
  title?: string;
}

interface KhoTuModalProps {
  isOpen: boolean;
  target: KhoTuModalTarget | null;
  personLabel: string;
  savedWords: string[];
  onToggleSavedWord: (word: string, fromKho: boolean) => void;
  onClose: () => void;
}

export const KhoTuModal: React.FC<KhoTuModalProps> = ({
  isOpen,
  target,
  personLabel,
  savedWords,
  onToggleSavedWord,
  onClose,
}) => {
  const [db, setDb] = useState<KhoTuDatabase | null>(cachedKhoTuDb);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string>('ngoai-hinh');
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [soSanhMode, setSoSanhMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const personTopicId = useMemo(() => mapPersonToTopicId(personLabel), [personLabel]);

  useEffect(() => {
    if (!isOpen) return;
    if (!db) {
      setLoading(true);
      setErrorMsg(null);
      loadKhoTuDatabase()
        .then((loaded) => {
          setDb(loaded);
          setLoading(false);
        })
        .catch((err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Không tải được kho từ ngữ.');
          setLoading(false);
        });
    }
  }, [isOpen, db]);

  useEffect(() => {
    if (!isOpen || !db) return;
    setSearchQuery('');
    const nextSoSanh = Boolean(target?.soSanhOnly);
    setSoSanhMode(nextSoSanh);

    const requestedGroup =
      db.groups.find((g) => g.id === target?.groupId) ?? db.groups[0];
    if (requestedGroup) {
      setSelectedGroupId(requestedGroup.id);
      const requestedTopic =
        requestedGroup.topics.find((t) => t.id === target?.topicId) ??
        requestedGroup.topics[0];
      setSelectedTopicId(requestedTopic?.id ?? '');
    }
  }, [isOpen, target, db]);

  const activeGroup = useMemo(
    () => db?.groups.find((g) => g.id === selectedGroupId) ?? db?.groups[0] ?? null,
    [db, selectedGroupId]
  );

  const activeTopic = useMemo(() => {
    if (!activeGroup) return null;
    return activeGroup.topics.find((t) => t.id === selectedTopicId) ?? activeGroup.topics[0] ?? null;
  }, [activeGroup, selectedTopicId]);

  const soSanhSections = useMemo(() => {
    if (!db || !soSanhMode) return [];
    return collectAllSoSanhItems(db, personLabel);
  }, [db, soSanhMode, personLabel]);

  const normQuery = searchQuery.trim().toLowerCase();
  const filterItems = (items?: string[]): string[] => {
    if (!items || items.length === 0) return [];
    if (!normQuery) return items;
    return items.filter((item) => item.toLowerCase().includes(normQuery));
  };

  if (!isOpen) return null;

  const renderWordChips = (items: string[], variant: 'word' | 'phrase' | 'so_sanh') => {
    if (items.length === 0) return null;
    const baseStyle =
      variant === 'so_sanh'
        ? 'bg-[#FFFBEB] text-[#78350F] border-[#FDE68A] hover:bg-[#FEF3C7]'
        : variant === 'phrase'
          ? 'bg-[#F0F9FF] text-[#0C4A6E] border-[#BAE6FD] hover:bg-[#E0F2FE]'
          : 'bg-[#F0F7F3] text-[#14532D] border-[#BBF7D0] hover:bg-[#DCFCE7]';

    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSaved = savedWords.includes(item);
          return (
            <button
              key={`${variant}-${item}`}
              type="button"
              onClick={() => onToggleSavedWord(item, true)}
              aria-pressed={isSaved}
              className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-[16px] font-medium text-left transition-colors cursor-pointer ${
                isSaved ? 'bg-[#15803D] text-white border-[#15803D]' : baseStyle
              }`}
            >
              {isSaved ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item}</span>
                </span>
              ) : (
                <span>+ {item}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kho-tu-modal-title"
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-[#DDE7E2] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#DDE7E2] bg-[#F6FAF7] flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="w-6 h-6 text-[#15803D] shrink-0" aria-hidden="true" />
              <h2 id="kho-tu-modal-title" className="text-xl sm:text-2xl font-bold text-[#1C2A24]">
                {target?.title || 'Kho từ ngữ tả người lớp 5'}
              </h2>
              <span className="text-[14px] font-semibold text-[#15803D] bg-[#DCFCE7] px-2.5 py-0.5 rounded-lg">
                Luôn mở · Không tốn lượt AI
              </span>
            </div>
            <p className="text-[15px] text-[#4B6358]">
              {db?.nguyen_tac ||
                'Từ ngữ để em chọn và tự đặt câu. Không chép nguyên cụm, hãy sửa cho đúng với người em tả.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng kho từ ngữ"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#475569] hover:bg-white border border-transparent hover:border-[#CBD5E1] cursor-pointer shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
            <Loader2 className="w-8 h-8 animate-spin text-[#15803D]" aria-hidden="true" />
            <p>Đang mở kho từ ngữ cho em…</p>
          </div>
        ) : errorMsg || !db ? (
          <div className="p-6 text-[#991B1B] bg-[#FEF2F2]">
            {errorMsg || 'Không tải được dữ liệu kho từ ngữ.'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
            {/* Top controls: Group Tabs + Quick Person Shortcut + Search */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {db.groups.map((grp) => {
                  const active = !soSanhMode && activeGroup?.id === grp.id;
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => {
                        setSoSanhMode(false);
                        setSelectedGroupId(grp.id);
                        setSelectedTopicId(grp.topics[0]?.id ?? '');
                      }}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-[15px] font-bold transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#15803D] text-white'
                          : 'bg-[#F6FAF7] text-[#1C2A24] border border-[#DDE7E2] hover:bg-[#ECFDF5]'
                      }`}
                    >
                      {grp.name}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setSoSanhMode(true)}
                  className={`inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-xl text-[15px] font-bold transition-colors cursor-pointer ${
                    soSanhMode
                      ? 'bg-[#B45309] text-white'
                      : 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] hover:bg-[#FEF3C7]'
                  }`}
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  <span>Tổng hợp so sánh</span>
                </button>

                {personLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setSoSanhMode(false);
                      setSelectedGroupId('theo-nguoi');
                      setSelectedTopicId(personTopicId);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 rounded-xl text-[15px] font-bold bg-[#E0F2FE] text-[#075985] border border-[#BAE6FD] hover:bg-[#BAE6FD] transition-colors cursor-pointer"
                  >
                    <UserRound className="w-4 h-4" aria-hidden="true" />
                    <span>Từ riêng tả {personLabel.toLowerCase()}</span>
                  </button>
                )}
              </div>

              {/* Search within current view */}
              <div className="relative">
                <Search
                  className="w-5 h-5 text-[#64748B] absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <label htmlFor="kho-tu-search" className="sr-only">
                  Tìm nhanh trong kho từ ngữ
                </label>
                <input
                  id="kho-tu-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm nhanh từ ngữ trong mục đang xem (ví dụ: hiền, tóc, cười…)"
                  className="w-full min-h-[44px] pl-11 pr-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[16px] text-[#1C2A24] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
              </div>
            </div>

            {soSanhMode ? (
              /* All Similes View */
              <div className="space-y-4">
                <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-4 text-[16px] text-[#78350F]">
                  Chạm vào hình ảnh so sánh em thích để lưu vào kho riêng, rồi viết lại theo đúng nét riêng của{' '}
                  <strong>{personLabel ? personLabel.toLowerCase() : 'người em tả'}</strong> nhé!
                </div>
                {soSanhSections.map((sec) => {
                  const filtered = filterItems(sec.items);
                  if (filtered.length === 0) return null;
                  return (
                    <div
                      key={sec.topicName}
                      className="rounded-xl border border-[#DDE7E2] bg-white p-4 space-y-2.5"
                    >
                      <h3 className="font-bold text-[#1C2A24] text-[17px]">{sec.topicName}</h3>
                      {renderWordChips(filtered, 'so_sanh')}
                    </div>
                  );
                })}
              </div>
            ) : activeGroup && activeTopic ? (
              <div className="space-y-5">
                {/* Topic selector within group */}
                <div className="flex flex-wrap gap-2 pb-2 border-b border-[#EDF3EF]">
                  {activeGroup.topics.map((t) => {
                    const isSelected = t.id === activeTopic.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTopicId(t.id)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-[15px] font-semibold transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#0369A1] text-white'
                            : 'bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0]'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>

                {activeTopic.ghi_chu && (
                  <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-[15px] text-[#78350F]">
                    <strong>Mẹo nhỏ:</strong> {activeTopic.ghi_chu}
                  </div>
                )}

                {filterItems(activeTopic.words).length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="font-bold text-[#14532D] text-[17px]">
                      Từ ngữ gợi tả ({filterItems(activeTopic.words).length}) — chạm để lưu vào kho riêng
                    </h3>
                    {renderWordChips(filterItems(activeTopic.words), 'word')}
                  </div>
                )}

                {filterItems(activeTopic.phrases).length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="font-bold text-[#075985] text-[17px]">
                      Cụm từ & cách diễn đạt ({filterItems(activeTopic.phrases).length})
                    </h3>
                    {renderWordChips(filterItems(activeTopic.phrases), 'phrase')}
                  </div>
                )}

                {filterItems(activeTopic.so_sanh).length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="font-bold text-[#92400E] text-[17px]">
                      Hình ảnh so sánh ({filterItems(activeTopic.so_sanh).length})
                    </h3>
                    {renderWordChips(filterItems(activeTopic.so_sanh), 'so_sanh')}
                  </div>
                )}

                {filterItems(activeTopic.cau_hoi).length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="font-bold text-[#1C2A24] text-[17px] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-[#0369A1]" aria-hidden="true" />
                      <span>Câu hỏi gợi nhớ</span>
                    </h3>
                    <ul className="space-y-2">
                      {filterItems(activeTopic.cau_hoi).map((q, idx) => (
                        <li
                          key={`q-${idx}`}
                          className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] px-4 py-3 text-[16px] text-[#1C2A24]"
                        >
                          • {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Footer showing saved words count */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-[#DDE7E2] bg-[#FAFBF9] flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-[#4B6358] tabular-nums">
            Kho từ riêng của em hiện có <strong className="text-[#15803D]">{savedWords.length}</strong> từ đã lưu.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] transition-colors cursor-pointer"
          >
            Quay lại bài viết
          </button>
        </div>
      </div>
    </div>
  );
};
