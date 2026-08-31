// Diagnostic: fetch the raw earliest_date values of all papers citing the
// given INSPIRE records and print the largest identical-date piles, monthly
// clusters, and the precision mix. Used to trace phantom spikes in the
// citation-rate view (journal issue dating, batch imports, ...).
//
// Usage: node tests/diagnose-dates.js <recid-recid-...>
// Runs in CI via the diagnose-dates workflow, where the INSPIRE API is
// reachable; respects the API rate limit via a fixed inter-request delay.
const https = require('https');

function getJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'inspire-citation-history-diagnostics'
            }
        }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
                return;
            }
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const recids = (process.argv[2] || '').split('-').filter(x => /^\d+$/.test(x));
    if (recids.length === 0) {
        console.error('usage: node tests/diagnose-dates.js <recid-recid-...>');
        process.exit(1);
    }
    for (const recid of recids) {
        const dates = [];
        let page = 1;
        let total = Infinity;
        while ((page - 1) * 500 < total && page <= 25) {
            const j = await getJson(`https://inspirehep.net/api/literature?q=refersto:recid:${recid}&size=500&page=${page}&fields=earliest_date`);
            total = j.hits.total;
            for (const h of j.hits.hits) {
                dates.push((h.metadata && h.metadata.earliest_date) || '?');
            }
            page++;
            await sleep(400);
        }
        const exact = new Map(), monthly = new Map(), precision = new Map();
        for (const d of dates) {
            exact.set(d, (exact.get(d) || 0) + 1);
            monthly.set(d.slice(0, 7), (monthly.get(d.slice(0, 7)) || 0) + 1);
            const p = d === '?' ? 'missing' : d.length === 4 ? 'year' : d.length === 7 ? 'month' : 'day';
            precision.set(p, (precision.get(p) || 0) + 1);
        }
        const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
        console.log(`=== recid ${recid}: ${dates.length} citing records ===`);
        console.log('precision mix:', JSON.stringify([...precision.entries()]));
        console.log('top identical dates:', JSON.stringify(top(exact, 15)));
        console.log('top months:', JSON.stringify(top(monthly, 15)));
        console.log('all months in order:');
        for (const [m, c] of [...monthly.entries()].sort()) {
            console.log(`  ${m}: ${c}`);
        }
    }
})().catch(e => {
    console.error(e);
    process.exit(1);
});
