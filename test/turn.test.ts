import { describe, expect, it } from "vitest";
import { config } from "@config";
import { compileFloor } from "@/core/gates/keyword-floor";
import { ChatError, type ChatModel } from "@/core/ports";
import { runTurn } from "@/core/turn";
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
  version: 0,
  ...over,
});

function scripted(replies: string[]): ChatModel & { calls: number } {
  const model = {
    calls: 0,
    async complete() {
      const reply = replies[Math.min(model.calls, replies.length - 1)];
      model.calls++;
      return {
        action: { reply },
        provider: "fake",
        model: "fake-1",
        usage: { inputTokens: 1, outputTokens: 1, usd: 0 },
        providersTried: ["fake"],
      };
    },
  };
  return model;
}

function deps(chat: ChatModel, phases: Phase[] = []) {
  return {
    chat,
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
    const { final, session: s } = await runTurn(deps(scripted(["What has been hardest?"]), phases), {
      session: session(),
      messages: user("work has been really stressful"),
    });
    expect(final).toMatchObject({ reply: "What has been hardest?", stage: "understand", replaced: null, turnsUsed: 1 });
    expect(s.stage).toBe("understand");
    expect(phases).toEqual(["reading", "thinking", "checking"]);
  });

  it("goes to handoff on an imminent keyword without calling the model", async () => {
    const chat = scripted(["should not be used"]);
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("main marna chahta hoon") });
    expect(chat.calls).toBe(0);
    expect(final.stage).toBe("handoff");
    expect(final.lang).toBe("hi-Latn");
    expect(final.reply).toBe(config.stockLines.handoffSentence["hi-Latn"]);
    expect(final.crisisLines[0].id).toBe("112");
    expect(final.cards).toEqual([]);
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

  it("regenerates once on a filter violation, then uses the second reply", async () => {
    const chat = scripted(["Book with Dr. Rao at rao.com", "What would help most right now?"]);
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("I feel low") });
    expect(chat.calls).toBe(2);
    expect(final).toMatchObject({ reply: "What would help most right now?", replaced: null });
    expect(final.trace.regenerated).toBe(true);
  });

  it("falls back to the stock line when the regenerated reply also fails", async () => {
    const chat = scripted(["see example.com"]);
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("I feel low") });
    expect(final.replaced).toEqual({ reason: "link" });
    expect(final.reply).toBe(config.stockLines.byStage.understand["en-IN"]);
  });

  it("returns the providers_down stock line when every provider fails", async () => {
    const chat: ChatModel = {
      async complete() {
        throw new ChatError("every provider failed", ["openrouter"]);
      },
    };
    const { final } = await runTurn(deps(chat), { session: session(), messages: user("hello") });
    expect(final.replaced).toEqual({ reason: "providers_down" });
    expect(final.trace.providersTried).toEqual(["openrouter"]);
  });

  it("caps a conversation at 20 user turns", async () => {
    const { final } = await runTurn(deps(scripted(["x"])), {
      session: session({ stage: "understand", userTurns: 20 }),
      messages: user("one more"),
    });
    expect(final.limit).toEqual({ kind: "conversation_turns" });
  });
});
