// DOM smoke test: loads the app in headless Chromium with the real
// chart.xkcd library (vendored copy of the pinned CDN build, so no network
// is needed) and synthetic citation data injected, then checks view
// switching, dataset construction, the decorated SVG (bands, dashes,
// labels, tooltip, legend pruning), URL handling, and the identifier
// parser. Skips cleanly when no Chromium/Chrome is available (set
// CHROME_BIN to point at one explicitly).
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

// Swap the CDN chart.xkcd for the vendored copy (same 1.1.13 build) plus a
// wrapper that records every config passed to the XY chart; drop the
// Font Awesome stylesheet (icons only)
const localLib = `<script src="chart.xkcd.min.js"></script>
<script>
(function () {
    var RealXY = chartXkcd.XY;
    chartXkcd.XY = function (el, cfg) {
        (window.__xkcdConfigs = window.__xkcdConfigs || []).push(cfg);
        return new RealXY(el, cfg);
    };
})();
</` + `script>`;
const cdnTag = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.xkcd@1\.1\.13\/dist\/chart\.xkcd\.min\.js"><\/script>/;
if (!cdnTag.test(html)) {
    console.error('FAIL: pinned chart.xkcd CDN tag not found in the page');
    process.exit(1);
}
html = html.replace(cdnTag, localLib);
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
        const nCfg = () => (window.__xkcdConfigs || []).length;
        const lastCfg = () => window.__xkcdConfigs[window.__xkcdConfigs.length - 1];
        const chartSvg = () => document.getElementById('chart');
        // Legend rows are swatch+text pairs sharing one layer; tooltip items
        // (chart.xkcd's own and the rate view's) match the same pattern but
        // sit one per nested svg, so require >= 2 texts in the parent
        const legendRows = () => Array.from(chartSvg().querySelectorAll('text')).filter(t =>
            t.previousElementSibling && t.previousElementSibling.tagName === 'rect' &&
            parseFloat(t.previousElementSibling.getAttribute('width')) < 25 &&
            !t.closest('.rate-tooltip') &&
            t.parentNode.querySelectorAll('text').length >= 2);

        document.getElementById('show-rate').checked = false;
        updateChart();
        smokeLog('cumulative view renders via chartXkcd', nCfg() === 1, 'got ' + nCfg());
        var svgEl = chartSvg();
        var svgW = parseInt(svgEl.getAttribute('width'), 10);
        var svgH = parseInt(svgEl.getAttribute('height'), 10);
        var box = svgEl.parentElement.getBoundingClientRect();
        smokeLog('container uses chart.xkcd\\u2019s native 3:2 aspect',
            box.width > 0 && Math.abs(box.width / box.height - 1.5) < 0.05,
            Math.round(box.width) + 'x' + Math.round(box.height));
        smokeLog('cumulative svg fits the container (no clipping)',
            svgW > 0 && svgH > 0 && Math.abs(svgW / svgH - 1.5) < 0.05 && svgH <= box.height + 2,
            svgW + 'x' + svgH + ' in ' + Math.round(box.height));
        smokeLog('cumulative renders real xkcd line paths',
            svgEl.querySelectorAll('path.xkcd-chart-xyline').length === 2,
            'paths=' + svgEl.querySelectorAll('path.xkcd-chart-xyline').length);
        smokeLog('cumulative legend lists both papers', legendRows().length === 2,
            'rows=' + legendRows().length);

        // Rate view (smooth estimator by default)
        document.getElementById('show-rate').checked = true;
        updateChart();
        smokeLog('rate view renders via chartXkcd too', nCfg() === 2, 'got ' + nCfg());
        var cfg = lastCfg();
        smokeLog('rate config carries the xkcd styling of the cumulative view',
            cfg.title === 'Citation Rate' && cfg.yLabel === 'Citations per year' &&
            cfg.options.dotSize === 0 && cfg.options.showLine === true &&
            cfg.options.timeFormat === 'MMM D, YYYY',
            JSON.stringify({ t: cfg.title, y: cfg.yLabel }));
        var ds = cfg.data.datasets;
        smokeLog('papers first, then helper datasets, then the pad point',
            ds.length === 9 && ds[0].label.indexOf('Paper A') === 0 && ds[1].label.indexOf('Paper B') === 0 &&
            ds[ds.length - 1].label === '' && ds[ds.length - 1].data.length === 1,
            ds.map(function (d) { return d.label; }).join(' | '));
        smokeLog('pad point pins the y-axis to start at zero', ds[ds.length - 1].data[0].y === 0);
        smokeLog('per-dataset colors aligned', cfg.options.dataColors.length === ds.length);
        smokeLog('smooth central curve is dense', ds[0].data.length >= 80, 'pts=' + ds[0].data.length);
        var svgR = chartSvg();
        svgW = parseInt(svgR.getAttribute('width'), 10);
        svgH = parseInt(svgR.getAttribute('height'), 10);
        box = svgR.parentElement.getBoundingClientRect();
        smokeLog('rate svg has the same size and aspect as cumulative',
            svgW > 0 && Math.abs(svgW / svgH - 1.5) < 0.05 && svgH <= box.height + 2,
            svgW + 'x' + svgH);
        smokeLog('one rendered path per dataset',
            svgR.querySelectorAll('path.xkcd-chart-xyline').length === ds.length);
        smokeLog('68% bands drawn as filled polygons under the curves',
            svgR.querySelectorAll('path.rate-band-fill').length === 2,
            'fills=' + svgR.querySelectorAll('path.rate-band-fill').length);
        var hiddenPaths = Array.from(svgR.querySelectorAll('path.xkcd-chart-xyline'))
            .filter(function (p) { return p.getAttribute('display') === 'none'; });
        smokeLog('band edges and pad point hidden (5 paths)', hiddenPaths.length === 5,
            'hidden=' + hiddenPaths.length);
        var dashed = Array.from(svgR.querySelectorAll('path.xkcd-chart-xyline'))
            .filter(function (p) { return p.getAttribute('stroke-dasharray'); });
        smokeLog('provisional tails dashed', dashed.length === 2, 'dashed=' + dashed.length);
        var nowLabels = Array.from(svgR.querySelectorAll('text.rate-now-label'));
        smokeLog('present-rate labels beside the curves, value \\u00b1 error',
            nowLabels.length === 2 && nowLabels.every(function (t) { return t.textContent.indexOf('\\u00b1') > 0; }),
            nowLabels.map(function (t) { return t.textContent; }).join(' | '));
        var innerW = svgW - 100; // chart.xkcd margins: left 70, right 30
        smokeLog('labels hang in the margin right of the plot (curves reach the edge)',
            getComputedStyle(svgR).overflow === 'visible' &&
            nowLabels.every(function (t) { return parseFloat(t.getAttribute('x')) >= innerW - 2; }),
            nowLabels.map(function (t) { return t.getAttribute('x'); }).join(',') + ' vs innerW ' + innerW);
        smokeLog('rate legend pruned to the two papers', legendRows().length === 2 &&
            legendRows().every(function (t) { return t.textContent.indexOf('Paper') === 0; }),
            legendRows().map(function (t) { return t.textContent; }).join(' | '));
        smokeLog('no helper labels left anywhere in the svg',
            Array.from(svgR.querySelectorAll('text')).every(function (t) {
                return ['upper 68%', 'lower 68%', 'now (provisional)', 'model fit'].indexOf(t.textContent) < 0;
            }));

        smokeLog('no dots drawn on the rate curves',
            svgR.querySelectorAll('g[xy-group-index]').length === 0,
            'groups=' + svgR.querySelectorAll('g[xy-group-index]').length);
        var curYear = new Date().getFullYear();
        var futureTicks = Array.from(svgR.querySelectorAll('g.tick text')).filter(function (t) {
            return /^\\d{4}$/.test(t.textContent) && parseInt(t.textContent, 10) > curYear;
        });
        smokeLog('no future-year axis ticks in the label zone', futureTicks.length === 0,
            futureTicks.map(function (t) { return t.textContent; }).join(','));

        // Tooltip: move the mouse onto the middle of the first paper's curve
        var tipEl = svgR.querySelector('svg.rate-tooltip');
        smokeLog('rate tooltip exists and starts hidden',
            !!tipEl && tipEl.style.visibility === 'hidden');
        var mainPath = svgR.querySelectorAll('path.xkcd-chart-xyline')[0];
        var midPt = mainPath.getPointAtLength(mainPath.getTotalLength() / 2);
        var svgBox = svgR.getBoundingClientRect();
        var sc = svgBox.width / parseFloat(svgR.getAttribute('width'));
        svgR.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
            clientX: svgBox.left + (midPt.x + 70) * sc, clientY: svgBox.top + (midPt.y + 60) * sc }));
        var marker = svgR.querySelector('circle.rate-hover-marker');
        var tipTexts = tipEl ? Array.from(tipEl.querySelectorAll('text')).map(function (t) { return t.textContent; }) : [];
        smokeLog('mouse near the curve shows the terse \\u00b1 tooltip and a marker',
            !!tipEl && tipEl.style.visibility === 'visible' &&
            !!marker && marker.getAttribute('display') === 'block' &&
            tipTexts.some(function (t) { return t.indexOf('Paper A') === 0 && (t.indexOf('\\u00b1') > 0 || t.indexOf('+') > 0); }),
            tipTexts.join(' | '));
        svgR.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
            clientX: svgBox.left + 1, clientY: svgBox.top + 1 }));
        smokeLog('tooltip hides away from the curves',
            tipEl.style.visibility === 'hidden' && marker.getAttribute('display') === 'none');

        smokeLog('estimator + width selectors shown in rate view',
            document.getElementById('estimator-group').style.display === 'flex' &&
            document.getElementById('bin-width-group').style.display === 'flex');
        smokeLog('width label reads Smoothing in smooth mode',
            document.getElementById('bin-width-label').textContent === 'Smoothing:');
        smokeLog('rateData populated for CSV export', Array.isArray(rateData) && rateData.length === 2 &&
            rateData[0].estimator === 'smooth' && typeof rateData[0].widthMonths === 'number');

        document.getElementById('align-timeline').checked = true;
        updateChart();
        var cfgA = lastCfg();
        smokeLog('aligned rate switches to a linear axis in years (Mode 2 via >5y paper)',
            cfgA.options.timeFormat === '' && cfgA.xLabel === 'Timeline (Years)', cfgA.xLabel);
        document.getElementById('align-timeline').checked = false;

        // Binned mode: soft-step corners
        document.getElementById('rate-estimator').value = 'binned';
        updateChart();
        var cfgS = lastCfg();
        var mainLen = cfgS.data.datasets[0].data.length;
        var tailLenB = cfgS.data.datasets.filter(function (d) { return d.label === 'now (provisional)'; })[0].data.length;
        smokeLog('binned curve drawn as corner pairs (soft steps)',
            mainLen + tailLenB - 1 === 2 * rateData[0].points.length,
            mainLen + '+' + tailLenB + '-1 vs 2x' + rateData[0].points.length);
        smokeLog('binned points carry per-bin width w',
            rateData[0].points.every(function (p) { return typeof p.w === 'number' && p.w > 0; }));
        smokeLog('width label reads Bin width in binned mode',
            document.getElementById('bin-width-label').textContent === 'Bin width:');

        document.getElementById('bin-width').value = '12';
        updateChart();
        var nBins = rateData[0].points.length;
        smokeLog('yearly bin override: paper A has 7-8 bins', nBins >= 7 && nBins <= 8, 'got ' + nBins);

        updateUrl();
        smokeLog('url carries rate=true & bin=12 & est=binned',
            location.search.indexOf('rate=true') >= 0 && location.search.indexOf('bin=12') >= 0 &&
            location.search.indexOf('est=binned') >= 0, location.search);

        // Bayesian blocks mode
        document.getElementById('rate-estimator').value = 'blocks';
        updateChart();
        var ptsK = rateData[0].points;
        smokeLog('blocks: dup points mirror block rates', ptsK.length >= 2 &&
            ptsK.every(function (pt, i, a) { return !pt.dup || pt.y === a[i - 1].y; }));
        var nBlocksK = ptsK.filter(function (pt) { return !pt.dup; }).length;
        smokeLog('blocks: few blocks for featureless data', nBlocksK >= 1 && nBlocksK <= 4, 'blocks=' + nBlocksK);
        smokeLog('blocks: width selector hidden', document.getElementById('bin-width-group').style.display === 'none');
        smokeLog('blocks: sensitivity selector shown', document.getElementById('p0-group').style.display === 'flex');
        smokeLog('blocks: ramped x strictly increasing', ptsK.every(function (pt, i, a) { return i === 0 || pt.x > a[i - 1].x; }));
        smokeLog('blocks: rateData estimator label', rateData[0].estimator === 'blocks');
        updateUrl();
        smokeLog('url carries est=blocks', location.search.indexOf('est=blocks') >= 0, location.search);

        var cfgCountBefore = nCfg();
        document.getElementById('blocks-p0').value = '0.9';
        document.getElementById('blocks-p0').dispatchEvent(new Event('change'));
        smokeLog('sensitivity change event triggers a redraw',
            nCfg() === cfgCountBefore + 1, 'configs ' + cfgCountBefore + ' -> ' + nCfg());
        smokeLog('url carries p0=0.9 when eager', location.search.indexOf('p0=0.9') >= 0, location.search);
        document.getElementById('blocks-p0').value = '0.05';
        document.getElementById('blocks-p0').dispatchEvent(new Event('change'));
        smokeLog('p0 param dropped at strict default', location.search.indexOf('p0=') < 0, location.search);

        // Yearly-counts histogram overlay on the estimate
        document.getElementById('rate-estimator').value = 'smooth';
        document.getElementById('yearly-counts').checked = true;
        document.getElementById('yearly-counts').dispatchEvent(new Event('change'));
        var cfgY = lastCfg();
        var histDs = cfgY.data.datasets.filter(function (d) { return d.label === 'yearly counts'; });
        smokeLog('yearly overlay: one histogram per paper on top of the estimate',
            histDs.length === 2 && cfgY.data.datasets[0].label.indexOf('Paper A') === 0,
            'hist=' + histDs.length);
        var histOutlines = Array.from(chartSvg().querySelectorAll('path.rate-hist-outline'));
        smokeLog('yearly overlay: histogram bars rise from the zero baseline',
            histOutlines.length === 2 && histOutlines.every(function (p) {
                var dd = p.getAttribute('d');
                var base = parseFloat(chartSvg().getAttribute('height')) - 110; // margins: top 60, bottom 50
                var firstY = parseFloat(dd.slice(1).split('L')[0].split(',')[1]);
                var lastY = parseFloat(dd.split('L').pop().split(',')[1]);
                return Math.abs(firstY - base) < 1 && Math.abs(lastY - base) < 1 &&
                    String(p.getAttribute('fill')).indexOf('rgba') === 0;
            }),
            'outlines=' + histOutlines.length);
        smokeLog('yearly overlay: legend still lists only the papers', legendRows().length === 2,
            legendRows().map(function (t) { return t.textContent; }).join(' | '));
        var yearlySeries = rateData.filter(function (r) { return r.estimator === 'yearly'; });
        smokeLog('yearly overlay: integer count series join the CSV data',
            rateData.length === 4 && yearlySeries.length === 2 &&
            yearlySeries[0].points.every(function (p) {
                return Number.isInteger(p.y) && p.lo === p.y && p.hi === p.y && typeof p.yearLabel === 'string';
            }),
            JSON.stringify(yearlySeries.length ? yearlySeries[0].points.map(function (p) { return p.y; }) : []));
        // Hover the first histogram corner: title is the bare year
        // (the hidden source line's first point sits exactly on that corner)
        var srcPath = histOutlines[0].nextElementSibling;
        var hp = srcPath.getPointAtLength(0);
        var hBox = chartSvg().getBoundingClientRect();
        var hsc = hBox.width / parseFloat(chartSvg().getAttribute('width'));
        chartSvg().dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
            clientX: hBox.left + (hp.x + 70) * hsc, clientY: hBox.top + (hp.y + 60) * hsc }));
        var hTip = chartSvg().querySelector('svg.rate-tooltip');
        var hTexts = hTip ? Array.from(hTip.querySelectorAll('text')).map(function (t) { return t.textContent; }) : [];
        smokeLog('yearly overlay: hovering a corner titles the tooltip with the year',
            !!hTip && hTip.style.visibility === 'visible' && hTexts.some(function (t) { return /^\\d{4}$/.test(t); }),
            hTexts.join(' | '));
        chartSvg().dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
            clientX: hBox.left + 1, clientY: hBox.top + 1 }));
        updateUrl();
        smokeLog('url carries yearly=true', location.search.indexOf('yearly=true') >= 0, location.search);
        document.getElementById('yearly-counts').checked = false;
        document.getElementById('yearly-counts').dispatchEvent(new Event('change'));
        smokeLog('yearly overlay removed when unchecked',
            lastCfg().data.datasets.filter(function (d) { return d.label === 'yearly counts'; }).length === 0 &&
            rateData.length === 2);
        updateUrl();
        smokeLog('yearly param dropped when unchecked', location.search.indexOf('yearly=') < 0, location.search);
        history.pushState({}, '', '?rate=true&yearly=true');
        parseUrlParams();
        smokeLog('yearly=true URL parameter parsed', document.getElementById('yearly-counts').checked === true);
        document.getElementById('yearly-counts').checked = false;
        document.getElementById('rate-estimator').value = 'blocks';
        updateChart();

        // Every rate control must redraw through its real change event
        var controlIds = ['rate-estimator', 'bin-width', 'blocks-p0', 'wsb-fit', 'yearly-counts'];
        var allWired = controlIds.every(function (id) {
            var before = nCfg();
            document.getElementById(id).dispatchEvent(new Event('change'));
            return nCfg() === before + 1;
        });
        smokeLog('all rate controls have live change listeners', allWired);

        document.getElementById('rate-estimator').value = 'smooth';
        updateChart();
        smokeLog('smooth mode honors width override as FWHM=12',
            lastCfg().data.datasets[0].data.length >= 80 && rateData[0].widthMonths === 12,
            'width=' + rateData[0].widthMonths);
        updateUrl();
        smokeLog('est param removed when back to default', location.search.indexOf('est=') < 0, location.search);
        smokeLog('sensitivity selector hidden outside blocks', document.getElementById('p0-group').style.display === 'none');

        // WSB model fit overlay
        smokeLog('wsb checkbox shown in rate view, off by default',
            document.getElementById('wsb-group').style.display === 'flex' &&
            !document.getElementById('wsb-fit').checked);
        document.getElementById('wsb-fit').checked = true;
        document.getElementById('wsb-fit').dispatchEvent(new Event('change'));
        var cfgW = lastCfg();
        var wsbDs = cfgW.data.datasets.filter(function (d) { return d.label === 'model fit'; });
        smokeLog('wsb overlay only for the mature paper', wsbDs.length === 1, 'got ' + wsbDs.length);
        var svgW2 = chartSvg();
        var wsbDashed = Array.from(svgW2.querySelectorAll('path.xkcd-chart-xyline'))
            .filter(function (p) { return p.getAttribute('stroke-dasharray') === '10,6'; });
        smokeLog('wsb curve dashed distinctly from the tails', wsbDashed.length === 1,
            'got ' + wsbDashed.length);
        smokeLog('wsb legend row pruned too', legendRows().length === 2,
            legendRows().map(function (t) { return t.textContent; }).join(' | '));
        updateUrl();
        smokeLog('url carries wsb=true', location.search.indexOf('wsb=true') >= 0, location.search);
        var summaryEl = document.getElementById('fit-summary');
        smokeLog('fit summary visible in rate view with verdicts',
            summaryEl.style.display === 'block' &&
            summaryEl.querySelectorAll('.fit-summary-item').length === 2 &&
            summaryEl.textContent.indexOf('needs at least') >= 0 &&
            (summaryEl.textContent.indexOf('projected total') >= 0 || summaryEl.textContent.indexOf('no projection') >= 0),
            summaryEl.textContent);
        document.getElementById('wsb-fit').checked = false;
        document.getElementById('wsb-fit').dispatchEvent(new Event('change'));
        smokeLog('wsb overlay removed when unchecked',
            lastCfg().data.datasets.filter(function (d) { return d.label === 'model fit'; }).length === 0);
        updateUrl();
        smokeLog('wsb param dropped when unchecked', location.search.indexOf('wsb=') < 0, location.search);
        smokeLog('fit summary hidden when unchecked', document.getElementById('fit-summary').style.display === 'none');

        // Back to the cumulative view, with the model overlay
        document.getElementById('show-rate').checked = false;
        updateChart();
        smokeLog('switch back to cumulative renders again',
            lastCfg().title === 'Citation History', lastCfg().title);
        document.getElementById('wsb-fit').checked = true;
        document.getElementById('wsb-fit').dispatchEvent(new Event('change'));
        var cfgCum = lastCfg();
        var fitLabels = cfgCum.data.datasets.filter(function (d) { return d.label.indexOf('fit') === 0 || d.label.indexOf('projected total') === 0; });
        smokeLog('cumulative view gains one model curve (mature paper only)',
            cfgCum.data.datasets.length === 3 && fitLabels.length === 1,
            'datasets=' + cfgCum.data.datasets.length);
        smokeLog('cumulative model colors extended to match',
            cfgCum.options.dataColors.length === 3 &&
            String(cfgCum.options.dataColors[2]).indexOf('rgba') === 0);
        smokeLog('cumulative legend prunes the fit row (papers only)',
            legendRows().length === 2 &&
            Array.from(chartSvg().querySelectorAll('text')).every(function (t) {
                return t.textContent.indexOf('projected total') < 0 && t.textContent.indexOf('fit (') !== 0;
            }),
            legendRows().map(function (t) { return t.textContent; }).join(' | '));
        smokeLog('fit summary visible in cumulative view',
            document.getElementById('fit-summary').style.display === 'block' &&
            document.getElementById('fit-summary').querySelectorAll('.fit-summary-item').length === 2,
            document.getElementById('fit-summary').textContent);
        updateUrl();
        smokeLog('wsb param kept in cumulative view', location.search.indexOf('wsb=true') >= 0, location.search);
        document.getElementById('wsb-fit').checked = false;
        document.getElementById('wsb-fit').dispatchEvent(new Event('change'));
        updateUrl();

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
        smokeLog('imprecise-date spreading wired', (function () {
            var cs = [{ date: '2011', recid: 1 }, { date: '2011', recid: 2 }, { date: '2020-03-04', recid: 3 }];
            spreadImpreciseDates(cs);
            return cs[0].date !== '2011-01-01' && cs[0].date.indexOf('2011-') === 0 &&
                cs[1].date.indexOf('2011-') === 0 && cs[2].date === '2020-03-04';
        })());
        updateUrl();
        smokeLog('rate params removed from url', location.search.indexOf('rate=') < 0 && location.search.indexOf('bin=') < 0, location.search);

        // Legacy smooth=false URLs map to the binned estimator
        history.pushState({}, '', '?rate=true&smooth=false');
        parseUrlParams();
        smokeLog('legacy smooth=false maps to binned', document.getElementById('rate-estimator').value === 'binned');
        history.pushState({}, '', '?rate=true&est=blocks&p0=0.9');
        parseUrlParams();
        smokeLog('p0 URL parameter parsed', document.getElementById('blocks-p0').value === '0.9');
        history.pushState({}, '', '?rate=true&wsb=true');
        parseUrlParams();
        smokeLog('wsb URL parameter parsed', document.getElementById('wsb-fit').checked === true);
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
fs.copyFileSync(path.join(__dirname, 'vendor', 'chart.xkcd.min.js'),
    path.join(tmpDir, 'chart.xkcd.min.js'));

const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1280,800',
    '--allow-file-access-from-files',
    '--virtual-time-budget=15000', '--dump-dom', 'file://' + smokePath
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
