const fetch = require("node-fetch");
const { MongoClient } = require("mongodb");

const XBILL_API = "https://xbill.ca/api";
const MONGO_URL = "mongodb://localhost:27017";
const DB_NAME = "xbill";
const LAST_ETL_COLLECTION = "last_etl_datetime";

// Default parliament/session to sync
const PARLIAMENT = process.env.PARLIAMENT || "45";
const SESSION = process.env.SESSION || "1";

let db = null;
let client = null;

async function connectDatabase() {
    try {
        client = new MongoClient(MONGO_URL);
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

        if (!collectionNames.includes("vote_casts")) {
            await db.createCollection("vote_casts");
            console.log("Created 'vote_casts' collection");
        }
        
        if (!collectionNames.includes("sessions")) {
            await db.createCollection("sessions");
            console.log("Created 'sessions' collection");
        }

        if (!collectionNames.includes("bills")) {
            await db.createCollection("bills");
            console.log("Created 'bills' collection");
        }

        if (!collectionNames.includes("interventions")) {
            await db.createCollection("interventions");
            console.log("Created 'interventions' collection");
        }

        if (!collectionNames.includes("committee_interventions")) {
            await db.createCollection("committee_interventions");
            console.log("Created 'committee_interventions' collection");
        }

        // Ensure indexes
        await db.collection("members").createIndex({ person_id: 1 }, { unique: true });
        await db.collection("votes").createIndex({ parliament: 1, session: 1, division_number: 1 }, { unique: true });
        await db.collection("vote_casts").createIndex({ parliament: 1, session: 1, division_number: 1, person_id: 1 }, { unique: true });
        await db.collection("bills").createIndex({ number: 1, parliament: 1, session: 1 }, { unique: true });
        await db.collection("interventions").createIndex({ parliament: 1, session: 1, person_id: 1, intervention_id: 1 }, { unique: true });
        await db.collection("interventions").createIndex({ person_id: 1, parliament: 1, session: 1 });
        await db.collection("committee_interventions").createIndex({ parliament: 1, session: 1, person_id: 1, intervention_id: 1 }, { unique: true });
        await db.collection("committee_interventions").createIndex({ committee_code: 1, parliament: 1, session: 1 });
        
        console.log("ETL connected to MongoDB database: " + DB_NAME);
        return true;
    } catch (error) {
        console.error("Database connection error:", error.message);
        return false;
    }
}

// Helper: sanitize document for $set to avoid conflicts with $setOnInsert
const sanitizeForSet = (obj) => {
    const copy = { ...obj };
    delete copy._id;
    delete copy.created_at;
    delete copy.updated_at;
    return copy;
};

// Helper: sleep with jitter
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: read/write last ETL timestamps
async function getLastSync(key) {
    const doc = await db.collection(LAST_ETL_COLLECTION).findOne({ _id: key });
    return doc && doc.last_sync ? new Date(doc.last_sync) : null;
}

async function setLastSync(key, date = new Date()) {
    await db.collection(LAST_ETL_COLLECTION).updateOne(
        { _id: key },
        { $set: { last_sync: date } },
        { upsert: true }
    );
}

// Helper: safety-adjusted cursor (subtract 5 minutes)
function adjustedSince(lastSync) {
    if (!lastSync) return null;
    return new Date(lastSync.getTime() - 5 * 60 * 1000);
}

// Helper: determine if document changed since cursor
function isAfterTimestamp(doc, since) {
    if (!since) return true;
    if (!doc) return true;
    const d = new Date(doc);
    return d > since;
}

// Helper: safe array normalize
const toArray = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);

// Helper: House-only filter for members
function isHouseMember(member) {
    const chamber = (member.chamber || member.house || member.chamber_name || "").toLowerCase();
    // Default to house when unknown; explicitly exclude senate if present
    return chamber.includes("house") || !chamber.includes("senate");
}

