import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  TeacherLtiStatusResponse,
  fetchTeacherLtiStatus,
  retryTeacherLtiOutbox,
} from '../utils/api';

interface TeacherLtiConnectionProps {
  onSessionExpired: () => void;
}

const SECRET_LABELS: Array<{
  key: keyof Omit<TeacherLtiStatusResponse['secrets'], 'allReady'>;
  label: string;
  hint: string;
}> = [
  {
    key: 'LTI_CLIENT_ID',
    label: 'LTI_CLIENT_ID',
    hint: 'Mã Client ID do OPEN-EDU cấp khi đăng ký ứng dụng.',
  },
  {
    key: 'LTI_DEPLOYMENT_ID',
    label: 'LTI_DEPLOYMENT_ID',
    hint: 'Mã Deployment ID bên OPEN-EDU (thường là 1).',
  },
  {
    key: 'OPENEDU_WEB_ORIGIN',
    label: 'OPENEDU_WEB_ORIGIN',
    hint: 'Tên miền web OPEN-EDU (dùng cho trang đăng nhập OIDC /lti/auth, CSP frame-ancestors và postMessage).',
  },
  {
    key: 'OPENEDU_TEACHER_ORIGIN',
    label: 'OPENEDU_TEACHER_ORIGIN',
    hint: 'Tên miền cổng giáo viên OPEN-EDU (cho phép nhúng iframe và postMessage cùng OPENEDU_WEB_ORIGIN).',
  },
  {
    key: 'TOOL_PRIVATE_JWK',
    label: 'TOOL_PRIVATE_JWK',
    hint: 'Khóa RSA JWK bí mật (JSON) dùng để ký JWT gửi điểm AGS và xAPI.',
  },
  {
    key: 'DATABASE_URL',
    label: 'DATABASE_URL',
    hint: 'Chuỗi kết nối PostgreSQL schema banviet (lưu nonce và outbox).',
  },
  {
    key: 'SESSION_SECRET',
    label: 'SESSION_SECRET',
    hint: 'Khóa ký phiên đăng nhập Bearer 8 giờ (tối thiểu 16 ký tự).',
  },
];

