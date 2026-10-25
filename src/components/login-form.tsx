"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type State = "idle" | "submitting" | "wrong_key" | "error";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<State>("idle");
  const keyRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, accessKey: key }),
    }).catch(() => null);
    if (res?.status === 204) {
      router.replace("/");
      router.refresh();
      return;
    }
    if (res?.status === 401) {
      setState("wrong_key");
      keyRef.current?.focus();
      return;
    }
    setState("error");
  }

  const input =
    "mt-1 block min-h-11 w-full rounded-lg border border-input-border bg-surface px-3 text-ink";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate={false}>
      <label className="block">
        <span className="font-medium">Email</span>
        <input
          className={input}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="email-hint"
        />
        <span id="email-hint" className="sr-only">
          Enter an email address, like name@example.com.
        </span>
      </label>
      <label className="block">
        <span className="font-medium">Access key</span>
        <span className="mt-1 flex gap-2">
          <input
            ref={keyRef}
            className={`${input} mt-0`}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={state === "wrong_key"}
            aria-describedby={state === "wrong_key" ? "key-error" : undefined}
          />
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg border border-input-border px-3 text-[14px]"
            onClick={() => setShow((s) => !s)}
            aria-pressed={show}
          >
            {show ? "Hide" : "Show"}
          </button>
        </span>
        {state === "wrong_key" && (
          <span id="key-error" role="alert" className="mt-1 block text-[14px] text-danger">
            That key didn&apos;t work. Check it, or ask Lokesh for the current one.
          </span>
        )}
      </label>
      {state === "error" && (
        <p role="alert" className="text-[14px] text-danger">
          Couldn&apos;t sign in just now. Try again.
        </p>
      )}
      <button
        type="submit"
        disabled={!email || !key || state === "submitting"}
        className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-50"
      >
        {state === "submitting" ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
