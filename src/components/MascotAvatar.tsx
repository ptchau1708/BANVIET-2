import React, { useState } from 'react';

const MASCOT_SRC = '/src/assets/images/mascot_ban_viet_1795422899652.jpg';

interface MascotAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const MascotAvatar: React.FC<MascotAvatarProps> = ({ size = 'md', className = '' }) => {
  const [imgFailed, setImgFailed] = useState(false);

  const dims =
    size === 'sm'
      ? 'w-11 h-11'
      : size === 'lg'
        ? 'w-20 h-20'
        : 'w-14 h-14';

  return (
    <div
      className={`${dims} shrink-0 overflow-hidden rounded-2xl border border-[#D8E5DD] bg-white flex items-center justify-center ${className}`}
    >
      {!imgFailed ? (
        <img
          src={MASCOT_SRC}
          alt="Linh vật Bạn Viết — chú sóc nhỏ cầm bút chì"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <svg viewBox="0 0 64 64" className="w-full h-full p-1" aria-label="Linh vật Bạn Viết">
          <circle cx="32" cy="34" r="22" fill="#D47E44" />
          <circle cx="22" cy="18" r="6" fill="#C4713D" />
          <circle cx="42" cy="18" r="6" fill="#C4713D" />
          <ellipse cx="32" cy="38" rx="15" ry="11" fill="#FCE6D2" />
          <circle cx="25" cy="31" r="2.6" fill="#2C1A11" />
          <circle cx="39" cy="31" r="2.6" fill="#2C1A11" />
          <path
            d="M27 39 Q32 43 37 39"
            stroke="#4A2B18"
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
    </div>
  );
};

interface MascotSpeechProps {
  title?: string;
  children: React.ReactNode;
  tone?: 'calm' | 'warm' | 'success';
  size?: 'sm' | 'md';
}

export const MascotSpeech: React.FC<MascotSpeechProps> = ({
  title = 'Bạn Viết gợi ý',
  children,
  tone = 'calm',
  size = 'md',
}) => {
  const surfaceClass =
    tone === 'warm'
      ? 'bg-[#FFFBEB] border-[#FDE68A]'
      : tone === 'success'
        ? 'bg-[#ECFDF5] border-[#A7F3D0]'
        : 'bg-[#F0F7F3] border-[#CDE2D6]';

  return (
    <div
      className={`flex flex-col sm:flex-row items-start gap-3 sm:gap-4 rounded-2xl border p-4 sm:p-5 ${surfaceClass}`}
    >
      <div className="flex items-center gap-3 sm:block shrink-0">
        <MascotAvatar size={size} />
        <p className="font-semibold text-[#14532D] sm:hidden">{title}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="hidden sm:block font-semibold text-[#14532D] mb-1">{title}</p>
        <div className="text-[#1C2A24] leading-relaxed">{children}</div>
      </div>
    </div>
  );
};
