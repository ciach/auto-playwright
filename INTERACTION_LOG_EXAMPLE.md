# Interaction Log Feature

## Overview

The auto-playwright library now logs all element interactions during task execution. This allows you to capture the HTML elements that were interacted with and use them to create e2e tests.

## How It Works

When you run a task using `auto()`, the library will track all interactions with elements and return them in the `interactions` array of the result.

## Example Usage

### With Playwright Test

```typescript
import { test } from '@playwright/test';
import { auto } from 'auto-playwright';

test('example with interaction logging', async ({ page }) => {
  await page.goto('https://example.com');
  
  const result = await auto(
    'Click the submit button and fill in the email field with test@example.com',
    { page, test }
  );
  
  // Access the interaction log
  // When using with 'test', the result includes the full TaskResult
  console.log('Interactions:', JSON.stringify(result.interactions, null, 2));
});
```

### Without Playwright Test

```typescript
import { chromium } from '@playwright/test';
import { auto } from 'auto-playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com');

const result = await auto(
  'Click the submit button',
  { page }  // No 'test' parameter
);

// Access the interaction log
console.log('Interactions:', JSON.stringify(result.interactions, null, 2));

await browser.close();
```

## Interaction Log Structure

Each interaction in the `interactions` array has the following structure:

```typescript
{
  action: string;              // e.g., "locator_click", "locator_fill", "locator_check"
  timestamp: string;           // ISO timestamp of when the interaction occurred
  selector?: string;           // CSS selector used (if applicable)
  elementId?: string;          // Internal element ID
  element: {
    tag: string;               // HTML tag name (e.g., "button", "input")
    attributes: {              // All element attributes (excluding data-element-id)
      [key: string]: string;   // e.g., { "class": "btn-primary", "id": "submit-btn" }
    };
    outerHTML: string;         // Complete HTML of the element
    text?: string;             // Text content of the element (if any)
  };
  actionData?: {               // Additional data specific to the action
    [key: string]: any;        // e.g., { "value": "test@example.com" } for fill action
  };
}
```

## Example Output

```json
[
  {
    "action": "locator_fill",
    "timestamp": "2025-10-06T14:49:09.123Z",
    "elementId": "abc-123-def",
    "element": {
      "tag": "input",
      "attributes": {
        "type": "email",
        "name": "email",
        "class": "form-input",
        "data-tag": "email-input"
      },
      "outerHTML": "<input type=\"email\" name=\"email\" class=\"form-input\" data-tag=\"email-input\">",
      "text": ""
    },
    "actionData": {
      "value": "test@example.com"
    }
  },
  {
    "action": "locator_click",
    "timestamp": "2025-10-06T14:49:10.456Z",
    "elementId": "xyz-789-ghi",
    "element": {
      "tag": "button",
      "attributes": {
        "type": "submit",
        "class": "btn btn-primary",
        "data-tag": "submit-button"
      },
      "outerHTML": "<button type=\"submit\" class=\"btn btn-primary\" data-tag=\"submit-button\">Submit</button>",
      "text": "Submit"
    }
  }
]
```

## Tracked Actions

The following actions are currently logged:

- **locator_click** - Element clicks
- **locator_fill** - Input field fills
- **locator_check** - Checkbox/radio checks
- **locator_uncheck** - Checkbox/radio unchecks
- **locator_selectOption** - Select dropdown option selections
- **locator_pressKey** - Key presses on elements

## Using Interaction Logs for E2E Tests

You can use the interaction log to:

1. **Generate test selectors** - Extract the best selectors (data-tag*, class, id) from the logged elements
2. **Create test assertions** - Verify that the correct elements were interacted with
3. **Build test scripts** - Automatically generate Playwright test code based on the interactions
4. **Debug issues** - Review what elements were actually interacted with during execution

## Saving Interaction Logs

```typescript
import { test } from '@playwright/test';
import { auto } from 'auto-playwright';
import { writeFileSync } from 'fs';

test('save interaction log', async ({ page }) => {
  await page.goto('https://example.com');
  
  const result = await auto('Complete the form', { page, test });
  
  // Ensure interactions exist before saving
  if (result.interactions && result.interactions.length > 0) {
    // Save to file
    writeFileSync(
      'interaction-log.json',
      JSON.stringify(result.interactions, null, 2)
    );
    console.log(`Saved ${result.interactions.length} interactions to interaction-log.json`);
  } else {
    console.log('No interactions were logged');
  }
});
```

### Practical Example - Save After Each Test

```typescript
import { test } from '@playwright/test';
import { auto } from 'auto-playwright';
import { writeFileSync } from 'fs';
import { join } from 'path';

test('login flow with interaction logging', async ({ page }) => {
  await page.goto('https://example.com/login');
  
  const result = await auto(
    'Fill in email with user@example.com, fill in password with secret123, and click login',
    { page, test }
  );
  
  // Save interactions with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `interactions-login-${timestamp}.json`;
  
  writeFileSync(
    join(__dirname, 'logs', filename),
    JSON.stringify({
      test: 'login flow',
      timestamp: new Date().toISOString(),
      interactions: result.interactions
    }, null, 2)
  );
});
```

## Debug Mode

Enable debug mode to see interaction logs in the console:

```typescript
const result = await auto(
  'Click the button',
  { page, test },
  { debug: true }  // This will log interactions to console
);
```

Or set the environment variable:

```bash
export AUTO_PLAYWRIGHT_DEBUG=true
```
