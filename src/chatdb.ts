import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CHAT_DB = join(homedir(), "Library", "Messages", "chat.db");

export type ChatMessage = {
  rowid: number;
  guid: string;
  date: Date;
  isFromMe: boolean;
  handle: string | null;
  text: string;
};

// Core Data epoch: 2001-01-01 UTC. message.date is nanoseconds since then.
const APPLE_EPOCH_MS = 978307200000;

// Adapted from the claude-plugins-official iMessage plugin
// (external_plugins/imessage/server.ts, parseAttributedBody), Apache-2.0,
// with the length prefix corrected (see below).
// Newer macOS stores text in attributedBody (typedstream NSAttributedString)
// when the plain `text` column is null. Extract the NSString payload.
export function parseAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  let i = buf.indexOf("NSString");
  if (i < 0) return null;
  i += "NSString".length;
  // Skip class metadata until the '+' (0x2B) marking the inline string payload.
  while (i < buf.length && buf[i] !== 0x2b) i++;
  if (i >= buf.length) return null;
  i++;
  // Typedstream integer: lengths under 0x80 are a literal byte; 0x81 escapes
  // to a 2-byte little-endian length and 0x82 to a 4-byte one. (The plugin
  // reads 0x81 as a 1-byte length, which leaves a NUL at the start of every
  // 128–255 byte message, so long score posts would fail to parse. Checked
  // against real chat.db rows: with 2 bytes, the text ends exactly at the
  // next typedstream marker.)
  let len: number;
  const b = buf[i++];
  if (b === 0x81) { len = buf.readUInt16LE(i); i += 2; }
  else if (b === 0x82) { len = buf.readUInt32LE(i); i += 4; }
  else if (b < 0x80) { len = b; }
  else return null;
  if (i + len > buf.length) return null;
  return buf.toString("utf8", i, i + len);
}

export class ChatDbAccessError extends Error {}

export function openChatDb(path = DEFAULT_CHAT_DB): Database {
  try {
    const db = new Database(path, { readonly: true });
    db.query("SELECT ROWID FROM message LIMIT 1").get();
    return db;
  } catch (err) {
    throw new ChatDbAccessError(
      `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n` +
        `Grant Full Disk Access to ${process.execPath} in System Settings → Privacy & Security → Full Disk Access.`,
    );
  }
}

type Row = {
  rowid: number;
  guid: string;
  text: string | null;
  attributedBody: Uint8Array | null;
  date: number;
  is_from_me: number;
  handle: string | null;
};

/** All messages in one chat with ROWID above the watermark, oldest first. */
export function readMessagesSince(db: Database, chatGuid: string, watermark: number): ChatMessage[] {
  const rows = db
    .query<Row, [string, number]>(
      `SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date, m.is_from_me, h.id AS handle
         FROM chat c
         JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
         JOIN message m ON m.ROWID = cmj.message_id
         LEFT JOIN handle h ON h.ROWID = m.handle_id
        WHERE c.guid = ? AND m.ROWID > ?
        ORDER BY m.date, m.ROWID`,
    )
    .all(chatGuid, watermark);

  return rows.map(toMessage);
}

/** Specific messages by ROWID (used to backfill flags on posts already stored). */
export function readMessagesByRowid(db: Database, rowids: number[]): ChatMessage[] {
  if (!rowids.length) return [];
  const query = db.query<Row, [number]>(
    `SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date, m.is_from_me, h.id AS handle
       FROM message m
       LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID = ?`,
  );
  return rowids.flatMap((id) => {
    const r = query.get(id);
    return r ? [toMessage(r)] : [];
  });
}

function toMessage(r: Row): ChatMessage {
  return {
    rowid: r.rowid,
    guid: r.guid,
    date: new Date(r.date / 1e6 + APPLE_EPOCH_MS),
    isFromMe: r.is_from_me === 1,
    handle: r.handle,
    text: r.text ?? parseAttributedBody(r.attributedBody) ?? "",
  };
}
