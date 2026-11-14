// CASE STUDY ONLY: nothing under src/ may import this folder (lint rule in
// eslint.config.mjs; scripts/check-bundle.mjs fails the build if a sample
// name reaches the bundle). Write-up: docs/case-studies/therapist-matching.md.
//
// The therapist matching as it ran in the app until 2026-11-14: 14 synthetic
// profiles, a typed filter over them, and the card each one rendered as. It
// was the `searchTherapists` method of the JSON catalogue adapter, behind the
// `search_therapists` tool the recommend stage offered the model.
import { z } from "zod";
import { allowlisted } from "@/adapters/catalogue/json";
import { City, ConcernArea, Language } from "@/core/needs";
import therapistsJson from "./therapists.json";

export const THERAPIST_HELP_TYPES = ["therapist", "psychiatrist", "couples_therapist"] as const;
export type TherapistHelpType = (typeof THERAPIST_HELP_TYPES)[number];

const Therapist = z.strictObject({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  languages: z.array(Language).min(1),
  specialties: z.array(z.string()).min(1),
  modes: z.array(z.enum(["online", "in_person"])).min(1),
  cities: z.array(City),
  helpTypes: z.array(z.enum(THERAPIST_HELP_TYPES)).length(1),
  concernAreas: z.array(ConcernArea).min(1),
});
type Therapist = z.infer<typeof Therapist>;

export const therapists = z.strictObject({ note: z.string(), therapists: z.array(Therapist) }).parse(therapistsJson).therapists;

// The arguments the model could pass to `search_therapists`, after the core
// had checked `helpType` against what the rules picked that turn.
export type TherapistQuery = {
  helpType: TherapistHelpType;
  concerns: ConcernArea[];
  language?: string;
  mode?: "online" | "in_person";
  city?: string;
  limit: number;
};

// The card a profile rendered as: catalogue fields only, never model text.
export type TherapistCard = {
  id: string;
  kind: "therapist";
  name: string;
  title: string;
  languages: string[];
  specialties: string[];
  modes: string[];
  cities: string[];
  url: string;
  sample: true;
};

// A sample therapist can't be booked, so the card linked to a free public
// service (Tele-MANAS) that can connect someone with real help of that kind.
export const HELP_URL: Record<TherapistHelpType, string> = {
  therapist: "https://telemanas.mohfw.gov.in/home",
  psychiatrist: "https://telemanas.mohfw.gov.in/home",
  couples_therapist: "https://telemanas.mohfw.gov.in/home",
};
if (!Object.values(HELP_URL).every(allowlisted)) throw new Error("HELP_URL must use allowlisted origins");

const LANGUAGE_LABEL = (l: string) => l[0].toUpperCase() + l.slice(1);
const CITY_LABEL: Record<string, string> = { bengaluru: "Bengaluru", mumbai: "Mumbai", new_delhi: "New Delhi", gurugram: "Gurugram" };
const MODE_LABEL: Record<string, string> = { online: "Online", in_person: "In person" };

function therapistCard(t: Therapist): TherapistCard {
  return {
    id: t.id,
    kind: "therapist",
    name: t.name,
    title: t.title,
    languages: t.languages.map(LANGUAGE_LABEL),
    specialties: t.specialties,
    modes: t.modes.map((m) => MODE_LABEL[m]),
    cities: t.cities.map((c) => CITY_LABEL[c] ?? c),
    url: HELP_URL[t.helpTypes[0]],
    sample: true,
  };
}

// Hard filters on help type, mode and (in person) city; a soft filter on
// language; then rank by how many of the person's concerns a profile covers.
export function matchTherapists(q: TherapistQuery): TherapistCard[] {
  let rows = therapists.filter((t) => t.helpTypes.includes(q.helpType));
  if (q.mode) rows = rows.filter((t) => t.modes.includes(q.mode!));
  if (q.mode === "in_person" && q.city) rows = rows.filter((t) => t.cities.includes(q.city as never));
  // A language preference narrows only when someone matches it, so a rare
  // language never leaves the person with no options.
  if (q.language && q.language !== "english") {
    const speaking = rows.filter((t) => t.languages.includes(q.language as never));
    if (speaking.length) rows = speaking;
  }
  const overlap = (t: Therapist) => t.concernAreas.filter((c) => q.concerns.includes(c)).length;
  return rows
    .sort((a, b) => overlap(b) - overlap(a) || a.id.localeCompare(b.id))
    .slice(0, q.limit)
    .map(therapistCard);
}
