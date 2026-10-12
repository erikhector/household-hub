// Runs npm scripts at the same time and prints each one's output in one
// piece as it finishes, so `npm run check` takes as long as its slowest
// step rather than the sum of all three. Output is buffered per script
// instead of streamed because interleaved lines from lint, tsc and vitest
// are unreadable, and agents read this output. Every script runs to the
// end even when another fails, so one run reports every failure. No
// dependency (concurrently, npm-run-all) for what fits in a page.
//
//   node scripts/run-parallel.mjs lint typecheck test
import { spawn } from "node:child_process";

const names = process.argv.slice(2);
// The children write to pipes, so they'd drop colour; keep it when a
// person is watching.
const env = process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env;

const codes = await Promise.all(
  names.map(
    (name) =>
      new Promise((resolve) => {
        const started = Date.now();
        const child = spawn("npm", ["run", "--silent", name], { env, shell: process.platform === "win32" });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (code) => {
          const seconds = ((Date.now() - started) / 1000).toFixed(1);
          const status = code === 0 ? "passed" : `failed (exit ${code})`;
          process.stdout.write(`\n── ${name}: ${status} in ${seconds}s ──\n${output}`);
          resolve(code);
        });
      }),
  ),
);

const failed = names.filter((_, i) => codes[i] !== 0);
console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : `\nAll passed: ${names.join(", ")}`);
process.exit(failed.length ? 1 : 0);
