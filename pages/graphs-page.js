// ---------------------------------------------------------------------------
// Graphs page: range-bar visualizations of capacity and throughput per
// workspace model + an aggregate roll-up. Throughput charts also draw the
// system bandwidth as a vertical reference line so the gap to the cap is
// directly readable.
// ---------------------------------------------------------------------------

function renderGraphsPage(container) {
    const chartInstances = [];
    const ACCENT = '#D71612';
    const CAP_LINE = '#F0E68C';
    const BYTES_PER_GIB = 1024 ** 3;

    function render() {
        container.innerHTML = '';

        const title = document.createElement('h2');
        title.style.cssText = 'margin: 0 0 12px; border: none; padding: 0;';
        title.textContent = 'Graphs';
        container.appendChild(title);

        const intro = document.createElement('p');
        intro.style.cssText = 'margin: 0 0 16px; color: var(--text-muted); max-width: 780px;';
        intro.textContent =
            'Capacity and throughput ranges per workspace model, plus an aggregate roll-up. ' +
            'Throughput charts show demand (bar) with the system bandwidth cap drawn as a vertical line — bar segments past the line are capped.';
        container.appendChild(intro);

        const workspaceModels = getWorkspaceModels();
        if (workspaceModels.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'panel';
            empty.style.cssText = 'text-align: center; padding: 30px; color: var(--text-muted);';
            empty.innerHTML = 'No models in your workspace. Go to <a href="#home" style="color: var(--accent);">the Home page</a> to add one.';
            container.appendChild(empty);
            return;
        }

        const planData = syncPlanWithWorkspace();
        const horizonDays = planData.planningHorizonDays;
        const horizonSeconds = horizonDays * 86400;

        const perModel = [];
        for (const wsEntry of workspaceModels) {
            const plan = planData.entries[wsEntry.id];
            const sys = getSystem(wsEntry.deployment && wsEntry.deployment.systemId);
            const points = plan ? computePoints(plan, wsEntry, horizonSeconds, sys) : null;
            perModel.push({ wsEntry, plan, sys, points });
        }

        const modelsWithPoints = perModel.filter(m => m.points);
        let aggregate = null;
        let xMaxes = null;
        if (modelsWithPoints.length > 0) {
            aggregate = computeAggregate(modelsWithPoints);
            xMaxes = {
                capacity: computeSharedXMax(aggregate.capacity.peak, 0),
                write:    computeSharedXMax(aggregate.write.peak,    aggregate.write.cap),
                read:     computeSharedXMax(aggregate.read.peak,     aggregate.read.cap)
            };
        }

        if (aggregate) {
            container.appendChild(buildAggregateCard(aggregate, xMaxes, horizonDays));
        }

        for (const m of perModel) {
            container.appendChild(buildModelGraphCard(m.wsEntry, m.plan, m.sys, m.points, xMaxes, horizonDays));
        }
    }

    function computeAggregate(modelsWithPoints) {
        const sumDir = (selector) => {
            let avg = 0, peak = 0, cap = 0;
            for (const m of modelsWithPoints) {
                const v = selector(m.points);
                avg  += v.avg;
                peak += v.peak;
                cap  += v.cap || 0;
            }
            return { avg, peak, cap };
        };
        return {
            capacity: sumDir(p => p.capacity),
            write:    sumDir(p => p.write),
            read:     sumDir(p => p.read)
        };
    }

    function computeSharedXMax(highVal, capVal) {
        const rawMax = Math.max(highVal || 0, capVal || 0, 0);
        return rawMax > 0 ? rawMax * 1.15 : 1;
    }

    function computePoints(plan, wsEntry, horizonSeconds, sys) {
        const avg  = safeCalc(plan, wsEntry, plan.rpsAverage, horizonSeconds, sys);
        const peak = safeCalc(plan, wsEntry, plan.rpsPeak,    horizonSeconds, sys);

        const toGiB   = r => r ? r.totalKVSizeBytes / BYTES_PER_GIB : 0;
        const toWrite = r => r ? r.totalWriteGiBps : 0;
        const toRead  = r => r ? r.totalReadGiBps  : 0;
        const writeCap = avg ? avg.writeBandwidthGiBps : 0;
        const readCap  = avg ? avg.readBandwidthGiBps  : 0;

        return {
            // Capacity has no cap.
            capacity: { avg: toGiB(avg),   peak: toGiB(peak),   cap: 0 },
            // Throughput: bar = demand range, cap = system bandwidth.
            write:    { avg: toWrite(avg), peak: toWrite(peak), cap: writeCap },
            read:     { avg: toRead(avg),  peak: toRead(peak),  cap: readCap  }
        };
    }

    function safeCalc(plan, wsEntry, rps, horizonSeconds, sys) {
        try {
            return calculatePlanEntry(plan, wsEntry, {
                rps, horizonSeconds, system: sys, systemInstances: plan.systemInstances
            });
        } catch (e) {
            return null;
        }
    }

    function planCardTitleForGraphs(wsEntry) {
        const dep = wsEntry.deployment || {};
        const sys = getSystem(dep.systemId);
        const tp = dep.tp || 1;
        const pp = dep.pp || 1;
        const parallelism = pp > 1 ? `TP=${tp}, PP=${pp}` : `TP=${tp}`;
        const sysName = sys ? sys.name : 'no system';
        return `${wsEntry.title} (${parallelism}) on ${sysName}`;
    }

    function buildModelGraphCard(wsEntry, plan, sys, points, xMaxes, horizonDays) {
        const card = document.createElement('div');
        card.className = 'panel graphs-card';
        card.style.marginBottom = '16px';

        const header = document.createElement('div');
        header.className = 'plan-card-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'plan-card-title';
        titleSpan.textContent = planCardTitleForGraphs(wsEntry);
        header.appendChild(titleSpan);
        card.appendChild(header);

        if (!plan || !points) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color: var(--text-muted); font-size: 0.9rem; margin-top: 8px;';
            empty.innerHTML = 'No plan data. Visit the <a href="#plan" style="color: var(--accent);">Plan page</a> to configure this model.';
            card.appendChild(empty);
            return card;
        }

        const sysLabel = sys ? `${plan.systemInstances}× ${sys.name}` : 'no system';

        appendChart(card, points.capacity, 'Capacity',         'GiB',   formatSizeHumanFromGiB, xMaxes.capacity, horizonDays, null);
        appendChart(card, points.write,    'Write throughput', 'GiB/s', formatThroughputHuman,   xMaxes.write,    null,        sysLabel);
        appendChart(card, points.read,     'Read throughput',  'GiB/s', formatThroughputHuman,   xMaxes.read,     null,        sysLabel);

        return card;
    }

    function buildAggregateCard(aggregate, xMaxes, horizonDays) {
        const card = document.createElement('div');
        card.className = 'panel graphs-card graphs-aggregate-card';
        card.style.marginBottom = '16px';

        const header = document.createElement('div');
        header.className = 'plan-card-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'plan-card-title';
        titleSpan.textContent = 'Aggregate (all models)';
        header.appendChild(titleSpan);
        card.appendChild(header);

        appendChart(card, aggregate.capacity, 'Total capacity',         'GiB',   formatSizeHumanFromGiB, xMaxes.capacity, horizonDays, null);
        appendChart(card, aggregate.write,    'Total write throughput', 'GiB/s', formatThroughputHuman,   xMaxes.write,    null,        'fleet');
        appendChart(card, aggregate.read,     'Total read throughput',  'GiB/s', formatThroughputHuman,   xMaxes.read,     null,        'fleet');

        return card;
    }

    // vals = { avg, peak, cap }. If horizonDays is non-null we render a
    // "Sized for N days" caption (capacity charts only). If sysLabel is non-
    // null we render a "System cap: X GiB/s (label)" caption (throughput).
    function appendChart(card, vals, title, axisUnit, formatter, xMax, horizonDays, sysLabel) {
        const wrap = document.createElement('div');
        wrap.className = 'graphs-chart-wrap';
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);
        card.appendChild(wrap);

        const summary = document.createElement('div');
        summary.className = 'graphs-chart-summary';
        summary.textContent = vals.avg === vals.peak
            ? formatter(vals.avg)
            : `Avg ${formatter(vals.avg)}  ·  Peak ${formatter(vals.peak)}`;
        card.appendChild(summary);

        const capped = vals.cap > 0 && vals.peak > vals.cap + 1e-9;

        if (horizonDays !== null && horizonDays !== undefined) {
            const caption = document.createElement('div');
            caption.className = 'graphs-chart-caption';
            caption.textContent = `Sized for ${horizonDays} day${horizonDays === 1 ? '' : 's'}`;
            card.appendChild(caption);
        } else if (sysLabel) {
            const caption = document.createElement('div');
            caption.className = 'graphs-chart-caption';
            const capText = vals.cap > 0 ? `System cap: ${formatter(vals.cap)} (${sysLabel})` : 'No system cap';
            caption.innerHTML = capped ? `<span class="status-err">⚠ capped</span> · ${capText}` : capText;
            card.appendChild(caption);
        }

        chartInstances.push(buildRangeBarChart(canvas, vals, title, axisUnit, formatter, xMax, capped));
    }

    function formatSizeHumanFromGiB(gib) {
        return formatSizeHuman(gib * BYTES_PER_GIB);
    }

    // Horizontal range bar [avg, peak]; optional vertical line at the cap.
    function buildRangeBarChart(canvas, vals, title, axisUnit, formatter, xMax, capped) {
        const ctx = canvas.getContext('2d');

        const hasRange = (vals.peak - vals.avg) > xMax * 0.001;
        const midpoint = (vals.avg + vals.peak) / 2;
        const barLo = hasRange ? vals.avg  : Math.max(0, midpoint - xMax * 0.01);
        const barHi = hasRange ? vals.peak : midpoint + xMax * 0.01;

        const cap = vals.cap || 0;
        const capPlugin = (cap > 0) ? {
            id: 'capLine',
            afterDatasetsDraw(chart) {
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                if (!xScale || !yScale) return;
                if (cap < xScale.min || cap > xScale.max) return;
                const x = xScale.getPixelForValue(cap);
                const yTop = chart.chartArea.top;
                const yBot = chart.chartArea.bottom;
                const ctxd = chart.ctx;
                ctxd.save();
                ctxd.strokeStyle = CAP_LINE;
                ctxd.lineWidth = 2;
                ctxd.setLineDash([5, 4]);
                ctxd.beginPath();
                ctxd.moveTo(x, yTop);
                ctxd.lineTo(x, yBot);
                ctxd.stroke();
                ctxd.restore();
            }
        } : null;

        // Segment past the cap rendered in a darker shade for clarity.
        const fillColor = capped ? ACCENT + '55' : ACCENT + '33';
        const borderColor = capped ? ACCENT + 'CC' : ACCENT + '99';

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [''],
                datasets: [{
                    data: [[barLo, barHi]],
                    backgroundColor: fillColor,
                    borderColor: borderColor,
                    borderWidth: 1,
                    borderSkipped: false,
                    barThickness: 28
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: title, color: '#fff', font: { size: 12 } },
                    tooltip: {
                        callbacks: {
                            label: () => {
                                const base = vals.avg === vals.peak
                                    ? formatter(vals.avg)
                                    : `Avg ${formatter(vals.avg)}  |  Peak ${formatter(vals.peak)}`;
                                return cap > 0 ? `${base}  |  Cap ${formatter(cap)}` : base;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: xMax,
                        title: { display: true, text: axisUnit, color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: '#333' }
                    },
                    y: {
                        ticks: { display: false },
                        grid: { display: false }
                    }
                }
            },
            plugins: capPlugin ? [capPlugin] : []
        });
    }

    render();

    return () => {
        for (const c of chartInstances) c.destroy();
        chartInstances.length = 0;
    };
}
