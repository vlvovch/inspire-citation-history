// Validation for the citation-rate estimator in inspire-citation-history.html
// 1. Syntax-checks the whole inline <script> block.
// 2. Extracts the pure math functions and tests them (values + Monte Carlo coverage).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'inspire-citation-history.html'), 'utf8');

// --- 1. Syntax check of the full inline script ---
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: could not find inline <script>'); process.exit(1); }
const scriptBody = scriptMatch[1];
try {
    new vm.Script(scriptBody, { filename: 'inline-script.js' });
    console.log('PASS: inline script parses cleanly (' + scriptBody.length + ' chars)');
} catch (e) {
    console.error('FAIL: syntax error in inline script:', e.message);
    process.exit(1);
}

// --- 2. Extract the rate-estimation section and eval it ---
const sectionStart = scriptBody.indexOf('// CITATION RATE ESTIMATION');
const sectionEnd = scriptBody.indexOf('// CHART UPDATING');
if (sectionStart < 0 || sectionEnd < 0 || sectionEnd <= sectionStart) {
    console.error('FAIL: could not locate rate estimation section');
    process.exit(1);
}
const pluginStart = scriptBody.indexOf('// Present-rate annotation');
const pluginEnd = scriptBody.indexOf('// Render the citation-rate view');
if (pluginStart < 0 || pluginEnd < 0 || pluginEnd <= pluginStart) {
    console.error('FAIL: could not locate annotation plugin section');
    process.exit(1);
}
const backoffStart = scriptBody.indexOf('function computeBackoffDelayMs');
const backoffEnd = scriptBody.indexOf('async function inspireFetch');
if (backoffStart < 0 || backoffEnd < 0 || backoffEnd <= backoffStart) {
    console.error('FAIL: could not locate backoff helper');
    process.exit(1);
}
const spreadStart = scriptBody.indexOf('function spreadImpreciseDates');
const spreadEnd = scriptBody.indexOf('// Get citation data for plotting');
if (spreadStart < 0 || spreadEnd < 0 || spreadEnd <= spreadStart) {
    console.error('FAIL: could not locate spreadImpreciseDates');
    process.exit(1);
}
const cacheStart = scriptBody.indexOf('const CACHE_PREFIX');
const cacheEnd = scriptBody.indexOf('// Cache-aware wrapper');
if (cacheStart < 0 || cacheEnd < 0 || cacheEnd <= cacheStart) {
    console.error('FAIL: could not locate cache helpers');
    process.exit(1);
}
const idStart = scriptBody.indexOf('function parseRecordIdentifier');
const idEnd = scriptBody.indexOf('async function resolveIdentifierToRecid');
if (idStart < 0 || idEnd < 0 || idEnd <= idStart) {
    console.error('FAIL: could not locate identifier parser');
    process.exit(1);
}
const section = scriptBody.slice(sectionStart, sectionEnd)
    .replace(/^\s*\/\/ -+\s*$/gm, '') + '\n' + scriptBody.slice(pluginStart, pluginEnd)
    + '\n' + scriptBody.slice(idStart, idEnd) + '\n' + scriptBody.slice(backoffStart, backoffEnd)
    + '\n' + scriptBody.slice(cacheStart, cacheEnd) + '\n' + scriptBody.slice(spreadStart, spreadEnd);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(section + '\nthis.poissonInterval68 = poissonInterval68; this.chooseBinWidthMonths = chooseBinWidthMonths; this.computeRateSeries = computeRateSeries; this.hexToRgba = hexToRgba; this.erf = erf; this.normCdf = normCdf; this.computeSmoothRateSeries = computeSmoothRateSeries; this.presentRateLabelPlugin = presentRateLabelPlugin; this.parseRecordIdentifier = parseRecordIdentifier; this.computeBackoffDelayMs = computeBackoffDelayMs; this.cacheLoad = cacheLoad; this.cacheSave = cacheSave; this.cacheEvictOldest = cacheEvictOldest; this.cacheKeys = cacheKeys; this.safeLocalStorage = safeLocalStorage; this.CACHE_PREFIX = CACHE_PREFIX; this.CACHE_TTL_MS = CACHE_TTL_MS; this.CACHE_MAX_ENTRIES = CACHE_MAX_ENTRIES; this.bayesianBlocksEdges = bayesianBlocksEdges; this.computeBlocksRateSeries = computeBlocksRateSeries; this.BLOCKS_P0 = BLOCKS_P0; this.spreadImpreciseDates = spreadImpreciseDates; this.cacheRemoveOldVersions = cacheRemoveOldVersions; this.normInv = normInv; this.wsbProfile = wsbProfile; this.wsbFitCore = wsbFitCore; this.wsbFit = wsbFit; this.wsbSimulate = wsbSimulate; this.wsbBootstrap = wsbBootstrap; this.wsbRateCurve = wsbRateCurve; this.formatCitationCount = formatCitationCount; this.WSB_M = WSB_M; this.WSB_MIN_MONTHS = WSB_MIN_MONTHS; this.WSB_MIN_CITATIONS = WSB_MIN_CITATIONS; this.wsbCumulativeCurve = wsbCumulativeCurve;', sandbox);
const { poissonInterval68, chooseBinWidthMonths, computeRateSeries, hexToRgba, erf, normCdf, computeSmoothRateSeries, presentRateLabelPlugin, parseRecordIdentifier, computeBackoffDelayMs, cacheLoad, cacheSave, cacheEvictOldest, cacheKeys, safeLocalStorage, CACHE_PREFIX, CACHE_TTL_MS, CACHE_MAX_ENTRIES, bayesianBlocksEdges, computeBlocksRateSeries, BLOCKS_P0, spreadImpreciseDates, cacheRemoveOldVersions, normInv, wsbProfile, wsbFitCore, wsbFit, wsbSimulate, wsbBootstrap, wsbRateCurve, formatCitationCount, WSB_M, WSB_MIN_MONTHS, WSB_MIN_CITATIONS, wsbCumulativeCurve } = sandbox;

