// Recommendation cards: catalogue fields only, nothing model-written (D48).
// Every card is a kind of help linked to a free public resource; the app shows
// no therapist profiles (docs/case-studies/therapist-matching.md).
import type { Card } from "@/core/types";

export function HelpTypeChips({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div>
      <p className="text-[14px] font-medium text-muted">Kinds of help that fit</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {labels.map((l) => (
          <li key={l} className="rounded-full border border-line bg-surface px-3 py-1 text-[14px] font-medium leading-5">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The bare domain a card links to, shown so the person knows where they're going.
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

function ExternalLink({ href, label, ariaLabel }: { href: string; label: string; ariaLabel: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex min-h-11 items-center gap-1 font-medium text-accent underline underline-offset-2"
      aria-label={`${ariaLabel}, opens in a new tab`}
    >
      {label}
      <span aria-hidden>↗</span>
    </a>
  );
}

function ServiceCard({ c }: { c: Card }) {
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold tracking-wide text-muted">SERVICE</p>
      <h3 className="mt-1 text-[17px] leading-6 font-semibold">{c.name}</h3>
      <p>{c.summary}</p>
      <p className="text-[15px] text-muted">{[c.modes.join(", "), c.cities.join(", ")].filter(Boolean).join(" · ")}</p>
      <ExternalLink href={c.url} label={`View on ${host(c.url)}`} ariaLabel={`View ${c.name} on ${host(c.url)}`} />
      <p className="mt-1 text-[13px] leading-[18px] text-muted">
        Summary in our own words; the link goes to a free public resource, not a booking page.
      </p>
    </article>
  );
}

export function RecommendationCards({ cards }: { cards: Card[] }) {
  return (
    <div className="flex flex-col gap-3">
      {cards.map((c) => (
        <ServiceCard key={c.id} c={c} />
      ))}
    </div>
  );
}
