import { describe, expect, test } from "bun:test";
import { parseScorePost } from "../src/parse";

// Fixtures are real share texts from the group chat (no names or numbers).
describe("parseScorePost", () => {
  test("standard post", () => {
    expect(parseScorePost("Perceptle #118 - B (70)\n🔢 76  🎯 91  📐 98  🥁 77  ✂️ 6")).toEqual({
      kind: "score",
      puzzle: 118,
      grade: "B",
      overall: 70,
      scores: { numbers: 76, target: 91, ruler: 98, drum: 77, scissors: 6 },
      joker: false,
    });
  });

  test("extra emoji before the dash (🃏 days)", () => {
    const r = parseScorePost("Perceptle #105 🃏 - C (61)\n🔢 70  🎯 23  📐 98  🥁 14  ✂️ 99");
    expect(r).toMatchObject({ kind: "score", puzzle: 105, grade: "C", overall: 61, joker: true });
  });

  test("trailing chatter and blank lines are ignored", () => {
    const r = parseScorePost("Perceptle #108 - A (94)\n🔢 97  🎯 97  📐 90  🥁 88  ✂️ 96\n\nwait i ate today");
    expect(r).toMatchObject({ kind: "score", puzzle: 108, overall: 94 });
  });

  test("trailing newline", () => {
    const r = parseScorePost("Perceptle #107 - B (81)\n🔢 59  🎯 91  📐 81  🥁 73  ✂️ 100\n");
    expect(r).toMatchObject({ kind: "score", overall: 81, scores: { scissors: 100 } });
  });

  test("zero is a real score", () => {
    const r = parseScorePost("Perceptle #103 - C (67)\n🔢 89  🎯 92  📐 0  🥁 59  ✂️ 94");
    expect(r).toMatchObject({ kind: "score", scores: { ruler: 0 } });
  });

  test("scissors without the variation selector", () => {
    const r = parseScorePost("Perceptle #118 - B (70)\n🔢 76  🎯 91  📐 98  🥁 77  ✂ 6");
    expect(r).toMatchObject({ kind: "score", scores: { scissors: 6 } });
  });

  test("doctored post with a category deleted is rejected", () => {
    expect(parseScorePost("Perceptle #113 - B (93)\n🔢 97  🎯 82  📐 98  ✂️ 94")).toEqual({
      kind: "rejected",
      puzzle: 113,
      reason: "expected 5 categories, found 4",
    });
    expect(parseScorePost("Perceptle #115 - A (96)\n🔢 97  🎯 98  📐 96  ✂️ 91")).toMatchObject({
      kind: "rejected",
    });
  });

  test("overall that does not match the category average is rejected", () => {
    const r = parseScorePost("Perceptle #118 - A (99)\n🔢 76  🎯 91  📐 98  🥁 77  ✂️ 6");
    expect(r).toMatchObject({ kind: "rejected", puzzle: 118 });
  });

  test("tapbacks quoting a score are not posts", () => {
    expect(parseScorePost("Loved “Perceptle #109 - A (94)\n🔢 99  🎯 96  📐 100  🥁 83  ✂️ 94\n”")).toBeNull();
    expect(parseScorePost("Emphasized “Perceptle #118 - A (93)\n🔢 93  🎯 91  📐 91  🥁 94…”")).toBeNull();
    expect(parseScorePost("Reacted 🔥 to “Perceptle #113 - B (93)\n🔢 97  🎯 82  📐 98  ✂️ 94”")).toBeNull();
    expect(parseScorePost("Loved “Perceptle #105 🃏 - C (61)\n🔢 70  🎯 23  📐 98  🥁 14  ✂️ 99”")).toBeNull();
  });

  test("unrelated messages are not posts", () => {
    expect(parseScorePost("https://perceptle.com")).toBeNull();
    expect(parseScorePost("i think 94 is the record")).toBeNull();
    expect(parseScorePost("")).toBeNull();
  });
});