// Deterministic PRNG (mulberry32) so stochastic checks are reproducible
let __seed = 0xC0FFEE;
Math.random = function () {
    __seed |= 0; __seed = (__seed + 0x6D2B79F5) | 0;
    let t = Math.imul(__seed ^ (__seed >>> 15), 1 | __seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// The extracted code runs in its own vm context with its own Math object;
// point it at the same deterministic PRNG so wsbSimulate/bootstrap are seeded
sandbox.__outerRnd = Math.random;
vm.runInContext('Math.random = __outerRnd;', sandbox);

let failures = 0;
function check(name, cond, detail) {
    if (cond) { console.log('PASS: ' + name); }
    else { console.error('FAIL: ' + name + (detail ? ' — ' + detail : '')); failures++; }
}

// --- Interval values vs exact Garwood (precomputed with scipy-equivalent chi2 quantiles) ---
// Exact 68.27% central (Garwood): n=0 -> [0, 1.841]; n=1 -> [0.1727, 3.300]; n=10 -> [6.891, 14.267]; n=100 -> [90.11, 110.98]
const cases = [
    [0, 0, 1.841],
    [1, 0.1727, 3.300],
    [10, 6.891, 14.267],
    [100, 90.11, 110.98],
];
for (const [n, exLo, exHi] of cases) {
    const [lo, hi] = poissonInterval68(n);
    const tolLo = Math.max(0.06, 0.02 * Math.max(exLo, 1));
    const tolHi = Math.max(0.06, 0.02 * exHi);
    check(`interval n=${n} lower ~ ${exLo} (got ${lo.toFixed(3)})`, Math.abs(lo - exLo) < tolLo);
    check(`interval n=${n} upper ~ ${exHi} (got ${hi.toFixed(3)})`, Math.abs(hi - exHi) < tolHi);
}
check('interval monotone in n', poissonInterval68(5)[0] < poissonInterval68(6)[0] && poissonInterval68(5)[1] < poissonInterval68(6)[1]);

// --- Monte Carlo: homogeneous Poisson coverage of the 68% interval ---
// lambda*Delta = 12 per bin, 4000 bins: empirical coverage should be ~0.6827
function poissonSample(mean) {
    // Knuth for small mean
    const L = Math.exp(-mean); let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
}
let covered = 0; const trials = 4000; const mean = 12;
for (let t = 0; t < trials; t++) {
    const n = poissonSample(mean);
    const [lo, hi] = poissonInterval68(n);
    if (mean >= lo && mean <= hi) covered++;
}
const cov = covered / trials;
check(`MC coverage at mean=12 in [0.63, 0.74] (got ${cov.toFixed(3)})`, cov > 0.63 && cov < 0.74);

// --- Bin width chooser sanity ---
check('young hot paper -> monthly', chooseBinWidthMonths(600, 6) === 1, 'got ' + chooseBinWidthMonths(600, 6));
check('20y paper N=2000 -> quarterly-ish', [2, 3].includes(chooseBinWidthMonths(2000, 240)), 'got ' + chooseBinWidthMonths(2000, 240));
check('low-N paper -> coarse bins', chooseBinWidthMonths(40, 60) >= 12, 'got ' + chooseBinWidthMonths(40, 60));

// --- computeRateSeries: synthetic constant-rate process ---
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 365.25 / 12;
const pub = new Date('2020-01-15T00:00:00Z');
const nowMs = pub.getTime() + 48 * MS_PER_MONTH; // exactly 48 months of history
const trueRate = 10; // citations per month
const dates = [];
{ // homogeneous Poisson arrivals via exponential gaps
    let t = pub.getTime();
    for (;;) {
        t += -Math.log(1 - Math.random()) / trueRate * MS_PER_MONTH;
        if (t > nowMs) break;
        dates.push(new Date(t).toISOString());
    }
}
const record = { date: pub.toISOString(), citation_dates: dates };
const series = computeRateSeries(record, 0, 0, nowMs);
const totalN = series.points.reduce((s, p) => s + p.n, 0);
check(`bin counts sum to N (${totalN} vs ${dates.length})`, totalN === dates.length);
check('auto bin width is monthly for this density', series.binMonths === 1, 'got ' + series.binMonths);
check('number of bins = 48', series.points.length === 48, 'got ' + series.points.length);
const meanRate = series.points.reduce((s, p) => s + p.y, 0) / series.points.length;
check(`mean estimated rate ~ ${12 * trueRate}/yr (got ${meanRate.toFixed(2)})`, Math.abs(meanRate - 12 * trueRate) < 12.0);
const inBand = series.points.filter(p => 12 * trueRate >= p.lo && 12 * trueRate <= p.hi).length / series.points.length;
check(`per-bin 68% band coverage in [0.5, 0.85] (got ${inBand.toFixed(2)})`, inBand >= 0.5 && inBand <= 0.85);
check('exactly one partial (current) bin, at the end',
    series.points.filter(p => p.partial).length === 1 && series.points[series.points.length - 1].partial);
check('x values are Dates in Mode 0', series.points.every(p => Object.prototype.toString.call(p.x) === '[object Date]'));
check('x is increasing', series.points.every((p, i, a) => i === 0 || p.x > a[i - 1].x));

// --- Partial-bin normalization: 10.5-month span, monthly bins -> last bin width 0.5 ---
const nowMs2 = pub.getTime() + 10.5 * MS_PER_MONTH;
const record2 = {
    date: pub.toISOString(),
    citation_dates: Array.from({ length: 200 }, (_, i) => new Date(pub.getTime() + (i / 200) * 10.5 * MS_PER_MONTH).toISOString())
};
const series2 = computeRateSeries(record2, 0, 1, nowMs2);
check('partial-bin span: 11 bins', series2.points.length === 11, 'got ' + series2.points.length);
const lastP = series2.points[series2.points.length - 1];
// uniform 200 over 10.5 months -> ~19.05/month everywhere incl. the half-width last bin
check(`last (half-width) bin rate ~ 229/yr (got ${lastP.y.toFixed(1)})`, Math.abs(lastP.y - 12 * 200 / 10.5) < 54);

// --- Degenerate final sliver (regression: paper aged an exact multiple of the bin width) ---
check('sliver folded: span 48.001 months, monthly bins -> 48 bins, sane errors', (() => {
    const nowE = pub.getTime() + 48.001 * MS_PER_MONTH;
    const s = computeRateSeries({ date: pub.toISOString(), citation_dates: dates }, 0, 1, nowE);
    const last = s.points[s.points.length - 1];
    return s.points.length === 48 && last.hi < 300;
})());
check('sliver folded: span 48 months + 1 ms, yearly bins -> 4 bins', (() => {
    const nowE = pub.getTime() + 48 * MS_PER_MONTH + 1;
    const s = computeRateSeries({ date: pub.toISOString(), citation_dates: dates }, 0, 12, nowE);
    return s.points.length === 4 && s.points[3].hi < 400 && s.points[3].y > 0;
})());
check('half-width final bin still kept (10.5 months, monthly)', (() => {
    const s = computeRateSeries(record2, 0, 1, nowMs2);
    return s.points.length === 11;
})());

// --- Aligned modes ---
const seriesM1 = computeRateSeries(record, 1, 0, nowMs);
check('Mode 1 x in months (max ~47.5)', typeof seriesM1.points[0].x === 'number' && Math.abs(seriesM1.points[seriesM1.points.length - 1].x - 47.5) < 0.6);
const seriesM2 = computeRateSeries(record, 2, 0, nowMs);
check('Mode 2 x in years (max ~3.96)', Math.abs(seriesM2.points[seriesM2.points.length - 1].x - 47.5 / 12) < 0.05);

// --- Edge cases ---
check('empty citations -> all-zero bins with bands', (() => {
    const s = computeRateSeries({ date: pub.toISOString(), citation_dates: [] }, 0, 0, nowMs);
    return s.points.length > 0 && s.points.every(p => p.y === 0 && p.lo === 0 && p.hi > 0);
})());
check('pre-publication citation clamped into first bin', (() => {
    const s = computeRateSeries({ date: pub.toISOString(), citation_dates: ['2019-06-01'] }, 0, 12, nowMs);
    return s.points[0].n === 1;
})());
check('future/undated record -> empty series', computeRateSeries({ date: new Date(nowMs + 1e9).toISOString(), citation_dates: [] }, 0, 0, nowMs).points.length === 0);
check('invalid date strings skipped', (() => {
    const s = computeRateSeries({ date: pub.toISOString(), citation_dates: ['not-a-date', '2021-01-01'] }, 0, 12, nowMs);
    return s.points.reduce((a, p) => a + p.n, 0) === 1;
})());
check('hexToRgba', hexToRgba('#e41a1c', 0.18) === 'rgba(228, 26, 28, 0.18)');

// --- Smooth estimator: erf / normCdf accuracy ---
check('erf(0) ~ 0 within A&S accuracy', Math.abs(erf(0)) < 1.5e-7);
check('erf(1) ~ 0.8427008', Math.abs(erf(1) - 0.8427008) < 5e-7);
check('erf antisymmetric', Math.abs(erf(-1.3) + erf(1.3)) < 1e-12);
check('normCdf(1.959964) ~ 0.975', Math.abs(normCdf(1.959964) - 0.975) < 1e-4);
check('poissonInterval68 fractional n stays sane', (() => {
    const [lo, hi] = poissonInterval68(0.3);
    return lo >= 0 && hi > lo && hi < 4;
})());

// --- Smooth estimator on the homogeneous record (trueRate=10, 48 months) ---
const smooth = computeSmoothRateSeries(record, 0, 0, nowMs);
check('smooth auto FWHM = max(2*autoBin, 6) = 6', smooth.widthMonths === 6, 'got ' + smooth.widthMonths);
check('smooth grid has >= 120 points', smooth.points.length >= 120, 'got ' + smooth.points.length);
check('smooth x increasing Dates', smooth.points.every((p, i, a) =>
    Object.prototype.toString.call(p.x) === '[object Date]' && (i === 0 || p.x > a[i - 1].x)));
check('smooth lo<=y<=hi everywhere', smooth.points.every(p => p.lo <= p.y + 1e-9 && p.y <= p.hi + 1e-9));
const midPts = smooth.points.filter((_, i) => i > smooth.points.length / 3 && i < 2 * smooth.points.length / 3);
const midMean = midPts.reduce((s, p) => s + p.y, 0) / midPts.length;
check(`smooth central mean ~ ${12 * trueRate}/yr (got ${midMean.toFixed(2)})`, Math.abs(midMean - 12 * trueRate) < 14.4);
// interior effective exposure: E0 = n_eff / y should be ~ 2*sqrt(pi)*h
const h6 = 6 / 2.3548;
const midP = smooth.points[Math.floor(smooth.points.length / 2)];
const e0Mid = midP.n / (midP.y / 12); // y is per-year, exposure in months
check(`interior E0 ~ 2*sqrt(pi)*h = ${(2 * Math.sqrt(Math.PI) * h6).toFixed(2)} (got ${e0Mid.toFixed(2)})`,
    Math.abs(e0Mid - 2 * Math.sqrt(Math.PI) * h6) < 0.4);
// boundary: effective exposure halves at the edge -> band ~sqrt(2) wider
const edgeP = smooth.points[0];
const e0Edge = edgeP.y > 0 ? edgeP.n / (edgeP.y / 12) : NaN;
check(`edge E0 / interior E0 ~ 0.5 (got ${(e0Edge / e0Mid).toFixed(2)})`,
    e0Edge / e0Mid > 0.4 && e0Edge / e0Mid < 0.62);
check('smooth provisional tail: contiguous at end, roughly last sigma', (() => {
    const flags = smooth.points.map(p => p.partial);
    const firstPartial = flags.indexOf(true);
    if (firstPartial < 0) return false;
    if (!flags.slice(firstPartial).every(f => f)) return false;
    const frac = (smooth.points.length - firstPartial) / smooth.points.length;
    return frac > 0.02 && frac < 0.12; // sigma/span = 2.55/48 ~ 0.053
})());
check('smooth FWHM override respected', computeSmoothRateSeries(record, 0, 12, nowMs).widthMonths === 12);
check('smooth Mode 1 x in months (max ~ 48)', (() => {
    const s = computeSmoothRateSeries(record, 1, 0, nowMs);
    const last = s.points[s.points.length - 1].x;
    return typeof last === 'number' && Math.abs(last - 48) < 0.5;
})());
check('smooth Mode 2 x in years (max ~ 4)', (() => {
    const s = computeSmoothRateSeries(record, 2, 0, nowMs);
    return Math.abs(s.points[s.points.length - 1].x - 4) < 0.05;
})());
check('smooth empty record: zero rate, positive upper limit', (() => {
    const s = computeSmoothRateSeries({ date: pub.toISOString(), citation_dates: [] }, 0, 0, nowMs);
    return s.points.length > 0 && s.points.every(p => p.y === 0 && p.lo === 0 && p.hi > 0);
})());

// --- Monte Carlo coverage of the smooth 68% band at a fixed interior time ---
{
    const mcSpan = 36, mcRate = 8, mcNow = pub.getTime() + mcSpan * MS_PER_MONTH;
    let hit = 0; const reps = 300;
    for (let r = 0; r < reps; r++) {
        const ds = [];
        let t = pub.getTime();
        for (;;) {
            t += -Math.log(1 - Math.random()) / mcRate * MS_PER_MONTH;
            if (t > mcNow) break;
            ds.push(new Date(t).toISOString());
        }
        const s = computeSmoothRateSeries({ date: pub.toISOString(), citation_dates: ds }, 0, 6, mcNow);
        const p = s.points[Math.floor(s.points.length / 2)]; // t ~ 18 months
        if (12 * mcRate >= p.lo && 12 * mcRate <= p.hi) hit++;
    }
    const covS = hit / reps;
    check(`smooth MC coverage at interior point in [0.56, 0.80] (got ${covS.toFixed(3)})`, covS > 0.56 && covS < 0.80);
}

// --- Present-rate annotation plugin: mock chart, record fillText calls ---
{
    const texts = [];
    const mockChart = {
        ctx: {
            save() {}, restore() {},
            set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}, set fillStyle(v) { this._fs = v; },
            fillText(t, x, y) { texts.push({ t, x, y, color: this._fs }); }
        },
        chartArea: { top: 10, bottom: 400, right: 700 },
        scales: { y: { getPixelForValue: (v) => 400 - v } },
        isDatasetVisible: () => true,
        data: { datasets: [
            { label: 'Paper A', borderColor: '#e41a1c', data: [{ y: 55.4, lo: 47.1, hi: 63.2 }] },
            { label: '__band_hi_1', data: [{ y: 63.2 }] },
            { label: '__band_lo_1', data: [{ y: 47.1 }] },
            { label: 'Paper B', borderColor: '#377eb8', data: [{ y: 52.0, lo: 44.0, hi: 60.0 }] },
            { label: '__band_hi_2', data: [] },
            { label: '__band_lo_2', data: [] }
        ] }
    };
    presentRateLabelPlugin.afterDatasetsDraw(mockChart);
    check('plugin draws one label per visible paper (2)', texts.length === 2, 'got ' + texts.length);
    check('plugin label format value ± halfwidth', texts.some(a => a.t === '55 ± 8'), JSON.stringify(texts.map(a => a.t)));
    check('plugin labels placed right of the plot area', texts.every(a => a.x === 706));
    check('plugin labels vertically separated >= 13px', (() => {
        const ys = texts.map(a => a.y).sort((a, b) => a - b);
        return ys.length === 2 && ys[1] - ys[0] >= 13;
    })(), JSON.stringify(texts.map(a => a.y)));
    check('plugin labels use series colors', texts.every(a => a.color === '#e41a1c' || a.color === '#377eb8'));
    check('plugin no-ops on empty datasets', (() => {
        const t2 = [];
        const mc = { ...mockChart, ctx: { ...mockChart.ctx, fillText: (t) => t2.push(t) },
            data: { datasets: [{ label: '__band_hi_1', data: [{ y: 1 }] }] } };
        presentRateLabelPlugin.afterDatasetsDraw(mc);
        return t2.length === 0;
    })());
    check('plugin low-rate label keeps one decimal', (() => {
        const t3 = [];
        const mc = { ...mockChart, ctx: { save() {}, restore() {}, set fillStyle(v) {}, fillText: (t) => t3.push(t) },
            data: { datasets: [{ label: 'P', borderColor: '#000', data: [{ y: 2.34, lo: 1.1, hi: 3.9 }] }] } };
        presentRateLabelPlugin.afterDatasetsDraw(mc);
        return t3.length === 1 && t3[0] === '2.3 \u00b1 1.4';
    })());
}

// --- Record identifier parser ---
const idCases = [
    ['2178285', 'recid', '2178285'],
    ['  2178285 ', 'recid', '2178285'],
    ['https://inspirehep.net/literature/2178285', 'recid', '2178285'],
    ['https://inspirehep.net/api/literature/2178285', 'recid', '2178285'],
    ['2208.06843', 'arxiv', '2208.06843'],
    ['2208.06843v2', 'arxiv', '2208.06843'],
    ['arXiv:2208.06843', 'arxiv', '2208.06843'],
    ['arxiv: 2208.06843', 'arxiv', '2208.06843'],
    ['https://arxiv.org/abs/2208.06843', 'arxiv', '2208.06843'],
    ['https://arxiv.org/abs/2208.06843v1', 'arxiv', '2208.06843'],
    ['https://arxiv.org/pdf/2208.06843.pdf', 'arxiv', '2208.06843'],
    ['hep-ph/9803241', 'arxiv', 'hep-ph/9803241'],
    ['arXiv:hep-ph/9803241', 'arxiv', 'hep-ph/9803241'],
    ['cond-mat.str-el/0407066', 'arxiv', 'cond-mat.str-el/0407066'],
    ['https://arxiv.org/abs/hep-ph/9803241', 'arxiv', 'hep-ph/9803241'],
    ['10.1103/PhysRevLett.126.092301', 'doi', '10.1103/PhysRevLett.126.092301'],
    ['doi:10.1103/PhysRevLett.126.092301', 'doi', '10.1103/PhysRevLett.126.092301'],
    ['https://doi.org/10.1103/PhysRevLett.126.092301', 'doi', '10.1103/PhysRevLett.126.092301'],
    ['https://dx.doi.org/10.1016/j.physletb.2022.137368', 'doi', '10.1016/j.physletb.2022.137368'],
];
for (const [input, type, val] of idCases) {
    const r = parseRecordIdentifier(input);
    check(`parse ${JSON.stringify(input)} -> ${type}:${val}`, r && r.type === type && r.value === val,
        'got ' + JSON.stringify(r));
}
for (const bad of ['', '   ', 'hello world', '10.notadoi', 'abs/1234', 'v2208.06843', 'hep-ph/12345']) {
    check(`reject ${JSON.stringify(bad)}`, parseRecordIdentifier(bad) === null,
        'got ' + JSON.stringify(parseRecordIdentifier(bad)));
}

// --- Retry backoff delays ---
check('backoff attempt 0 -> 2s', computeBackoffDelayMs(0, null) === 2000);
check('backoff attempt 1 -> 4s', computeBackoffDelayMs(1, null) === 4000);
check('backoff attempt 3 -> 16s', computeBackoffDelayMs(3, null) === 16000);
check('backoff capped at 30s', computeBackoffDelayMs(10, null) === 30000);
check('numeric Retry-After honored', computeBackoffDelayMs(0, '7') === 7000);
check('date-form Retry-After ignored', computeBackoffDelayMs(2, 'Wed, 21 Oct 2026 07:28:00 GMT') === 8000);
check('absurd Retry-After ignored', computeBackoffDelayMs(0, '9999') === 2000);
check('zero Retry-After ignored', computeBackoffDelayMs(1, '0') === 4000);

// --- localStorage citation cache ---
function makeFakeStorage(maxEntries) {
    const map = new Map();
    return {
        get length() { return map.size; },
        key: (i) => Array.from(map.keys())[i] !== undefined ? Array.from(map.keys())[i] : null,
        getItem: (k) => map.has(k) ? map.get(k) : null,
        setItem: (k, v) => {
            if (maxEntries && !map.has(k) && map.size >= maxEntries) {
                throw new Error('QuotaExceededError');
            }
            map.set(k, String(v));
        },
        removeItem: (k) => { map.delete(k); }
    };
}
const sampleRecord = { recid: 42, date: '2020-01-01', refname: 'X et al.', citation_dates: ['2021-01-01'], total_citations: 1 };
{
    const st = makeFakeStorage();
    cacheSave(st, 42, sampleRecord, 1000);
    const hit = cacheLoad(st, 42, 2000);
    check('cache roundtrip fresh', !!hit && hit.fresh && hit.record.refname === 'X et al.' && hit.record.citation_dates.length === 1);
    const stale = cacheLoad(st, 42, 1000 + CACHE_TTL_MS + 1);
    check('cache stale after TTL', !!stale && !stale.fresh);
    check('cache miss returns null', cacheLoad(st, 99, 2000) === null);
    const future = cacheLoad(st, 42, 0); // savedAt in the future -> not fresh
    check('future savedAt treated as stale', !!future && !future.fresh);
}
{
    const st = makeFakeStorage();
    st.setItem(CACHE_PREFIX + '7', 'not json{');
    check('corrupt entry -> null and removed', cacheLoad(st, 7, 1000) === null && st.getItem(CACHE_PREFIX + '7') === null);
    st.setItem(CACHE_PREFIX + '8', JSON.stringify({ savedAt: 1, record: { citation_dates: 'nope' } }));
    check('malformed record -> null and removed', cacheLoad(st, 8, 1000) === null && st.getItem(CACHE_PREFIX + '8') === null);
}
{
    // Quota: capacity 3; oldest evicted to make room, newest survives
    const st = makeFakeStorage(3);
    cacheSave(st, 1, sampleRecord, 1000);
    cacheSave(st, 2, sampleRecord, 2000);
    cacheSave(st, 3, sampleRecord, 3000);
    cacheSave(st, 4, sampleRecord, 4000);
    check('quota eviction keeps newest', cacheLoad(st, 4, 4000) !== null, 'len=' + st.length);
    check('quota eviction removed oldest', cacheLoad(st, 1, 4000) === null);
}
{
    // Entry cap: never more than CACHE_MAX_ENTRIES cache keys
    const st = makeFakeStorage();
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i++) cacheSave(st, i, sampleRecord, 1000 + i);
    check('entry cap enforced', cacheKeys(st).length === CACHE_MAX_ENTRIES, 'got ' + cacheKeys(st).length);
    check('cap evicts oldest first', cacheLoad(st, 0, 2000) === null && cacheLoad(st, CACHE_MAX_ENTRIES + 4, 2000) !== null);
}
{
    // Foreign keys are never touched
    const st = makeFakeStorage();
    st.setItem('user-setting', 'keep-me');
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i++) cacheSave(st, i, sampleRecord, 1000 + i);
    cacheEvictOldest(st, 1000);
    check('foreign keys untouched by eviction', st.getItem('user-setting') === 'keep-me' && cacheKeys(st).length === 0);
}
check('safeLocalStorage null outside the browser', safeLocalStorage() === null);

