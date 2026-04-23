// ---------------------------------------------------------------------------
// Graphs page: visualizes Plan-page data as throughput-vs-concurrent-users
// line charts with a shaded cone derived from scenario triples.
// ---------------------------------------------------------------------------

function renderGraphsPage(container) {
    const chartInstances = [];

    function render() {
        container.innerHTML = '';

        const title = document.createElement('h2');
        title.style.cssText = 'margin: 0 0 12px; border: none; padding: 0;';
        title.textContent = 'Graphs';
        container.appendChild(title);

        const intro = document.createElement('p');
        intro.style.cssText = 'margin: 0 0 16px; color: var(--text-muted); max-width: 780px;';
        intro.textContent =
            'Throughput as a function of concurrent users for each workspace model. ' +
            'The shaded cone reflects the Low/High bounds on the Exchange-rate-per-hour triple set on the Plan page; ' +
            'dashed vertical markers show your Low, Expected, and High concurrent-user values.';
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

        for (const wsEntry of workspaceModels) {
            const plan = planStore[wsEntry.id];
            container.appendChild(buildModelGraphCard(wsEntry, plan));
        }
    }

    function buildModelGraphCard(wsEntry, plan) {
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

        if (!plan) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color: var(--text-muted); font-size: 0.9rem; margin-top: 8px;';
            empty.innerHTML = 'No plan data. Visit the <a href="#plan" style="color: var(--accent);">Plan page</a> to configure this model.';
            card.appendChild(empty);
            return card;
        }

        // Compute sweep data once per card, reuse across write + read charts
        const { xValues, writeSeries, readSeries, markers, accentColor } = computeSeries(plan, wsEntry);

        // Write chart
        const writeWrap = document.createElement('div');
        writeWrap.className = 'graphs-chart-wrap';
        const writeCanvas = document.createElement('canvas');
        writeWrap.appendChild(writeCanvas);
        card.appendChild(writeWrap);
        chartInstances.push(buildChart(writeCanvas, xValues, writeSeries, markers, 'Write throughput (GiB/s)', accentColor));

        // Read chart
        const readWrap = document.createElement('div');
        readWrap.className = 'graphs-chart-wrap';
        const readCanvas = document.createElement('canvas');
        readWrap.appendChild(readCanvas);
        card.appendChild(readWrap);
        chartInstances.push(buildChart(readCanvas, xValues, readSeries, markers, 'Read throughput (GiB/s)', accentColor));

        return card;
    }

    // Sweep concurrentUsers and compute write/read throughput at low, expected,
    // and high values of exchangeRatePerHour for each sweep step.
    function computeSeries(plan, wsEntry) {
        const xMax = Math.max(1.5 * (plan.concurrentUsersHigh || plan.concurrentUsers), 20);
        const STEPS = 25;
        const xValues = [];
        for (let i = 0; i <= STEPS; i++) {
            xValues.push(Math.round(xMax * i / STEPS));
        }

        const writeLow = [], writeExp = [], writeHigh = [];
        const readLow = [], readExp = [], readHigh = [];

        for (const cc of xValues) {
            const base = { ...plan, concurrentUsers: Math.max(1, cc) };

            const rLow = safeCalc({ ...base, exchangeRatePerHour: plan.exchangeRatePerHourLow }, wsEntry);
            const rExp = safeCalc({ ...base, exchangeRatePerHour: plan.exchangeRatePerHour }, wsEntry);
            const rHigh = safeCalc({ ...base, exchangeRatePerHour: plan.exchangeRatePerHourHigh }, wsEntry);

            // First sweep point is cc=0: force throughput to 0 (avoid div-by-zero artifacts)
            const scale = cc === 0 ? 0 : 1;
            writeLow.push(rLow ? rLow.totalWriteGiBps * scale : 0);
            writeExp.push(rExp ? rExp.totalWriteGiBps * scale : 0);
            writeHigh.push(rHigh ? rHigh.totalWriteGiBps * scale : 0);
            readLow.push(rLow ? rLow.totalReadGiBps * scale : 0);
            readExp.push(rExp ? rExp.totalReadGiBps * scale : 0);
            readHigh.push(rHigh ? rHigh.totalReadGiBps * scale : 0);
        }

        const markers = [
            { value: plan.concurrentUsersLow, label: 'Low', emphasized: false },
            { value: plan.concurrentUsers, label: 'Expected', emphasized: true },
            { value: plan.concurrentUsersHigh, label: 'High', emphasized: false }
        ];

        return {
            xValues,
            writeSeries: { low: writeLow, expected: writeExp, high: writeHigh },
            readSeries: { low: readLow, expected: readExp, high: readHigh },
            markers,
            accentColor: '#D71612'
        };
    }

    function safeCalc(planLike, wsEntry) {
        try {
            return calculatePlanEntry(planLike, wsEntry);
        } catch (e) {
            return null;
        }
    }

    function buildChart(canvas, xValues, series, markers, title, accentColor) {
        const ctx = canvas.getContext('2d');

        const verticalMarkersPlugin = {
            id: 'verticalMarkers',
            afterDatasetsDraw(chart) {
                const { ctx, chartArea, scales: { x } } = chart;
                ctx.save();
                for (const m of markers) {
                    const px = x.getPixelForValue(m.value);
                    if (px < chartArea.left || px > chartArea.right) continue;
                    ctx.strokeStyle = m.emphasized ? '#ffffff' : '#888888';
                    ctx.lineWidth = m.emphasized ? 1.5 : 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(px, chartArea.top);
                    ctx.lineTo(px, chartArea.bottom);
                    ctx.stroke();

                    // Label above chart area
                    ctx.setLineDash([]);
                    ctx.fillStyle = m.emphasized ? '#ffffff' : '#aaaaaa';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(m.label, px, chartArea.top - 2);
                }
                ctx.restore();
            }
        };

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: xValues,
                datasets: [
                    {
                        label: 'Low',
                        data: series.low,
                        borderColor: 'transparent',
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: 'High',
                        data: series.high,
                        borderColor: 'transparent',
                        backgroundColor: accentColor + '26', // ~15% alpha
                        pointRadius: 0,
                        fill: '-1' // fill down to the previous dataset (Low)
                    },
                    {
                        label: 'Expected',
                        data: series.expected,
                        borderColor: accentColor,
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false,
                        tension: 0.15
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: '#ccc',
                            filter: item => item.text === 'Expected'
                        }
                    },
                    title: {
                        display: true,
                        text: title,
                        color: '#fff',
                        font: { size: 12 }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: items => `Concurrent users: ${items[0].label}`,
                            label: item => `${item.dataset.label}: ${item.parsed.y.toFixed(4)} GiB/s`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Concurrent users', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: '#333' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'GiB/s', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: '#333' }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            },
            plugins: [verticalMarkersPlugin]
        });
    }

    render();

    return () => {
        for (const c of chartInstances) c.destroy();
        chartInstances.length = 0;
    };
}
