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
            'Every chart of the same type shares the same x-axis scale (taken from the aggregate High) so bars are directly comparable across models.';
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

        // First pass: compute points for every model so we can pre-derive a
        // shared x-axis scale (taken from the aggregate) before rendering.
        const perModel = [];
        for (const wsEntry of workspaceModels) {
            const plan = planStore[wsEntry.id];
            const points = plan ? computePoints(plan, wsEntry) : null;
            perModel.push({ wsEntry, plan, points });
        }

        const modelsWithPoints = perModel.filter(m => m.points);
        let aggregate = null;
        let xMaxes = null;
        if (modelsWithPoints.length > 0) {
            aggregate = computeAggregate(modelsWithPoints);
            xMaxes = {
                capacity: computeSharedXMax(aggregate.capacity),
                write:    computeSharedXMax(aggregate.write),
                read:     computeSharedXMax(aggregate.read)
            };
        }

        // Aggregate goes at the top so the headline numbers are the first
        // thing the user sees. Per-model cards follow in workspace order.
        if (aggregate) {
            container.appendChild(buildAggregateCard(aggregate, xMaxes));
        }

        for (const m of perModel) {
            container.appendChild(buildModelGraphCard(m.wsEntry, m.plan, m.points, xMaxes));
        }
    }

    function computeAggregate(modelsWithPoints) {
        const sum = (selector) => ({
            low:  modelsWithPoints.reduce((s, m) => s + selector(m.points).low,  0),
            high: modelsWithPoints.reduce((s, m) => s + selector(m.points).high, 0),
        });
        return {
            capacity: sum(p => p.capacity),
            write:    sum(p => p.write),
            read:     sum(p => p.read),
        };
    }

    function computeSharedXMax(aggVals) {
        const rawMax = Math.max(aggVals.high, aggVals.low, 0);
        return rawMax > 0 ? rawMax * 1.15 : 1;
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

    function buildModelGraphCard(wsEntry, plan, points, xMaxes) {
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

        appendChart(card, points.capacity, 'Capacity',         'GiB',   formatSizeHumanFromGiB, xMaxes.capacity);
        appendChart(card, points.write,    'Write throughput', 'GiB/s', formatThroughputHuman,   xMaxes.write);
        appendChart(card, points.read,     'Read throughput',  'GiB/s', formatThroughputHuman,   xMaxes.read);

        return card;
    }

    function buildAggregateCard(aggregate, xMaxes) {
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

        appendChart(card, aggregate.capacity, 'Total capacity',         'GiB',   formatSizeHumanFromGiB, xMaxes.capacity);
        appendChart(card, aggregate.write,    'Total write throughput', 'GiB/s', formatThroughputHuman,   xMaxes.write);
        appendChart(card, aggregate.read,     'Total read throughput',  'GiB/s', formatThroughputHuman,   xMaxes.read);

        return card;
    }

    function appendChart(card, vals, title, axisUnit, formatter, xMax) {
        const wrap = document.createElement('div');
        wrap.className = 'graphs-chart-wrap';
        const canvas = document.createElement('canvas');
        wrap.appendChild(canvas);
        card.appendChild(wrap);

        // Summary lives in the DOM, not the canvas — avoids any collision with
        // the x-axis tick labels and stays readable when the range is narrow.
        const summary = document.createElement('div');
        summary.className = 'graphs-chart-summary';
        summary.textContent = vals.low === vals.high
            ? formatter(vals.low)
            : `Low ${formatter(vals.low)}  ·  High ${formatter(vals.high)}`;
        card.appendChild(summary);

        chartInstances.push(buildRangeBarChart(canvas, vals, title, axisUnit, formatter, xMax));
    }

    function formatSizeHumanFromGiB(gib) {
        // Reuse the Plan-page size formatter, which expects bytes.
        return formatSizeHuman(gib * BYTES_PER_GIB);
    }

    // Horizontal range bar [low, high]. The xMax is supplied by the caller so
    // that every chart of the same type shares one axis scale. Summary text is
    // rendered as a DOM element in appendChart, not drawn on the canvas.
    function buildRangeBarChart(canvas, vals, title, axisUnit, formatter, xMax) {
        const ctx = canvas.getContext('2d');

        const hasRange = (vals.high - vals.low) > xMax * 0.001;
        const midpoint = (vals.low + vals.high) / 2;
        const barLo = hasRange ? vals.low  : Math.max(0, midpoint - xMax * 0.01);
        const barHi = hasRange ? vals.high : midpoint + xMax * 0.01;

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
                }
            }
        });
    }

    render();

    return () => {
        for (const c of chartInstances) c.destroy();
        chartInstances.length = 0;
    };
}
