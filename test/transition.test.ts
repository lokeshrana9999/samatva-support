// The understand → recommend transition and the way back from close (design,
// the controller). Pure rules first, then whole turns through runTurn with
// fake ports.
import { describe, expect, it } from "vitest";
import { config } from "@config";
import { JsonCatalogue } from "@/adapters/catalogue/json";
import { MemoryRateLimiter } from "@/adapters/memory/limiter";
import { understandStep } from "@/core/controller/transition";
import { compileFloor } from "@/core/gates/keyword-floor";
import { genderedFirstPerson } from "@/core/gates/output-filter";
import { EMPTY_NEEDS, enough, helpTypesFor, mergeNeeds, needsPrefs, newConcerns, type NeedsRecord } from "@/core/needs";
import type { ChatModel, DecisionModel } from "@/core/ports";
import { runTurn } from "@/core/turn";
import type { Msg, SessionState } from "@/core/types";

const t = config.thresholds;
const usage = { inputTokens: 1, outputTokens: 1, usd: 0 };

// A clear difficulty with no preference.
const needs = (over: Partial<NeedsRecord> = {}): NeedsRecord => ({
  ...EMPTY_NEEDS,
  concerns: [{ area: "stress_anxiety", p: 0.9 }],
  duration: { value: "over_3_months", p: 0.8 },
  impact: { value: "some", p: 0.8 },
  ...over,
});
const online = { mode: { value: "online" as const, p: 0.9 } };
const rules = (n: NeedsRecord, risk: "none" | "elevated" = "none") => helpTypesFor(config.helpRules, n, risk, t);
const step = (n: NeedsRecord | null, turns: number, o: Partial<{ reentered: boolean; needsFailed: boolean }> = {}) =>
  understandStep(n, turns, { reentered: false, needsFailed: false, ...o }, t);

describe("rules respect Jev's confidence", () => {
  it("ignores concerns and fields below needsP", () => {
    expect(rules(needs({ concerns: [{ area: "sleep", p: 0.55 }] }))).toEqual(["therapist"]);
    expect(rules(needs({ forWhom: { value: "with_partner", p: 0.3 } }))).toEqual(["therapist"]);
    expect(rules(needs({ impact: { value: "little", p: 0.5 }, duration: { value: "under_2_weeks", p: 0.9 } }))).toEqual(["therapist"]);
  });

  it("reads severe only at severeP, and as some below it", () => {
    expect(rules(needs({ impact: { value: "severe", p: 0.7 } }))).toEqual(["therapist"]);
    expect(rules(needs({ impact: { value: "severe", p: t.severeP } }))).toEqual(["psychiatrist", "therapist"]);
    expect(rules(needs({ impact: { value: "severe", p: 0.7 }, urgency: { value: "now", p: 0.9 } }))).toEqual(["therapist"]);
    // Sleep with severe at 0.7 still counts as "some" impact, so the
    // psychiatrist rule for sleep fires.
    expect(rules(needs({ concerns: [{ area: "sleep", p: 0.9 }], impact: { value: "severe", p: 0.7 } }))).toContain("psychiatrist");
  });

  it("keeps the crisis line first when risk is elevated", () => {
    expect(rules(needs(), "elevated")[0]).toBe("crisis_line");
  });
});

describe("enough needs a preference or three turns", () => {
  it("holds a clear difficulty with no preference until prefTurns", () => {
    expect(enough(needs(), t, 2)).toBe(false);
    expect(enough(needs(), t, t.prefTurns)).toBe(true);
  });

  it("passes on turn 2 once language or mode is known at needsP", () => {
    expect(enough(needs(online), t, 2)).toBe(true);
    expect(enough(needs({ language: { value: "hindi", p: 0.8 } }), t, 2)).toBe(true);
    expect(enough(needs({ mode: { value: "online", p: 0.5 } }), t, 2)).toBe(false);
  });

  it("asks for preferences only when the difficulty is clear and none is known", () => {
    expect(needsPrefs(needs(), t.needsP)).toBe(true);
    expect(needsPrefs(needs(online), t.needsP)).toBe(false);
    expect(needsPrefs(needs({ impact: { value: "unknown", p: 0.9 } }), t.needsP)).toBe(false);
  });
});

