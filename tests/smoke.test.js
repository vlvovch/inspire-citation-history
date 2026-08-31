// DOM smoke test: loads the app in headless Chromium with the CDN chart
// libraries replaced by stubs and synthetic citation data injected, then
// checks view switching, dataset construction, URL handling, and the
// identifier parser. Skips cleanly when no Chromium/Chrome is available
// (set CHROME_BIN to point at one explicitly).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function findChrome() {
    const candidates = [];
    if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
    candidates.push('/opt/pw-browsers/chromium');
    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
        const which = spawnSync('which', [name], { encoding: 'utf8' });
        if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());
    }
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch (e) { /* try next */ }
    }
    return null;
}

const chrome = findChrome();
if (!chrome) {
    console.log('SKIP: no Chromium/Chrome found; set CHROME_BIN to run the smoke test');
    process.exit(0);
}

let html = fs.readFileSync(path.join(__dirname, '..', 'inspire-citation-history.html'), 'utf8');

const stubs = `<script>
window.Chart = class {
    constructor(canvas, config) {
        this.canvas = canvas; this.config = config;
        (window.__chartConfigs = window.__chartConfigs || []).push(config);
    }
    destroy() { this.destroyed = true; (window.__chartDestroys = (window.__chartDestroys || 0) + 1); }
};
Chart.defaults = { font: {} };
window.chartXkcd = {
    XY: class { constructor(el, cfg) {
        (window.__xkcdConfigs = window.__xkcdConfigs || []).push(cfg);
        el.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
    } },
    Line: class {},
    config: { positionType: { upLeft: 1 } }
};
</` + `script>`;

// Replace the three CDN chart script tags with the stubs (first one), drop the rest + the FA stylesheet
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js"><\/script>/, stubs);
html = html.replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chartjs-adapter-date-fns@3"><\/script>/, '');
html = html.replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.xkcd@1\.1\.13\/dist\/chart\.xkcd\.min\.js"><\/script>/, '');
html = html.replace(/\s*<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com[^>]*>/, '');

