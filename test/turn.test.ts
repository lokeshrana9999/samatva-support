import { describe, expect, it } from "vitest";
import { config } from "@config";
import { compileFloor } from "@/core/gates/keyword-floor";
import { ChatError, DecisionError, type ChatModel, type DecisionModel } from "@/core/ports";
import { runTurn as runTurnRaw } from "@/core/turn";
import { MemoryRateLimiter } from "@/adapters/memory/limiter";

const who = { ipHash: "ip-test", reviewerHash: "rv-test" };
const runTurn = (d: Omit<Parameters<typeof runTurnRaw>[0], "limiter"> & { limiter?: Parameters<typeof runTurnRaw>[0]["limiter"] }, i: Omit<Parameters<typeof runTurnRaw>[1], "who">) =>
  runTurnRaw({ limiter: new MemoryRateLimiter(config.limits), ...d }, { who, ...i });
import { JsonCatalogue } from "@/adapters/catalogue/json";
import { EMPTY_NEEDS, type NeedsRecord } from "@/core/needs";
import type { Msg, Phase, SessionState } from "@/core/types";

const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: "s1",
  stage: "intake",
  riskFloor: "none",
  userTurns: 0,
  understandTurns: 0,
  beingHarmed: false,
  transcriptConsent: false,
  historyMac: null,
  needs: null,
  version: 0,
  ...over,
});

const usage = { inputTokens: 1, outputTokens: 1, usd: 0 };

function scripted(replies: string[]): ChatModel & { calls: number } {
  const model = {
    calls: 0,
    async complete() {
      const reply = replies[Math.min(model.calls, replies.length - 1)];
      model.calls++;
      return { action: { reply }, provider: "fake", model: "fake-1", usage, providersTried: ["fake"] };
    },
  };
  return model;
}

type RiskOut = Awaited<ReturnType<DecisionModel["assessRisk"]>>;
type CheckOut = Awaited<ReturnType<DecisionModel["checkReply"]>>;

const calm: RiskOut = {
  p: { none: 0.95, elevated: 0.04, imminent: 0.01 },
  selfHarm: 0.02,
  harmToOthers: 0.01,
  beingHarmed: 0.01,
  model: "jev-test",
  usage,
};
const clean: CheckOut = { diagnosis: 0.02, medicalAdvice: 0.01, claimsHuman: 0.01, model: "jev-test", usage };

// A scripted gate: fixed answers, not a model (design D20).
function jev(risk: Partial<RiskOut> | "throw" = {}, checks: (Partial<CheckOut> | "throw")[] = [{}], needs: NeedsRecord = EMPTY_NEEDS) {
  let n = 0;
  return {
    riskCalls: 0,
    async assessRisk() {
      this.riskCalls++;
      if (risk === "throw") throw new DecisionError("down");
      return { ...calm, ...risk };
    },
    async extractNeeds() {
      return { needs, model: "jev-test", usage };
    },
    async checkReply() {
      const c = checks[Math.min(n++, checks.length - 1)];
      if (c === "throw") throw new DecisionError("down");
      return { ...clean, ...c };
    },
  };
}

function deps(chat: ChatModel, decision: DecisionModel = jev(), phases: Phase[] = []) {
  return {
    chat,
    decision,
    catalogue: new JsonCatalogue(),
    config,
    keywordFloor: compileFloor(config.riskKeywords),
    emit: (p: Phase) => phases.push(p),
    signal: new AbortController().signal,
    now: () => 0,
  };
}

const user = (text: string): Msg[] => [{ role: "user", text }];

