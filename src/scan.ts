import type { Database } from "bun:sqlite";
import { renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CATEGORIES, CATEGORY_KEYS } from "./categories";
import { ChatDbAccessError, DEFAULT_CHAT_DB, openChatDb, readMessagesByRowid, readMessagesSince } from "./chatdb";
import { categoryLabel, loadConfig, playerName, puzzleDate, type Config } from "./config";
import {
  backfillJoker,
  getBoard,
  getCategoryLeaders,
  getJokerPuzzles,
  getPlayerStats,
  getPuzzles,
  getStatusCounts,
  getWatermark,
  ingest,
  openStore,
  postsMissingJoker,
} from "./store";

const BOARDS_PRINTED_PER_SCAN = 3;

function parseArgs(argv: string[]) {
  let home = process.cwd();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--home") home = argv[++i];
    else rest.push(argv[i]);
  }
  const [command = "scan", ...args] = rest;
  return { home: resolve(home), command, args };
}

const catHeader = (cfg: Config) =>
  CATEGORIES.map((c) => categoryLabel(cfg, c.key)).join(" / ");

function formatBoard(db: Database, cfg: Config, puzzle: number): string {
  const rows = getBoard(db, puzzle);
  const lines = [`Perceptle #${puzzle} (${puzzleDate(cfg, puzzle)}): ${rows.length} player${rows.length === 1 ? "" : "s"}`];
  for (const r of rows) {
    const cats = CATEGORIES.map((c) => `${c.emoji} ${String(r[c.key]).padStart(3)}`).join("  ");
    lines.push(`  ${String(r.rank).padStart(2)}. ${playerName(cfg, r.player_key).padEnd(10)} ${r.grade} ${String(r.overall).padStart(3)}  |  ${cats}`);
  }
  return lines.join("\n");
}

function formatStats(db: Database, cfg: Config): string {
  const lines = [`Player averages: overall, then ${catHeader(cfg)}`];
  for (const s of getPlayerStats(db)) {
    const cats = CATEGORIES.map((c) => `${c.emoji} ${s[`avg_${c.key}`].toFixed(1).padStart(5)}`).join("  ");
    lines.push(
      `  ${playerName(cfg, s.player_key).padEnd(10)} ${String(s.games).padStart(3)} games  ${String(s.wins).padStart(2)} wins  avg ${s.avg_overall.toFixed(1).padStart(5)} (best ${s.best_overall}, worst ${s.worst_overall})  |  ${cats}`,
    );
  }
  const leaders = getCategoryLeaders(db);
  const byCat = CATEGORY_KEYS.map((k) => {
    const top = leaders.filter((l) => l.category === k);
    if (!top.length) return null;
    return `${categoryLabel(cfg, k)} ${top.map((l) => playerName(cfg, l.player_key)).join(" & ")} (${top[0].avg.toFixed(1)})`;
  }).filter(Boolean);
  lines.push(`Category leaders: ${byCat.join(", ")}`);
  return lines.join("\n");
}

/** Names only, no phone numbers: this file is what a shared page would read. */
function writeExport(db: Database, cfg: Config, home: string) {
  const name = (key: string) => playerName(cfg, key);
  const jokers = getJokerPuzzles(db);
  const data = {
    generatedAt: new Date().toISOString(),
    categories: CATEGORIES.map((c) => ({ key: c.key, emoji: c.emoji, label: categoryLabel(cfg, c.key) })),
    puzzles: getPuzzles(db).map((n) => ({
      number: n,
      date: puzzleDate(cfg, n),
      joker: jokers.has(n),
      board: getBoard(db, n).map((r) => ({
        rank: r.rank,
        player: name(r.player_key),
        grade: r.grade,
        overall: r.overall,
        scores: Object.fromEntries(CATEGORY_KEYS.map((k) => [k, r[k]])),
      })),
    })),
    players: getPlayerStats(db).map((s) => ({
      player: name(s.player_key),
      games: s.games,
      wins: s.wins,
      grades: JSON.parse(s.grades ?? "{}"),
      overall: { avg: s.avg_overall, best: s.best_overall, worst: s.worst_overall },
      categories: Object.fromEntries(
        CATEGORY_KEYS.map((k) => [k, { avg: s[`avg_${k}`], best: s[`best_${k}`], worst: s[`worst_${k}`] }]),
      ),
    })),
    categoryLeaders: CATEGORY_KEYS.map((k) => {
      const top = getCategoryLeaders(db).filter((l) => l.category === k);
      return { category: k, players: top.map((l) => name(l.player_key)), avg: top[0]?.avg ?? null };
    }),
  };
  const path = join(home, "data", "export.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
  return path;
}

function scan(db: Database, cfg: Config, home: string) {
  const chat = openChatDb(cfg.chatDbPath ?? DEFAULT_CHAT_DB);
  const before = getWatermark(db);
  const messages = readMessagesSince(chat, cfg.chatGuid, before);
  // Posts stored before the joker flag existed: re-read them once to fill it in.
  const backfilled = backfillJoker(db, readMessagesByRowid(chat, postsMissingJoker(db)));
  chat.close();
  if (backfilled) console.log(`filled in the 🃏 flag on ${backfilled} earlier posts`);

  const r = ingest(db, messages, before);
  const totals = getStatusCounts(db);
  console.log(
    `[${new Date().toLocaleString()}] read ${r.messagesRead} new messages: ` +
      `${r.counted} scores counted, ${r.duplicate} duplicates, ${r.rejected.length} rejected ` +
      `(all time: ${totals.counted} counted, ${totals.duplicate} duplicates, ${totals.rejected} rejected)`,
  );
  for (const x of r.rejected) {
    console.log(`  rejected #${x.puzzle} from ${playerName(cfg, x.playerKey)}: ${x.reason}`);
  }
  for (const key of new Set(messages.filter((m) => !m.isFromMe && m.handle).map((m) => m.handle!))) {
    if (!(key in cfg.players)) console.log(`  note: unknown sender ••••${key.slice(-4)}; add them to config.json players`);
  }

  if (r.changedPuzzles.length) {
    const shown = r.changedPuzzles.slice(-BOARDS_PRINTED_PER_SCAN).reverse();
    for (const p of shown) console.log("\n" + formatBoard(db, cfg, p));
    const hidden = r.changedPuzzles.length - shown.length;
    if (hidden > 0) console.log(`\n(${hidden} earlier puzzle${hidden === 1 ? "" : "s"} also updated; see \`board <N>\`)`);
    console.log("\n" + formatStats(db, cfg));
  }
  console.log(`\nexport: ${writeExport(db, cfg, home)}`);
}

function main() {
  const { home, command, args } = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(home);
  const db = openStore(join(home, "data", "perceptle.db"));
  try {
    if (command === "scan") scan(db, cfg, home);
    else if (command === "stats") console.log(formatStats(db, cfg));
    else if (command === "board") {
      const puzzle = args[0] ? Number(args[0]) : getPuzzles(db)[0];
      if (puzzle === undefined) console.log("no scores yet; run scan first");
      else console.log(formatBoard(db, cfg, puzzle));
    } else {
      console.error(`unknown command "${command}" (use scan, stats, or board [N])`);
      process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof ChatDbAccessError) {
      console.error(`[${new Date().toLocaleString()}] ${err.message}`);
      process.exitCode = 1;
    } else throw err;
  } finally {
    db.close();
  }
}

main();
