import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, History } from 'lucide-react';
import {
  FeedbackHistoryItem,
  ObservationBoxKey,
  OutlineData,
  PersonChoice,
  SelfCheckAnswer,
  SelfCheckState,
  SelfRatingState,
  StepNumber,
  WritingProject,
} from './types';
import {
  MAX_ESSAY_REVIEWS,
  canNavigateToStep,
  createEmptyProject,
  getDisplayPersonName,
  getMaxUnlockedStep,
  syncObservationsToOutline,
} from './utils/writingLogic';
import { createSampleGrandmaProject } from './data/sampleData';
import { fetchGoiY, fetchGopYBai, fetchKiemTraDanY } from './utils/api';
import { MascotAvatar } from './components/MascotAvatar';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { StepProgressBar } from './components/StepProgressBar';
import { Step1Observe } from './components/Step1Observe';
import { Step2Outline } from './components/Step2Outline';
import { Step3Write } from './components/Step3Write';
import { Step4Revise } from './components/Step4Revise';
import { Step5Share } from './components/Step5Share';
import { FeedbackHistoryDrawer } from './components/FeedbackHistoryDrawer';

const STORAGE_KEY = 'ban_viet_project_v1';

function loadInitialProject(): WritingProject {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyProject();
    const parsed = JSON.parse(raw) as Partial<WritingProject>;
    const base = createEmptyProject();
    return {
      ...base,
      ...parsed,
      observations: { ...base.observations, ...(parsed.observations ?? {}) },
      outline: { ...base.outline, ...(parsed.outline ?? {}) },
      selfCheck: { ...base.selfCheck, ...(parsed.selfCheck ?? {}) },
      selfRating: { ...base.selfRating, ...(parsed.selfRating ?? {}) },
      chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
      suggestedWords: Array.isArray(parsed.suggestedWords) ? parsed.suggestedWords : [],
      savedWords: Array.isArray(parsed.savedWords) ? parsed.savedWords : [],
      essayReviews: Array.isArray(parsed.essayReviews) ? parsed.essayReviews : [],
      feedbackHistory: Array.isArray(parsed.feedbackHistory) ? parsed.feedbackHistory : [],
    };
  } catch {
    return createEmptyProject();
  }
}

