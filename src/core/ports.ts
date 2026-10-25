// The ports the core talks through. Adapters live in src/adapters; the core
// never imports them (design D10, the import-boundary lint rule).
import type { Action } from "./action";
import type { SessionState } from "./types";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type Usage = { inputTokens: number; outputTokens: number; usd: number };

export class ChatError extends Error {
  constructor(
    message: string,
    readonly providersTried: string[],
  ) {
    super(message);
    this.name = "ChatError";
  }
}

// Throws ChatError when every provider fails.
export interface ChatModel {
  complete(req: {
    messages: ChatMsg[];
    temperature: number;
    maxTokens: number;
    signal: AbortSignal;
    onFailover?: () => void;
  }): Promise<{
    action: Action;
    provider: string;
    model: string;
    usage: Usage;
    providersTried: string[];
  }>;
}

export interface SessionStore {
  create(init: { adult: true; consent: boolean }): Promise<SessionState>;
  load(id: string): Promise<SessionState | null>;
  save(s: SessionState): Promise<"ok" | "conflict">;
  delete(id: string): Promise<void>;
}
