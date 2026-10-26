"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { keyFromHash, retryMinutes } from "@/app/join/link";

type State = "idle" | "submitting" | "bad_email" | "link_dead" | "too_many" | "error";

// Holds the key across a reload of /join after the fragment is stripped. Tab
// scoped, and cleared once the key is used or refused.
const STASH = "samatva:join-key";

function stash(op: (s: Storage) => string | null | void): string | null {
  try {
    return op(sessionStorage) ?? null;
  } catch {
    return null;
  }
}

export function JoinForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [waitMinutes, setWaitMinutes] = useState(15);
  const keyRef = useRef<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // The fragment only exists in the browser. Read it once, then drop it from
  // the address bar and history entry straight away.
  useEffect(() => {
    const fromHash = keyFromHash(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    if (signedIn) {
      stash((s) => s.removeItem(STASH));
      router.replace("/");
      return;
    }
    const key = fromHash ?? stash((s) => s.getItem(STASH));
    if (!key) {
      router.replace("/login");
      return;
    }
    stash((s) => s.setItem(STASH, key));
    keyRef.current = key;
  }, [signedIn, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyRef.current) return;
    setState("submitting");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, accessKey: keyRef.current }),
    }).catch(() => null);
    if (res?.status === 204) {
      stash((s) => s.removeItem(STASH));
      router.replace("/");
      router.refresh();
      return;
    }
    if (res?.status === 429) {
      setWaitMinutes(retryMinutes(res.headers.get("Retry-After")));
      setState("too_many");
      return;
    }
    if (res?.status === 401) {
      stash((s) => s.removeItem(STASH));
      keyRef.current = null;
      setState("link_dead");
      return;
    }
    if (res?.status === 400) {
      setState("bad_email");
      emailRef.current?.focus();
      return;
    }
    setState("error");
  }

  const input =
    "mt-1 block min-h-11 w-full rounded-lg border border-input-border bg-surface px-3 text-ink";

  if (state === "link_dead") {
    return (
      <p role="alert" className="text-danger">
        This link no longer works. Ask Lokesh for a new one, or{" "}
        <Link href="/login" className="underline">
          sign in with an access key
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="block">
        <span className="font-medium">Email</span>
        <input
          ref={emailRef}
          className={input}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={state === "bad_email"}
          aria-describedby={state === "bad_email" ? "email-error" : "email-hint"}
        />
        <span id="email-hint" className="sr-only">
          Enter an email address, like name@example.com.
        </span>
        {state === "bad_email" && (
          <span id="email-error" role="alert" className="mt-1 block text-[14px] text-danger">
            That email doesn&apos;t look right. Check it and try again.
          </span>
        )}
      </label>
      {state === "too_many" && (
        <p role="alert" className="text-[14px] text-danger">
          Too many tries. Wait {waitMinutes} {waitMinutes === 1 ? "minute" : "minutes"}, then try again.
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="text-[14px] text-danger">
          Couldn&apos;t sign in just now. Try again.
        </p>
      )}
      <button
        type="submit"
        disabled={!email || state === "submitting" || state === "too_many"}
        className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-50"
      >
        {state === "submitting" ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
