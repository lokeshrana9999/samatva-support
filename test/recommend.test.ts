import { describe, expect, it } from "vitest";
import { config } from "@config";
import { ALLOWED_ORIGINS, allowlisted, JsonCatalogue, services } from "@/adapters/catalogue/json";
import { parseAction } from "@/core/action";
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
  it("links every card to an allowlisted public resource", async () => {
    const cat = new JsonCatalogue();
    const allowed = cat.allowedUrls();
    expect(services.every((s) => ALLOWED_ORIGINS.some((o) => s.url.startsWith(o)))).toBe(true);
    for (const s of services) expect(allowed.has(s.url)).toBe(true);
    const cards = await cat.searchServices({ helpTypes: ["therapist", "psychiatrist", "couples_therapist", "self_care"] });
    expect(cards.length).toBe(services.length);
    for (const c of cards) {
      expect(c.kind).toBe("service");
      expect(allowed.has(c.url)).toBe(true);
    }
  });

  it("allowlists only public-resource origins, not lookalike hosts", () => {
    expect(allowlisted("https://www.who.int/publications/i/item/9789240003927")).toBe(true);
    expect(allowlisted("https://telemanas.mohfw.gov.in/home")).toBe(true);
    expect(allowlisted("https://www.who.int.example.com/")).toBe(false);
    expect(allowlisted("https://example.com/therapy")).toBe(false);
  });

  // Therapist profiles are a case study (docs/case-studies/therapist-matching.md).
  it("holds kinds of help only, with no therapist search", () => {
    const cat = new JsonCatalogue() as unknown as Record<string, unknown>;
    expect(cat.searchTherapists).toBeUndefined();
    expect(services.some((s) => /^t-\d+$/.test(s.id))).toBe(false);
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

  it("searches services, shows the cards the model picked, and moves the session to close", async () => {
    const chat = scripted([
      { reply: "", tool: { name: "search_services", args: { helpTypes: ["therapist"] } } },
      { reply: "A therapist may help with the anxiety you've had for months.", show: ["svc-find", "svc-therapy"] },
    ]);
    const { final, session: s, audit } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("it's been months") });
    expect(final.stage).toBe("recommend");
    expect(final.helpTypes).toEqual(["A therapist"]);
    expect(final.cards.map((c) => c.id)).toEqual(["svc-find", "svc-therapy"]);
    expect(final.replaced).toBeNull();
    expect(s.stage).toBe("close");
    expect(audit.tools).toEqual(["search_services"]);
  });

  it("rejects a tool call for help the rules didn't pick", async () => {
    const chat = scripted([
      { reply: "", tool: { name: "search_services", args: { helpTypes: ["psychiatrist"] } } },
      { reply: "A therapist may help.", show: [] },
    ]);
    const { final, audit } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(audit.toolRejected).toBe(true);
    expect(chat.seen[1]).toContain("rejected");
    // The model showed nothing valid, so the controller's own top results show.
    expect(final.cards.map((c) => c.id)).toEqual(["svc-therapy", "svc-find"]);
  });

  it("shows only service cards, at most three, and ignores ids it never returned", async () => {
    const chat = scripted([
      { reply: "", tool: { name: "search_services", args: { helpTypes: ["psychiatrist", "therapist"] } } },
      { reply: "A psychiatrist and a therapist may both help.", show: ["t-01", "svc-psychiatry", "svc-therapy", "svc-find", "svc-psychiatry"] },
    ]);
    const severe = needs({ impact: { value: "severe", p: 0.9 } });
    const { final } = await runTurn(deps(chat, gate(severe)), { session: session(), messages: msgs("ok") });
    expect(final.cards.map((c) => c.id)).toEqual(["svc-psychiatry", "svc-therapy", "svc-find"]);
    expect(final.cards.every((c) => c.kind === "service")).toBe(true);
  });

  // The therapist search is a case study (docs/case-studies/therapist-matching.md),
  // so the parser no longer accepts it as a tool call.
  it("doesn't accept a therapist search from the model", () => {
    const r = parseAction('{"tool": {"name": "search_therapists", "args": {"helpType": "therapist"}}, "reply": ""}');
    expect(r.ok).toBe(false);
  });

  it("tells the model it can't name a practitioner and offers no therapist search", async () => {
    const chat = scripted([{ reply: "A therapist may help.", show: [] }]);
    const seen: string[] = [];
    const spy: ChatModel = {
      async complete(req) {
        seen.push(req.messages[0].content);
        return chat.complete(req);
      },
    };
    await runTurn(deps(spy, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(seen[0]).toContain("search_services");
    expect(seen[0]).not.toMatch(/search_therapists|sample profile/i);
    expect(seen[0]).toContain("never suggest a specific practitioner");
  });

  it("blocks a reply naming a clinician, since the catalogue names no one", async () => {
    const chat = scripted([{ reply: "You should see Dr. Mehta, she is great.", show: [] }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(final.replaced).toEqual({ reason: "name" });
    expect(final.cards.length).toBeGreaterThan(0);
    expect(final.cards.every((c) => c.kind === "service")).toBe(true);
  });

  it("blocks a reply naming one of the case-study sample therapists", async () => {
    const chat = scripted([{ reply: "Dr. Lata Krishnan speaks Tamil and could help.", show: [] }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session(), messages: msgs("ok") });
    expect(final.replaced).toEqual({ reason: "name" });
    expect(final.reply).not.toContain("Krishnan");
  });

  it("adds the crisis line first when risk is elevated", async () => {
    const chat = scripted([{ reply: "A crisis line is there if things get worse, and a psychiatrist may help.", show: [] }]);
    const { final } = await runTurn(deps(chat, gate(needs())), { session: session({ riskFloor: "elevated" }), messages: msgs("ok") });
    expect(final.helpTypes[0]).toBe("A crisis line, now");
    expect(final.cards.some((c) => c.id === "svc-psychiatry")).toBe(true);
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
