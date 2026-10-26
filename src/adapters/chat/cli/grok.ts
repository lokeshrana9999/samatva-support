// Local-only adapter: the Grok CLI in single-turn mode, the second eval target
// on Lokesh's own machine (spec 5c, 5d). Imported only outside production.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAction } from "@/core/action";
import { ProviderError, type ChatProvider, type ProviderRequest } from "../provider";

function grokBin(): string {
  if (process.env.GROK_BIN) return process.env.GROK_BIN;
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) return path.join(home, ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok");
  return "grok";
}

function transcript(messages: ProviderRequest["messages"]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

export class GrokCliProvider implements ChatProvider {
  readonly id = "grok-cli";
  readonly model: string;

  // `null` keeps the CLI's own default model.
  constructor(private readonly pinned: string | null) {
    this.model = pinned ?? "grok-cli-default";
  }

  async call(req: ProviderRequest) {
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";
    // An empty folder, so the agent sees no repo; the prompt goes in a file
    // because it is long and multi-line.
    const dir = mkdtempSync(path.join(tmpdir(), "samatva-grok-"));
    const promptFile = path.join(dir, "prompt.txt");
    writeFileSync(promptFile, `${transcript(req.messages)}\n\nWrite the assistant's next message now, as the JSON object only.`);

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          grokBin(),
          [
            "--prompt-file", promptFile,
            "--system-prompt-override", system,
            "--output-format", "json",
            "--max-turns", "1",
            "--disallowed-tools", "bash,edit,write,read,grep,glob,ls,web_search,web_fetch",
            "--disable-web-search",
            "--no-subagents",
            "--no-plan",
            "--cwd", dir,
            ...(this.pinned ? ["--model", this.pinned] : []),
          ],
          { signal: req.signal, windowsHide: true, cwd: dir },
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) =>
          reject(
            req.signal.aborted
              ? new ProviderError("timeout", "Grok CLI timed out")
              : new ProviderError("network", `Grok CLI failed to start: ${e.message}`),
          ),
        );
        child.on("close", (code) => {
          if (code !== 0) return reject(new ProviderError("server", `Grok CLI exited ${code}: ${err.slice(0, 200)}`));
          try {
            const wrapper = JSON.parse(out) as { text?: string };
            resolve(wrapper.text ?? "");
          } catch {
            reject(new ProviderError("invalid_output", "Grok CLI output was not JSON"));
          }
        });
      });
      const parsed = parseAction(text);
      if (!parsed.ok) throw new ProviderError("invalid_output", parsed.error);
      return { action: parsed.action, usage: { inputTokens: 0, outputTokens: 0, usd: 0 } };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
