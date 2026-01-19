# Parliament Analytics Dashboard

**Canadian Parliament member analytics with voting participation, activity metrics, and comparative analysis.**

---

## Quick Start

### Prerequisites
- Node.js 16+ and npm
- MongoDB running locally on `mongodb://localhost:27017`
- Network access to xBill API (`https://xbill.ca/api`)

### Installation

```bash
npm install
```

---

## Three-Step Workflow

### 1. Start Server (Run First)

Launch the Express API server and web UI:

```bash
npm start
```

**What it serves:**
- Web UI: http://localhost:3001
- APIs: `GET /api/metrics/members`, `GET /api/metrics/member/:personId`
- Compute endpoint: `POST /api/compute/session/:parliament/:session`

**Pages:**
- `/` — Member list table (sortable, filterable)
- `/member.html` — Individual member profile
- `/quadrant.html` — Scatter plot explorer

**Note:** Keep this terminal running. Open a new terminal for steps 2 and 3.

---

### 2. Run ETL (Extract, Transform, Load)

Fetch fresh data from xBill API and populate MongoDB:

```bash
npm run etl
```

**What it does:**
- Syncs members, votes, vote casts, bills, interventions, and committee interventions
- Filters to House members only (excludes Senate)
- Handles rate limiting with automatic backoff
# Parliament Analytics Dashboard

**Canadian Parliament member analytics with voting participation, activity metrics, and comparative analysis.**

---

## Data Source