describe("the understand step", () => {
  it("recommends when enough, otherwise keeps understanding until the cap", () => {
    expect(step(needs(online), 2)).toBe("recommend");
    expect(step(needs(), 2)).toBe("understand");
    expect(step({ ...EMPTY_NEEDS }, t.understandMaxTurns - 1)).toBe("understand");
  });

  it("recommends general help only at the cap without enough", () => {
    expect(step({ ...EMPTY_NEEDS }, t.understandMaxTurns)).toBe("not_enough");
    expect(step(null, t.understandMaxTurns)).toBe("not_enough");
    expect(step(needs(), t.understandMaxTurns)).toBe("recommend");
  });

  it("extends the cap by one turn when this turn's needs call failed", () => {
    expect(step(null, t.understandMaxTurns, { needsFailed: true })).toBe("understand");
    expect(step(null, t.understandMaxTurns + 1, { needsFailed: true })).toBe("not_enough");
  });

  it("recommends at once when they ask for suggestions and one concern is clear", () => {
    expect(step({ ...EMPTY_NEEDS, concerns: [{ area: "work_study", p: 0.8 }], wantsNow: 0.9 }, 1)).toBe("recommend");
    expect(step({ ...EMPTY_NEEDS, wantsNow: 0.9 }, 1)).toBe("understand");
    expect(step({ ...EMPTY_NEEDS, concerns: [{ area: "work_study", p: 0.5 }], wantsNow: 0.9 }, 1)).toBe("understand");
  });

  it("holds off for talk-only until the raised cap", () => {
    const talk = needs({ ...online, talkOnly: 0.9 });
    expect(step(talk, 3)).toBe("understand");
    expect(step(talk, t.understandMaxTurns)).toBe("understand");
    expect(step(talk, t.talkOnlyMaxTurns)).toBe("recommend");
    expect(step({ ...EMPTY_NEEDS, talkOnly: 0.9 }, t.talkOnlyMaxTurns)).toBe("not_enough");
    // Asking for suggestions overrides talk-only.
    expect(step({ ...talk, wantsNow: 0.9 }, 2)).toBe("recommend");
  });

  it("always asks first on a re-entry from close", () => {
    expect(step(needs({ ...online, wantsNow: 0.9 }), 1, { reentered: true })).toBe("understand");
  });
});

describe("merging and new concerns", () => {
  it("carries known preferences when the fresh record doesn't state them", () => {
    const merged = mergeNeeds(needs(online), needs(), t.needsP);
    expect(merged.mode).toEqual(online.mode);
    const corrected = mergeNeeds(needs(online), needs({ mode: { value: "in_person", p: 0.8 } }), t.needsP);
    expect(corrected.mode.value).toBe("in_person");
  });

  it("takes a corrected duration from the fresh record", () => {
    const merged = mergeNeeds(needs({ duration: { value: "under_2_weeks", p: 0.8 } }), needs(), t.needsP);
    expect(merged.duration.value).toBe("over_3_months");
  });

  it("keeps talk-only until they ask for suggestions", () => {
    expect(mergeNeeds(needs({ talkOnly: 0.9 }), needs({ talkOnly: 0.1 }), t.needsP).talkOnly).toBe(0.9);
    expect(mergeNeeds(needs({ talkOnly: 0.9 }), needs({ talkOnly: 0.1, wantsNow: 0.8 }), t.needsP).talkOnly).toBe(0.1);
  });

  it("finds concerns the stored record lacks, at needsP, never 'other'", () => {
    const stored = needs();
    expect(newConcerns(stored, { ...EMPTY_NEEDS, concerns: [{ area: "family", p: 0.8 }] }, t.needsP)).toEqual([{ area: "family", p: 0.8 }]);
    expect(newConcerns(stored, { ...EMPTY_NEEDS, concerns: [{ area: "stress_anxiety", p: 0.9 }] }, t.needsP)).toEqual([]);
    expect(newConcerns(stored, { ...EMPTY_NEEDS, concerns: [{ area: "family", p: 0.55 }] }, t.needsP)).toEqual([]);
    expect(newConcerns(stored, { ...EMPTY_NEEDS, concerns: [{ area: "other", p: 0.9 }] }, t.needsP)).toEqual([]);
  });
});

