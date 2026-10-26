// Local-only adapter: the Claude CLI in print mode, for development and evals
// on Lokesh's own machine (spec 5d). It is imported only behind a
// NODE_ENV !== 'production' check, so production builds drop it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseAction } from "@/core/action";
import { ProviderError, type ChatProvider, type ProviderRequest } from "../provider";

// On Windows `claude` is a .cmd shim, which needs a shell and would mangle the
// multi-line system prompt. Spawn the real executable instead.
export function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

function transcript(messages: ProviderRequest["messages"]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

export class ClaudeCliProvider implements ChatProvider {
  readonly id = "claude-cli";

  constructor(readonly model: string) {}

  async call(req: ProviderRequest) {
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";
    const prompt = `${transcript(req.messages)}\n\nWrite the assistant's next message now, as the JSON object only.`;

    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin(),
        [
          "-p",
          "--model", this.model,
          "--system-prompt", system,
          "--output-format", "json",
          "--tools", "",
          "--no-session-persistence",
          "--setting-sources", "",
          "--strict-mcp-config",
          "--disable-slash-commands",
        ],
        { signal: req.signal, windowsHide: true },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) =>
        reject(
          req.signal.aborted
            ? new ProviderError("timeout", "Claude CLI timed out")
            : new ProviderError("network", `Claude CLI failed to start: ${e.message}`),
        ),
      );
      child.on("close", (code) => {
        if (code !== 0) return reject(new ProviderError("server", `Claude CLI exited ${code}: ${err.slice(0, 200)}`));
        try {
          const wrapper = JSON.parse(out) as { result?: string; is_error?: boolean };
          if (wrapper.is_error) return reject(new ProviderError("server", "Claude CLI reported an error"));
          resolve(wrapper.result ?? "");
        } catch {
          reject(new ProviderError("invalid_output", "Claude CLI output was not JSON"));
        }
      });
      child.stdin.end(prompt);
    });

    const parsed = parseAction(text);
    if (!parsed.ok) throw new ProviderError("invalid_output", parsed.error);
    return { action: parsed.action, usage: { inputTokens: 0, outputTokens: 0, usd: 0 } };
  }
}
