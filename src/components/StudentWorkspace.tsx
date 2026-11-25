import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Cloud, CloudOff, FileText, History, Loader2 } from 'lucide-react';
import {
  EssayReviewResult,
  FeedbackHistoryItem,
  ObservationBoxKey,
  OutlineCheckResult,
  OutlineData,
  PersonChoice,
  SelfCheckAnswer,
  SelfCheckState,
  SelfRatingState,
  StepNumber,
  WritingProject,
} from '../types';
import {
  FALLBACK_GENTLE_NOTICE,
  STEP4_TOMORROW_NOTICE,
  extractKhoTuStats,
  hasOutlineCheckEvaluation,
  mapSelfCheckKeyToKhoHelper,
  mapStep1BoxToKhoTarget,
  mapWordTopicToKhoTarget,
  mergeKhoTuIntoOutlineCheck,
  mergeKhoTuStats,
} from '../utils/khoTuNgu';
import {
  MAX_ESSAY_REVIEWS,
  canNavigateToStep,
  createEmptyProject,
  getDisplayPersonName,
  getMaxUnlockedStep,
  syncObservationsToOutline,
} from '../utils/writingLogic';
import { createSampleGrandmaProject } from '../data/sampleData';
import {
  DbAiEvent,
  StudentSubmissionPayload,
  fetchGoiY,
  fetchGopYBai,
  fetchKiemTraDanY,
  fetchStudentSubmission,
  saveStudentSubmission,
} from '../utils/api';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { StepProgressBar } from './StepProgressBar';
import { Step1Observe } from './Step1Observe';
import { Step2Outline } from './Step2Outline';
import { Step3Write } from './Step3Write';
import { Step4Revise } from './Step4Revise';
import { Step5Share } from './Step5Share';
import { FeedbackHistoryDrawer } from './FeedbackHistoryDrawer';
import { KhoTuModal, type KhoTuModalTarget } from './KhoTuModal';

interface StudentWorkspaceProps {
  assignmentId: string;
  onBackHome: () => void;
  onSessionExpired: () => void;
}

type SaveState = 'saved' | 'saving' | 'unsaved';

function pendingCacheKey(submissionId: string): string {
  return `banviet_pending_${submissionId}`;
}