This project uses data from **[xBill - Parliamentary Tracker](https://xbill.ca/)**, which scrapes data from the House of Commons website every few hours. xBill provides comprehensive parliamentary data including bills, votes, debates, member profiles, and more.

- **Website**: https://xbill.ca/
- **API Documentation**: https://xbill.ca/api-docs
- **Data Coverage**: Bills, votes, vote casts, member profiles, interventions (debates), committee work

---

## What This Project Does

The Parliament Analytics Dashboard performs three main functions:

1. **Data Extraction (ETL)**: One-time pull of select xBill API data into MongoDB
	 - Members (profiles, election history, roles, committees)
	 - Votes and individual member vote casts
	 - Parliamentary interventions (floor debates)
	 - Committee interventions
	 - Bills introduced

2. **Metric Computation**: Generate derived analytics metrics stored in MongoDB
	 - Voting participation rates
	 - Activity index scores (composite engagement metric)
	 - Rankings and percentiles (overall and within-party)
	 - Comparative statistics by party and province

3. **Web Presentation**: Serve data via REST APIs and interactive HTML/JavaScript visualizations
	 - Sortable, filterable member table
	 - Individual member profiles with detailed metrics
	 - Scatter plot explorer for comparative analysis

**See**: `METRICS_DOCUMENTATION.md` for complete methodology and metric definitions

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Application Server** | Node.js + Express |
| **Data Storage** | MongoDB |
| **Data Source** | xBill REST API |
| **Frontend** | HTML5, JavaScript, Chart.js |
| **Visualization** | Chart.js with zoom/pan plugins |

---

## Prerequisites

- **Node.js** 16+ and npm
- **MongoDB** running locally on `mongodb://localhost:27017`
- **Network access** to xBill API (`https://xbill.ca/api`)

---

## Installation

```bash
npm install
```

---

## Usage Workflow

### Step 1: Start Server (Keep Running)

Launch the Express API server and web UI:

```bash
npm start
```

**What it serves:**
- Web UI: http://localhost:3001
- REST APIs for member metrics
- Compute endpoint for analytics generation

**Note:** Keep this terminal running. Open a new terminal for steps 2 and 3.

---

### Step 2: Run ETL (One-Time or Periodic)

Fetch fresh data from xBill API and populate MongoDB:

```bash
npm run etl
```

**What it does:**
- Syncs members, votes, vote casts, bills, interventions, and committee interventions
- Filters to House members only (excludes Senate)
- Handles rate limiting with automatic backoff
- **Duration**: ~5-10 minutes

**Environment variables (optional):**
```bash
# Override parliament/session (default: 45/1)
PARLIAMENT=45 SESSION=1 npm run etl
```

---

### Step 3: Compute Member Stats

Process raw MongoDB data into analytics metrics:

```bash
npm run compute
```

**What it does:**
- Calculates tenure, activity metrics, and rankings
- Generates activity index scores (0-10 scale)
- Computes percentiles (overall + within-party)
- Stores results in `member_stats` collection
- **Duration**: ~5 seconds

**Requires:** Server must be running from step 1

**Environment variables (optional):**
```bash
PARLIAMENT=45 SESSION=1 SERVER_URL=http://localhost:3001 npm run compute
```

---

## Complete Setup Example

```bash
# First time setup
npm install

# Terminal 1: Start the server (keep running)
npm start

# Terminal 2: Run ETL to fetch data (in a new terminal)
npm run etl

# Terminal 2: After ETL completes, compute stats
npm run compute

# Browse to http://localhost:3001
```

---

## Web Pages

The dashboard includes two main pages:

### 1. Member List Table (`/`)

**URL**: http://localhost:3001

**Features**:
- Sortable columns (click header to sort by any metric)
- Filter by party and province
- Shows all 343 House members
- Displays: Name, Party, Province, Presence %, Activity Index, Tenure, Interventions, Committee Work, Bills, Committees, Associations
- Click any row to view detailed member profile (modal popup)

---

### 2. Scatter Plot Explorer (`/scatter.html`)

**URL**: http://localhost:3001/scatter.html

**Features**:
- Seven scatter plots comparing tenure against key metrics
- Interactive zoom and pan
- Hover on data points to see member details
- Click data points to open detailed profile modal
- Color-coded by political party

**Available Charts**:
1. **Tenure vs Activity Index** — Composite engagement score
2. **Tenure vs Presence Rate** — Vote participation percentage
3. **Tenure vs Interventions (Total)** — Floor debates and speeches
4. **Tenure vs Committee Interventions (Total)** — Committee work
5. **Tenure vs Bills Sponsored** — Legislative initiative
6. **Tenure vs Committees** — Number of committees serving on
7. **Tenure vs Associations** — Parliamentary association memberships

---

## Activity Index Methodology

The **Activity Index** is a composite metric (0–10 scale) measuring parliamentary engagement across five dimensions:

| Component | Weight | Description |
|-----------|--------|-------------|
| **Interventions** | 33% | Floor debates and speeches (total count) |
| **Committee Work** | 27% | Committee interventions (total count) |
| **Bills Sponsored** | 20% | Bills sponsored in current session |
| **Committees** | 13% | Number of committees currently serving on |
| **Associations** | 7% | Parliamentary associations/groups |

**Calculation**: Each component is normalized against the cohort average, capped at its weight, then summed and scaled to 0–10.

**Example**:
```
Member with 84 interventions (avg: 18.3)
→ 84 / 18.3 = 4.59 × 0.33 = capped at 0.33
(Repeat for other components, sum, multiply by 10)
→ Final score: 8.5/10
```

**Design Rationale**:
- Uses **total counts** (not per-month) to recognize sustained output
- Relative scoring contextualizes performance against peers
- Removed presence rate from formula (voting attendance alone doesn't reflect legislative initiative)

**See**: `METRICS_DOCUMENTATION.md` for complete methodology, design decisions, and all metric definitions

---

## Project Structure

```
parliament-dashboard/
├── README.md                   # This file
├── METRICS_DOCUMENTATION.md    # Complete metric methodology
├── package.json                # Dependencies and npm scripts
├── .gitignore                  # Excludes archive/, logs, node_modules
├── etl-server.js               # ETL: sync data from xBill API
├── compute-stats.js            # Trigger member stats computation
├── server.js                   # Express server + APIs + static files
├── public/
│   └── html/
│       ├── index.html          # Member list table
│       ├── member.html         # Member profile (unused standalone)
│       └── scatter.html        # Scatter plot explorer
└── archive/                    # Documentation, legacy scripts (gitignored)
		└── docs/
				├── ACTIVITY_INDEX_METHODOLOGY.md
				├── DEVELOPMENT_ROADMAP.md
				└── MEMBER_STATS_SCHEMA.md
```

---

## API Reference

### GET /api/metrics/members

List all members with computed metrics.

**Query params:**
- `parliament` (default: 45)
- `session` (default: 1)
- `party` (optional filter)
- `province` (optional filter)
- `sort` (optional: activity_index_score, presence_rate, etc.)
- `limit` (default: 500)

**Example:**
```bash
curl "http://localhost:3001/api/metrics/members?parliament=45&session=1&limit=10&sort=activity_index_score"
```

**Response:**
```json
{
	"parliament": "45",
	"session": "1",
	"count": 10,
	"members": [
		{
			"person_id": "3306",
			"name": "Dan Mazier",
			"party": "Conservative",
			"presence_rate": "100.0",
			"activity_index_score": "10.00",
			"interventions_count": 84
		}
		// ... 9 more
	]
}
```

---

### GET /api/metrics/member/:personId

Get detailed profile for a single member.

**Query params:**
- `parliament` (default: 45)
- `session` (default: 1)

**Example:**
```bash
curl "http://localhost:3001/api/metrics/member/3306?parliament=45&session=1"
```

**Response**: Full member stats document with party/province comparisons

---

### POST /api/compute/session/:parliament/:session

Trigger member stats computation (called by `npm run compute`).

**Example:**
```bash
curl -X POST "http://localhost:3001/api/compute/session/45/1"
```

**Response:**
```json
{
	"parliament": "45",
	"session": "1",
	"votes_processed": 59,
	"member_vote_records": 24861,
	"member_stats_upserts": 343,
	"vote_stats_upserts": 59
}
```

---

## Configuration

### MongoDB Connection

Default: `mongodb://localhost:27017/xbill`

Override via environment:
```bash
MONGO_URL=mongodb://localhost:27017 DB_NAME=xbill npm run etl
```

### Parliament/Session

Default: Parliament 45, Session 1

Override:
```bash
PARLIAMENT=44 SESSION=2 npm run etl
PARLIAMENT=44 SESSION=2 npm run compute
```

---

## Troubleshooting

### Port 3001 already in use

**Error:** `EADDRINUSE: address already in use :::3001`

**Fix:** Stop any existing node processes:
```bash
# Windows PowerShell
Get-Process -Name node | Stop-Process -Force

# Linux/Mac
pkill node
```

Then run `npm start` again.

---

### ETL fails with 429 errors

**Expected:** Some rate limiting is normal; ETL handles it with backoff.

**If persistent:** Wait a few minutes and re-run `npm run etl`. Incremental cursors will resume where it left off.

---

### Compute returns connection error

**Error:** `request to http://localhost:3001/api/compute/session/45/1 failed`

**Fix:** Make sure server is running with `npm start` in a separate terminal before running `npm run compute`.

---

### Compute returns 500 error

**Likely cause:** No data in MongoDB yet.

**Fix:** Run `npm run etl` first to populate data.

---

### Member stats show old data

**Fix:** Re-run `npm run compute` to refresh analytics from current MongoDB data.

---

## Development

### Run server with auto-reload

```bash
npm run dev
```

Uses nodemon to restart server on file changes.

---

## Data Coverage

**Source**: xBill API (https://xbill.ca/api)  
**Parliament**: 45th Parliament of Canada  
**Session**: 1st Session  
**Members**: 343 House members (Senate excluded from analytics)  
**Votes**: 59 divisions  
**Vote Casts**: 24,861 individual MP votes  
**Interventions**: ~25,148 floor debates  
**Committee Interventions**: ~5,630 committee meeting records  
**Bills**: 125 bills introduced in session  

---

## License

ISC

---

## Contributing

Issues and pull requests welcome on GitHub.

---

## Documentation

- **METRICS_DOCUMENTATION.md** — Complete metric definitions, calculation methodologies, and API usage
- **archive/docs/ACTIVITY_INDEX_METHODOLOGY.md** — Detailed activity index formula evolution and design rationale
- **archive/docs/DEVELOPMENT_ROADMAP.md** — Project phases, architecture, and implementation notes
