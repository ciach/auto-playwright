import { MAX_TASK_CHARS } from "./config";
import { type Page, type Test, StepOptions } from "./types";
import { completeTask } from "./completeTask";
import { UnimplementedError } from "./errors";
import { getSnapshot } from "./getSnapshot";

export const auto = async (
  task: string,
  config: { page: Page; test?: Test },
  options?: StepOptions,
): Promise<any> => {
  if (!config || !config.page) {
    throw Error(
      "The auto() function is missing the required `{ page }` argument.",
    );
  }

  const { test, page } = config as { page: Page; test?: Test };

  if (!test) {
    return await runTask(task, page, options);
  }

  return test.step(`auto-playwright.ai '${task}'`, async () => {
    const result = await runTask(task, page, options);

    if (result.errorMessage) {
      throw new UnimplementedError(result.errorMessage);
    }

    // Determine the primary return value
    let returnValue: any;
    if (result.assertion !== undefined) {
      returnValue = result.assertion;
    } else if (result.query !== undefined) {
      returnValue = result.query;
    } else {
      returnValue = undefined;
    }

    // Attach the full result (including interactions) to the return value
    // This allows accessing result.interactions while maintaining backward compatibility
    if (returnValue !== null && returnValue !== undefined) {
      if (typeof returnValue === 'object') {
        return { ...returnValue, _autoPlaywrightResult: result };
      }
    }
    
    // For primitive return values or undefined, return the full result
    return result;
  });
};

async function runTask(
  task: string,
  page: Page,
  options: StepOptions | undefined,
) {
  if (task.length > MAX_TASK_CHARS) {
    throw new Error(
      `Provided task string is too long, max length is ${MAX_TASK_CHARS} chars.`,
    );
  }

  const result = await completeTask(page, {
    task,
    snapshot: await getSnapshot(page),
    options: options
      ? {
          model: options.model ?? "gpt-4o",
          debug: options.debug ?? false,
          openaiApiKey: options.openaiApiKey,
          openaiBaseUrl: options.openaiBaseUrl,
          openaiDefaultQuery: options.openaiDefaultQuery,
          openaiDefaultHeaders: options.openaiDefaultHeaders,
        }
      : undefined,
  });
  return result;
}
