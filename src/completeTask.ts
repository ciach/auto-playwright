import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { type Page, TaskMessage, TaskResult, ElementInteraction } from "./types";
import { prompt, SYSTEM_PROMPT } from "./prompt";
import { createActions } from "./createActions";
import {
  HBS_COVERAGE_FAIL_BELOW_THRESHOLD,
  HBS_COVERAGE_MIN_THRESHOLD,
} from "./config";

const defaultDebug = process.env.AUTO_PLAYWRIGHT_DEBUG === "true";

type Actions = ReturnType<typeof createActions>;

async function runFinalCoverage(actions: Actions) {
  const fn = actions.autoCheckHbsCoverage?.function;
  if (!fn) return;

  try {
    const report: any = await fn({}, undefined as any);
    const coverage =
      typeof report?.coverage === "number" ? report.coverage : Number.NaN;
    const template = report?.template ?? "(unknown)";
    console.log("[HBS coverage] final", JSON.stringify(report));

    if (!Number.isNaN(coverage) && coverage < HBS_COVERAGE_MIN_THRESHOLD) {
      const missing = JSON.stringify(report?.missing ?? []).slice(0, 400);
      const message =
        `[HBS coverage] LOW (${(coverage * 100).toFixed(0)}%) for ${template} at final check. ` +
        `Missing selectors: ${missing}`;
      if (HBS_COVERAGE_FAIL_BELOW_THRESHOLD) {
        throw new Error(message);
      }
      console.warn(message);
    }
  } catch (error) {
    const message = `[HBS coverage] final check failed: ${
      (error as Error)?.message ?? String(error)
    }`;
    if (HBS_COVERAGE_FAIL_BELOW_THRESHOLD) {
      throw new Error(message);
    }
    console.warn(message);
  }
}

export const completeTask = async (
  page: Page,
  task: TaskMessage,
): Promise<TaskResult> => {
  const openai = new OpenAI({
    apiKey: task.options?.openaiApiKey,
    baseURL: task.options?.openaiBaseUrl,
    defaultQuery: task.options?.openaiDefaultQuery,
    defaultHeaders: task.options?.openaiDefaultHeaders,
  });

  let lastFunctionResult: null | { errorMessage: string } | { query: string } =
    null;

  const interactionLog: ElementInteraction[] = [];
  const actions = createActions(page, interactionLog);

  const debug = task.options?.debug ?? defaultDebug;

  const userPrompt = prompt(task);

  if (debug) {
    const debugDir = process.env.AUTO_PLAYWRIGHT_DEBUG_DIR ?? "var/llm";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `snapshot-${timestamp}.html`;
    const filePath = path.join(debugDir, filename);

    try {
      mkdirSync(debugDir, { recursive: true });
      writeFileSync(filePath, task.snapshot.dom, "utf8");
      console.log(`> snapshot.dom written to ${filePath}`);
    } catch (error) {
      console.warn(
        `Failed to write snapshot DOM to ${filePath}: ${(error as Error).message}`,
      );
      console.log(`> snapshot.dom\n${task.snapshot.dom}`);
    }
  }

  const runner = openai.beta.chat.completions
    .runTools({
      model: task.options?.model ?? "gpt-4o",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        { role: "user", content: userPrompt },
      ],
      tools: Object.values(actions).map((action) => ({
        type: "function",
        function: action,
      })),
    })
    .on("message", (message) => {
      if (debug) {
        console.log("> message", message);
      }

      if (
        message.role === "assistant" &&
        message.tool_calls &&
        message.tool_calls.length > 0 &&
        message.tool_calls[0].function.name.startsWith("result")
      ) {
        lastFunctionResult = JSON.parse(
          message.tool_calls[0].function.arguments,
        );
      }
    });

  const finalContent = await runner.finalContent();

  if (debug) {
    console.log("> finalContent", finalContent);
  }

  if (!lastFunctionResult) {
    throw new Error("Expected to have result");
  }

  if (debug) {
    console.log("> lastFunctionResult", lastFunctionResult);
    console.log("> interactionLog", JSON.stringify(interactionLog, null, 2));
  }

  await runFinalCoverage(actions);

  return {
    ...(lastFunctionResult as TaskResult),
    interactions: interactionLog,
  };
};