describe("the not-enough stock line", () => {
  it("exists in both languages and gives the assistant no gender", () => {
    expect(config.stockLines.notEnoughYet["en-IN"]).toMatch(/not enough|don't know enough/i);
    expect(genderedFirstPerson(config.stockLines.notEnoughYet["hi-Latn"])).toBe(false);
  });
});

// Whole turns.

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: "s1",
  stage: "understand",
  riskFloor: "none",
  userTurns: 1,
  understandTurns: 1,
  beingHarmed: false,
  transcriptConsent: false,
  historyMac: null,
  needs: null,
  version: 0,
  ...over,
});

type Extract = { turns: string[]; lastQuestion?: string };

function jev(out: NeedsRecord | "throw", seen: Extract[] = []): DecisionModel {
  return {
    async assessRisk() {
      return { p: { none: 0.97, elevated: 0.02, imminent: 0.01 }, selfHarm: 0, harmToOthers: 0, beingHarmed: 0, model: "jev-test", usage };
    },
    async extractNeeds(turns, _signal, lastQuestion) {
      seen.push({ turns, lastQuestion });
      if (out === "throw") throw new Error("jev down");
      return { needs: out, model: "jev-test", usage };
    },
    async checkReply() {
      return { diagnosis: 0, medicalAdvice: 0, claimsHuman: 0, model: "jev-test", usage };
    },
  };
}

function chat(reply = "What has been hardest?"): ChatModel & { calls: number; systems: string[] } {
  const m = {
    calls: 0,
    systems: [] as string[],
    async complete(req: Parameters<ChatModel["complete"]>[0]) {
      m.calls++;
      m.systems.push(req.messages[0].content);
      return { action: { reply }, provider: "fake", model: "fake-1", usage, providersTried: ["fake"] };
    },
  };
  return m;
}

const run = (c: ChatModel, d: DecisionModel, s: SessionState, messages: Msg[]) =>
  runTurn(
    {
      chat: c,
      decision: d,
      catalogue: new JsonCatalogue(),
      limiter: new MemoryRateLimiter(config.limits),
      config,
      keywordFloor: compileFloor(config.riskKeywords),
      emit: () => {},
      signal: new AbortController().signal,
      now: () => 0,
    },
    { session: s, messages, who: { ipHash: "ip-test", reviewerHash: "rv-test" } },
  );

const convo = (...texts: string[]): Msg[] => texts.map((text, i) => ({ role: i % 2 ? "assistant" : "user", text }));

