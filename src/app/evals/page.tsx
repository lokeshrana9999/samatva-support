import { config } from "@config";
import { crisisLinesFor } from "@/core/turn";
import { DemoFooter, Header } from "@/components/shell";

// Public and read-only. The scorecard arrives with the eval suites (steps 2 to
// 4); until a run is published this is the empty state from the design.
export default function EvalsPage() {
  return (
    <>
      <Header lines={crisisLinesFor(config, false)} />
      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        <h1 className="font-serif text-[28px] leading-[34px] font-semibold md:text-[32px] md:leading-10">Evals</h1>
        <p className="mt-4 text-muted">No eval run published yet.</p>
      </main>
      <DemoFooter />
    </>
  );
}
