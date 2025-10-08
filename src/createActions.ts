import { Page } from "@playwright/test";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { RunnableFunctionWithParse } from "openai/lib/RunnableFunction";
import * as path from "path";
import { z } from "zod";
import {
  ENABLE_PER_ACTION_HBS_COVERAGE,
  HBS_COVERAGE_FAIL_BELOW_THRESHOLD,
  HBS_COVERAGE_MIN_THRESHOLD,
  HBS_COVERAGE_TRIGGER_PREFIXES,
  TEMPLATE_MANIFEST_PATH,
  TEMPLATE_ROOT_DIR,
} from "./config";
import { ensureDataTags } from "./ensureDataTags";
import {
  extractSelectorsFromHbs,
  readHbsAbsolute,
  validateSelectorsAgainstDom,
} from "./hbsSelectors";
import { resolveTemplatesForUrl } from "./resolveTemplates";
import { getSanitizeOptions } from "./sanitizeHtml";
import { ElementInteraction, TemplateManifest } from "./types";

export const createActions = (
  page: Page,
  interactionLog: ElementInteraction[] = [],
): Record<string, RunnableFunctionWithParse<any>> => {
  // ---- Helpers for route/template resolution ----
  type Manifest = TemplateManifest;
  const tryLoadManifest = (): Manifest | null => {
    try {
      if (existsSync(TEMPLATE_MANIFEST_PATH)) {
        return JSON.parse(readFileSync(TEMPLATE_MANIFEST_PATH, "utf8")) as Manifest;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const normalizeUrlSegments = (rawUrl: string): string[] => {
    if (!rawUrl) return [];
    try {
      const url = rawUrl.startsWith("http") ? new URL(rawUrl) : new URL(rawUrl, "http://x");
      return url.pathname
        .split("/")
        .map((segment) => segment.toLowerCase())
        .filter(Boolean);
    } catch {
      return rawUrl
        .replace(/^https?:\/\/[^/]+/, "")
        .split("/")
        .map((segment) => segment.toLowerCase())
        .filter(Boolean);
    }
  };

  const templatePathToSegments = (templatePath: string): string[] => {
    if (!templatePath) return [];
    return templatePath
      .replace(/^templates\//, "")
      .replace(/\.hbs$/, "")
      .split("/")
      .map((segment) => segment.toLowerCase())
      .filter(Boolean);
  };

  const lastRealSegment = (segments: string[]): string | null => {
    if (!segments.length) return null;
    const tail = segments[segments.length - 1];
    if (tail === "index" && segments.length > 1) {
      return segments[segments.length - 2];
    }
    return tail;
  };

  const rankTemplatesByUrl = (url: string, candidates: Iterable<string>): string[] => {
    const urlSegments = normalizeUrlSegments(url);
    const uniqueCandidates = Array.from(new Set(candidates));
    const scored = uniqueCandidates.map((candidatePath) => {
      const segments = templatePathToSegments(candidatePath);
      const overlap = segments.filter((segment) => urlSegments.includes(segment)).length;
      const tail = lastRealSegment(segments);
      const bonusTail = tail && urlSegments.includes(tail) ? 3 : 0;
      const penaltyDepth = Math.max(0, segments.length - urlSegments.length);
      const score = overlap * 3 + bonusTail - penaltyDepth;
      return { path: candidatePath, score, depth: segments.length };
    });
    scored.sort((a, b) => b.score - a.score || b.depth - a.depth || a.path.localeCompare(b.path));
    return scored.map((entry) => entry.path);
  };

  type AttributeLookupArgs = {
    dataTestKey?: string;
    dataTestValue?: string;
    ariaLabel?: string;
    id?: string;
  };

  const resolveByAttributes = (
    manifest: Manifest | null,
    url: string,
    attrs: AttributeLookupArgs,
  ): { candidates: string[]; primaryTemplate: string | null; reason: string } => {
    if (!manifest) {
      return { candidates: [], primaryTemplate: null, reason: "no-manifest" };
    }

    const indexes = manifest.indexes;
    if (!indexes) {
      return { candidates: [], primaryTemplate: null, reason: "no-indexes" };
    }

    const candidates = new Set<string>();
    const normalizedDataTestKey = attrs.dataTestKey?.trim().toLowerCase();
    const normalizedDataTestValue = attrs.dataTestValue?.trim().toLowerCase();

    if (normalizedDataTestKey && normalizedDataTestValue && indexes.dataTest) {
      const lookupKey = `${normalizedDataTestKey}:${normalizedDataTestValue}`;
      for (const entry of indexes.dataTest[lookupKey] ?? []) {
        candidates.add(entry);
      }
    }

    const normalizedAriaLabel = attrs.ariaLabel?.trim().toLowerCase();
    if (normalizedAriaLabel && indexes.ariaLabel) {
      for (const entry of indexes.ariaLabel[normalizedAriaLabel] ?? []) {
        candidates.add(entry);
      }
    }

    const normalizedId = attrs.id?.trim().toLowerCase();
    if (normalizedId && indexes.id) {
      for (const entry of indexes.id[normalizedId] ?? []) {
        candidates.add(entry);
      }
    }

    if (candidates.size === 0) {
      return { candidates: [], primaryTemplate: null, reason: "no-attribute-match" };
    }

    const ordered = rankTemplatesByUrl(url, candidates);
    return {
      candidates: ordered,
      primaryTemplate: ordered[0] ?? null,
      reason: "attribute-match",
    };
  };

  const resolveForUrl = (url: string, manifest: Manifest | null) =>
    resolveTemplatesForUrl(url, manifest);

  type AttributeSignal = {
    attr: "data-test" | "aria-label" | "id";
    key?: string;
    value: string;
    needle: string;
  };

  const fallbackTemplate = (stack: { candidates: string[]; primary: string | null }) =>
    stack.primary ?? stack.candidates[0] ?? "templates/application.hbs";

  const getLastInteractionAttributes = (): Record<string, string> | null => {
    for (let i = interactionLog.length - 1; i >= 0; i--) {
      const attrs = interactionLog[i]?.element?.attributes;
      if (attrs && Object.keys(attrs).length > 0) {
        return attrs;
      }
    }
    return null;
  };

  const buildSignalsFromAttributes = (attrs: Record<string, string>): AttributeSignal[] => {
    const signals: AttributeSignal[] = [];
    for (const [rawName, rawValue] of Object.entries(attrs)) {
      if (!rawValue) continue;
      const name = rawName.toLowerCase();
      const value = String(rawValue).toLowerCase();
      if (name === "aria-label" || name === "id") {
        signals.push({
          attr: name as "aria-label" | "id",
          value,
          needle: `${name}="${value}"`,
        });
      } else if (name === "data-test") {
        signals.push({ attr: "data-test", value, needle: `${name}="${value}"` });
      } else if (name.startsWith("data-test-")) {
        const key = name.slice("data-test-".length);
        signals.push({ attr: "data-test", key, value, needle: `${name}="${value}"` });
      }
    }
    return signals;
  };

  const candidateMatchesSignals = (candidate: string, signals: AttributeSignal[]): boolean => {
    if (!signals.length) return false;
    const extraction = extractSelectorsFromHbs(candidate);
    let rawContent: string | null = null;
    const ensureRaw = () => {
      if (rawContent === null) {
        rawContent = readHbsAbsolute(candidate).content.toLowerCase();
      }
      return rawContent;
    };

    return signals.some((signal) => {
      if (signal.attr === "data-test") {
        const structured = extraction.selectors.dataTest.some((sel) => {
          if (signal.key && sel.key) {
            return sel.key === signal.key && sel.value === signal.value;
          }
          return !signal.key && !sel.key && sel.value === signal.value;
        });
        if (structured) return true;
        return ensureRaw().includes(signal.needle);
      }
      if (signal.attr === "aria-label") {
        if (extraction.selectors.ariaLabel.some((sel) => sel.value === signal.value)) {
          return true;
        }
        return ensureRaw().includes(signal.needle);
      }
      if (signal.attr === "id") {
        if (extraction.selectors.id.some((sel) => sel.value === signal.value)) {
          return true;
        }
        return ensureRaw().includes(signal.needle);
      }
      return false;
    });
  };

  const pickTemplateUsingLastElement = (
    stack: { candidates: string[]; primary: string | null },
  ): {
    chosen: string;
    matches: string[];
    lastElementAttributes: Record<string, string> | null;
  } => {
    const attrs = getLastInteractionAttributes();
    const fallback = fallbackTemplate(stack);
    if (!attrs) {
      return { chosen: fallback, matches: [], lastElementAttributes: null };
    }

    const signals = buildSignalsFromAttributes(attrs);
    if (!signals.length) {
      return { chosen: fallback, matches: [], lastElementAttributes: attrs };
    }

    const matches: string[] = [];
    for (const candidate of stack.candidates) {
      if (candidateMatchesSignals(candidate, signals)) {
        matches.push(candidate);
      }
    }

    const chosen = matches[0] ?? fallback;
    return { chosen, matches, lastElementAttributes: attrs };
  };

  const computeHbsCoverageReport = async () => {
    const manifest = tryLoadManifest();
    const url = page.url();
    const stack = resolveForUrl(url, manifest);
    const picked = pickTemplateUsingLastElement(stack);
    const templatePath = picked.chosen;
    const extraction = extractSelectorsFromHbs(templatePath);
    const html = await page.content();
    const validation = validateSelectorsAgainstDom(html, extraction);

    return {
      url,
      template: templatePath,
      counts: extraction.counts,
      coverage: validation.coverage,
      missing: validation.missing.slice(0, 25),
      matches: picked.matches,
      lastElementAttributes: picked.lastElementAttributes,
      candidates: stack.candidates,
    };
  };

  const shouldTriggerCoverage = (name: string) =>
    ENABLE_PER_ACTION_HBS_COVERAGE &&
    HBS_COVERAGE_TRIGGER_PREFIXES.some((prefix) => name.startsWith(prefix));

  const maybeRunCoverageAfter = async (actionName: string) => {
    if (!ENABLE_PER_ACTION_HBS_COVERAGE) return;

    let report;
    try {
      report = await computeHbsCoverageReport();
    } catch (error) {
      console.warn(
        `[HBS coverage] ${actionName} skipped:`,
        (error as Error)?.message ?? String(error),
      );
      return;
    }

    const payload = { ...report, triggeredBy: actionName };
    if (report.coverage < HBS_COVERAGE_MIN_THRESHOLD) {
      console.warn(
        `[HBS coverage] ${actionName} low`,
        JSON.stringify(payload),
      );
      if (HBS_COVERAGE_FAIL_BELOW_THRESHOLD) {
        throw new Error(
          `[HBS coverage] ${actionName} coverage ${report.coverage.toFixed(
            2,
          )} below threshold ${HBS_COVERAGE_MIN_THRESHOLD}`,
        );
      }
    } else {
      console.log(`[HBS coverage] ${actionName}`, JSON.stringify(payload));
    }
  };

  const getLocator = (elementId: string) => {
    return page.locator(`[data-element-id="${elementId}"]`);
  };

  const elementSelectors = new Map<string, string>();

  const logInteraction = async (
    action: string,
    elementId?: string,
    selector?: string,
    actionData?: Record<string, any>,
  ) => {
    try {
      const locator = elementId
        ? getLocator(elementId)
        : selector
          ? page.locator(selector)
          : null;

      if (!locator) return;

      const elementInfo = await locator.evaluate((node: Element) => {
        const attributes: Record<string, string> = {};
        for (let i = 0; i < node.attributes.length; i++) {
          const attr = node.attributes[i];
          if (attr.name !== "data-element-id") {
            attributes[attr.name] = attr.value;
          }
        }

        return {
          tag: node.tagName.toLowerCase(),
          attributes,
          outerHTML: node.outerHTML,
          text: node.textContent?.trim() || undefined,
        };
      });

      interactionLog.push({
        action,
        timestamp: new Date().toISOString(),
        selector,
        elementId,
        element: elementInfo,
        actionData,
      });
    } catch (error) {
      // Silently fail if element is not found or logging fails
      console.warn(`Failed to log interaction for ${action}:`, error);
    }
  };

  const actions: Record<string, RunnableFunctionWithParse<any>> = {
    // ---- URL/context helper (emberless) ----
    getRouteContext: {
      function: async () => {
        const url = page.url();
        const manifest = tryLoadManifest();
        const res = resolveForUrl(url, manifest);
        return { routeName: null, url, candidates: res.candidates, primaryTemplate: res.primary };
      },
      name: "getRouteContext",
      description:
        "Returns the current page URL and a best-effort template guess. Does not touch Ember.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    resolveTemplateForCurrentPage: {
      function: async () => {
        const manifest = tryLoadManifest();
        const url = page.url();
        const stack = resolveForUrl(url, manifest);
        return {
          routeName: null,
          url,
          candidates: stack.candidates,
          primaryTemplate: stack.primary,
        };
      },
      name: "resolveTemplateForCurrentPage",
      description:
        "Resolves the most specific HBS template for the current page using URL + manifest only.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    getSelectorsForTemplate: {
      function: async ({ path: relOrAbs }: { path: string }) => {
        return extractSelectorsFromHbs(relOrAbs);
      },
      name: "getSelectorsForTemplate",
      description:
        "Reads an HBS file and extracts selectors (data-test-*, aria-label, id).",
      parse: (args: string) => {
        return z
          .object({
            path: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or absolute path to the HBS file.",
          },
        },
        required: ["path"],
      },
    },

    getSelectorsForCurrentPage: {
      function: async () => {
        const manifest = tryLoadManifest();
        const url = page.url();
        const stack = resolveForUrl(url, manifest);
        const templatePath = fallbackTemplate(stack);
        const extraction = extractSelectorsFromHbs(templatePath);
        return { url, primaryTemplate: templatePath, ...extraction };
      },
      name: "getSelectorsForCurrentPage",
      description:
        "Resolves the current page template (URL-only) and returns its extracted selectors.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    validateTemplateSelectorsAgainstDom: {
      function: async ({ path: relOrAbs }: { path: string }) => {
        const extraction = extractSelectorsFromHbs(relOrAbs);
        const html = await page.content();
        return validateSelectorsAgainstDom(html, extraction);
      },
      name: "validateTemplateSelectorsAgainstDom",
      description:
        "Validates that selectors extracted from an HBS file appear in the current DOM.",
      parse: (args: string) => {
        return z
          .object({
            path: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or absolute path to the HBS file.",
          },
        },
        required: ["path"],
      },
    },

    resolveTemplateUsingLastElementAndHbs: {
      function: async () => {
        const manifest = tryLoadManifest();
        const url = page.url();
        const stack = resolveForUrl(url, manifest);
        const picked = pickTemplateUsingLastElement(stack);
        return {
          url,
          candidates: stack.candidates,
          chosen: picked.chosen,
          matches: picked.matches,
          lastElementAttributes: picked.lastElementAttributes,
        };
      },
      name: "resolveTemplateUsingLastElementAndHbs",
      description:
        "Try to identify the template whose HBS contains selectors matching the last interacted element.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    autoCheckHbsCoverage: {
      function: async () => {
        return computeHbsCoverageReport();
      },
      name: "autoCheckHbsCoverage",
      description:
        "Resolve the likely template, extract its selectors, validate against the DOM, and report coverage.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    resolveTemplateForElement: {
      function: async (args: AttributeLookupArgs) => {
        const manifest = tryLoadManifest();
        const url = page.url();
        return resolveByAttributes(manifest, url, args ?? {});
      },
      name: "resolveTemplateForElement",
      description:
        "Resolve HBS file(s) declaring an element via data-test, aria-label, or id attributes, ranked by the current URL.",
      parse: (args: string) => {
        return z
          .object({
            dataTestKey: z.string().optional(),
            dataTestValue: z.string().optional(),
            ariaLabel: z.string().optional(),
            id: z.string().optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          dataTestKey: {
            type: "string",
            description: "Suffix of data-test-* attribute, e.g. 'button' for data-test-button",
          },
          dataTestValue: {
            type: "string",
            description: "Value of the data-test-* attribute, e.g. 'submit-order'",
          },
          ariaLabel: {
            type: "string",
            description: "aria-label attribute value to resolve",
          },
          id: {
            type: "string",
            description: "Element id attribute value to resolve",
          },
        },
      },
    },

    resolveTemplateForLastElement: {
      function: async () => {
        const manifest = tryLoadManifest();
        const url = page.url();
        for (let i = interactionLog.length - 1; i >= 0; i--) {
          const entry = interactionLog[i];
          const attrs = entry?.element?.attributes;
          if (!attrs) continue;

          const entries = Object.entries(attrs);
          const dataTestEntry = entries.find(([name, value]) => {
            if (!value) return false;
            const lower = name.toLowerCase();
            return lower === "data-test" || lower.startsWith("data-test-");
          });

          let dataTestKey: string | undefined;
          let dataTestValue: string | undefined;
          if (dataTestEntry) {
            const [attrName, attrValue] = dataTestEntry;
            const lower = attrName.toLowerCase();
            if (lower === "data-test") {
              dataTestKey = "data-test";
            } else if (lower.startsWith("data-test-")) {
              dataTestKey = attrName.slice("data-test-".length);
            }
            dataTestValue = String(attrValue);
          }

          const ariaLabel = attrs["aria-label"] ? String(attrs["aria-label"]) : undefined;
          const id = attrs.id ? String(attrs.id) : undefined;

          const result = resolveByAttributes(manifest, url, {
            dataTestKey,
            dataTestValue,
            ariaLabel,
            id,
          });

          return {
            ...result,
            lookedUpFrom: { dataTestKey, dataTestValue, ariaLabel, id },
          };
        }

        return { candidates: [], primaryTemplate: null, reason: "no-last-element" };
      },
      name: "resolveTemplateForLastElement",
      description:
        "Resolve templates for the most recent logged element using stored attributes and manifest indexes.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },

    openTemplate: {
      function: async ({ path: relPath }: { path: string }) => {
        const normalized = relPath.replace(/^\.?\/*/, "");
        const absFromRoot = path.resolve(TEMPLATE_ROOT_DIR, normalized);
        const absWithTemplates = normalized.startsWith("templates/")
          ? absFromRoot
          : path.resolve(TEMPLATE_ROOT_DIR, "templates", normalized);
        const chosen = existsSync(absFromRoot)
          ? absFromRoot
          : existsSync(absWithTemplates)
            ? absWithTemplates
            : absFromRoot;

        return {
          openFile: chosen,
          openFileRelative: relPath,
          templateRoot: TEMPLATE_ROOT_DIR,
        };
      },
      name: "openTemplate",
      description:
        "Return a directive to open the given template path in the editor or host environment.",
      parse: (args: string) => {
        return z
          .object({
            path: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The template file path to open",
          },
        },
        required: ["path"],
      },
    },

    locator_pressKey: {
      function: async (args: { elementId: string; key: string }) => {
        const { elementId, key } = args;
        await logInteraction(
          "locator_pressKey",
          elementId,
          elementSelectors.get(elementId),
          { key },
        );
        await getLocator(elementId).press(key);
        return { success: true };
      },
      name: "locator_pressKey",
      description: "Presses a key while focused on the specified element.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
            key: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string" },
          key: {
            type: "string",
            description:
              "The name of the key to press, e.g., 'Enter', 'ArrowUp', 'a'.",
          },
        },
      },
    },
    page_pressKey: {
      function: async (args: { elementId: string; key: string }) => {
        const { key } = args;
        await page.keyboard.press(key);
        return { success: true };
      },
      name: "page_pressKey",
      description: "Presses a key globally on the page.",
      parse: (args: string) => {
        return z
          .object({
            key: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "The name of the key to press, e.g., 'Enter', 'ArrowDown', 'b'.",
          },
        },
      },
    },
    locateElement: {
      function: async (args: { cssSelector: string }) => {
        await ensureDataTags(page);
        const locator = page.locator(args.cssSelector);
        const elementId = randomUUID();
        elementSelectors.set(elementId, args.cssSelector);
        await locator
          .first()
          .evaluate(
            (node, id) => node.setAttribute("data-element-id", id),
            elementId,
          );
        return { elementId };
      },
      name: "locateElement",
      description:
        "Locates element using a CSS selector and returns elementId. This element ID can be used with other functions to perform actions on the element.",
      parse: (args: string) => {
        return z
          .object({
            cssSelector: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          cssSelector: {
            type: "string",
          },
        },
      },
    },
    locator_evaluate: {
      function: async (args: { pageFunction: string; elementId: string }) => {
        return {
          result: await getLocator(args.elementId).evaluate(args.pageFunction),
        };
      },
      description:
        "Execute JavaScript code in the page, taking the matching element as an argument.",
      name: "locator_evaluate",
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
          pageFunction: {
            type: "string",
            description:
              "Function to be evaluated in the page context, e.g. node => node.innerText",
          },
        },
      },
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
            pageFunction: z.string(),
          })
          .parse(JSON.parse(args));
      },
    },
    locator_getAttribute: {
      function: async (args: { attributeName: string; elementId: string }) => {
        return {
          attributeValue: await getLocator(args.elementId).getAttribute(
            args.attributeName,
          ),
        };
      },
      name: "locator_getAttribute",
      description: "Returns the matching element's attribute value.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
            attributeName: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          attributeName: {
            type: "string",
          },
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_innerHTML: {
      function: async (args: { elementId: string }) => {
        return { innerHTML: await getLocator(args.elementId).innerHTML() };
      },
      name: "locator_innerHTML",
      description: "Returns the element.innerHTML.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_innerText: {
      function: async (args: { elementId: string }) => {
        return { innerText: await getLocator(args.elementId).innerText() };
      },
      name: "locator_innerText",
      description: "Returns the element.innerText.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_textContent: {
      function: async (args: { elementId: string }) => {
        return {
          textContent: await getLocator(args.elementId).textContent(),
        };
      },
      name: "locator_textContent",
      description: "Returns the node.textContent.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_inputValue: {
      function: async (args: { elementId: string }) => {
        return {
          inputValue: await getLocator(args.elementId).inputValue(),
        };
      },
      name: "locator_inputValue",
      description:
        "Returns input.value for the selected <input> or <textarea> or <select> element.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_blur: {
      function: async (args: { elementId: string }) => {
        await getLocator(args.elementId).blur();

        return { success: true };
      },
      name: "locator_blur",
      description: "Removes keyboard focus from the current element.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_boundingBox: {
      function: async (args: { elementId: string }) => {
        return await getLocator(args.elementId).boundingBox();
      },
      name: "locator_boundingBox",
      description:
        "This method returns the bounding box of the element matching the locator, or null if the element is not visible. The bounding box is calculated relative to the main frame viewport - which is usually the same as the browser window. The returned object has x, y, width, and height properties.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_check: {
      function: async (args: { elementId: string }) => {
        await logInteraction(
          "locator_check",
          args.elementId,
          elementSelectors.get(args.elementId),
        );
        await getLocator(args.elementId).check();

        return { success: true };
      },
      name: "locator_check",
      description: "Ensure that checkbox or radio element is checked.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_uncheck: {
      function: async (args: { elementId: string }) => {
        await logInteraction(
          "locator_uncheck",
          args.elementId,
          elementSelectors.get(args.elementId),
        );
        await getLocator(args.elementId).uncheck();

        return { success: true };
      },
      name: "locator_uncheck",
      description: "Ensure that checkbox or radio element is unchecked.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_isChecked: {
      function: async (args: { elementId: string }) => {
        return { isChecked: await getLocator(args.elementId).isChecked() };
      },
      name: "locator_isChecked",
      description: "Returns whether the element is checked.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_isEditable: {
      function: async (args: { elementId: string }) => {
        return {
          isEditable: await getLocator(args.elementId).isEditable(),
        };
      },
      name: "locator_isEditable",
      description:
        "Returns whether the element is editable. Element is considered editable when it is enabled and does not have readonly property set.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_isEnabled: {
      function: async (args: { elementId: string }) => {
        return { isEnabled: await getLocator(args.elementId).isEnabled() };
      },
      name: "locator_isEnabled",
      description:
        "Returns whether the element is enabled. Element is considered enabled unless it is a <button>, <select>, <input> or <textarea> with a disabled property.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_isVisible: {
      function: async (args: { elementId: string }) => {
        return { isVisible: await getLocator(args.elementId).isVisible() };
      },
      name: "locator_isVisible",
      description: "Returns whether the element is visible.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_clear: {
      function: async (args: { elementId: string }) => {
        await getLocator(args.elementId).clear();

        return { success: true };
      },
      name: "locator_clear",
      description: "Clear the input field.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_click: {
      function: async (args: { elementId: string }) => {
        await logInteraction(
          "locator_click",
          args.elementId,
          elementSelectors.get(args.elementId),
        );
        await getLocator(args.elementId).click();

        return { success: true };
      },
      name: "locator_click",
      description: "Click an element.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_count: {
      function: async (args: { elementId: string }) => {
        return { elementCount: await getLocator(args.elementId).count() };
      },
      name: "locator_count",
      description: "Returns the number of elements matching the locator.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
          },
        },
      },
    },
    locator_fill: {
      function: async (args: { value: string; elementId: string }) => {
        await logInteraction(
          "locator_fill",
          args.elementId,
          elementSelectors.get(args.elementId),
          {
            value: args.value,
          },
        );
        await getLocator(args.elementId).fill(args.value);

        return {
          success: true,
        };
      },
      name: "locator_fill",
      description: "Set a value to the input field.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
            value: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          value: {
            type: "string",
          },
          elementId: {
            type: "string",
          },
        },
      },
    },
    page_goto: {
      function: async (args: { url: string }) => {
        return {
          url: await page.goto(args.url),
        };
      },
      name: "page_goto",
      description: "Navigate to the specified URL.",
      parse: (args: string) => {
        return z
          .object({
            url: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to",
          },
        },
        required: ["url"],
      },
    },
    locator_selectOption: {
      function: async (args: {
        elementId?: string;
        cssSelector?: string;
        value?: string | string[];
        label?: string | string[];
        index?: number | number[];
      }) => {
        const { elementId, cssSelector, value, label, index } = args;

        let locator;

        if (elementId) {
          locator = page.locator(`[data-element-id="${elementId}"]`);
        } else if (cssSelector) {
          locator = page.locator(cssSelector);
        } else {
          throw new Error(
            "You must provide either an elementId or a cssSelector.",
          );
        }

        if (value !== undefined) {
          await locator.selectOption(value);
        } else if (label !== undefined) {
          const options = Array.isArray(label)
            ? label.map((l) => ({ label: l }))
            : { label };
          await locator.selectOption(options);
        } else if (index !== undefined) {
          const options = Array.isArray(index)
            ? index.map((i) => ({ index: i }))
            : { index };
          await locator.selectOption(options);
        } else {
          throw new Error(
            "You must provide at least one of the parameters: value, label, or index.",
          );
        }

        await logInteraction(
          "locator_selectOption",
          elementId,
          elementId
            ? elementSelectors.get(elementId)
            : cssSelector,
          {
            value,
            label,
            index,
          },
        );

        return { success: true };
      },
      name: "locator_selectOption",
      description:
        "Selects option(s) in a <select> element. Requires either an elementId (obtained via locateElement) or a direct cssSelector.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string().optional(),
            cssSelector: z.string().optional(),
            value: z.union([z.string(), z.array(z.string())]).optional(),
            label: z.union([z.string(), z.array(z.string())]).optional(),
            index: z.union([z.number(), z.array(z.number())]).optional(),
          })
          .refine(
            (data) =>
              data.elementId !== undefined || data.cssSelector !== undefined,
            {
              message: "Either elementId or cssSelector must be provided.",
            },
          )
          .refine(
            (data) =>
              data.value !== undefined ||
              data.label !== undefined ||
              data.index !== undefined,
            {
              message:
                "At least one of value, label, or index must be provided.",
            },
          )
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
            description:
              "The ID of the <select> element, obtained via locateElement.",
          },
          cssSelector: {
            type: "string",
            description:
              "CSS selector to locate the <select> element directly, e.g., '#my-select' or 'form select'.",
          },
          value: {
            type: ["string", "array"],
            description:
              "Select options with matching value attribute. Can be a string or an array for multi-select.",
            items: {
              type: "string"
            }
          },
          label: {
            type: ["string", "array"],
            description:
              "Select options with matching visible text. Can be a string or an array for multi-select.",
            items: {
              type: "string"
            }
          },
          index: {
            type: ["number", "array"],
            description:
              "Select options by their index (zero-based). Can be a number or an array for multi-select.",
            items: {
              type: "number"
            }
          },
        },
      },
    },
    expect_toBe: {
      function: (args: { actual: string; expected: string }) => {
        return {
          actual: args.actual,
          expected: args.expected,
          success: args.actual === args.expected,
        };
      },
      name: "expect_toBe",
      description:
        "Asserts that the actual value is equal to the expected value.",
      parse: (args: string) => {
        return z
          .object({
            actual: z.string(),
            expected: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          actual: {
            type: "string",
          },
          expected: {
            type: "string",
          },
        },
      },
    },
    expect_notToBe: {
      function: (args: { actual: string; expected: string }) => {
        return {
          actual: args.actual,
          expected: args.expected,
          success: args.actual !== args.expected,
        };
      },
      name: "expect_notToBe",
      description:
        "Asserts that the actual value is not equal to the expected value.",
      parse: (args: string) => {
        return z
          .object({
            actual: z.string(),
            expected: z.string(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          actual: {
            type: "string",
          },
          expected: {
            type: "string",
          },
        },
      },
    },
    resultAssertion: {
      function: (args: { assertion: boolean }) => {
        return args;
      },
      parse: (args: string) => {
        return z
          .object({
            assertion: z.boolean(),
          })
          .parse(JSON.parse(args));
      },
      description:
        "This function is called when the initial instructions asked to assert something; then 'assertion' is either true or false (boolean) depending on whether the assertion succeeded.",
      name: "resultAssertion",
      parameters: {
        type: "object",
        properties: {
          assertion: {
            type: "boolean",
          },
        },
      },
    },
    resultQuery: {
      function: (args: { query: string }) => {
        return args;
      },
      parse: (args: string) => {
        return z
          .object({
            query: z.string(),
          })
          .parse(JSON.parse(args));
      },
      description:
        "This function is called at the end when the initial instructions asked to extract data; then 'query' property is set to a text value of the extracted data.",
      name: "resultQuery",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
          },
        },
      },
    },
    resultAction: {
      function: () => {
        return { success: true };
      },
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      description:
        "This function is called at the end when the initial instructions asked to perform an action.",
      name: "resultAction",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    resultError: {
      function: (args: { errorMessage: string }) => {
        return {
          errorMessage: args.errorMessage,
        };
      },
      parse: (args: string) => {
        return z
          .object({
            errorMessage: z.string(),
          })
          .parse(JSON.parse(args));
      },
      description:
        "If user instructions cannot be completed, then this function is used to produce the final response.",
      name: "resultError",
      parameters: {
        type: "object",
        properties: {
          errorMessage: {
            type: "string",
          },
        },
      },
    },
    getVisibleStructure: {
      function: async () => {
        const sanitizeOptions = getSanitizeOptions();
        const allowedTags = sanitizeOptions.allowedTags || [];
        const allowedAttributes = sanitizeOptions.allowedAttributes;
        const maxDepth = 30; // Можно вынести наверх файла в константу при желании

        return {
          structure: await page.evaluate(
            ({ allowedTags, allowedAttributes, maxDepth }) => {
              // @ts-ignore
              const extractVisibleStructure = (element, depth = 0) => {
                if (!element || depth > maxDepth) return null;

                const style = window.getComputedStyle(element);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                ) {
                  return null;
                }

                const tag = element.tagName.toLowerCase();
                if (!allowedTags.includes(tag)) {
                  return null;
                }

                const node = {
                  tag: tag,
                  attributes: {},
                  children: [],
                };

                const elementAttributes = element.attributes;
                if (allowedAttributes === false) {
                  for (let i = 0; i < elementAttributes.length; i++) {
                    const attr = elementAttributes[i];
                    // @ts-ignore
                    node.attributes[attr.name] = attr.value;
                  }
                } else if (typeof allowedAttributes === "object") {
                  const allowedForAll = allowedAttributes["*"];
                  const allowedForTag = allowedAttributes[tag];

                  // @ts-ignore
                  const allowAllForTag = allowedForTag === true;
                  // @ts-ignore
                  const allowAllGlobal = allowedForAll === true;

                  for (let i = 0; i < elementAttributes.length; i++) {
                    const attr = elementAttributes[i];
                    const attrName = attr.name;

                    if (
                      allowAllForTag ||
                      allowAllGlobal ||
                      (Array.isArray(allowedForTag) &&
                        allowedForTag.includes(attrName)) ||
                      (Array.isArray(allowedForAll) &&
                        allowedForAll.includes(attrName))
                    ) {
                      // @ts-ignore
                      node.attributes[attrName] = attr.value;
                    }
                  }
                }

                const id = element.id;
                if (id) {
                  // @ts-ignore
                  node.id = id;
                }

                const role = element.getAttribute("role");
                if (role) {
                  // @ts-ignore
                  node.role = role;
                }

                const ariaLabel = element.getAttribute("aria-label");
                if (ariaLabel) {
                  // @ts-ignore
                  node.ariaLabel = ariaLabel;
                }

                const className = element.className?.trim();
                if (className) {
                  // @ts-ignore
                  node.className = className;
                }

                if (
                  element.childNodes.length === 1 &&
                  element.childNodes[0].nodeType === 3
                ) {
                  const text = element.textContent?.trim() || "";
                  if (text) {
                    // @ts-ignore
                    node.text =
                      text.length > 50 ? text.slice(0, 50) + "..." : text;
                  }
                }

                if (depth + 1 < maxDepth) {
                  for (let i = 0; i < element.children.length; i++) {
                    const child = extractVisibleStructure(
                      element.children[i],
                      depth + 1,
                    );
                    if (child) {
                      // @ts-ignore
                      node.children.push(child);
                    }
                  }
                }

                return node;
              };

              return extractVisibleStructure(document.body);
            },
            { allowedTags, allowedAttributes, maxDepth },
          ),
        };
      },
      name: "getVisibleStructure",
      description:
        "Returns a simplified hierarchical structure of visible DOM elements, focusing on roles, attributes, and basic content.",
      parse: (args: string) => {
        return z.object({}).parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {},
      },
    },
    locateElementsByRole: {
      function: async (args: {
        role:
          | "alert"
          | "alertdialog"
          | "application"
          | "article"
          | "banner"
          | "blockquote"
          | "button"
          | "caption"
          | "cell"
          | "checkbox"
          | "code"
          | "columnheader"
          | "combobox"
          | "complementary"
          | "contentinfo"
          | "definition"
          | "deletion"
          | "dialog"
          | "directory"
          | "document"
          | "emphasis"
          | "feed"
          | "figure"
          | "form"
          | "generic"
          | "grid"
          | "gridcell"
          | "group"
          | "heading"
          | "img"
          | "insertion"
          | "link"
          | "list"
          | "listbox"
          | "listitem"
          | "log"
          | "main"
          | "marquee"
          | "math"
          | "menu"
          | "menubar"
          | "menuitem"
          | "menuitemcheckbox"
          | "menuitemradio"
          | "meter"
          | "navigation"
          | "none"
          | "note"
          | "option"
          | "paragraph"
          | "presentation"
          | "progressbar"
          | "radio"
          | "radiogroup"
          | "region"
          | "row"
          | "rowgroup"
          | "rowheader"
          | "scrollbar"
          | "search"
          | "searchbox"
          | "separator"
          | "slider"
          | "spinbutton"
          | "status"
          | "strong"
          | "subscript"
          | "superscript"
          | "switch"
          | "tab"
          | "table"
          | "tablist"
          | "tabpanel"
          | "term"
          | "textbox"
          | "time"
          | "timer"
          | "toolbar"
          | "tooltip"
          | "tree"
          | "treegrid"
          | "treeitem";
        exact?: boolean;
      }) => {
        const locators = await page
          .getByRole(args.role, { exact: args.exact ?? false })
          .all();
        const elementIds: string[] = [];
        const selectorHint = `role=${args.role}${args.exact ? " (exact)" : ""}`;

        for (const locator of locators) {
          const elementId = randomUUID();
          elementSelectors.set(elementId, selectorHint);
          await locator.evaluate(
            (node, id) => node.setAttribute("data-element-id", id),
            elementId,
          );
          elementIds.push(elementId);
        }

        return {
          elementIds,
          count: elementIds.length,
        };
      },
      name: "locateElementsByRole",
      description:
        "Finds elements by their ARIA role attribute and returns array of element IDs.",
      parse: (args: string) => {
        return z
          .object({
            role: z.string(),
            exact: z.boolean().optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            description:
              "ARIA role to search for, e.g. 'button', 'grid', 'row', etc.",
          },
          exact: {
            type: "boolean",
            description:
              "Whether to match the role exactly or allow partial matches.",
          },
        },
        required: ["role"],
      },
    },
    locateElementsWithText: {
      function: async (args: { text: string; exact?: boolean }) => {
        const allLocators = await page
          .getByText(args.text, { exact: args.exact ?? false })
          .all();

        const elementIds: string[] = [];
        const selectorHint = `text=${args.text}${args.exact ? " (exact)" : ""}`;

        for (const locator of allLocators) {
          if (await locator.isVisible()) {
            const elementId = randomUUID();
            elementSelectors.set(elementId, selectorHint);
            await locator.evaluate(
              (node, id) => node.setAttribute("data-element-id", id),
              elementId,
            );
            elementIds.push(elementId);
          }
        }

        return {
          elementIds,
          count: elementIds.length,
        };
      },
      name: "locateElementsWithText",
      description:
        "Finds visible elements containing specified text and returns array of element IDs. Hidden elements are excluded.",
      parse: (args: string) => {
        return z
          .object({
            text: z.string(),
            exact: z.boolean().optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to search for within elements.",
          },
          exact: {
            type: "boolean",
            description:
              "Whether to match the text exactly or allow partial matches.",
          },
        },
        required: ["text"],
      },
    },
    waitForContentToLoad: {
      function: async (args: {
        selector: string;
        textMarker?: string;
        timeout?: number;
      }) => {
        try {
          if (args.textMarker) {
            await page.waitForSelector(
              `${args.selector}:has-text("${args.textMarker}")`,
              {
                timeout: args.timeout || 30000,
                state: "visible",
              },
            );
          } else {
            await page.waitForSelector(args.selector, {
              timeout: args.timeout || 30000,
              state: "visible",
            });
          }
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `Timeout waiting for content to load: ${error.message}`,
          };
        }
      },
      name: "waitForContentToLoad",
      description:
        "Waits for dynamic content to load based on selector and optional text marker.",
      parse: (args: string) => {
        return z
          .object({
            selector: z.string(),
            textMarker: z.string().optional(),
            timeout: z.number().optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to wait for.",
          },
          textMarker: {
            type: "string",
            description:
              "Optional text content to wait for within the selector.",
          },
          timeout: {
            type: "number",
            description:
              "Maximum time to wait in milliseconds. Default is 30000 (30 seconds).",
          },
        },
        required: ["selector"],
      },
    },
    extractVisibleText: {
      function: async (args: { elementId?: string; selector?: string }) => {
        let result;

        if (args.elementId) {
          result = await getLocator(args.elementId).evaluate(
            (node: Element) => {
              const getVisibleText = (element: Element | Node): string => {
                if (element.nodeType === 3) {
                  return element.textContent?.trim() || "";
                }

                if (element instanceof Element) {
                  const style = window.getComputedStyle(element);
                  if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    style.opacity === "0"
                  ) {
                    return "";
                  }

                  let text = "";
                  Array.from(element.childNodes).forEach((child) => {
                    text += getVisibleText(child);
                  });

                  return text;
                }

                return "";
              };

              return getVisibleText(node);
            },
          );
        } else if (args.selector) {
          result = await page.evaluate((selector: string) => {
            const elements = document.querySelectorAll(selector);
            let allText = "";

            elements.forEach((element) => {
              const style = window.getComputedStyle(element);
              if (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0"
              ) {
                allText += (element.textContent?.trim() || "") + " ";
              }
            });

            return allText.trim();
          }, args.selector);
        } else {
          throw new Error("Either elementId or selector must be provided");
        }

        return { text: result };
      },
      name: "extractVisibleText",
      description:
        "Extracts only visible text from elements, ignoring hidden content.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string().optional(),
            selector: z.string().optional(),
          })
          .refine(
            (data) =>
              data.elementId !== undefined || data.selector !== undefined,
            {
              message: "Either elementId or selector must be provided",
            },
          )
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
            description: "ID of the element to extract text from.",
          },
          selector: {
            type: "string",
            description: "CSS selector to locate elements for text extraction.",
          },
        },
      },
    },
    scrollIntoElementView: {
      function: async (args: { elementId: string; behavior?: string }) => {
        await getLocator(args.elementId).evaluate(
          (node: Element, behavior: string | undefined) => {
            node.scrollIntoView({
              behavior: (behavior as "auto" | "smooth") || "smooth",
              block: "center",
            });
          },
          args.behavior,
        );

        await page.waitForTimeout(500);

        return { success: true };
      },
      name: "scrollIntoElementView",
      description:
        "Scrolls to bring an element into view, useful for loading content dynamically as user scrolls.",
      parse: (args: string) => {
        return z
          .object({
            elementId: z.string(),
            behavior: z.enum(["auto", "smooth"]).optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
            description: "ID of the element to scroll into view.",
          },
          behavior: {
            type: "string",
            enum: ["auto", "smooth"],
            description:
              "Scrolling behavior: 'auto' for instant scrolling or 'smooth' for animated scrolling.",
          },
        },
        required: ["elementId"],
      },
    },
    waitForNetworkIdle: {
      function: async (args: { timeout?: number; idleTime?: number }) => {
        try {
          await page.waitForLoadState("networkidle", {
            timeout: args.timeout || 30000,
          });

          if (args.idleTime) {
            await page.waitForTimeout(args.idleTime);
          }

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: `Timeout waiting for network idle: ${error.message}`,
          };
        }
      },
      name: "waitForNetworkIdle",
      description:
        "Waits for network activity to be minimal or stopped, useful for SPA applications.",
      parse: (args: string) => {
        return z
          .object({
            timeout: z.number().optional(),
            idleTime: z.number().optional(),
          })
          .parse(JSON.parse(args));
      },
      parameters: {
        type: "object",
        properties: {
          timeout: {
            type: "number",
            description:
              "Maximum time to wait in milliseconds. Default is 30000 (30 seconds).",
          },
          idleTime: {
            type: "number",
            description:
              "Additional wait time after network becomes idle, in milliseconds.",
          },
        },
      },
    },
  };

  if (ENABLE_PER_ACTION_HBS_COVERAGE) {
    for (const [name, action] of Object.entries(actions)) {
      if (name === "autoCheckHbsCoverage") continue;
      if (!shouldTriggerCoverage(name)) continue;
      const originalFunction = action.function;
      action.function = (async (args: any) => {
        const result = await originalFunction(args);
        await maybeRunCoverageAfter(name);
        return result;
      }) as typeof originalFunction;
    }
  }

  return actions;
};