describe("turns: understand", () => {
  it("asks for preferences on turn 2 instead of recommending", async () => {
    const c = chat("Which language, online or in person, and which city?");
    const { final } = await run(c, jev(needs()), session(), convo("anxious for months", "How long?", "four months, work is slipping"));
    expect(final.stage).toBe("understand");
    expect(c.systems[0]).toContain("this reply asks that preferences question");
  });

  it("passes Jev the assistant's last question with the turns since understand began", async () => {
    const seen: Extract[] = [];
    await run(chat(), jev({ ...EMPTY_NEEDS }, seen), session(), convo("I moved cities", "When did you move?", "about two months ago"));
    expect(seen[0]).toEqual({ turns: ["I moved cities", "about two months ago"], lastQuestion: "When did you move?" });
  });

  it("at the cap without enough, shows the stock line and general help, with no chat call", async () => {
    const c = chat();
    const { final, session: s } = await run(c, jev({ ...EMPTY_NEEDS }), session({ userTurns: 5, understandTurns: 5 }), convo("hmm"));
    expect(c.calls).toBe(0);
    expect(final.stage).toBe("recommend");
    expect(final.reply).toBe(config.stockLines.notEnoughYet["en-IN"]);
    expect(final.helpTypes).toEqual(["Self-care tools", "A therapist"]);
    expect(final.cards.every((x) => x.kind === "service")).toBe(true);
    expect(final.cards.map((x) => x.id)).toContain("svc-therapy");
    expect(s.stage).toBe("close");
  });

  it("uses the Hinglish stock line for a Hinglish turn", async () => {
    const { final } = await run(chat(), jev({ ...EMPTY_NEEDS }), session({ userTurns: 5, understandTurns: 5 }), convo("pata nahi, bas aise hi"));
    expect(final.reply).toBe(config.stockLines.notEnoughYet["hi-Latn"]);
  });

  it("gives one more turn at the cap when Jev's needs call fails", async () => {
    const at = session({ userTurns: 5, understandTurns: 5, needs: null });
    const { final, session: s } = await run(chat(), jev("throw"), at, convo("hmm"));
    expect(final.stage).toBe("understand");
    const next = await run(chat(), jev("throw"), s, convo("hmm", "What else?", "not sure"));
    expect(next.final.stage).toBe("recommend");
    expect(next.final.helpTypes).toEqual(["Self-care tools", "A therapist"]);
  });

  it("recommends on turn 1 when they ask for suggestions with a clear concern", async () => {
    const n = { ...EMPTY_NEEDS, concerns: [{ area: "work_study" as const, p: 0.85 }], wantsNow: 0.9 };
    const { final } = await run(chat("A therapist may help."), jev(n), session({ userTurns: 0, understandTurns: 0, stage: "intake" }), convo("work stress for months, just give me suggestions"));
    expect(final.stage).toBe("recommend");
    expect(final.helpTypes).toEqual(["A therapist"]);
  });

  it("keeps listening when they only want to talk, even with enough", async () => {
    const { final } = await run(chat(), jev(needs({ ...online, talkOnly: 0.9 })), session({ userTurns: 3, understandTurns: 3 }), convo("I just want to talk"));
    expect(final.stage).toBe("understand");
  });
});

describe("turns: the way back from close", () => {
  const stored = needs(online);

  it("goes back to understand on a new concern, keeping the preferences", async () => {
    const seen: Extract[] = [];
    const fresh = { ...EMPTY_NEEDS, concerns: [{ area: "family" as const, p: 0.85 }] };
    const { final, session: s } = await run(
      chat("That sounds hard. How long has it been like this with your mother?"),
      jev(fresh, seen),
      session({ stage: "close", userTurns: 3, understandTurns: 3, needs: stored }),
      convo("anxious", "q", "months", "q", "online", "Here are some options.", "also my mother and I fight constantly"),
    );
    expect(seen[0].turns).toEqual(["also my mother and I fight constantly"]);
    expect(final.stage).toBe("understand");
    expect(final.cards).toEqual([]);
    expect(s.stage).toBe("understand");
    expect(s.understandTurns).toBe(1);
    expect(s.needs?.concerns.map((c) => c.area)).toEqual(["family"]);
    expect(s.needs?.duration.value).toBe("unknown");
    expect(s.needs?.mode).toEqual(online.mode);
  });

  it("stays in close on a thank-you or a concern it already holds", async () => {
    for (const out of [{ ...EMPTY_NEEDS }, needs()]) {
      const { final, session: s } = await run(chat("You're welcome."), jev(out), session({ stage: "close", needs: stored }), convo("thanks"));
      expect(final.stage).toBe("close");
      expect(s.needs).toEqual(stored);
    }
  });

  it("stays in close when Jev's needs call fails", async () => {
    const { final } = await run(chat("You're welcome."), jev("throw"), session({ stage: "close", needs: stored }), convo("thanks"));
    expect(final.stage).toBe("close");
  });
});
