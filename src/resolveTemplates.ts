import { TemplateManifest } from "./types";

function trimSlashes(s: string) {
  return s.replace(/^\/+|\/+$/g, "");
}

function toSegments(s: string): string[] {
  const body = trimSlashes(s);
  if (!body) return [];
  return body.split("/").map((x) => x.toLowerCase());
}

function pathToSegments(p: string): string[] {
  // 'templates/a/b/index.hbs' -> ['a','b','index']
  const body = p.replace(/^templates\//, "").replace(/\.hbs$/, "");
  return toSegments(body);
}

function isIdLike(seg: string) {
  return /^\d+$/.test(seg) || /^[0-9a-f-]{6,}$/.test(seg);
}

function commonPrefixLen(a: string[], b: string[]) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  for (; i < n; i++) {
    if (a[i] !== b[i]) break;
  }
  return i;
}

function lcsLen(a: string[], b: string[]) {
  const dp = Array(a.length + 1)
    .fill(0)
    .map(() => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function resolveTemplatesForUrl(
  url: string,
  manifest: TemplateManifest | null,
  maxCandidates = 12,
) {
  const base = url?.startsWith("http") ? new URL(url) : new URL(url, "http://x");
  const urlSegs = toSegments(base.pathname);
  const urlLast = urlSegs[urlSegs.length - 1] || "";
  const urlHasIdEnd = isIdLike(urlLast);

  const entries = (manifest?.entries ?? []).filter(
    (e) =>
      e.kind !== "component" &&
      !e.path.endsWith("-loading.hbs") &&
      !e.path.endsWith("-error.hbs"),
  );
  if (!entries.length) {
    return { candidates: ["templates/application.hbs"], primary: "templates/application.hbs" };
  }

  const scored = entries.map((e) => {
    const segs = pathToSegments(e.path);
    const lcs = lcsLen(urlSegs, segs);
    const prefix = commonPrefixLen(urlSegs, segs);
    const coverage = segs.filter((s) => urlSegs.includes(s)).length;
    let score = lcs * 5 + prefix * 3 + coverage;
    // Heuristics
    if (e.path.endsWith("/show.hbs") && urlHasIdEnd) score += 4;
    if (e.path.endsWith("/index.hbs") && !urlHasIdEnd) score += 2;
    if (segs.includes("checkout") && urlSegs.includes("checkout")) score += 4;
    if (segs.includes("confirmation") && urlSegs.includes("confirmation")) score += 4;
    if (segs.includes("search") && urlSegs.includes("search")) score += 3;
    if (segs.includes("edit") && urlSegs.includes("edit")) score += 3;
    if (segs.includes("create") && urlSegs.includes("new")) score += 2;
    return { path: e.path, score, depth: segs.length };
  });

  scored.sort((a, b) => b.score - a.score || b.depth - a.depth || a.path.localeCompare(b.path));
  const candidates = scored.slice(0, maxCandidates).map((x) => x.path);
  const primary = candidates[0] ?? null;
  return { candidates, primary };
}