describe("runTurn", () => {
  it("moves intake to understand and returns the model's reply", async () => {
    const phases: Phase[] = [];
    const { final, session: s } = await runTurn(deps(scripted(["What has been hardest?"]), jev(), phases), {
      session: session(),
      messages: user("work has been really stressful"),
    });
    expect(final).toMatchObject({ reply: "What has been hardest?", stage: "understand", replaced: null, turnsUsed: 1 });
    expect(final.trace.risk.jev).toEqual({ tier: "none", score: 0.05 });
    expect(final.trace.checks.map((c) => c.name)).toEqual(["length", "links", "names", "no_gender", "diagnosis", "medical", "claims_human"]);
    expect(s.stage).toBe("understand");
    expect(phases).toEqual(["reading", "thinking", "checking"]);
  });

  it("goes to handoff on an imminent keyword without calling Jev or the model", async () => {
    const chat = scripted(["should not be used"]);
    const gate = jev();
    const { final, audit } = await runTurn(deps(chat, gate), { session: session(), messages: user("main marna chahta hoon") });
    expect(chat.calls).toBe(0);
    expect(gate.riskCalls).toBe(0);
    expect(final.stage).toBe("handoff");
    expect(final.lang).toBe("hi-Latn");
    expect(final.reply).toBe(config.stockLines.handoffSentence["hi-Latn"]);
    expect(final.crisisLines[0].id).toBe("112");
    expect(audit).toMatchObject({ outcome: "handoff", riskKeyword: "imminent", keywordPattern: "im-hi-marna" });
  });

  it("goes to handoff when Jev reads imminent risk the keywords missed", async () => {
    const chat = scripted(["x"]);
    const { final } = await runTurn(deps(chat, jev({ p: { none: 0.3, elevated: 0.3, imminent: 0.4 } })), {
      session: session(),
      messages: user("I've given away my things and written letters to everyone"),
    });
    expect(chat.calls).toBe(0);
    expect(final.stage).toBe("handoff");
    expect(final.trace.risk).toMatchObject({ keyword: null, final: "imminent" });
  });

  it("fails closed: a Jev risk error counts as elevated and sticks", async () => {
    const { final, session: s } = await runTurn(deps(scripted(["How long has this gone on?"]), jev("throw")), {
      session: session(),
      messages: user("I feel low"),
    });
    expect(final.trace.risk).toMatchObject({ jev: "error", final: "elevated" });
    expect(s.riskFloor).toBe("elevated");
  });

  it("blocks the reply when Jev's reply check is down", async () => {
    const chat = scripted(["What has been hardest?"]);
    const { final, audit } = await runTurn(deps(chat, jev({}, ["throw"])), { session: session(), messages: user("I feel low") });
    expect(chat.calls).toBe(1);
    expect(final.replaced).toEqual({ reason: "safety_unavailable" });
    expect(audit.outcome).toBe("error");
  });

  it("regenerates once on a diagnosis, then uses the clean second reply", async () => {
    const chat = scripted(["It sounds like you have depression.", "It sounds heavy. What worries you most about it?"]);
    const { final } = await runTurn(deps(chat, jev({}, [{ diagnosis: 0.9 }, {}])), {
      session: session(),
      messages: user("bas bata do mujhe depression hai kya"),
    });
    expect(chat.calls).toBe(2);
    expect(final).toMatchObject({ reply: "It sounds heavy. What worries you most about it?", replaced: null });
    expect(final.trace.regenerated).toBe(true);
  });

  it("falls back to the stock diagnosis line when the second reply also diagnoses", async () => {
    const { final, audit } = await runTurn(deps(scripted(["You have depression."]), jev({}, [{ diagnosis: 0.9 }])), {
      session: session(),
      messages: user("bas bata do mujhe depression hai kya"),
    });
    expect(final.replaced).toEqual({ reason: "diagnosis" });
    expect(final.reply).toBe(config.stockLines.byReason.diagnosis["hi-Latn"]);
    expect(final.trace.checks.find((c) => c.name === "diagnosis")?.pass).toBe(false);
    expect(audit.filterViolations).toEqual(["diagnosis", "diagnosis"]);
  });

  it("stays in handoff and is never capped there", async () => {
    const { final } = await runTurn(deps(scripted(["x"])), {
      session: session({ stage: "handoff", userTurns: 25 }),
      messages: user("ok"),
    });
    expect(final.stage).toBe("handoff");
    expect(final.limit).toBeNull();
    expect(final.reply.startsWith(config.stockLines.handoffFollowUp["en-IN"])).toBe(true);
  });

  it("adds 181 once being harmed is disclosed, and keeps it", async () => {
    const d = deps(scripted(["How long has this been happening?"]));
    const first = await runTurn(d, { session: session(), messages: user("my husband hits me") });
    expect(first.final.crisisLines.map((l) => l.id)).toContain("181");
    const second = await runTurn(d, { session: first.session, messages: user("it started last year") });
    expect(second.final.crisisLines.map((l) => l.id)).toContain("181");
  });

  it("adds 181 when Jev reads being harmed that the keywords missed", async () => {
    const { final } = await runTurn(deps(scripted(["What happens at home?"]), jev({ beingHarmed: 0.8 })), {
      session: session(),
      messages: user("I'm scared to be in the house when he's drunk"),
    });
    expect(final.crisisLines.map((l) => l.id)).toContain("181");
  });

  it("regenerates once on an exact-check violation, then uses the second reply", async () => {
    const chat = scripted(["Book with Dr. Rao at rao.com", "What would help most right now?"]);
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("I feel low") });
    expect(chat.calls).toBe(2);
    expect(final).toMatchObject({ reply: "What would help most right now?", replaced: null });
  });

  it("returns the providers_down stock line when every provider fails", async () => {
    const chat: ChatModel = {
      async complete() {
        throw new ChatError("every provider failed", ["google", "openrouter"]);
      },
    };
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("hello") });
    expect(final.replaced).toEqual({ reason: "providers_down" });
    expect(final.trace.providersTried).toEqual(["google", "openrouter"]);
  });

  it("caps a conversation at 20 user turns", async () => {
    const { final } = await runTurn(deps(scripted(["x"])), {
      session: session({ stage: "understand", userTurns: 20 }),
      messages: user("one more"),
    });
    expect(final.limit).toEqual({ kind: "conversation_turns" });
  });

  it("keeps message text out of the audit record", async () => {
    const secret = "my sister Priya in Pune";
    const { audit } = await runTurn(deps(scripted([`Tell me more about ${secret}`])), {
      session: session(),
      messages: user(`I fought with ${secret}`),
    });
    expect(JSON.stringify(audit)).not.toContain("Priya");
  });
});