const harness = `<script>
window.__smoke = [];
function smokeLog(name, ok, detail) {
    window.__smoke.push((ok ? 'SMOKE-PASS' : 'SMOKE-FAIL') + ': ' + name + (detail ? ' -- ' + detail : ''));
}
window.addEventListener('error', e => smokeLog('window.onerror: ' + e.message, false));
document.addEventListener('DOMContentLoaded', () => {
    try {
        const mk = (start, n, spanMs) => {
            const out = []; const s = new Date(start).getTime();
            for (let i = 0; i < n; i++) out.push(new Date(s + Math.random() * spanMs).toISOString());
            return out;
        };
        recidData['111'] = { citation_record: { refname: 'Paper A et al., PRL 1, 1 (2019)', date: '2019-02-01',
            citation_dates: mk('2019-02-01', 300, 6.5 * 365 * 24 * 3600e3) } };
        recidData['222'] = { citation_record: { refname: 'Paper B, PRC 2, 2 (2023)', date: '2023-03-01',
            citation_dates: mk('2023-03-01', 120, 3.4 * 365 * 24 * 3600e3) } };

        document.getElementById('show-rate').checked = false;
        updateChart();
        smokeLog('cumulative view renders via chartXkcd', (window.__xkcdConfigs || []).length === 1);
        smokeLog('cumulative: svg shown, canvas hidden',
            document.getElementById('chart').style.display !== 'none' &&
            document.getElementById('rate-chart').style.display === 'none');

        document.getElementById('show-rate').checked = true;
        updateChart();
        const cfgs = window.__chartConfigs || [];
        smokeLog('rate view builds one Chart.js config', cfgs.length === 1, 'got ' + cfgs.length);
        if (cfgs.length) {
            const cfg = cfgs[0];
            const ds = cfg.data.datasets;
            smokeLog('3 datasets per paper (2 papers -> 6)', ds.length === 6, 'got ' + ds.length);
            smokeLog('smooth is the default: no steps, no markers, dense grid',
                ds[0].stepped === false && ds[0].pointRadius === 0 && ds[0].data.length >= 120,
                'stepped=' + ds[0].stepped + ' r=' + ds[0].pointRadius + ' pts=' + ds[0].data.length);
            smokeLog('band pairing hi/lo with fill -1',
                ds[1].label.startsWith('__band_hi') && ds[2].label.startsWith('__band_lo') && ds[2].fill === '-1');
            smokeLog('x scale is time axis in date mode', cfg.options.scales.x.type === 'time');
            const pts = ds[0].data;
            smokeLog('central points carry n/lo/hi with lo<=y<=hi',
                pts.every(p => typeof p.n === 'number' && p.lo <= p.y + 1e-9 && p.y <= p.hi + 1e-9));
            const lf = cfg.options.plugins.legend.labels.filter;
            smokeLog('legend filter hides band labels', lf({ text: '__band_hi_1' }) === false && lf({ text: 'Paper A' }) === true);
            const lbl = cfg.options.plugins.tooltip.callbacks.label({ raw: pts[0], dataset: ds[0] });
            smokeLog('smooth tooltip is terse value +- error', typeof lbl === 'string' && (lbl.indexOf('±') >= 0 || lbl.indexOf('+') >= 0) && !isNaN(parseFloat(lbl)) && lbl.indexOf('citations') < 0 && lbl.indexOf('n_eff') < 0, lbl);
            smokeLog('per-chart annotation plugin registered', Array.isArray(cfg.plugins) && cfg.plugins[0] && cfg.plugins[0].id === 'presentRateLabel');
            smokeLog('right margin reserved for labels', cfg.options.layout && cfg.options.layout.padding && cfg.options.layout.padding.right === 84);
        }
        smokeLog('rate: canvas shown, svg hidden',
            document.getElementById('rate-chart').style.display === 'block' &&
            document.getElementById('chart').style.display === 'none');
        smokeLog('smooth + width selectors shown in rate view',
            document.getElementById('smooth-group').style.display === 'flex' &&
            document.getElementById('bin-width-group').style.display === 'flex');
        smokeLog('width label reads Smoothing in smooth mode',
            document.getElementById('bin-width-label').textContent === 'Smoothing:');
        smokeLog('rateData populated for CSV export', Array.isArray(rateData) && rateData.length === 2 &&
            rateData[0].estimator === 'smooth' && typeof rateData[0].widthMonths === 'number');

        document.getElementById('align-timeline').checked = true;
        updateChart();
        const cfgA = window.__chartConfigs[window.__chartConfigs.length - 1];
        smokeLog('aligned rate uses linear axis', cfgA.options.scales.x.type === 'linear');
        smokeLog('aligned axis in years (Mode 2 via >5y paper)',
            cfgA.options.scales.x.title.text === 'Years since publication', cfgA.options.scales.x.title.text);
        document.getElementById('align-timeline').checked = false;

        // Binned mode: uncheck smooth
        document.getElementById('smooth-rate').checked = false;
        updateChart();
        const cfgS = window.__chartConfigs[window.__chartConfigs.length - 1];
        smokeLog('binned mode: stepped with markers',
            cfgS.data.datasets[0].stepped === 'middle' && cfgS.data.datasets[0].pointRadius === 2.5);
        smokeLog('width label reads Bin width in binned mode',
            document.getElementById('bin-width-label').textContent === 'Bin width:');
        const lblB = cfgS.options.plugins.tooltip.callbacks.label({ raw: cfgS.data.datasets[0].data[0], dataset: cfgS.data.datasets[0] });
        smokeLog('binned tooltip is terse value +- error', (lblB.indexOf('±') >= 0 || lblB.indexOf('+') >= 0) && !isNaN(parseFloat(lblB)) && lblB.indexOf('citations') < 0, lblB);

        document.getElementById('bin-width').value = '12';
        updateChart();
        const cfgB = window.__chartConfigs[window.__chartConfigs.length - 1];
        const nBins = cfgB.data.datasets[0].data.length;
        smokeLog('yearly bin override: paper A has 7-8 bins', nBins >= 7 && nBins <= 8, 'got ' + nBins);
        smokeLog('old rate charts destroyed on rebuild', (window.__chartDestroys || 0) >= 3, 'destroys=' + window.__chartDestroys);

        updateUrl();
        smokeLog('url carries rate=true & bin=12 & smooth=false',
            location.search.indexOf('rate=true') >= 0 && location.search.indexOf('bin=12') >= 0 &&
            location.search.indexOf('smooth=false') >= 0, location.search);

        document.getElementById('smooth-rate').checked = true;
        updateChart();
        const cfgT = window.__chartConfigs[window.__chartConfigs.length - 1];
        smokeLog('smooth mode honors width override as FWHM=12',
            cfgT.data.datasets[0].data.length >= 120 && rateData[0].widthMonths === 12,
            'width=' + rateData[0].widthMonths);
        updateUrl();
        smokeLog('smooth param removed when back to default', location.search.indexOf('smooth=') < 0, location.search);

        document.getElementById('show-rate').checked = false;
        updateChart();
        smokeLog('switch back to cumulative renders again', (window.__xkcdConfigs || []).length === 2);

        // Identifier parser wired into the page
        const pArx = parseRecordIdentifier('arXiv:2208.06843');
        smokeLog('parser: arXiv id', !!pArx && pArx.type === 'arxiv' && pArx.value === '2208.06843');
        const pDoi = parseRecordIdentifier('https://doi.org/10.1103/PhysRevLett.126.092301');
        smokeLog('parser: DOI url', !!pDoi && pDoi.type === 'doi' && pDoi.value === '10.1103/PhysRevLett.126.092301');
        const pRec = parseRecordIdentifier('https://inspirehep.net/literature/2178285');
        smokeLog('parser: INSPIRE url', !!pRec && pRec.type === 'recid' && pRec.value === '2178285');
        smokeLog('parser: garbage rejected', parseRecordIdentifier('hello world') === null);

        // Citation cache wired into the page
        var fakeMap = new Map();
        var fakeStore = {
            getItem: function (k) { return fakeMap.has(k) ? fakeMap.get(k) : null; },
            setItem: function (k, v) { fakeMap.set(k, String(v)); },
            removeItem: function (k) { fakeMap.delete(k); },
            key: function (i) { var ks = Array.from(fakeMap.keys()); return i < ks.length ? ks[i] : null; }
        };
        Object.defineProperty(fakeStore, 'length', { get: function () { return fakeMap.size; } });
        var rec = { recid: 5, date: '2020-01-01', refname: 'R', citation_dates: ['2021-02-03'], total_citations: 1 };
        cacheSave(fakeStore, 5, rec, 1000);
        var hit = cacheLoad(fakeStore, 5, 2000);
        smokeLog('cache roundtrip in page context', !!hit && hit.fresh && hit.record.refname === 'R');
        var stale = cacheLoad(fakeStore, 5, 1000 + CACHE_TTL_MS + 1);
        smokeLog('cache stale detection in page context', !!stale && !stale.fresh);
        smokeLog('cached fetch wrapper defined', typeof citations_for_plot_cached === 'function' && typeof revalidateCachedRecord === 'function');
        updateUrl();
        smokeLog('rate params removed from url', location.search.indexOf('rate=') < 0 && location.search.indexOf('bin=') < 0, location.search);
    } catch (err) {
        smokeLog('EXCEPTION: ' + err.message + ' @ ' + ((err.stack || '').split('\\n')[1] || ''), false);
    }
    const pre = document.createElement('pre');
    pre.id = 'smoke-results';
    pre.textContent = '\\n===SMOKE BEGIN===\\n' + window.__smoke.join('\\n') + '\\n===SMOKE END===\\n';
    document.body.appendChild(pre);
});
</` + `script>`;

html = html.replace('</body>', harness + '\n</body>');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ich-smoke-'));
const smokePath = path.join(tmpDir, 'smoke.html');
fs.writeFileSync(smokePath, html);

const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=8000', '--dump-dom', 'file://' + smokePath
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

// The harness source inside <script> also contains the marker strings, so
// take the LAST marker block: the results <pre> appended at the end of body
const blocks = [...dom.matchAll(/===SMOKE BEGIN===([\s\S]*?)===SMOKE END===/g)];
if (blocks.length === 0) {
    console.error('FAIL: smoke results not found in the DOM dump (page script error?)');
    process.exit(1);
}
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const lines = blocks[blocks.length - 1][1].split('\n').map(decode).filter(l => l.startsWith('SMOKE-'));
lines.forEach(l => console.log(l));
const fails = lines.filter(l => l.startsWith('SMOKE-FAIL')).length;
if (lines.length === 0) {
    console.error('\nFAIL: results block contained no smoke checks');
    process.exit(1);
}
console.log(fails === 0 ? `\nALL ${lines.length} SMOKE CHECKS PASSED (${path.basename(chrome)})` : `\n${fails} SMOKE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
