import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CATEGORY_KEYS, type CategoryKey } from "./categories";
import type { ChatMessage } from "./chatdb";
import { parseScorePost } from "./parse";

export type PostStatus = "counted" | "duplicate" | "rejected";

export type BoardRow = {
  puzzle_no: number;
  rank: number;
  player_key: string;
  grade: string;
  overall: number;
  posted_at: string;
} & Record<CategoryKey, number>;

export type PlayerStatsRow = {
  player_key: string;
  games: number;
  wins: number;
  avg_overall: number;
  best_overall: number;
  worst_overall: number;
  grades: string; // JSON object: grade → count
} & Record<`${"avg" | "best" | "worst"}_${CategoryKey}`, number>;

export type CategoryLeaderRow = { category: CategoryKey; player_key: string; avg: number };

export type IngestResult = {
  messagesRead: number;
  counted: number;
  duplicate: number;
  rejected: { puzzle: number; playerKey: string; reason: string }[];
  changedPuzzles: number[];
  watermark: number;
};

const catCols = CATEGORY_KEYS.join(", ");

// Views are dropped and recreated on every open, so they always match this code.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS posts (
  message_rowid INTEGER PRIMARY KEY,
  message_guid  TEXT NOT NULL,
  puzzle_no     INTEGER NOT NULL,
  player_key    TEXT NOT NULL,
  posted_at     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('counted', 'duplicate', 'rejected')),
  reason        TEXT,
  grade         TEXT,
  overall       INTEGER,
  ${CATEGORY_KEYS.map((k) => `${k} INTEGER`).join(",\n  ")},
  joker         INTEGER -- 1 if the header had 🃏; NULL until known (rejected posts stay NULL)
);

-- First valid post per player per puzzle is the score of record.
CREATE UNIQUE INDEX IF NOT EXISTS one_counted_per_player
  ON posts (puzzle_no, player_key) WHERE status = 'counted';

DROP VIEW IF EXISTS category_leaders;
DROP VIEW IF EXISTS player_stats;
DROP VIEW IF EXISTS daily_board;
DROP VIEW IF EXISTS scores;

CREATE VIEW scores AS
  SELECT puzzle_no, player_key, posted_at, grade, overall, ${catCols}
    FROM posts WHERE status = 'counted';

CREATE VIEW daily_board AS
  SELECT puzzle_no,
         RANK() OVER (PARTITION BY puzzle_no ORDER BY overall DESC) AS rank,
         player_key, grade, overall, ${catCols}, posted_at
    FROM scores;

CREATE VIEW player_stats AS
  WITH wins AS (
    SELECT player_key, count(*) AS wins FROM daily_board WHERE rank = 1 GROUP BY player_key
  ),
  grades AS (
    SELECT player_key, json_group_object(grade, n) AS grades
      FROM (SELECT player_key, grade, count(*) AS n FROM scores GROUP BY player_key, grade)
     GROUP BY player_key
  )
  SELECT s.player_key,
         count(*) AS games,
         coalesce(w.wins, 0) AS wins,
         round(avg(s.overall), 1) AS avg_overall,
         max(s.overall) AS best_overall,
         min(s.overall) AS worst_overall,
         ${CATEGORY_KEYS.map(
           (k) => `round(avg(s.${k}), 1) AS avg_${k}, max(s.${k}) AS best_${k}, min(s.${k}) AS worst_${k}`,
         ).join(",\n         ")},
         g.grades
    FROM scores s
    LEFT JOIN wins w USING (player_key)
    LEFT JOIN grades g USING (player_key)
   GROUP BY s.player_key;

CREATE VIEW category_leaders AS
  WITH per AS (
    ${CATEGORY_KEYS.map(
      (k) => `SELECT '${k}' AS category, player_key, avg(${k}) AS avg FROM scores GROUP BY player_key`,
    ).join("\n    UNION ALL ")}
  )
  SELECT category, player_key, round(avg, 1) AS avg
    FROM (SELECT *, RANK() OVER (PARTITION BY category ORDER BY avg DESC) AS r FROM per)
   WHERE r = 1;
