// The needs record and the rules table (design, the controller). Every field
// is an enum plus a probability, so the record holds no free text.
import { z } from "zod";
import type { Tier } from "./types";

export const CONCERN_AREAS = [
  "stress_anxiety",
  "low_mood",
  "relationships",
  "family",
  "work_study",
  "sleep",
  "grief_loss",
  "trauma",
  "substance_use",
  "eating_body",
  "identity_sexuality",
  "anger",
  "other",
] as const;
export const LANGUAGES = [
  "english",
  "hindi",
  "tamil",
  "telugu",
  "kannada",
  "malayalam",
  "marathi",
  "bengali",
  "gujarati",
  "punjabi",
  "other",
] as const;
export const CITIES = ["bengaluru", "mumbai", "new_delhi", "gurugram", "other"] as const;
export const HELP_TYPES = ["self_care", "therapist", "psychiatrist", "couples_therapist", "crisis_line"] as const;

export const ConcernArea = z.enum(CONCERN_AREAS);
export const Language = z.enum(LANGUAGES);
export const City = z.enum(CITIES);
export const HelpType = z.enum(HELP_TYPES);
export type ConcernArea = z.infer<typeof ConcernArea>;
export type HelpType = z.infer<typeof HelpType>;

export const FIELD_VALUES = {
  duration: ["under_2_weeks", "2_weeks_to_3_months", "over_3_months"],
  impact: ["little", "some", "severe"],
  urgency: ["can_wait", "soon", "now"],
  forWhom: ["self", "with_partner"],
  language: LANGUAGES,
  mode: ["online", "in_person", "either"],
  city: CITIES,
} as const;
export type FieldName = keyof typeof FIELD_VALUES;

export type Field<V extends string = string> = { value: V | "unknown"; p: number };

// `wantsNow` and `talkOnly` are Jev's Noul probabilities for what the person
// asked for (wants suggestions now, wants only to talk); `impactAffected` is
// Jev's p(some) + p(severe) for impact. Optional because records stored
// before they existed lack them.
export type NeedsRecord = {
  concerns: { area: ConcernArea; p: number }[];
  wantsNow?: number;
  talkOnly?: number;
  impactAffected?: number;
} & { [K in FieldName]: Field<(typeof FIELD_VALUES)[K][number]> };

export const EMPTY_NEEDS: NeedsRecord = {
  concerns: [],
  duration: { value: "unknown", p: 0 },
  impact: { value: "unknown", p: 0 },
  urgency: { value: "unknown", p: 0 },
  forWhom: { value: "unknown", p: 0 },
  language: { value: "unknown", p: 0 },
  mode: { value: "unknown", p: 0 },
  city: { value: "unknown", p: 0 },
};

export const PREF_FIELDS = ["language", "mode", "city"] as const;

// A field counts only at `p >= minP`; below that it reads as unknown.
export function known(f: Field, minP: number): boolean {
  return f.value !== "unknown" && f.p >= minP;
}

// Impact is ordinal, and Jev can split "affected" between some and severe so
// that neither reaches `minP` alone. Then it reads as `some` when the pair
// does.
export function impactValue(n: NeedsRecord, minP: number): Field["value"] {
  if (known(n.impact, minP)) return n.impact.value;
  const affected = n.impact.value === "some" || n.impact.value === "severe";
  return affected && (n.impactAffected ?? 0) >= minP ? "some" : "unknown";
}

// "Enough" is a rule in code over Jev's probabilities, not a question to Jev
// (design D24): a concern, a duration and an impact, plus a preference
// (language or mode) or `prefTurns` understand turns, so cards aren't
// filtered by preferences nobody was asked for.
export function enough(n: NeedsRecord, t: { needsP: number; prefTurns: number }, understandTurns: number): boolean {
  const k = (f: Field) => known(f, t.needsP);
  const difficulty = n.concerns.some((c) => c.p >= t.needsP) && k(n.duration) && impactValue(n, t.needsP) !== "unknown";
  return difficulty && (k(n.language) || k(n.mode) || understandTurns >= t.prefTurns);
}

