// Domain types shared by the core, the routes and the UI. The `Final` shape is
// the `/api/turn` contract in docs/design.md.

export type Stage = "intake" | "understand" | "recommend" | "close" | "handoff";
export type Tier = "none" | "elevated" | "imminent";
export type Lang = "en-IN" | "hi-Latn";

export type Phase = "reading" | "thinking" | "searching" | "checking" | "failover";

export type Msg = { role: "user" | "assistant"; text: string };

export type ReplacedReason =
  | "diagnosis"
  | "medical"
  | "claims_human"
  | "link"
  | "name"
  | "length"
  | "safety_unavailable"
  | "providers_down"
  | "error";

export type LimitKind =
  | "conversation_turns"
  | "daily_conversations"
  | "hourly_turns"
  | "spend";

// Catalogue fields only, never model text (spec 2a). Therapists are synthetic
// samples (`sample: true`) linking to Amaha's real booking page for their kind
// of help; services are real Amaha pages described in our own words.
export type Card = {
  id: string;
  kind: "therapist" | "service";
  name: string;
  title: string;
  summary: string | null;
  languages: string[];
  specialties: string[];
  modes: string[];
  cities: string[];
  url: string;
  sample: boolean;
};

export type CrisisLine = {
  id: string;
  label: string;
  number: string;
  telHref: string;
  note: string;
  sourceUrl: string;
  checkedAt: string;
};

// `jev` is null only when Jev wasn't asked: the keyword floor's imminent
// handoff and turns already in handoff skip it. 'error' means it failed and
// the gate failed closed.
export type Trace = {
  stageIn: Stage;
  stageOut: Stage;
  risk: {
    keyword: Tier | null;
    jev: { tier: Tier; score: number } | "error" | null;
    final: Tier;
  };
  checks: { name: string; pass: boolean }[];
  regenerated: boolean;
  provider: string | null;
  providersTried: string[];
  latencyMs: number;
};

export type Final = {
  reply: string;
  lang: Lang;
  stage: Stage;
  turnsUsed: number;
  turnsLimit: number;
  replaced: null | { reason: ReplacedReason };
  helpTypes: string[];
  cards: Card[];
  crisisLines: CrisisLine[];
  limit: null | { kind: LimitKind };
  trace: Trace;
};

// Server-held state for one conversation (the `sessions` row). Only code moves
// the stage; the client's copy of it is an echo for rendering.
export type SessionState = {
  id: string;
  stage: Stage;
  riskFloor: "none" | "elevated";
  userTurns: number;
  understandTurns: number;
  beingHarmed: boolean;
  transcriptConsent: boolean;
  historyMac: string | null;
  needs: import("./needs").NeedsRecord | null;
  version: number;
};
