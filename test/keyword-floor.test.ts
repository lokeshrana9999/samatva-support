import { describe, expect, it } from "vitest";
import { config } from "@config";
import { compileFloor, maxTier } from "@/core/gates/keyword-floor";

const floor = compileFloor(config.riskKeywords);

describe("keyword floor", () => {
  it.each([
    "I want to kill myself",
    "i'm thinking about ending my life tonight",
    "honestly i feel suicidal",
    "main marna chahta hoon",
    "ab jeena nahi chahti",
    "khud ko khatam karna hai",
  ])("reads %j as imminent", (text) => {
    expect(floor(text).tier).toBe("imminent");
  });

  it.each([
    "sometimes I wish I could disappear",
    "everyone would be better off without me",
    "I've been cutting myself again",
  ])("reads %j as elevated", (text) => {
    expect(floor(text).tier).toBe("elevated");
  });

  it.each([
    "this deadline is killing me",
    "mar jaunga hasi se yaar",
    "I was dying of laughter",
    "I'm going to kill it at the interview",
    "work has been stressful and I can't sleep",
  ])("leaves the hard negative %j alone", (text) => {
    expect(floor(text).tier).toBeNull();
  });

  it("flags being harmed and keeps the tier at elevated", () => {
    const r = floor("my husband hits me when he drinks");
    expect(r).toMatchObject({ tier: "elevated", beingHarmed: true, patternId: "bh-hits-me" });
  });

  it("still fires on a real phrase next to an excluded one", () => {
    expect(floor("this job is killing me and I want to kill myself").tier).toBe("imminent");
  });

  it("takes the highest tier", () => {
    expect(maxTier(null, "elevated", "none")).toBe("elevated");
    expect(maxTier("elevated", "imminent")).toBe("imminent");
    expect(maxTier(null)).toBe("none");
  });
});
