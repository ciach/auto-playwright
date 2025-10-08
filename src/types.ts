import { type TestType } from "@playwright/test";

export { type Page } from "@playwright/test";

export type Test = TestType<any, any>;

export type StepOptions = {
  debug?: boolean;
  model?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiDefaultQuery?: {};
  openaiDefaultHeaders?: {};
};

export type TaskMessage = {
  task: string;
  snapshot: Snapshot;
  options?: StepOptions;
};

export type ElementInteraction = {
  action: string;
  timestamp: string;
  selector?: string;
  elementId?: string;
  element: {
    tag: string;
    attributes: Record<string, string>;
    outerHTML: string;
    text?: string;
  };
  actionData?: Record<string, any>;
};

export type TaskResult = {
  assertion?: boolean;
  query?: string;
  errorMessage?: string;
  interactions?: ElementInteraction[];
};

// ---- New types for route/template resolution ----
export type RouteContext = {
  url: string;
  routeName: string | null;
  queryParams?: Record<string, unknown>;
};

// ---- Snapshot includes DOM and our inferred template candidates ----
export type Snapshot = {
  dom: string;
  url?: string;
  routeName?: string | null;
  renderStack?: string[];
  primaryTemplate?: string | null;
};

export type TemplateManifestEntry = {
  path: string; // e.g. 'templates/user/login.hbs' or 'templates/components/x.hbs'
  routeName?: string; // for route templates; omit for components
  kind: "route" | "component" | "substate";
  tags?: string[]; // extracted texts or data-test attrs
  components?: string[]; // referenced component names
};

export type TemplateManifest = {
  entries: TemplateManifestEntry[];
  indexes?: {
    dataTest?: Record<string, string[]>;
    ariaLabel?: Record<string, string[]>;
    id?: Record<string, string[]>;
  };
};

// ---- HBS extraction + validation ----
export type HbsSelector = {
  attr: "data-test" | "aria-label" | "id";
  key?: string; // for data-test-<key>
  value: string;
  raw: string; // raw attribute text as in HBS
};

export type HbsExtraction = {
  path: string;
  selectors: {
    dataTest: HbsSelector[];
    ariaLabel: HbsSelector[];
    id: HbsSelector[];
  };
  counts: { dataTest: number; ariaLabel: number; id: number; total: number };
};

export type HbsValidation = {
  path: string;
  present: HbsSelector[];
  missing: HbsSelector[];
  coverage: number; // present / total
};
