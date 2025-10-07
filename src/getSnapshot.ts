import { sanitizeHtml } from "./sanitizeHtml";
import { Page } from "./types";
import { EMBER_MODULE_PREFIX, TEMPLATE_MANIFEST_PATH } from "./config";
import { existsSync, readFileSync } from "fs";

type Manifest = { entries: { path: string }[] };

function tryLoadManifest(): Manifest | null {
  try {
    if (existsSync(TEMPLATE_MANIFEST_PATH)) {
      const data = JSON.parse(readFileSync(TEMPLATE_MANIFEST_PATH, "utf8"));
      console.log(`[getSnapshot] Loaded manifest with ${data.entries?.length || 0} entries from ${TEMPLATE_MANIFEST_PATH}`);
      return data;
    } else {
      console.log(`[getSnapshot] Manifest file not found at ${TEMPLATE_MANIFEST_PATH}`);
    }
  } catch (err) {
    console.log(`[getSnapshot] Failed to load manifest:`, err);
  }
  return null;
}

function deriveRenderStack(routeName: string | null, manifest: Manifest | null) {
  if (!routeName) {
    return { candidates: ["templates/application.hbs"], primary: null };
  }
  const parts = routeName.split(".");
  const paths: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    const seg = parts.slice(0, i).join("/");
    paths.push(`templates/${seg}.hbs` );
    paths.push(`templates/${seg}/index.hbs` );
  }
  paths.push("templates/application.hbs");
  const unique = Array.from(new Set(paths));
  const filtered = manifest
    ? unique.filter((p) => manifest.entries.some((e) => e.path === p))
    : unique;
  let primary: string | null = null;
  for (const p of filtered) {
    if (!p.endsWith("/index.hbs")) {
      primary = p;
      break;
    }
  }
  if (!primary && filtered.length) primary = filtered[0];
  return { candidates: filtered, primary };
}

export const getSnapshot = async (page: Page) => {
  const dom = sanitizeHtml(await page.content());
  const url = page.url();
  const route = await page.evaluate((modulePrefix: string) => {
    const debug: any = { steps: [] };
    try {
      const req = (window as any).require || (window as any).requirejs;
      debug.steps.push(`require exists: ${!!req}`);
      
      if (!req) {
        debug.error = 'No require/requirejs found on window';
        return { routeName: null, currentURL: window.location.href, queryParams: {}, debug };
      }
      
      const app = req(`${modulePrefix}/app`)?.default;
      debug.steps.push(`app loaded: ${!!app}`);
      
      if (!app) {
        debug.error = `Could not load ${modulePrefix}/app`;
        return { routeName: null, currentURL: window.location.href, queryParams: {}, debug };
      }
      
      const container = app.__container__;
      debug.steps.push(`container exists: ${!!container}`);
      
      const routerService = container?.lookup?.("service:router");
      debug.steps.push(`routerService exists: ${!!routerService}`);
      
      const router = container?.lookup?.("router:main");
      debug.steps.push(`router exists: ${!!router}`);
      
      const routeName =
        (routerService && (routerService as any).currentRouteName) ||
        (router && (router as any).currentRouteName) ||
        null;
      debug.steps.push(`routeName: ${routeName}`);
      
      const currentURL =
        (routerService && (routerService as any).currentURL) ||
        (router && (router as any).currentURL) ||
        window.location.pathname + window.location.search;
      const qp =
        (routerService &&
          typeof (routerService as any).currentRoute === "object" &&
          ((routerService as any).currentRoute as any).queryParams) ||
        {};
      return { routeName, currentURL, queryParams: qp, debug };
    } catch (e: any) {
      debug.error = e.message || String(e);
      return {
        routeName: null,
        currentURL: window.location.href,
        queryParams: {},
        debug,
      };
    }
  }, EMBER_MODULE_PREFIX);

  const manifest = tryLoadManifest();
  const stack = deriveRenderStack(route.routeName, manifest);
  console.log(`[getSnapshot] routeName=${route.routeName}, candidates=${stack.candidates.length}, primary=${stack.primary}`);
  if ((route as any).debug) {
    console.log(`[getSnapshot] debug:`, JSON.stringify((route as any).debug, null, 2));
  }

  return {
    dom,
    url,
    routeName: route.routeName,
    renderStack: stack.candidates,
    primaryTemplate: stack.primary,
  };
};
