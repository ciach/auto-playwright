import { existsSync, readFileSync } from "fs";
import { TEMPLATE_MANIFEST_PATH } from "./config";
import { ensureDataTags } from "./ensureDataTags";
import { resolveTemplatesForUrl } from "./resolveTemplates";
import { sanitizeHtml } from "./sanitizeHtml";
import { Page, TemplateManifest } from "./types";

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
