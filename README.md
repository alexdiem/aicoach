# aicoach

A personal endurance training planner. It takes a goal event, pulls your actual
training from intervals.icu, generates a periodized plan, and writes you a short
weekly brief that says what to do and cites the numbers that drove it.

Two frameworks, explicitly separated:

- **Joe Friel (Training Bible)** governs *structure* — phase sequence, CTL/ATL/TSB-driven
  load progression, 3:1 loading blocks, specificity near the event, taper length scaled
  to event duration.
- **Stacy Sims (female physiology)** governs *every decision where the two disagree* —
  strength dosing through build/peak, fuelling around hard sessions, and cycle-phase
  placement of intensity including the taper.

Nothing is averaged. Every divergent decision is stored with the framework that won,
the reason, and the alternative that was not taken, and it shows up in the UI under
"Framework calls".

## Quick start

```bash
npm start                      # → http://127.0.0.1:8787
```

No dependencies, no build step, no `npm install`. It needs Node ≥ 22.5 for the
built-in `node:sqlite`.

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

## Where your data lives

A single SQLite file, `data/aicoach.db` (override with `AICOACH_DB`). The API key is
stored there and is only ever sent to intervals.icu. Nothing leaves the machine.

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

## Back-pain monitoring

Built in from the start, because the hypothesis is specific: pain tracks
**high intensity in the drops**, not distance.

Log per ride: position (upright/drops/mixed), back pain (none/mild/moderate/flare),
optional time in drops, RPE and notes — either in the **Log** tab, or by tagging the
activity description in intervals.icu, which syncs across automatically:

```
#drops   #upright   #mixed   #drops:90   #pain:moderate   #rpe:8   #cycle:luteal_early
```

Manual edits in the app always win over tags.

The **Back pain** tab cross-tabulates pain rate by position *within* an intensity band,
and always shows the distance control beside it — without that, "drops rides hurt" is
indistinguishable from "long rides hurt". It also compares VI and time-in-drops on pain
vs pain-free rides. It is counts and rates over the underlying rides, not a model, and
it says so plainly when there isn't enough data yet.

## Optional Sims inputs

Everything Sims-specific is an opt-in add-on. **The plan is fully functional with none
of it**, and the app never asks you to log anything.

| If you log… | You get |
| --- | --- |
| period start dates (or cycle phase) | cycle-phase periodization: quality work placed in the low-hormone window, load trimmed ~5–10% and top-end intervals moved out of the high-hormone window, phase-specific fuelling notes, and a cycle-aware taper |
| daily intake / protein | low-energy-availability screening, and a protein-target flag against 2.0 g/kg |

Cycle phase is also read from intervals.icu wellness if you track it there.

### Where Friel and Sims diverge

| Decision | Winner | Why |
| --- | --- | --- |
| Strength through Build/Peak | **Sims** | Held at 2 heavy sessions/wk for bone density and neuromuscular power. Friel drops to 1×/wk maintenance to protect bike-specific quality. |
| Taper depth when the race falls in a high-hormone phase | **Sims** | Higher core temperature and lower plasma volume mean residual fatigue costs more on the day, so volume is cut a further 8 points below Friel's duration-scaled taper. |
| Weekly load and intensity placement, given cycle data | **Sims** | Friel would set the week from block position alone. |
| Phase sequence, ramp rate, recovery weeks, taper length | **Friel** | Sims does not contradict the periodization structure. |

Without cycle data, only the strength row applies; the rest of the plan is pure Friel.

## Stack

Node's built-in HTTP server and `node:sqlite`, vanilla ES-module frontend, inline SVG
charts. Zero npm dependencies, deliberately — it's a personal tool and a dependency tree
is a liability, not a feature.

```
server/
  db.js         schema + settings
  intervals.js  intervals.icu API client
  sync.js       ingestion, normalisation, #tag parsing
  metrics.js    CTL/ATL/TSB, EF trend, VI drift, W'bal, distribution, compliance
  cycle.js      optional menstrual-cycle model + Sims adjustments
  planner.js    event demand model, phase allocation, load ramp, Sims overlays
  brief.js      the weekly rule engine and its markdown output
  backpain.js   position/pain cross-tabs
  api.js        JSON routes
  index.js      HTTP server + static
  scheduler.js  periodic sync + Monday replan
  cli.js        terminal entry points
public/         index.html, app.js, styles.css
```

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
