// ---------------------------------------------------------------------------
// Graphs page: horizontal range-bar visualizations of capacity and throughput
// ranges derived from Plan-page scenario triples.
// ---------------------------------------------------------------------------

function renderGraphsPage(container) {
    const chartInstances = [];
    const ACCENT = '#D71612';
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
            'Each bar spans the Low and High scenarios from the Plan-page ranges.';
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

        const planStore = syncPlanWithWorkspace();

        const perModel = [];
        for (const wsEntry of workspaceModels) {
            const plan = planStore[wsEntry.id];
            const points = plan ? computePoints(plan, wsEntry) : null;
            perModel.push({ wsEntry, plan, points });
            container.appendChild(buildModelGraphCard(wsEntry, plan, points));
        }

        const anyWithPlan = perModel.some(m => m.points);
        if (anyWithPlan) {
            container.appendChild(buildAggregateCard(perModel.filter(m => m.points)));
        }
    }

    // Compute capacity + write + read {low, high} pairs by running
    // calculatePlanEntry at each bound. The scenario-range inputs (totalUsers,
    // concurrentUsers, exchangesPerUser, exchangeRatePerHour) are substituted
    // from their *Low and *High fields.
    function computePoints(plan, wsEntry) {
        const low  = safeCalc(planAtBound(plan, 'Low'),  wsEntry);
        const high = safeCalc(planAtBound(plan, 'High'), wsEntry);

        const toGiB = r => r ? r.totalKVSizeBytes / BYTES_PER_GIB : 0;
        const toWrite = r => r ? r.totalWriteGiBps : 0;
        const toRead  = r => r ? r.totalReadGiBps  : 0;

        return {
            capacity: { low: toGiB(low),   high: toGiB(high)   },
            write:    { low: toWrite(low), high: toWrite(high) },
            read:     { low: toRead(low),  high: toRead(high)  }
        };
    }

    function planAtBound(plan, bound) {
        return {
            ...plan,
            totalUsers: plan[`totalUsers${bound}`],
            concurrentUsers: plan[`concurrentUsers${bound}`],
            exchangesPerUser: plan[`exchangesPerUser${bound}`],
            exchangeRatePerHour: plan[`exchangeRatePerHour${bound}`]
        };
    }

    function safeCalc(planLike, wsEntry) {
        try {
            return calculatePlanEntry(planLike, wsEntry);
        } catch (e) {
            return null;
        }
    }

    function buildModelGraphCard(wsEntry, plan, points) {
        const card = document.createElement('div');
        card.className = 'panel graphs-card';
        card.style.marginBottom = '16px';

        const header = document.createElement('div');
        header.className = 'plan-card-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'plan-card-title';
        titleSpan.textContent = wsEntry.title;
        header.appendChild(titleSpan);
        if (wsEntry.title !== wsEntry.baseModel) {
            const base = document.createElement('span');
            base.className = 'plan-card-base';
            base.textContent = wsEntry.baseModel;
            header.appendChild(base);
        }
        card.appendChild(header);

        if (!plan || !points) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color: var(--text-muted); font-size: 0.9rem; margin-top: 8px;';
            empty.innerHTML = 'No plan data. Visit the <a href="#plan" style="color: var(--accent);">Plan page</a> to configure this model.';
            card.appendChild(empty);
            return card;
        }

        appendChart(card, points.capacity, 'Capacity',         'GiB',   formatSizeHumanFromGiB);
        appendChart(card, points.write,    'Write throughput', 'GiB/s', formatThroughputHuman);
        appendChart(card, points.read,     'Read throughput',  'GiB/s', formatThroughputHuman);

        return card;
    }

    function buildAggregateCard(perModelWithPlan) {
        const sum = (selector) => ({
            low:  perModelWithPlan.reduce((s, m) => s + selector(m.points).low,  0),
            high: perModelWithPlan.reduce((s, m) => s + selector(m.points).high, 0),
        });

        const totals = {
            capacity: sum(p => p.capacity),
            write:    sum(p => p.write),
            read:     sum(p => p.read),
        };

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

        appendChart(card, totals.capacity, 'Total capacity', 'GiB', formatSizeHumanFromGiB);
        appendChart(card, totals.write,    'Total write throughput', 'GiB/s', formatThroughputHuman);
        appendChart(card, totals.read,     'Total read throughput',  'GiB/s', formatThroughputHuman);

        return card;
    }

    function appendChart(card, vals, title, axisUnit, formatter) {
        const wrap = document.createElement('div');
        wrap.className = 'graphs-chart-wrap';
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);
        card.appendChild(wrap);
        chartInstances.push(buildRangeBarChart(canvas, vals, title, axisUnit, formatter));
    }

    function formatSizeHumanFromGiB(gib) {
        // Reuse the Plan-page size formatter, which expects bytes.
        return formatSizeHuman(gib * BYTES_PER_GIB);
    }

    // Horizontal range bar [low, high] with a single centered summary line
    // "Low … · High …" beneath the chart area. The centered-summary approach
    // avoids overlap problems that positioned labels have when the range is
    // narrow or zero.
    function buildRangeBarChart(canvas, vals, title, axisUnit, formatter) {
        const ctx = canvas.getContext('2d');

        const rawMax = Math.max(vals.high, vals.low, 0);
        const xMax = rawMax > 0 ? rawMax * 1.15 : 1;

        const hasRange = (vals.high - vals.low) > xMax * 0.001;
        const midpoint = (vals.low + vals.high) / 2;
        const barLo = hasRange ? vals.low  : Math.max(0, midpoint - xMax * 0.01);
        const barHi = hasRange ? vals.high : midpoint + xMax * 0.01;

        const annotations = {
            id: 'rangeBarAnnotations',
            afterDatasetsDraw(chart) {
                const { ctx: c, chartArea } = chart;
                const midY = (chartArea.top + chartArea.bottom) / 2;
                const barBottom = midY + 14;

                // Single centered summary line — always readable regardless of range
                c.save();
                c.fillStyle = '#ddd';
                c.font = '11px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'top';
                const summary = vals.low === vals.high
                    ? formatter(vals.low)
                    : `Low ${formatter(vals.low)}  ·  High ${formatter(vals.high)}`;
                const centerX = (chartArea.left + chartArea.right) / 2;
                c.fillText(summary, centerX, barBottom + 12);
                c.restore();
            }
        };

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [''],
                datasets: [{
                    data: [[barLo, barHi]],
                    backgroundColor: ACCENT + '33',
                    borderColor: ACCENT + '99',
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
                            label: () =>
                                vals.low === vals.high
                                    ? formatter(vals.low)
                                    : `Low ${formatter(vals.low)}  |  High ${formatter(vals.high)}`
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
                },
                layout: { padding: { bottom: 22 } }
            },
            plugins: [annotations]
        });
    }

    render();

    return () => {
        for (const c of chartInstances) c.destroy();
        chartInstances.length = 0;
    };
}
