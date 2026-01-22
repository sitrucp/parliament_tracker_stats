# Position & Role Ranking System Design

## Executive Summary

This document outlines the design and implementation strategy for a new metric to capture leadership roles, ministerial positions, and committee responsibilities as part of the Activity Index composite score.

**Objective**: Quantify member influence and responsibility based on positions held (e.g., Prime Minister, Minister, Speaker, Party Leader, Committee Chair) to recognize leadership contributions beyond floor speeches and votes.

**Current Gap**: Members with identical activity levels but vastly different responsibilities (e.g., a Minister vs. a backbench MP) receive the same Activity Index score. This metric addresses that gap.

---

## Data Analysis Summary

Based on [positions-committee-roles.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\reports\positions-committee-roles.md):

**Members**: 421 total  
**Members with positions**: 106 (25%)  
**Position titles identified**: 114 unique values  
**Committee roles identified**: 4 (Chair, Co-Chair, Vice-Chair, Member)

### Position Categories

1. **Executive Government Roles** (Highest influence)
   - Prime Minister
   - Ministers (25+ portfolios)
   - Associate Ministers
   - Secretaries of State (11 roles)
   - President of Treasury Board / King's Privy Council

2. **Legislative Leadership** (High influence)
   - Speaker
   - Deputy Speaker / Assistant Deputy Speaker
   - Board of Internal Economy (Chair/Member)

3. **Party Leadership** (High political influence)
   - Party Leaders (e.g., Leader of Opposition, Leader of Bloc Québécois, Leader of Conservative Party)
   - House Leaders (Government/Opposition/Party)
   - Whips (Chief/Deputy)

4. **Parliamentary Support Roles** (Medium influence)
   - Parliamentary Secretaries (~30 different assignments)

5. **Committee Roles** (Variable influence)
   - Committee Chair
   - Committee Vice-Chair
   - Committee Member (baseline)

6. **General Members** (No special roles)
   - "Member", "Member of the" (315/421 = 75% of MPs)

---

## Proposed Ranking System

### Ranking Tiers

| Tier | Rank Value | Role Type | Examples |
|------|-----------|-----------|----------|
| **S** | 100 | Prime Minister | Prime Minister |
| **A+** | 90 | National Legislative Leadership | Speaker, Leader of the Opposition |
| **A** | 80 | Senior Ministers & Party Leaders | Minister of Finance, Minister of Foreign Affairs, Leader of Bloc Québécois |
| **A-** | 70 | Ministers & Deputy Legislative Leadership | Most Ministers, Deputy Speaker, President of Treasury Board |
| **B+** | 60 | Junior Ministers & Chief Whips | Secretaries of State, Chief Government Whip |
| **B** | 50 | House Leaders & Senior Committee | House Leader (Party), Board of Internal Economy Chair |
| **B-** | 40 | Parliamentary Secretaries & Deputy Whips | Parliamentary Secretary to PM, Deputy Whip |
| **C** | 30 | Committee Chairs | Committee Chair |
| **D** | 20 | Committee Vice-Chairs | Committee Vice-Chair |
| **E** | 10 | Party Roles & Co-Chairs | Caucus Chair, Committee Co-Chair |
| **F** | 0 | Regular Members | Member, Committee Member |

### Rationale

**Why these tiers?**
- **S-Tier**: Prime Minister has unique constitutional authority and workload
- **A+**: Speaker is impartial leader of Parliament; Leader of Opposition is de facto alternative PM
- **A**: Senior portfolios (Finance, Foreign Affairs, Defence) have national/international scope
- **A-**: Ministers have Order-in-Council authority, cabinet responsibilities, and department oversight
- **B+**: Secretaries of State support ministers but lack independent authority; whips manage party discipline
- **B**: House Leaders coordinate legislative agenda; Board of Internal Economy governs Parliament operations
- **B-**: Parliamentary Secretaries support ministers without executive power; deputy whips assist chief whips
- **C**: Committee Chairs set agendas and manage debates in specialized policy areas
- **D**: Vice-Chairs support chairs and substitute when needed
- **E**: Party caucus positions and committee co-chairs have limited institutional power
- **F**: Baseline for all MPs; committee membership is standard expectation

---

## Implementation Strategy

### Phase 1: Create Position/Role Reference Collection