// The difficulty is clear but no preference is known yet: the understand
// prompt asks for them now.
export function needsPrefs(n: NeedsRecord, minP: number): boolean {
  const k = (f: Field) => known(f, minP);
  return n.concerns.some((c) => c.p >= minP) && k(n.duration) && impactValue(n, minP) !== "unknown" && !k(n.language) && !k(n.mode);
}

// Folds a fresh record from Jev into the stored one. Preferences carry over
// when the fresh record doesn't state them (understand reads only the turns
// since it began), and talk-only stays until they ask for suggestions.
export function mergeNeeds(prev: NeedsRecord | null, next: NeedsRecord, minP: number): NeedsRecord {
  if (!prev) return next;
  const out: NeedsRecord = { ...next };
  for (const f of PREF_FIELDS) if (!known(next[f], minP) && known(prev[f], minP)) out[f] = prev[f] as never;
  out.talkOnly = (next.wantsNow ?? 0) >= minP ? (next.talkOnly ?? 0) : Math.max(prev.talkOnly ?? 0, next.talkOnly ?? 0);
  return out;
}

// Concerns in `next` at `p >= minP` that `prev` doesn't hold. "other" is too
// vague to count as a new problem.
export function newConcerns(prev: NeedsRecord | null, next: NeedsRecord, minP: number): NeedsRecord["concerns"] {
  const had = new Set((prev?.concerns ?? []).map((c) => c.area));
  return next.concerns.filter((c) => c.p >= minP && c.area !== "other" && !had.has(c.area));
}

export const HelpRule = z.strictObject({
  id: z.string(),
  when: z.strictObject({
    risk: z.array(z.enum(["none", "elevated", "imminent"])).optional(),
    concerns: z.array(ConcernArea).optional(),
    duration: z.array(z.enum(FIELD_VALUES.duration)).optional(),
    impact: z.array(z.enum(FIELD_VALUES.impact)).optional(),
    urgency: z.array(z.enum(FIELD_VALUES.urgency)).optional(),
    forWhom: z.array(z.enum(FIELD_VALUES.forWhom)).optional(),
  }),
  add: z.array(HelpType).min(1),
});
export type HelpRule = z.infer<typeof HelpRule>;

// The record as the rules see it: fields below `needsP` read as unknown and
// concerns below it drop out. `impact: severe` needs the higher `severeP`;
// below that it reads as `some`, since Jev still says daily life is affected.
function asRulesSee(n: NeedsRecord, t: { needsP: number; severeP: number }) {
  const v = (f: Field) => (known(f, t.needsP) ? f.value : "unknown");
  const read = impactValue(n, t.needsP);
  const impact = read === "severe" && n.impact.p < t.severeP ? "some" : read;
  return {
    concerns: n.concerns.filter((c) => c.p >= t.needsP).map((c) => c.area),
    duration: v(n.duration),
    impact,
    urgency: v(n.urgency),
    forWhom: v(n.forWhom),
  };
}

// Every rule whose `when` matches adds its help types (fields AND, values
// inside a field OR); the union is capped at 3 with crisis_line first.
export function helpTypesFor(rules: HelpRule[], record: NeedsRecord, risk: Tier, t: { needsP: number; severeP: number }): HelpType[] {
  const n = asRulesSee(record, t);
  const out = new Set<HelpType>();
  for (const r of rules) {
    const w = r.when;
    const ok =
      (!w.risk || w.risk.includes(risk)) &&
      (!w.concerns || n.concerns.some((c) => w.concerns!.includes(c))) &&
      (!w.duration || w.duration.includes(n.duration as never)) &&
      (!w.impact || w.impact.includes(n.impact as never)) &&
      (!w.urgency || w.urgency.includes(n.urgency as never)) &&
      (!w.forWhom || w.forWhom.includes(n.forWhom as never));
    if (ok) for (const h of r.add) out.add(h);
  }
  const list = [...out];
  list.sort((a, b) => (a === "crisis_line" ? -1 : b === "crisis_line" ? 1 : 0));
  return list.slice(0, 3);
}

export const HELP_TYPE_LABEL: Record<HelpType, string> = {
  crisis_line: "A crisis line, now",
  psychiatrist: "A psychiatrist",
  therapist: "A therapist",
  couples_therapist: "Couples therapy",
  self_care: "Self-care tools",
};
