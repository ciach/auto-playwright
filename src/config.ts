import * as path from "path";

export const MAX_TASK_CHARS = 3000;

// Where the manifest lives (if you use one). Optional for this flow.
export const TEMPLATE_MANIFEST_PATH =
  process.env.TEMPLATE_MANIFEST_PATH ?? "var/llm/template-manifest.json";

// Absolute path to the app root that contains `templates/`.
// Example: /Users/you/TravelBank/web-app/app
export const TEMPLATE_ROOT_DIR =
  process.env.TEMPLATE_ROOT_DIR ??
  path.resolve(path.dirname(TEMPLATE_MANIFEST_PATH), "..");

// Don’t touch Ember at runtime. We resolve templates from URL + HBS only.
export const EMBERLESS_MODE =
  (process.env.EMBERLESS_MODE ?? "true").toLowerCase() === "true";

// What attributes to extract from HBS as canonical selectors.
export const HBS_SELECTOR_SOURCES = {
  dataTest: true,   // data-test-*
  ariaLabel: true,  // aria-label="..."
  id: true          // id="..."
} as const;

// -------- Per-action coverage instrumentation --------
export const ENABLE_PER_ACTION_HBS_COVERAGE =
  (process.env.ENABLE_PER_ACTION_HBS_COVERAGE ?? "true").toLowerCase() === "true";

export const HBS_COVERAGE_TRIGGER_PREFIXES =
  (process.env.HBS_COVERAGE_TRIGGER_PREFIXES ??
    "locator_,keyboard_,mouse_,page_goto,navigate_")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);

export const HBS_COVERAGE_MIN_THRESHOLD =
  Number.isFinite(Number(process.env.HBS_COVERAGE_MIN_THRESHOLD))
    ? Number(process.env.HBS_COVERAGE_MIN_THRESHOLD)
    : 0.6;

export const HBS_COVERAGE_FAIL_BELOW_THRESHOLD =
  (process.env.HBS_COVERAGE_FAIL_BELOW_THRESHOLD ?? "false").toLowerCase() === "true";
