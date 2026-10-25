// In-memory AuditLog for local dev and evals; the eval runner reads `events`.
import type { AuditLog } from "@/core/ports";

export class MemoryAuditLog implements AuditLog {
  readonly events: Parameters<AuditLog["record"]>[0][] = [];

  async record(e: Parameters<AuditLog["record"]>[0]) {
    this.events.push(e);
  }
}
