// Sentia support: the public inbox (forwarded by Cloudflare Email Routing) and mailto helpers.
// Framework-free so server pages, the Help chat and unit tests can share it.

export const SUPPORT_EMAIL = "support@sentiacoach.com";

/** mailto: link to the support inbox with a prefilled subject (and optional body). */
export function supportMailto(subject = "Sentia support", body?: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body.slice(0, 1500))}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join("&")}`;
}

/** Copyright line for footers; the year comes from the clock so it never goes stale. */
export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} Sentia · Christian DeMarco. All rights reserved.`;
}
