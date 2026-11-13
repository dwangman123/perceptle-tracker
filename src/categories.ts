// The five Perceptle categories, in the order the share text lists them.
// Keys name the emoji itself (not a guess at what the round tests), so they
// stay correct whatever the game calls them. Display labels live in config.
export const CATEGORIES = [
  { key: "numbers", emoji: "🔢" },
  { key: "target", emoji: "🎯" },
  { key: "ruler", emoji: "📐" },
  { key: "drum", emoji: "🥁" },
  { key: "scissors", emoji: "✂️" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type CategoryScores = Record<CategoryKey, number>;

export const CATEGORY_KEYS: CategoryKey[] = CATEGORIES.map((c) => c.key);

// Share text sometimes drops the U+FE0F variation selector (✂ vs ✂️).
const stripVS = (s: string) => s.replace(/️/g, "");

export function categoryForEmoji(emoji: string): CategoryKey | undefined {
  const bare = stripVS(emoji);
  return CATEGORIES.find((c) => stripVS(c.emoji) === bare)?.key;
}
