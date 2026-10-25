// Wires adapters into the core's ports. The only place that knows which
// provider, store or CLI is in use.
import "server-only";
import { config } from "@config";
import { compileFloor } from "@/core/gates/keyword-floor";
import type { ChatModel, SessionStore } from "@/core/ports";
import { ProviderChain } from "@/adapters/chat/chain";
import { OpenRouterProvider } from "@/adapters/chat/openrouter";
import type { ChatProvider } from "@/adapters/chat/provider";
import { MemorySessionStore } from "@/adapters/memory/sessions";
import { SupabaseSessionStore } from "@/adapters/supabase/sessions";

export type Deps = {
  chat: ChatModel;
  sessions: SessionStore;
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
    for (const p of config.providers.chat) {
      if (p.id === "openrouter" && process.env.OPEN_ROUTER) {
        providers.push({ provider: new OpenRouterProvider(p.model, process.env.OPEN_ROUTER), timeoutMs: p.timeoutMs });
      }
      // Google AI Studio and Alibaba adapters arrive in step 6.
    }
    if (providers.length === 0) throw new Error("no chat provider configured: set OPEN_ROUTER");
    chat = new ProviderChain(providers);
  }

  let sessions: SessionStore;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    sessions = new SupabaseSessionStore();
  } else if (process.env.NODE_ENV !== "production") {
    sessions = new MemorySessionStore();
  } else {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production");
  }

  return { chat, sessions, keywordFloor, turnDeadlineMs };
}

export function deps(): Promise<Deps> {
  g.__samatvaDeps ??= build();
  return g.__samatvaDeps;
}
