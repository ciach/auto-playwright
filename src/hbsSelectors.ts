import { existsSync, readFileSync } from "fs";
import * as path from "path";

import { HbsExtraction, HbsSelector, HbsValidation } from "./types";
import { HBS_SELECTOR_SOURCES, TEMPLATE_ROOT_DIR } from "./config";

function lower(s: string) {
  return (s || "").toLowerCase();
}

export function readHbsAbsolute(relOrAbs: string): { abs: string; content: string } {
  const normalized = relOrAbs.replace(/^\.?\/*/, "");
  const abs = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : normalized.startsWith("templates/")
    ? path.resolve(TEMPLATE_ROOT_DIR, normalized)
    : path.resolve(TEMPLATE_ROOT_DIR, "templates", normalized);
  const content = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  return { abs, content };
}

export function extractSelectorsFromHbs(relOrAbs: string): HbsExtraction {
  const { abs, content } = readHbsAbsolute(relOrAbs);
  const dataTest: HbsSelector[] = [];
  const ariaLabel: HbsSelector[] = [];
  const id: HbsSelector[] = [];

  if (content && HBS_SELECTOR_SOURCES.dataTest) {
    const re = /data-test-([a-z0-9\-]+)\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(content))) {
      dataTest.push({
        attr: "data-test",
        key: lower(m[1]),
        value: lower(m[2]),
        raw: m[0],
      });
    }
  }

  if (content && HBS_SELECTOR_SOURCES.ariaLabel) {
    const re = /aria-label\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(content))) {
      ariaLabel.push({ attr: "aria-label", value: lower(m[1]), raw: m[0] });
    }
  }

  if (content && HBS_SELECTOR_SOURCES.id) {
    const re = /id\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(content))) {
      id.push({ attr: "id", value: lower(m[1]), raw: m[0] });
    }
  }

  const total = dataTest.length + ariaLabel.length + id.length;
  return {
    path: abs,
    selectors: { dataTest, ariaLabel, id },
    counts: {
      dataTest: dataTest.length,
      ariaLabel: ariaLabel.length,
      id: id.length,
      total,
    },
  };
}

export function validateSelectorsAgainstDom(
  domHtml: string,
  extraction: HbsExtraction
): HbsValidation {
  const dom = lower(domHtml);
  const present: HbsSelector[] = [];
  const missing: HbsSelector[] = [];

  const hasDataTest = (s: HbsSelector) =>
    dom.includes(`data-test-${s.key}="${s.value}"`);
  const hasAria = (s: HbsSelector) => dom.includes(`aria-label="${s.value}"`);
  const hasId = (s: HbsSelector) => dom.includes(`id="${s.value}"`);

  const check = (arr: HbsSelector[], fn: (s: HbsSelector) => boolean) => {
    for (const sel of arr) (fn(sel) ? present : missing).push(sel);
  };

  check(extraction.selectors.dataTest, hasDataTest);
  check(extraction.selectors.ariaLabel, hasAria);
  check(extraction.selectors.id, hasId);

  const total = extraction.counts.total || 1;
  return {
    path: extraction.path,
    present,
    missing,
    coverage: present.length / total,
  };
}
