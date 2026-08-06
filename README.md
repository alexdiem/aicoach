# aicoach

A personal endurance training planner. It takes a goal event, pulls your actual
training from intervals.icu, generates a periodized plan, and writes you a short
weekly brief that says what to do and cites the numbers that drove it.

Two sources govern the plan, explicitly separated:

- **Joe Friel (Training Bible)** governs *structure* — phase sequence, CTL/ATL/TSB-driven
  load progression, 3:1 loading blocks, specificity near the event, taper length scaled
  to event duration.
- **Stacy Sims (ROAR)** governs the *shape of intensity* within that structure, plus
  fuelling around hard sessions and low-energy-availability screening. Time above easy
  is polarized, not pyramidal: the moderate-intensity "gray zone" (roughly 76–93% FTP —
  tempo, sweet spot) is held near-empty at every phase rather than ramped up through base
  the way a traditional model would. What replaces it is short, maximal sprint intervals
  (SIT: 20–40s all-out) placed early in the ride while neuromuscular freshness is highest —
  Sims is explicit that women respond poorly to chronic moderate-intensity volume; it
  raises cortisol without the adaptive stimulus real hard efforts provide.

Strength frequency is set directly by the athlete (Settings → Planning → Strength
sessions/week) rather than derived from either framework, and is held constant
across every stage of the plan — the plan takes what you're currently doing as
the baseline instead of guessing at it.

Nothing is averaged. Every divergent decision is stored with the framework (or
"Personal", for the strength frequency setting) that won, the reason, and the
alternative that was not taken, and it shows up in the UI under "Framework calls".

## Quick start

```bash
npm start                      # → http://127.0.0.1:8787
```

No build step and no `npm install` needed for local use. It needs Node ≥ 22.5 for the
built-in `node:sqlite`. (The one npm dependency in `package.json`, `@libsql/client`, is
only for the Vercel+Turso deployment path below — local `npm start` never imports it.)

Then, in the app:

1. **Settings** → paste your intervals.icu API key (intervals.icu → Settings →
   Developer Settings → API Key), hit *Save + test*, then *Sync*.
2. **Settings → Athlete** → check FTP and weight came across. FTP drives the wattage
   numbers quoted in briefs; weight drives the protein target.
3. **Goals** → create your goal. The plan generates immediately.
4. **Brief** → your week.

To see it working before wiring your own data up:

```bash
node tools/demo-seed.js                     # writes data/demo.db, prints a brief
AICOACH_DB=data/demo.db npm start
```

Local dev runs with no password by default. To put the same gate the deployed
version uses in front of it too, copy `.env.example` to `.env`, fill in
`APP_PASSWORD`/`SESSION_SECRET` (`node scripts/generate-password.js` generates
both), and `npm start` picks it up automatically.

## Where your data lives

Locally: a single SQLite file, `data/aicoach.db` (override with `AICOACH_DB`). The API
key is stored there and is only ever sent to intervals.icu. Nothing leaves the machine.

Deployed on Vercel: a Turso (libSQL) database — see **Deploying to Vercel** below for why.

## Deploying to Vercel

Vercel functions are stateless and serverless: there's no persistent local disk to put
a SQLite file on, and no long-running process for the background scheduler to live in.
So the deployment differs from local use in two ways:

- **Storage** moves from the local SQLite file to **Turso** (libSQL) — chosen specifically
  because libSQL is SQLite-compatible, so the schema and almost every query in this repo
  run completely unchanged. The only real change was sync → async database calls
  throughout the server (see `server/dbdriver.js`); nothing about the SQL itself differs
  between the two backends. `@libsql/client` is the one npm dependency this app has, and
  it's only ever imported when a Turso URL is configured — local `npm start` never needs
  it installed.
- **The background scheduler** (periodic intervals.icu sync + Monday replan) moves from
  a `setInterval` loop to **Vercel Cron**, configured in `vercel.json` to hit `/api/cron`
  on a schedule. That endpoint runs the exact same `runScheduledJobs()` logic the local
  loop calls (`server/scheduler.js`) — nothing is reimplemented for the deployed path.

Everything else — the plan generator, the brief's rule engine, the back-pain
correlation, the frontend — is the identical code running in both places.

### One-time setup

