import { CATEGORY_KEYS, categoryForEmoji, type CategoryScores } from "./categories";

export type ScorePost = {
  kind: "score";
  puzzle: number;
  grade: string;
  overall: number;
  scores: CategoryScores;
  /** The header carried 🃏 (a joker puzzle). */
  joker: boolean;
};

export type RejectedPost = { kind: "rejected"; puzzle: number; reason: string };

// Header: "Perceptle #118 - B (70)" or "Perceptle #105 🃏 - C (61)".
// Anchored at the start so tapbacks ("Loved “Perceptle #…”",
// "Reacted 🔥 to “Perceptle #…”") never match, whatever their message type.
const HEADER = /^Perceptle #(\d+)\b([^\n]*?)\s-\s([A-Z][+-]?)\s\((\d+)\)/u;
const CATEGORY = /(🔢|🎯|📐|🥁|✂️?)\s*(\d+)/gu;

/**
 * Parse one message. Returns null when it is not a Perceptle share at all,
 * a RejectedPost when it looks like one but fails validation (e.g. a doctored
 * post with a category deleted), or the parsed ScorePost.
 */
export function parseScorePost(raw: string): ScorePost | RejectedPost | null {
  const text = raw.trim();
  const header = HEADER.exec(text);
  if (!header) return null;

  const puzzle = Number(header[1]);
  const joker = header[2].includes("🃏");
  const grade = header[3];
  const overall = Number(header[4]);
  const reject = (reason: string): RejectedPost => ({ kind: "rejected", puzzle, reason });

  // Scores sit on the first non-empty line after the header; anything after
  // that is chatter ("NOOOOOOOOO") and is ignored.
  const lines = text.split("\n");
  const scoreLine = lines.slice(1).find((l) => l.trim() !== "") ?? "";

  const scores: Partial<CategoryScores> = {};
  let found = 0;
  for (const m of scoreLine.matchAll(CATEGORY)) {
    const key = categoryForEmoji(m[1]);
    if (!key) continue;
    if (key in scores) return reject(`category ${m[1]} appears twice`);
    const value = Number(m[2]);
    if (value > 100) return reject(`category ${m[1]} score ${value} is over 100`);
    scores[key] = value;
    found++;
  }

  if (found !== CATEGORY_KEYS.length) {
    return reject(`expected ${CATEGORY_KEYS.length} categories, found ${found}`);
  }

  const values = CATEGORY_KEYS.map((k) => scores[k]!);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (Math.round(mean) !== overall) {
    return reject(`overall ${overall} does not match category average ${mean}`);
  }

  return { kind: "score", puzzle, grade, overall, scores: scores as CategoryScores, joker };
}
