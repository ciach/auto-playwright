export const MAX_TASK_CHARS = 3000;

// Optional: path to a generated JSON manifest that lists all route templates and components.
// You can override with env var TEMPLATE_MANIFEST_PATH if you place the file elsewhere.
export const TEMPLATE_MANIFEST_PATH =
  process.env.TEMPLATE_MANIFEST_PATH ?? "var/llm/template-manifest.json";

// Used to access the Ember app via the module loader inside the running page.
// Defaults to the value implied by your router import: 'travelbank/config/environment'.
export const EMBER_MODULE_PREFIX =
  process.env.EMBER_MODULE_PREFIX ?? "travelbank";

// If true, never try to read Ember at runtime. We resolve templates using URL + manifest only.
export const EMBERLESS_MODE =
  (process.env.EMBERLESS_MODE ?? "true").toLowerCase() === "true";
