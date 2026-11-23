import React from 'react';
import { Check, Lock } from 'lucide-react';
import { StepNumber } from '../types';

export interface StepDefinition {
  step: StepNumber;
  label: string;
}

export const STEPS: StepDefinition[] = [
  { step: 1, label: 'Quan sát' },
  { step: 2, label: 'Lập ý' },
  { step: 3, label: 'Viết' },
  { step: 4, label: 'Tự sửa' },
  { step: 5, label: 'Chia sẻ' },
];

interface StepProgressBarProps {
  currentStep: StepNumber;
  maxUnlockedStep: StepNumber;
  onSelectStep: (step: StepNumber) => void;
}

export const StepProgressBar: React.FC<StepProgressBarProps> = ({
  currentStep,
  maxUnlockedStep,
  onSelectStep,
}) => {
  return (
    <nav
      aria-label="Tiến trình 5 bước viết bài"
      className="no-print w-full bg-white border-b border-[#DDE7E2]"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
        <ol className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 sm:grid sm:grid-cols-5 sm:gap-3">
          {STEPS.map(({ step, label }) => {
            const isCurrent = step === currentStep;
            const isCompleted = step < maxUnlockedStep && step !== currentStep;
            const isLocked = step > maxUnlockedStep;

            return (
              <li key={step} className="shrink-0 sm:shrink">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => onSelectStep(step)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Bước ${step}: ${label}${isLocked ? ' (chưa mở khóa)' : isCurrent ? ' (đang làm)' : ''}`}
                  className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-xl flex items-center justify-center gap-2 font-semibold transition-colors whitespace-nowrap ${
                    isCurrent
                      ? 'bg-[#15803D] text-white'
                      : isCompleted
                        ? 'bg-[#ECFDF5] text-[#14532D] border border-[#BBF7D0] hover:bg-[#DCFCE7] cursor-pointer'
                        : isLocked
                          ? 'bg-[#F1F5F9] text-[#64748B] cursor-not-allowed'
                          : 'bg-[#F8FAFC] text-[#1C2A24] border border-[#DDE7E2] hover:bg-[#ECFDF5] cursor-pointer'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold shrink-0 tabular-nums ${
                      isCurrent
                        ? 'bg-white/20 text-white'
                        : isCompleted
                          ? 'bg-[#15803D] text-white'
                          : isLocked
                            ? 'bg-[#CBD5E1] text-[#475569]'
                            : 'bg-[#DDE7E2] text-[#1C2A24]'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4" aria-hidden="true" />
                    ) : isLocked ? (
                      <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      step
                    )}
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
};
