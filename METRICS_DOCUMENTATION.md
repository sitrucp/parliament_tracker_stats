# Parliament Tracker Stats - Metrics Documentation

## Overview

This document describes all metrics computed and stored in the `member_stats` collection for each member of Parliament. Metrics are calculated per parliament/session and include individual counts, ranks, and percentiles (both overall and within-party).

---

## Composite Metrics

### Activity Index Score (0-10 scale)

**Field:** `activity_index_score`

A weighted composite metric combining multiple dimensions of parliamentary engagement:

- **Position Leadership (25%)** - Leadership score from elected/appointed roles (Speaker, Deputy Speaker, Committee Chairs, etc.)
- **Interventions (25%)** - Debate interventions in the House of Commons
- **Committee Work (20%)** - Contributions during committee meetings
- **Bills Sponsored (15%)** - Current bills sponsored/co-sponsored by the member
- **Committee Memberships (10%)** - Number of distinct committees the member is part of
- **Associations (5%)** - Organizational and caucus associations

**Formula:**
```
activity_index_score = (
  (position_leadership_score / avg_position_score) × 0.25 +
  (interventions_count / avg_interventions) × 0.25 +
  (committee_interventions_count / avg_committee_interventions) × 0.20 +
  (bills_sponsored_current / avg_bills) × 0.15 +
  (committees_count / avg_committees) × 0.10 +
  (associations_count / avg_associations) × 0.05
) × 10
```

Each component is capped at its weight to prevent over-representation.

**Related fields:**
- `activity_index_score_rank` - Overall rank (1 = highest activity)
- `activity_index_score_percentile` - Overall percentile ranking
- `activity_index_score_percentile_in_party` - Percentile within member's party caucus

---

## Position & Leadership

### Position Leadership Score

**Field:** `position_leadership_score`

Quantifies leadership roles held during the session. Based on a normalized ranking system:
- **Speaker** = 10.0
- **Deputy Speaker** = 9.0
- **Committee Chairs** = 8.0
- **Committee Vice-Chairs** = 6.0
- **Parliamentary Secretary** = 5.0
- **Other nominated positions** = 2.0 - 4.0 (varies by role)

Score represents the **most senior role** held during the session. Members may hold multiple roles; we capture the highest-weighted one.

**Related fields:**
- `position_leadership_score_rank` - Overall rank
- `position_leadership_score_percentile` - Overall percentile
- `position_leadership_score_percentile_in_party` - In-party percentile

---

## Voting & Attendance

### Presence Rate (%)

**Field:** `presence_rate`

Percentage of votes cast out of total votes held in the House during the member's service period.

```
presence_rate = (present + paired) / total_votes × 100
```

**Related fields:**
- `present` - Number of "Yes" votes cast
- `paired` - Number of paired votes (member absent but paired with opposition)
- `absent` - Number of votes recorded as absent
- `total_votes` - Total votes held during member's service
- `presence_rate_rank` - Overall rank
- `presence_rate_percentile` - Overall percentile
- `presence_rate_percentile_in_party` - In-party percentile

---

## Parliamentary Activity

### Interventions Count

**Field:** `interventions_count`

Total number of debate interventions (speeches/comments) made by the member in the House of Commons during the session.

**Related fields:**
- `interventions_per_month` - Normalized: `interventions_count / tenure_months`
- `interventions_count_rank` - Overall rank
- `interventions_count_percentile` - Overall percentile
- `interventions_count_percentile_in_party` - In-party percentile

### Committee Interventions Count

**Field:** `committee_interventions_count`

Total number of interventions made during committee meetings.

**Related fields:**
- `committee_per_month` - Normalized: `committee_interventions_count / tenure_months`
- `committee_interventions_count_rank` - Overall rank
- `committee_interventions_count_percentile` - Overall percentile
- `committee_interventions_count_percentile_in_party` - In-party percentile

### Bills Sponsored (Current)

