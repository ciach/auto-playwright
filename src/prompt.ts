import { TaskMessage } from "./types";

/**
 * The prompt itself is very simple because the vast majority of the logic is derived from
 * the instructions contained in the parameter and function descriptions provided to `openai.beta.chat.completions`.
 * @see https://www.npmjs.com/package/openai#automated-function-calls
 * @see https://openai.com/blog/function-calling-and-other-api-updates
 */
export const prompt = (message: TaskMessage) => {
  return `This is your task: ${message.task}

* When creating selectors, follow this priority order:
  1. Use data-tag* attributes (e.g., [data-tag="submit-button"], [data-tag-id="user-profile"]) - HIGHEST PRIORITY
  2. Use class attributes (e.g., .submit-btn, .user-card)
  3. Use id attributes (e.g., #submit-button, #user-profile)
  4. Use CSS selectors as a last resort (e.g., div > button:nth-child(2))
* Ensure selectors are unique and specific enough to select only one element.
* Avoid using generic tags like 'h1' alone. Instead, combine them with data-tag*, class, id, or other attributes.
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
  1. data-tag* attributes (e.g., [data-tag="submit"], [data-tag-id="user-123"]) - HIGHEST PRIORITY
  2. class attributes (e.g., .submit-button, .user-card)
  3. id attributes (e.g., #submit-button, #user-profile)
  4. CSS selectors (e.g., div > button:nth-child(2)) - LAST RESORT
- If you cannot find a reliable selector using the above methods, you can:
  - Use "locateElementsWithText" to find elements by visible text.
  - Use "locateElementsByRole" to find elements by ARIA role (e.g., button, listbox, combobox).

Rules:

1. ALWAYS prefer data-tag* attributes when available (e.g., [data-tag="login"], [data-tag-type="submit"]).
2. If no data-tag* is available, use class attributes (e.g., .login-btn).
3. If no class is available, use id attributes (e.g., #login-button).
4. Only use generic CSS selectors if none of the above are available.
5. If a unique selector is not available, prefer locateElementsWithText if the element has unique visible text.
6. If neither selector nor unique text is available, use locateElementsByRole if you know the expected role (such as "button" for buttons).
7. You must always locate an element first before performing actions like locator_click, locator_selectOption, locator_fill, etc.
8. Only the elementId returned by locate functions should be used for further interactions.
9. Never assume you can use a DOM id or text directly as elementId.

About getVisibleStructure:

- You can use "getVisibleStructure" if you need a full overview of the page elements to make decisions or choose the right selector or text.

If you skip locating an element first, your actions will fail. Always strictly follow this workflow.`;