#### New MongoDB Collection: `position_role_rankings`

**Schema**:
```javascript
{
  _id: ObjectId,
  title: String,              // Exact title as appears in members.positions.title or members.committees.role_name
  normalized_title: String,   // Lowercase, trimmed version for matching
  category: String,           // "executive", "legislative", "party", "parliamentary_secretary", "committee"
  rank_value: Number,         // 0-100
  rank_tier: String,          // "S", "A+", "A", "A-", "B+", "B", "B-", "C", "D", "E", "F"
  description: String,        // Human-readable description
  is_committee_role: Boolean, // true if from committees.role_name, false if from positions.title
  created_at: Date,
  updated_at: Date
}
```

**Example Documents**:
```javascript
[
  {
    title: "Prime Minister",
    normalized_title: "prime minister",
    category: "executive",
    rank_value: 100,
    rank_tier: "S",
    description: "Head of Government, leads Cabinet and sets national policy agenda",
    is_committee_role: false
  },
  {
    title: "Speaker",
    normalized_title: "speaker",
    category: "legislative",
    rank_value: 90,
    rank_tier: "A+",
    description: "Presiding officer of the House of Commons",
    is_committee_role: false
  },
  {
    title: "Minister of Finance and National Revenue",
    normalized_title: "minister of finance and national revenue",
    category: "executive",
    rank_value: 80,
    rank_tier: "A",
    description: "Manages federal budget and fiscal policy",
    is_committee_role: false
  },
  {
    title: "Chair",
    normalized_title: "chair",
    category: "committee",
    rank_value: 30,
    rank_tier: "C",
    description: "Committee Chair - leads committee proceedings and sets agenda",
    is_committee_role: true
  },
  {
    title: "Member",
    normalized_title: "member",
    category: "general",
    rank_value: 0,
    rank_tier: "F",
    description: "Member of Parliament or Committee Member",
    is_committee_role: false
  }
]
```

#### Seed Script: `scripts/seed-position-rankings.js`

Create a script to populate the collection with all 114 position titles + 4 committee roles, manually assigned to tiers.

**Steps**:
1. Parse [positions-committee-roles.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\reports\positions-committee-roles.md)
2. Create mapping of each title to rank_value
3. Insert into `position_role_rankings` collection
4. Handle edge cases (e.g., "Member of the" vs. "Member")

---

### Phase 2: Compute Position Score Metric

#### New Metric: `position_leadership_score`

**Formula**:
```
position_leadership_score = (Σ(rank_value × months_held) / tenure_months) × duration_weight + max_rank_held × peak_weight
```

**Components**:
1. **Average Weighted Rank** (70% weight): Career average of position ranks, weighted by duration
2. **Peak Rank** (30% weight): Highest rank ever held (recognizes that even brief ministerial service is significant)

**Example Calculation**:

Member with 120 months tenure:
- Prime Minister (rank 100) for 60 months
- Minister of Finance (rank 80) for 24 months  
- Committee Chair (rank 30) for 12 months
- Committee Member (rank 0) for 24 months

```javascript
// Weighted average component (70%)
const weightedSum = (100 × 60) + (80 × 24) + (30 × 12) + (0 × 24) = 8280
const avgWeightedRank = 8280 / 120 = 69.0
const avgComponent = 69.0 × 0.70 = 48.3

// Peak rank component (30%)
const peakComponent = 100 × 0.30 = 30.0

// Final score
const position_leadership_score = 48.3 + 30.0 = 78.3
```

**Interpretation**:
- **80-100**: Current or former PM, senior party leaders
- **60-80**: Current/former Ministers, Speaker
- **40-60**: Parliamentary Secretaries, Committee Chairs, senior party roles
- **20-40**: Committee Vice-Chairs, party whips
- **0-20**: Limited leadership roles (mostly committee member)
- **0**: Never held any ranked position

#### Data Requirements

**Source**: `members.positions` and `members.committees` arrays

**Position Schema** (from xBill API):
```javascript
positions: [{
  title: String,              // e.g., "Minister of Finance and National Revenue"
  from_datetime: ISODate,
  to_datetime: ISODate | null // null = current
}]
```

**Committee Schema**:
```javascript
committees: [{
  committee_name: String,
  role_name: String,          // "Chair", "Vice-Chair", "Member"
  from_datetime: ISODate,
  to_datetime: ISODate | null
}]
```