export const TeacherLtiConnection: React.FC<TeacherLtiConnectionProps> = ({
  onSessionExpired,
}) => {
  const [status, setStatus] = useState<TeacherLtiStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchTeacherLtiStatus();
      setStatus(data);
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        onSessionExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Không tải được trạng thái kết nối LTI.');
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCopy = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleRetryOutbox = async () => {
    setRetrying(true);
    setErrorMsg(null);
    setRetryNotice(null);
    try {
      const res = await retryTeacherLtiOutbox();
      if (res.processed === 0) {
        setRetryNotice('Không có mục nào đang chờ gửi trong hàng đợi.');
      } else if (res.failed === 0) {
        setRetryNotice(`Đã gửi thành công ${res.sent}/${res.processed} kết quả về OPEN-EDU.`);
      } else {
        setRetryNotice(
          `Đã xử lý ${res.processed} mục: thành công ${res.sent}, còn lỗi ${res.failed}.`
        );
      }
      await loadStatus();
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        onSessionExpired();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi lại hàng đợi lúc này.');
    } finally {
      setRetrying(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
        <Loader2 className="w-8 h-8 animate-spin text-[#0369A1]" aria-hidden="true" />
        <p>Đang kiểm tra trạng thái kết nối OPEN-EDU…</p>
      </div>
    );
  }

  const copyFields = status
    ? [
        { key: 'loginUrl', label: 'Login URL (OIDC)', value: status.endpoints.loginUrl },
        { key: 'launchUrl', label: 'Launch URL (Redirect URI)', value: status.endpoints.launchUrl },
        {
          key: 'jwksUrl',
          label: 'JWKS URL của ứng dụng',
          value: status.endpoints.jwksUrl,
          note: `Hỗ trợ thêm đường dẫn tương đương: ${status.endpoints.jwksAliasUrl}`,
        },
        {
          key: 'clientId',
          label: 'Client ID (LTI_CLIENT_ID)',
          value: status.endpoints.clientId || '(Chưa cấu hình trong Secrets)',
          copyable: Boolean(status.endpoints.clientId),
        },
        {
          key: 'deploymentId',
          label: 'Deployment ID (LTI_DEPLOYMENT_ID)',
          value: status.endpoints.deploymentId || '(Chưa cấu hình trong Secrets)',
          copyable: Boolean(status.endpoints.deploymentId),
        },
      ]
    : [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-[#1C2A24]">Kết nối LTI 1.3 với OPEN-EDU</h2>
            {status && (
              <span
                className={`inline-flex items-center px-3 py-1 rounded-lg text-[15px] font-bold border ${
                  status.appEnv === 'production'
                    ? 'bg-[#ECFDF5] border-[#86EFAC] text-[#14532D]'
                    : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                }`}
              >
                Chế độ: {status.appEnv === 'production' ? 'production' : 'thử nghiệm'}
              </span>
            )}
          </div>
          <p className="text-[16px] text-[#4B6358]">
            Khai báo các đường dẫn bên dưới trong mục Quản trị → Ứng dụng kết nối trên OPEN-EDU.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Làm mới</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] p-4 text-[#991B1B] font-medium"
        >
          {errorMsg}
        </div>
      )}

      {retryNotice && (
        <div
          role="status"
          className="rounded-xl bg-[#ECFDF5] border border-[#86EFAC] p-4 text-[#14532D] font-medium flex items-center gap-2"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>{retryNotice}</span>
        </div>
      )}

      {status && (
        <>
          {/* 1. Endpoints & Identifiers to register in OPEN-EDU */}
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Link2 className="w-6 h-6 text-[#0369A1]" aria-hidden="true" />
              <h3 className="text-xl font-bold text-[#1C2A24]">
                Thông số khai báo bên OPEN-EDU
              </h3>
            </div>

            <div className="space-y-3">
              {copyFields.map((field) => {
                const canCopy = field.copyable !== false && Boolean(field.value);
                return (
                  <div
                    key={field.key}
                    className="rounded-xl border border-[#DDE7E2] bg-[#FAFBF9] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[15px] font-bold text-[#1C2A24]">{field.label}</div>
                      <div className="text-[15px] font-mono text-[#14532D] break-all">
                        {field.value}
                      </div>
                      {field.note && (
                        <div className="text-[14px] text-[#64748B] break-all">{field.note}</div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!canCopy}
                      onClick={() => void handleCopy(field.key, field.value)}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] text-[15px] font-semibold hover:bg-[#ECFDF5] hover:border-[#86EFAC] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {copiedKey === field.key ? (
                        <>
                          <Check className="w-4 h-4 text-[#15803D]" aria-hidden="true" />
                          <span className="text-[#15803D]">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-[#0369A1]" aria-hidden="true" />
                          <span>Chép</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 space-y-1.5 text-[15px] text-[#4B6358]">
              <div>
                Platform Issuer:{' '}
                <span className="font-mono text-[#1C2A24] break-all">{status.endpoints.issuer}</span>
              </div>
              <div>
                OPENEDU_WEB_ORIGIN (học sinh & OIDC):{' '}
                <span className="font-mono text-[#1C2A24] break-all">
                  {status.endpoints.openEduWebOrigin || '(Chưa cấu hình)'}
                </span>
              </div>
              <div>
                OPENEDU_TEACHER_ORIGIN (giáo viên):{' '}
                <span className="font-mono text-[#1C2A24] break-all">
                  {status.endpoints.openEduTeacherOrigin || '(Chưa cấu hình)'}
                </span>
              </div>
              <div>
                Chế độ môi trường (APP_ENV):{' '}
                <strong className="text-[#1C2A24]">
                  {status.appEnv === 'production' ? 'production' : 'thử nghiệm'}
                </strong>
                {' — '}
                {status.frameAncestorsHeader ? (
                  <span className="font-mono text-[#14532D] break-all">
                    {status.frameAncestorsHeader}
                  </span>
                ) : (
                  <span>không gửi frame-ancestors để hỗ trợ khung xem trước</span>
                )}
              </div>
            </div>
          </div>

          {/* 2. Secrets Readiness (Booleans ONLY - never displays values) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-[#15803D]" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-[#1C2A24]">Trạng thái Secrets</h3>
                </div>
                <span
                  className={`text-[15px] font-bold ${
                    status.secrets.allReady ? 'text-[#15803D]' : 'text-[#B45309]'
                  }`}
                >
                  {status.secrets.allReady ? 'Đã đủ biến bắt buộc' : 'Còn thiếu cấu hình'}
                </span>
              </div>

              <div className="divide-y divide-[#EEF2F0]">
                {SECRET_LABELS.map((item) => {
                  const ok = status.secrets[item.key];
                  return (
                    <div
                      key={item.key}
                      className="py-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[15px] font-bold text-[#1C2A24]">
                          {item.label}
                        </div>
                        <div className="text-[14px] text-[#4B6358]">{item.hint}</div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[15px] font-bold shrink-0 ${
                          ok ? 'text-[#15803D]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {ok ? (
                          <>
                            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                            <span>Đủ</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-5 h-5" aria-hidden="true" />
                            <span>Thiếu</span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Outbox Queue Status & Manual Retry */}
            <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-5 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <Send className="w-6 h-6 text-[#0369A1]" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-[#1C2A24]">
                    Hàng đợi gửi điểm & xAPI (Outbox)
                  </h3>
                </div>

                <p className="text-[15px] text-[#4B6358]">
                  Mọi điểm AGS và sự kiện xAPI đều được ghi vào bảng outbox trước khi gửi. Nếu gặp lỗi mạng, máy chủ tự gửi lại sau 1 phút, 5 phút, 30 phút và 2 giờ (tối đa 10 lần).
                </p>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] p-3.5 text-center">
                    <div className="text-2xl font-bold text-[#0369A1] tabular-nums">
                      {status.outbox.pendingCount}
                    </div>
                    <div className="text-[14px] text-[#0C4A6E]">Đang chờ</div>
                  </div>
                  <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] p-3.5 text-center">
                    <div className="text-2xl font-bold text-[#B91C1C] tabular-nums">
                      {status.outbox.failedCount}
                    </div>
                    <div className="text-[14px] text-[#991B1B]">Quá 10 lần</div>
                  </div>
                  <div className="rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] p-3.5 text-center">
                    <div className="text-2xl font-bold text-[#15803D] tabular-nums">
                      {status.outbox.sentCount}
                    </div>
                    <div className="text-[14px] text-[#14532D]">Đã gửi</div>
                  </div>
                </div>

                {status.outbox.lastError ? (
                  <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-4 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-[#92400E] text-[15px]">
                      <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
                      <span>
                        Lỗi gần nhất
                        {status.outbox.lastErrorKind ? ` (${status.outbox.lastErrorKind})` : ''}:
                      </span>
                    </div>
                    <p className="text-[14px] text-[#78350F] break-words font-mono">
                      {status.outbox.lastError}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-4 text-[15px] text-[#4B6358]">
                    Không có lỗi gửi gần đây.
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={retrying}
                onClick={() => void handleRetryOutbox()}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#0369A1] text-white font-bold hover:bg-[#075985] disabled:bg-[#94A3B8] transition-colors cursor-pointer"
              >
                {retrying ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="w-5 h-5" aria-hidden="true" />
                )}
                <span>{retrying ? 'Đang gửi lại…' : 'Gửi lại ngay'}</span>
              </button>
            </div>
          </div>

          {/* 4. App AI Quota & Automatic Word Bank Fallback */}
          {status.aiQuota && (
            <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-6 h-6 text-[#15803D]" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-[#1C2A24]">
                    Lượt AI của ứng dụng & Tự chuyển sang kho từ
                  </h3>
                </div>
                <span className="text-[15px] font-semibold text-[#4B6358]">
                  Nhà cung cấp:{' '}
                  <strong className="text-[#1C2A24]">
                    {status.aiQuota.provider === 'openrouter'
                      ? 'OpenRouter'
                      : status.aiQuota.provider === 'gemini'
                        ? 'Google Gemini'
                        : 'Chưa cấu hình khóa AI'}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] p-4">
                  <div className="text-[14px] font-semibold text-[#14532D]">
                    Lượt AI của ứng dụng còn lại hôm nay
                  </div>
                  <div className="text-2xl font-bold text-[#15803D] mt-1 tabular-nums">
                    {status.aiQuota.remainingToday !== null
                      ? status.aiQuota.dailyLimit !== null
                        ? `${status.aiQuota.remainingToday} / ${status.aiQuota.dailyLimit} lượt`
                        : `${status.aiQuota.remainingToday} lượt`
                      : status.aiQuota.provider === 'gemini'
                        ? 'Sẵn sàng (Gemini)'
                        : status.aiQuota.provider === 'openrouter'
                          ? 'Chưa đo được'
                          : '0 lượt (chưa có khóa)'}
                  </div>
                  <p className="text-[14px] text-[#3F624F] mt-1">
                    {status.aiQuota.provider === 'openrouter'
                      ? 'Đọc từ OpenRouter /api/v1/key, lưu bộ nhớ đệm 5 phút.'
                      : status.aiQuota.provider === 'gemini'
                        ? 'Khi AI quá tải hoặc lỗi, hệ thống vẫn tự chuyển sang kho từ.'
                        : 'Học sinh tự động dùng kho từ ngữ có sẵn không cần AI.'}
                  </p>
                </div>

                <div className="rounded-xl bg-[#F0F9FF] border border-[#BAE6FD] p-4">
                  <div className="text-[14px] font-semibold text-[#0C4A6E]">
                    Dự phòng cho Bước 4 (“Đọc giúp”)
                  </div>
                  <div className="text-2xl font-bold text-[#0369A1] mt-1 tabular-nums">
                    {status.aiQuota.reserveForStep4} lượt
                  </div>
                  <p className="text-[14px] text-[#0C4A6E] mt-1">
                    Khi còn ≤ {status.aiQuota.reserveForStep4} lượt, Bước 1–2 tự dùng kho từ để dành AI cho góp ý bài.
                  </p>
                </div>

                <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-4">
                  <div className="text-[14px] font-semibold text-[#92400E]">
                    Số lần tự chuyển sang kho từ
                  </div>
                  <div className="text-2xl font-bold text-[#B45309] mt-1 tabular-nums">
                    {status.aiQuota.autoFallbackCount} lần
                  </div>
                  <p className="text-[14px] text-[#78350F] mt-1">
                    Bao gồm các lần hết lượt ngày, lớp tắt AI, hết hạn mức khóa AI hoặc lỗi mạng.
                  </p>
                </div>
              </div>

              {status.aiQuota.error && (
                <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-3.5 text-[14px] text-[#92400E]">
                  Lưu ý kiểm tra hạn mức OpenRouter: {status.aiQuota.error}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};
