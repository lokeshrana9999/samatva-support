// The ports the core talks through. Adapters live in src/adapters; the core
// never imports them (design D10, the import-boundary lint rule).
import type { Action } from "./action";
import type { ConcernArea, HelpType, NeedsRecord } from "./needs";
import type { Card, SessionState } from "./types";

export type TherapistQuery = {
  helpType: "therapist" | "psychiatrist" | "couples_therapist";
  concerns: ConcernArea[];
  language?: string;
  mode?: "online" | "in_person";
  city?: string;
  limit: number;
};
export type ServiceQuery = { helpTypes: HelpType[]; mode?: "online" | "in_person" };

export interface Catalogue {
  searchTherapists(q: TherapistQuery): Promise<Card[]>;
  searchServices(q: ServiceQuery): Promise<Card[]>;
  allowedUrls(): ReadonlySet<string>;
}

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

export type YesNo = { yes: boolean; p: number };

export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionError";
  }
}

// Speaks the domain, not Jev's wire format (design D20). Throws DecisionError;
// the core fails closed on it (spec 4b).
export interface DecisionModel {
  assessRisk(
    userTurns: string[],
    signal: AbortSignal,
  ): Promise<{
    p: Record<"none" | "elevated" | "imminent", number>;
    selfHarm: number;
    harmToOthers: number;
    beingHarmed: number;
    model: string;
    usage: Usage;
  }>;
  extractNeeds(
    userTurns: string[],
    signal: AbortSignal,
  ): Promise<{ needs: NeedsRecord; model: string; usage: Usage }>;
  checkReply(
    reply: string,
    stage: string,
    signal: AbortSignal,
  ): Promise<{
    diagnosis: number;
    medicalAdvice: number;
    claimsHuman: number;
    model: string;
    usage: Usage;
  }>;
}

// Content-free by construction: every field is an enum, number, id or name
// from a fixed list (design, audit_events).
export type TurnAudit = {
  turn: number;
  stageIn: string;
  stageOut: string;
  riskKeyword: string | null;
  keywordPattern: string | null;
  riskJev: string | null;
  riskJevP: Record<string, number> | null;
  riskFinal: string;
  filterViolations: string[];
  regenerated: boolean;
  stockFallback: boolean;
  tools: string[];
  toolRejected: boolean;
  provider: string | null;
  model: string | null;
  jevModel: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  outcome: "ok" | "handoff" | "limit" | "error";
};

export interface AuditLog {
  record(e: TurnAudit & { sessionId: string; reviewerHash: string }): Promise<void>;
}

export type Who = { ipHash: string; reviewerHash: string };
export type LimitResult = { ok: true } | { ok: false; kind: "daily_conversations" | "hourly_turns" | "spend" };

// Caps are checked before any chat call and after the crisis checks, so a
// limit never sits between someone in danger and the numbers (spec 9a).
export interface RateLimiter {
  startConversation(who: Who): Promise<LimitResult>;
  startTurn(who: Who): Promise<LimitResult>;
  addSpend(usd: number): Promise<void>;
}

export type TranscriptRow = { seq: number; role: "user" | "assistant"; text: string };

// Writes happen only with consent; the Supabase adapter checks it again in
// the database.
export interface TranscriptStore {
  append(sessionId: string, rows: TranscriptRow[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface SessionStore {
  create(init: { adult: true; consent: boolean }): Promise<SessionState>;
  load(id: string): Promise<SessionState | null>;
  save(s: SessionState): Promise<"ok" | "conflict">;
  delete(id: string): Promise<void>;
}