**Field:** `bills_sponsored_current`

Number of bills currently sponsored or co-sponsored by the member. Updated as new bills are introduced.

**Related fields:**
- `bills_sponsored_current_rank` - Overall rank
- `bills_sponsored_current_percentile` - Overall percentile
- `bills_sponsored_current_percentile_in_party` - In-party percentile

---

## Engagement & Roles

### Committee Memberships

**Field:** `committees_count`

Count of distinct committees the member serves on during the session.

**Related fields:**
- `committees_count_rank` - Overall rank
- `committees_count_percentile` - Overall percentile
- `committees_count_percentile_in_party` - In-party percentile

### Associations

**Field:** `associations_count`

Count of organizational and caucus associations the member belongs to (e.g., policy groups, sectoral caucuses, international committees).

**Related fields:**
- `associations_count_rank` - Overall rank
- `associations_count_percentile` - Overall percentile
- `associations_count_percentile_in_party` - In-party percentile

---

## Tenure & Background

### Tenure Months

**Field:** `tenure_months`

Total months of service, accounting for multiple service periods (if member was defeated and re-elected).

**Calculation:** Sum of all service periods where member was elected/acclaimed, from election date to present or defeat date.

**Related fields:**
- `years_in_house` - Derived from tenure: `floor(tenure_months / 12)`
- `elections_won` - Count of successful election/acclamation results
- `tenure_months_rank` - Overall rank
- `tenure_months_percentile` - Overall percentile
- `tenure_months_percentile_in_party` - In-party percentile

---

## Member Information

### Basic Fields

- `parliament` - Parliament number (e.g., "45")
- `session` - Session number (e.g., "1")
- `person_id` - Unique identifier for the member
- `name` - Member's full name
- `party` - Party affiliation (Liberal, Conservative, etc.)
- `caucus_short_name` - Caucus identifier (may differ from party for Independents)
- `province` - Province/territory of constituency
- `constituency` - Electoral riding/district name
- `chamber` - "house" or "senate"
- `political_alignment_score` - (Optional) Computed voting alignment score

---

## Ranking & Percentile System

Each metric has three ranking fields:

1. **`{metric}_rank`** - Overall rank across all members (1 = highest value)
2. **`{metric}_percentile`** - Overall percentile (0-100, higher = more activity)
3. **`{metric}_percentile_in_party`** - Percentile within member's party caucus

### Percentile Calculation

```
percentile = round(((total_members - rank) / total_members) × 100)
```

This means:
- Percentile 100 = highest in cohort
- Percentile 1 = lowest in cohort
- Percentile 50 = median

---

## Data Collection & Computation

### Source Data
- Member demographics & election history from **xBill API** (https://xbill.ca/api)
- Vote records from **House of Commons** proceedings
- Committee memberships and roles from **Parliamentary records**
- Leadership role rankings from **title_role_ranking** collection

### Computation Pipeline
1. **Load members** - Fetch all members for parliament/session
2. **Calculate tenure** - Sum service periods from election history
3. **Count engagements** - Aggregate committees, associations, bills, interventions
4. **Calculate Position Leadership** - Map roles to normalized scores
5. **Calculate Activity Index** - Apply weighted formula combining all dimensions
6. **Rank metrics** - Sort all members by each metric, compute ranks/percentiles
7. **Store results** - Save to `member_stats` collection

### API Endpoint
```
POST /api/compute/session/:parliament/:session
```

Triggers full analytics computation for specified parliament/session.

---

## Notes

- **Senate members:** Included in counts but separated from House voting analysis (Senate votes tracked separately)
- **Percentiles:** Recalculated per parliament/session; not comparable across sessions
- **Null values:** Represented as `0` for counts; percentiles show `-` if computation blocked
- **Rank ties:** Members with identical metric values receive same rank; next rank skips
- **Per-month normalization:** Used to compare engagement independent of tenure length
