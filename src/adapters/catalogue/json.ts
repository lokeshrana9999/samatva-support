// Catalogue over the repo's JSON files (design D38: the repo JSON is the
// source of truth). Tens of rows, so a typed filter is the honest search;
// embeddings would be for show. It holds kinds of help only: the sample
// therapist profiles and their matching live outside the shipped app, in
// case-studies/therapist-matching/ (docs/case-studies/therapist-matching.md).
import { z } from "zod";
import servicesJson from "../../../catalogue/services.json";
import { City, HelpType } from "@/core/needs";
import type { Catalogue, ServiceQuery } from "@/core/ports";
import type { Card } from "@/core/types";

// Every catalogue link must sit under one of these origins: free public
// resources only, never a company or booking page.
export const ALLOWED_ORIGINS = ["https://telemanas.mohfw.gov.in/", "https://www.who.int/"] as const;
export const allowlisted = (u: string) => ALLOWED_ORIGINS.some((o) => u.startsWith(o));

const Service = z.strictObject({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  modes: z.array(z.enum(["online", "in_person"])),
  cities: z.array(City),
  url: z.url().refine(allowlisted, "url must be under an allowlisted origin"),
  helpTypes: z.array(HelpType).min(1),
  checkedOn: z.iso.date(),
});

export const services = z.strictObject({ note: z.string(), services: z.array(Service) }).parse(servicesJson).services;

const CITY_LABEL: Record<string, string> = { bengaluru: "Bengaluru", mumbai: "Mumbai", new_delhi: "New Delhi", gurugram: "Gurugram" };
const MODE_LABEL: Record<string, string> = { online: "Online", in_person: "In person" };

function serviceCard(s: z.infer<typeof Service>): Card {
  return {
    id: s.id,
    kind: "service",
    name: s.name,
    summary: s.summary,
    modes: s.modes.map((m) => MODE_LABEL[m]),
    cities: s.cities.map((c) => CITY_LABEL[c] ?? c),
    url: s.url,
  };
}

export class JsonCatalogue implements Catalogue {
  async searchServices(q: ServiceQuery): Promise<Card[]> {
    return services
      .filter((s) => s.helpTypes.some((h) => q.helpTypes.includes(h)))
      .filter((s) => !q.mode || s.modes.includes(q.mode))
      .map(serviceCard);
  }

  allowedUrls(): ReadonlySet<string> {
    return new Set(services.map((s) => s.url));
  }
}