export default function App() {
  const [project, setProject] = useState<WritingProject>(() => loadInitialProject());
  const projectRef = useRef<WritingProject>(project);
  projectRef.current = project;

  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingBox, setLoadingBox] = useState<ObservationBoxKey | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingWords, setLoadingWords] = useState(false);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sampleNotice, setSampleNotice] = useState(false);

  const persistNow = useCallback((stateToSave: WritingProject) => {
    try {
      const payload: WritingProject = {
        ...stateToSave,
        lastSavedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }, []);

  // Auto-save to localStorage every 5 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      persistNow(projectRef.current);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [persistNow]);

  // Also persist immediately before leaving page
  useEffect(() => {
    const handleBeforeUnload = () => persistNow(projectRef.current);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [persistNow]);

  const maxUnlockedStep = getMaxUnlockedStep(project);

  const goToStep = (step: StepNumber) => {
    setErrorMsg(null);
    if (!canNavigateToStep(project, step)) return;
    if (step === 3) {
      setHistoryOpen(false);
    }
    setProject((prev) => {
      let next = { ...prev, currentStep: step };
      if (step === 2 && !prev.outlineSyncedFromStep1) {
        next = {
          ...next,
          outline: syncObservationsToOutline(
            prev.observations,
            prev.outline,
            getDisplayPersonName(prev)
          ),
          outlineSyncedFromStep1: true,
        };
      }
      persistNow(next);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const appendHistory = (
    prev: WritingProject,
    item: Omit<FeedbackHistoryItem, 'id' | 'timestamp'>
  ): FeedbackHistoryItem[] => {
    return [
      ...prev.feedbackHistory,
      {
        ...item,
        id: `fh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
      },
    ];
  };

  const handleLoadSampleData = () => {
    const sample = createSampleGrandmaProject();
    setErrorMsg(null);
    setHistoryOpen(false);
    setProject(sample);
    persistNow(sample);
    setSampleNotice(true);
    window.setTimeout(() => setSampleNotice(false), 4500);
  };

  const handleStartNewEssay = () => {
    const fresh = createEmptyProject();
    setErrorMsg(null);
    setProject(fresh);
    persistNow(fresh);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 1 handlers
  const handleSelectPerson = (choice: PersonChoice) => {
    setProject((prev) => {
      const next = { ...prev, personChoice: choice };
      persistNow(next);
      return next;
    });
  };

  const handleChangeCustomPerson = (label: string) => {
    setProject((prev) => ({ ...prev, customPersonLabel: label }));
  };

  const handleAddNote = (box: ObservationBoxKey, note: string) => {
    setProject((prev) => {
      const next = {
        ...prev,
        outlineSyncedFromStep1: false,
        observations: {
          ...prev.observations,
          [box]: [...prev.observations[box], note],
        },
      };
      persistNow(next);
      return next;
    });
  };

  const handleRemoveNote = (box: ObservationBoxKey, index: number) => {
    setProject((prev) => {
      const next = {
        ...prev,
        observations: {
          ...prev.observations,
          [box]: prev.observations[box].filter((_, i) => i !== index),
        },
      };
      persistNow(next);
      return next;
    });
  };

  const handleAskMemoryPrompt = async (box: ObservationBoxKey, boxTitle: string) => {
    const person = getDisplayPersonName(project);
    if (!person) return;
    setErrorMsg(null);
    setLoadingBox(box);
    try {
      const res = await fetchGoiY({
        buoc: 1,
        che_do: 'quan_sat',
        nguoi_ta: person,
        muc: boxTitle,
        ghi_chu: project.observations[box],
      });
      const question = res.tra_loi || 'Em nhớ thêm chi tiết nhỏ nào về phần này nữa không?';
      setProject((prev) => {
        const next: WritingProject = {
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          observationPrompts: {
            ...prev.observationPrompts,
            [box]: question,
          },
          feedbackHistory: appendHistory(prev, {
            step: 1,
            kind: 'quan_sat',
            title: `Gợi nhớ ô ${boxTitle}`,
            promptSummary: `Tả ${person} — ${boxTitle}`,
            responseSummary: question,
          }),
        };
        persistNow(next);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không gọi được Bạn Viết lúc này.');
    } finally {
      setLoadingBox(null);
    }
  };

  // Step 2 handlers
  const handleUpdateOutline = (nextOutline: OutlineData) => {
    setProject((prev) => ({
      ...prev,
      outline: nextOutline,
      outlineCheck: null,
    }));
  };

  const handleSendChat = async (message: string) => {
    const person = getDisplayPersonName(project);
    setErrorMsg(null);
    setLoadingChat(true);

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user' as const,
      text: message,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...project.chatMessages, userMsg];
    setProject((prev) => ({ ...prev, chatMessages: nextMessages }));

    const outlineSummary = [
      `Mở bài: ${project.outline.moBai}`,
      `Ngoại hình: ${project.outline.ngoaiHinh.join('; ')}`,
      `Tính tình, hoạt động: ${project.outline.tinhTinhHoatDong.join('; ')}`,
      `Kết bài: ${project.outline.ketBai}`,
    ].join('\n');

    try {
      const res = await fetchGoiY({
        buoc: 2,
        che_do: 'tro_chuyen',
        nguoi_ta: person,
        tin_nhan: message,
        lich_su_chat: nextMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        dan_y_tom_tat: outlineSummary,
      });

      const replyText =
        res.tra_loi || 'Ý của bạn thú vị lắm! Bạn nhớ thêm chi tiết nhỏ nào nữa không?';

      setProject((prev) => {
        const next: WritingProject = {
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          chatMessages: [
            ...prev.chatMessages,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: replyText,
              timestamp: new Date().toISOString(),
            },
          ],
          feedbackHistory: appendHistory(prev, {
            step: 2,
            kind: 'tro_chuyen',
            title: 'Trò chuyện lập ý',
            promptSummary: message,
            responseSummary: replyText,
          }),
        };
        persistNow(next);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bạn Viết chưa trả lời được lúc này.');
    } finally {
      setLoadingChat(false);
    }
  };

  const handleFetchWordBank = async (topic: string) => {
    const person = getDisplayPersonName(project);
    setErrorMsg(null);
    setLoadingWords(true);
    try {
      const res = await fetchGoiY({
        buoc: 2,
        che_do: 'kho_tu_ngu',
        nguoi_ta: person,
        muc: topic,
        ghi_chu: [...project.outline.ngoaiHinh, ...project.outline.tinhTinhHoatDong].slice(0, 8),
      });
      const words = res.tu_ngu ?? [];
      setProject((prev) => {
        const next: WritingProject = {
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          suggestedWords: words,
          suggestedWordTopic: topic,
          feedbackHistory: appendHistory(prev, {
            step: 2,
            kind: 'kho_tu_ngu',
            title: `Kho từ ngữ: ${topic}`,
            promptSummary: `Tìm từ tả ${person.toLowerCase()} — ${topic}`,
            responseSummary: res.tra_loi || `Gợi ý ${words.length} từ/cụm từ ngắn.`,
            details: words.length > 0 ? [words.join(' · ')] : undefined,
          }),
        };
        persistNow(next);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không mở được kho từ ngữ lúc này.');
    } finally {
      setLoadingWords(false);
    }
  };

  const handleToggleSavedWord = (word: string) => {
    setProject((prev) => {
      const exists = prev.savedWords.includes(word);
      const savedWords = exists
        ? prev.savedWords.filter((w) => w !== word)
        : [...prev.savedWords, word];
      const next = { ...prev, savedWords };
      persistNow(next);
      return next;
    });
  };

  const handleCheckOutline = async () => {
    const person = getDisplayPersonName(project);
    setErrorMsg(null);
    setLoadingCheck(true);
    try {
      const res = await fetchKiemTraDanY({
        nguoi_ta: person,
        dan_y: project.outline,
      });
      const checkedAt = new Date().toISOString();
      setProject((prev) => {
        const next: WritingProject = {
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          outlineCheck: { ...res, checkedAt },
          feedbackHistory: appendHistory(prev, {
            step: 2,
            kind: 'kiem_tra_dan_y',
            title: 'Kiểm tra dàn ý',
            responseSummary: `${res.du_3_phan ? 'Đủ 3 phần' : 'Chưa đủ 3 phần'} · ${res.so_chi_tiet_ngoai_hinh} chi tiết ngoại hình · ${res.so_chi_tiet_tinh_tinh_hoat_dong} chi tiết tính tình, hoạt động.`,
            details: [...res.phan_con_thieu, ...res.cau_hoi_goi_y],
          }),
        };
        persistNow(next);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Chưa kiểm tra được dàn ý lúc này.');
    } finally {
      setLoadingCheck(false);
    }
  };

  // Step 3 handlers
  const handleChangeDraft = (nextText: string) => {
    setProject((prev) => {
      if (prev.draftLocked) return prev;
      return { ...prev, draftText: nextText };
    });
  };

  const handleLockDraft = () => {
    setProject((prev) => {
      if (prev.draftLocked || !prev.draftText.trim()) return prev;
      const next: WritingProject = {
        ...prev,
        draftLocked: true,
        draftLockedAt: new Date().toISOString(),
        revisedText: prev.draftText,
        currentStep: 4,
      };
      persistNow(next);
      return next;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 4 handlers
  const handleChangeRevised = (nextText: string) => {
    setProject((prev) => ({ ...prev, revisedText: nextText }));
  };

  const handleUpdateSelfCheck = (key: keyof SelfCheckState, value: SelfCheckAnswer) => {
    setProject((prev) => {
      const next = {
        ...prev,
        selfCheck: { ...prev.selfCheck, [key]: value },
      };
      persistNow(next);
      return next;
    });
  };

  const handleRequestEssayReview = async () => {
    if (project.essayReviews.length >= MAX_ESSAY_REVIEWS) return;
    const person = getDisplayPersonName(project);
    const attemptNumber = project.essayReviews.length + 1;
    setErrorMsg(null);
    setLoadingReview(true);
    try {
      const res = await fetchGopYBai({
        nguoi_ta: person,
        bai_van: project.revisedText,
        lan_thu: attemptNumber,
      });
      const reviewEntry = {
        id: `rev-${Date.now()}`,
        attemptNumber,
        loi_khen: res.loi_khen,
        gop_y: res.gop_y,
        timestamp: new Date().toISOString(),
      };
      setProject((prev) => {
        const next: WritingProject = {
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          essayReviews: [...prev.essayReviews, reviewEntry],
          feedbackHistory: appendHistory(prev, {
            step: 4,
            kind: 'gop_y_bai',
            title: `Bạn Viết đọc giúp bài (Lần ${attemptNumber}/3)`,
            responseSummary: res.loi_khen,
            details: res.gop_y.map((g) => `“${g.trich_doan}” — ${g.cau_hoi_goi_y}`),
          }),
        };
        persistNow(next);
        return next;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bạn Viết chưa đọc xong bài lúc này.');
    } finally {
      setLoadingReview(false);
    }
  };

  // Step 5 handlers
  const handleUpdateRating = (key: keyof SelfRatingState, stars: number) => {
    setProject((prev) => {
      const next = {
        ...prev,
        selfRating: { ...prev.selfRating, [key]: stars },
      };
      persistNow(next);
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F6FAF7] text-[#1C2A24]">
      {/* Compact single-row sticky top header (keeps mobile sticky height <= 8% viewport) */}
      <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#DDE7E2]">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand wordmark */}
          <button
            type="button"
            onClick={() => goToStep(1)}
            className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 cursor-pointer min-h-[44px]"
          >
            <MascotAvatar size="sm" className="!w-9 !h-9 sm:!w-10 sm:!h-10 rounded-xl" />
            <span className="text-[19px] sm:text-xl font-bold tracking-tight text-[#14532D]">
              Bạn Viết
            </span>
          </button>

          {/* Clean single-line utility actions */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={handleLoadSampleData}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 sm:px-3.5 py-2 rounded-xl border border-[#DDE7E2] bg-[#F6FAF7] text-[#1C2A24] text-[16px] sm:text-[18px] font-semibold hover:bg-[#ECFDF5] hover:border-[#86EFAC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-[#15803D] shrink-0" aria-hidden="true" />
              <span>Dữ liệu mẫu</span>
            </button>

            {/* Hide AI history button completely during Step 3 (AI OFF) */}
            {project.currentStep !== 3 && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label={`Mở lịch sử góp ý (${project.feedbackHistory.length} lượt)`}
                className="inline-flex items-center gap-1 sm:gap-1.5 min-h-[44px] px-2.5 sm:px-3.5 py-2 rounded-xl border border-[#DDE7E2] bg-white text-[#1C2A24] text-[16px] sm:text-[18px] font-semibold hover:bg-[#F1F5F9] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <History className="w-4 h-4 sm:w-5 sm:h-5 text-[#0369A1] shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Lịch sử góp ý</span>
                <span className="tabular-nums text-[#0369A1]">
                  ({project.feedbackHistory.length})
                </span>
              </button>
            )}

            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* 5-step progress bar (non-sticky so mobile sticky cap stays tiny) */}
      <StepProgressBar
        currentStep={project.currentStep}
        maxUnlockedStep={maxUnlockedStep}
        onSelectStep={goToStep}
      />

      {/* Sample loaded confirmation toast */}
      {sampleNotice && (
        <div
          role="status"
          className="no-print max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4"
        >
          <div className="rounded-2xl bg-[#ECFDF5] border border-[#86EFAC] px-5 py-3.5 text-[#14532D] font-medium">
            Đã điền sẵn phiếu quan sát, dàn ý và bản nháp tả bà nội để em trải nghiệm nhanh cả 5 bước!
          </div>
        </div>
      )}

      {/* Active Step Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-7 sm:py-9">
        {project.currentStep === 1 && (
          <Step1Observe
            project={project}
            onSelectPerson={handleSelectPerson}
            onChangeCustomPerson={handleChangeCustomPerson}
            onAddNote={handleAddNote}
            onRemoveNote={handleRemoveNote}
            onAskMemoryPrompt={handleAskMemoryPrompt}
            loadingBox={loadingBox}
            errorMsg={errorMsg}
            onNextStep={() => goToStep(2)}
          />
        )}

        {project.currentStep === 2 && (
          <Step2Outline
            project={project}
            onUpdateOutline={handleUpdateOutline}
            onSendChat={handleSendChat}
            onFetchWordBank={handleFetchWordBank}
            onToggleSavedWord={handleToggleSavedWord}
            onCheckOutline={handleCheckOutline}
            loadingChat={loadingChat}
            loadingWords={loadingWords}
            loadingCheck={loadingCheck}
            errorMsg={errorMsg}
            onPrevStep={() => goToStep(1)}
            onNextStep={() => goToStep(3)}
          />
        )}

        {project.currentStep === 3 && (
          <Step3Write
            project={project}
            onChangeDraft={handleChangeDraft}
            onLockDraft={handleLockDraft}
            onPrevStep={() => goToStep(2)}
            onNextStep={() => goToStep(4)}
          />
        )}

        {project.currentStep === 4 && (
          <Step4Revise
            project={project}
            onChangeRevised={handleChangeRevised}
            onUpdateSelfCheck={handleUpdateSelfCheck}
            onRequestEssayReview={handleRequestEssayReview}
            loadingReview={loadingReview}
            errorMsg={errorMsg}
            onPrevStep={() => goToStep(3)}
            onNextStep={() => goToStep(5)}
          />
        )}

        {project.currentStep === 5 && (
          <Step5Share
            project={project}
            onUpdateRating={handleUpdateRating}
            onPrevStep={() => goToStep(4)}
            onStartNewEssay={handleStartNewEssay}
          />
        )}
      </main>

      <footer className="no-print border-t border-[#DDE7E2] bg-white py-5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[16px] text-[#4B6358]">
          <p>Bạn Viết · Đồng hành tập làm văn tả người lớp 5</p>
          <p>Bài làm tự lưu trên trình duyệt mỗi 5 giây</p>
        </div>
      </footer>

      <FeedbackHistoryDrawer
        isOpen={historyOpen && project.currentStep !== 3}
        onClose={() => setHistoryOpen(false)}
        history={project.feedbackHistory}
      />

      <OfflineIndicator />
    </div>
  );
}
