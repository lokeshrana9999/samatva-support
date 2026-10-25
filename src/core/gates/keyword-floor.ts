// The deterministic risk floor. It runs first on every turn, needs no network,
// and its `imminent` reaches the handoff even when every later step fails.
import type { Tier } from "../types";

export type KeywordConfig = {
  exclusions: { id: string; pattern: string }[];
  patterns: {
    id: string;
    tier: "elevated" | "imminent";
    beingHarmed?: boolean;
    pattern: string;
  }[];
};

export type FloorResult = {
  tier: Tier | null;
  patternId: string | null;
  beingHarmed: boolean;
};

const RANK: Record<Tier, number> = { none: 0, elevated: 1, imminent: 2 };

export function maxTier(...tiers: (Tier | null)[]): Tier {
  return tiers.reduce<Tier>((a, t) => (t && RANK[t] > RANK[a] ? t : a), "none");
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

export function compileFloor(cfg: KeywordConfig) {
  const exclusions = cfg.exclusions.map((e) => new RegExp(e.pattern, "giu"));
  const patterns = cfg.patterns.map((p) => ({ ...p, re: new RegExp(p.pattern, "iu") }));

  return function keywordFloor(text: string): FloorResult {
    // Exclusions are blanked out first, so "this deadline is killing me" can't
    // trip a pattern while a real phrase elsewhere in the message still can.
    let t = normalise(text);
    for (const ex of exclusions) t = t.replace(ex, " ");

    let tier: Tier | null = null;
    let patternId: string | null = null;
    let beingHarmed = false;
    for (const p of patterns) {
      if (!p.re.test(t)) continue;
      if (p.beingHarmed) beingHarmed = true;
      if (tier === null || RANK[p.tier] > RANK[tier]) {
        tier = p.tier;
        patternId = p.id;
      }
    }
    return { tier, patternId, beingHarmed };
  };
}