**Calculation Steps**:
1. For each member, iterate through `positions` and `committees`
2. Match `title` or `role_name` against `position_role_rankings` collection
3. Calculate months held for each position (from `from_datetime` to `to_datetime` or present)
4. Compute weighted average and peak rank
5. Store in `member_stats` as `position_leadership_score`

---

### Phase 3: Integrate into Activity Index

#### Updated Activity Index Weights

**Current Weights** (5 components, sum to 100%):
- Interventions: 33.33%
- Committee Work: 26.67%
- Bills Sponsored: 20.00%
- Committees Count: 13.33%
- Associations: 6.67%

**Proposed Weights** (6 components, sum to 100%):
- **Position Leadership**: **25.00%** (NEW)
- Interventions: 25.00% (reduced from 33.33%)
- Committee Work: 20.00% (reduced from 26.67%)
- Bills Sponsored: 15.00% (reduced from 20.00%)
- Committees Count: 10.00% (reduced from 13.33%)
- Associations: 5.00% (reduced from 6.67%)

**Rationale**:
- Position leadership is the **strongest signal** of member influence and institutional responsibility
- Reduces weight on raw output metrics (interventions, committee work) to balance quantity with quality/authority
- Maintains bill sponsorship as important but de-emphasizes committee/association counts

#### New Activity Index Formula

```javascript
const avgPositionScore = baseMetrics.reduce((sum, m) => sum + m.position_leadership_score, 0) / baseMetrics.length || 1;

for (const m of baseMetrics) {
    const positionWeight = 0.25;
    const interventionWeight = 0.25;
    const committeeWorkWeight = 0.20;
    const billsWeight = 0.15;
    const committeesWeight = 0.10;
    const associationsWeight = 0.05;

    const positionComponent = Math.min((m.position_leadership_score / avgPositionScore) * positionWeight, positionWeight);
    const interventionComponent = Math.min((m.interventions_count / avgInterventions) * interventionWeight, interventionWeight);
    const committeeWorkComponent = Math.min((m.committee_interventions_count / avgCommitteeInterventions) * committeeWorkWeight, committeeWorkWeight);
    const billComponent = avgBills > 0 ? Math.min((m.bills_sponsored_current / avgBills) * billsWeight, billsWeight) : 0;
    const committeesComponent = avgCommittees > 0 ? Math.min((m.committees_count / avgCommittees) * committeesWeight, committeesWeight) : 0;
    const associationsComponent = avgAssociations > 0 ? Math.min((m.associations_count / avgAssociations) * associationsWeight, associationsWeight) : 0;
    
    m.activity_index_score = Number((
        (positionComponent + interventionComponent + committeeWorkComponent + 
         billComponent + committeesComponent + associationsComponent) * 10
    ).toFixed(2));
}
```

---

## Implementation Checklist

### Database Setup
- [ ] Create `position_role_rankings` collection
- [ ] Design seed data mapping all 114 positions + 4 committee roles to rank tiers
- [ ] Write `scripts/seed-position-rankings.js` to populate collection
- [ ] Add indexes: `normalized_title` (unique), `category`, `rank_value`

### Computation Logic
- [ ] Update `server.js` POST `/api/compute/session/:p/:s` endpoint
- [ ] Add function to calculate `position_leadership_score` for each member
- [ ] Join member positions/committees with `position_role_rankings` collection
- [ ] Calculate weighted average and peak rank
- [ ] Add `position_leadership_score` to `member_stats` schema
- [ ] Update Activity Index formula with new weights and position component

### Ranking & Percentiles
- [ ] Add `position_leadership_score` to `metricsToRank` array
- [ ] Compute `position_leadership_score_rank`, `_percentile`, `_percentile_in_party`

### API Updates
- [ ] Update `GET /api/members` response to include `position_leadership_score` and ranks
- [ ] Update `GET /api/member/:id` response
- [ ] Add sorting capability by `position_leadership_score`

### Documentation
- [ ] Update [METRICS_DOCUMENTATION.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\METRICS_DOCUMENTATION.md) with:
  - Position Leadership Score formula
  - Ranking tier definitions
  - Activity Index weight changes
  - Example calculations
- [ ] Update README.md with new metric
- [ ] Document position ranking assignments in separate reference file

