import { describe, expect, test } from "bun:test";
import { parseAttributedBody } from "../src/chatdb";
import { parseScorePost } from "../src/parse";

// Minimal typedstream-shaped blob: class name, filler, '+', length prefix,
// UTF-8 payload, then the 0x86 0x84 markers that follow the string in chat.db.
function blob(text: string): Uint8Array {
  const payload = Buffer.from(text, "utf8");
  let prefix: Buffer;
  if (payload.length < 0x80) prefix = Buffer.from([payload.length]);
  else {
    prefix = Buffer.alloc(3);
    prefix[0] = 0x81;
    prefix.writeUInt16LE(payload.length, 1);
  }
  return Buffer.concat([
    Buffer.from("streamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01", "latin1"),
    Buffer.from("+"),
    prefix,
    payload,
    Buffer.from([0x86, 0x84]),
  ]);
}

describe("parseAttributedBody", () => {
  test("short message (literal 1-byte length)", () => {
    const text = "Perceptle #118 - B (70)\n🔢 76  🎯 91  📐 98  🥁 77  ✂️ 6";
    expect(parseAttributedBody(blob(text))).toBe(text);
  });

  test("message of 128+ bytes (0x81 + 2-byte length) decodes intact and still parses", () => {
    const text =
      "Perceptle #115 - B (81)\n🔢 97  🎯 98  📐 96  🥁 25  ✂️ 91\n\n" +
      "NOOOOOOOOO the drum round got me again, I swear the beat changes halfway through every single time";
    expect(Buffer.byteLength(text)).toBeGreaterThan(128);
    const decoded = parseAttributedBody(blob(text));
    expect(decoded).toBe(text);
    expect(parseScorePost(decoded!)).toMatchObject({ kind: "score", puzzle: 115, overall: 81 });
  });

  test("message over 255 bytes", () => {
    const text = "x".repeat(300);
    expect(parseAttributedBody(blob(text))).toBe(text);
  });

  test("null and garbage", () => {
    expect(parseAttributedBody(null)).toBeNull();
    expect(parseAttributedBody(Buffer.from("no string here"))).toBeNull();
  });
});
