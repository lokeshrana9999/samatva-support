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

export type NeedsRecord = {
  concerns: { area: ConcernArea; p: number }[];
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

// "Enough" is a rule in code over Jev's probabilities, not a question to Jev
// (design D24).
export function enough(n: NeedsRecord, minP: number): boolean {
  const known = (f: Field) => f.value !== "unknown" && f.p >= minP;
  return n.concerns.some((c) => c.p >= minP) && known(n.duration) && known(n.impact);
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

// Every rule whose `when` matches adds its help types (fields AND, values
// inside a field OR); the union is capped at 3 with crisis_line first.
export function helpTypesFor(rules: HelpRule[], n: NeedsRecord, risk: Tier): HelpType[] {
  const out = new Set<HelpType>();
  for (const r of rules) {
    const w = r.when;
    const ok =
      (!w.risk || w.risk.includes(risk)) &&
      (!w.concerns || n.concerns.some((c) => w.concerns!.includes(c.area))) &&
      (!w.duration || w.duration.includes(n.duration.value as never)) &&
      (!w.impact || w.impact.includes(n.impact.value as never)) &&
      (!w.urgency || w.urgency.includes(n.urgency.value as never)) &&
      (!w.forWhom || w.forWhom.includes(n.forWhom.value as never));
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
