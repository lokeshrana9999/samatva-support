// Catalogue over the repo's JSON files (design D38: the repo JSON is the
// source of truth). Tens of rows, so a typed filter is the honest search;
// embeddings would be for show. Amaha's real directory would be another
// adapter behind the same port.
import { z } from "zod";
import servicesJson from "../../../catalogue/services.json";
import therapistsJson from "../../../catalogue/therapists.json";
import { City, ConcernArea, HelpType, Language } from "@/core/needs";
import type { Catalogue, ServiceQuery, TherapistQuery } from "@/core/ports";
import type { Card } from "@/core/types";

const Service = z.strictObject({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  modes: z.array(z.enum(["online", "in_person"])),
  cities: z.array(City),
  url: z.url().startsWith("https://www.amahahealth.com/"),
  helpTypes: z.array(HelpType).min(1),
  checkedOn: z.iso.date(),
});

const Therapist = z.strictObject({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  languages: z.array(Language).min(1),
  specialties: z.array(z.string()).min(1),
  modes: z.array(z.enum(["online", "in_person"])).min(1),
  cities: z.array(City),
  helpTypes: z.array(z.enum(["therapist", "psychiatrist", "couples_therapist"])).length(1),
  concernAreas: z.array(ConcernArea).min(1),
});

export const services = z.strictObject({ note: z.string(), services: z.array(Service) }).parse(servicesJson).services;
export const therapists = z.strictObject({ note: z.string(), therapists: z.array(Therapist) }).parse(therapistsJson).therapists;

// A sample therapist links to Amaha's real booking page for that kind of help.
const BOOK_URL: Record<string, string> = {
  therapist: "https://www.amahahealth.com/services/therapy/",
  psychiatrist: "https://www.amahahealth.com/services/psychiatry/",
  couples_therapist: "https://www.amahahealth.com/services/couples-therapy/",
};

const LANGUAGE_LABEL = (l: string) => l[0].toUpperCase() + l.slice(1);
const CITY_LABEL: Record<string, string> = { bengaluru: "Bengaluru", mumbai: "Mumbai", new_delhi: "New Delhi", gurugram: "Gurugram" };
const MODE_LABEL: Record<string, string> = { online: "Online", in_person: "In person" };

function therapistCard(t: z.infer<typeof Therapist>): Card {
  return {
    id: t.id,
    kind: "therapist",
    name: t.name,
    title: t.title,
    summary: null,
    languages: t.languages.map(LANGUAGE_LABEL),
    specialties: t.specialties,
    modes: t.modes.map((m) => MODE_LABEL[m]),
    cities: t.cities.map((c) => CITY_LABEL[c] ?? c),
    url: BOOK_URL[t.helpTypes[0]],
    sample: true,
  };
}

function serviceCard(s: z.infer<typeof Service>): Card {
  return {
    id: s.id,
    kind: "service",
    name: s.name,
    title: "Amaha service",
    summary: s.summary,
    languages: [],
    specialties: [],
    modes: s.modes.map((m) => MODE_LABEL[m]),
    cities: s.cities.map((c) => CITY_LABEL[c] ?? c),
    url: s.url,
    sample: false,
  };
}

export class JsonCatalogue implements Catalogue {
  async searchTherapists(q: TherapistQuery): Promise<Card[]> {
    let rows = therapists.filter((t) => t.helpTypes.includes(q.helpType));
    if (q.mode) rows = rows.filter((t) => t.modes.includes(q.mode!));
    if (q.mode === "in_person" && q.city) rows = rows.filter((t) => t.cities.includes(q.city as never));
    // A language preference narrows only when someone matches it, so a rare
    // language never leaves the person with no options.
    if (q.language && q.language !== "english") {
      const speaking = rows.filter((t) => t.languages.includes(q.language as never));
      if (speaking.length) rows = speaking;
    }
    const overlap = (t: z.infer<typeof Therapist>) => t.concernAreas.filter((c) => q.concerns.includes(c)).length;
    return rows
      .sort((a, b) => overlap(b) - overlap(a) || a.id.localeCompare(b.id))
      .slice(0, q.limit)
      .map(therapistCard);
  }

  async searchServices(q: ServiceQuery): Promise<Card[]> {
    return services
      .filter((s) => s.helpTypes.some((h) => q.helpTypes.includes(h)))
      .filter((s) => !q.mode || s.modes.includes(q.mode))
      .map(serviceCard);
  }

  allowedUrls(): ReadonlySet<string> {
    return new Set([...services.map((s) => s.url), ...Object.values(BOOK_URL)]);
  }
}
