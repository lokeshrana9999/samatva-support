"use client";
// Recommendation cards: catalogue fields only, nothing model-written (D48).
// Therapists are synthetic samples and say so on the card.
import { useState } from "react";
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

function TherapistCard({ c }: { c: Card }) {
  const [all, setAll] = useState(false);
  const shown = all ? c.specialties : c.specialties.slice(0, 3);
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold tracking-wide text-muted">THERAPIST · SAMPLE PROFILE</p>
      <h3 className="mt-1 text-[17px] leading-6 font-semibold">{c.name}</h3>
      <p>{c.title}</p>
      {c.languages.length > 0 && <p className="text-[15px]">Speaks {c.languages.join(", ")}</p>}
      {shown.length > 0 && (
        <p className="text-[15px]">
          {shown.join(" · ")}
          {!all && c.specialties.length > 3 && (
            <button
              className="ml-2 underline"
              onClick={() => setAll(true)}
              aria-label={`Show ${c.specialties.length - 3} more specialties`}
            >
              +{c.specialties.length - 3}
            </button>
          )}
        </p>
      )}
      <p className="text-[15px] text-muted">{[c.modes.join(", "), c.cities.join(", ")].filter(Boolean).join(" · ")}</p>
      <ExternalLink
        href={c.url}
        label="Find a therapist on Amaha"
        ariaLabel={`Find a real therapist on amahahealth.com for the kind of help in the sample profile ${c.name}`}
      />
      <p className="mt-1 text-[13px] leading-[18px] text-muted">
        Sample profile, not a real clinician, so they can&apos;t be booked. The link goes to Amaha&apos;s real booking
        page for this kind of help.
      </p>
    </article>
  );
}

function ServiceCard({ c }: { c: Card }) {
  return (
    <article className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold tracking-wide text-muted">SERVICE</p>
      <h3 className="mt-1 text-[17px] leading-6 font-semibold">{c.name}</h3>
      {c.summary && <p>{c.summary}</p>}
      <p className="text-[15px] text-muted">{[c.modes.join(", "), c.cities.join(", ")].filter(Boolean).join(" · ")}</p>
      <ExternalLink href={c.url} label="View on amahahealth.com" ariaLabel={`View ${c.name} on amahahealth.com`} />
      <p className="mt-1 text-[13px] leading-[18px] text-muted">Summary in our own words; details are on Amaha&apos;s page.</p>
    </article>
  );
}

export function RecommendationCards({ cards }: { cards: Card[] }) {
  const services = cards.filter((c) => c.kind === "service");
  const therapists = cards.filter((c) => c.kind === "therapist");
  return (
    <div className="flex flex-col gap-3">
      {services.map((c) => (
        <ServiceCard key={c.id} c={c} />
      ))}
      {therapists.map((c) => (
        <TherapistCard key={c.id} c={c} />
      ))}
    </div>
  );
}