`;

export function openStore(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // Databases created before the joker flag existed get the column added; old rows
  // stay NULL until backfillJoker fills them from chat.db.
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(posts)").all();
  if (!cols.some((c) => c.name === "joker")) db.exec("ALTER TABLE posts ADD COLUMN joker INTEGER");
  return db;
}

export function getWatermark(db: Database): number {
  const row = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'watermark'").get();
  return row ? Number(row.value) : 0;
}

/**
 * Parse and store new chat messages in one transaction, then advance the
 * watermark. Re-ingesting a message already stored is a no-op.
 */
export function ingest(db: Database, messages: ChatMessage[], watermark: number): IngestResult {
  const result: IngestResult = {
    messagesRead: messages.length,
    counted: 0,
    duplicate: 0,
    rejected: [],
    changedPuzzles: [],
    watermark,
  };
  const changed = new Set<number>();

  const findCounted = db.query<{ message_rowid: number }, [number, string]>(
    "SELECT message_rowid FROM posts WHERE puzzle_no = ? AND player_key = ? AND status = 'counted'",
  );
  const insert = db.query(
    `INSERT OR IGNORE INTO posts
       (message_rowid, message_guid, puzzle_no, player_key, posted_at, status, reason, grade, overall, ${catCols}, joker)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${CATEGORY_KEYS.map(() => "?").join(", ")}, ?)`,
  );
  const setWatermark = db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('watermark', ?)");

  db.transaction(() => {
    for (const msg of messages) {
      result.watermark = Math.max(result.watermark, msg.rowid);
      const parsed = parseScorePost(msg.text);
      if (!parsed) continue;

      const playerKey = msg.isFromMe ? "me" : (msg.handle ?? "unknown");
      const base = [msg.rowid, msg.guid, parsed.puzzle, playerKey, msg.date.toISOString()] as const;

      if (parsed.kind === "rejected") {
        const r = insert.run(...base, "rejected", parsed.reason, null, null, ...CATEGORY_KEYS.map(() => null), null);
        if (r.changes) result.rejected.push({ puzzle: parsed.puzzle, playerKey, reason: parsed.reason });
        continue;
      }

      const existing = findCounted.get(parsed.puzzle, playerKey);
      const status: PostStatus = existing && existing.message_rowid !== msg.rowid ? "duplicate" : "counted";
      const reason = status === "duplicate" ? `first post was message ${existing!.message_rowid}` : null;
      const r = insert.run(
        ...base,
        status,
        reason,
        parsed.grade,
        parsed.overall,
        ...CATEGORY_KEYS.map((k) => parsed.scores[k]),
        parsed.joker ? 1 : 0,
      );
      if (!r.changes) continue;
      if (status === "counted") {
        result.counted++;
        changed.add(parsed.puzzle);
      } else {
        result.duplicate++;
      }
    }
    setWatermark.run(String(result.watermark));
  })();

  result.changedPuzzles = [...changed].sort((a, b) => a - b);
  return result;
}

export function getBoard(db: Database, puzzle: number): BoardRow[] {
  return db
    .query<BoardRow, [number]>("SELECT * FROM daily_board WHERE puzzle_no = ? ORDER BY rank, posted_at")
    .all(puzzle);
}

export function getPuzzles(db: Database): number[] {
  return db
    .query<{ puzzle_no: number }, []>("SELECT DISTINCT puzzle_no FROM scores ORDER BY puzzle_no DESC")
    .all()
    .map((r) => r.puzzle_no);
}

export function getPlayerStats(db: Database): PlayerStatsRow[] {
  return db
    .query<PlayerStatsRow, []>("SELECT * FROM player_stats ORDER BY avg_overall DESC")
    .all();
}

export function getCategoryLeaders(db: Database): CategoryLeaderRow[] {
  return db.query<CategoryLeaderRow, []>("SELECT * FROM category_leaders").all();
}

/** Rowids of stored score posts whose joker flag is not known yet. */
export function postsMissingJoker(db: Database): number[] {
  return db
    .query<{ message_rowid: number }, []>(
      "SELECT message_rowid FROM posts WHERE joker IS NULL AND status != 'rejected'",
    )
    .all()
    .map((r) => r.message_rowid);
}

/**
 * Fill in the joker flag for posts stored before it existed, from each
 * message's text (looked up by rowid; the text itself is never stored).
 * Returns how many posts were updated.
 */
export function backfillJoker(db: Database, messages: ChatMessage[]): number {
  const set = db.query("UPDATE posts SET joker = ? WHERE message_rowid = ? AND joker IS NULL");
  let updated = 0;
  db.transaction(() => {
    for (const msg of messages) {
      const parsed = parseScorePost(msg.text);
      if (parsed?.kind !== "score") continue;
      updated += set.run(parsed.joker ? 1 : 0, msg.rowid).changes;
    }
  })();
  return updated;
}

/** Puzzles where any post carried 🃏. */
export function getJokerPuzzles(db: Database): Set<number> {
  return new Set(
    db
      .query<{ puzzle_no: number }, []>("SELECT DISTINCT puzzle_no FROM posts WHERE joker = 1")
      .all()
      .map((r) => r.puzzle_no),
  );
}

export function getStatusCounts(db: Database): Record<PostStatus, number> {
  const counts: Record<PostStatus, number> = { counted: 0, duplicate: 0, rejected: 0 };
  for (const r of db
    .query<{ status: PostStatus; n: number }, []>("SELECT status, count(*) AS n FROM posts GROUP BY status")
    .all()) {
    counts[r.status] = r.n;
  }
  return counts;
}
