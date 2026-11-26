# Sentia API (Cloudflare Worker)

A tiny serverless backend for the Sentia pilot. The website on GitHub Pages is static, so
anything that needs a secret key or a place to store data lives here:

| Endpoint | What it does | Who can call it |
| --- | --- | --- |
| `GET /health` | Shows which features are switched on (never shows keys) | Anyone |
| `GET /quote?symbols=AAPL,SPY` | Real stock quotes: Finnhub first, Yahoo Finance as a backup | The Sentia site (and localhost) |
| `POST /feedback` | Saves a feedback message (and optionally posts it to Discord/Slack) | The Sentia site |
| `GET /feedback/list` | Lists saved feedback, newest first | **Only you** (admin token) |
| `POST /event` | Adds anonymous usage counts to daily totals (opt-in in the app) | The Sentia site |
| `GET /stats?days=7` | Daily usage totals | **Only you** (admin token) |
| `POST /coach` | AI coach answer, streamed (OpenAI or Anthropic) | The Sentia site |

Every feature is optional. Missing a key? That feature politely says "not configured" and the
app falls back (demo prices, built-in coach, email/GitHub feedback links).

---

## Deploy it (free tier, about 15 minutes)

You need: a computer with [Node.js 20+](https://nodejs.org) installed, and a terminal
(Terminal on Mac, PowerShell on Windows). Every command below is typed from **this `worker`
folder** (`cd worker`).

### 1. Create a free Cloudflare account
Go to <https://dash.cloudflare.com/sign-up>, sign up, and verify your email. No credit card is
needed for the free Workers plan.

### 2. Install the tools and log in
```bash
npm install
npx wrangler login
```
A browser window opens; click **Allow**. (Wrangler is Cloudflare's command-line tool.)

### 3. Create the storage (KV namespace)
```bash
npx wrangler kv namespace create SENTIA_KV
```
It prints something like `id = "0f2a…"`. Open `wrangler.toml`, find
`id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"` and paste your id between the quotes. Save.

### 4. Add your secrets (keys)
Each command asks you to paste the value, then press Enter. Nothing is shown on screen; that's normal.

```bash
# Real stock prices — free key from https://finnhub.io/register
npx wrangler secret put FINNHUB_API_KEY

# AI coach — pick ONE provider
npx wrangler secret put OPENAI_API_KEY        # from https://platform.openai.com/api-keys
# or
npx wrangler secret put ANTHROPIC_API_KEY     # from https://console.anthropic.com

# Your private password for reading feedback/stats (make it long and random, 16+ characters).
# Tip: run  node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"  and paste the result.
npx wrangler secret put ADMIN_TOKEN

# Optional: get each feedback message in Discord or Slack (an "incoming webhook" URL)
npx wrangler secret put FEEDBACK_WEBHOOK_URL
```

If you use Anthropic instead of OpenAI, also open `wrangler.toml` and change
`COACH_PROVIDER = "openai"` to `COACH_PROVIDER = "anthropic"`.

### 5. Deploy
```bash
npx wrangler deploy
```
It prints your API address, e.g. `https://sentia-api.<your-subdomain>.workers.dev`. Copy it.
The same deploy attaches `https://api.sentiacoach.com` when the sentiacoach.com zone is on this Cloudflare account.

### 6. Check it works
Open these in your browser (replace the address):
- `https://sentia-api.<you>.workers.dev/health` → shows `"ok": true` and which features are on.
- `https://sentia-api.<you>.workers.dev/quote?symbols=AAPL,SPY` → real prices.

Then follow **PILOT_SETUP.md** (in the main folder) to connect the website to it.

---

## Settings you can change (`wrangler.toml` → `[vars]`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | GitHub Pages, `https://sentiacoach.com`, `https://www.sentiacoach.com` | Websites allowed to use the API (comma-separated). Localhost and the mobile app origins are always allowed. |
| `COACH_PROVIDER` | `openai` | `openai` or `anthropic`. |
| `COACH_MODEL` | *(empty)* | Leave empty for the cheap defaults: `gpt-6-luna` (OpenAI) or `claude-haiku-5-5` (Anthropic). |
| `COACH_DAILY_LIMIT_PER_IP` | `30` | AI questions per visitor per day. |
| `COACH_DAILY_LIMIT_TOTAL` | `500` | AI questions per day for the whole site (your cost ceiling). |
| `SYMBOL_ALLOWLIST` | *(empty)* | Optional list of tickers `/quote` will accept. Empty = any normal US ticker. |
| `VAPID_SUBJECT` | *(unset)* | Only for background price alerts: `mailto:you@example.com`. |

Using a **custom domain** for the website? Add it to `ALLOWED_ORIGINS`, e.g.
`ALLOWED_ORIGINS = "https://christiandemarco447267-dotcom.github.io,https://sentia.example.com"` (see CUSTOM_DOMAIN.md).

Run `npx wrangler deploy` again after editing.

## Ticker search (`/search`)
`GET /search?q=apple` returns up to 10 US stocks/ETFs (`{ "results": [{ "symbol": "AAPL", "name": "APPLE INC" }] }`)
for the app's ticker autocomplete. It uses Finnhub's symbol search, so it needs `FINNHUB_API_KEY`; without
it the endpoint answers 503 and the app quietly keeps using its built-in ticker list. Results are cached
for 10 minutes and count toward the same 50/min Finnhub budget as quotes. Nothing to configure.

## Background price alerts (optional, off by default)
Out of the box, Sentia shows phone notifications for price alerts **only while the app is open or was
recently open** (Settings → Phone notifications). To also notify people when the app is fully closed,
the Worker can send **Web Push** messages. It stays off until you do all of the steps below, and the
website only shows the "Background alerts (beta)" switch once both halves are configured.

1. **Make a VAPID key pair** (identifies your server to Apple/Google/Mozilla push services):
   ```bash
   npx web-push generate-vapid-keys --json
   ```
   (Any VAPID generator works; you need the base64url *public* key, 87 characters, and *private* key, 43.)
2. **Add them to the Worker:**
   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY     # paste the private key
   npx wrangler secret put VAPID_PUBLIC_KEY      # paste the public key
   ```
   and in `wrangler.toml` → `[vars]` set `VAPID_SUBJECT = "mailto:you@example.com"` (a contact address
   push services can use if something goes wrong).
3. **Turn on the cron trigger:** in `wrangler.toml`, un-comment the `[triggers]` block
   (`crons = ["*/15 * * * *"]` checks every 15 minutes). The KV namespace from step 3 above is required.
4. `npx wrangler deploy`, then check `/health` shows `"push": true`.
5. **Tell the website the public key:** GitHub → Settings → Secrets and variables → Actions →
   **Variables** → New repository variable `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = the *public* key. Re-run the
   **Deploy to GitHub Pages** workflow.

How it works: when someone turns on "Background alerts (beta)", their browser creates a push
subscription and sends it to `POST /push/subscribe` with their **active** alerts only (id, ticker,
above/below, price). Each 15-minute cron run prices those tickers (same Finnhub → Yahoo path as
`/quote`), sends an encrypted push (RFC 8291 `aes128gcm`, signed with VAPID) for every alert that
crossed, and deletes it (alerts are one-shot, like in the app). Subscriptions that the push service
reports gone (404/410) are deleted; idle records expire after 60 days. iPhone users must add Sentia to
the Home Screen (iOS 16.4+) for any web notification to work.

## Reading feedback and stats

```bash
# Feedback (newest first)
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://sentia-api.<you>.workers.dev/feedback/list

# Usage totals for the last 7 days (days are in UTC)
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "https://sentia-api.<you>.workers.dev/stats?days=7"
```
You can also browse the raw data in the Cloudflare dashboard: **Storage & Databases → KV →
SENTIA_KV** (feedback keys start with `fb:`, daily totals with `ev:`).

## How it protects you
- **Keys never reach the browser.** They are Worker secrets; the website only knows the API URL.
- **CORS** only lets your Pages site (and localhost) call the API from a browser.
- **Push is opt-in and narrow:** only push services' own hosts (Google, Mozilla, Apple, Microsoft) are ever
  contacted for `/push`, and only active alerts are stored.
- **Rate limits:** ticker search 40/min and push sign-ups 20/min per visitor; quotes 60/min per visitor; feedback 3/min and 10/hour per visitor; AI coach 6/min
  plus the daily caps above. Finnhub calls are capped at 50/min with a 1-minute back-off after a 429.
- **Spam guards on feedback:** hidden honeypot field, 2,000-character cap, rate limits.
- **No raw IPs stored.** Rate-limit counters use a one-way hash that changes every day.
- **Prices are never invented.** If neither Finnhub nor Yahoo can price a ticker, the API says so.
  Yahoo prices and stale prices are labelled `delayed`.

## Developing and testing
```bash
npm test            # unit tests (fetch and KV are mocked; no real keys needed)
npm run typecheck
npx wrangler dev    # runs locally at http://127.0.0.1:8787
```
For local secrets during `wrangler dev`, create a `.dev.vars` file (git-ignored) with lines like
`FINNHUB_API_KEY=...`.

## Known limits
- Caching is per Worker instance (workers.dev has no shared edge cache), so very busy periods can
  use more Finnhub calls; the Worker then falls back to Yahoo (labelled Delayed).
- Market state comes from Finnhub's market-status endpoint when a key is set; otherwise from the New
  York clock, which doesn't know market holidays.
- Yahoo's chart API is unofficial and may change or block requests without notice.
- KV counters are approximate under heavy simultaneous use.
- The free plan allows 1,000 KV writes per day (feedback, usage batches and AI-coach counters all
  write). If you outgrow it, Workers Paid ($5/month) raises it to 1 million per month.
