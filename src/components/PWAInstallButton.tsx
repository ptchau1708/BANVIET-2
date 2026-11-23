import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] bg-white hover:bg-[#ECFDF5] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span>Cài app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] text-[#1C2A24] bg-white hover:bg-[#F1F5F9] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>Cài lên máy</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 border border-[#DDE7E2] shadow-lg">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 id="ios-install-title" className="text-xl font-bold text-[#1C2A24]">
                  Cài Bạn Viết lên màn hình chính
                </h2>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng hướng dẫn cài ứng dụng"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#475569] hover:bg-[#F1F5F9] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="space-y-3 text-[#334155] list-decimal list-inside">
                <li>
                  Chạm nút <strong>Chia sẻ</strong> (hình vuông có mũi tên đi lên) ở thanh dưới Safari.
                </li>
                <li>
                  Cuộn xuống và chọn <strong>Thêm vào Màn hình chính</strong>.
                </li>
                <li>
                  Bấm <strong>Thêm</strong> để mở Bạn Viết như một ứng dụng.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[48px] rounded-xl bg-[#15803D] text-white font-semibold hover:bg-[#166534] transition-colors cursor-pointer"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="no-print fixed bottom-4 left-4 right-4 sm:right-auto z-40 flex items-center gap-3 rounded-2xl bg-[#92400E] text-white px-4 py-3 shadow-lg"
    >
      <WifiOff className="w-5 h-5 shrink-0" aria-hidden="true" />
      <span>Đang mất mạng — Bài làm vẫn được tự lưu trên máy.</span>
    </div>
  );
};
