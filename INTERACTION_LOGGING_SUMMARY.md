# Interaction Logging Implementation Summary

## What Was Implemented

A comprehensive interaction logging system that tracks all element interactions during auto-playwright task execution. This allows you to capture HTML elements and their interactions for creating e2e tests.

## Changes Made

### 1. Type Definitions (`src/types.ts`)

Added new types:
- **`ElementInteraction`**: Captures details about each interaction
  - `action`: The action performed (e.g., "locator_click", "locator_fill")
  - `timestamp`: ISO timestamp of the interaction
  - `selector`: CSS selector used (if applicable)
  - `elementId`: Internal element ID
  - `element`: Full element details (tag, attributes, outerHTML, text)
  - `actionData`: Additional action-specific data (e.g., filled value)

- **`TaskResult`**: Extended to include `interactions?: ElementInteraction[]`

### 2. Action Logging (`src/createActions.ts`)

- Added `interactionLog` parameter to `createActions()` function
- Created `logInteraction()` helper function that:
  - Locates the element
  - Extracts tag name, attributes, outerHTML, and text content
  - Stores the interaction with timestamp and action data
  - Handles errors gracefully (won't break execution if logging fails)

- Added logging to key interaction actions:
  - `locator_click`
  - `locator_fill`
  - `locator_check`
  - `locator_uncheck`
  - `locator_selectOption`
  - `locator_pressKey`

### 3. Task Completion (`src/completeTask.ts`)

- Created `interactionLog` array
- Passed it to `createActions()`
- Returns the log as part of `TaskResult`
- Added debug logging for interactions when debug mode is enabled

### 4. Auto Function (`src/auto.ts`)

- Modified to return the full `TaskResult` object (including `interactions`)
- Maintains backward compatibility:
  - When no `test` parameter: returns full `TaskResult`
  - When `test` parameter provided: returns full `TaskResult` for actions, or the specific value for queries/assertions

## How to Use

### Basic Usage

```typescript
import { test } from '@playwright/test';
import { auto } from 'auto-playwright';

test('my test', async ({ page }) => {
  await page.goto('https://example.com');
  
  const result = await auto('Click the button', { page, test });
  
  // Access interactions
  console.log(result.interactions);
});
```

### Save to File

```typescript
import { writeFileSync } from 'fs';

const result = await auto('Fill the form', { page, test });

if (result.interactions) {
  writeFileSync(
    'interactions.json',
    JSON.stringify(result.interactions, null, 2)
  );
}
```

### Debug Mode

```typescript
// Enable debug to see interactions in console
const result = await auto(
  'Click button',
  { page, test },
  { debug: true }
);
```

Or set environment variable:
```bash
export AUTO_PLAYWRIGHT_DEBUG=true
```

## Example Output

```json
[
  {
    "action": "locator_fill",
    "timestamp": "2025-10-06T16:49:09.123Z",
    "elementId": "abc-123",
    "element": {
      "tag": "input",
      "attributes": {
        "type": "email",
        "data-tag": "email-input",
        "class": "form-control"
      },
      "outerHTML": "<input type=\"email\" data-tag=\"email-input\" class=\"form-control\">",
      "text": ""
    },
    "actionData": {
      "value": "test@example.com"
    }
  },
  {
    "action": "locator_click",
    "timestamp": "2025-10-06T16:49:10.456Z",
    "elementId": "xyz-789",
    "element": {
      "tag": "button",
      "attributes": {
        "type": "submit",
        "data-tag": "submit-button",
        "class": "btn btn-primary"
      },
      "outerHTML": "<button type=\"submit\" data-tag=\"submit-button\" class=\"btn btn-primary\">Submit</button>",
      "text": "Submit"
    }
  }
]
```

## Use Cases

1. **E2E Test Generation**: Extract selectors and actions to generate Playwright test code
2. **Debugging**: Review what elements were actually interacted with
3. **Test Documentation**: Create documentation of user flows
4. **Selector Optimization**: Analyze which selectors (data-tag*, class, id) are being used
5. **Regression Testing**: Compare interactions across test runs

## Testing

Run the example test:
```bash
npx playwright test example-test.ts
```

This will:
- Execute automated interactions
- Log interactions to console (with debug mode)
- Save interactions to `logs/interactions-*.json`

## Notes

- Logging is non-intrusive and won't break execution if it fails
- The `data-element-id` attribute is excluded from logged attributes (internal use only)
- All timestamps are in ISO 8601 format
- The `outerHTML` includes the complete element markup for reference