// --- Bayesian blocks ---
function blockCount(series) { return series.points.filter(p => !p.dup).length; }
function blockEdgesFromSeries(series) { // Mode 1 -> numeric months
    const e = series.points.filter(p => !p.dup).map(p => (p.trueX !== undefined ? p.trueX : p.x));
    e.push(series.points[series.points.length - 1].x);
    return e;
}
function blockStarts(series) { return series.points.filter(p => !p.dup); }
{
    const s = computeBlocksRateSeries(record, 1, BLOCKS_P0, nowMs);
    const starts = blockStarts(s);
    const nTot = starts.reduce((a, p) => a + p.n, 0);
    check('blocks: counts sum to N', nTot === dates.length, nTot + ' vs ' + dates.length);
    check('blocks: constant rate -> 1-2 blocks', blockCount(s) >= 1 && blockCount(s) <= 2, 'got ' + blockCount(s));
    const wmean = starts.reduce((a, p) => a + p.y * p.w, 0) / starts.reduce((a, p) => a + p.w, 0);
    check(`blocks: width-weighted mean rate = 12N/T (${(12 * dates.length / 48).toFixed(1)})`,
        Math.abs(wmean - 12 * dates.length / 48) < 1.5, 'got ' + wmean.toFixed(1));
    check('blocks: spans [0, T]', Math.abs(s.points[0].x) < 1e-9 && Math.abs(s.points[s.points.length - 1].x - 48) < 1e-6);
    check('blocks: dup points mirror their block values', s.points.every((p, i, a) =>
        !p.dup || (p.y === a[i - 1].y && p.n === a[i - 1].n)));
    check('blocks: provisional dash confined to a short suffix', (() => {
        const f = s.points.findIndex(p => p.partial);
        if (f < 0) return false;
        if (!s.points.slice(f).every(p => p.partial)) return false;
        if (s.points.length - f > 2) return false;
        const anchor = f > 0 ? s.points[f - 1].x : 0;
        return s.points[s.points.length - 1].x - anchor <= 1.6; // tail plus at most one ramp
    })());
    check('blocks: all block widths >= 1 month', starts.every(p => p.w >= 0.99),
        JSON.stringify(starts.map(p => p.w)));
}
{
    // Step: 3/mo for 24 months, then 12/mo for another 24
    const stepDates = [];
    let t = pub.getTime();
    for (;;) { t += -Math.log(1 - Math.random()) / 3 * MS_PER_MONTH; if (t > pub.getTime() + 24 * MS_PER_MONTH) break; stepDates.push(new Date(t).toISOString()); }
    t = pub.getTime() + 24 * MS_PER_MONTH;
    for (;;) { t += -Math.log(1 - Math.random()) / 12 * MS_PER_MONTH; if (t > nowMs) break; stepDates.push(new Date(t).toISOString()); }
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: stepDates }, 1, BLOCKS_P0, nowMs);
    const edges = blockEdgesFromSeries(s);
    check('blocks: step detected (>= 2 blocks)', blockCount(s) >= 2, 'got ' + blockCount(s));
    const interior = edges.slice(1, -1);
    check('blocks: change point within 3 months of true step at 24',
        interior.some(e => Math.abs(e - 24) < 3), JSON.stringify(interior));
    const first = s.points[0], last = s.points[s.points.length - 1];
    check(`blocks: first block rate ~ 36/yr (got ${first.y.toFixed(1)})`, Math.abs(first.y - 36) < 14);
    check(`blocks: last block rate ~ 144/yr (got ${last.y.toFixed(1)})`, Math.abs(last.y - 144) < 36);
}
{
    // Burst: 2/mo baseline plus 30/mo during months [20, 24]
    const burstDates = [];
    let t = pub.getTime();
    for (;;) { t += -Math.log(1 - Math.random()) / 2 * MS_PER_MONTH; if (t > nowMs) break; burstDates.push(new Date(t).toISOString()); }
    t = pub.getTime() + 20 * MS_PER_MONTH;
    for (;;) { t += -Math.log(1 - Math.random()) / 30 * MS_PER_MONTH; if (t > pub.getTime() + 24 * MS_PER_MONTH) break; burstDates.push(new Date(t).toISOString()); }
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: burstDates }, 1, BLOCKS_P0, nowMs);
    const starts = blockStarts(s);
    const hot = starts.filter(p => p.y > 250);
    check('blocks: burst isolated as a high-rate block', blockCount(s) >= 3 && hot.length >= 1,
        'blocks=' + blockCount(s) + ' hot=' + hot.length);
    if (hot.length >= 1) {
        const mid = hot[0].x + hot[0].w / 2;
        check(`blocks: burst block centered in [18.5, 25.5] (mid ${mid.toFixed(1)})`, mid > 18.5 && mid < 25.5);
    }
}
check('blocks: empty record -> single zero block with upper limit', (() => {
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: [] }, 1, BLOCKS_P0, nowMs);
    return blockCount(s) === 1 && s.points[0].y === 0 && s.points[0].hi > 0 &&
        s.points[s.points.length - 1].partial === true;
})());
check('blocks: single citation -> single block n=1', (() => {
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: ['2021-06-01'] }, 1, BLOCKS_P0, nowMs);
    return blockCount(s) === 1 && s.points[0].n === 1;
})());
check('blocks: clamped pileup capped by the minimum block width', (() => {
    // 30 citations clamped to t=0 (dates before publication) plus a modest tail:
    // must not produce a hairline block with an absurd rate
    const pileDates = [];
    for (let i = 0; i < 30; i++) pileDates.push('2019-06-01');
    for (let i = 0; i < 100; i++) pileDates.push(new Date(pub.getTime() + Math.random() * 40 * MS_PER_MONTH).toISOString());
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: pileDates }, 1, BLOCKS_P0, pub.getTime() + 40 * MS_PER_MONTH);
    const starts = blockStarts(s);
    return starts.every(p => p.w >= 0.99) && Math.max(...starts.map(p => p.y)) < 700;
})());
check('blocks: Mode 0 x values are Dates', (() => {
    const s = computeBlocksRateSeries(record, 0, BLOCKS_P0, nowMs);
    return Object.prototype.toString.call(s.points[0].x) === '[object Date]';
})());
check('blocks: weekly quantization path preserves counts', (() => {
    const many = [];
    for (let i = 0; i < 6000; i++) many.push(new Date(pub.getTime() + Math.random() * 250 * MS_PER_MONTH).toISOString());
    const nowBig = pub.getTime() + 250 * MS_PER_MONTH;
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: many }, 1, BLOCKS_P0, nowBig);
    return blockStarts(s).reduce((a, p) => a + p.n, 0) === 6000;
})());
check('bayesianBlocksEdges: no events -> [0, T]', JSON.stringify(bayesianBlocksEdges([], 10, BLOCKS_P0)) === '[0,10]');
check('blocks: ramped x strictly increasing, trueX on block starts', (() => {
    const stepDates2 = [];
    let t2 = pub.getTime();
    for (;;) { t2 += -Math.log(1 - Math.random()) / 3 * MS_PER_MONTH; if (t2 > pub.getTime() + 24 * MS_PER_MONTH) break; stepDates2.push(new Date(t2).toISOString()); }
    t2 = pub.getTime() + 24 * MS_PER_MONTH;
    for (;;) { t2 += -Math.log(1 - Math.random()) / 12 * MS_PER_MONTH; if (t2 > nowMs) break; stepDates2.push(new Date(t2).toISOString()); }
    const s = computeBlocksRateSeries({ date: pub.toISOString(), citation_dates: stepDates2 }, 1, BLOCKS_P0, nowMs);
    return s.points.every((p, i, a) => i === 0 || p.x > a[i - 1].x) &&
        blockStarts(s).every(p => p.trueX !== undefined);
})());
{
    // p0 sensitivity: a gentle ramp splits under eager but stays whole (or
    // splits less) under strict
    const rampDates = [];
    let t = pub.getTime();
    for (;;) {
        t += -Math.log(1 - Math.random()) / 6.5 * MS_PER_MONTH;
        if (t > nowMs) break;
        const frac = (t - pub.getTime()) / (48 * MS_PER_MONTH);
        if (Math.random() < (3.75 + 2.5 * frac) / 6.5) rampDates.push(new Date(t).toISOString());
    }
    const rec = { date: pub.toISOString(), citation_dates: rampDates };
    const nStrict = blockCount(computeBlocksRateSeries(rec, 1, 0.05, nowMs));
    const nEager = blockCount(computeBlocksRateSeries(rec, 1, 0.9, nowMs));
    check(`p0 controls sensitivity (strict ${nStrict} <= eager ${nEager} and eager >= 2)`,
        nStrict <= nEager && nEager >= 2);
}

