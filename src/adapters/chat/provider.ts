// One provider call: messages in, a parsed Action out. A provider fails with
// ProviderError; the chain decides whether to fail over (design D33).
import type { Action } from "@/core/action";
import type { ChatMsg, Usage } from "@/core/ports";

export type ProviderErrorKind =
  | "timeout"
  | "rate_limited"
  | "server"
  | "auth"
  | "bad_request"
  | "invalid_output"
  | "network";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderRequest = {
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
};

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  call(req: ProviderRequest): Promise<{ action: Action; usage: Usage }>;
}