function hydrateProjectFromDb(payload: StudentSubmissionPayload): WritingProject {
  const base = createEmptyProject();
  const sub = payload.submission;
  const obsRaw = (sub.observation ?? {}) as Record<string, unknown>;
  const outRaw = (sub.outline ?? {}) as Record<string, unknown>;

  const aiEvents = payload.aiEvents ?? [];
  const feedbackHistory: FeedbackHistoryItem[] = [];
  const essayReviews: EssayReviewResult[] = [];
  let reviewCounter = 0;

  for (const ev of aiEvents) {
    const resp = (ev.response_json ?? {}) as Record<string, unknown>;
    const nguon = resp.nguon === 'kho' ? ('kho' as const) : ('ai' as const);

    if (ev.endpoint === 'gop-y-bai') {
      reviewCounter++;
      const loiKhen = typeof resp.loi_khen === 'string' ? resp.loi_khen : '';
      const gopY = Array.isArray(resp.gop_y)
        ? (resp.gop_y as EssayReviewResult['gop_y'])
        : [];
      essayReviews.push({
        id: String(ev.id),
        attemptNumber: reviewCounter,
        loi_khen: loiKhen,
        gop_y: gopY,
        timestamp: ev.created_at,
      });
      feedbackHistory.push({
        id: String(ev.id),
        step: 4,
        kind: 'gop_y_bai',
        nguon,
        title: `Bạn Viết đọc giúp bài (Lần ${reviewCounter}/3)`,
        responseSummary: loiKhen,
        details: gopY.map((g) => `“${g.trich_doan}” — ${g.cau_hoi_goi_y}`),
        timestamp: ev.created_at,
      });
    } else if (ev.endpoint === 'kiem-tra-dan-y') {
      const du3 = Boolean(resp.du_3_phan);
      const nh = Number(resp.so_chi_tiet_ngoai_hinh ?? 0);
      const tt = Number(resp.so_chi_tiet_tinh_tinh_hoat_dong ?? 0);
      const missing = Array.isArray(resp.phan_con_thieu) ? (resp.phan_con_thieu as string[]) : [];
      const qs = Array.isArray(resp.cau_hoi_goi_y) ? (resp.cau_hoi_goi_y as string[]) : [];
      feedbackHistory.push({
        id: String(ev.id),
        step: 2,
        kind: 'kiem_tra_dan_y',
        nguon,
        title: 'Kiểm tra dàn ý',
        responseSummary: `${du3 ? 'Đủ 3 phần' : 'Chưa đủ 3 phần'} · ${nh} chi tiết ngoại hình · ${tt} chi tiết tính tình, hoạt động.`,
        details: [...missing, ...qs],
        timestamp: ev.created_at,
      });
    } else {
      const traLoi = typeof resp.tra_loi === 'string' ? resp.tra_loi : '';
      const tuNgu = Array.isArray(resp.tu_ngu) ? (resp.tu_ngu as string[]) : [];
      const stepNum = ev.step === 1 ? 1 : 2;
      feedbackHistory.push({
        id: String(ev.id),
        step: stepNum,
        kind: tuNgu.length > 0 ? 'kho_tu_ngu' : stepNum === 1 ? 'quan_sat' : 'tro_chuyen',
        nguon,
        title:
          tuNgu.length > 0
            ? 'Kho từ ngữ'
            : stepNum === 1
              ? 'Gợi nhớ Bước 1'
              : 'Trò chuyện lập ý',
        promptSummary: ev.request_text ?? undefined,
        responseSummary: traLoi || (tuNgu.length > 0 ? tuNgu.join(' · ') : ''),
        details: tuNgu.length > 0 ? [tuNgu.join(' · ')] : undefined,
        timestamp: ev.created_at,
      });
    }
  }

  const stepVal = Number(sub.current_step ?? 1);
  const safeStep = (stepVal >= 1 && stepVal <= 5 ? stepVal : 1) as StepNumber;
  const khoTuStats = extractKhoTuStats(sub.outline_check);

  const hydrated: WritingProject = {
    ...base,
    id: sub.id,
    currentStep: safeStep,
    personChoice: (typeof obsRaw.personChoice === 'string' ? obsRaw.personChoice : '') as
      | PersonChoice
      | '',
    customPersonLabel:
      typeof obsRaw.customPersonLabel === 'string' ? obsRaw.customPersonLabel : '',
    observations: {
      ngoaiHinh: Array.isArray(obsRaw.ngoaiHinh) ? (obsRaw.ngoaiHinh as string[]) : [],
      tinhTinh: Array.isArray(obsRaw.tinhTinh) ? (obsRaw.tinhTinh as string[]) : [],
      hoatDongLoiNoi: Array.isArray(obsRaw.hoatDongLoiNoi)
        ? (obsRaw.hoatDongLoiNoi as string[])
        : [],
      tinhCam: Array.isArray(obsRaw.tinhCam) ? (obsRaw.tinhCam as string[]) : [],
    },
    observationPrompts:
      obsRaw.observationPrompts && typeof obsRaw.observationPrompts === 'object'
        ? (obsRaw.observationPrompts as Partial<Record<ObservationBoxKey, string>>)
        : {},
    observationPromptMeta:
      obsRaw.observationPromptMeta && typeof obsRaw.observationPromptMeta === 'object'
        ? (obsRaw.observationPromptMeta as WritingProject['observationPromptMeta'])
        : {},
    outline: {
      moBai: typeof outRaw.moBai === 'string' ? outRaw.moBai : '',
      ngoaiHinh: Array.isArray(outRaw.ngoaiHinh) ? (outRaw.ngoaiHinh as string[]) : [],
      tinhTinhHoatDong: Array.isArray(outRaw.tinhTinhHoatDong)
        ? (outRaw.tinhTinhHoatDong as string[])
        : [],
      ketBai: typeof outRaw.ketBai === 'string' ? outRaw.ketBai : '',
    },
    outlineSyncedFromStep1: Boolean(outRaw.outlineSyncedFromStep1),
    savedWords: Array.isArray(outRaw.savedWords) ? (outRaw.savedWords as string[]) : [],
    suggestedWords: Array.isArray(outRaw.suggestedWords) ? (outRaw.suggestedWords as string[]) : [],
    suggestedWordTopic:
      typeof outRaw.suggestedWordTopic === 'string' ? outRaw.suggestedWordTopic : 'Mái tóc',
    outlineCheck: hasOutlineCheckEvaluation(sub.outline_check)
      ? ({
          ...(sub.outline_check as unknown as OutlineCheckResult),
          checkedAt: sub.updated_at ?? new Date().toISOString(),
        } as OutlineCheckResult)
      : null,
    khoTuStats,
    seenKhoQuestions: Array.isArray(obsRaw.seenKhoQuestions)
      ? (obsRaw.seenKhoQuestions as string[])
      : [],
    draftText: sub.draft_text ?? '',
    draftLocked: Boolean(sub.draft_locked_at),
    draftLockedAt: sub.draft_locked_at,
    revisedText: sub.revised_text ?? sub.draft_text ?? '',
    selfCheck: sub.self_checklist
      ? { ...base.selfCheck, ...sub.self_checklist }
      : base.selfCheck,
    selfRating: sub.self_rubric ? { ...base.selfRating, ...sub.self_rubric } : base.selfRating,
    essayReviews,
    aiCallCount: aiEvents.length,
    feedbackHistory,
    lastSavedAt: sub.updated_at,
  };

  // Rehydrate chat messages from Step 2 goi-y events
  const chatFromEvents: WritingProject['chatMessages'] = [];
  for (const ev of aiEvents as DbAiEvent[]) {
    if (ev.endpoint === 'goi-y' && ev.step === 2) {
      const resp = (ev.response_json ?? {}) as Record<string, unknown>;
      if (!Array.isArray(resp.tu_ngu) && typeof resp.tra_loi === 'string') {
        if (ev.request_text) {
          chatFromEvents.push({
            id: `u-${ev.id}`,
            role: 'user',
            text: ev.request_text,
            timestamp: ev.created_at,
          });
        }
        chatFromEvents.push({
          id: `a-${ev.id}`,
          role: 'assistant',
          text: resp.tra_loi,
          timestamp: ev.created_at,
          nguon: resp.nguon === 'kho' ? 'kho' : 'ai',
        });
      }
    }
  }
  hydrated.chatMessages = chatFromEvents;

  return hydrated;
}

