/**
 * Golden eval runner (item B) — measures real Hebrew date-resolution accuracy against live Claude.
 *
 *   pnpm eval         (from platform/)   or   pnpm --filter @homeos/server eval
 *
 * Requires ANTHROPIC_API_KEY. This is DELIBERATELY NOT part of `pnpm test` / CI — the unit suite
 * never hits the network or a real model (project guardrail). Run it by hand after any prompt or
 * model change; corrections feed back into golden.json. `date_iso` is the pass/fail gate; other
 * fields are reported as soft diffs.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicRawParse, createParser } from "../src/parsing/parser.ts";
import { compareMessage, type GoldenCase } from "./compare.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "golden.json"), "utf8")) as GoldenCase[];
const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const parse = createParser(anthropicRawParse(new Anthropic(), model));

console.log(`Running ${cases.length} golden cases on ${model}…\n`);

let passed = 0;
for (const c of cases) {
  const actual = await parse(c.input, c.today);
  const result = compareMessage(c.expected, actual);
  if (result.pass) {
    passed += 1;
    console.log(`✅ ${c.name}`);
  } else {
    console.log(
      `❌ ${c.name} (expected ${result.countExpected} event(s), got ${result.countActual})`,
    );
    result.events.forEach((ev, i) => {
      for (const d of ev.diffs) {
        const tag = d.strict ? "" : " (soft)";
        console.log(
          `     [${i}] ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}${tag}`,
        );
      }
    });
  }
}

const pct = cases.length ? Math.round((100 * passed) / cases.length) : 0;
console.log(`\nDate-resolution accuracy: ${passed}/${cases.length} (${pct}%) on ${model}`);
