// Runs after `next build`, which Vercel runs on every deploy, so a regression
// blocks the deploy. Two checks:
// 1. The production server bundle contains no local CLI adapters (spec 5d,
//    acceptance check 35).
// 2. Nothing that ships, server or browser, carries the therapist case study:
//    no sample profile name, no therapist search tool, no therapist card
//    (docs/case-studies/therapist-matching.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const next = path.join(process.cwd(), ".next");

function* files(dir, exts) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p, exts);
    else if (exts.some((e) => p.endsWith(e))) yield p;
  }
}

function scan(dirs, exts, markers) {
  const hits = [];
  for (const dir of dirs) {
    for (const f of files(dir, exts)) {
      const text = readFileSync(f, "utf8");
      const found = markers.filter((m) => text.includes(m));
      if (found.length) hits.push(`${path.relative(process.cwd(), f)} (${found.join(", ")})`);
    }
  }
  return hits;
}

let failed = false;

const cli = scan([path.join(next, "server")], [".js"], ["--no-session-persistence", "samatva-grok-"]);
if (cli.length) {
  console.error(`check-bundle: local CLI code found in the production server bundle:\n  ${cli.join("\n  ")}`);
  failed = true;
} else console.log("check-bundle: no local CLI code in the server bundle");

const caseStudy = JSON.parse(readFileSync(path.join(process.cwd(), "case-studies/therapist-matching/therapists.json"), "utf8"));
const therapistMarkers = [
  ...caseStudy.therapists.map((t) => t.name),
  "search_therapists",
  "searchTherapists",
  "SAMPLE PROFILE",
  "Sample profile, not a real clinician",
];
// .html, .rsc and .body cover prerendered pages, .js both bundles and .json
// the manifests. Source maps are skipped: they don't ship code that runs.
const therapist = scan([path.join(next, "server"), path.join(next, "static")], [".js", ".json", ".html", ".rsc", ".body"], therapistMarkers);
if (therapist.length) {
  console.error(`check-bundle: therapist case-study content found in the build:\n  ${therapist.join("\n  ")}`);
  failed = true;
} else console.log(`check-bundle: no therapist case-study content in the build (${therapistMarkers.length} markers)`);

if (failed) process.exit(1);
