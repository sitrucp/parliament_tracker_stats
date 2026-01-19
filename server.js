const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const { MongoClient } = require("mongodb");
const app = express();
const port = 3001;

const XBILL_API = "https://xbill.ca/api";
const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "xbill";

let db = null;

async function connectDatabase() {
    try {
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db(DB_NAME);
        
        // Create collections if they don't exist
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        
        if (!collectionNames.includes("members")) {
            await db.createCollection("members");
            console.log("Created 'members' collection");
        }
        
        if (!collectionNames.includes("votes")) {
            await db.createCollection("votes");
            console.log("Created 'votes' collection");
        }
        
        if (!collectionNames.includes("interventions")) {
            await db.createCollection("interventions");
            console.log("Created 'interventions' collection");
        }

        // New collections for syncing/caching vote data
        if (!collectionNames.includes("vote_casts")) {
            await db.createCollection("vote_casts");
            console.log("Created 'vote_casts' collection");
        }
        if (!collectionNames.includes("sessions")) {
            await db.createCollection("sessions");
            console.log("Created 'sessions' collection");
        }

        // Calculated analytics collections
        if (!collectionNames.includes("member_stats")) {
            await db.createCollection("member_stats");
            console.log("Created 'member_stats' collection");
        }
        if (!collectionNames.includes("vote_stats")) {
            await db.createCollection("vote_stats");
            console.log("Created 'vote_stats' collection");
        }
        if (!collectionNames.includes("member_vote_records")) {
            await db.createCollection("member_vote_records");
            console.log("Created 'member_vote_records' collection");
        }
        if (!collectionNames.includes("bills")) {
            await db.createCollection("bills");
            console.log("Created 'bills' collection");
        }

        // Ensure useful indexes
        await db.collection("members").createIndex({ person_id: 1 }, { unique: true });
        await db.collection("votes").createIndex({ parliament: 1, session: 1, division_number: 1 }, { unique: true });
        await db.collection("vote_casts").createIndex({ parliament: 1, session: 1, division_number: 1, person_id: 1 }, { unique: true });
        // _id index is created automatically by MongoDB; do not recreate

        // Indexes for analytics collections
        await db.collection("member_stats").createIndex({ parliament: 1, session: 1, person_id: 1 }, { unique: true });
        await db.collection("vote_stats").createIndex({ parliament: 1, session: 1, division_number: 1 }, { unique: true });
        await db.collection("member_vote_records").createIndex({ parliament: 1, session: 1, person_id: 1 });
        await db.collection("member_vote_records").createIndex({ parliament: 1, session: 1, division_number: 1 });
        await db.collection("bills").createIndex({ number: 1, parliament: 1, session: 1 }, { unique: true });
        
        console.log("Connected to MongoDB database: " + DB_NAME);
        return true;
    } catch (error) {
        console.error("Database connection error:", error.message);
        return false;
    }
}

app.use(express.json());
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public/html")));

