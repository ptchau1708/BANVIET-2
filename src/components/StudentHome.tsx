import React from 'react';
import { ArrowRight, BookOpen, Calendar, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { StudentAssignmentSummary, StudentProfile } from '../utils/api';
import { MascotSpeech } from './MascotAvatar';

const STEP_NAMES: Record<number, string> = {
  1: 'Bước 1: Quan sát',
  2: 'Bước 2: Lập ý',
  3: 'Bước 3: Tự viết',
  4: 'Bước 4: Tự sửa',
  5: 'Bước 5: Chia sẻ',
};

const LEVEL_LABELS: Record<'HTT' | 'HT' | 'CHT', string> = {
  HTT: 'Hoàn thành tốt (HTT)',
  HT: 'Hoàn thành (HT)',
  CHT: 'Chưa hoàn thành (CHT)',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

interface StudentHomeProps {
  student: StudentProfile;
  assignments: StudentAssignmentSummary[];
  onOpenAssignment: (assignmentId: string) => void;
}

export const StudentHome: React.FC<StudentHomeProps> = ({
  student,
  assignments,
  onOpenAssignment,
}) => {
  const assignedList = assignments.filter((a) => !a.submitted_at);
  const completedList = assignments.filter((a) => Boolean(a.submitted_at));
  const aiRemaining = Math.max(0, student.aiDailyLimit - student.aiUsedToday);

  return (
    <div className="space-y-8">
      <MascotSpeech title={`Xin chào ${student.nickname}!`} tone="calm">
        <p>
          Chào mừng bạn đến với lớp <strong>{student.className}</strong>. Chọn một bài bên dưới để tiếp tục đúng bước đang làm dở nhé!
        </p>
        <p className="mt-2 text-[16px] text-[#4B6358] flex flex-wrap items-center gap-3">
          <span>Mã lớp: {student.joinCode}</span>
          <span aria-hidden="true">·</span>
          {student.aiEnabled ? (
            <span className="inline-flex items-center gap-1.5 text-[#15803D] font-medium tabular-nums">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Hôm nay còn {aiRemaining}/{student.aiDailyLimit} lượt hỏi Bạn Viết
            </span>
          ) : (
            <span>Chế độ tự viết (thầy/cô đang tắt trợ lý AI cho lớp)</span>
          )}
        </p>
      </MascotSpeech>

      {/* Section 1: Bài được giao */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-[#1C2A24]">
            Bài được giao ({assignedList.length})
          </h1>
        </div>

        {assignedList.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 text-[#4B6358]">
            Hiện chưa có bài mới nào chưa nộp. Em có thể xem lại các bài đã làm bên dưới nhé!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {assignedList.map((a) => {
              const step = a.current_step ?? 0;
              return (
                <article
                  key={a.id}
                  className="rounded-2xl bg-white border border-[#DDE7E2] p-6 flex flex-col justify-between gap-5"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-[16px] text-[#0369A1] font-semibold">
                      <BookOpen className="w-5 h-5 shrink-0" aria-hidden="true" />
                      <span>
                        {step > 0 ? `Đang làm · ${STEP_NAMES[step] ?? `Bước ${step}`}` : 'Chưa bắt đầu'}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-[#1C2A24]">{a.title}</h2>
                    {a.prompt_text && (
                      <p className="text-[#4B6358] line-clamp-3">{a.prompt_text}</p>
                    )}
                    {(a.opens_at || a.closes_at) && (
                      <p className="text-[16px] text-[#64748B] flex items-center gap-2 pt-1 tabular-nums">
                        <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>
                          {a.opens_at ? `Mở: ${fmtDateTime(a.opens_at)}` : ''}
                          {a.opens_at && a.closes_at ? ' · ' : ''}
                          {a.closes_at ? `Hạn nộp: ${fmtDateTime(a.closes_at)}` : ''}
                        </span>
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenAssignment(a.id)}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[50px] px-5 py-3 rounded-xl bg-[#15803D] text-white font-bold hover:bg-[#166534] transition-colors cursor-pointer"
                  >
                    <span>{step > 0 ? 'Tiếp tục làm bài' : 'Bắt đầu làm bài'}</span>
                    <ArrowRight className="w-5 h-5" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Bài đã làm */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold text-[#1C2A24]">
          Bài đã làm ({completedList.length})
        </h2>

        {completedList.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[#DDE7E2] p-6 text-[#4B6358]">
            Em chưa hoàn thành bài nào. Khi sang Bước 5 (Chia sẻ), bài của em sẽ hiện ở đây!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {completedList.map((a) => (
              <article
                key={a.id}
                className="rounded-2xl bg-white border border-[#BBF7D0] p-6 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[16px]">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#15803D]">
                      <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                      <span>Đã hoàn thành</span>
                    </span>
                    {a.submitted_at && (
                      <span className="inline-flex items-center gap-1 text-[#64748B] tabular-nums">
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        {fmtDateTime(a.submitted_at)}
                      </span>
                    )}
                  </div>

                  <h3 className="text-xl font-bold text-[#1C2A24]">{a.title}</h3>

                  {a.teacher_level && (
                    <p className="font-semibold text-[#075985]">
                      Nhận xét của thầy/cô: {LEVEL_LABELS[a.teacher_level]}
                    </p>
                  )}
                  {a.teacher_comment && (
                    <p className="rounded-xl bg-[#F0F7F3] border border-[#CDE2D6] p-3.5 text-[#1C2A24]">
                      “{a.teacher_comment}”
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenAssignment(a.id)}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl border border-[#15803D] bg-white text-[#15803D] font-bold hover:bg-[#ECFDF5] transition-colors cursor-pointer"
                >
                  <span>Xem lại & In bài</span>
                  <ArrowRight className="w-5 h-5" aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
