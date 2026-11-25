import React from 'react';
import { Clock, X } from 'lucide-react';
import { FeedbackHistoryItem } from '../types';
import { MascotAvatar } from './MascotAvatar';

interface FeedbackHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: FeedbackHistoryItem[];
}

const STEP_LABELS: Record<1 | 2 | 4, string> = {
  1: 'Bước 1 · Quan sát',
  2: 'Bước 2 · Lập ý',
  4: 'Bước 4 · Tự sửa',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const FeedbackHistoryDrawer: React.FC<FeedbackHistoryDrawerProps> = ({
  isOpen,
  onClose,
  history,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-drawer-title"
    >
      <div className="w-full max-w-xl bg-white h-full flex flex-col shadow-xl border-l border-[#DDE7E2]">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[#DDE7E2]">
          <div className="flex items-center gap-3 min-w-0">
            <MascotAvatar size="sm" />
            <div className="min-w-0">
              <h2 id="history-drawer-title" className="text-xl font-bold text-[#1C2A24] truncate">
                Lịch sử góp ý của Bạn Viết
              </h2>
              <p className="text-[16px] text-[#4B6358]">
                {history.length} lượt đồng hành trong bài viết này
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng lịch sử góp ý"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#475569] hover:bg-[#F1F5F9] cursor-pointer shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-[#DDE7E2] bg-[#F6FAF7] p-6 text-center space-y-2">
              <p className="font-semibold text-[#1C2A24]">Chưa có lượt gợi ý nào</p>
              <p className="text-[#4B6358]">
                Mỗi khi em bấm “Gợi ý cho em”, “Kho từ ngữ”, “Kiểm tra dàn ý” hay “Nhờ Bạn Viết đọc giúp”, toàn bộ câu hỏi và góp ý sẽ được lưu lại ở đây để em xem lại tiến trình.
              </p>
            </div>
          ) : (
            [...history].reverse().map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-[#DDE7E2] bg-[#F8FBF9] p-5 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[16px] text-[#4B6358]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[#15803D]">{STEP_LABELS[item.step]}</span>
                    {item.nguon && (
                      <span
                        className={`text-[13px] font-bold px-2 py-0.5 rounded-md ${
                          item.nguon === 'kho'
                            ? 'bg-[#FEF3C7] text-[#92400E]'
                            : 'bg-[#E0F2FE] text-[#075985]'
                        }`}
                      >
                        {item.nguon === 'kho' ? 'Kho từ' : 'AI'}
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Clock className="w-4 h-4" aria-hidden="true" />
                    {formatTime(item.timestamp)}
                  </span>
                </div>
                <h3 className="font-bold text-[#1C2A24]">{item.title}</h3>
                {item.promptSummary && (
                  <p className="text-[16px] text-[#475569]">
                    Em hỏi / chọn: {item.promptSummary}
                  </p>
                )}
                <p className="text-[#1C2A24] leading-relaxed">{item.responseSummary}</p>
                {item.details && item.details.length > 0 && (
                  <ul className="list-disc list-inside space-y-1 text-[17px] text-[#334155] pt-1">
                    {item.details.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#DDE7E2] bg-white">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] transition-colors cursor-pointer"
          >
            Quay lại bài làm
          </button>
        </div>
      </div>
    </div>
  );
};
