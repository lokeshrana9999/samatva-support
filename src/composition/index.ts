// Wires adapters into the core's ports. The only place that knows which
// provider, store or CLI is in use.
import "server-only";
import { config } from "@config";
import { compileFloor } from "@/core/gates/keyword-floor";
import { DecisionError, type AuditLog, type ChatModel, type DecisionModel, type SessionStore } from "@/core/ports";
import { JevDecisionModel } from "@/adapters/decision/jev";
import { MemoryAuditLog } from "@/adapters/memory/audit";
import { SupabaseAuditLog } from "@/adapters/supabase/audit";
import { ProviderChain } from "@/adapters/chat/chain";
import { OpenAICompatibleProvider } from "@/adapters/chat/openai-compatible";
import type { ChatProvider } from "@/adapters/chat/provider";
import { MemorySessionStore } from "@/adapters/memory/sessions";
import { SupabaseSessionStore } from "@/adapters/supabase/sessions";

export type Deps = {
  chat: ChatModel;
  decision: DecisionModel;
  sessions: SessionStore;
  audit: AuditLog;
  keywordFloor: ReturnType<typeof compileFloor>;
  turnDeadlineMs: number;
};

// The CLI takes 10 to 20 s per call, so local runs get a longer turn deadline
// than the 25 s that fits Vercel's 30 s limit (design D14).
const LOCAL_CLI_DEADLINE_MS = 120_000;

const g = globalThis as unknown as { __samatvaDeps?: Promise<Deps> };

async function build(): Promise<Deps> {
  const keywordFloor = compileFloor(config.riskKeywords);

  let chat: ChatModel;
  let turnDeadlineMs = config.limits.turnDeadlineMs;
  // NODE_ENV is inlined at build time, so the CLI import is dropped from the
  // production bundle (spec 5d).
  if (process.env.NODE_ENV !== "production" && process.env.LLM_LOCAL_CLI === "1") {
    const { ClaudeCliProvider } = await import("@/adapters/chat/cli/claude");
    const cli = config.providers.localCli.claude;
    chat = new ProviderChain([{ provider: new ClaudeCliProvider(cli.model), timeoutMs: cli.timeoutMs }]);
    turnDeadlineMs = LOCAL_CLI_DEADLINE_MS;
  } else {
    const providers: { provider: ChatProvider; timeoutMs: number }[] = [];
    const keyEnv = { openrouter: "OPEN_ROUTER", google: "GOOGLE_STUDIO", alibaba: "ALIBABA_KEY" } as const;
    for (const p of config.providers.chat) {
      const key = process.env[keyEnv[p.id]];
      if (key) providers.push({ provider: new OpenAICompatibleProvider(p.id, p.model, key), timeoutMs: p.timeoutMs });
    }
    if (providers.length === 0) throw new Error("no chat provider configured: set a provider key");
    chat = new ProviderChain(providers);
  }

  let sessions: SessionStore;
  let audit: AuditLog;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    sessions = new SupabaseSessionStore();
    audit = new SupabaseAuditLog();
  } else if (process.env.NODE_ENV !== "production") {
    sessions = new MemorySessionStore();
    audit = new MemoryAuditLog();
  } else {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production");
  }

  return { chat, decision: decisionModel(), sessions, audit, keywordFloor, turnDeadlineMs };
}

// Jev in every environment, no stand-in model (D20). Without a key every call
// fails, so the gates fail closed rather than open (spec 4b).
function decisionModel(): DecisionModel {
  const t = config.thresholds;
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("[composition] TYPESAFE_API_KEY is not set; every Jev call fails closed");
    const fail = async (): Promise<never> => {
      throw new DecisionError("TYPESAFE_API_KEY is not set");
    };
    return { assessRisk: fail, checkReply: fail };
  }
  return new JevDecisionModel(config.providers.jev.model, {
    timeoutMs: t.jevTimeoutMs,
    maxRetries: t.jevMaxRetries,
    deadlineMs: t.jevDeadlineMs,
  });
}

export function deps(): Promise<Deps> {
  g.__samatvaDeps ??= build();
  return g.__samatvaDeps;
}
