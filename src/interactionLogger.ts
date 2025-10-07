import { ElementInteraction } from "./types";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Helper class to aggregate interactions across multiple auto() calls
 */
export class InteractionLogger {
  private interactions: ElementInteraction[] = [];
  private testName: string;
  private startTime: Date;

  constructor(testName: string = "test") {
    this.testName = testName;
    this.startTime = new Date();
  }

  /**
   * Add interactions from an auto() result
   */
  add(result: any): void {
    if (result && result.interactions && Array.isArray(result.interactions)) {
      this.interactions.push(...result.interactions);
    }
  }

  /**
   * Get all collected interactions
   */
  getAll(): ElementInteraction[] {
    return this.interactions;
  }

  /**
   * Get count of interactions
   */
  count(): number {
    return this.interactions.length;
  }

  /**
   * Clear all interactions
   */
  clear(): void {
    this.interactions = [];
  }

  /**
   * Get interactions summary
   */
  getSummary(): string {
    const summary = this.interactions.map((interaction, index) => {
      const tag = interaction.element.tag;
      const dataTag = interaction.element.attributes["data-tag"] || "";
      const id = interaction.element.attributes["id"] || "";
      const className = interaction.element.attributes["class"] || "";
      
      let selector = `<${tag}>`;
      if (dataTag) selector += ` [data-tag="${dataTag}"]`;
      else if (id) selector += ` #${id}`;
      else if (className) selector += ` .${className.split(" ")[0]}`;

      let actionInfo = interaction.action;
      if (interaction.actionData) {
        const data = JSON.stringify(interaction.actionData);
        actionInfo += ` ${data}`;
      }

      return `${index + 1}. ${actionInfo} on ${selector}`;
    });

    return summary.join("\n");
  }

  /**
   * Save interactions to a JSON file
   */
  saveToFile(filepath: string, includeMetadata: boolean = true): void {
    const dir = join(filepath, "..");
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }

    const data = includeMetadata
      ? {
          testName: this.testName,
          startTime: this.startTime.toISOString(),
          endTime: new Date().toISOString(),
          duration: Date.now() - this.startTime.getTime(),
          interactionCount: this.interactions.length,
          interactions: this.interactions,
        }
      : this.interactions;

    writeFileSync(filepath, JSON.stringify(data, null, 2));
  }

  /**
   * Save with auto-generated filename
   */
  saveWithTimestamp(directory: string = "./logs"): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `interactions-${this.testName}-${timestamp}.json`;
    const filepath = join(directory, filename);
    
    this.saveToFile(filepath);
    return filepath;
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    console.log(`\n=== INTERACTION SUMMARY (${this.count()} interactions) ===`);
    console.log(this.getSummary());
  }

  /**
   * Get interactions by action type
   */
  getByAction(action: string): ElementInteraction[] {
    return this.interactions.filter((i) => i.action === action);
  }

  /**
   * Get interactions by element tag
   */
  getByTag(tag: string): ElementInteraction[] {
    return this.interactions.filter((i) => i.element.tag === tag);
  }

  /**
   * Export as Playwright test code (basic implementation)
   */
  exportAsPlaywrightTest(): string {
    let code = `test('${this.testName}', async ({ page }) => {\n`;
    code += `  // Auto-generated from interaction log\n\n`;

    this.interactions.forEach((interaction) => {
      const attrs = interaction.element.attributes;
      let selector = "";

      // Prioritize data-tag*, then class, then id
      if (attrs["data-tag"]) {
        selector = `[data-tag="${attrs["data-tag"]}"]`;
      } else if (attrs["data-tag-id"]) {
        selector = `[data-tag-id="${attrs["data-tag-id"]}"]`;
      } else if (attrs["class"]) {
        selector = `.${attrs["class"].split(" ")[0]}`;
      } else if (attrs["id"]) {
        selector = `#${attrs["id"]}`;
      } else {
        selector = interaction.element.tag;
      }

      switch (interaction.action) {
        case "locator_click":
          code += `  await page.locator('${selector}').click();\n`;
          break;
        case "locator_fill":
          const value = interaction.actionData?.value || "";
          code += `  await page.locator('${selector}').fill('${value}');\n`;
          break;
        case "locator_check":
          code += `  await page.locator('${selector}').check();\n`;
          break;
        case "locator_uncheck":
          code += `  await page.locator('${selector}').uncheck();\n`;
          break;
        case "locator_selectOption":
          const optionValue = interaction.actionData?.value || "";
          code += `  await page.locator('${selector}').selectOption('${optionValue}');\n`;
          break;
        case "locator_pressKey":
          const key = interaction.actionData?.key || "";
          code += `  await page.locator('${selector}').press('${key}');\n`;
          break;
      }
    });

    code += `});\n`;
    return code;
  }
}
