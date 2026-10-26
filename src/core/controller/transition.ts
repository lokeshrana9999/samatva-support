// When an understand turn moves on to recommend (design, the controller). A
// pure function over the needs record, so every rule has a unit test.
import { EMPTY_NEEDS, enough, type NeedsRecord } from "../needs";

export type UnderstandStep = "understand" | "recommend" | "not_enough";

export type TransitionThresholds = {
  needsP: number;
  prefTurns: number;
  understandMaxTurns: number;
  talkOnlyMaxTurns: number;
};

// - Re-entry from close always asks about the new problem first.
// - "Just give me suggestions" with one clear concern recommends now.
// - "I only want to talk" holds off until the raised talk-only cap.
// - Otherwise `enough()` recommends, and the cap recommends regardless; at the
//   cap without enough it's `not_enough` (general help only).
// - A turn whose needs call failed gets one extra turn before the cap.
export function understandStep(
  record: NeedsRecord | null,
  understandTurns: number,
  o: { reentered: boolean; needsFailed: boolean },
  t: TransitionThresholds,
): UnderstandStep {
  if (o.reentered) return "understand";
  const n = record ?? EMPTY_NEEDS;
  const concern = n.concerns.some((c) => c.p >= t.needsP);
  if ((n.wantsNow ?? 0) >= t.needsP && concern) return "recommend";
  const talkOnly = (n.talkOnly ?? 0) >= t.needsP;
  const isEnough = enough(n, t, understandTurns);
  if (isEnough && !talkOnly) return "recommend";
  const cap = (talkOnly ? t.talkOnlyMaxTurns : t.understandMaxTurns) + (o.needsFailed ? 1 : 0);
  if (understandTurns < cap) return "understand";
  return isEnough ? "recommend" : "not_enough";
}