// SYNC: members (with pagination for full metadata)
async function syncMembers() {
    try {
        console.log('\n[ETL] === SYNCING MEMBERS ===');
        const lastSync = await getLastSync("members");
        const since = adjustedSince(lastSync);
        const perPage = 100;
        let offset = 0;
        let totalFetched = 0;
        let upserts = 0;
        let changedCandidates = 0;

        while (true) {
            const url = `${XBILL_API}/members?limit=${perPage}&offset=${offset}&current=true`;
            const response = await fetch(url);
            
            if (response.status === 429) { 
                console.warn("[ETL] Rate limited; backing off 2s"); 
                await sleep(2000); 
                continue; 
            }
            
            if (!response.ok) throw new Error(`xBill API error: ${response.status}`);
            
            const body = await response.json();
            const members = body.members || body.data || [];
            const pagination = body.pagination || {};

            if (!members.length) break;

            const candidates = members.filter((m) => {
                const needsBackfill = (!m.created_at) && m.chamber && m.chamber.toLowerCase() === 'house';
                const updated = m.updated_at || m.created_at;
                return needsBackfill || isAfterTimestamp(updated, since);
            });

            if (!candidates.length) {
                offset += members.length;
                if (!pagination.has_next) break;
                await sleep(200);
                continue;
            }

            changedCandidates += candidates.length;

            for (const m of candidates) {
                // Transform: Convert person_id to string for consistency
                if (typeof m.person_id === 'number') {
                    m.person_id = String(m.person_id);
                }
                
                let fullMemberData = m;
                
                // For House members, fetch individual member details to get mp_roles, committees, etc.
                if (m.chamber && m.chamber.toLowerCase() === 'house') {
                    try {
                        // Add delay before each request to avoid rate limiting
                        await sleep(500);
                        
                        const detailUrl = `${XBILL_API}/members/${m.person_id}`;
                        let retries = 3;
                        let detailResponse;
                        
                        while (retries > 0) {
                            detailResponse = await fetch(detailUrl);
                            
                            if (detailResponse.status === 429) {
                                console.warn(`[ETL] Rate limited on member detail; backing off 3s`);
                                await sleep(3000);
                                retries--;
                                continue;
                            }
                            break;
                        }
                        
                        if (detailResponse && detailResponse.ok) {
                            const detailBody = await detailResponse.json();
                            fullMemberData = detailBody.member || detailBody;
                            // Ensure person_id is string
                            if (typeof fullMemberData.person_id === 'number') {
                                fullMemberData.person_id = String(fullMemberData.person_id);
                            }
                        }
                    } catch (err) {
                        console.warn(`[ETL] Could not fetch full member details for ${m.person_id}: ${err.message}`);
                        // Continue with basic member data
                    }
                }
                
                const mSet = sanitizeForSet(fullMemberData);
                
                // EXCLUDED LONG TEXT FIELDS (not retrieved - kept as placeholders):
                // - short_summary: biographical narrative text (~200-300 chars)
                // - keywords: array of policy/topic keywords (~10-15 items)
                // - summary_data: nested object with key_issues, long_summary, party_discipline, personal_history, political_alignment
                // These are retrieved from xBill API but intentionally excluded from storage.
                delete mSet.short_summary;
                delete mSet.keywords;
                delete mSet.summary_data;
                
                const r = await db.collection("members").updateOne(
                    { person_id: String(fullMemberData.person_id) },
                    { $set: { ...mSet, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
                    { upsert: true }
                );
                if (r.upsertedCount || r.modifiedCount) upserts++;
                totalFetched++;
            }

            if (totalFetched % 100 === 0 && totalFetched > 0) {
                console.log(`[ETL] Synced ${totalFetched} members so far...`);
            }
            offset += members.length;
            if (!pagination.has_next) break;
            await sleep(200);
        }

        if (since) {
            console.log(`[ETL] Members new or updated: ${changedCandidates} since last etl ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Members processed (no cursor): ${changedCandidates}`);
        }
        await setLastSync("members");
        console.log(`[ETL] ✓ Members sync complete: ${totalFetched} fetched, ${upserts} upserted`);
        return { synced: totalFetched, upserts };
    } catch (err) {
        console.error("[ETL] Sync members error:", err.message);
        throw err;
    }
}

// SYNC: votes metadata for a session (paged)
async function syncVotes(parliament, session) {
    try {
        console.log(`\n[ETL] === SYNCING VOTES (${parliament}-${session}) ===`);
        const lastSync = await getLastSync("votes");
        const since = adjustedSince(lastSync);
        const perPage = 100;
        let offset = 0;
        let total = 0, fetched = 0;
        let changedVotesTotal = 0;

        // Ensure session doc
        const sessionId = `${parliament}-${session}`;
        await db.collection("sessions").updateOne(
            { _id: sessionId },
            { $setOnInsert: { _id: sessionId, parliament, session, created_at: new Date() }, $set: { last_sync: new Date() } },
            { upsert: true }
        );

        while (true) {
            const url = `${XBILL_API}/votes?parliament=${parliament}&session=${session}&limit=${perPage}&offset=${offset}&sort=date_asc`;
            const resp = await fetch(url);
            if (resp.status === 429) { 
                console.warn("[ETL] Rate limited; backing off 2s"); 
                await sleep(2000); 
                continue; 
            }
            if (!resp.ok) throw new Error(`xBill API error: ${resp.status}`);
            const body = await resp.json();
            const votes = body.votes || body.results || [];
            const pagination = body.pagination || {};
            total = pagination.total || total;

            if (!votes.length) break;

            const changedVotes = votes.filter(v => {
                const ts = v.updated_at || v.created_at;
                return isAfterTimestamp(ts, since);
            });

            if (!changedVotes.length) {
                offset += votes.length;
                if (!pagination.has_next) break;
                await sleep(200);
                continue;
            }

            changedVotesTotal += changedVotes.length;
            for (const v of changedVotes) {
                const vSet = sanitizeForSet(v);
                await db.collection("votes").updateOne(
                    { parliament: v.parliament, session: v.session, division_number: v.division_number },
                    { $set: { ...vSet, synced_casts: false, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
                    { upsert: true }
                );
                fetched++;
            }

            if (fetched % 20 === 0 && fetched > 0) {
                console.log(`[ETL] Synced ${fetched} votes so far...`);
            }
            offset += votes.length;
            if (!pagination.has_next) break;
            await sleep(200);
        }

        if (since) {
            console.log(`[ETL] Votes new or updated: ${changedVotesTotal} since last etl ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Votes processed (no cursor): ${changedVotesTotal}`);
        }
        await setLastSync("votes");
        // Update session summary
        await db.collection("sessions").updateOne(
            { _id: sessionId },
            { $set: { total_votes: total || fetched, last_sync: new Date() } }
        );

        console.log(`[ETL] ✓ Votes sync complete: ${fetched} fetched`);
        return { parliament, session, total, fetched };
    } catch (err) {
        console.error("[ETL] Sync votes error:", err.message);
        throw err;
    }
}

// SYNC: cast records for votes in a session
async function syncCasts(parliament, session) {
    try {
        console.log(`\n[ETL] === SYNCING VOTE CASTS (${parliament}-${session}) ===`);
        const throttleMs = 100;
        const backoffMs = 2000;
        const lastSync = await getLastSync("vote_casts");
        const since = adjustedSince(lastSync);
        
        const castFilters = [{ synced_casts: { $ne: true } }];
        if (since) {
            castFilters.push({ updated_at: { $gt: since } });
        }

        const votesCursor = db.collection("votes").find({
            parliament: String(parliament),
            session: String(session),
            $or: castFilters
        }).sort({ division_number: 1 });
        
        let processedVotes = 0, newCasts = 0;

        while (await votesCursor.hasNext()) {
            const vote = await votesCursor.next();

            const castExists = await db.collection("vote_casts").findOne({ 
                parliament: String(parliament), 
                session: String(session), 
                division_number: vote.division_number 
            });
            
            if (castExists) { 
                processedVotes++; 
                continue; 
            }

            const url = `${XBILL_API}/votes/${parliament}/${session}/${vote.division_number}/cast`;
            let resp, body, casts;
            
            try {
                resp = await fetch(url);
                if (resp.status === 429) { 
                    console.warn(`[ETL] 429 on division ${vote.division_number}; backing off`); 
                    await sleep(backoffMs); 
                    continue; 
                }
                if (!resp.ok) { 
                    console.warn(`[ETL] Fetch ${resp.status} for division ${vote.division_number}`); 
                    processedVotes++; 
                    continue; 
                }
                body = await resp.json();
                casts = body.votes_cast || body.results || (Array.isArray(body) ? body : []);
            } catch (fetchErr) {
                console.warn(`[ETL] Fetch error on division ${vote.division_number}:`, fetchErr.message);
                processedVotes++;
                continue;
            }

            if (casts.length) {
                try {
                    const bulk = db.collection("vote_casts").initializeUnorderedBulkOp();
                    for (const c of casts) {
                        const cSet = sanitizeForSet(c);
                        bulk.find({ 
                            parliament: String(parliament), 
                            session: String(session), 
                            division_number: vote.division_number, 
                            person_id: c.person_id 
                        })
                        .upsert()
                        .updateOne({ 
                            $set: { 
                                ...cSet, 
                                parliament: String(parliament), 
                                session: String(session), 
                                division_number: vote.division_number, 
                                updated_at: new Date() 
                            }, 
                            $setOnInsert: { created_at: new Date() } 
                        });
                        newCasts++;
                    }
                    await bulk.execute();
                } catch (bulkErr) {
                    console.warn(`[ETL] Bulk update error on division ${vote.division_number}:`, bulkErr.message);
                }
            }

            try {
                await db.collection("votes").updateOne(
                    { 
                        parliament: String(parliament), 
                        session: String(session), 
                        division_number: vote.division_number 
                    },
                    { $set: { synced_casts: true, updated_at: new Date() } }
                );
            } catch (markErr) {
                console.warn(`[ETL] Mark error on division ${vote.division_number}:`, markErr.message);
            }

            processedVotes++;
            if (processedVotes % 10 === 0) {
                console.log(`[ETL] Processed ${processedVotes} votes, ${newCasts} cast records...`);
            }
            await sleep(throttleMs + Math.floor(Math.random() * 100));
        }

        console.log(`[ETL] ✓ Casts sync complete: ${processedVotes} divisions, ${newCasts} cast records`);
        await setLastSync("vote_casts");
        return { processedVotes, newCasts };
    } catch (err) {
        console.error("[ETL] Fatal error in casts sync:", err.message);
        throw err;
    }
}

// SYNC: bills metadata for a session (paged)
async function syncBills(parliament, session) {
    try {
        console.log(`\n[ETL] === SYNCING BILLS (${parliament}-${session}) ===`);
        const sessionCode = `${parliament}-${session}`;
        const perPage = 100;
        let page = 1;
        let total = 0, fetched = 0;
        const lastSync = await getLastSync("bills");
        const since = adjustedSince(lastSync);
        let changedBillsTotal = 0;

        while (true) {
            const url = `${XBILL_API}/bills?session=${sessionCode}&limit=${perPage}&page=${page}`;
            const resp = await fetch(url);
            if (resp.status === 429) { 
                console.warn("[ETL] Rate limited on bills; backing off 2s"); 
                await sleep(2000); 
                continue; 
            }
            if (!resp.ok) throw new Error(`xBill API error: ${resp.status}`);
            const body = await resp.json();
            const bills = body.bills || body.results || [];
            const pagination = body.pagination || {};
            total = pagination.total || total;

            if (!bills.length) break;

            const changedBills = bills.filter(b => {
                const ts = b.updated_at || b.created_at;
                return isAfterTimestamp(ts, since);
            });

            if (!changedBills.length) {
                if (!pagination.has_next) break;
                page++;
                await sleep(200);
                continue;
            }

            changedBillsTotal += changedBills.length;

            for (const bill of changedBills) {
                const billSet = sanitizeForSet(bill);
                await db.collection("bills").updateOne(
                    { number: bill.number, parliament: String(parliament), session: String(session) },
                    { $set: { ...billSet, parliament: String(parliament), session: String(session), updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
                    { upsert: true }
                );
                fetched++;
            }

            if (!pagination.has_next) break;
            page++;
            await sleep(200);
        }

        if (since) {
            console.log(`[ETL] Bills new or updated: ${changedBillsTotal} since last etl ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Bills processed (no cursor): ${changedBillsTotal}`);
        }
        await setLastSync("bills");
        console.log(`[ETL] ✓ Bills sync complete: ${fetched} fetched`);
        return { parliament: String(parliament), session: String(session), session_code: sessionCode, total, fetched };
    } catch (err) {
        console.error("[ETL] Sync bills error:", err.message);
        throw err;
    }
}

// SYNC: house interventions per member, filter to target parliament/session
async function syncInterventions(parliament, session) {
    try {
        console.log(`\n[ETL] === SYNCING INTERVENTIONS (${parliament}-${session}) ===`);
        const throttleMs = 100;
        const backoffMs = 2000;
        const lastSync = await getLastSync("interventions");
        const since = adjustedSince(lastSync);
        if (since) {
            console.log(`[ETL] Interventions: filtering items updated after ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Interventions: no cursor, processing all items`);
        }
        let changedItems = 0;
        let upserts = 0;

        // Load members (house-only if chamber available)
        const members = await db.collection("members").find({}).project({ person_id: 1, chamber: 1 }).toArray();
        let houseMembers = members.filter(isHouseMember);
        let requests = 0;

        for (const m of houseMembers) {
            const pid = String(m.person_id);
            let offset = 0;
            let hasMore = true;
            let memberUpserts = 0;
            
            // Paginate through all interventions for this member
            while (hasMore) {
                const url = `${XBILL_API}/members/${pid}/interventions?limit=100&offset=${offset}`;
                let resp;
                try {
                    resp = await fetch(url);
                    if (resp.status === 429) { 
                        console.warn(`[ETL] 429 interventions for member ${pid}; backoff`);
                        await sleep(backoffMs); 
                        continue; 
                    }
                    if (!resp.ok) {
                        console.warn(`[ETL] Interventions ${resp.status} for member ${pid}`);
                        await sleep(throttleMs);
                        break;
                    }
                    const body = await resp.json();
                    const items = body.interventions || body.results || (Array.isArray(body) ? body : []);
                    const pagination = body.pagination || {};
                    hasMore = pagination.has_more || pagination.has_next || false;
                    
                    if (!items.length) { 
                        hasMore = false;
                        break;
                    }

                    const bulk = db.collection("interventions").initializeUnorderedBulkOp();
                    let pageUpserts = 0;
                    for (const it of items) {
                        const ts = it.updated_at || it.created_at;
                        if (!isAfterTimestamp(ts, since)) continue;
                        changedItems++;
                        // Filter to target parliament/session
                        const pNum = String(it.parliament_number || it.parliament || parliament);
                        const sNum = String(it.session_number || it.session || session);
                        if (pNum !== String(parliament) || sNum !== String(session)) continue;

                        const doc = {
                            parliament: String(parliament),
                            session: String(session),
                            person_id: pid,
                            intervention_id: it.intervention_id || it.id,
                            intervention_time: it.intervention_time ? new Date(it.intervention_time) : null,
                            intervention_type: it.intervention_type || null,
                            subject_of_business: it.subject_of_business || null,
                            publication_title: it.publication_title || null,
                            event_id: it.event_id || null,
                            video_url: it.video_url || null,
                            bill_mentions: toArray(it.bill_mentions).filter(Boolean),
                            hansard_page: it.hansard_page || null,
                            updated_at: new Date(),
                        };

                        const setOnInsert = { created_at: new Date() };
                        bulk.find({ parliament: String(parliament), session: String(session), person_id: pid, intervention_id: doc.intervention_id })
                            .upsert()
                            .updateOne({ $set: doc, $setOnInsert: setOnInsert });
                        pageUpserts++;
                    }
                    if (pageUpserts > 0) {
                        await bulk.execute();
                        upserts += pageUpserts;
                        memberUpserts += pageUpserts;
                    }
                    
                    offset += items.length;
                    await sleep(throttleMs + Math.floor(Math.random() * 100));
                } catch (err) {
                    console.warn(`[ETL] Interventions fetch error for member ${pid}:`, err.message);
                    break;
                }
            }
            
            requests++;
            if (requests % 25 === 0) console.log(`[ETL] Interventions: requested ${requests} members, upserts ${upserts}`);
        }

        console.log(`[ETL] ✓ Interventions sync complete: members requested ${requests}, docs upserted ${upserts}`);
        if (since) {
            console.log(`[ETL] Interventions new or updated: ${changedItems} since last etl ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Interventions processed (no cursor): ${changedItems}`);
        }
        await setLastSync("interventions");
        return { requests, upserts };
    } catch (err) {
        console.error("[ETL] Sync interventions error:", err.message);
        throw err;
    }
}

// SYNC: committee interventions per member, filter to target parliament/session
async function syncCommitteeInterventions(parliament, session) {
    try {
        console.log(`\n[ETL] === SYNCING COMMITTEE INTERVENTIONS (${parliament}-${session}) ===`);
        const throttleMs = 100;
        const backoffMs = 2000;
        const lastSync = await getLastSync("committee_interventions");
        const forceFullBackfill = process.env.COMMITTEE_FULL_BACKFILL === '1';
        const since = forceFullBackfill ? null : adjustedSince(lastSync);
        if (forceFullBackfill) {
            console.log('[ETL] FULL BACKFILL MODE: Ignoring timestamp filter, fetching all committee interventions');
        }
        let changedItems = 0;
        let upserts = 0;

        const members = await db.collection("members").find({}).project({ person_id: 1, chamber: 1 }).toArray();
        let houseMembers = members.filter(isHouseMember);
        let requests = 0;

        for (const m of houseMembers) {
            const pid = String(m.person_id);
            let offset = 0;
            let hasMore = true;
            let memberUpserts = 0;
            
            // Paginate through all committee interventions for this member
            while (hasMore) {
                const url = `${XBILL_API}/committee-interventions/member/${pid}?limit=100&offset=${offset}`;
                let resp;
                try {
                    resp = await fetch(url);
                    if (resp.status === 429) { 
                        console.warn(`[ETL] 429 committee interventions for member ${pid}; backoff`);
                        await sleep(backoffMs); 
                        continue; 
                    }
                    if (!resp.ok) {
                        console.warn(`[ETL] Committee interventions ${resp.status} for member ${pid}`);
                        await sleep(throttleMs);
                        break;
                    }
                    const body = await resp.json();
                    const items = body.interventions || body.results || (Array.isArray(body) ? body : []);
                    const pagination = body.pagination || {};
                    hasMore = pagination.has_more || pagination.has_next || false;
                    
                    if (!items.length) { 
                        hasMore = false;
                        break;
                    }

                    const bulk = db.collection("committee_interventions").initializeUnorderedBulkOp();
                    let pageUpserts = 0;
                    for (const it of items) {
                        const ts = it.updated_at || it.created_at;
                        if (!isAfterTimestamp(ts, since)) continue;
                        changedItems++;
                        // Filter to target parliament/session
                        const pNum = String(it.parliament_number || it.parliament || parliament);
                        const sNum = String(it.session_number || it.session || session);
                        if (pNum !== String(parliament) || sNum !== String(session)) continue;

                        const doc = {
                            parliament: String(parliament),
                            session: String(session),
                            person_id: pid,
                            intervention_id: it.intervention_id || it.id,
                            committee_meeting_id: it.committee_meeting_id || null,
                            committee_code: it.committee_code || null,
                            committee_name: it.committee_name || null,
                            meeting_number: it.meeting_number || null,
                            meeting_date: it.meeting_date ? new Date(it.meeting_date) : null,
                            intervention_time: it.intervention_time ? new Date(it.intervention_time) : null,
                            intervention_type: it.intervention_type || null,
                            subject_of_business: it.subject_of_business || null,
                            is_member: it.is_member === true,
                            affiliation_type: it.affiliation_type || null,
                            person_full_name: it.person_full_name || null,
                            person_constituency: it.person_constituency || null,
                            person_caucus: it.person_caucus || null,
                            person_province: it.person_province || null,
                            sequence_number: it.sequence_number || null,
                            event_id: it.event_id || null,
                            video_url: it.video_url || null,
                            updated_at: new Date(),
                        };

                        const setOnInsert = { created_at: new Date() };
                        bulk.find({ parliament: String(parliament), session: String(session), person_id: pid, intervention_id: doc.intervention_id })
                            .upsert()
                            .updateOne({ $set: doc, $setOnInsert: setOnInsert });
                        pageUpserts++;
                    }
                    if (pageUpserts > 0) {
                        await bulk.execute();
                        upserts += pageUpserts;
                        memberUpserts += pageUpserts;
                    }
                    
                    offset += items.length;
                    await sleep(throttleMs + Math.floor(Math.random() * 100));
                } catch (err) {
                    console.warn(`[ETL] Committee interventions fetch error for member ${pid}:`, err.message);
                    break;
                }
            }
            
            requests++;
            if (requests % 25 === 0) console.log(`[ETL] Committee: requested ${requests} members, upserts ${upserts}`);
        }

        console.log(`[ETL] ✓ Committee interventions sync complete: members requested ${requests}, docs upserted ${upserts}`);
        if (since) {
            console.log(`[ETL] Committee interventions new or updated: ${changedItems} since last etl ${since.toISOString()}`);
        } else {
            console.log(`[ETL] Committee interventions processed (no cursor): ${changedItems}`);
        }
        await setLastSync("committee_interventions");
        return { requests, upserts };
    } catch (err) {
        console.error("[ETL] Sync committee interventions error:", err.message);
        throw err;
    }
}

// Main ETL process
async function main() {
    try {
        console.log(`\n========================================`);
        console.log(`ETL Pipeline for Parliament ${PARLIAMENT} Session ${SESSION}`);
        console.log(`========================================\n`);
        
        const startTime = Date.now();
        
        // Connect to database
        await connectDatabase();

        // Step 1: Sync members
        await syncMembers();

        // Step 2: Sync votes
        await syncVotes(PARLIAMENT, SESSION);

        // Step 3: Sync vote casts
        await syncCasts(PARLIAMENT, SESSION);

        // Step 4: Sync bills
        await syncBills(PARLIAMENT, SESSION);

        // Step 5: Sync interventions (house-only)
        await syncInterventions(PARLIAMENT, SESSION);

        // Step 6: Sync committee interventions (house-only)
        await syncCommitteeInterventions(PARLIAMENT, SESSION);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`\n========================================`);
        console.log(`✓ ETL Complete in ${elapsed}s`);
        console.log(`========================================\n`);
        
        // Close database connection and exit
        await client.close();
        process.exit(0);
        
    } catch (e) { 
        console.error("[ETL] Fatal error:", e);
        if (client) await client.close();
        process.exit(1);
    }
}

main();
