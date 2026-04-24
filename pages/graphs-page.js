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
            'Each range bar spans Min to Max; the solid tick is the Expected value (matching the Plan page).';
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

    // Compute capacity + write + read Min/Expected/Max for a single model.
    // - Capacity varies totalUsers AND exchangesPerUser jointly (both at low,
    //   both at high) since they multiply in the capacity formula.
    // - Throughput varies only exchangeRatePerHour; concurrentUsers is held
    //   at the Plan-page Expected value.
    function computePoints(plan, wsEntry) {
        const capMin = safeCalc({ ...plan, totalUsers: plan.totalUsersLow,  exchangesPerUser: plan.exchangesPerUserLow  }, wsEntry);
        const capExp = safeCalc({ ...plan },                                                                               wsEntry);
        const capMax = safeCalc({ ...plan, totalUsers: plan.totalUsersHigh, exchangesPerUser: plan.exchangesPerUserHigh }, wsEntry);

        const rMin = safeCalc({ ...plan, exchangeRatePerHour: plan.exchangeRatePerHourLow  }, wsEntry);
        const rExp = safeCalc({ ...plan },                                                    wsEntry);
        const rMax = safeCalc({ ...plan, exchangeRatePerHour: plan.exchangeRatePerHourHigh }, wsEntry);

        const toGiB = r => r ? r.totalKVSizeBytes / BYTES_PER_GIB : 0;
        const toWrite = r => r ? r.totalWriteGiBps : 0;
        const toRead  = r => r ? r.totalReadGiBps  : 0;

        return {
            capacity: { min: toGiB(capMin),   expected: toGiB(capExp),   max: toGiB(capMax)   },
            write:    { min: toWrite(rMin),   expected: toWrite(rExp),   max: toWrite(rMax)   },
            read:     { min: toRead(rMin),    expected: toRead(rExp),    max: toRead(rMax)    }
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

        appendChart(
            card,
            points.capacity,
            `Capacity — ${plan.totalUsers.toLocaleString()} total users × ${plan.exchangesPerUser.toLocaleString()} exchanges/user (Expected)`,
            'GiB',
            formatSizeHumanFromGiB
        );
        appendChart(
            card,
            points.write,
            `Write throughput — at ${plan.concurrentUsers.toLocaleString()} concurrent users`,
            'GiB/s',
            formatThroughputHuman
        );
        appendChart(
            card,
            points.read,
            `Read throughput — at ${plan.concurrentUsers.toLocaleString()} concurrent users`,
            'GiB/s',
            formatThroughputHuman
        );

        return card;
    }

    function buildAggregateCard(perModelWithPlan) {
        const sum = (selector) => ({
            min:      perModelWithPlan.reduce((s, m) => s + selector(m.points).min,      0),
            expected: perModelWithPlan.reduce((s, m) => s + selector(m.points).expected, 0),
            max:      perModelWithPlan.reduce((s, m) => s + selector(m.points).max,      0),
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

    // Horizontal range bar with an Expected tick inside the bar and a single
    // centered summary line "Min … · Expected … · Max …" beneath the chart area.
    // The centered-summary approach avoids the overlap problem that
    // positioned-at-x labels have when the range is narrow.
    function buildRangeBarChart(canvas, vals, title, axisUnit, formatter) {
        const ctx = canvas.getContext('2d');

        const rawMax = Math.max(vals.max, vals.expected, vals.min, 0);
        const xMax = rawMax > 0 ? rawMax * 1.15 : 1;

        const hasRange = (vals.max - vals.min) > xMax * 0.001;
        const barLo = hasRange ? vals.min : Math.max(0, vals.expected - xMax * 0.01);
        const barHi = hasRange ? vals.max : vals.expected + xMax * 0.01;

        const annotations = {
            id: 'rangeBarAnnotations',
            afterDatasetsDraw(chart) {
                const { ctx: c, chartArea, scales: { x } } = chart;
                const midY = (chartArea.top + chartArea.bottom) / 2;
                const barTop = midY - 14;
                const barBottom = midY + 14;

                // Expected tick
                const expPx = x.getPixelForValue(vals.expected);
                if (expPx >= chartArea.left && expPx <= chartArea.right) {
                    c.save();
                    c.strokeStyle = ACCENT;
                    c.lineWidth = 2.5;
                    c.beginPath();
                    c.moveTo(expPx, barTop);
                    c.lineTo(expPx, barBottom);
                    c.stroke();
                    c.restore();
                }

                // Single centered summary line — always readable regardless of range
                c.save();
                c.fillStyle = '#ddd';
                c.font = '11px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'top';
                const summary =
                    `Min ${formatter(vals.min)}  ·  ` +
                    `Expected ${formatter(vals.expected)}  ·  ` +
                    `Max ${formatter(vals.max)}`;
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
                                `Min ${formatter(vals.min)}  |  ` +
                                `Expected ${formatter(vals.expected)}  |  ` +
                                `Max ${formatter(vals.max)}`
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
