#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TEMPLATES_DIR = join(ROOT, "templates");
const OUT = join(ROOT, "var/llm/template-manifest.json");

function isComponent(p) { return p.includes("/components/"); }
function isSubstate(p) { return /-(loading|error)\.hbs$/.test(p); }
function toRouteName(p) {
  return p.replace(/^templates\//, "").replace(/\.hbs$/, "").replace(/\//g, ".");
}

async function walk(dir, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else if (e.isFile() && e.name.endsWith(".hbs")) acc.push(full);
  }
  return acc;
}

function extractIndexes(content, path) {
  const dataTest = {};
  const ariaLabel = {};
  const id = {};

  // data-test-<key>="value"
  const reData = /data-test-([a-z0-9\-]+)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = reData.exec(content))) {
    const key = `${m[1]}:${m[2]}`.toLowerCase();
    (dataTest[key] ||= []).push(path);
  }

  // aria-label="value"
  const reAria = /aria-label\s*=\s*"([^"]+)"/gi;
  while ((m = reAria.exec(content))) {
    const key = m[1].toLowerCase();
    (ariaLabel[key] ||= []).push(path);
  }

  // id="value" (last resort)
  const reId = /id\s*=\s*"([^"]+)"/gi;
  while ((m = reId.exec(content))) {
    const key = m[1].toLowerCase();
    (id[key] ||= []).push(path);
  }

  return { dataTest, ariaLabel, id };
}

function mergeIndex(dst, src) {
  for (const [k, arr] of Object.entries(src)) {
    (dst[k] ||= []);
    for (const p of arr) if (!dst[k].includes(p)) dst[k].push(p);
  }
}

(async () => {
  const files = (await walk(TEMPLATES_DIR)).map(f => f.replace(ROOT + "/", "").replace(/\\/g, "/"));
  const entries = [];
  const idxData = {}, idxAria = {}, idxId = {};

  for (const path of files) {
    const kind = isComponent(path) ? "component" : isSubstate(path) ? "substate" : "route";
    const e = { path, kind };
    if (kind === "route") e.routeName = toRouteName(path);
    entries.push(e);

    // build indexes
    const content = await fs.readFile(join(ROOT, path), "utf8");
    const { dataTest, ariaLabel, id } = extractIndexes(content, path);
    mergeIndex(idxData, dataTest);
    mergeIndex(idxAria, ariaLabel);
    mergeIndex(idxId, id);
  }

  await fs.mkdir(join(ROOT, "var/llm"), { recursive: true });
  await fs.writeFile(
    OUT,
    JSON.stringify({ entries, indexes: { dataTest: idxData, ariaLabel: idxAria, id: idxId } }, null, 2),
  );
  console.log(`Wrote ${entries.length} entries to ${OUT}`);
})();
