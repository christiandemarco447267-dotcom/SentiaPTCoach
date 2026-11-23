# Using a custom domain (e.g. `sentia.app`)

Today the site lives at **https://christiandemarco447267-dotcom.github.io/SentiaPTCoach/**. The code is
ready to move to your own domain whenever you buy one. Nothing changes until you set the variable in
step 3, so you can do this at your own pace.

What the code does for you once the variable is set:
- builds the site for the domain root (no `/SentiaPTCoach` in links),
- uses `https://<your-domain>` for page metadata, share previews, the sitemap and robots.txt,
- writes the `CNAME` file GitHub Pages needs on every deploy.

---

## 1. Buy the domain (your choice of registrar)

Any registrar works (Cloudflare Registrar, Namecheap, Porkbun, Google/Squarespace Domains…). A
subdomain of a domain you already own (e.g. `app.yourname.com`) works too.

## 2. Point DNS at GitHub Pages

In your registrar's DNS settings:

**For a subdomain** like `app.example.com` — one record:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `app` | `christiandemarco447267-dotcom.github.io` |

**For the bare domain** like `example.com` — four A records (and optionally AAAA for IPv6):

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `christiandemarco447267-dotcom.github.io` |

(These are GitHub's published Pages addresses: <https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site>.)

Optional but recommended: in GitHub → your profile **Settings → Pages → Add a domain**, verify the
domain so nobody else can claim it on GitHub.

## 3. Tell the deploy workflow

GitHub → the repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** →
**New repository variable**:

| Name | Value |
| --- | --- |
| `PAGES_CUSTOM_DOMAIN` | `app.example.com` (just the domain: no `https://`, no slash) |

Then **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

## 4. Switch it on in Pages settings

Repo **Settings → Pages → Custom domain** → type the same domain → **Save**. Wait for the DNS check
(minutes to a few hours), then tick **Enforce HTTPS**.

## 5. Update the services that check the address

| Service | Where | What to add |
| --- | --- | --- |
| Sentia API (Cloudflare Worker), if deployed | `worker/wrangler.toml` → `ALLOWED_ORIGINS` | `,https://app.example.com` then `npx wrangler deploy` |
| Firebase sign-in, if set up | Firebase console → Authentication → Settings → Authorized domains | `app.example.com` |
| App store listings / privacy URLs | `STORE_LISTING.md` | the new privacy, terms and support links |

## Going back

Delete the `PAGES_CUSTOM_DOMAIN` variable, remove the domain in **Settings → Pages**, and re-run the
deploy. The site returns to the `github.io/SentiaPTCoach/` address.

## Notes

- Old `github.io/SentiaPTCoach/...` links redirect to the custom domain automatically once GitHub
  Pages has the domain.
- Saved data lives per address in each browser. People who used the old address start with a fresh
  demo workspace on the new one unless they **Export JSON** (Settings) on the old address and
  **Import JSON** on the new one, or sign in to an account (cloud sync).
- Local test build for a domain: `PAGES_CUSTOM_DOMAIN=app.example.com npm run build:pages` (writes
  `out/CNAME`).