// --- Imprecise-date spreading ---
{
    const mk = (date, recid) => ({ date: date, recid: recid });
    const cits = [];
    for (let i = 0; i < 12; i++) cits.push(mk('2011', 100 + i));
    cits.push(mk('2011-05', 50), mk('2011-05', 51), mk('2011-05', 52));
    cits.push(mk('2010-07-15', 7));
    spreadImpreciseDates(cits);
    check('spread: full dates untouched', cits[15].date === '2010-07-15');
    const yearSpread = cits.slice(0, 12).map(c => c.date);
    check('spread: year-only stay within their year',
        yearSpread.every(d => d >= '2011-01-01' && d <= '2011-12-31'), JSON.stringify(yearSpread));
    check('spread: no Jan 1 pileup', yearSpread.every(d => d !== '2011-01-01'));
    check('spread: dates increase with recid', yearSpread.every((d, i, a) => i === 0 || d > a[i - 1]));
    check('spread: coverage across the year', yearSpread[0] < '2011-03-01' && yearSpread[11] > '2011-10-31',
        yearSpread[0] + ' .. ' + yearSpread[11]);
    const monthSpread = cits.slice(12, 15).map(c => c.date);
    check('spread: month-only stay within their month',
        monthSpread.every(d => d >= '2011-05-01' && d <= '2011-05-31'), JSON.stringify(monthSpread));
    const shuffled = [mk('2011', 105), mk('2011', 101), mk('2011', 103)];
    const ordered = [mk('2011', 101), mk('2011', 103), mk('2011', 105)];
    spreadImpreciseDates(shuffled);
    spreadImpreciseDates(ordered);
    const byRecid = arr => JSON.stringify(arr.slice().sort((a, b) => a.recid - b.recid));
    check('spread: deterministic regardless of arrival order', byRecid(shuffled) === byRecid(ordered));
}
check('spread: Jan 1 dates treated as year precision', (() => {
    const cs = [];
    for (let i = 0; i < 10; i++) cs.push({ date: '2011-01-01', recid: 200 + i });
    spreadImpreciseDates(cs, Date.UTC(2020, 0, 1));
    const ds = cs.map(c => c.date);
    return ds.every(d => d >= '2011-01-01' && d <= '2011-12-31') &&
        ds.filter(d => d === '2011-01-01').length === 0 &&
        ds.some(d => d > '2011-06-01');
})());
check('spread: 1st-of-month dates treated as month precision', (() => {
    const cs = [];
    for (let i = 0; i < 6; i++) cs.push({ date: '2011-05-01', recid: 300 + i });
    spreadImpreciseDates(cs, Date.UTC(2020, 0, 1));
    return cs.every(c => c.date >= '2011-05-01' && c.date <= '2011-05-31') &&
        cs.filter(c => c.date === '2011-05-01').length === 0;
})());
check('spread: Jan 1 merges with plain year-only groups', (() => {
    const cs = [
        { date: '2011', recid: 1 }, { date: '2011-01-01', recid: 2 },
        { date: '2011', recid: 3 }, { date: '2011-01-01', recid: 4 }
    ];
    spreadImpreciseDates(cs, Date.UTC(2020, 0, 1));
    const ds = cs.map(c => c.date).sort();
    return ds.every(d => d >= '2011-01-01' && d <= '2011-12-31') &&
        new Set(ds).size === 4;
})());
check('spread: genuine mid-month dates untouched', (() => {
    const cs = [{ date: '2011-05-02', recid: 1 }, { date: '2011-12-31', recid: 2 }];
    spreadImpreciseDates(cs, Date.UTC(2020, 0, 1));
    return cs[0].date === '2011-05-02' && cs[1].date === '2011-12-31';
})());
check('spread: current year capped at the present', (() => {
    const now26 = Date.UTC(2026, 7, 31); // Aug 31, 2026
    const cs = [];
    for (let i = 0; i < 12; i++) cs.push({ date: '2026', recid: i });
    spreadImpreciseDates(cs, now26);
    return cs.every(c => Date.parse(c.date + 'T00:00:00Z') <= now26 && c.date >= '2026-01-01');
})());
check('spread: fully future period left within its own span', (() => {
    const now26 = Date.UTC(2026, 7, 31);
    const cs = [{ date: '2027', recid: 1 }, { date: '2027', recid: 2 }];
    spreadImpreciseDates(cs, now26);
    return cs.every(c => c.date >= '2027-01-01' && c.date <= '2027-12-31');
})());
check('spread: current month capped at the present', (() => {
    const now26 = Date.UTC(2026, 7, 20); // Aug 20, 2026
    const cs = [{ date: '2026-08', recid: 1 }, { date: '2026-08', recid: 2 }, { date: '2026-08', recid: 3 }];
    spreadImpreciseDates(cs, now26);
    return cs.every(c => c.date >= '2026-08-01' && Date.parse(c.date + 'T00:00:00Z') <= now26);
})());
check('old cache versions removed, current and foreign keys kept', (() => {
    const st = makeFakeStorage();
    st.setItem('inspire-citation-cache-v1:123', 'old');
    st.setItem(CACHE_PREFIX + '456', 'current');
    st.setItem('user-setting', 'keep');
    cacheRemoveOldVersions(st);
    return st.getItem('inspire-citation-cache-v1:123') === null &&
        st.getItem(CACHE_PREFIX + '456') === 'current' && st.getItem('user-setting') === 'keep';
})());

