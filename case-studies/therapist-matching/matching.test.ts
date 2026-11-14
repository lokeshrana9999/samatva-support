// CASE STUDY ONLY (docs/case-studies/therapist-matching.md). These tests moved
// here from test/recommend.test.ts on 2026-11-14 with the matching itself, so
// the case study's claims stay checked by `npm test`.
import { describe, expect, it } from "vitest";
import { allowlisted } from "@/adapters/catalogue/json";
import { HELP_URL, matchTherapists, therapists } from "./matching";

describe("case study: therapist matching", () => {
  it("has the 14 invented sample profiles, each linking to an allowlisted public resource", () => {
    expect(therapists.length).toBe(14);
    const cards = matchTherapists({ helpType: "therapist", concerns: ["stress_anxiety"], limit: 3 });
    expect(cards.length).toBe(3);
    for (const c of cards) {
      expect(c.sample).toBe(true);
      expect(allowlisted(c.url)).toBe(true);
    }
    expect(Object.values(HELP_URL).every(allowlisted)).toBe(true);
  });

  it("ranks by overlap with the person's concerns", () => {
    const [top] = matchTherapists({ helpType: "therapist", concerns: ["trauma", "stress_anxiety"], limit: 3 });
    expect(top.id).toBe("t-04");
  });

  it("prefers the requested language without leaving the person with nobody", () => {
    const tamil = matchTherapists({ helpType: "psychiatrist", concerns: [], language: "tamil", limit: 3 });
    expect(tamil.every((c) => c.languages.includes("Tamil"))).toBe(true);
    const rare = matchTherapists({ helpType: "couples_therapist", concerns: [], language: "punjabi", limit: 3 });
    expect(rare.length).toBeGreaterThan(0);
  });

  it("filters in-person profiles by city", () => {
    const mumbai = matchTherapists({ helpType: "therapist", concerns: [], mode: "in_person", city: "mumbai", limit: 3 });
    expect(mumbai.length).toBeGreaterThan(0);
    expect(mumbai.every((c) => c.cities.includes("Mumbai") && c.modes.includes("In person"))).toBe(true);
  });

  // The moved eval check (rec-flow-en-01, `"language": "Tamil"`): low mood,
  // online, Tamil. The rules picked a therapist; with the live chat model the
  // Tamil speaker had to be among the shown cards. Here, the filter alone.
  it("finds a Tamil-speaking therapist online for the moved rec-flow-en-01 check", () => {
    const cards = matchTherapists({ helpType: "therapist", concerns: ["low_mood"], language: "tamil", mode: "online", limit: 3 });
    expect(cards.some((c) => c.languages.includes("Tamil"))).toBe(true);
  });
});
