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
      
      // Try to load router directly from require
      let routerService, router, routeName = null;
      
      try {
        routerService = req(`${modulePrefix}/services/router`)?.default;
        debug.steps.push(`loaded service:router module: ${!!routerService}`);
      } catch (e) {
        debug.steps.push(`failed to load service:router module`);
      }
      
      try {
        router = req(`${modulePrefix}/router`)?.default;
        debug.steps.push(`loaded router module: ${!!router}`);
      } catch (e) {
        debug.steps.push(`failed to load router module`);
      }
      
      // Try to find router instance in DOM
      const rootElement = document.querySelector('[data-ember-extension]') || 
                         document.querySelector('.ember-application') ||
                         document.body;
      debug.steps.push(`root element found: ${!!rootElement}`);
      
      // Try to get router from element's Ember view
      const emberView = (rootElement as any)?.__ember_view__ || 
                       (rootElement as any)?.__EMBER_VIEW__;
      debug.steps.push(`ember view on root: ${!!emberView}`);
      
      if (emberView) {
        const owner = emberView._owner || emberView.container;
        debug.steps.push(`owner from view: ${!!owner}`);
        
        if (owner && owner.lookup) {
          routerService = owner.lookup('service:router');
          router = router || owner.lookup('router:main');
          debug.steps.push(`from owner - routerService: ${!!routerService}, router: ${!!router}`);
        }
      }
      
      // Extract route name
      routeName =
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
