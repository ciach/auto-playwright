import { TaskMessage } from "./types";

/**
 * The prompt itself is very simple because the vast majority of the logic is derived from
 * the instructions contained in the parameter and function descriptions provided to `openai.beta.chat.completions`.
 * @see https://www.npmjs.com/package/openai#automated-function-calls
 * @see https://openai.com/blog/function-calling-and-other-api-updates
 */
export const prompt = (message: TaskMessage) => {
  return `This is your task: ${message.task}

Context for route→template mapping:
- Current URL: ${message.snapshot.url ?? 'unknown'}
- Route name is intentionally unavailable. Use URL + candidates below.
- Candidate templates (leaf-first):
${(message.snapshot.renderStack ?? []).map((p) => `  - ${p}` ).join('\n')}
- Preferred template: ${message.snapshot.primaryTemplate ?? 'unknown'}

Per-action invariant (enforced by the harness):
- After every interactive tool call (click, fill, keypress, navigation), the system resolves the most likely HBS file, extracts data-test/aria/id selectors, and validates them against the live DOM. Low coverage will warn or fail fast depending on config.

Your flow when selecting locators:
1. Prefer selectors that exist in the current HBS (data-test-* first, then aria-label, then id).
2. If a selector you want is missing in DOM but present in HBS, prefer a sibling selector from the same HBS rather than guessing a brittle CSS or XPath.
3. Only if no HBS selectors match, fall back to stable, accessible attributes visible in the DOM.

* When creating selectors, follow this priority order:
  1. data-test-* attributes (e.g., [data-test-button="submit"], [data-test="checkout"])
  2. aria-label attributes (e.g., [aria-label="Search"])
  3. id attributes (e.g., #primary-button)
  4. CSS/text fallbacks only if none of the above exist
* Ensure selectors are unique and specific enough to select only one element.
* Avoid using generic tags like 'h1' alone. Combine with data-test, aria-label, or id when possible.
* You must not derive data from the page if you are able to do so by using one of the provided functions, e.g. locator_evaluate.
* After you complete the task, you MUST call one of the result functions:
  - Call resultAction() if you were asked to perform an action (like clicking or selecting an option)
  - Call resultQuery() with the extracted data if you were asked to extract information
  - Call resultAssertion() if you were asked to check or verify something

Webpage snapshot:

\`\`\`
${message.snapshot.dom}
\`\`\`
`;
};

export const SYSTEM_PROMPT = `You must interact with the page using a set of functions.

Locating elements:

- The primary method is to use "locateElement" with a selector following this priority:
  1. data-test-* attributes (e.g., [data-test-button="submit"], [data-test="checkout"]) - HIGHEST PRIORITY
  2. aria-label attributes (e.g., [aria-label="Search"])
  3. id attributes (e.g., #primary-button)
  4. CSS/text fallbacks (e.g., div > button:nth-child(2)) - LAST RESORT
- If you cannot find a reliable selector using the above methods, you can:
  - Use "locateElementsWithText" to find elements by visible text.
  - Use "locateElementsByRole" to find elements by ARIA role (e.g., button, listbox, combobox).

Rules:

1. ALWAYS prefer data-test-* attributes when available (e.g., [data-test="login"], [data-test-button="submit"]).
2. If no data-test-* is available, use aria-label attributes (e.g., [aria-label="Search"]).
3. If no aria-label is available, use id attributes (e.g., #login-button).
4. Only fall back to CSS/text selectors if none of the above exist.
5. If a unique selector is not available, prefer locateElementsWithText when the element has unique visible text.
6. If neither attribute nor unique text is available, use locateElementsByRole when you know the expected role (such as "button").
7. You must always locate an element first before performing actions like locator_click, locator_selectOption, locator_fill, etc.
8. Only the elementId returned by locate functions should be used for further interactions.
9. Never assume you can use a DOM id or text directly as elementId.

About getVisibleStructure:

- You can use "getVisibleStructure" if you need a full overview of the page elements to make decisions or choose the right selector or text.

If you skip locating an element first, your actions will fail. Always strictly follow this workflow.

Opening related templates (emberless):

- Follow this flow whenever you need to inspect or edit a template:
  1. Call resolveTemplateUsingLastElementAndHbs() to pick the best candidate.
  2. Call getSelectorsForTemplate({ path }) on that candidate to inspect selectors.
  3. Call validateTemplateSelectorsAgainstDom({ path }); if coverage < 0.6, move to the next candidate and repeat steps 2-3.
  4. Call openTemplate({ path }) with the final template path returned by the helpers.
- Do not invent paths. Stick to resolver results and surfaced candidates.`;
