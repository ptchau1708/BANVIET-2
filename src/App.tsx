/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, GraduationCap, Loader2, LogOut } from 'lucide-react';
import {
  AuthConfigResponse,
  StudentAssignmentSummary,
  StudentProfile,
  TeacherClassSummary,
  TeacherProfile,
  fetchAuthConfig,
  fetchStudentMe,
  fetchTeacherMe,
} from './utils/api';
import { clearSession, getSessionRole, getSessionToken } from './utils/session';
import {
  clearLtiSessionMetadata,
  consumeLaunchAssignmentId,
  getBrowserActiveParentOrigin,
  initOpenEduIframeBridge,
  isEmbeddedInIframe,
  isLtiLaunchMode,
} from './utils/openEduBridge';
import { MascotAvatar } from './components/MascotAvatar';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { StudentLogin } from './components/StudentLogin';
import { StudentHome } from './components/StudentHome';
import { StudentWorkspace } from './components/StudentWorkspace';
import { TeacherLogin } from './components/TeacherLogin';
import { TeacherDashboard } from './components/TeacherDashboard';

type RouteArea = 'student' | 'teacher';

function readRouteArea(): RouteArea {
  return window.location.pathname.startsWith('/giao-vien') ? 'teacher' : 'student';
}

export default function App() {
  const [routeArea, setRouteArea] = useState<RouteArea>(() => readRouteArea());
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse>({
    databaseConfigured: true,
    googleConfigured: true,
    ltiEnabled: false,
    openEduWebOrigin: '',
    openEduTeacherOrigin: '',
    openEduAllowedOrigins: [],
  });
  const [inIframe] = useState<boolean>(() => isEmbeddedInIframe());
  const [ltiMode, setLtiMode] = useState<boolean>(() => isLtiLaunchMode());

  // Student session state
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignmentSummary[]>([]);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null);

  // Teacher session state
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [teacherClasses, setTeacherClasses] = useState<TeacherClassSummary[]>([]);

  const navigate = useCallback((area: RouteArea) => {
    const nextPath = area === 'teacher' ? '/giao-vien' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRouteArea(area);
    setActiveAssignmentId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPop = () => {
      setRouteArea(readRouteArea());
      setActiveAssignmentId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    fetchAuthConfig()
      .then((cfg) => setAuthConfig(cfg))
      .catch(() => {
        // ignore transient errors
      });
  }, []);

  const allowedOpenEduOrigins =
    authConfig.openEduAllowedOrigins && authConfig.openEduAllowedOrigins.length > 0
      ? authConfig.openEduAllowedOrigins
      : [authConfig.openEduWebOrigin, authConfig.openEduTeacherOrigin].filter(
          (v): v is string => Boolean(v)
        );

  // Initialize strict OPEN-EDU iframe postMessage bridge locked to the exact embedding parent origin
  useEffect(() => {
    if (!inIframe || allowedOpenEduOrigins.length === 0) return;
    return initOpenEduIframeBridge(allowedOpenEduOrigins);
  }, [inIframe, authConfig.openEduWebOrigin, authConfig.openEduTeacherOrigin, authConfig.openEduAllowedOrigins]);

  const loadStudentSession = useCallback(async () => {
    const token = getSessionToken();
    const role = getSessionRole();
    if (!token || role !== 'student') {
      setStudentProfile(null);
      setStudentAssignments([]);
      return;
    }
    setStudentLoading(true);
    try {
      const data = await fetchStudentMe();
      setStudentProfile(data.student);
      setStudentAssignments(data.assignments);
      setLtiMode(isLtiLaunchMode());
      const launchedId = consumeLaunchAssignmentId();
      if (launchedId) {
        setActiveAssignmentId(launchedId);
      }
    } catch {
      clearSession();
      setStudentProfile(null);
      setStudentAssignments([]);
    } finally {
      setStudentLoading(false);
    }
  }, []);

  const loadTeacherSession = useCallback(async () => {
    const token = getSessionToken();
    const role = getSessionRole();
    if (!token || role !== 'teacher') {
      setTeacherProfile(null);
      setTeacherClasses([]);
      return;
    }
    setTeacherLoading(true);
    try {
      const data = await fetchTeacherMe();
      setTeacherProfile(data.teacher);
      setTeacherClasses(data.classes);
      setLtiMode(isLtiLaunchMode());
    } catch {
      clearSession();
      setTeacherProfile(null);
      setTeacherClasses([]);
    } finally {
      setTeacherLoading(false);
    }
  }, []);

  useEffect(() => {
    if (routeArea === 'student') {
      void loadStudentSession();
    } else {
      void loadTeacherSession();
    }
  }, [routeArea, loadStudentSession, loadTeacherSession]);

  const handleLogout = () => {
    clearSession();
    clearLtiSessionMetadata();
    setLtiMode(false);
    setStudentProfile(null);
    setStudentAssignments([]);
    setActiveAssignmentId(null);
    setTeacherProfile(null);
    setTeacherClasses([]);
  };

  const isLoggedInStudent = routeArea === 'student' && Boolean(studentProfile);
  const isLoggedInTeacher = routeArea === 'teacher' && Boolean(teacherProfile);
  const activeOpenEduParentOrigin = inIframe
    ? getBrowserActiveParentOrigin(allowedOpenEduOrigins)
    : '';
  // Hide standalone top header when launched inside an allowed OPEN-EDU iframe
  const hideStandaloneHeader = inIframe && (ltiMode || Boolean(activeOpenEduParentOrigin));

  return (
    <div className="min-h-screen flex flex-col bg-[#F6FAF7] text-[#1C2A24]">
      {/* Compact single-row sticky header (hidden inside OPEN-EDU iframe) */}
      {!hideStandaloneHeader && (
        <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#DDE7E2]">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (isLoggedInStudent && activeAssignmentId) {
                setActiveAssignmentId(null);
                void loadStudentSession();
              } else {
                navigate(routeArea);
              }
            }}
            className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
          >
            <MascotAvatar size="sm" />
            <div className="min-w-0 leading-tight">
              <div className="text-[19px] sm:text-xl font-bold text-[#14532D] truncate">
                Bạn Viết
              </div>
              <div className="hidden sm:block text-[13px] text-[#4B6358] truncate">
                {routeArea === 'teacher'
                  ? 'Cổng Giáo viên · Tập làm văn lớp 5'
                  : 'Tự lập ý, tự viết, tự sửa bài văn lớp 5'}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />

            {!isLoggedInStudent && !isLoggedInTeacher && (
              <button
                type="button"
                onClick={() => navigate(routeArea === 'teacher' ? 'student' : 'teacher')}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3 sm:px-4 py-1.5 rounded-xl border border-[#DDE7E2] bg-[#F6FAF7] text-[#1C2A24] text-[15px] sm:text-[16px] font-semibold hover:bg-[#ECFDF5] transition-colors whitespace-nowrap cursor-pointer"
              >
                {routeArea === 'teacher' ? (
                  <>
                    <BookOpen className="w-4 h-4 text-[#15803D] shrink-0" aria-hidden="true" />
                    <span>Học sinh</span>
                  </>
                ) : (
                  <>
                    <GraduationCap className="w-4 h-4 text-[#0369A1] shrink-0" aria-hidden="true" />
                    <span>Giáo viên</span>
                  </>
                )}
              </button>
            )}

            {(isLoggedInStudent || isLoggedInTeacher) && (
              <>
                <span className="hidden md:inline-block text-[15px] font-semibold text-[#14532D] max-w-[180px] truncate">
                  {isLoggedInStudent
                    ? studentProfile?.nickname
                    : teacherProfile?.display_name || teacherProfile?.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-3 sm:px-4 py-1.5 rounded-xl border border-[#CBD5E1] bg-white text-[#334155] text-[15px] sm:text-[16px] font-semibold hover:bg-[#F1F5F9] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Đăng xuất</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {routeArea === 'student' ? (
          studentLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
              <Loader2 className="w-8 h-8 animate-spin text-[#15803D]" aria-hidden="true" />
              <p>Đang mở lớp học của em…</p>
            </div>
          ) : !studentProfile ? (
            <StudentLogin
              onLoggedIn={() => void loadStudentSession()}
              onGoTeacher={() => navigate('teacher')}
              databaseConfigured={authConfig.databaseConfigured}
            />
          ) : activeAssignmentId ? (
            <StudentWorkspace
              assignmentId={activeAssignmentId}
              onBackHome={() => {
                setActiveAssignmentId(null);
                void loadStudentSession();
              }}
              onSessionExpired={handleLogout}
            />
          ) : (
            <StudentHome
              student={studentProfile}
              assignments={studentAssignments}
              onOpenAssignment={(id) => setActiveAssignmentId(id)}
            />
          )
        ) : teacherLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#4B6358]">
            <Loader2 className="w-8 h-8 animate-spin text-[#0369A1]" aria-hidden="true" />
            <p>Đang tải trang Giáo viên…</p>
          </div>
        ) : !teacherProfile ? (
          <TeacherLogin
            onLoggedIn={() => void loadTeacherSession()}
            onGoStudent={() => navigate('student')}
            databaseConfigured={authConfig.databaseConfigured}
            googleConfigured={authConfig.googleConfigured}
            ltiEnabled={Boolean(authConfig.ltiEnabled)}
          />
        ) : (
          <TeacherDashboard
            teacher={teacherProfile}
            classes={teacherClasses}
            onRefreshClasses={loadTeacherSession}
            onSessionExpired={handleLogout}
          />
        )}
      </main>

      <OfflineIndicator />
    </div>
  );
}
