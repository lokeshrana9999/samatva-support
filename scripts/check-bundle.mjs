// Fails the build if the production server bundle contains the local CLI
// adapters (spec 5d, acceptance check 35). Runs after `next build`, which
// Vercel runs on every deploy, so a regression blocks the deploy.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MARKERS = ["--no-session-persistence", "samatva-grok-"];
const root = path.join(process.cwd(), ".next", "server");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith(".js")) yield p;
  }
}

const hits = [];
for (const f of files(root)) {
  const text = readFileSync(f, "utf8");
  if (MARKERS.some((m) => text.includes(m))) hits.push(path.relative(process.cwd(), f));
}

if (hits.length) {
  console.error(`check-bundle: local CLI code found in the production server bundle:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log("check-bundle: no local CLI code in the server bundle");
