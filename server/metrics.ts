import type postgres from 'postgres';

export interface MetricsSnapshot {
  outline_details: number;
  draft_words: number;
  revised_words: number;
  edits_count: number;
  ai_calls: number;
  feedback_rounds: number;
  minutes_spent: number;
}

export function countVietnameseWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function countOutlineItems(outline: unknown): number {
  if (!outline || typeof outline !== 'object') return 0;
  const o = outline as Record<string, unknown>;
  const mo = typeof o.moBai === 'string' && o.moBai.trim() ? 1 : 0;
  const ket = typeof o.ketBai === 'string' && o.ketBai.trim() ? 1 : 0;
  const nh = Array.isArray(o.ngoaiHinh)
    ? o.ngoaiHinh.filter((x) => typeof x === 'string' && x.trim().length > 0).length
    : 0;
  const tt = Array.isArray(o.tinhTinhHoatDong)
    ? o.tinhTinhHoatDong.filter((x) => typeof x === 'string' && x.trim().length > 0).length
    : 0;
  return mo + ket + nh + tt;
}

function tokenizeWords(text: string): string[] {
  if (!text) return [];
  return text.match(/\S+|\s+/g) ?? [];
}

export function countEditRegions(draft: string, revised: string): number {
  const a = tokenizeWords((draft || '').trim());
  const b = tokenizeWords((revised || '').trim());
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 0;

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  let i = 0;
  let j = 0;
  let changes = 0;
  let inChange = false;

  const markChange = (tok: string) => {
    if (tok.trim().length > 0 && !inChange) {
      changes++;
      inChange = true;
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      if (a[i].trim().length > 0) inChange = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      markChange(a[i++]);
    } else {
      markChange(b[j++]);
    }
  }
  while (i < n) markChange(a[i++]);
  while (j < m) markChange(b[j++]);

  return changes;
}

export async function recomputeAndUpsertMetrics(
  sql: ReturnType<typeof postgres>,
  submissionId: string,
  additionalMinutes = 0
): Promise<MetricsSnapshot | null> {
  const subs = await sql<
    Array<{
      id: string;
      outline: unknown;
      draft_text: string | null;
      revised_text: string | null;
      created_at: Date | string;
    }>
  >`
    SELECT id, outline, draft_text, revised_text, created_at
    FROM banviet.submissions
    WHERE id = ${submissionId}
    LIMIT 1
  `;

  if (subs.length === 0) return null;
  const sub = subs[0];

  const eventStats = await sql<
    Array<{ ai_calls: string | number; feedback_rounds: string | number }>
  >`
    SELECT
      COUNT(*)::int AS ai_calls,
      COUNT(*) FILTER (WHERE endpoint = 'gop-y-bai')::int AS feedback_rounds
    FROM banviet.ai_events
    WHERE submission_id = ${submissionId}
  `;

  const existingMetrics = await sql<Array<{ minutes_spent: number | null }>>`
    SELECT minutes_spent
    FROM banviet.metrics
    WHERE submission_id = ${submissionId}
    LIMIT 1
  `;

  const outline_details = countOutlineItems(sub.outline);
  const draft_words = countVietnameseWords(sub.draft_text ?? '');
  const revised_words = countVietnameseWords(sub.revised_text ?? '');
  const edits_count =
    sub.draft_text && sub.revised_text
      ? countEditRegions(sub.draft_text, sub.revised_text)
      : 0;
  const ai_calls = Number(eventStats[0]?.ai_calls ?? 0);
  const feedback_rounds = Number(eventStats[0]?.feedback_rounds ?? 0);

  const prevMinutes = Number(existingMetrics[0]?.minutes_spent ?? 0);
  const elapsedMinutes = Math.max(
    1,
    Math.min(240, Math.round((Date.now() - new Date(sub.created_at).getTime()) / 60000))
  );
  const minutes_spent = Math.max(
    prevMinutes + Math.max(0, Math.min(30, Math.round(additionalMinutes))),
    prevMinutes > 0 ? prevMinutes : elapsedMinutes
  );

  await sql`
    INSERT INTO banviet.metrics (
      submission_id,
      outline_details,
      draft_words,
      revised_words,
      edits_count,
      ai_calls,
      feedback_rounds,
      minutes_spent,
      updated_at
    )
    VALUES (
      ${submissionId},
      ${outline_details},
      ${draft_words},
      ${revised_words},
      ${edits_count},
      ${ai_calls},
      ${feedback_rounds},
      ${minutes_spent},
      NOW()
    )
    ON CONFLICT (submission_id)
    DO UPDATE SET
      outline_details = EXCLUDED.outline_details,
      draft_words = EXCLUDED.draft_words,
      revised_words = EXCLUDED.revised_words,
      edits_count = EXCLUDED.edits_count,
      ai_calls = EXCLUDED.ai_calls,
      feedback_rounds = EXCLUDED.feedback_rounds,
      minutes_spent = EXCLUDED.minutes_spent,
      updated_at = NOW()
  `;

  return {
    outline_details,
    draft_words,
    revised_words,
    edits_count,
    ai_calls,
    feedback_rounds,
    minutes_spent,
  };
}
