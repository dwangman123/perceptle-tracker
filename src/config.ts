import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, type CategoryKey } from "./categories";

export type Config = {
  chatGuid: string;
  /** handle (phone/email) or "me" → display name */
  players: Record<string, string>;
  /** a known puzzle number and its Pacific date, used to date every puzzle */
  puzzleAnchor: { number: number; date: string };
  categoryLabels: Partial<Record<CategoryKey, string>>;
  chatDbPath?: string;
};

export function loadConfig(home: string): Config {
  const path = join(home, "config.json");
  let cfg: Config;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`cannot load ${path} (copy config.example.json): ${err instanceof Error ? err.message : err}`);
  }
  if (!cfg.chatGuid || !cfg.players || !cfg.puzzleAnchor?.date) {
    throw new Error(`${path} needs chatGuid, players and puzzleAnchor`);
  }
  cfg.categoryLabels ??= {};
  return cfg;
}

/** Display name for a player key; unknown senders show only their last 4 digits/chars. */
export function playerName(cfg: Config, key: string): string {
  return cfg.players[key] ?? `Unknown ••••${key.slice(-4)}`;
}

export function categoryLabel(cfg: Config, key: CategoryKey): string {
  return cfg.categoryLabels[key] ?? CATEGORIES.find((c) => c.key === key)!.emoji;
}

/** Puzzle N's date (YYYY-MM-DD), counting days from the anchor puzzle. */
export function puzzleDate(cfg: Config, puzzle: number): string {
  const anchor = new Date(`${cfg.puzzleAnchor.date}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + (puzzle - cfg.puzzleAnchor.number));
  return anchor.toISOString().slice(0, 10);
}
