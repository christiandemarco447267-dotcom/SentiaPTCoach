#!/usr/bin/env node
// Local reproduction of the GitHub Pages build (.github/workflows/deploy-pages.yml):
// a static export under the repo sub-path (default /SentiaPTCoach) → ./out.
//   npm run build:pages            (or PAGES_BASE_PATH=/Other npm run build:pages)
//   PAGES_CUSTOM_DOMAIN=sentia.example.com npm run build:pages   (custom domain: no base path + out/CNAME)
// Like CI, the server-only API routes and proxy are moved aside for the build and restored after.
import { spawnSync } from "node:child_process";
import { resolvePagesSite } from "./pages-site.mjs";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const site = resolvePagesSite({
  customDomain: process.env.PAGES_CUSTOM_DOMAIN,
  pagesBasePath: process.env.PAGES_BASE_PATH ?? "/SentiaPTCoach",
  pagesBaseUrl: process.env.NEXT_PUBLIC_SITE_URL,
  repo: "SentiaPTCoach",
});
const base = site.basePath;
const stash = path.join(root, ".static-build-stash");
const moves = [
  ["src/app/api", "api"],
  ["src/proxy.ts", "proxy.ts"],
];
function restore() {
  for (const [from, name] of moves) {
    const parked = path.join(stash, name);
    if (existsSync(parked) && !existsSync(path.join(root, from))) renameSync(parked, path.join(root, from));
  }
  rmSync(stash, { recursive: true, force: true });
}
restore();
mkdirSync(stash, { recursive: true });
for (const [from, name] of moves) if (existsSync(path.join(root, from))) renameSync(path.join(root, from), path.join(stash, name));
let status = 1;
try {
  status =
    spawnSync("npx", ["next", "build"], {
      stdio: "inherit",
      env: {
        ...process.env,
        GITHUB_PAGES: "true",
        PAGES_BASE_PATH: base,
        NEXT_PUBLIC_BASE_PATH: base,
        NEXT_PUBLIC_STATIC_EXPORT: "true",
        ...(site.siteUrl ? { NEXT_PUBLIC_SITE_URL: site.siteUrl } : {}),
      },
      shell: process.platform === "win32",
    }).status ?? 1;
} finally {
  restore();
}
if (status === 0) {
  writeFileSync(path.join(root, "out", ".nojekyll"), "");
  if (site.domain) writeFileSync(path.join(root, "out", "CNAME"), `${site.domain}\n`);
}
process.exit(status);