// --- WSB model fit ---
check('normInv accuracy', Math.abs(normInv(0.975) - 1.959964) < 1e-6 && Math.abs(normInv(0.5)) < 1e-9);
check('normInv/normCdf roundtrip', [0.05, 0.2, 0.5, 0.8, 0.95].every(pv => Math.abs(normCdf(normInv(pv)) - pv) < 1e-4));
check('formatCitationCount', formatCitationCount(842) === '842' && formatCitationCount(3400) === '3.4k' &&
    formatCitationCount(3000) === '3k' && formatCitationCount(250000) === '250k' &&
    formatCitationCount(2.5e6) === '2.5M' && formatCitationCount(5e9) === '>100M');
check('wsb guard: too few citations', wsbFit(new Array(30).fill(10), 120).ok === false);
check('wsb guard: too young', wsbFit(new Array(200).fill(10), 36).ok === false);
{
    // Parameter recovery on a synthetic WSB process (mature paper)
    const trueLam = 2.5, trueMu = Math.log(18), trueSig = 0.8, T = 120;
    const sim = wsbSimulate(trueLam, trueMu, trueSig, T, 20000);
    check('wsb simulate: sane event count', sim.ok && sim.times.length > 150 && sim.times.length < 600,
        'N=' + sim.times.length);
    const fit = wsbFit(sim.times, T);
    check('wsb fit ok on synthetic data', fit.ok === true, JSON.stringify(fit));
    if (fit.ok) {
        check(`wsb recovers lambda ~ 2.5 (got ${fit.lambda.toFixed(2)})`, Math.abs(fit.lambda - trueLam) < 0.4);
        check(`wsb recovers mu ~ ${trueMu.toFixed(2)} (got ${fit.mu.toFixed(2)})`, Math.abs(fit.mu - trueMu) < 0.4);
        check(`wsb recovers sigma ~ 0.8 (got ${fit.sigma.toFixed(2)})`, Math.abs(fit.sigma - trueSig) < 0.3);
        const trueCinf = WSB_M * Math.expm1(trueLam);
        check(`wsb cinf within 40% of truth ${trueCinf.toFixed(0)} (got ${fit.cinf.toFixed(0)})`,
            fit.cinf > 0.6 * trueCinf && fit.cinf < 1.6 * trueCinf);
        check('wsb mature fit marked reliable with turnover elapsed', fit.reliable === true && fit.phiT > 0.9,
            'phiT=' + fit.phiT);
        check('wsb bootstrap interval sane', fit.lo !== undefined && fit.lo > 0 && fit.lo < fit.hi &&
            fit.lo < fit.cinf * 1.2 && fit.hi > fit.cinf * 0.8, JSON.stringify([fit.lo, fit.cinf, fit.hi]));
        // Cumulative model curve: monotone and consistent with c(T)
        const cum = wsbCumulativeCurve(fit, T, 100);
        const cModelT = WSB_M * Math.expm1(fit.lambda * normCdf((Math.log(T) - fit.mu) / fit.sigma));
        check('wsb cumulative curve monotone, ends at c(T)',
            cum.every((pt, i, a) => i === 0 || pt.y >= a[i - 1].y - 1e-9) &&
            Math.abs(cum[cum.length - 1].y - cModelT) / cModelT < 0.01);
        // Model rate curve integrates back to the model cumulative
        const curve = wsbRateCurve(fit, T, 400);
        let integral = 0;
        for (let i = 1; i < curve.length; i++) {
            integral += (curve[i].y + curve[i - 1].y) / 2 * (curve[i].t - curve[i - 1].t) / 12;
        }
        const modelCT = WSB_M * Math.expm1(fit.lambda * normCdf((Math.log(T) - fit.mu) / fit.sigma));
        check(`wsb rate curve integrates to c(T) (${integral.toFixed(0)} vs ${modelCT.toFixed(0)})`,
            Math.abs(integral - modelCT) / modelCT < 0.06);
        check('wsb curve positive', curve.every(pt => pt.y >= 0));
    }
}
{
    // Still-rising paper: extrapolation goes well beyond the observed count
    const sim = wsbSimulate(4, Math.log(200), 0.8, 120, 20000);
    if (sim.ok && sim.times.length >= WSB_MIN_CITATIONS) {
        const fit = wsbFit(sim.times, 120);
        check('wsb still-rising: fit ok but projection withheld (no turnover)',
            fit.ok === true && fit.reliable === false,
            'phiT=' + (fit.ok ? fit.phiT : 'n/a') + ' lambda=' + (fit.ok ? fit.lambda.toFixed(1) : 'n/a'));
    } else {
        check('wsb still-rising: simulation produced enough events', false, 'N=' + sim.times.length);
    }
}
{
    // Margin plugin renders the projection as a second line
    const texts = [];
    const mock = {
        ctx: { save() {}, restore() {}, set fillStyle(v) {}, fillText: (t, x, y) => texts.push({ t, y }) },
        chartArea: { top: 10, bottom: 400, right: 700 },
        scales: { y: { getPixelForValue: v => 400 - v } },
        isDatasetVisible: () => true,
        data: { datasets: [
            { label: 'A', borderColor: '#e41a1c', data: [{ y: 55, lo: 47, hi: 63 }],
                wsbSummary: { ok: true, reliable: true, cinf: 3400, lo: 2800, hi: 4200 } },
            { label: 'B', borderColor: '#377eb8', data: [{ y: 30, lo: 24, hi: 36 }],
                wsbSummary: { ok: true, reliable: false, cinf: 7e21, phiT: 0.1 } }
        ] }
    };
    presentRateLabelPlugin.afterDatasetsDraw(mock);
    check('plugin: projection line only for reliable fits', texts.length === 3 &&
        texts.filter(a => a.t.indexOf('\u221e') === 0).length === 1, JSON.stringify(texts.map(a => a.t)));
    const inf = texts.find(a => a.t.indexOf('\u221e') === 0);
    check('plugin: projection format', !!inf && inf.t.indexOf('3.4k') > 0 && inf.t.indexOf('\u00b1') > 0, inf && inf.t);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
