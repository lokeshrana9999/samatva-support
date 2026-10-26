import { describe, expect, it } from "vitest";
import { config } from "@config";
import { JsonCatalogue, services, therapists } from "@/adapters/catalogue/json";
import { compileFloor } from "@/core/gates/keyword-floor";
import { EMPTY_NEEDS, enough, helpTypesFor, type NeedsRecord } from "@/core/needs";
import type { Action } from "@/core/action";
import type { ChatModel, DecisionModel } from "@/core/ports";
import { runTurn as runTurnRaw } from "@/core/turn";
import { MemoryRateLimiter } from "@/adapters/memory/limiter";

const who = { ipHash: "ip-test", reviewerHash: "rv-test" };
const runTurn = (d: Omit<Parameters<typeof runTurnRaw>[0], "limiter"> & { limiter?: Parameters<typeof runTurnRaw>[0]["limiter"] }, i: Omit<Parameters<typeof runTurnRaw>[1], "who">) =>
  runTurnRaw({ limiter: new MemoryRateLimiter(config.limits), ...d }, { who, ...i });
import type { Msg, SessionState } from "@/core/types";

const usage = { inputTokens: 1, outputTokens: 1, usd: 0 };

const needs = (over: Partial<NeedsRecord> = {}): NeedsRecord => ({
  ...EMPTY_NEEDS,
  concerns: [{ area: "stress_anxiety", p: 0.9 }],
  duration: { value: "over_3_months", p: 0.8 },
  impact: { value: "some", p: 0.8 },
  ...over,
});

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: "s1",
  stage: "understand",
  riskFloor: "none",
  userTurns: 2,
  understandTurns: 2,
  beingHarmed: false,
  transcriptConsent: false,
  historyMac: null,
  needs: null,
  version: 0,
  ...over,
});

function gate(n: NeedsRecord, checks: Partial<Awaited<ReturnType<DecisionModel["checkReply"]>>> = {}): DecisionModel {
  return {
    async assessRisk() {
      return { p: { none: 0.97, elevated: 0.02, imminent: 0.01 }, selfHarm: 0, harmToOthers: 0, beingHarmed: 0, model: "jev-test", usage };
    },
    async extractNeeds() {
      return { needs: n, model: "jev-test", usage };
    },
    async checkReply() {
      return { diagnosis: 0, medicalAdvice: 0, claimsHuman: 0, model: "jev-test", usage, ...checks };
    },
  };
}

function scripted(actions: Action[]): ChatModel & { seen: string[] } {
  let i = 0;
  const m = {
    seen: [] as string[],
    async complete(req: Parameters<ChatModel["complete"]>[0]) {
      m.seen.push(req.messages.at(-1)!.content);
      const action = actions[Math.min(i++, actions.length - 1)];
      return { action, provider: "fake", model: "fake-1", usage, providersTried: ["fake"] };
    },
  };
  return m;
}

const deps = (chat: ChatModel, decision: DecisionModel) => ({
  chat,
  decision,
  catalogue: new JsonCatalogue(),
  config,
  keywordFloor: compileFloor(config.riskKeywords),
  emit: () => {},
  signal: new AbortController().signal,
  now: () => 0,
});

const msgs = (text: string): Msg[] => [{ role: "user", text }];

describe("rules and the needs gate", () => {
  it("needs a concern, a duration and an impact before recommending", () => {
    expect(enough(needs(), config.thresholds, 3)).toBe(true);
    expect(enough(needs({ impact: { value: "unknown", p: 0.7 } }), config.thresholds, 2)).toBe(false);
    expect(enough(needs({ concerns: [{ area: "sleep", p: 0.4 }] }), config.thresholds, 2)).toBe(false);
  });

  it("maps needs and risk to help types, crisis line first", () => {
    expect(helpTypesFor(config.helpRules, needs(), "none", config.thresholds)).toEqual(["therapist"]);
    expect(helpTypesFor(config.helpRules, needs({ impact: { value: "severe", p: 0.9 } }), "none", config.thresholds)).toEqual(["psychiatrist", "therapist"]);
    expect(helpTypesFor(config.helpRules, needs(), "elevated", config.thresholds)[0]).toBe("crisis_line");
    expect(helpTypesFor(config.helpRules, needs({ forWhom: { value: "with_partner", p: 0.9 } }), "none", config.thresholds)).toContain("couples_therapist");
    expect(
      helpTypesFor(config.helpRules, needs({ impact: { value: "little", p: 0.9 }, duration: { value: "under_2_weeks", p: 0.9 } }), "none", config.thresholds),
    ).toContain("self_care");
  });
});

