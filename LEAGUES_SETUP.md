# Friend leagues: setup (Firebase)

Friend leagues let people compare **Discipline Scores** (30-day return breaks ties) by sharing a
six-character code or an invite link. They need sign-in, so they switch on only when the site is
built with a Firebase project. Without it, the Leagues page explains that leagues aren't available
and everything else keeps working in guest (demo) mode.

Only a tiny summary is shared with league members: display name, Discipline Score and 30-day return.
Holdings, trades and balances never leave the user's own account.

Time needed: about 20 minutes. Cost: free (Spark plan) unless you also want SMS two-step sign-in.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `sentia`) → you can
   turn Google Analytics off → **Create**.
2. In the project, click the **Web** icon (`</>`) → nickname `Sentia web` → **Register app**.
   (Skip "Firebase Hosting" here; the site stays on GitHub Pages.)
3. Firebase shows a `firebaseConfig` block. Keep that tab open; you need six values from it in step 4.

## 2. Turn on sign-in

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → turn on **Email/Password** *and* **Email link
   (passwordless sign-in)** → **Save**.
3. **Settings** tab → **Authorized domains** → **Add domain** for every address the site runs on:
   - `christiandemarco447267-dotcom.github.io`
   - your custom domain, if you set one up (see `CUSTOM_DOMAIN.md`)
   - `localhost` is there already (for testing).
4. *(Optional)* SMS two-step verification needs the paid Blaze plan + Identity Platform. Skip it for
   now; the app says so politely if it isn't enabled.

Sentia requires a **verified email** before an account opens, so new users get a verification email
automatically.

## 3. Create the database and publish the security rules

1. **Build → Firestore Database → Create database** → pick a location near your users (e.g.
   `nam5 (us-central)`) → start in **production mode** → **Create**.
2. Open the **Rules** tab, delete what's there, paste the whole contents of `firestore.rules`
   from this repo, and click **Publish**.

What the rules allow (and nothing else):

| Path | Who can do what |
| --- | --- |
| `users/{uid}/state/current` | Only that signed-in user (verified email) can read/write their paper account. |
| `leagues/{code}` | Any verified user can *open* a league by its exact code (no listing/browsing). Creating one requires a valid 6-character code, a 1–40 character name, and `createdBy` = the creator. Leagues can't be edited or deleted. |
| `leagues/{code}/members/{uid}` | Only members can read the leaderboard. Each user can write or delete **only their own** row, which may contain only `displayName` (1–30 chars), `disciplineScore` (0–100 integer), `monthlyReturnPct` (−100…1000 or null) and a server timestamp. |

> Command-line alternative: `npm i -g firebase-tools`, `firebase login`, `firebase use --add`
> (pick the project), then `firebase deploy --only firestore:rules`.

## 4. Give the website its Firebase settings

These six values are **public identifiers** (security comes from the rules above), so they go in
GitHub **Variables**, not Secrets.

GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab →
**New repository variable**, once for each:

| Variable name | Value from `firebaseConfig` |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |

Then **Actions** → **Deploy to GitHub Pages** → **Run workflow** (or push to `main`). The deploy
workflow passes these into the build; when all four required ones (`API_KEY`, `AUTH_DOMAIN`,
`PROJECT_ID`, `APP_ID`) are present, sign-in, cloud sync and leagues turn on.

For a local build, put the same six lines in `.env.local` (see `.env.example`).

## 5. Check it end to end

1. Open the site → **Create account** → verify the email → you land in the app ("Synced" badge).
2. **Leagues** → *Create a league* → name it → you see the code and yourself on the board.
3. Tap **Invite** → share the link (or code) with a second account (another browser/phone).
4. The friend opens the link → signs in → the code is pre-filled → **Join** → both boards update live.
5. **Leave** removes your row from that league's leaderboard.

## Troubleshooting

| You see | Fix |
| --- | --- |
| "Friend leagues need a Sentia account" with no sign-in buttons | The build has no Firebase settings. Recheck step 4 and redeploy. |
| `auth/unauthorized-domain` or the email link doesn't work | Add the exact site domain in Authentication → Settings → Authorized domains. |
| "Missing or insufficient permissions" / "You're not a member…" | Publish `firestore.rules` (step 3), make sure the email is verified, and join with the code. |
| A friend's row shows an old score | Rows update while that person has Sentia open; the "updated … ago" line shows freshness. |

The native iPhone/Android app builds keep accounts off unless `NEXT_PUBLIC_NATIVE_FIREBASE=true`
(see `STORE_RELEASE.md` → "Accounts in the app").
