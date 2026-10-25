// The deterministic half of the output filter, cheapest check first. Jev's
// checks (diagnosis, medical advice, claims to be human) join in step 2.
import type { ReplacedReason } from "../types";

export type FilterInput = {
  reply: string;
  lengthCap: number;
  allowedUrls: ReadonlySet<string>;
  knownNames: ReadonlySet<string>;
};

export type FilterResult = {
  violation: ReplacedReason | null;
  checks: { name: string; pass: boolean }[];
};

const URL_OR_DOMAIN =
  /\b(?:https?:\/\/[^\s)"'<>]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|io|ai|co|gov|health|app)(?:\/[^\s)"'<>]*)?)/giu;

// "Dr. Asha", "Ms Rao": an honorific followed by a capitalised word.
const HONORIFIC_NAME = /\b(?:Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gu;

function normaliseUrl(u: string): string {
  return u
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[.,;:!?]+$/u, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function filterReply(input: FilterInput): FilterResult {
  const checks: { name: string; pass: boolean }[] = [];

  const lengthOk = Array.from(input.reply).length <= input.lengthCap;
  checks.push({ name: "length", pass: lengthOk });
  if (!lengthOk) return { violation: "length", checks };

  const allowed = new Set([...input.allowedUrls].map(normaliseUrl));
  const urls = input.reply.match(URL_OR_DOMAIN) ?? [];
  const linksOk = urls.every((u) => allowed.has(normaliseUrl(u)));
  checks.push({ name: "links", pass: linksOk });
  if (!linksOk) return { violation: "link", checks };

  const known = new Set([...input.knownNames].map((n) => n.toLowerCase()));
  let namesOk = true;
  for (const m of input.reply.matchAll(HONORIFIC_NAME)) {
    const name = m[1].toLowerCase();
    if (![...known].some((k) => k.includes(name))) namesOk = false;
  }
  checks.push({ name: "names", pass: namesOk });
  if (!namesOk) return { violation: "name", checks };

  return { violation: null, checks };
}
