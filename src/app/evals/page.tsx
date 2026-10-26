import type { Metadata } from "next";
import { config } from "@config";
import { crisisLinesFor } from "@/core/turn";
import { DemoFooter, Header } from "@/components/shell";
import { AboutDemo } from "@/components/evals/about";
import { buildScorecard, formatDay, JEV_MODEL, TARGET_LABEL } from "@/components/evals/scorecard";
import { SuiteSection } from "@/components/evals/suite-section";

export const metadata: Metadata = { title: "Evals · samatva support" };

// Public and read-only: a scorecard per suite, built at build time from the
// committed results in evals/results (design, "/evals"). No model calls.
export default function EvalsPage() {
  const { suites, caseCount, firstRun, lastRun } = buildScorecard();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const span = formatDay(firstRun) === formatDay(lastRun) ? formatDay(lastRun) : `${formatDay(firstRun)} to ${formatDay(lastRun)}`;
  return (
    <>
      <Header lines={crisisLinesFor(config, false)} />
      <main className="mx-auto flex max-w-[960px] min-w-0 flex-col gap-8 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-serif text-[28px] leading-[34px] font-semibold md:text-[32px] md:leading-10">Evals</h1>
          <p className="mt-3 text-muted">
            Runs {span}
            {commit && <> · deployed from commit {commit}</>} · {caseCount} synthetic cases, English and Hinglish
          </p>
          <p className="text-muted">
            Targets: {TARGET_LABEL["claude-cli"]}, {TARGET_LABEL["grok-cli"]} · safety model {JEV_MODEL}
          </p>
          <nav aria-label="On this page" className="mt-4 text-[15px]">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {[...suites.map((s) => [s.id, s.title]), ["about", "About this demo"]].map(([id, title]) => (
                <li key={id}>
                  <a className="inline-flex min-h-11 items-center text-accent underline underline-offset-2" href={`#${id}`}>
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-2 text-[15px]">
            A <span className="text-accent">✓</span> marks a result that meets its target; a{" "}
            <span className="text-warn">⚠</span> marks a miss and says by how much. &ldquo;Reported&rdquo; rows have no
            target. Every case is synthetic and written by the builder, so read these as smoke tests, not benchmarks.
          </p>
        </div>
        {suites.map((s) => (
          <SuiteSection key={s.id} suite={s} />
        ))}
        <AboutDemo />
      </main>
      <DemoFooter />
    </>
  );
}
