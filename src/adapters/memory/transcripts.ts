// In-memory TranscriptStore for local dev and tests. Takes a consent lookup so
// it enforces consent the same way the database function does.
import type { TranscriptRow, TranscriptStore } from "@/core/ports";

export class MemoryTranscriptStore implements TranscriptStore {
  readonly rows = new Map<string, TranscriptRow[]>();

  constructor(private readonly consented: (sessionId: string) => Promise<boolean>) {}

  async append(sessionId: string, rows: TranscriptRow[]) {
    if (!(await this.consented(sessionId))) return;
    const have = this.rows.get(sessionId) ?? [];
    const seqs = new Set(have.map((r) => r.seq));
    this.rows.set(sessionId, [...have, ...rows.filter((r) => !seqs.has(r.seq))]);
  }

  async deleteSession(sessionId: string) {
    this.rows.delete(sessionId);
  }
}
