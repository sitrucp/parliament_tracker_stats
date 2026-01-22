// Trigger member stats computation after ETL
const fetch = require('node-fetch');

const PARLIAMENT = process.env.PARLIAMENT || '45';
const SESSION = process.env.SESSION || '1';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3002';

async function computeStats() {
    try {
        console.log(`\n=== Computing member stats for Parliament ${PARLIAMENT}, Session ${SESSION} ===\n`);
        
        const url = `${SERVER_URL}/api/compute/session/${PARLIAMENT}/${SESSION}`;
        console.log(`POST ${url}`);
        
        const response = await fetch(url, { method: 'POST' });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('\n✓ Computation complete\n');
        console.log(JSON.stringify(result, null, 2));
        
        process.exit(0);
    } catch (error) {
        console.error('\n✗ Computation failed:', error.message);
        process.exit(1);
    }
}

computeStats();
