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
  snapshot: {
    dom: string;
  };
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
