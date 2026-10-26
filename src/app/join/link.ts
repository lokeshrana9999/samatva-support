// The reviewer magic link (D54) carries the access key in the URL fragment,
// `/join#k=<key>`, which browsers never send to the server, so the key stays
// out of request logs and Referer headers.

const MAX_KEY = 200; // matches the /api/login body limit

export function keyFromHash(hash: string): string | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of body.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== "k") continue;
    let key: string;
    try {
      key = decodeURIComponent(part.slice(eq + 1)).trim();
    } catch {
      return null;
    }
    return key && key.length <= MAX_KEY ? key : null;
  }
  return null;
}

// Whole minutes to wait from a 429's Retry-After (seconds), at least 1.
export function retryMinutes(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 15;
}
