import { config } from "@config";
import { crisisLinesFor } from "@/core/turn";
import { CrisisStrip } from "@/components/crisis";
import { JoinForm } from "@/components/join-form";
import { DemoFooter, Header } from "@/components/shell";
import { requireReviewer } from "@/app/lib/reviewer";

// No server redirect when already signed in: a redirect would carry the
// `#k=` fragment over to `/`. JoinForm strips it first, then moves on (D54).
export default async function JoinPage() {
  const signedIn = Boolean(await requireReviewer());
  const lines = crisisLinesFor(config, false);
  return (
    <>
      <Header lines={lines} />
      <main className="mx-auto max-w-[680px] px-4 py-8 sm:px-6">
        <h1 className="font-serif text-[28px] leading-[34px] font-semibold md:text-[32px] md:leading-10">
          Reviewer access
        </h1>
        <p className="mt-3">This demo is open to reviewers. Enter your email to continue.</p>
        <p className="mt-2 text-[14px] leading-5 text-muted">
          Your email is stored only as a one-way hash, to apply per-reviewer limits. It&apos;s never shown or used
          to contact you.
        </p>
        <div className="mt-6">
          <JoinForm signedIn={signedIn} />
        </div>
        <div className="mt-8">
          <CrisisStrip lines={lines} />
        </div>
      </main>
      <DemoFooter />
    </>
  );
}
