import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@config";
import { filterReply, genderedFirstPerson } from "@/core/gates/output-filter";
import stockLines from "../config/stock-lines.json";

type Leaf = { key: string; lang: string; text: string };

// Every { "en-IN": ..., "hi-Latn": ... } pair in stock-lines.json, flattened.
function leaves(node: unknown, key = ""): Leaf[] {
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === "string" ? [{ key, lang: k, text: v }] : leaves(v, key ? `${key}.${k}` : k),
  );
}

const lines = leaves(stockLines);

// Retention hooks: the app never invites anyone back (spec, fixed copy).
const COME_BACK =
  /\b(?:come back|see you|talk (?:to you )?(?:soon|later|tomorrow)|check back|return tomorrow)\b|\bkal phir\b|\bphir (?:milte|aana|aaiye|aayiye)\b|\bwapas aa/iu;

const COMPONENTS = ["chat-app.tsx", "crisis.tsx", "cards.tsx", "shell.tsx"].map((f) =>
  readFileSync(path.resolve(__dirname, "../src/components", f), "utf8"),
);

describe("fixed copy", () => {
  it("has both languages for every stock line", () => {
    const keys = new Set(lines.map((l) => l.key));
    for (const key of keys) {
      expect(lines.filter((l) => l.key === key).map((l) => l.lang).sort(), key).toEqual(["en-IN", "hi-Latn"]);
    }
  });

  it.each(lines.filter((l) => l.lang === "hi-Latn"))("$key (hi-Latn) gives the assistant no gender", ({ text }) => {
    expect(genderedFirstPerson(text)).toBe(false);
  });

  it.each(lines)("$key ($lang) has no link and passes the output filter", ({ text }) => {
    const r = filterReply({ reply: text, lengthCap: 400, allowedUrls: new Set(), knownNames: new Set() });
    expect(r.violation).toBeNull();
  });

  it.each(lines)("$key ($lang) invites no one back", ({ text }) => {
    expect(text).not.toMatch(COME_BACK);
  });

  it("invites no one back in the component copy", () => {
    for (const src of COMPONENTS) expect(src).not.toMatch(COME_BACK);
  });

  it("states the caps the limiter enforces", () => {
    const l = stockLines.limits;
    const caps: [Record<string, string>, number][] = [
      [l.conversation_turns, config.limits.conversationTurns],
      [l.daily_conversations, config.limits.conversationsPerDay],
      [l.hourly_turns, config.limits.turnsPerHour],
    ];
    for (const [pair, cap] of caps) {
      for (const text of Object.values(pair)) expect(text).toContain(` ${cap} `);
    }
  });
});
