"use client";
// Crisis lines in every variant the screens need, plus the "Need help now?"
// sheet. The default list is baked in at build from config (D53).
import * as Dialog from "@radix-ui/react-dialog";
import type { CrisisLine } from "@/core/types";

// "Emergency (112)" already carries its number; repeating it reads as
// "Emergency (112) 112" to a screen reader.
function lineName(l: CrisisLine, sep: string): string {
  return l.label.includes(l.number) ? l.label : `${l.label}${sep}${l.number}`;
}

export function CrisisLineList({
  lines,
  variant,
}: {
  lines: CrisisLine[];
  variant: "list" | "panel" | "compact";
}) {
  if (variant === "compact") {
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] leading-5">
        {lines.map((l) => (
          <li key={l.id}>
            <a className="font-medium text-accent underline underline-offset-2" href={l.telHref}>
              {lineName(l, ": ")}
            </a>
          </li>
        ))}
      </ul>
    );
  }
  const big = variant === "panel";
  return (
    <ul className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <li key={l.id}>
          <a
            href={l.telHref}
            className={`flex w-full flex-col rounded-lg bg-urgent-btn px-4 text-on-urgent-btn ${
              big && i === 0 ? "min-h-16 py-3" : "min-h-14 py-2"
            } justify-center`}
          >
            <span className={big && i === 0 ? "text-[19px] font-semibold" : "font-semibold"}>
              Call {lineName(l, " · ")}
            </span>
            <span className="text-[14px] leading-5 opacity-90">{l.note}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SourcesCaption({ lines }: { lines: CrisisLine[] }) {
  const checked = lines.map((l) => l.checkedAt).sort()[0];
  return (
    <p className="mt-3 text-[13px] leading-[18px] text-urgent-ink">
      Numbers checked {checked}, sources:{" "}
      {lines.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ", "}
          <a className="underline" href={l.sourceUrl} target="_blank" rel="noopener noreferrer">
            {l.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      ))}
    </p>
  );
}

export function CrisisStrip({ lines }: { lines: CrisisLine[] }) {
  const [first, ...rest] = lines;
  return (
    <div className="rounded-xl border border-urgent-border bg-urgent-bg p-4 text-urgent-ink">
      <p className="font-semibold">
        In danger now?{" "}
        <a className="underline" href={first.telHref}>
          Call {first.number}.
        </a>
      </p>
      <p className="mt-1 text-[14px] leading-5">
        {rest.slice(0, 2).map((l, i) => (
          <span key={l.id}>
            {i > 0 && " · "}
            <a className="underline" href={l.telHref}>
              {lineName(l, " ")}
            </a>
          </span>
        ))}
      </p>
      <NeedHelpSheet lines={lines} trigger={<button className="mt-2 text-[14px] font-medium underline">All helplines</button>} />
    </div>
  );
}

export function NeedHelpSheet({ lines, trigger }: { lines: CrisisLine[]; trigger?: React.ReactNode }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button className="min-h-11 rounded-lg border border-urgent-border bg-urgent-bg px-3 text-[14px] font-semibold text-urgent-ink">
            Need help now?
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-xl border border-line bg-surface p-6 md:inset-x-auto md:inset-y-0 md:right-0 md:w-[420px] md:rounded-none md:rounded-l-xl">
          <Dialog.Title className="font-serif text-[22px] leading-7 font-semibold">Talk to a person now</Dialog.Title>
          <Dialog.Description className="mt-2 text-muted">
            These are free helplines in India. If you&apos;re in immediate danger, call 112.
          </Dialog.Description>
          <div className="mt-4">
            <CrisisLineList lines={lines} variant="list" />
          </div>
          <Dialog.Close className="mt-6 min-h-11 w-full rounded-lg border border-input-border px-4 font-medium">
            Close
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
