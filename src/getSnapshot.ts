import { sanitizeHtml } from "./sanitizeHtml";
import { Page, TemplateManifest } from "./types";
import { TEMPLATE_MANIFEST_PATH } from "./config";
import { existsSync, readFileSync } from "fs";
import { resolveTemplatesForUrl } from "./resolveTemplates";

// Some environments expose stable data-test* hooks instead of data-tags.
// Normalize them into a shared data-tags attribute so the snapshot + logger can rely on it.
async function ensureDataTags(page: Page) {
  await page.evaluate(() => {
    const attributeCandidates = [
      "data-tags",
      "data-tag",
      "data-tag-id",
      "data-testid",
      "data-test-id",
      "data-test",
      "data-test-selector",
      "data-test-automation",
      "data-test-action",
      "data-test-key",
      "data-qa",
      "data-qa-id",
      "data-cy",
      "data-cy-id",
    ];

    const prefixPatterns = [/^data-test[\w-]*/, /^data-qa[\w-]*/, /^data-cy[\w-]*/, /^data-tag[\w-]*/];

    const toTokens = (value: string) =>
      value
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean);

    const elements = Array.from(document.querySelectorAll("*"));
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;

      const tokens = new Set<string>();

      for (const attribute of attributeCandidates) {
        const attrValue = element.getAttribute(attribute);
        if (!attrValue) continue;
        for (const token of toTokens(attrValue)) {
          tokens.add(token);
        }
      }

      const attributeNames = element.getAttributeNames?.() ?? [];
      for (const attributeName of attributeNames) {
        if (attributeName === "data-tags") continue;
        if (!prefixPatterns.some((pattern) => pattern.test(attributeName))) continue;
        const attrValue = element.getAttribute(attributeName);
        if (!attrValue) continue;
        for (const token of toTokens(attrValue)) {
          tokens.add(token);
        }
      }

      if (!tokens.size) continue;
      element.setAttribute("data-tags", Array.from(tokens).join(" "));
    }
  });
}

function tryLoadManifest(): TemplateManifest | null {
  try {
    if (existsSync(TEMPLATE_MANIFEST_PATH)) {
      const data = JSON.parse(readFileSync(TEMPLATE_MANIFEST_PATH, "utf8"));
      return data;
    }
  } catch {
    // ignore
  }
  return null;
}

export const getSnapshot = async (page: Page) => {
  await ensureDataTags(page);
  const dom = sanitizeHtml(await page.content());
  const url = page.url();
  const manifest = tryLoadManifest();
  // Emberless mode: compute candidates from URL + manifest only.
  const stack = resolveTemplatesForUrl(url, manifest);

  return {
    dom,
    url,
    routeName: null, // Not using Ember; leave null on purpose
    renderStack: stack.candidates,
    primaryTemplate: stack.primary,
  };
};
