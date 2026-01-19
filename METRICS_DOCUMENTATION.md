# Metrics Documentation

This document describes all computed metrics for parliamentary members, including data sources, calculation methodologies, and interpretation guidance.

---

## Overview

The Parliament Analytics Dashboard computes derived metrics from raw xBill API data to enable comparative analysis of House of Commons members. All metrics are stored in MongoDB's `member_stats` collection and served via REST APIs.

**Computation trigger**: `POST /api/compute/session/:parliament/:session`  
**Storage**: MongoDB `member_stats` collection (343 House members for Parliament 45, Session 1)  
**Access**: `GET /api/metrics/members` and `GET /api/metrics/member/:personId`

---

## Data Sources

### Raw Collections (from xBill API)

| Collection | Source Endpoint | Records (P45/S1) | Description |
|------------|----------------|------------------|-------------|
| `members` | `/api/members` + `/api/members/:id` | 421 (343 House) | Member profiles with election history, roles, committees |
| `votes` | `/api/votes` | 59 | Vote metadata (divisions) |
| `vote_casts` | `/api/votes/:p/:s/:d/cast` | 24,861 | Individual member votes (Yea/Nay/Paired/Absent) |
| `interventions` | `/api/members/:id/interventions` | ~25,148 | Floor debates and speeches |
| `committee_interventions` | `/api/committee-interventions/member/:id` | ~5,630 | Committee meeting interventions |
| `bills` | `/api/bills` | 125 | Bills introduced in session |

### Derived Collections (computed)

| Collection | Purpose | Records |
|------------|---------|---------|
| `member_stats` | Comprehensive member metrics | 343 |
| `vote_stats` | Per-division participation stats | 59 |
| `member_vote_records` | Flattened vote records per member | 24,861 |
| `session_facts` | Session summary metadata | 1 |

---

## Metric Categories

### 1. Voting Participation

#### Presence Rate
**Formula**: `(present + paired) / total_votes × 100`

**Components**:
- `present`: Count of votes where member voted (Yea, Nay, or Abstain)
- `paired`: Count of votes where member was paired (excused absence)
- `total_votes`: Total divisions in session (59 for P45/S1)

**Source**: `vote_casts` collection aggregated by `person_id`

**Range**: 0–100%  
**Typical**: 95–100% (most MPs maintain high presence)

**Ranks computed**:
- `presence_rank`: Overall rank (1–343)
- `presence_percentile`: Percentile (0–100)
- `presence_percentile_in_party`: Percentile within caucus

---

### 2. Tenure & Background

#### Tenure (Months)
**Formula**: `floor((now - earliest_election_date) / (30.44 days))`

**Source**: `members.election_history` array  
**Method**: Find earliest election where `election_result_type` includes "elected" or "acclaimed"; calculate months from that date to present.

**Fallback**: If no election history, uses `members.from_datetime` (for appointed Senate members; excluded from House analytics)

**Example**:
- MP first elected June 28, 2004 → tenure ~258 months (21.5 years)
- Includes entire parliamentary career across multiple parliaments

#### Years in House
**Formula**: `floor(tenure_months / 12)`

#### Elections Won
**Formula**: Count of elections in `election_history` where `election_result_type` includes "elected" or "acclaimed" (excludes "Defeated")

**Source**: `members.election_history`

---

### 3. Parliamentary Activity

#### Interventions (Total)
**Formula**: Count of records in `interventions` collection for this member

**Source**: `interventions` collection filtered by `person_id`, `parliament`, `session`

**What counts**: Floor speeches, debates, questions during House proceedings

**Note**: Uses **total count** (not normalized per-month) to recognize sustained output over career

#### Interventions Per Month
**Formula**: `interventions_count / max(tenure_months, 1)`

**Purpose**: Tenure-adjusted rate for comparing members with different career lengths

#### Committee Interventions (Total)
**Formula**: Count of records in `committee_interventions` collection for this member

**Source**: `committee_interventions` collection filtered by `person_id`, `parliament`, `session`

**What counts**: Questions, speeches, motions during committee meetings

