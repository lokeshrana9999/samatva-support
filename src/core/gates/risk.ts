// The risk gate: the keyword floor, Jev's probabilities with thresholds
// applied here in code (D23), and the session's sticky floor. The stricter
// reading wins. A Jev error counts as `elevated` (spec 4b).
import type { DecisionModel, Usage } from "../ports";
import type { Tier } from "../types";
import { maxTier, type FloorResult } from "./keyword-floor";

export type RiskThresholds = {
  imminentP: number;
  elevatedP: number;
  harmNoulP: number;
  beingHarmedNoulP: number;
};

export type RiskResult = {
  tier: Tier;
  floor: FloorResult;
  jev: { tier: Tier; score: number; p: Record<Tier, number>; model: string } | "error";
  beingHarmed: boolean;
  usage: Usage;
};

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, usd: 0 };

export function jevTier(
  r: { p: Record<Tier, number>; selfHarm: number; harmToOthers: number },
  t: RiskThresholds,
): Tier {
  if (r.p.imminent >= t.imminentP) return "imminent";
  if (r.p.elevated + r.p.imminent >= t.elevatedP) return "elevated";
  if (r.selfHarm >= t.harmNoulP || r.harmToOthers >= t.harmNoulP) return "elevated";
  return "none";
}

export async function assessRisk(args: {
  decision: DecisionModel;
  userTurns: string[];
  floor: FloorResult;
  sticky: Tier;
  thresholds: RiskThresholds;
  signal: AbortSignal;
}): Promise<RiskResult> {
  const { floor, thresholds: t } = args;
  try {
    const r = await args.decision.assessRisk(args.userTurns, args.signal);
    const tier = jevTier(r, t);
    return {
      tier: maxTier(floor.tier, tier, args.sticky),
      floor,
      jev: { tier, score: r.p.elevated + r.p.imminent, p: r.p, model: r.model },
      beingHarmed: floor.beingHarmed || r.beingHarmed >= t.beingHarmedNoulP,
      usage: r.usage,
    };
  } catch {
    return {
      tier: maxTier(floor.tier, "elevated", args.sticky),
      floor,
      jev: "error",
      beingHarmed: floor.beingHarmed,
      usage: ZERO,
    };
  }
}