### Testing
- [ ] Verify position matching logic (handle variations like "Member of the" vs "Member")
- [ ] Test edge cases: members with no positions, overlapping positions, null dates
- [ ] Validate Activity Index still ranges 0-10
- [ ] Compare before/after scores for sample members (e.g., PM, Minister, backbencher)

### Frontend
- [ ] Update dashboard to display `position_leadership_score`
- [ ] Add tooltip explaining the metric
- [ ] Update member detail pages to show position history with ranks
- [ ] Add filter/sort by position leadership score

---

## Edge Cases & Considerations

### Data Quality Issues

1. **Inconsistent Title Formatting**
   - Example: "caucus Chair" vs. "Caucus Chair"
   - **Solution**: Use `normalized_title` (lowercase, trimmed) for matching

2. **Overlapping Positions**
   - Some members hold multiple positions simultaneously (e.g., Minister + Board of Internal Economy Member)
   - **Solution**: Count all positions separately; use max rank for peak component

3. **Missing Dates**
   - Some positions may lack `to_datetime` (ongoing) or `from_datetime`
   - **Solution**: Assume ongoing if `to_datetime` is null; skip if `from_datetime` missing

4. **Generic Titles**
   - "Member of the" appears 114 times (likely truncated data)
   - **Solution**: Assign rank 0; investigate source data for full title

5. **Parliamentary Secretaries**
   - 30+ unique titles based on minister served
   - **Solution**: Use regex matching "Parliamentary Secretary to" → rank 40 (B- tier)

### Duration Considerations

**Short-Lived Positions**:
- Some members briefly hold Cabinet roles (e.g., 3 months during shuffle)
- **Impact**: Peak rank component (30%) ensures this is recognized, but short duration limits average component

**Long Tenure as Backbencher**:
- Members serving 20+ years without positions
- **Impact**: Score = 0, but high interventions/bills can still yield strong Activity Index

### Political Neutrality

**Concern**: Does this favor government over opposition?
- Government controls Cabinet (~40 positions)
- Opposition has fewer formal roles (House Leader, Whip, critics)

**Mitigation**:
- Opposition Leader ranked A+ (equal to Speaker)
- Committee Chairs are distributed across parties
- Shadow Cabinet critics are NOT in xBill data (potential future enhancement)

---

## Alternative Approaches Considered

### Option 1: Binary "Has Leadership Role" Flag
**Approach**: Simple true/false for whether member has ever held any position  
**Pros**: Easy to implement  
**Cons**: Treats Speaker and Committee Member equally; ignores duration

### Option 2: Current Position Only
**Approach**: Score based solely on current role  
**Pros**: Simpler calculation  
**Cons**: Ignores career trajectory; penalizes former PMs now in opposition

### Option 3: Count of Positions Held
**Approach**: Total number of distinct positions  
**Pros**: Rewards breadth of experience  
**Cons**: Treats PM and caucus chair equally; incentivizes job-hopping

**Selected Approach** (Weighted Average + Peak Rank):
- Recognizes both sustained leadership (average) and career highlights (peak)
- Accounts for position significance and duration
- Provides nuanced scores across 0-100 range

---

## Future Enhancements

1. **Shadow Cabinet Integration**
   - If xBill adds opposition critic roles, include them at B/B+ tier
   
2. **Historical Position Data**
   - Extend rankings to previous Parliaments for longitudinal analysis
   
3. **Committee Importance Weighting**
   - Weight committee chairs differently (e.g., Finance Committee Chair > Procedure Committee Chair)
   
4. **Party-Specific Adjustments**
   - Adjust rankings for party size (e.g., Green Party Leader in a 2-seat caucus)

5. **Multi-Chamber Support**
   - Extend to Senate roles (Government Leader in Senate, etc.)

---

## References

- [positions-committee-roles.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\reports\positions-committee-roles.md) - Source data
- [METRICS_DOCUMENTATION.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\METRICS_DOCUMENTATION.md) - Current metrics
- [ACTIVITY_INDEX_METHODOLOGY.md](C:\Users\bb\OneDrive\Projects\parliament_tracker_stats\archive\docs\ACTIVITY_INDEX_METHODOLOGY.md) - Activity Index design rationale

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-20  
**Authors**: Parliament Analytics Team