#### Committee Per Month
**Formula**: `committee_interventions_count / max(tenure_months, 1)`

#### Bills Sponsored (Current Session)
**Formula**: Direct count from xBill API member profile

**Source**: `members.bills_sponsored_current` or `members.bills_sponsored`

**Note**: Only bills in current session (Parliament 45, Session 1)

#### Committees (Current)
**Formula**: Count of unique `committee_name` values in `members.committees` array

**Source**: `members.committees`

**What counts**: Standing committees, special committees, joint committees currently serving on

#### Associations (Current)
**Formula**: Count of unique `organization` values in `members.associations` array

**Source**: `members.associations`

**What counts**: Parliamentary friendship groups, caucuses, interparliamentary associations

---

### 4. Activity Index (Composite Score)

**Scale**: 0–10  
**Purpose**: Holistic measure of parliamentary engagement combining multiple dimensions

#### Components & Weights

| Component | Weight | Metric Used | Rationale |
|-----------|--------|-------------|-----------|
| Interventions | 33% | `interventions_count` (total) | Primary legislative voice |
| Committee Work | 27% | `committee_interventions_count` (total) | Policy detail work |
| Bills Sponsored | 20% | `bills_sponsored_current` | Legislative initiative |
| Committees | 13% | `committees_count` | Breadth of assignments |
| Associations | 7% | `associations_count` | Cross-party engagement |

#### Calculation Method

For each component, the member's value is divided by the **cohort average**, then capped at the component's weight:

```javascript
// Example: Interventions component (33% weight)
const avgInterventions = 18.3; // Average across all 343 MPs
const memberInterventions = 84; // This member's count

const interventionComponent = Math.min(
  (memberInterventions / avgInterventions) * 0.33,
  0.33 // Cap at weight
);

// Sum all components, multiply by 10 to get 0-10 scale
const activityIndexScore = (
  interventionComponent +
  committeeWorkComponent +
  billComponent +
  committeesComponent +
  associationsComponent
) * 10;
```

#### Typical Distribution (P45/S1)
- **8–10**: Very active (20% of MPs)
- **6–8**: Moderately active (50% of MPs)
- **4–6**: Lower activity (25% of MPs)
- **0–4**: Minimal engagement (5% of MPs)

**Range observed**: 4.03–10.0 (avg 8.26)

#### Design Rationale

**Why total counts, not per-month rates?**
- Recognizes sustained output over career
- Avoids penalizing long-serving members unfairly
- Rewards cumulative legislative contributions

**Why relative scoring?**
- Contextualizes performance against peers
- Prevents outliers from dominating
- Self-adjusts as member behavior evolves

**Why was Presence Rate removed?**
- Voting attendance alone doesn't reflect legislative initiative
- Some leaders have low presence due to roles (cabinet, whips) but high influence
- Focus shifted to proactive contributions (debates, bills, committees)

**See**: `archive/docs/ACTIVITY_INDEX_METHODOLOGY.md` for detailed methodology evolution and design decisions

---

### 5. Rankings & Percentiles

For each core metric, three ranking values are computed:

#### Overall Rank
**Formula**: Position in sorted list (1 = highest value)  
**Example**: `presence_rank = 15` → 15th highest presence rate among 343 MPs

#### Overall Percentile
**Formula**: `round((total_members - rank) / total_members × 100)`  
**Example**: Rank 15 of 343 → `(343 - 15) / 343 × 100 = 95.6th percentile`

**Interpretation**: "Better than X% of peers"

#### Within-Party Percentile
**Formula**: Same as overall, but filtered to members of same `caucus_short_name`  
**Example**: Conservative MP rank 5 of 119 Conservatives → `(119 - 5) / 119 × 100 = 95.8th percentile in party`

**Purpose**: Compare member to caucus peers, not just all MPs

#### Metrics with Ranks

All of these have `_rank`, `_percentile`, and `_percentile_in_party` computed:
- `presence_rate`
- `activity_index_score`
- `tenure_months`
- `interventions_count`
- `committee_interventions_count`
- `bills_sponsored_current`

---

## Member Stats Schema

