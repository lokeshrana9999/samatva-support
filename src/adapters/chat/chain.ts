// The ChatModel the core sees: providers tried in config order, failing over
// on any error, with no plain retry on the same provider (design D33).
import { ChatError, type ChatModel } from "@/core/ports";
import { ProviderError, type ChatProvider } from "./provider";

const SKIP_AFTER_429_MS = 60_000;

export class ProviderChain implements ChatModel {
  // Per instance, not shared across serverless instances; fine for a demo.
  private readonly skipUntil = new Map<string, number>();

  constructor(
    private readonly providers: { provider: ChatProvider; timeoutMs: number }[],
    private readonly now: () => number = Date.now,
  ) {}

  async complete(req: Parameters<ChatModel["complete"]>[0]) {
    const tried: string[] = [];
    for (const { provider, timeoutMs } of this.providers) {
      if ((this.skipUntil.get(provider.id) ?? 0) > this.now()) continue;
      if (req.signal.aborted) break;
      if (tried.length > 0) req.onFailover?.();
      tried.push(provider.id);

      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const { action, usage } = await provider.call({ ...req, signal });
        return { action, usage, provider: provider.id, model: provider.model, providersTried: tried };
      } catch (e) {
        if (e instanceof ProviderError && e.kind === "rate_limited") {
          this.skipUntil.set(provider.id, this.now() + SKIP_AFTER_429_MS);
        }
        if (e instanceof ProviderError && e.kind === "auth") {
          console.error(`[chain] ${provider.id}: auth failure, check its key`);
        }
      }
    }
    throw new ChatError("every provider failed", tried);
  }
}
