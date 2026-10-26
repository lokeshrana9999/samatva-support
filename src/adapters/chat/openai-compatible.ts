// Any provider with an OpenAI-compatible chat completions endpoint (OpenRouter,
// Google AI Studio, Alibaba Model Studio), in JSON mode. zod validates the
// action either way; one repair call on a bad shape.
import { parseAction } from "@/core/action";
import type { ChatMsg, Usage } from "@/core/ports";
import { ProviderError, type ChatProvider, type ProviderRequest } from "./provider";

export const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
} as const;

export type CompatId = keyof typeof ENDPOINTS;

type Completion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export type Price = { input: number; output: number }; // USD per million tokens

export class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    readonly id: CompatId,
    readonly model: string,
    private readonly apiKey: string,
    // Used when the provider reports tokens but no cost, so the spend cap
    // still counts the call.
    private readonly price: Price | null = null,
  ) {}

  private async post(messages: ChatMsg[], req: ProviderRequest): Promise<{ text: string; usage: Usage }> {
    let res: Response;
    try {
      res = await fetch(ENDPOINTS[this.id], {
        method: "POST",
        signal: req.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(this.id === "openrouter" ? { "X-Title": "samatva-support" } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          response_format: { type: "json_object" },
          // OpenRouter reports the call's cost in `usage` when asked.
          ...(this.id === "openrouter" ? { usage: { include: true } } : {}),
        }),
      });
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError("timeout", `${this.id} call timed out`);
      throw new ProviderError("network", `${this.id} unreachable: ${(e as Error).message}`);
    }
    if (res.status === 429) throw new ProviderError("rate_limited", `${this.id} 429`);
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new ProviderError("auth", `${this.id} ${res.status}`);
    }
    if (res.status >= 500) throw new ProviderError("server", `${this.id} ${res.status}`);
    if (!res.ok) throw new ProviderError("bad_request", `${this.id} ${res.status}`);

    const body = (await res.json()) as Completion;
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    const estimated = this.price ? (inputTokens * this.price.input + outputTokens * this.price.output) / 1_000_000 : 0;
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      usage: { inputTokens, outputTokens, usd: body.usage?.cost ?? estimated },
    };
  }

  async call(req: ProviderRequest) {
    const first = await this.post(req.messages, req);
    const parsed = parseAction(first.text);
    if (parsed.ok) return { action: parsed.action, usage: first.usage };

    const repair = await this.post(
      [
        ...req.messages,
        { role: "assistant", content: first.text },
        {
          role: "user",
          content: `That output didn't match the required JSON shape (${parsed.error}). Reply again with only {"reply": "..."}.`,
        },
      ],
      req,
    );
    const reparsed = parseAction(repair.text);
    if (!reparsed.ok) throw new ProviderError("invalid_output", reparsed.error);
    return {
      action: reparsed.action,
      usage: {
        inputTokens: first.usage.inputTokens + repair.usage.inputTokens,
        outputTokens: first.usage.outputTokens + repair.usage.outputTokens,
        usd: first.usage.usd + repair.usage.usd,
      },
    };
  }
}
