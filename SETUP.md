# Setup

You don't need any of this to run the app right now. Phase 0 works with zero
credentials — the calendar you see is realistic fake data. Come back to each
section when the phase that needs it lands.

```bash
npm run dev
```

Then open http://localhost:3000. The Setup panel at the bottom of the page
tells you which of these is still missing.

---

## Phase 1 — Supabase (database + login)

1. Go to https://supabase.com/dashboard and create a project. Free tier is far
   more than one person needs. Pick a region near you.
2. Wait for it to finish provisioning (~2 minutes).
3. **Project Settings → API**. Copy into `.env.local`:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   The `anon` key is safe in the browser — Row Level Security is what actually
   protects your rows, and every table has it enabled. Do not copy the
   `service_role` key into this project.
4. Apply the schema. Either paste `supabase/migrations/0001_init.sql` into the
   dashboard's **SQL Editor** and run it, or use the CLI:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

5. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` while developing.
   - Redirect URLs: add `http://localhost:3000/auth/callback`. Add the Vercel
     equivalent when you deploy. Magic links bounce without this.
6. **Authentication → Providers → Email**: make sure Email is enabled. Turn
   **Confirm email** on and leave passwords off if you only want magic links.

Nothing else is needed — the default email template lands on `/auth/callback`
with a PKCE code, which the app handles. If you ever customise the template to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, that
route exists too and works the same way.

**Preview mode**: until these keys exist the app skips login entirely and keeps
settings in memory, so you can use it locally. It is disabled in production
builds — a deployed app with no Supabase keys shows the login page and refuses
to proceed, rather than serving a shared anonymous account.

---

## Phase 2 — Apple app-specific password (iCloud Calendar)

Apple has no OAuth for calendar access. Third-party CalDAV clients authenticate
with an **app-specific password**, which requires two-factor authentication on
your Apple Account. It only works for this one app and you can revoke it at any
time without touching your real password.

1. Sign in at https://account.apple.com.
2. **Sign-In and Security → App-Specific Passwords → Generate**.
3. Label it something you'll recognise later, e.g. `Planner`.
4. Copy the 16-character password. Apple shows it once.
5. Generate an encryption key:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Put it in `.env.local` as `APP_ENCRYPTION_KEY`. This encrypts the Apple
   password before it reaches the database (AES-256-GCM). If you lose or change
   this key, the stored credential becomes unreadable and you'll reconnect
   iCloud — no other damage.
6. Set `CALENDAR_PROVIDER=icloud`.
7. Enter the Apple ID and app-specific password in the app's Settings page. It
   is encrypted server-side immediately; it is never sent to the browser again
   and never written to logs.

**Revoking:** same Apple page, delete the entry. The app will report a
connection error at the next sync; nothing else breaks.

---

## Phase 3 — Anthropic API key

1. https://console.anthropic.com → **API Keys** → Create Key.
2. `.env.local`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Leave `CLAUDE_MODEL=claude-sonnet-5`. Sonnet-tier is deliberate — planning
   and check-in run often enough that Opus would be a poor trade for a personal
   app. Set a spend limit in the console while you get a feel for the cost.

---

## Deploying to Vercel

1. `npx vercel` from this directory, or import the repo at vercel.com.
2. Add every variable from `.env.example` under **Settings → Environment
   Variables**. `APP_ENCRYPTION_KEY` and `ANTHROPIC_API_KEY` must **not** have
   the `NEXT_PUBLIC_` prefix — that would expose them to the browser.
3. Add your production URL to Supabase's **Authentication → URL Configuration**
   redirect allow-list, or magic links will bounce.
