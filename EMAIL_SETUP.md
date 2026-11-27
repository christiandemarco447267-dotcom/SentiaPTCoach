# Turning on email verification and password reset (plain English)

Sentia now checks that every new email + password account really owns its email address, and it can
email people a password-reset code. To send those emails, Sentia uses **Resend**, a free email service.
Until you finish these steps, the website still works, existing accounts still sign in, Google / Apple
sign-in still works, but **new email + password sign-ups are paused** and show a polite "not set up yet"
message. Nobody can skip verification.

Time needed: about 15 minutes (plus however long DNS takes, usually a few minutes).
Cost: free. Resend's free plan (checked on resend.com/pricing, Nov 26, 2026) allows **3,000 emails a month
and at most 100 a day**. Each sign-up uses 1 email, each "Resend code" or password reset uses 1 more.

---

## 1. Create a Resend account
1. Go to <https://resend.com/signup> and sign up (free).

## 2. Add your domain
1. In Resend, open **Domains → Add domain**.
2. Type `sentiacoach.com` and pick the region **US East (N. Virginia)**. Click **Add**.
3. Resend now shows **3 DNS records**. Leave that page open.

## 3. Add the DNS records in Cloudflare
Easiest: on Resend's domain page press **Sign in to Cloudflare** and approve. It adds the records for you.

Or by hand: Cloudflare dashboard → `sentiacoach.com` → **DNS → Records → Add record**, three times,
copying the values from Resend (the values below are what they normally look like):

| Type | Name | Content | Priority / Proxy |
| --- | --- | --- | --- |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | Priority `10` |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `resend._domainkey` | the long `p=…` key Resend shows | DNS only |

**Important: don't change or delete the records that make `support@sentiacoach.com` work.** Those are the
Cloudflare Email Routing records on the bare domain (`@`): three MX records pointing to
`route1/route2/route3.mx.cloudflare.net` and a TXT record `v=spf1 include:_spf.mx.cloudflare.net ~all`.
Resend's records sit on `send.` and `resend._domainkey.`, so the two never clash.

Back in Resend, click **Verify DNS records**. When the domain shows **Verified**, continue.

## 4. Create an API key
1. Resend → **API Keys → Create API key**.
2. Name: `sentia-worker`. Permission: **Sending access**. Domain: `sentiacoach.com`.
3. Copy the key (it starts with `re_`). You only see it once.

## 5. Give the key to the Sentia API (Cloudflare Worker)
In a terminal, inside the project's `worker` folder:

```bash
npx wrangler secret put RESEND_API_KEY
# paste the re_… key and press Enter
npx wrangler deploy
```

## 6. Check it works
1. Open <https://api.sentiacoach.com/health>. You should see `"emailVerification": true`.
2. On the website, create a test account with an email you can read. You should get an email from
   **Sentia &lt;no-reply@sentiacoach.com&gt;** with a 6-digit code and a **Confirm my email** button.
3. Try **Forgot password?** on the sign-in page too.

If an email doesn't arrive: check spam, then Resend → **Emails** (it shows every send and any error).

## Optional settings (worker/wrangler.toml → [vars])
- `EMAIL_FROM`: the sender name and address (default `Sentia <no-reply@sentiacoach.com>`).
  Replies to account emails go to `support@sentiacoach.com`.
- `SITE_URL`: where email buttons point for the phone apps (default `https://sentiacoach.com`).

## The Help chat
The new **Help** button answers from the FAQ on the device, so it works with no setup. For questions the
FAQ can't match it asks the AI using the same `OPENAI_API_KEY` the coach already uses. If that key isn't
set, it simply offers "Email support@sentiacoach.com" instead.
