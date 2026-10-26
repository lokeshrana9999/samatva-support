// "About this demo" on /evals (id `about`): what the app is, who it belongs
// to, and which services see message text. The intake disclosure points here,
// so the chat chain is read from config/providers.json, in its real order.
import { config } from "@config";
import { JEV_MODEL, TARGET_LABEL } from "./scorecard";

// shell.tsx is a client module, so its REPO_URL can't be read here.
const REPO_URL = "https://github.com/lokeshrana9999/samatva-support";

const PROVIDER_NAME: Record<string, string> = {
  google: "Google AI Studio",
  openrouter: "OpenRouter",
  alibaba: "Alibaba Model Studio",
};

export function AboutDemo() {
  const chain = config.providers.chat;
  const limits = config.limits;
  const services = [
    ...chain.map((p, i) => ({
      name: PROVIDER_NAME[p.id] ?? p.id,
      model: p.model,
      sees: i === 0 ? "Your messages" : "Your messages, only if the one above fails",
      why: i === 0 ? "Writes the chat replies" : "Fallback for the chat replies",
    })),
    {
      name: "TypeSafe",
      model: JEV_MODEL,
      sees: "Your messages and the assistant's draft replies",
      why: "Safety (risk) check, the needs record, and the reply checks",
    },
    {
      name: "Supabase, Mumbai",
      model: "Postgres",
      sees: "Your messages only if you tick the transcript box",
      why: `Transcripts deleted after 30 days or when you delete the conversation; otherwise a log of gate results and counters with no message text`,
    },
  ];

  return (
    <section id="about" aria-labelledby="about-heading" className="scroll-mt-4 border-t border-line pt-8">
      <h2 id="about-heading" className="font-serif text-[22px] leading-7 font-semibold">
        About this demo
      </h2>
      <p className="mt-2">
        samatva support is a chat assistant that listens first, works out what kind of help might fit, and points to
        linked Amaha services and sample therapist profiles. A controller in code owns the conversation stages and the
        safety gates; the language model only writes the wording inside them. It is an AI, not a clinician and not an
        emergency service.
      </p>
      <p className="mt-3">
        It is an independent demo by Lokesh, built for Amaha&apos;s AI Engineer application, and is not affiliated with
        Amaha. Therapist profiles are invented samples, not real clinicians. Amaha&apos;s service pages are linked, never
        copied.
      </p>

      <h3 className="mt-6 text-[17px] leading-6 font-semibold">Who sees what you type</h3>
      <div
        role="region"
        aria-labelledby="about-heading"
        tabIndex={0}
        className="mt-3 max-w-full overflow-x-auto rounded-lg border border-line bg-surface"
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-[15px] leading-[22px]">
          <thead>
            <tr className="border-b border-line text-[14px] leading-5 text-muted">
              <th scope="col" className="sticky left-0 bg-surface px-3 py-2 font-medium">
                service
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                model
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                sees
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                for
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="sticky left-0 bg-surface px-3 py-2 font-medium">
                  {s.name}
                </th>
                <td className="px-3 py-2 whitespace-nowrap">
                  <code className="text-[14px]">{s.model}</code>
                </td>
                <td className="px-3 py-2">{s.sees}</td>
                <td className="px-3 py-2 text-muted">{s.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[15px] text-muted">
        Each service handles text under its own terms. The app runs on Vercel in Mumbai. Your email at sign-in is kept
        only as a keyed hash, and IP addresses only as a daily salted hash for the limits: {limits.conversationTurns}{" "}
        turns a conversation, {limits.conversationsPerDay} conversations a day, and a ${limits.spendPerDayUsd} daily
        spend cap. The crisis lines never sit behind a limit.
      </p>

      <h3 className="mt-6 text-[17px] leading-6 font-semibold">How the evals above were run</h3>
      <p className="mt-2">
        The suites run on a developer machine, with real Jev, against two local chat targets:{" "}
        {TARGET_LABEL["claude-cli"]} and {TARGET_LABEL["grok-cli"]}. Local runs never use the deployed providers or their keys; the deployed chain is checked by
        spot turns on this site instead. Every case is synthetic. The code, cases and raw results are on{" "}
        <a className="text-accent underline underline-offset-2" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    </section>
  );
}
