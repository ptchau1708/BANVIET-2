import React, { useEffect, useState } from 'react';
import { ArrowLeft, GraduationCap, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { fetchGoogleAuthUrl } from '../utils/api';
import { saveSession } from '../utils/session';

interface TeacherLoginProps {
  onLoggedIn: () => void;
  onGoStudent: () => void;
  databaseConfigured: boolean;
  googleConfigured: boolean;
  ltiEnabled: boolean;
}

export const TeacherLogin: React.FC<TeacherLoginProps> = ({
  onLoggedIn,
  onGoStudent,
  databaseConfigured,
  googleConfigured,
  ltiEnabled,
}) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fallbackAuthUrl, setFallbackAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; token?: string; error?: string }
        | null
        | undefined;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'BANVIET_GOOGLE_AUTH_SUCCESS' && typeof data.token === 'string') {
        saveSession(data.token, 'teacher');
        setLoading(false);
        setErrorMsg(null);
        onLoggedIn();
      } else if (data.type === 'BANVIET_GOOGLE_AUTH_ERROR') {
        setLoading(false);
        setErrorMsg(data.error || 'Không thể đăng nhập bằng Google. Vui lòng thử lại.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onLoggedIn]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setFallbackAuthUrl(null);
    setLoading(true);
    try {
      const { url } = await fetchGoogleAuthUrl();
      const width = 520;
      const height = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

      const popup = window.open(
        url,
        'banviet_google_oauth',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );

      if (!popup) {
        setFallbackAuthUrl(url);
        setLoading(false);
        setErrorMsg(
          'Trình duyệt đang chặn cửa sổ bật lên (popup). Thầy/cô hãy cho phép popup hoặc bấm vào liên kết mở đăng nhập Google bên dưới.'
        );
        return;
      }

      // Detect if user manually closes the popup before finishing
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          setLoading(false);
        }
      }, 600);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err instanceof Error ? err.message : 'Không khởi tạo được đăng nhập Google.');
    }
  };

  return (
    <div className="max-w-xl mx-auto py-4 sm:py-8 space-y-6">
      <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#E0F2FE] text-[#0369A1] flex items-center justify-center shrink-0">
            <GraduationCap className="w-8 h-8" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-[#1C2A24]">Trang Giáo viên · Bạn Viết</h1>
            <p className="text-[#4B6358]">
              Quản lý lớp học, in phiếu đăng nhập học sinh, giao bài văn tả người, theo dõi tiến độ 5 bước và chấm rubric.
            </p>
          </div>
        </div>

        {!databaseConfigured && (
          <div
            role="alert"
            className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3.5 text-[#78350F] text-[16px]"
          >
            Máy chủ chưa cấu hình <strong>DATABASE_URL</strong> trong Secrets. Vui lòng thiết lập biến môi trường này để lưu dữ liệu lớp học.
          </div>
        )}

        {!googleConfigured ? (
          <div
            role="status"
            className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-4 text-[#78350F] text-[16px] space-y-2"
          >
            <p className="font-bold">Đăng nhập bằng Google hiện đang tạm ẩn</p>
            <p>
              Máy chủ chưa cấu hình <strong>GOOGLE_CLIENT_ID</strong> hoặc{' '}
              <strong>GOOGLE_CLIENT_SECRET</strong> trong Secrets nên nút đăng nhập Google chưa hiển thị.
            </p>
            <p className="text-[15px]">
              {ltiEnabled
                ? 'Thầy/cô vẫn có thể mở trang Giáo viên trực tiếp từ hệ thống OPEN-EDU. Học sinh vẫn đăng nhập bình thường bằng mã lớp và mã PIN.'
                : 'Học sinh vẫn đăng nhập bình thường bằng mã lớp và mã PIN. Để bật đăng nhập Google cho giáo viên, hãy bổ sung 2 biến trên trong Secrets rồi tải lại trang.'}
            </p>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5 text-[#991B1B] font-medium text-[16px]"
              >
                {errorMsg}
              </div>
            )}

            {fallbackAuthUrl && (
              <a
                href={fallbackAuthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl border border-[#0369A1] text-[#075985] font-bold hover:bg-[#E0F2FE] transition-colors"
              >
                <span>Mở trang đăng nhập Google ở thẻ mới</span>
              </a>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-3 min-h-[54px] px-6 py-3 rounded-xl bg-[#0369A1] text-white font-bold hover:bg-[#075985] disabled:bg-[#94A3B8] disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="w-5 h-5" aria-hidden="true" />
              )}
              <span>{loading ? 'Đang chờ xác thực Google…' : 'Đăng nhập bằng tài khoản Google'}</span>
            </button>
          </>
        )}

        <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 flex items-start gap-3 text-[16px] text-[#4B6358]">
          <ShieldCheck className="w-5 h-5 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Mỗi giáo viên chỉ xem và quản lý được các lớp do chính mình tạo. Phiên đăng nhập tự động bảo mật và hết hạn sau 8 giờ.
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onGoStudent}
          className="inline-flex items-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          <span>Quay lại trang đăng nhập Học sinh</span>
        </button>
      </div>
    </div>
  );
};