export const StudentWorkspace: React.FC<StudentWorkspaceProps> = ({
  assignmentId,
  onBackHome,
  onSessionExpired,
}) => {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [assignmentMeta, setAssignmentMeta] = useState<StudentSubmissionPayload['assignment'] | null>(
    null
  );
  const [aiSettings, setAiSettings] = useState<StudentSubmissionPayload['aiSettings']>({
    aiEnabled: true,
    aiDailyLimit: 5,
    aiUsedToday: 0,
    appAiRemaining: null,
    aiAvailableForHints: true,
    aiAvailableForStep4: true,
  });
  const [teacherFeedback, setTeacherFeedback] = useState<{
    level: 'HTT' | 'HT' | 'CHT' | null;
    comment: string | null;
  }>({ level: null, comment: null });

  const [project, setProject] = useState<WritingProject>(() => createEmptyProject());
  const projectRef = useRef<WritingProject>(project);
  projectRef.current = project;

  const dirtyRef = useRef(false);
  const lastSyncTimeRef = useRef<number>(Date.now());

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [khoModalOpen, setKhoModalOpen] = useState(false);
  const [khoModalTarget, setKhoModalTarget] = useState<KhoTuModalTarget | null>(null);
  const [step4UnavailableNotice, setStep4UnavailableNotice] = useState<string | null>(null);

  const [loadingBox, setLoadingBox] = useState<ObservationBoxKey | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingWords, setLoadingWords] = useState(false);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const aiRemainingToday = Math.max(0, aiSettings.aiDailyLimit - aiSettings.aiUsedToday);
  const aiAvailableForHints =
    aiSettings.aiEnabled &&
    aiRemainingToday > 0 &&
    aiSettings.aiAvailableForHints !== false;
  const aiAvailableForStep4 =
    aiSettings.aiEnabled &&
    aiRemainingToday > 0 &&
    aiSettings.aiAvailableForStep4 !== false;

  const buildSaveBody = (
    p: WritingProject,
    opts?: { lockDraft?: boolean; markSubmitted?: boolean; stepCompleted?: boolean }
  ) => {
    const now = Date.now();
    const deltaMinutes = Math.floor((now - lastSyncTimeRef.current) / 60000);
    const baseOutlineCheck = p.outlineCheck
      ? {
          du_3_phan: p.outlineCheck.du_3_phan,
          so_chi_tiet_ngoai_hinh: p.outlineCheck.so_chi_tiet_ngoai_hinh,
          so_chi_tiet_tinh_tinh_hoat_dong: p.outlineCheck.so_chi_tiet_tinh_tinh_hoat_dong,
          phan_con_thieu: p.outlineCheck.phan_con_thieu,
          cau_hoi_goi_y: p.outlineCheck.cau_hoi_goi_y,
        }
      : null;

    return {
      current_step: p.currentStep,
      observation: {
        personChoice: p.personChoice,
        customPersonLabel: p.customPersonLabel,
        ngoaiHinh: p.observations.ngoaiHinh,
        tinhTinh: p.observations.tinhTinh,
        hoatDongLoiNoi: p.observations.hoatDongLoiNoi,
        tinhCam: p.observations.tinhCam,
        observationPrompts: p.observationPrompts,
        observationPromptMeta: p.observationPromptMeta ?? {},
        seenKhoQuestions: p.seenKhoQuestions.slice(-30),
      },
      outline: {
        moBai: p.outline.moBai,
        ngoaiHinh: p.outline.ngoaiHinh,
        tinhTinhHoatDong: p.outline.tinhTinhHoatDong,
        ketBai: p.outline.ketBai,
        outlineSyncedFromStep1: p.outlineSyncedFromStep1,
        savedWords: p.savedWords,
        suggestedWords: p.suggestedWords,
        suggestedWordTopic: p.suggestedWordTopic,
      },
      outline_check: mergeKhoTuIntoOutlineCheck(baseOutlineCheck, p.khoTuStats),
      draft_text: p.draftText,
      revised_text: p.revisedText,
      self_checklist: p.selfCheck,
      self_rubric: p.selfRating,
      lock_draft: opts?.lockDraft,
      mark_submitted: opts?.markSubmitted,
      step_completed: opts?.stepCompleted,
      delta_minutes: deltaMinutes > 0 ? deltaMinutes : 0,
    };
  };

  const cacheLocally = useCallback((p: WritingProject) => {
    try {
      window.localStorage.setItem(
        pendingCacheKey(p.id),
        JSON.stringify({ project: p, savedAt: Date.now() })
      );
    } catch {
      // ignore quota errors
    }
  }, []);

  const syncToServer = useCallback(
    async (
      targetProject: WritingProject,
      opts?: { lockDraft?: boolean; markSubmitted?: boolean; stepCompleted?: boolean }
    ) => {
      if (!targetProject.id || targetProject.id.startsWith('bv-')) return;
      if (!navigator.onLine) {
        cacheLocally(targetProject);
        dirtyRef.current = true;
        setSaveState('unsaved');
        return;
      }

      setSaveState('saving');
      try {
        await saveStudentSubmission(targetProject.id, buildSaveBody(targetProject, opts));
        dirtyRef.current = false;
        lastSyncTimeRef.current = Date.now();
        setSaveState('saved');
        try {
          window.localStorage.removeItem(pendingCacheKey(targetProject.id));
        } catch {
          // ignore
        }
      } catch (err) {
        cacheLocally(targetProject);
        dirtyRef.current = true;
        setSaveState('unsaved');
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
          onSessionExpired();
          return;
        }
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Chưa đồng bộ được lên máy chủ — bài làm vẫn đang được lưu tạm trên máy.'
        );
      }
    },
    [cacheLocally, onSessionExpired]
  );

  // Initial fetch of submission from PostgreSQL
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    setStep4UnavailableNotice(null);
    fetchStudentSubmission(assignmentId)
      .then(async (payload) => {
        if (cancelled) return;
        setAssignmentMeta(payload.assignment);
        setAiSettings(payload.aiSettings);
        setTeacherFeedback({
          level: payload.submission.teacher_level,
          comment: payload.submission.teacher_comment,
        });

        let hydrated = hydrateProjectFromDb(payload);

        // If there was an unsynced offline draft cached locally, restore it and sync immediately
        try {
          const cachedRaw = window.localStorage.getItem(pendingCacheKey(hydrated.id));
          if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw) as { project?: WritingProject };
            if (parsed.project && parsed.project.id === hydrated.id) {
              hydrated = {
                ...hydrated,
                ...parsed.project,
                // Server draft lock always wins
                draftLocked: hydrated.draftLocked || parsed.project.draftLocked,
                draftText: hydrated.draftLocked ? hydrated.draftText : parsed.project.draftText,
                khoTuStats: mergeKhoTuStats(hydrated.khoTuStats, parsed.project.khoTuStats),
                aiCallCount: hydrated.aiCallCount,
                feedbackHistory: hydrated.feedbackHistory,
                essayReviews: hydrated.essayReviews,
              };
              dirtyRef.current = true;
              setSaveState('unsaved');
            }
          }
        } catch {
          // ignore malformed cache
        }

        setProject(hydrated);
        setLoading(false);

        if (dirtyRef.current && navigator.onLine) {
          void syncToServer(hydrated);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
          onSessionExpired();
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Không tải được bài làm.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assignmentId, onSessionExpired, syncToServer]);

  // Periodic sync every 5 seconds when dirty
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirtyRef.current) {
        void syncToServer(projectRef.current);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [syncToServer]);

  // Auto-sync immediately when network reconnects
  useEffect(() => {
    if (isOnline && dirtyRef.current) {
      void syncToServer(projectRef.current);
    }
  }, [isOnline, syncToServer]);

  const mutateProject = (
    updater: (prev: WritingProject) => WritingProject,
    syncNowOpts?: { lockDraft?: boolean; markSubmitted?: boolean; stepCompleted?: boolean }
  ) => {
    setProject((prev) => {
      const next = updater(prev);
      dirtyRef.current = true;
      cacheLocally(next);
      setSaveState('unsaved');
      if (syncNowOpts) {
        void syncToServer(next, syncNowOpts);
      }
      return next;
    });
  };

  const openKhoTu = (target: KhoTuModalTarget) => {
    setKhoModalTarget(target);
    setKhoModalOpen(true);
    // Track opening Word Bank inside outline_check.kho_tu (never writes to ai_events, never uses AI quota)
    mutateProject(
      (prev) => ({
        ...prev,
        khoTuStats: {
          ...prev.khoTuStats,
          mo_kho: prev.khoTuStats.mo_kho + 1,
        },
      }),
      { stepCompleted: false }
    );
  };

  const handleToggleSavedWord = (word: string, fromKho = false) => {
    mutateProject(
      (prev) => {
        const exists = prev.savedWords.includes(word);
        return {
          ...prev,
          savedWords: exists
            ? prev.savedWords.filter((w) => w !== word)
            : [...prev.savedWords, word],
          khoTuStats:
            !exists && fromKho
              ? {
                  ...prev.khoTuStats,
                  tu_da_luu: prev.khoTuStats.tu_da_luu + 1,
                }
              : prev.khoTuStats,
        };
      },
      { stepCompleted: false }
    );
  };

  const applyAiQuotaFromResponse = (res: {
    aiUsedToday?: number;
    aiDailyLimit?: number;
    appAiRemaining?: number | null;
    fallback_reason?: string;
  }) => {
    setAiSettings((prev) => {
      const nextUsed = typeof res.aiUsedToday === 'number' ? res.aiUsedToday : prev.aiUsedToday;
      const nextLimit = typeof res.aiDailyLimit === 'number' ? res.aiDailyLimit : prev.aiDailyLimit;
      const nextAppRem =
        res.appAiRemaining !== undefined ? res.appAiRemaining : prev.appAiRemaining;
      const studentHasQuota = prev.aiEnabled && nextUsed < nextLimit;
      const hintsBlocked =
        res.fallback_reason === 'reserved_for_step4' ||
        res.fallback_reason === 'app_quota_exhausted' ||
        res.fallback_reason === 'no_key' ||
        res.fallback_reason === 'class_ai_disabled' ||
        res.fallback_reason === 'student_daily_limit';
      const step4Blocked =
        res.fallback_reason === 'app_quota_exhausted' ||
        res.fallback_reason === 'no_key' ||
        res.fallback_reason === 'class_ai_disabled' ||
        res.fallback_reason === 'student_daily_limit';

      return {
        ...prev,
        aiUsedToday: nextUsed,
        aiDailyLimit: nextLimit,
        appAiRemaining: nextAppRem,
        aiAvailableForHints: hintsBlocked ? false : studentHasQuota,
        aiAvailableForStep4: step4Blocked ? false : studentHasQuota,
      };
    });
  };

  const maxUnlockedStep = getMaxUnlockedStep(project);

  const goToStep = (step: StepNumber) => {
    setErrorMsg(null);
    if (!canNavigateToStep(project, step)) return;
    if (step === 3) {
      setHistoryOpen(false);
      setKhoModalOpen(false);
    }
    const isAdvancing = step > project.currentStep;

    mutateProject(
      (prev) => {
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
        return next;
      },
      { stepCompleted: isAdvancing, markSubmitted: step === 5 }
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const appendHistory = (
    prev: WritingProject,
    item: Omit<FeedbackHistoryItem, 'id' | 'timestamp'>
  ): FeedbackHistoryItem[] => [
    ...prev.feedbackHistory,
    {
      ...item,
      id: `fh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    },
  ];

  const handleLoadSampleData = () => {
    const sample = createSampleGrandmaProject();
    mutateProject(
      (prev) => ({
        ...sample,
        id: prev.id,
        draftLocked: prev.draftLocked,
        draftLockedAt: prev.draftLockedAt,
        draftText: prev.draftLocked ? prev.draftText : sample.draftText,
        khoTuStats: prev.khoTuStats,
        aiCallCount: prev.aiCallCount,
        feedbackHistory: prev.feedbackHistory,
        essayReviews: prev.essayReviews,
      }),
      { stepCompleted: false }
    );
  };

  const handleAskMemoryPrompt = async (box: ObservationBoxKey, boxTitle: string) => {
    const person = getDisplayPersonName(project);
    if (!person) return;
    setErrorMsg(null);
    setLoadingBox(box);
    try {
      const res = await fetchGoiY({
        submission_id: project.id,
        buoc: 1,
        che_do: 'quan_sat',
        nguoi_ta: person,
        muc: boxTitle,
        ghi_chu: project.observations[box],
        cau_hoi_da_xem: project.seenKhoQuestions,
      });
      applyAiQuotaFromResponse(res);
      const source = res.nguon === 'kho' ? 'kho' : 'ai';
      const question = res.tra_loi || 'Em nhớ thêm chi tiết nhỏ nào về phần này nữa không?';
      mutateProject(
        (prev) => ({
          ...prev,
          aiCallCount: source === 'ai' ? prev.aiCallCount + 1 : prev.aiCallCount,
          khoTuStats: res.khoTuStats
            ? mergeKhoTuStats(prev.khoTuStats, res.khoTuStats)
            : prev.khoTuStats,
          seenKhoQuestions:
            source === 'kho' && !prev.seenKhoQuestions.includes(question)
              ? [...prev.seenKhoQuestions, question]
              : prev.seenKhoQuestions,
          observationPrompts: { ...prev.observationPrompts, [box]: question },
          observationPromptMeta: {
            ...(prev.observationPromptMeta ?? {}),
            [box]: {
              nguon: source,
              thongBao: res.thong_bao,
            },
          },
          feedbackHistory: appendHistory(prev, {
            step: 1,
            kind: 'quan_sat',
            nguon: source,
            title: `Gợi nhớ ô ${boxTitle}`,
            promptSummary: `Ô ${boxTitle}`,
            responseSummary: question,
          }),
        }),
        { stepCompleted: false }
      );
    } catch {
      // Offline / network failure -> gently open matching Word Bank topic without dead error
      const target = mapStep1BoxToKhoTarget(box, person);
      openKhoTu({
        groupId: target.groupId,
        topicId: target.topicId,
        title: `Kho từ ngữ: ${boxTitle}`,
      });
    } finally {
      setLoadingBox(null);
    }
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
        submission_id: project.id,
        buoc: 2,
        che_do: 'tro_chuyen',
        nguoi_ta: person,
        tin_nhan: message,
        lich_su_chat: nextMessages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        dan_y_tom_tat: outlineSummary,
        cau_hoi_da_xem: project.seenKhoQuestions,
      });
      applyAiQuotaFromResponse(res);
      const source = res.nguon === 'kho' ? 'kho' : 'ai';
      const replyText =
        res.tra_loi || 'Ý của bạn thú vị lắm! Bạn nhớ thêm chi tiết nhỏ nào nữa không?';

      setProject((prev) => ({
        ...prev,
        aiCallCount: source === 'ai' ? prev.aiCallCount + 1 : prev.aiCallCount,
        khoTuStats: res.khoTuStats
          ? mergeKhoTuStats(prev.khoTuStats, res.khoTuStats)
          : prev.khoTuStats,
        seenKhoQuestions:
          source === 'kho' && !prev.seenKhoQuestions.includes(replyText)
            ? [...prev.seenKhoQuestions, replyText]
            : prev.seenKhoQuestions,
        chatMessages: [
          ...prev.chatMessages,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: replyText,
            timestamp: new Date().toISOString(),
            nguon: source,
            thongBao: res.thong_bao,
          },
        ],
        feedbackHistory: appendHistory(prev, {
          step: 2,
          kind: 'tro_chuyen',
          nguon: source,
          title: 'Trò chuyện lập ý',
          promptSummary: message,
          responseSummary: replyText,
        }),
      }));
    } catch {
      setProject((prev) => ({
        ...prev,
        chatMessages: [
          ...prev.chatMessages,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: 'Em hãy mở “Xem kho từ” để xem thêm từ ngữ gợi tả và câu hỏi gợi nhớ nhé!',
            timestamp: new Date().toISOString(),
            nguon: 'kho',
            thongBao: FALLBACK_GENTLE_NOTICE,
          },
        ],
      }));
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
        submission_id: project.id,
        buoc: 2,
        che_do: 'kho_tu_ngu',
        nguoi_ta: person,
        muc: topic,
        ghi_chu: [...project.outline.ngoaiHinh, ...project.outline.tinhTinhHoatDong].slice(0, 8),
        cau_hoi_da_xem: project.seenKhoQuestions,
      });
      applyAiQuotaFromResponse(res);
      const source = res.nguon === 'kho' ? 'kho' : 'ai';
      const words = res.tu_ngu ?? [];
      mutateProject(
        (prev) => ({
          ...prev,
          aiCallCount: source === 'ai' ? prev.aiCallCount + 1 : prev.aiCallCount,
          khoTuStats: res.khoTuStats
            ? mergeKhoTuStats(prev.khoTuStats, res.khoTuStats)
            : prev.khoTuStats,
          suggestedWords: words,
          suggestedWordTopic: topic,
          suggestedWordSource: source,
          suggestedWordNotice: res.thong_bao ?? null,
          feedbackHistory: appendHistory(prev, {
            step: 2,
            kind: 'kho_tu_ngu',
            nguon: source,
            title: `Kho từ ngữ: ${topic}`,
            promptSummary: topic,
            responseSummary: res.tra_loi || `Gợi ý ${words.length} từ ngắn.`,
            details: words.length > 0 ? [words.join(' · ')] : undefined,
          }),
        }),
        { stepCompleted: false }
      );
    } catch {
      const target = mapWordTopicToKhoTarget(topic, person);
      openKhoTu({
        groupId: target.groupId,
        topicId: target.topicId,
        title: `Kho từ ngữ: ${topic}`,
      });
    } finally {
      setLoadingWords(false);
    }
  };

  const handleCheckOutline = async () => {
    const person = getDisplayPersonName(project);
    setErrorMsg(null);
    setLoadingCheck(true);
    try {
      const res = await fetchKiemTraDanY({
        submission_id: project.id,
        nguoi_ta: person,
        dan_y: project.outline,
        cau_hoi_da_xem: project.seenKhoQuestions,
      });
      applyAiQuotaFromResponse(res);
      const source = res.nguon === 'kho' ? 'kho' : 'ai';
      const checkedAt = new Date().toISOString();
      mutateProject(
        (prev) => ({
          ...prev,
          aiCallCount: source === 'ai' ? prev.aiCallCount + 1 : prev.aiCallCount,
          khoTuStats: res.khoTuStats
            ? mergeKhoTuStats(prev.khoTuStats, res.khoTuStats)
            : prev.khoTuStats,
          seenKhoQuestions:
            source === 'kho'
              ? Array.from(new Set([...prev.seenKhoQuestions, ...res.cau_hoi_goi_y]))
              : prev.seenKhoQuestions,
          outlineCheck: {
            du_3_phan: res.du_3_phan,
            so_chi_tiet_ngoai_hinh: res.so_chi_tiet_ngoai_hinh,
            so_chi_tiet_tinh_tinh_hoat_dong: res.so_chi_tiet_tinh_tinh_hoat_dong,
            phan_con_thieu: res.phan_con_thieu,
            cau_hoi_goi_y: res.cau_hoi_goi_y,
            checkedAt,
            nguon: source,
            thongBao: res.thong_bao,
          },
          feedbackHistory: appendHistory(prev, {
            step: 2,
            kind: 'kiem_tra_dan_y',
            nguon: source,
            title: 'Kiểm tra dàn ý',
            responseSummary: `${res.du_3_phan ? 'Đủ 3 phần' : 'Chưa đủ 3 phần'} · ${res.so_chi_tiet_ngoai_hinh} chi tiết ngoại hình · ${res.so_chi_tiet_tinh_tinh_hoat_dong} chi tiết tính tình, hoạt động.`,
            details: [...res.phan_con_thieu, ...res.cau_hoi_goi_y],
          }),
        }),
        { stepCompleted: false }
      );
    } catch {
      const target = mapWordTopicToKhoTarget('Mở bài / Kết bài / Từ nối', person);
      openKhoTu({
        groupId: target.groupId,
        topicId: target.topicId,
        title: 'Kho Khung câu & Từ nối',
      });
    } finally {
      setLoadingCheck(false);
    }
  };

  const handleLockDraft = () => {
    if (project.draftLocked || !project.draftText.trim()) return;
    mutateProject(
      (prev) => ({
        ...prev,
        draftLocked: true,
        draftLockedAt: new Date().toISOString(),
        revisedText: prev.draftText,
        currentStep: 4,
      }),
      { lockDraft: true, stepCompleted: true }
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRequestEssayReview = async () => {
    if (project.essayReviews.length >= MAX_ESSAY_REVIEWS) return;
    const person = getDisplayPersonName(project);
    const attemptNumber = project.essayReviews.length + 1;
    setErrorMsg(null);
    setLoadingReview(true);
    try {
      const res = await fetchGopYBai({
        submission_id: project.id,
        nguoi_ta: person,
        bai_van: project.revisedText,
        lan_thu: attemptNumber,
      });
      applyAiQuotaFromResponse(res);

      if (res.aiUnavailable || res.nguon === 'kho') {
        setStep4UnavailableNotice(res.thong_bao || STEP4_TOMORROW_NOTICE);
        setAiSettings((prev) => ({ ...prev, aiAvailableForStep4: false }));
        if (res.khoTuStats) {
          mutateProject(
            (prev) => ({
              ...prev,
              khoTuStats: mergeKhoTuStats(prev.khoTuStats, res.khoTuStats),
            }),
            { stepCompleted: false }
          );
        }
        return;
      }

      const reviewEntry: EssayReviewResult = {
        id: `rev-${Date.now()}`,
        attemptNumber: res.attemptNumber ?? attemptNumber,
        loi_khen: res.loi_khen,
        gop_y: res.gop_y,
        timestamp: new Date().toISOString(),
      };
      mutateProject(
        (prev) => ({
          ...prev,
          aiCallCount: prev.aiCallCount + 1,
          essayReviews: [...prev.essayReviews, reviewEntry],
          feedbackHistory: appendHistory(prev, {
            step: 4,
            kind: 'gop_y_bai',
            nguon: 'ai',
            title: `Bạn Viết đọc giúp bài (Lần ${reviewEntry.attemptNumber}/3)`,
            responseSummary: res.loi_khen,
            details: res.gop_y.map((g) => `“${g.trich_doan}” — ${g.cau_hoi_goi_y}`),
          }),
        }),
        { stepCompleted: false }
      );
    } catch {
      setStep4UnavailableNotice(STEP4_TOMORROW_NOTICE);
      setAiSettings((prev) => ({ ...prev, aiAvailableForStep4: false }));
    } finally {
      setLoadingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
        <Loader2 className="w-8 h-8 animate-spin text-[#15803D]" aria-hidden="true" />
        <p>Đang mở bài làm của em…</p>
      </div>
    );
  }

  const personLabel = getDisplayPersonName(project);

  return (
    <div className="space-y-6">
      {/* Workspace context bar */}
      <div className="no-print rounded-2xl bg-white border border-[#DDE7E2] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (dirtyRef.current) await syncToServer(projectRef.current);
                onBackHome();
              }}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              <span>Bài của em</span>
            </button>
            <h2 className="text-xl font-bold text-[#14532D] truncate">
              {assignmentMeta?.title || 'Bài văn tả người'}
            </h2>
          </div>
          {assignmentMeta?.prompt_text && (
            <p className="text-[16px] text-[#4B6358] pt-1">{assignmentMeta.prompt_text}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Save status indicator */}
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 text-[16px] font-semibold px-3 py-1.5 rounded-xl ${
              saveState === 'saved'
                ? 'text-[#15803D] bg-[#ECFDF5]'
                : saveState === 'saving'
                  ? 'text-[#0369A1] bg-[#E0F2FE]'
                  : 'text-[#B45309] bg-[#FEF3C7]'
            }`}
          >
            {saveState === 'saved' ? (
              <Cloud className="w-4 h-4" aria-hidden="true" />
            ) : saveState === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <CloudOff className="w-4 h-4" aria-hidden="true" />
            )}
            <span>
              {saveState === 'saved'
                ? 'Đã lưu'
                : saveState === 'saving'
                  ? 'Đang lưu…'
                  : 'Chưa lưu'}
            </span>
          </span>

          {aiSettings.aiEnabled && project.currentStep !== 3 && (
            <span className="text-[16px] text-[#4B6358] tabular-nums">
              AI: còn {aiRemainingToday}/{aiSettings.aiDailyLimit} lượt
            </span>
          )}

          {project.currentStep !== 3 && (
            <button
              type="button"
              onClick={() =>
                openKhoTu({
                  groupId: 'ngoai-hinh',
                  topicId: 'voc-dang',
                  title: 'Kho từ ngữ tả người lớp 5',
                })
              }
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#86EFAC] bg-[#ECFDF5] text-[#14532D] text-[16px] font-semibold hover:bg-[#DCFCE7] cursor-pointer whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4 text-[#15803D]" aria-hidden="true" />
              <span>Xem kho từ</span>
            </button>
          )}

          {!project.draftLocked && project.currentStep === 1 && (
            <button
              type="button"
              onClick={handleLoadSampleData}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDE7E2] bg-[#F6FAF7] text-[#1C2A24] text-[16px] font-semibold hover:bg-[#ECFDF5] cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-[#15803D]" aria-hidden="true" />
              <span>Dữ liệu mẫu</span>
            </button>
          )}

          {project.currentStep !== 3 && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDE7E2] bg-white text-[#1C2A24] text-[16px] font-semibold hover:bg-[#F1F5F9] cursor-pointer whitespace-nowrap"
            >
              <History className="w-4 h-4 text-[#0369A1]" aria-hidden="true" />
              <span>Lịch sử góp ý ({project.feedbackHistory.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* 5-step progress bar */}
      <div className="-mx-4 sm:-mx-6">
        <StepProgressBar
          currentStep={project.currentStep}
          maxUnlockedStep={maxUnlockedStep}
          onSelectStep={goToStep}
        />
      </div>

      {/* Teacher feedback banner if already graded */}
      {teacherFeedback.level && (
        <div className="no-print rounded-2xl bg-[#ECFDF5] border border-[#86EFAC] p-5 space-y-1">
          <p className="font-bold text-[#14532D]">
            Thầy/cô đã chấm bài: Mức {teacherFeedback.level}
          </p>
          {teacherFeedback.comment && (
            <p className="text-[#1C2A24]">Nhận xét: “{teacherFeedback.comment}”</p>
          )}
        </div>
      )}

      {/* Active Step */}
      <div>
        {project.currentStep === 1 && (
          <Step1Observe
            project={project}
            aiEnabled={aiSettings.aiEnabled}
            aiRemainingToday={aiRemainingToday}
            aiAvailableForHints={aiAvailableForHints}
            onSelectPerson={(choice) =>
              mutateProject((prev) => ({ ...prev, personChoice: choice }), { stepCompleted: false })
            }
            onChangeCustomPerson={(label) =>
              mutateProject((prev) => ({ ...prev, customPersonLabel: label }))
            }
            onAddNote={(box, note) =>
              mutateProject(
                (prev) => ({
                  ...prev,
                  outlineSyncedFromStep1: false,
                  observations: {
                    ...prev.observations,
                    [box]: [...prev.observations[box], note],
                  },
                }),
                { stepCompleted: false }
              )
            }
            onRemoveNote={(box, idx) =>
              mutateProject(
                (prev) => ({
                  ...prev,
                  observations: {
                    ...prev.observations,
                    [box]: prev.observations[box].filter((_, i) => i !== idx),
                  },
                }),
                { stepCompleted: false }
              )
            }
            onAskMemoryPrompt={handleAskMemoryPrompt}
            onOpenKhoTu={(box, boxTitle) => {
              const target = mapStep1BoxToKhoTarget(box, personLabel);
              openKhoTu({
                groupId: target.groupId,
                topicId: target.topicId,
                title: `Kho từ ngữ: ${boxTitle}`,
              });
            }}
            loadingBox={loadingBox}
            errorMsg={errorMsg}
            onNextStep={() => goToStep(2)}
          />
        )}

        {project.currentStep === 2 && (
          <Step2Outline
            project={project}
            aiEnabled={aiSettings.aiEnabled}
            aiRemainingToday={aiRemainingToday}
            aiAvailableForHints={aiAvailableForHints}
            onUpdateOutline={(nextOutline: OutlineData) =>
              mutateProject((prev) => ({ ...prev, outline: nextOutline, outlineCheck: null }))
            }
            onSendChat={handleSendChat}
            onFetchWordBank={handleFetchWordBank}
            onOpenKhoTu={(topicLabel) => {
              const target = mapWordTopicToKhoTarget(topicLabel, personLabel);
              openKhoTu({
                groupId: target.groupId,
                topicId: target.topicId,
                title: `Kho từ ngữ: ${topicLabel}`,
              });
            }}
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
            onChangeDraft={(nextText) =>
              mutateProject((prev) => (prev.draftLocked ? prev : { ...prev, draftText: nextText }))
            }
            onLockDraft={handleLockDraft}
            onPrevStep={() => goToStep(2)}
            onNextStep={() => goToStep(4)}
          />
        )}

        {project.currentStep === 4 && (
          <Step4Revise
            project={project}
            aiEnabled={aiSettings.aiEnabled}
            aiRemainingToday={aiRemainingToday}
            aiAvailableForStep4={aiAvailableForStep4}
            step4UnavailableNotice={step4UnavailableNotice}
            onChangeRevised={(nextText) =>
              mutateProject((prev) => ({ ...prev, revisedText: nextText }))
            }
            onUpdateSelfCheck={(key: keyof SelfCheckState, value: SelfCheckAnswer) =>
              mutateProject(
                (prev) => ({
                  ...prev,
                  selfCheck: { ...prev.selfCheck, [key]: value },
                }),
                { stepCompleted: false }
              )
            }
            onRequestEssayReview={handleRequestEssayReview}
            onOpenKhoTuForSelfCheck={(key) => {
              const helper = mapSelfCheckKeyToKhoHelper(key, personLabel);
              openKhoTu({
                groupId: helper.groupId,
                topicId: helper.topicId,
                soSanhOnly: helper.soSanhOnly,
                title: helper.buttonLabel,
              });
            }}
            onOpenKhoTuGeneral={() =>
              openKhoTu({
                groupId: 'ngoai-hinh',
                topicId: 'khuon-mat',
                title: 'Kho từ ngữ tả người lớp 5',
              })
            }
            loadingReview={loadingReview}
            errorMsg={errorMsg}
            onPrevStep={() => goToStep(3)}
            onNextStep={() => goToStep(5)}
          />
        )}

        {project.currentStep === 5 && (
          <Step5Share
            project={project}
            onUpdateRating={(key: keyof SelfRatingState, stars: number) =>
              mutateProject(
                (prev) => ({
                  ...prev,
                  selfRating: { ...prev.selfRating, [key]: stars },
                }),
                { markSubmitted: true, stepCompleted: true }
              )
            }
            onPrevStep={() => goToStep(4)}
            onStartNewEssay={onBackHome}
          />
        )}
      </div>

      <FeedbackHistoryDrawer
        isOpen={historyOpen && project.currentStep !== 3}
        onClose={() => setHistoryOpen(false)}
        history={project.feedbackHistory}
      />

      <KhoTuModal
        isOpen={khoModalOpen && project.currentStep !== 3}
        target={khoModalTarget}
        personLabel={personLabel}
        savedWords={project.savedWords}
        onToggleSavedWord={(word, fromKho) => handleToggleSavedWord(word, fromKho)}
        onClose={() => setKhoModalOpen(false)}
      />
    </div>
  );
};
