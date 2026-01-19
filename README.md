# Parliament Analytics Dashboard

**Canadian Parliament member analytics with voting participation, activity metrics, and comparative analysis.**

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
3. **Tenure vs House Intervention Counts (Total)** — Floor debates and speeches
4. **Tenure vs Committee Intervention Counts (Total)** — Committee interventions
5. **Tenure vs Bills Sponsored** — Legislative initiative
6. **Tenure vs Committees** — Number of committees serving on
7. **Tenure vs Associations** — Parliamentary association memberships

---

**See**: `METRICS_DOCUMENTATION.md` for complete methodology, design decisions, and all metric definitions

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
