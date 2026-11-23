#!/usr/bin/env node
// Where the GitHub Pages site lives: a custom domain (served from the domain root)
// or the default https://<owner>.github.io/<repo>/ sub-path. Used by the deploy
// workflow (.github/workflows/deploy-pages.yml) and `npm run build:pages`.
//
//   CLI (prints GitHub Actions outputs):
//     PAGES_CUSTOM_DOMAIN=sentia.example.com node scripts/pages-site.mjs
//   → domain=sentia.example.com / base_path= / site_url=https://sentia.example.com

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://Sentia.Example.com/path" → "sentia.example.com"; "" when unset or not a valid hostname. */
export function normalizeDomain(raw) {
  const host = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  return DOMAIN_RE.test(host) && !host.endsWith(".github.io") ? host : "";
}

/** Normalise a base path to "" or "/segment". */
function normalizeBase(value) {
  const trimmed = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

/**
 * @param {{ customDomain?: string, pagesBasePath?: string, pagesBaseUrl?: string, repo?: string }} input
 * @returns {{ domain: string, basePath: string, siteUrl: string }}
 */
export function resolvePagesSite({ customDomain, pagesBasePath, pagesBaseUrl, repo } = {}) {
  const domain = normalizeDomain(customDomain);
  if (domain) return { domain, basePath: "", siteUrl: `https://${domain}` };
  const url = String(pagesBaseUrl ?? "").trim().replace(/\/+$/, "");
  const basePath = normalizeBase(pagesBasePath || (repo ? `/${repo}` : ""));
  return { domain: "", basePath, siteUrl: url };
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const r = resolvePagesSite({
    customDomain: process.env.PAGES_CUSTOM_DOMAIN,
    pagesBasePath: process.env.PAGES_BASE_PATH,
    pagesBaseUrl: process.env.PAGES_BASE_URL,
    repo: process.env.REPO_NAME,
  });
  if (process.env.PAGES_CUSTOM_DOMAIN && !r.domain) {
    console.error(`::warning::PAGES_CUSTOM_DOMAIN "${process.env.PAGES_CUSTOM_DOMAIN}" isn't a valid domain; building for the default github.io address.`);
  }
  process.stdout.write(`domain=${r.domain}\nbase_path=${r.basePath}\nsite_url=${r.siteUrl}\n`);
}
