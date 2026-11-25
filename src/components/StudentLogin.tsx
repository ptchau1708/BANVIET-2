import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, GraduationCap, KeyRound, Loader2, Users } from 'lucide-react';
import {
  ClassLookupResponse,
  loginStudentWithPin,
  lookupClassByJoinCode,
} from '../utils/api';
import { saveSession } from '../utils/session';
import { MascotSpeech } from './MascotAvatar';

interface StudentLoginProps {
  onLoggedIn: () => void;
  onGoTeacher: () => void;
  databaseConfigured: boolean;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({
  onLoggedIn,
  onGoTeacher,
  databaseConfigured,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [classInfo, setClassInfo] = useState<ClassLookupResponse | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; nickname: string } | null>(
    null
  );
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLookupClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length !== 6) {
      setErrorMsg('Mã lớp gồm đúng 6 chữ cái hoặc số. Em kiểm tra lại phiếu đăng nhập nhé!');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      const info = await lookupClassByJoinCode(cleaned);
      setClassInfo(info);
      setSelectedStudent(null);
      setPin('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không tìm thấy lớp học này.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classInfo || !selectedStudent) return;
    if (!/^\d{4}$/.test(pin.trim())) {
      setErrorMsg('Mã PIN gồm đúng 4 chữ số. Em gõ đủ 4 số nhé!');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await loginStudentWithPin({
        classId: classInfo.classId,
        studentId: selectedStudent.id,
        pin: pin.trim(),
      });
      saveSession(res.token, 'student');
      onLoggedIn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Mã PIN chưa đúng.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-7 py-2 sm:py-6">
      <MascotSpeech title="Chào bạn nhỏ đến với Bạn Viết!" tone="warm">
        <p>
          Nhập mã lớp 6 ký tự trên phiếu cô giáo phát, chọn biệt danh của em rồi nhập mã PIN 4 số để bắt đầu viết bài nhé!
        </p>
      </MascotSpeech>

      {!databaseConfigured && (
        <div
          role="alert"
          className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-4 text-[#78350F]"
        >
          Máy chủ chưa kết nối cơ sở dữ liệu (thiếu biến <strong>DATABASE_URL</strong> trong Secrets). Vui lòng cấu hình <strong>DATABASE_URL</strong> để đăng nhập.
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-5 py-4 text-[#991B1B] font-medium"
        >
          {errorMsg}
        </div>
      )}

      {/* Step A: Enter 6-char Join Code */}
      {!classInfo && (
        <form
          onSubmit={handleLookupClass}
          className="rounded-2xl bg-white border border-[#DDE7E2] p-6 sm:p-8 space-y-5"
        >
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-[#1C2A24]">Bước 1: Nhập mã lớp</h1>
            <p className="text-[#4B6358]">Mã lớp gồm 6 chữ cái hoặc chữ số in trên phiếu.</p>
          </div>

          <div>
            <label htmlFor="join-code-input" className="block font-semibold text-[#1C2A24] mb-2">
              Mã lớp (6 ký tự)
            </label>
            <input
              id="join-code-input"
              type="text"
              autoComplete="off"
              maxLength={6}
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
              }
              placeholder="LOP5A1"
              className="w-full min-h-[56px] px-4 sm:px-5 py-3 rounded-xl border border-[#CBD5E1] bg-[#FCFDFC] text-xl sm:text-2xl font-bold tracking-[0.2em] text-center uppercase text-[#14532D] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </div>

          <button
            type="submit"
            disabled={loading || joinCode.length !== 6}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[54px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            )}
            <span>Tìm lớp của em</span>
          </button>
        </form>
      )}

      {/* Step B: Pick Nickname */}
      {classInfo && !selectedStudent && (
        <section className="rounded-2xl bg-white border border-[#DDE7E2] p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[16px] text-[#15803D] font-semibold">
                {classInfo.className} · Mã lớp {classInfo.joinCode}
              </p>
              <h1 className="text-2xl font-bold text-[#1C2A24] mt-0.5">
                Bước 2: Chọn biệt danh của em
              </h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setClassInfo(null);
                setErrorMsg(null);
              }}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              <span>Đổi mã lớp</span>
            </button>
          </div>

          {classInfo.students.length === 0 ? (
            <div className="rounded-xl bg-[#F6FAF7] border border-[#DDE7E2] p-5 text-[#4B6358]">
              Lớp này chưa có danh sách học sinh. Em nhờ thầy/cô thêm biệt danh trước nhé!
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {classInfo.students.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setSelectedStudent(st);
                    setPin('');
                    setErrorMsg(null);
                  }}
                  className="min-h-[56px] px-4 py-3 rounded-xl border border-[#DDE7E2] bg-[#F6FAF7] text-[#1C2A24] font-semibold hover:bg-[#ECFDF5] hover:border-[#86EFAC] transition-colors text-center break-words cursor-pointer flex items-center justify-center gap-2"
                >
                  <Users className="w-5 h-5 text-[#15803D] shrink-0" aria-hidden="true" />
                  <span>{st.nickname}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Step C: Enter 4-digit PIN */}
      {classInfo && selectedStudent && (
        <form
          onSubmit={handlePinSubmit}
          className="rounded-2xl bg-white border border-[#DDE7E2] p-6 sm:p-8 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[16px] text-[#15803D] font-semibold">
                {classInfo.className} · {selectedStudent.nickname}
              </p>
              <h1 className="text-2xl font-bold text-[#1C2A24] mt-0.5">
                Bước 3: Nhập mã PIN 4 số
              </h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedStudent(null);
                setPin('');
                setErrorMsg(null);
              }}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#1C2A24] font-semibold hover:bg-[#F1F5F9] cursor-pointer whitespace-nowrap"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              <span>Chọn lại tên</span>
            </button>
          </div>

          <div>
            <label htmlFor="student-pin-input" className="block font-semibold text-[#1C2A24] mb-2">
              Mã PIN (4 chữ số)
            </label>
            <input
              id="student-pin-input"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              className="w-full min-h-[56px] px-5 py-3 rounded-xl border border-[#CBD5E1] bg-[#FCFDFC] text-3xl font-bold tracking-[0.5em] text-center text-[#14532D] focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />
          </div>

          <button
            type="submit"
            disabled={loading || pin.length !== 4}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[54px] px-6 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] disabled:bg-[#CBD5E1] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="w-5 h-5" aria-hidden="true" />
            )}
            <span>Vào lớp viết bài</span>
          </button>
        </form>
      )}

      {/* Teacher entry link */}
      <div className="rounded-2xl bg-white border border-[#DDE7E2] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GraduationCap className="w-7 h-7 text-[#0369A1] shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold text-[#1C2A24]">Thầy cô giáo đăng nhập?</p>
            <p className="text-[16px] text-[#4B6358]">
              Quản lý lớp học, giao bài, xem tiến độ và chấm rubric.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGoTeacher}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl bg-[#E0F2FE] text-[#075985] font-bold hover:bg-[#BAE6FD] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Trang Giáo viên</span>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