1. **Create a Turso database** (free tier is enough for personal use):
   ```bash
   npx @tursodatabase/cli auth login
   npx @tursodatabase/cli db create aicoach
   npx @tursodatabase/cli db show aicoach --url          # → TURSO_DATABASE_URL
   npx @tursodatabase/cli db tokens create aicoach        # → TURSO_AUTH_TOKEN
   ```
   (Or use the Turso web dashboard at [turso.tech](https://turso.tech) — same two values.)

2. **Deploy to Vercel** (`vercel` CLI, or connect the GitHub repo in the Vercel
   dashboard). The project needs no build step — `vercel.json` already points Vercel at
   `public/` for static assets and `api/` for the serverless functions.

3. **Set environment variables** in the Vercel project (Settings → Environment Variables):

   | Variable | Value | Required |
   | --- | --- | --- |
   | `TURSO_DATABASE_URL` | from step 1 | yes — without it the app has nowhere to persist data |
   | `TURSO_AUTH_TOKEN` | from step 1 | yes |
   | `CRON_SECRET` | any random string | recommended — without it `/api/cron` is unauthenticated (harmless, but locking it down is one field) |
   | `APP_PASSWORD` | a password you choose | strongly recommended — without it (and `SESSION_SECRET`) the deployed app is reachable by anyone with the URL, including your training data, back pain logs, and intervals.icu key |
   | `SESSION_SECRET` | a random key | required alongside `APP_PASSWORD` — signs the session cookie; never the password itself |

   Generate both with:
   ```bash
   node scripts/generate-password.js
   ```
   This prints a fresh `APP_PASSWORD=...` (three random words + a number) and
   `SESSION_SECRET=...` line — paste both into Vercel's env vars (and your
   local `.env` if you want the password gate locally too). Neither is
   committed to git. Run the script again any time you want to rotate: a new
   `APP_PASSWORD` changes what you type in, a new `SESSION_SECRET` immediately
   invalidates all previously issued session cookies without touching the
   password.

   Once both are set, the app shell and every `/api/*` route require this
   password — via a session cookie (issued at `/login.html`) or
   `Authorization: Bearer <password>` for scripted access.

4. **Redeploy** after setting the env vars (Vercel doesn't hot-reload environment
   changes into a running deployment). Then open the deployed URL and go to **Settings**
   to paste your intervals.icu API key, same as the local setup — it's stored in Turso now,
   not the local file, but the UI is identical.

### What to know about the deployed version

- **Cron frequency**: `vercel.json` defaults to `/api/cron` once daily (`"0 6 * * *"`,
  06:00 UTC) because Vercel's **Hobby** plan rejects the deploy outright for anything
  more frequent than daily. If you're on a Pro plan and want more frequent syncing,
  tighten this to e.g. `"0 */6 * * *"` (every 6 hours, matching the local scheduler's
  default) — Hobby will fail to deploy with that schedule, so only change it if you've
  confirmed you're on Pro.
- **Latency**: every database call is now a network round trip to Turso instead of a
  local file read. The brief endpoint batches its independent reads with `Promise.all`
  rather than awaiting them one at a time for exactly this reason (see the top of
  `buildBrief` in `server/brief.js`), but a cold Vercel function plus a few round trips
  will still feel slower than the instant local version — expect low hundreds of ms
  rather than the local single-digit ms.
- **Local dev is unaffected.** `npm start` never looks at `TURSO_DATABASE_URL`; it only
  matters once that variable is set, which local development never does unless you set
  it yourself.

## The core loop

**Goal → plan.** A goal is any endurance target: an event with distance/climbing, a
duration, or a metric target like an FTP number. From the profile the planner estimates
event duration and load, derives the peak weekly volume the event justifies, allocates
Friel phases across the available weeks, and ramps weekly TSS toward the required CTL
with a per-phase ramp cap and a recovery week every 3rd (or 2nd) week.

**Data in.** `POST /api/sync` (or the *Sync* button, or every 6h in the background)
pulls activities and daily wellness. Per activity it stores TSS, IF, NP, avg/max power,
VI, EF, TRIMP, CTL/ATL/TSB, FTP/eFTP, W′ and W′bal drop, HR, duration, elevation, power
and HR zone times, and your description text.

**Plan vs actual.** Each week compares planned TSS, hours and intensity distribution
against what you did, and interprets the gap rather than just reporting it. Rising ATL
with falling EF at matched IF is read as under-recovery and cuts the next block, not as
a reason to push.

**Brief out.** A short written brief per week, stored so you can read back what was said
and why. If a rule fires, it names the number: *"Cap intensity at Z2 this week — Form is
at −22"*, not *"consider recovery"*.

**Adjustments are applied, not just described.** When a rule cuts the week, it rewrites
that week's row in `plan_weeks` — target TSS, hours, zone split, long session and key
sessions all move together — so the directive, the "do this" list and the week table can
never quote three different numbers. The change is recorded in the week's framework calls.

**Replanning.** Every Monday (and on demand) the plan regenerates from your *actual*
current CTL, compliance and EF trend. Weeks before the current one are carried over
verbatim, so what was originally prescribed survives every regeneration. Plan versions
are kept.

**Today, not just this week.** The Brief page also shows a same-day readiness check —
HRV and resting HR against your own trailing 21-day baseline, and last night's sleep
duration — using whatever daily wellness sync already pulled in. Quiet unless a number
crosses a line, and it stays quiet entirely if there's no recent wellness data to read.
The 1–4/1–5 subjective wellness fields intervals.icu also syncs (soreness, fatigue,
stress, mood, motivation, injury, its own "readiness" score) are shown as logged, not
scored — this app couldn't get a confident, verified read on which direction of that
scale means "better" from intervals.icu's docs, and guessing wrong there would mean
giving backwards recovery advice, which is worse than showing the plain number.

## Back-pain monitoring

Built in from the start, because the hypothesis is specific: pain tracks
**high intensity in the drops**, not distance.

Log per ride: position (upright/drops/mixed), back pain (none/mild/moderate/flare),
optional time in drops, RPE and notes — either in the **Log** tab, or by tagging the
activity description in intervals.icu, which syncs across automatically:

```
#drops   #upright   #mixed   #drops:90   #pain:moderate   #rpe:8
```

Manual edits in the app always win over tags.

The **Back pain** tab cross-tabulates pain rate by position *within* an intensity band,
and always shows the distance control beside it — without that, "drops rides hurt" is
indistinguishable from "long rides hurt". It also compares VI and time-in-drops on pain
vs pain-free rides. It is counts and rates over the underlying rides, not a model, and
it says so plainly when there isn't enough data yet.

## Optional intake logging

Logging daily intake/protein is an opt-in add-on. **The plan is fully functional
without it**, and the app never asks you to log anything.

| If you log… | You get |
| --- | --- |
| daily intake / protein | low-energy-availability screening, and a protein-target flag against 2.0 g/kg |

### Strength dosing

Strength frequency is set in Settings → Planning → "Strength sessions/week" — the
number of strength sessions the athlete is currently doing — and the plan holds
that frequency constant through every phase (only the type of strength work
changes by phase: anatomical adaptation in prep, max-strength in base, power in
build2, and so on). It's cut to 1×/wk in taper (0 if the setting is already 0)
and dropped entirely in race week. This is a personal calibration, not a Friel or
Sims rule — recorded in "Framework calls" as `Personal`.

### Where Friel and Sims diverge

| Decision | Winner | Why |
| --- | --- | --- |
| Fuelling around hard sessions, low-energy-availability screening | **Sims** | Friel doesn't model this. |
| Shape of intensity within a week (polarized vs. pyramidal) | **Sims** | Friel's model is pyramidal — real time in the 76–93% FTP gray zone through base and build. Sims' polarized model holds that zone near-empty at every phase instead. |
| Phase sequence, ramp rate, recovery weeks, taper length | **Friel** | The periodization structure itself. |

## Stack

Node's built-in HTTP server, vanilla ES-module frontend, inline SVG charts. `node:sqlite`
locally; Turso (libSQL) when deployed to Vercel (see above) — `@libsql/client` is the one
npm dependency this app has, and it's only ever imported for that path. No build step,
no framework, no bundler.

```
server/
  db.js             schema + settings, backend-agnostic
  dbdriver.js       the sqlite / Turso driver abstraction
  requestHandler.js shared route-dispatch used by both entry points below
  intervals.js      intervals.icu API client
  sync.js           ingestion, normalisation, #tag parsing
  metrics.js        CTL/ATL/TSB, EF trend, VI drift, W'bal, distribution, compliance
  planner.js        event demand model, phase allocation, load ramp, strength dosing
  brief.js          the weekly rule engine and its markdown output
  backpain.js       position/pain cross-tabs
  api.js            JSON routes (the route table itself)
  index.js          local entry point: HTTP server + static + background scheduler
  scheduler.js      periodic sync + Monday replan (shared by both entry points)
  cli.js            terminal entry points
api/
  index.js          Vercel entry point for the whole API surface (one function)
  cron.js           Vercel Cron target (a separate function, routed explicitly)
public/             index.html, app.js, styles.css
vercel.json         static output dir, /api/* routing, cron schedule
```

**Why routing to two functions via `vercel.json`'s `routes`, not per-path files
or a bracket catch-all:** two things went wrong on the way here, in order:

1. `api/[...slug].js` (Vercel's bracket-based catch-all file convention) didn't
   behave as documented — single-segment paths like `/api/status` resolved,
   but anything with two or more path segments 404'd at Vercel's platform
   routing layer before the function code ever ran.
2. Replacing it with a `vercel.json` **`rewrites`** rule pointing every
   `/api/*` request at one function hit the exact same symptom.
3. Giving every path its own literal file (24 functions) sidestepped both
   routing issues, but hit a real, different wall: **Vercel's Hobby plan caps
   a deployment at 12 Serverless Functions**, so that approach can't ship on
   Hobby regardless of whether the routing itself would have worked.

The fix that actually holds: two functions total (`api/index.js` for
everything in `server/api.js`'s route table, `api/cron.js` for the Cron
target), routed via `vercel.json`'s **legacy `routes` array** — a lower-level,
more explicit mechanism than `rewrites`, evaluated unconditionally in the
listed order rather than as a fallback:
```json
"routes": [
  { "src": "/api/cron", "dest": "/api/cron" },
  { "src": "/api/(.*)", "dest": "/api" },
  { "handle": "filesystem" }
]
```
The first two rules force every `/api/*` request through one of the two
functions before anything else is tried; `{"handle": "filesystem"}` then lets
everything else (the static frontend) fall through to normal static-file
resolution from `outputDirectory`. The routing logic itself is unchanged —
it still lives entirely in `server/api.js`'s route table via `matchRoute`;
these two files just adapt Vercel's request/response shape to that shared
dispatcher (`server/requestHandler.js`).

## CLI

```bash
node server/cli.js key <APIKEY>      # store the API key
npm run sync                          # pull from intervals.icu
npm run replan                        # regenerate the active goal's plan
npm run brief                         # print this week's brief
node server/cli.js weekly             # replan + write the brief (what the scheduler runs)
node server/cli.js backpain           # the correlation table, in the terminal
node server/cli.js status
npm test
```

For cron instead of the built-in scheduler, set `auto_sync_hours` to `0` and
`auto_replan_enabled` to `0` in Settings, then schedule `node server/cli.js weekly`.

## The models, and their limits

Worth knowing before you trust a number:

- **Event duration** for a ride is `distance / (base speed × (1 − 0.01 × m of climbing
  per km))`, base 22 km/h self-supported and 26 supported; ski/hike is vertical-driven at
  450 m/h. Override it on the goal if you know better — the whole plan scales off it.
- **Event load** is `duration × IF² × 100` with IF decaying logarithmically from 0.95 at
  1 h. Above ~24 h these IF estimates are extrapolation, not measurement.
- **Peak weekly hours** is a log fit through the usual coaching anchors
  (1 h event → ~8 h/wk, 6 h → ~13.5, 24 h → ~17.7, 60 h → ~20.5), capped by
  `max_weekly_hours` if you set it.
- **Weekly TSS for a target CTL ramp of r** is `7 × (CTL + 6r)`, from the 42-day
  exponential model, then capped at +10% week-on-week inside a block.
- **Form (TSB)** is yesterday's CTL − yesterday's ATL, matching what intervals.icu shows.
  It deliberately does not equal today's CTL − ATL, and the brief says so.
- **EF trend** compares the last 21 days against the preceding 42, restricted to rides
  at IF 0.55–0.88 lasting ≥45 min, and refuses to report a trend unless both windows have
  ≥3 rides and their mean IF is within 0.06. An unmatched EF comparison is noise.

When the goal is not reachable in the time available, the plan says so with numbers
rather than quietly prescribing a fantasy ramp.