describe("catalogue", () => {
  it("links every card to an allowlisted Amaha page and marks therapists as samples", async () => {
    const cat = new JsonCatalogue();
    const allowed = cat.allowedUrls();
    const th = await cat.searchTherapists({ helpType: "therapist", concerns: ["stress_anxiety"], limit: 3 });
    expect(th.length).toBe(3);
    for (const c of th) {
      expect(c.sample).toBe(true);
      expect(allowed.has(c.url)).toBe(true);
    }
    expect(services.every((s) => s.url.startsWith("https://www.amahahealth.com/"))).toBe(true);
    expect(therapists.length).toBeGreaterThanOrEqual(10);
  });

  it("prefers the requested language without leaving the person with nobody", async () => {
    const cat = new JsonCatalogue();
    const tamil = await cat.searchTherapists({ helpType: "psychiatrist", concerns: [], language: "tamil", limit: 3 });
    expect(tamil.every((c) => c.languages.includes("Tamil"))).toBe(true);
    const rare = await cat.searchTherapists({ helpType: "couples_therapist", concerns: [], language: "punjabi", limit: 3 });
    expect(rare.length).toBeGreaterThan(0);
  });
});

describe("recommend stage", () => {
  it("stays in understand until the needs record is enough", async () => {
    const chat = scripted([{ reply: "How long has this been going on?" }]);
    const { final, session: s } = await runTurn(deps(chat, gate({ ...EMPTY_NEEDS })), { session: session(), messages: msgs("I feel anxious") });
    expect(final.stage).toBe("understand");
    expect(final.cards).toEqual([]);
    expect(s.stage).toBe("understand");
  });

  it("searches, shows the cards the model picked, and moves the session to close", async () => {
    const chat = scripted([
      { reply: "", tool: { name: "search_therapists", args: { helpType: "therapist", concerns: ["stress_anxiety"], limit: 3 } } },
      { reply: "", tool: { name: "search_services", args: { helpTypes: ["therapist"] } } },
      { reply: "A therapist may help with the anxiety you've had for months. Ira Menon works with work stress.", show: ["t-01", "svc-therapy"] },
    ]);
    const { final, session: s, audit } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("it's been months") });
    expect(final.stage).toBe("recommend");
    expect(final.helpTypes).toEqual(["A therapist"]);
    expect(final.cards.map((c) => c.id)).toEqual(["t-01", "svc-therapy"]);
    expect(final.replaced).toBeNull();
    expect(s.stage).toBe("close");
    expect(audit.tools).toEqual(["search_therapists", "search_services"]);
  });

  it("rejects a tool call for help the rules didn't pick", async () => {
    const chat = scripted([
      { reply: "", tool: { name: "search_therapists", args: { helpType: "psychiatrist", concerns: [], limit: 3 } } },
      { reply: "A therapist may help.", show: [] },
    ]);
    const { final, audit } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(audit.toolRejected).toBe(true);
    expect(chat.seen[1]).toContain("rejected");
    // The model showed nothing valid, so the controller's own top results show.
    expect(final.cards.length).toBeGreaterThan(0);
    expect(final.cards.every((c) => c.kind === "service" || c.title !== "Psychiatrist")).toBe(true);
  });

  it("blocks a reply naming a clinician who isn't on a shown card", async () => {
    const chat = scripted([{ reply: "You should see Dr. Mehta, she is great.", show: [] }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(final.replaced).toEqual({ reason: "name" });
    expect(final.cards.length).toBeGreaterThan(0);
  });

  it("adds the crisis line first when risk is elevated", async () => {
    const chat = scripted([{ reply: "A crisis line is there if things get worse, and a psychiatrist may help.", show: [] }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session({ riskFloor: "elevated" }), messages: msgs("ok") });
    expect(final.helpTypes[0]).toBe("A crisis line, now");
    expect(final.cards.some((c) => c.title === "Psychiatrist")).toBe(true);
  });

  it("answers briefly in close without new cards", async () => {
    const chat = scripted([{ reply: "Of course. The suggestions above are there whenever you want them." }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session({ stage: "close", needs: needs() }), messages: msgs("thanks") });
    expect(final.stage).toBe("close");
    expect(final.cards).toEqual([]);
  });
});

describe("language", () => {
  it("tells the model which language to reply in", async () => {
    const seen: string[] = [];
    const chat: ChatModel = {
      async complete(req) {
        seen.push(req.messages[0].content);
        return { action: { reply: "What has been hardest?" }, provider: "fake", model: "fake-1", usage, providersTried: ["fake"] };
      },
    };
    await runTurn(deps(chat, gate({ ...EMPTY_NEEDS })), { session: session(), messages: msgs("My partner and I keep fighting") });
    await runTurn(deps(chat, gate({ ...EMPTY_NEEDS })), { session: session(), messages: msgs("mujhe bahut stress ho raha hai") });
    expect(seen[0]).toContain("English only");
    expect(seen[0]).not.toMatch(/hoon|aap|Hinglish in roman/);
    expect(seen[1]).toContain("Reply in Hinglish in roman script");
  });
});
