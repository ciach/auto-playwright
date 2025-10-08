import { Page } from "./types";

const ATTRIBUTE_CANDIDATES = [
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

const PREFIX_PATTERNS = [/^data-test[\w-]*/, /^data-qa[\w-]*/, /^data-cy[\w-]*/, /^data-tag[\w-]*/];

type EnsureDataTagsPayload = {
  attributeCandidates: string[];
  prefixPatterns: string[];
};

export async function ensureDataTags(page: Page) {
  await page.evaluate(({ attributeCandidates, prefixPatterns }: EnsureDataTagsPayload) => {
      const toTokens = (value: string) =>
        value
          .split(/[\s,]+/)
          .map((token) => token.trim())
          .filter(Boolean);

      const patterns = prefixPatterns.map((raw) => new RegExp(raw));
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
          if (!patterns.some((pattern) => pattern.test(attributeName))) continue;
          const attrValue = element.getAttribute(attributeName);
          if (!attrValue) continue;
          for (const token of toTokens(attrValue)) {
            tokens.add(token);
          }
        }

        if (!tokens.size) continue;
        element.setAttribute("data-tags", Array.from(tokens).join(" "));
      }
    },
    {
      attributeCandidates: ATTRIBUTE_CANDIDATES,
      prefixPatterns: PREFIX_PATTERNS.map((pattern) => pattern.source),
    },
  );
}
