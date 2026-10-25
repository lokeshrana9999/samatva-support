// In-memory SessionStore for local dev, tests and evals. Process-local, so it
// is never used in a deployment (serverless instances don't share memory).
import { randomUUID } from "node:crypto";
import type { SessionStore } from "@/core/ports";
import type { SessionState } from "@/core/types";

export class MemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, SessionState>();

  async create(init: { adult: true; consent: boolean }): Promise<SessionState> {
    const s: SessionState = {
      id: randomUUID(),
      stage: "intake",
      riskFloor: "none",
      userTurns: 0,
      understandTurns: 0,
      beingHarmed: false,
      transcriptConsent: init.consent,
      historyMac: null,
      version: 0,
    };
    this.rows.set(s.id, s);
    return { ...s };
  }

  async load(id: string) {
    const s = this.rows.get(id);
    return s ? { ...s } : null;
  }

  async save(s: SessionState): Promise<"ok" | "conflict"> {
    const current = this.rows.get(s.id);
    if (!current || current.version !== s.version) return "conflict";
    this.rows.set(s.id, { ...s, version: s.version + 1 });
    return "ok";
  }

  async delete(id: string) {
    this.rows.delete(id);
  }
}
