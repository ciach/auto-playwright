#!/usr/bin/env node
/**
 * Generate a simple manifest of Ember templates for LLM routing.
 *
 * Usage: node scripts/generate-template-manifest.mjs
 * Output: var/llm/template-manifest.json
 */
import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "var/llm");
const outFile = join(outDir, "template-manifest.json");

const isComponent = (p) => p.includes("/components/");
const isSubstate = (p) => /-(loading|error)\.hbs$/.test(p);
const toRouteName = (p) => {
  // strip leading templates/ and trailing .hbs and convert / to .
  let body = p.replace(/^templates\//, "").replace(/\.hbs$/, "");
  return body.replace(/\//g, ".");
};

async function main() {
  const patterns = ["templates/**/*.hbs"];
  const files = await glob(patterns, { cwd: root, nodir: true });
  const entries = [];
  for (const rel of files) {
    const path = rel.replace(/\\/g, "/");
    const entry = {
      path,
      kind: isComponent(path) ? "component" : isSubstate(path) ? "substate" : "route",
    };
    if (entry.kind === "route") {
      entry.routeName = toRouteName(path);
    }
    entries.push(entry);
  }
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({ entries }, null, 2));
  console.log(`Wrote ${entries.length} entries to ${relative(root, outFile)}` );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
