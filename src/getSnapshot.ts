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
      
      const appModule = req(`${modulePrefix}/app`);
      debug.steps.push(`app module loaded: ${!!appModule}`);
      
      if (!appModule) {
        debug.error = `Could not load ${modulePrefix}/app`;
        return { routeName: null, currentURL: window.location.href, queryParams: {}, debug };
      }
      
      const app = appModule.default || appModule;
      debug.steps.push(`app instance: ${!!app}`);
      
      // Try multiple ways to get the container
      const container = app.__container__ || 
                       app.__deprecatedInstance__?.__container__ ||
                       (window as any).Ember?.getOwner?.(app);
      debug.steps.push(`container exists: ${!!container}`);
      
      if (!container) {
        // Try to get container from a running Ember app instance
        const emberApp = (window as any)[modulePrefix];
        debug.steps.push(`window.${modulePrefix} exists: ${!!emberApp}`);
        
        const altContainer = emberApp?.__container__ || 
                            emberApp?.__deprecatedInstance__?.__container__;
        debug.steps.push(`alt container from window.${modulePrefix}: ${!!altContainer}`);
        
        // Try to find container in window.Ember namespace
        const EmberNS = (window as any).Ember;
        debug.steps.push(`window.Ember exists: ${!!EmberNS}`);
        
        // Try to get application instance from Ember namespace
        const appInstance = EmberNS?.Application?.NAMESPACES?.find?.((ns: any) => 
          ns.name === modulePrefix || ns.modulePrefix === modulePrefix
        );
        debug.steps.push(`Ember.Application.NAMESPACES app: ${!!appInstance}`);
        
        const nsContainer = appInstance?.__container__ || appInstance?.__deprecatedInstance__?.__container__;
        debug.steps.push(`namespace container: ${!!nsContainer}`);
        
        const finalContainer = altContainer || nsContainer;
        
        if (finalContainer) {
          const routerService = finalContainer?.lookup?.("service:router");
          const router = finalContainer?.lookup?.("router:main");
          debug.steps.push(`using alt container - routerService: ${!!routerService}, router: ${!!router}`);
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
        }
        debug.error = 'Could not find container';
        return { routeName: null, currentURL: window.location.href, queryParams: {}, debug };
      }
      
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