Complete schema for documents in `member_stats` collection:

```javascript
{
  // Identity
  parliament: "45",
  session: "1",
  person_id: "3306", // String
  name: "Dan Mazier",
  party: "Conservative",
  caucus_short_name: "Conservative",
  province: "Manitoba",
  constituency: "Riding Mountain",
  chamber: "house",
  
  // Voting Participation
  present: 59,
  paired: 0,
  absent: 0,
  total_votes: 59,
  presence_rate: 100.0,
  presence_rank: 1,
  presence_percentile: 100,
  presence_percentile_in_party: 100,
  
  // Tenure & Background
  tenure_months: 74,
  years_in_house: 6,
  elections_won: 2,
  committees_count: 2,
  associations_count: 13,
  
  // Parliamentary Activity (Total Counts)
  interventions_count: 84,
  interventions_per_month: 1.14,
  committee_interventions_count: 397,
  committee_per_month: 5.36,
  bills_sponsored_current: 2,
  
  // Activity Index (Composite)
  activity_index_score: 10.00,
  activity_index_rank: 1,
  activity_index_percentile: 100,
  activity_index_percentile_in_party: 100,
  
  // Rankings for other metrics (same pattern)
  tenure_months_rank: 150,
  tenure_months_percentile: 56,
  // ... (all metrics get rank/percentile)
  
  // Metadata
  metrics_version: "v2",
  computed_at: ISODate("2026-01-19T...")
}
```

---

## Computation Pipeline

**Endpoint**: `POST /api/compute/session/:parliament/:session`

**Steps**:
1. Load all raw data (members, votes, vote_casts, interventions, committee_interventions)
2. Calculate tenure from `election_history` (earliest elected date)
3. Aggregate vote participation per member (present/paired/absent counts)
4. Count interventions and committee interventions per member
5. Load bills, committees, associations from member profiles
6. Compute activity index using weighted formula
7. Sort and compute ranks/percentiles (overall and within-party) for all metrics
8. Upsert 343 `member_stats` documents to MongoDB
9. Create `session_facts` summary document

**Duration**: ~5 seconds  
**Output**: 343 member_stats documents updated

---

## API Usage Examples

### Get All Members with Metrics
```bash
curl "http://localhost:3001/api/metrics/members?parliament=45&session=1&limit=10&sort=activity_index_score"
```

**Response**:
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
      "interventions_count": 84,
      "committee_interventions_count": 397
    }
    // ... 9 more
  ]
}
```

### Get Single Member Profile
```bash
curl "http://localhost:3001/api/metrics/member/3306?parliament=45&session=1"
```

**Response**: Full member stats document plus party/province comparisons

---

## Data Quality & Limitations

### Completeness
- ✅ All 343 House members have complete metrics (no nulls in v2 schema)
- ✅ Vote participation: 59 divisions with 24,861 cast records
- ✅ Interventions: ~25,148 records (complete pagination from xBill)
- ✅ Committee interventions: ~5,630 records (complete pagination)

### Known Limitations
1. **Time window**: Metrics reflect only current parliament/session, not full career
2. **Quality not captured**: Quantity of work measured, not legislative impact or quality
3. **Role differences**: Leaders (whips, cabinet) may have suppressed metrics but high influence
4. **Data lag**: xBill scrapes OurCommons "every few hours"; not real-time
5. **Session variation**: Comparing across sessions requires normalizing for session length

### Future Enhancements
- Bill passage success rate (introduced vs. passed)
- Committee role weighting (chair/vice-chair bonus)
- Leadership/cabinet role adjustments
- Sentiment analysis of interventions
- Vote similarity clustering (faction detection)

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| v1 | Jan 2026 | Initial metrics: presence + basic counts |
| v2 | Jan 2026 | Activity index introduced; removed presence from composite; switched to total counts |

---

## References

- **xBill API Documentation**: https://xbill.ca/api-docs
- **Activity Index Methodology**: `archive/docs/ACTIVITY_INDEX_METHODOLOGY.md`
- **Development Roadmap**: `archive/docs/DEVELOPMENT_ROADMAP.md`
