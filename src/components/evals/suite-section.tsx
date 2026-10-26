// One eval suite on /evals: run line, metric table, notes, and a collapsed
// "Where it falls short" list (D51). Server-rendered; the collapsible is a
// native <details>, so it needs no script.
import { formatDuration, formatRunAt, type Cell, type Suite } from "./scorecard";

function CellView({ cell }: { cell: Cell }) {
  if (cell.status === "pass") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {cell.text}
        <span aria-hidden className="text-accent">
          ✓
        </span>
        <span className="sr-only">meets target</span>
      </span>
    );
  }
  if (cell.status === "miss") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        {cell.text}
        <span aria-hidden className="text-warn">
          ⚠
        </span>
        <span className="text-warn">{cell.gap}</span>
      </span>
    );
  }
  return <>{cell.text}</>;
}

export function SuiteSection({ suite }: { suite: Suite }) {
  const headingId = `${suite.id}-heading`;
  return (
    <section id={suite.id} aria-labelledby={headingId} className="scroll-mt-4 border-t border-line pt-8">
      <h2 id={headingId} className="font-serif text-[22px] leading-7 font-semibold">
        {suite.title}
      </h2>
      <p className="mt-2">{suite.summary}</p>
      <ul className="mt-3 text-[14px] leading-5 text-muted">
        {suite.runs.map((r) => (
          <li key={r.label}>
            {r.label}: run {formatRunAt(r.runAt)} · {r.cases} cases · ${r.costUsd.toFixed(4)} · {formatDuration(r.seconds)}
            {r.note && <> · {r.note}</>}
          </li>
        ))}
      </ul>

      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="mt-4 max-w-full overflow-x-auto rounded-lg border border-line bg-surface"
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-[15px] leading-[22px] tabular-nums">
          <thead>
            <tr className="border-b border-line text-[14px] leading-5 text-muted">
              <th scope="col" className="sticky left-0 bg-surface px-3 py-2 font-medium">
                metric
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                target
              </th>
              {suite.columns.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suite.rows.map((row) => (
              <tr key={row.metric} className="border-b border-line last:border-b-0">
                <th scope="row" className="sticky left-0 max-w-[180px] bg-surface px-3 py-2 font-normal sm:max-w-none">
                  {row.metric}
                </th>
                <td className="px-3 py-2 text-muted">{row.target}</td>
                {row.cells.map((cell, i) => (
                  <td key={suite.columns[i]} className="px-3 py-2 font-medium">
                    <CellView cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {suite.notes.map((n) => (
        <p key={n} className="mt-3 text-[15px] text-muted">
          {n}
        </p>
      ))}

      <details className="mt-4 rounded-lg border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">
          Where it falls short ({suite.misses.length})
        </summary>
        {suite.misses.length === 0 ? (
          <p className="px-4 pb-4 text-muted">No failed or missed cases in this run.</p>
        ) : (
          <ul className="flex flex-col gap-3 px-4 pb-4">
            {suite.misses.map((m) => (
              <li key={`${m.target ?? ""}${m.id}`} className="border-t border-line pt-3 text-[15px] [overflow-wrap:anywhere]">
                <p className="font-medium">
                  {m.id}
                  {m.target && <span className="font-normal text-muted"> · {m.target}</span>}
                </p>
                <ol className="mt-1 list-none text-muted">
                  {m.input.map((line, i) => (
                    <li key={i}>
                      {m.input.length > 1 && <span aria-hidden>{i + 1}. </span>}
                      &ldquo;{line}&rdquo;
                    </li>
                  ))}
                </ol>
                <p className="mt-1">
                  <span className="text-muted">expected</span> {m.expected}
                </p>
                <p>
                  <span className="text-muted">got</span> {m.got}
                </p>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
