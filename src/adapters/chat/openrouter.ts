// OpenRouter through its OpenAI-compatible chat completions endpoint, in JSON
// mode. zod validates the action either way; one repair call on a bad shape.
import { parseAction } from "@/core/action";
import type { ChatMsg, Usage } from "@/core/ports";
import { ProviderError, type ChatProvider, type ProviderRequest } from "./provider";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Completion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export class OpenRouterProvider implements ChatProvider {
  readonly id = "openrouter";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  private async post(messages: ChatMsg[], req: ProviderRequest): Promise<{ text: string; usage: Usage }> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        signal: req.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "samatva-support",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      });
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError("timeout", "OpenRouter call timed out");
      throw new ProviderError("network", `OpenRouter unreachable: ${(e as Error).message}`);
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "OpenRouter 429");
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `OpenRouter ${res.status}`);
    if (res.status >= 500) throw new ProviderError("server", `OpenRouter ${res.status}`);
    if (!res.ok) throw new ProviderError("bad_request", `OpenRouter ${res.status}`);

    const body = (await res.json()) as Completion;
    const text = body.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        usd: body.usage?.cost ?? 0,
      },
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
