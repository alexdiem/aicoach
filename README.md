# aicoach

Personal cross-sport training planner for cycling, running, and XC skiing. Pulls data from Garmin, tracks fitness with ATL/CTL/TSB, generates polarized weekly plans, and matches interval workouts to your actual terrain.

## Stack

- **Backend**: Python + FastAPI + SQLite (async SQLAlchemy)
- **Frontend**: React + TypeScript + Vite + Tailwind + Recharts
- **AI**: Claude Haiku (Anthropic) — used sparingly for plan narratives and compliance scoring
- **Data**: Garmin Health API (OAuth 1.0a)

## Setup

### 1. Configure credentials

No developer account or API approval needed. Uses the [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) library, which authenticates with the same SSO flow as the Garmin Connect mobile app.

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and fill in:
# GARMIN_EMAIL=your.email@example.com
# GARMIN_PASSWORD=your-garmin-connect-password
# ANTHROPIC_API_KEY=sk-ant-... (optional, for AI coaching)
# SECRET_KEY=$(openssl rand -hex 32)
```

### 3. Run with Docker Compose

```bash
docker-compose up --build
```

Then open [http://localhost:5173](http://localhost:5173)

### 3a. Run locally (without Docker)

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## First-time flow

1. Set `GARMIN_EMAIL` and `GARMIN_PASSWORD` in `backend/.env`
2. Open the app → click **Connect Garmin Account** (validates credentials, creates your athlete profile)
3. Go to **Settings**:
   - Set your FTP (watts) and LTHR (bpm)
   - Click **Sync last 6 months** to build a proper CTL history
4. Go to **Routes** and upload your GPX files
5. Go to **Plan** and click **Generate Plan**

## Key features

### Season detection
The app automatically infers whether you're in ski season or cycling/running season based on your recent activity mix and calendar month. No manual switching.

### Polarized training
Plans follow ~80% easy / 5% moderate / 15% hard intensity distribution. All hard sessions are purposeful and tied to VO2max development.

### Terrain-aware intervals
When a cycling interval session is planned, the app scans your route library and suggests the climb that best matches the workout's target duration and intensity. If no route fits, it suggests trainer alternatives.

### Fun activity handling
Hiking, climbing, and similar casual activities are tracked for fatigue but never treated as training. The day of and day after a casual activity, hard training sessions are automatically downgraded to easy.

### Cross-sport aerobic transfer
Fitness calculations account for aerobic carryover between sports:
- XC skiing ↔ running: ~85% transfer
- Running/skiing ↔ cycling: ~60-65% transfer

### AI coaching (optional)
With an Anthropic API key set, the app uses Claude Haiku to:
- Write a 2-3 sentence weekly coaching narrative
- Score outdoor workout compliance based on physiological intent (not just raw numbers)
- Suggest workout adaptations when no matching terrain is available

Estimated cost: < $0.05/week of normal use.

## API

The backend runs at `http://localhost:8000`. Interactive docs at `/docs`.

Key endpoints:
- `GET /auth/login` — start Garmin OAuth
- `POST /activities/sync?athlete_id=1` — pull from Garmin
- `GET /athlete/1/fitness` — CTL/ATL/TSB + season + VO2max trends
- `POST /plan/generate?athlete_id=1` — generate weekly plan
- `POST /routes/upload` — upload GPX route
- `POST /garmin/webhook` — Garmin push notifications