async function main() {
    try {
        // Connect to database
        const dbConnected = await connectDatabase();
        
        // API: Get all current MPs (from MongoDB or fetch if empty)
        app.get("/api/members", async (req, res) => {
            try {
                console.log("Fetching members...");
                
                if (!db) {
                    return res.status(500).json({ error: "Database not connected" });
                }
                
                // Try to get from MongoDB first
                let members = await db.collection("members").find({}).toArray();
                
                if (members.length === 0) {
                    console.log("No members in database, fetching from xBill API...");
                    const response = await fetch(`${XBILL_API}/members/current-house`);
                    
                    if (!response.ok) {
                        throw new Error(`xBill API error: ${response.status} ${response.statusText}`);
                    }
                    
                    const apiData = await response.json();
                    members = Array.isArray(apiData) ? apiData : (apiData.members || apiData.data || []);
                    
                    console.log(`Fetched ${members.length} members from xBill API`);
                    
                    // Save to MongoDB
                    if (members.length > 0) {
                        await db.collection("members").insertMany(members);
                        console.log(`Stored ${members.length} members in MongoDB`);
                    }
                } else {
                    console.log(`Found ${members.length} members in MongoDB`);
                }
                
                // EXCLUDED LONG TEXT FIELDS (not retrieved - kept as placeholders):
                // - short_summary: biographical narrative text (~200-300 chars)
                // - keywords: array of policy/topic keywords (~10-15 items)
                // Filter these from response
                const sanitized = members.map(m => {
                    const { short_summary, keywords, ...rest } = m;
                    return rest;
                });
                
                res.json(sanitized);
            } catch (error) {
                console.error("Error fetching members:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Helper: normalize party/province/riding fields
        const getMemberMeta = (m) => {
            if (!m) return { name: undefined, party: undefined, province: undefined, riding: undefined };
            const party = m.party || m.party_name || m.member_party || undefined;
            const province = m.province || m.province_name || m.member_province || undefined;
            const riding = m.constituency || m.riding || m.district || m.member_constituency || undefined;
            const name = m.name || m.person_name || m.member_name || undefined;
            return { name, party, province, riding };
        };

        // COMPUTE: Pre-aggregate analytics for a session
        app.post("/api/compute/session/:parliament/:session", async (req, res) => {
            try {
                const { parliament, session } = req.params;
                const pStr = String(parliament), sStr = String(session);
                console.log(`[COMPUTE] Starting analytics for Parliament ${pStr} Session ${sStr}`);

                // Load members and map metadata + compute tenure
                const membersArr = await db.collection("members").find({}).toArray();
                const now = new Date();
                const membersMap = new Map(membersArr.map(m => {
                    const chamberLower = (m.chamber || '').toLowerCase();
                    const isSenate = chamberLower === 'senate';
                    
                    // DEBUG: Log first member's election_history
                    if (m.person_id === '89156') {
                        console.log(`[DEBUG] Member 89156 has election_history: ${!!m.election_history}`);
                        if (m.election_history) {
                            console.log(`[DEBUG] Election history count: ${m.election_history.length}`);
                            console.log(`[DEBUG] First election:`, m.election_history[0]);
                        }
                    }
                    
                    // Tenure calculation from earliest election in election_history (the actual date they became an MP)
                    // This captures the entire duration as an MP across all parliaments
                    let tenureMonths = 0;
                    let tenureStartDate = null;
                    
                    if (m.election_history && Array.isArray(m.election_history) && m.election_history.length > 0) {
                        // Find earliest election where they were elected (not defeated)
                        const electionDates = m.election_history
                            .filter(e => e.election_result_type && 
                                        (e.election_result_type.toLowerCase().includes('elected') || 
                                         e.election_result_type.toLowerCase().includes('acclaimed')))
                            .map(e => e.election_date ? new Date(e.election_date) : null)
                            .filter(d => d !== null);
                        
                        if (electionDates.length > 0) {
                            tenureStartDate = new Date(Math.min(...electionDates.map(d => d.getTime())));
                            tenureMonths = Math.floor((now - tenureStartDate) / (30.44 * 24 * 60 * 60 * 1000));
                        }
                    }
                    
                    // Fallback to from_datetime if election_history not available (for Senate members who are appointed, not elected)
                    if (!tenureStartDate && m.from_datetime) {
                        tenureStartDate = new Date(m.from_datetime);
                        tenureMonths = Math.floor((now - tenureStartDate) / (30.44 * 24 * 60 * 60 * 1000));
                    }
                    
                    // Count successful elections (Elected or Re-Elected, excluding Defeated)
                    const electionsWon = (m.election_history && Array.isArray(m.election_history)) 
                        ? m.election_history.filter(e => e.election_result_type && 
                            (e.election_result_type.toLowerCase().includes('elected') || 
                             e.election_result_type.toLowerCase().includes('acclaimed'))).length 
                        : 0;
                    
                    // Use API-provided counts (or 0 if missing)
                    const debateCount = m.debate_intervention_count || 0;
                    const committeeCount = m.committee_intervention_count || 0;
                    const billsSponsored = m.bills_sponsored_current || m.bills_sponsored || 0;
                    
                    // DEBUG: Log for specific member
                    if (m.person_id === '49344') {
                        console.log(`[DEBUG] Member 49344: committee_intervention_count=${m.committee_intervention_count}, mapped as api_committee_count=${committeeCount}`);
                    }
                    
                    // Count unique committees (from committees array by committee_name)
                    const uniqueCommittees = (m.committees && Array.isArray(m.committees))
                        ? new Set(m.committees.map(c => c.committee_name).filter(Boolean)).size
                        : 0;
                    
                    // Count unique associations (from associations array by organization)
                    const uniqueAssociations = (m.associations && Array.isArray(m.associations))
                        ? new Set(m.associations.map(a => a.organization).filter(Boolean)).size
                        : 0;
                    
                    return [String(m.person_id), {
                        ...getMemberMeta(m),
                        person_id: String(m.person_id),
                        chamber: chamberLower,
                        caucus_short_name: isSenate ? 'Senate' : (m.caucus_short_name || m.caucus_short),
                        province: isSenate ? 'Senate' : (m.constituency_province_territory || m.province),
                        constituency: isSenate ? 'Senate' : (m.constituency_name || m.constituency),
                        political_alignment_score: m.political_alignment_score,
                        full_name: m.full_name || m.name,
                        isSenate: isSenate,
                        tenure_months: tenureMonths,
                        years_in_house: Math.floor(tenureMonths / 12),
                        elections_won: electionsWon,  // Actual count from election_history array
                        committees_current: uniqueCommittees,  // Count unique committee names
                        associations_count: uniqueAssociations,  // Count unique associations
                        api_debate_count: debateCount,  // From xBill aggregates
                        api_committee_count: committeeCount,  // From xBill aggregates
                        api_bills_sponsored: billsSponsored  // From xBill
                    }];
                }));
                
                // For vote participation calculations, only include House members (Senate doesn't vote on House divisions)
                const houseMembers = Array.from(membersMap.values()).filter(m => !m.isSenate);
                const houseMemberIds = new Set(houseMembers.map(m => m.person_id));
                const allMemberIds = Array.from(membersMap.keys());

                // Load votes (handle possible mixed types for p/s)
                const votes = await db.collection("votes").find({
                    $and: [
                        { $or: [ { parliament: pStr }, { parliament: Number(parliament) } ] },
                        { $or: [ { session: sStr }, { session: Number(session) } ] }
                    ]
                }).sort({ division_number: 1 }).toArray();

                // Clear previous computed docs
                await db.collection("member_vote_records").deleteMany({ parliament: pStr, session: sStr });
                await db.collection("vote_stats").deleteMany({ parliament: pStr, session: sStr });
                await db.collection("member_stats").deleteMany({ parliament: pStr, session: sStr });

                let mvrInserted = 0;
                for (const vote of votes) {
                    const division = vote.division_number;
                    const vDocId = vote._id;
                    const vDate = vote.date || vote.voted_at || vote.timestamp || undefined;

                    const casts = await db.collection("vote_casts").find({
                        parliament: pStr,
                        session: sStr,
                        division_number: division
                    }).toArray();

                    // Build sets and aggregates
                    const presentDecisions = new Set(["Yea", "Nay", "Abstain"]);
                    const presentSet = new Set();
                    const pairedSet = new Set();
                    const byParty = {};

                    // Insert member_vote_records for present/paired
                    const bulk = db.collection("member_vote_records").initializeUnorderedBulkOp();
                    for (const c of casts) {
                        const pid = String(c.person_id);
                        const member = membersMap.get(pid) || { name: c.member_name, party: c.member_party, province: c.member_province, riding: c.member_constituency };
                        const decision = c.decision_value;
                        const status = decision === 'Paired' ? 'paired' : (presentDecisions.has(decision) ? 'present' : 'unknown');

                        if (status === 'present') presentSet.add(pid);
                        if (status === 'paired') pairedSet.add(pid);

                        const partyKey = member.party || 'Unknown';
                        byParty[partyKey] = byParty[partyKey] || { Yea: 0, Nay: 0, Paired: 0, Abstain: 0 };
                        if (decision && byParty[partyKey][decision] !== undefined) byParty[partyKey][decision] += 1;

                        bulk.find({ parliament: pStr, session: sStr, division_number: division, person_id: pid })
                            .upsert()
                            .updateOne({ $set: {
                                parliament: pStr, session: sStr, division_number: division, vote_doc_id: vDocId, date: vDate,
                                person_id: pid, member_name: member.name, party: member.party, province: member.province, riding: member.riding,
                                decision_value: decision, status
                            }});
                        mvrInserted++;
                    }

                    // Absent members: everyone not in present/paired sets
                    const absentIds = allMemberIds.filter(id => !presentSet.has(id) && !pairedSet.has(id));
                    for (const pid of absentIds) {
                        const member = membersMap.get(pid) || {};
                        bulk.find({ parliament: pStr, session: sStr, division_number: division, person_id: pid })
                            .upsert()
                            .updateOne({ $set: {
                                parliament: pStr, session: sStr, division_number: division, vote_doc_id: vDocId, date: vDate,
                                person_id: pid, member_name: member.name, party: member.party, province: member.province, riding: member.riding,
                                decision_value: 'Absent', status: 'absent'
                            }});
                        mvrInserted++;
                    }
                    await bulk.execute();

                    // vote_stats for this division (using only House members, not Senate)
                    // Filter present/paired to only House members
                    const presentCountHouse = Array.from(presentSet).filter(id => houseMemberIds.has(id)).length;
                    const pairedCountHouse = Array.from(pairedSet).filter(id => houseMemberIds.has(id)).length;
                    const totalMembersHouse = houseMemberIds.size;
                    const absentCountHouse = Math.max(totalMembersHouse - presentCountHouse - pairedCountHouse, 0);
                    const participationRateHouse = totalMembersHouse > 0 ? ((presentCountHouse + pairedCountHouse) / totalMembersHouse) * 100 : 0;

                    await db.collection("vote_stats").updateOne(
                        { parliament: pStr, session: sStr, division_number: division },
                        { $set: {
                            parliament: pStr, session: sStr, division_number: division, vote_doc_id: vDocId, date: vDate,
                            present_count: presentCountHouse, paired_count: pairedCountHouse, absent_count: absentCountHouse, total_members: totalMembersHouse,
                            participation_rate: Number(participationRateHouse.toFixed(1)), by_party: byParty
                        } },
                        { upsert: true }
                    );
                }

                // Compute member_stats from member_vote_records (House members only)
                const agg = await db.collection("member_vote_records").aggregate([
                    { $match: { parliament: pStr, session: sStr } },
                    { $group: {
                        _id: "$person_id",
                        name: { $first: "$member_name" },
                        party: { $first: "$party" },
                        present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
                        paired: { $sum: { $cond: [{ $eq: ["$status", "paired"] }, 1, 0] } },
                        absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
                        total_votes: { $sum: 1 }
                    } }
                ]).toArray();

                // Use counts from members collection (already provided by xBill API)
                // No need to aggregate MongoDB collections when API provides accurate counts
                console.log('[COMPUTE] Using intervention/bill counts from members collection (xBill API aggregates)...');

                // Build base metrics array
                const baseMetrics = [];
                for (const row of agg) {
                    const presenceRate = row.total_votes > 0 ? Number((((row.present + row.paired) / row.total_votes) * 100).toFixed(1)) : 0;
                    const pid = String(row._id);
                    const memberMeta = membersMap.get(pid);
                    
                    // Skip Senate members - House analytics only
                    if (!memberMeta || memberMeta.isSenate) {
                        continue;
                    }
                    
                    // Use full_name from member metadata, fallback to aggregation name
                    const displayName = memberMeta.full_name || memberMeta.name || row.name || 'Unknown';
                    // Prefer caucus_short_name; source API party field can be unreliable (often 'Independent')
                    const displayParty = memberMeta.caucus_short_name || memberMeta.party || row.party || 'Independent';
                    
                    // Use counts directly from members collection (xBill API aggregates)
                    const interventions_count = memberMeta.api_debate_count || 0;
                    const committee_interventions_count = memberMeta.api_committee_count || 0;
                    const bills_sponsored_current = memberMeta.api_bills_sponsored || 0;
                    
                    // DEBUG: Log for specific member
                    if (pid === '49344') {
                        console.log(`[DEBUG] Member 49344 in baseMetrics: api_committee_count=${memberMeta.api_committee_count}, using committee_interventions_count=${committee_interventions_count}`);
                    }
                    
                    // Interventions per month (normalize by tenure)
                    const interventions_per_month = memberMeta.tenure_months > 0 
                        ? Number((interventions_count / memberMeta.tenure_months).toFixed(2)) 
                        : 0;
                    const committee_per_month = memberMeta.tenure_months > 0 
                        ? Number((committee_interventions_count / memberMeta.tenure_months).toFixed(2)) 
                        : 0;

                    baseMetrics.push({
                        parliament: pStr,
                        session: sStr,
                        person_id: pid,
                        name: displayName,
                        party: displayParty,
                        chamber: memberMeta.chamber,
                        caucus_short_name: memberMeta.caucus_short_name,
                        province: memberMeta.province,
                        constituency: memberMeta.constituency,
                        political_alignment_score: memberMeta.political_alignment_score,
                        
                        // Voting
                        present: row.present,
                        paired: row.paired,
                        absent: row.absent,
                        total_votes: row.total_votes,
                        presence_rate: presenceRate,
                        
                        // Tenure
                        tenure_months: memberMeta.tenure_months,
                        years_in_house: memberMeta.years_in_house,
                        elections_won: memberMeta.elections_won,
                        
                        // Roles & Engagement
                        committees_count: memberMeta.committees_current,
                        associations_count: memberMeta.associations_count,
                        
                        // Activity
                        interventions_count,
                        interventions_per_month,
                        committee_interventions_count,
                        committee_per_month,
                        bills_sponsored_current
                    });
                }

                console.log(`[COMPUTE] Computing activity index and percentiles for ${baseMetrics.length} members...`);
                
                // Compute activity index (weighted composite) - using total counts (not per-month) to avoid tenure dilution
                const avgInterventions = baseMetrics.reduce((sum, m) => sum + m.interventions_count, 0) / baseMetrics.length || 1;
                const avgCommitteeInterventions = baseMetrics.reduce((sum, m) => sum + m.committee_interventions_count, 0) / baseMetrics.length || 1;
                const avgBills = baseMetrics.reduce((sum, m) => sum + m.bills_sponsored_current, 0) / baseMetrics.length || 1;
                const avgCommittees = baseMetrics.reduce((sum, m) => sum + m.committees_count, 0) / baseMetrics.length || 1;
                const avgAssociations = baseMetrics.reduce((sum, m) => sum + m.associations_count, 0) / baseMetrics.length || 1;

                for (const m of baseMetrics) {
                    // Activity index formula (0-10 scale)
                    // Weights (renormalized to sum 100% after removing presence):
                    // interventions 33%, committee work 26.7%, bills 20%, committees 13.3%, associations 6.7%
                    const interventionWeight = 0.3333333333;
                    const committeeWorkWeight = 0.2666666667;
                    const billsWeight = 0.20;
                    const committeesWeight = 0.1333333333;
                    const associationsWeight = 0.0666666667;

                    const interventionComponent = Math.min((m.interventions_count / avgInterventions) * interventionWeight, interventionWeight);
                    const committeeWorkComponent = Math.min((m.committee_interventions_count / avgCommitteeInterventions) * committeeWorkWeight, committeeWorkWeight);
                    const billComponent = avgBills > 0 ? Math.min((m.bills_sponsored_current / avgBills) * billsWeight, billsWeight) : 0;
                    const committeesComponent = avgCommittees > 0 ? Math.min((m.committees_count / avgCommittees) * committeesWeight, committeesWeight) : 0;
                    const associationsComponent = avgAssociations > 0 ? Math.min((m.associations_count / avgAssociations) * associationsWeight, associationsWeight) : 0;
                    
                    m.activity_index_score = Number(((interventionComponent + committeeWorkComponent + billComponent + committeesComponent + associationsComponent) * 10).toFixed(2));
                }

                // Compute ranks and percentiles
                const metricsToRank = [
                    'presence_rate', 'tenure_months', 'interventions_count', 
                    'committee_interventions_count', 'bills_sponsored_current', 
                    'activity_index_score', 'committees_count', 'associations_count'
                ];

                for (const metricName of metricsToRank) {
                    // Overall ranks
                    const sorted = [...baseMetrics].sort((a, b) => (b[metricName] || 0) - (a[metricName] || 0));
                    sorted.forEach((m, idx) => {
                        m[`${metricName}_rank`] = idx + 1;
                        m[`${metricName}_percentile`] = baseMetrics.length > 0 ? Math.round(((baseMetrics.length - idx) / baseMetrics.length) * 100) : 0;
                    });

                    // Within-party percentiles
                    const byParty = {};
                    for (const m of baseMetrics) {
                        const party = m.caucus_short_name || m.party || 'Unknown';
                        if (!byParty[party]) byParty[party] = [];
                        byParty[party].push(m);
                    }

                    for (const partyMembers of Object.values(byParty)) {
                        const sortedParty = [...partyMembers].sort((a, b) => (b[metricName] || 0) - (a[metricName] || 0));
                        sortedParty.forEach((m, idx) => {
                            m[`${metricName}_percentile_in_party`] = partyMembers.length > 0 ? Math.round(((partyMembers.length - idx) / partyMembers.length) * 100) : 0;
                        });
                    }
                }

                // Replace existing member_stats for this session to avoid stale values
                console.log('[COMPUTE] Clearing previous member_stats for session...');
                await db.collection("member_stats").deleteMany({ parliament: pStr, session: sStr });
                console.log('[COMPUTE] Writing member_stats...');
                let msUpserts = 0;
                for (const m of baseMetrics) {
                    // Debug: print one known member activity index
                    if (m.person_id === '25524') {
                        console.log(`[COMPUTE][DEBUG] Member 25524 activity_index_score=${m.activity_index_score}, components:`, {
                            interventions_per_month: m.interventions_per_month,
                            committee_per_month: m.committee_per_month,
                            bills_sponsored_current: m.bills_sponsored_current,
                            committees_count: m.committees_count,
                            associations_count: m.associations_count
                        });
                    }
                    await db.collection("member_stats").updateOne(
                        { parliament: pStr, session: sStr, person_id: m.person_id },
                        { $set: { ...m, computed_at: new Date(), metrics_version: 'v3' } },
                        { upsert: true }
                    );
                    msUpserts++;
                }

                // Create session_facts
                await db.collection("sessions").updateOne(
                    { _id: `${pStr}-${sStr}` },
                    { $set: {
                        parliament: pStr,
                        session: sStr,
                        total_votes: votes.length,
                        total_members_computed: msUpserts,
                        computed_at: new Date()
                    } },
                    { upsert: true }
                );

                console.log('[COMPUTE] Analytics complete.');
                res.json({
                    parliament: pStr, session: sStr,
                    votes_processed: votes.length,
                    member_vote_records: mvrInserted,
                    member_stats_upserts: msUpserts,
                    vote_stats_upserts: votes.length
                });
            } catch (err) {
                console.error("Compute stats error:", err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // READ: Vote stats time series for a session
        app.get("/api/stats/votes", async (req, res) => {
            try {
                const { parliament = '45', session = '1' } = req.query;
                const pStr = String(parliament), sStr = String(session);
                // Join with votes to try to pick a descriptive label if available
                const docs = await db.collection("vote_stats").aggregate([
                    { $match: { parliament: pStr, session: sStr } },
                    { $lookup: { from: "votes", let: { div: "$division_number" }, pipeline: [
                        { $match: { $expr: { $eq: ["$division_number", "$$div"] } } },
                        { $project: { _id: 1, division_number: 1, date: 1, voted_at: 1, timestamp: 1, decision_event_datetime: 1, title: 1, question: 1, description: 1, bill_number: 1 } }
                    ], as: "vote" } },
                    { $addFields: {
                        vote: { $arrayElemAt: ["$vote", 0] },
                        label: { $ifNull: ["$vote.bill_number", { $ifNull: ["$vote.title", { $ifNull: ["$vote.question", { $concat: ["Division ", { $toString: "$division_number" }] }] }] }] },
                        bill_number: "$vote.bill_number",
                        outDate: { $ifNull: ["$date", { $ifNull: ["$vote.decision_event_datetime", { $ifNull: ["$vote.date", { $ifNull: ["$vote.voted_at", "$vote.timestamp"] }] }] }] }
                    } },
                    { $sort: { outDate: 1, division_number: 1 } },
                    { $project: { _id: 0, parliament: 1, session: 1, division_number: 1, date: "$outDate", present_count: 1, paired_count: 1, absent_count: 1, total_members: 1, participation_rate: 1, label: 1, bill_number: 1 } }
                ]).toArray();
                res.json({ parliament: pStr, session: sStr, count: docs.length, votes: docs });
            } catch (err) {
                console.error("Read vote stats error:", err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // READ: Member stats for a session
        app.get("/api/stats/members", async (req, res) => {
            try {
                const { parliament = '45', session = '1' } = req.query;
                const pStr = String(parliament), sStr = String(session);
                const docs = await db.collection("member_stats").find({ parliament: pStr, session: sStr }).toArray();
                res.json({ parliament: pStr, session: sStr, count: docs.length, stats: docs });
            } catch (err) {
                console.error("Read member stats error:", err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // READ: Member vote records for a session
        app.get("/api/stats/member-vote-records", async (req, res) => {
            try {
                const { parliament = '45', session = '1' } = req.query;
                const pStr = String(parliament), sStr = String(session);
                const docs = await db.collection("member_vote_records").find({ parliament: pStr, session: sStr }).toArray();
                res.json({ parliament: pStr, session: sStr, count: docs.length, records: docs });
            } catch (err) {
                console.error("Read member vote records error:", err.message);
                res.status(500).json({ error: err.message });
            }
        });

        // API: Get specific member details
        app.get("/api/member/:personId", async (req, res) => {
            try {
                const { personId } = req.params;
                
                if (!db) {
                    return res.status(500).json({ error: "Database not connected" });
                }
                
                // Try MongoDB first
                let member = await db.collection("members").findOne({ person_id: parseInt(personId) });
                
                if (!member) {
                    // Fetch from API
                    const response = await fetch(`${XBILL_API}/members/${personId}`);
                    
                    if (!response.ok) {
                        throw new Error(`xBill API error: ${response.status} ${response.statusText}`);
                    }
                    
                    member = await response.json();
                    
                    // Save to MongoDB
                    if (member) {
                        await db.collection("members").updateOne(
                            { person_id: parseInt(personId) },
                            { $set: member },
                            { upsert: true }
                        );
                    }
                }
                
                res.json(member);
            } catch (error) {
                console.error("Error fetching member:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // API: Get member's interventions (speeches, questions)
        app.get("/api/member/:personId/interventions", async (req, res) => {
            try {
                const { personId } = req.params;
                
                const response = await fetch(`${XBILL_API}/members/${personId}/interventions`);
                
                if (!response.ok) {
                    throw new Error(`xBill API error: ${response.status} ${response.statusText}`);
                }
                
                const interventions = await response.json();
                res.json(interventions);
            } catch (error) {
                console.error("Error fetching interventions:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // API: Get member's committee interventions
        app.get("/api/member/:personId/committee-interventions", async (req, res) => {
            try {
                const { personId } = req.params;
                
                const response = await fetch(`${XBILL_API}/committee-interventions/member/${personId}`);
                
                if (!response.ok) {
                    throw new Error(`xBill API error: ${response.status} ${response.statusText}`);
                }
                
                const interventions = await response.json();
                res.json(interventions);
            } catch (error) {
                console.error("Error fetching committee interventions:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // API: Get external sources/news mentions about a member
        app.get("/api/member/:personId/sources", async (req, res) => {
            try {
                const { personId } = req.params;
                const limit = req.query.limit || 10;
                
                const response = await fetch(`${XBILL_API}/sources?person_id=${personId}&limit=${limit}`);
                
                if (!response.ok) {
                    throw new Error(`xBill API error: ${response.status} ${response.statusText}`);
                }
                
                const sources = await response.json();
                res.json(sources);
            } catch (error) {
                console.error("Error fetching sources:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // API: Attendance approximation per sitting day (by vote rollcalls)
        app.get("/api/attendance/:parliament/:session", async (req, res) => {
            try {
                const { parliament, session } = req.params;

                // Get current MPs count for inferred absent
                let totalMembers = 0;
                if (db) {
                    totalMembers = await db.collection("members").countDocuments();
                }
                if (!totalMembers) {
                    const memResp = await fetch(`${XBILL_API}/members/current-house`);
                    const memData = await memResp.json();
                    const memArr = Array.isArray(memData) ? memData : (memData.members || memData.data || []);
                    totalMembers = memArr.length;
                }

                // Fetch votes list for the session (cap at 200 for now)
                const votesResp = await fetch(`${XBILL_API}/votes?parliament=${parliament}&session=${session}&limit=200&sort=date_asc`);
                if (!votesResp.ok) throw new Error(`xBill API error: ${votesResp.status} ${votesResp.statusText}`);
                const votesList = await votesResp.json();
                const votes = Array.isArray(votesList.results) ? votesList.results : (Array.isArray(votesList) ? votesList : []);

                const byDate = {};

                for (const vote of votes) {
                    const division = vote.division_number;
                    const date = vote.date || vote.voted_at || vote.publication_date || vote.created_at;
                    if (!division || !date) continue;

                    const castResp = await fetch(`${XBILL_API}/votes/${parliament}/${session}/${division}/cast`);
                    if (!castResp.ok) continue;
                    const castData = await castResp.json();
                    const casts = Array.isArray(castData.results) ? castData.results : (Array.isArray(castData) ? castData : []);

                    if (!byDate[date]) {
                        byDate[date] = { present: new Set(), paired: new Set() };
                    }
                    casts.forEach(c => {
                        const pid = c.person_id;
                        const how = (c.how || '').toLowerCase();
                        if (!pid) return;
                        if (how === 'paired') {
                            byDate[date].paired.add(pid);
                        } else if (how === 'yea' || how === 'nay' || how === 'abstain') {
                            byDate[date].present.add(pid);
                        }
                    });
                }

                const result = Object.entries(byDate).map(([date, sets]) => {
                    const presentCount = sets.present.size;
                    const pairedCount = sets.paired.size;
                    const absent = Math.max(totalMembers - presentCount - pairedCount, 0);
                    return { date, present: presentCount, paired: pairedCount, absent, totalMembers };
                }).sort((a, b) => new Date(a.date) - new Date(b.date));

                res.json({ session: `${parliament}-${session}`, totalMembers, days: result });
            } catch (error) {
                console.error("Error computing attendance:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // API: Comparative stats - attendance/presence for all MPs
        app.get("/api/comparative-stats/attendance", async (req, res) => {
            try {
                const { parliament = 45, session = 1, limit = 20 } = req.query;

                // Set a 45 second timeout for the response
                const timeout = setTimeout(() => {
                    if (!res.headersSent) {
                        res.status(504).json({ error: "Request timeout - too many votes to process" });
                    }
                }, 45000);

                // Fetch all current MPs
                const memResp = await fetch(`${XBILL_API}/members/current-house`);
                if (!memResp.ok) throw new Error(`xBill API error: ${memResp.status}`);
                const memData = await memResp.json();
                const members = Array.isArray(memData) ? memData : (memData.members || memData.data || []);

                // Fetch votes for the session with MUCH lower limit to avoid rate limiting
                const voteLimit = Math.min(parseInt(limit), 20);
                const votesResp = await fetch(`${XBILL_API}/votes?parliament=${parliament}&session=${session}&limit=${voteLimit}&sort=date_desc`);
                if (!votesResp.ok) throw new Error(`xBill API error: ${votesResp.status}`);
                const votesList = await votesResp.json();
                const votes = votesList.votes || votesList.results || (Array.isArray(votesList) ? votesList : []);

                console.log(`Fetched ${votes.length} votes for parliament ${parliament}, session ${session}`);
                console.log('First vote object:', votes.length > 0 ? JSON.stringify(votes[0], null, 2) : 'No votes found');
                console.log('Vote keys:', votes.length > 0 ? Object.keys(votes[0]) : 'N/A');

                // For each vote, gather cast votes
                const memberStats = {};
                members.forEach(m => {
                    memberStats[m.person_id] = { 
                        name: m.name || m.person_name || "Unknown",
                        party: m.party || m.party_name || "Independent",
                        present: 0, 
                        paired: 0, 
                        absent: 0,
                        total_votes: 0
                    };
                });

                let totalVotesProcessed = 0;
                for (const vote of votes) {
                    const division = vote.division_number;
                    if (!division) {
                        console.log('Skipping vote with no division number:', vote);
                        continue;
                    }

                    console.log(`Processing vote division ${division}...`);

                    try {
                        // Add 100ms delay between requests to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        const castResp = await fetch(`${XBILL_API}/votes/${parliament}/${session}/${division}/cast`);
                        
                        if (castResp.status === 429) {
                            console.warn(`Rate limited on vote ${division}, waiting 2s...`);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            continue;
                        }
                        
                        if (!castResp.ok) {
                            console.warn(`Failed to fetch cast for vote ${division}: ${castResp.status}`);
                            continue;
                        }
                        const castData = await castResp.json();
                        const casts = Array.isArray(castData.results) ? castData.results : (Array.isArray(castData) ? castData : []);

                        totalVotesProcessed++;
                        
                        // Track who participated in this vote
                        const participantIds = new Set(casts.map(c => c.person_id).filter(Boolean));

                        casts.forEach(c => {
                            const pid = c.person_id;
                            const how = (c.how || '').toLowerCase();
                            if (!pid) return;
                            if (!memberStats[pid]) {
                                memberStats[pid] = { name: c.person_name || "Unknown", party: "Independent", present: 0, paired: 0, absent: 0, total_votes: 0 };
                            }
                            memberStats[pid].total_votes++;
                            if (how === 'paired') {
                                memberStats[pid].paired++;
                            } else if (how === 'yea' || how === 'nay' || how === 'abstain') {
                                memberStats[pid].present++;
                            }
                        });

                        // Mark MPs not in this vote as absent
                        members.forEach(m => {
                            const pid = m.person_id;
                            if (!participantIds.has(pid) && memberStats[pid]) {
                                memberStats[pid].absent++;
                                memberStats[pid].total_votes++;
                            }
                        });
                    } catch (voteError) {
                        console.warn(`Error processing vote ${division}:`, voteError.message);
                        continue;
                    }
                }

                const stats = Object.entries(memberStats)
                    .map(([pid, stat]) => ({
                        person_id: pid,
                        name: stat.name,
                        party: stat.party,
                        present: stat.present,
                        paired: stat.paired,
                        absent: stat.absent,
                        total_votes: stat.total_votes,
                        presence_rate: stat.total_votes > 0 ? ((stat.present + stat.paired) / stat.total_votes * 100).toFixed(1) : 0
                    }))
                    .sort((a, b) => parseFloat(b.presence_rate) - parseFloat(a.presence_rate));

                clearTimeout(timeout);
                res.json({ parliament, session, total_votes_processed: totalVotesProcessed, total_members: members.length, stats });
            } catch (error) {
                console.error("Error computing comparative stats:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // ===== PHASE 3: Analytics APIs =====

        // GET /api/metrics/members - Fetch all member metrics with filtering & sorting
        app.get("/api/metrics/members", async (req, res) => {
            try {
                const { parliament = "45", session = "1", party, province, sort = "activity_index_score", order = "desc", limit = 500 } = req.query;

                // Build query filter
                const filter = { parliament, session };
                if (party) filter.party = party;
                if (province) filter.province = province;

                // Parse sort order
                const sortOrder = order === "asc" ? 1 : -1;
                const sortField = sort === "activity_index_score" ? "activity_index_score" : sort;

                // Fetch members with sorting and limit
                const members = await db.collection("member_stats")
                    .find(filter)
                    .sort({ [sortField]: sortOrder })
                    .limit(parseInt(limit))
                    .toArray();

                res.json({
                    parliament,
                    session,
                    count: members.length,
                    members: members.map(m => ({
                        person_id: m.person_id,
                        name: m.name,
                        party: m.party,
                        caucus_short_name: m.caucus_short_name,
                        province: m.province,
                        constituency: m.constituency,
                        // Voting
                        presence_rate: (m.presence_rate || 0).toFixed(1),
                        presence_rank: m.presence_rank,
                        presence_percentile: m.presence_percentile,
                        // Tenure
                        tenure_months: m.tenure_months,
                        // Engagement
                        committees_count: m.committees_count,
                        associations_count: m.associations_count,
                        // Activity
                        interventions_count: m.interventions_count,
                        committee_interventions_count: m.committee_interventions_count,
                        bills_sponsored_current: m.bills_sponsored_current,
                        // Activity index
                        activity_index_score: (m.activity_index_score || 0).toFixed(2),
                        activity_index_rank: m.activity_index_rank,
                        activity_index_percentile: m.activity_index_percentile,
                        activity_index_percentile_in_party: m.activity_index_percentile_in_party
                    }))
                });
            } catch (error) {
                console.error("Error fetching member metrics:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // GET /api/metrics/member/:personId - Fetch single member profile with comparisons
        app.get("/api/metrics/member/:personId", async (req, res) => {
            try {
                const { personId } = req.params;
                const { parliament = "45", session = "1" } = req.query;

                // Fetch the member's stats
                const member = await db.collection("member_stats").findOne({
                    parliament,
                    session,
                    person_id: personId
                });

                if (!member) {
                    return res.status(404).json({ error: "Member not found" });
                }

                // Fetch all members in same party for comparison
                const partyMembers = await db.collection("member_stats")
                    .find({ parliament, session, caucus_short_name: member.caucus_short_name })
                    .toArray();

                // Compute party averages
                const partyAvgPresence = partyMembers.length > 0 
                    ? (partyMembers.reduce((sum, m) => sum + (m.presence_rate || 0), 0) / partyMembers.length).toFixed(1)
                    : 0;
                const partyAvgActivity = partyMembers.length > 0
                    ? (partyMembers.reduce((sum, m) => sum + (m.activity_index_score || 0), 0) / partyMembers.length).toFixed(2)
                    : 0;

                // Fetch all members in same province for comparison
                const provinceMembers = await db.collection("member_stats")
                    .find({ parliament, session, province: member.province })
                    .toArray();

                const provinceAvgActivity = provinceMembers.length > 0
                    ? (provinceMembers.reduce((sum, m) => sum + (m.activity_index_score || 0), 0) / provinceMembers.length).toFixed(2)
                    : 0;

                // Build response
                res.json({
                    parliament,
                    session,
                    member: {
                        person_id: member.person_id,
                        name: member.name,
                        party: member.party,
                        caucus_short_name: member.caucus_short_name,
                        province: member.province,
                        constituency: member.constituency,
                        // Voting
                        presence_rate: (member.presence_rate || 0).toFixed(1),
                        present: member.present,
                        paired: member.paired,
                        absent: member.absent,
                        total_votes: member.total_votes,
                        presence_rank: member.presence_rate_rank,
                        presence_percentile: member.presence_rate_percentile,
                        presence_percentile_in_party: member.presence_rate_percentile_in_party,
                        // Tenure & background
                        tenure_months: member.tenure_months,
                        years_in_house: member.years_in_house,
                        elections_won: member.elections_won,
                        // Engagement
                        committees_current: member.committees_count,
                        associations_count: member.associations_count,
                        // Activity (from ETL)
                        interventions_count: member.interventions_count,
                        interventions_per_month: (member.interventions_per_month || 0).toFixed(2),
                        committee_interventions_count: member.committee_interventions_count,
                        committee_per_month: (member.committee_per_month || 0).toFixed(2),
                        bills_sponsored_current: member.bills_sponsored_current,
                        // Activity index
                        activity_index_score: (member.activity_index_score || 0).toFixed(2),
                        activity_index_rank: member.activity_index_score_rank,
                        activity_index_percentile: member.activity_index_score_percentile,
                        activity_index_percentile_in_party: member.activity_index_score_percentile_in_party
                    },
                    comparisons: {
                        party: {
                            name: member.caucus_short_name,
                            size: partyMembers.length,
                            avg_presence_rate: parseFloat(partyAvgPresence),
                            avg_activity_index_score: parseFloat(partyAvgActivity),
                            member_above_party_presence: parseFloat((member.presence_rate || 0).toFixed(1)) >= parseFloat(partyAvgPresence),
                            member_above_party_activity: parseFloat((member.activity_index_score || 0).toFixed(2)) >= parseFloat(partyAvgActivity)
                        },
                        province: {
                            name: member.province,
                            size: provinceMembers.length,
                            avg_activity_index_score: parseFloat(provinceAvgActivity),
                            member_above_province_activity: parseFloat((member.activity_index_score || 0).toFixed(2)) >= parseFloat(provinceAvgActivity)
                        }
                    }
                });
            } catch (error) {
                console.error("Error fetching member profile:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // EXPORT: Combined members + member_stats as CSV (one row per member)
        // GET /api/export/members.csv?parliament=45&session=1
        app.get("/api/export/members.csv", async (req, res) => {
            try {
                const { parliament = "45", session = "1" } = req.query;

                // Get all member_stats for the session
                const stats = await db.collection("member_stats").find({ parliament: String(parliament), session: String(session) }).toArray();
                const byPid = new Map(stats.map(s => [String(s.person_id), s]));

                // Fetch members for those person_ids (House only - match member_stats)
                const pids = Array.from(byPid.keys()).map(pid => isNaN(Number(pid)) ? pid : Number(pid));
                const members = await db.collection("members").find({ 
                    person_id: { $in: pids },
                    $or: [
                        { chamber: { $regex: "^house$", $options: "i" } },
                        { chamber: { $exists: false } }  // Default to house if chamber not specified
                    ]
                }).toArray();
                const membersByPid = new Map(members.map(m => [String(m.person_id), m]));

                // Build merged rows (member fields + stats fields)
                const rows = [];
                for (const pid of byPid.keys()) {
                    const m = membersByPid.get(pid) || {};
                    const s = byPid.get(pid) || {};
                    // Merge shallowly; JSON-stringify nested structures to fit CSV cells
                    const merged = {};
                    const assignShallow = (obj) => {
                        for (const [k, v] of Object.entries(obj)) {
                            if (k === "_id") continue; // skip Mongo IDs
                            if (typeof v === 'object' && v !== null) {
                                try { merged[k] = JSON.stringify(v); } catch { merged[k] = String(v); }
                            } else {
                                merged[k] = v;
                            }
                        }
                    };
                    assignShallow(m);
                    assignShallow(s);
                    // Ensure key identifiers
                    merged.person_id = String(pid);
                    merged.parliament = String(parliament);
                    merged.session = String(session);
                    rows.push(merged);
                }

                // Determine CSV headers: prefer a sensible order, then append the rest sorted
                const preferred = [
                    'person_id','name','full_name','party','caucus_short_name','province','constituency',
                    'presence_rate','present','paired','absent','total_votes',
                    'tenure_months','years_in_house','elections_won',
                    'interventions_count','committee_interventions_count','bills_sponsored_current',
                    'committees_count','associations_count',
                    'activity_index_score','activity_index_rank','activity_index_percentile'
                ];
                const allKeys = new Set();
                rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
                const remaining = Array.from(allKeys).filter(k => !preferred.includes(k)).sort();
                const headers = preferred.concat(remaining);

                // CSV encode helper
                const csvEscape = (val) => {
                    if (val === null || val === undefined) return '';
                    const s = typeof val === 'string' ? val : String(val);
                    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                    return s;
                };

                const lines = [];
                lines.push(headers.join(','));
                for (const r of rows) {
                    const line = headers.map(h => csvEscape(r[h])).join(',');
                    lines.push(line);
                }

                const filename = `house_members_data_p${String(parliament)}_s${String(session)}.csv`;
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.status(200).send(lines.join('\n'));
            } catch (error) {
                console.error("Error exporting CSV:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Health check endpoint
        app.get("/health", (req, res) => {
            res.json({ status: "ok", timestamp: new Date().toISOString() });
        });

        // Global error handlers
        process.on("uncaughtException", (err) => {
            console.error("FATAL: Uncaught exception:", err.message);
            console.error(err.stack);
            process.exit(1);
        });

        process.on("unhandledRejection", (reason, promise) => {
            console.error("FATAL: Unhandled rejection at", promise, "reason:", reason);
            process.exit(1);
        });

        app.listen(port, () => console.log(`Dashboard running at http://localhost:${port}`));
    } catch (e) { console.error(e); }
}
main();