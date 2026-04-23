// ---------------------------------------------------------------------------
// Graphs page: visualizes Plan-page data as horizontal range bars showing
// the Min / Expected / Max throughput required to support a customer-supplied
// concurrency, where uncertainty comes from the exchangeRatePerHour triple.
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
            'Throughput range required to support each model at the customer-supplied concurrency. ' +
            'The bar spans from Min (rate=low) to Max (rate=high) of the Exchange-rate-per-hour triple; ' +
            'the solid vertical marker inside the bar is the Expected throughput that matches the Plan page.';
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

        const points = computePoints(plan, wsEntry);

        const writeWrap = document.createElement('div');
        writeWrap.className = 'graphs-chart-wrap';
        const writeCanvas = document.createElement('canvas');
        writeWrap.appendChild(writeCanvas);
        card.appendChild(writeWrap);
        chartInstances.push(buildRangeBarChart(
            writeCanvas,
            points.write,
            `Write throughput — at ${plan.concurrentUsers.toLocaleString()} concurrent users`
        ));

        const readWrap = document.createElement('div');
        readWrap.className = 'graphs-chart-wrap';
        const readCanvas = document.createElement('canvas');
        readWrap.appendChild(readCanvas);
        card.appendChild(readWrap);
        chartInstances.push(buildRangeBarChart(
            readCanvas,
            points.read,
            `Read throughput — at ${plan.concurrentUsers.toLocaleString()} concurrent users`
        ));

        return card;
    }

    // Compute three scalar throughput values (min/expected/max GiB/s) for each
    // of write and read, holding concurrentUsers fixed at the Plan-page Expected
    // value and sweeping exchangeRatePerHour across its triple.
    function computePoints(plan, wsEntry) {
        const cc = plan.concurrentUsers;

        const rMin = safeCalc({ ...plan, concurrentUsers: cc, exchangeRatePerHour: plan.exchangeRatePerHourLow }, wsEntry);
        const rExp = safeCalc({ ...plan, concurrentUsers: cc, exchangeRatePerHour: plan.exchangeRatePerHour }, wsEntry);
        const rMax = safeCalc({ ...plan, concurrentUsers: cc, exchangeRatePerHour: plan.exchangeRatePerHourHigh }, wsEntry);

        const fallback = { totalWriteGiBps: 0, totalReadGiBps: 0 };
        const min = rMin || fallback;
        const exp = rExp || fallback;
        const max = rMax || fallback;

        return {
            write: { min: min.totalWriteGiBps, expected: exp.totalWriteGiBps, max: max.totalWriteGiBps },
            read:  { min: min.totalReadGiBps,  expected: exp.totalReadGiBps,  max: max.totalReadGiBps  }
        };
    }

    function safeCalc(planLike, wsEntry) {
        try {
            return calculatePlanEntry(planLike, wsEntry);
        } catch (e) {
            return null;
        }
    }

    // Render a horizontal range bar: [Min ──●── Max], with the Expected value
    // marked by a solid vertical tick and three numeric labels drawn under the
    // bar. Uses Chart.js "floating bar" (data = [[low, high]]).
    function buildRangeBarChart(canvas, vals, title) {
        const ctx = canvas.getContext('2d');
        const accent = '#D71612';

        // Axis upper bound: leave 15% headroom above the Max label.
        const rawMax = Math.max(vals.max, vals.expected, 0);
        const xMax = rawMax > 0 ? rawMax * 1.15 : 1;

        // When Min ≈ Max (no uncertainty) the floating bar renders as zero
        // width. Widen just enough to be visible so the chart never looks blank.
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
                c.save();
                c.strokeStyle = accent;
                c.lineWidth = 2.5;
                c.beginPath();
                c.moveTo(expPx, barTop);
                c.lineTo(expPx, barBottom);
                c.stroke();
                c.restore();

                // Numeric labels under the bar
                const labelY = barBottom + 14;
                c.save();
                c.fillStyle = '#ccc';
                c.font = '11px sans-serif';
                c.textBaseline = 'top';

                const labels = [
                    { x: vals.min,      text: `Min ${formatThroughputHuman(vals.min)}`,       align: 'left'   },
                    { x: vals.expected, text: `Expected ${formatThroughputHuman(vals.expected)}`, align: 'center' },
                    { x: vals.max,      text: `Max ${formatThroughputHuman(vals.max)}`,       align: 'right'  }
                ];
                for (const lab of labels) {
                    c.textAlign = lab.align;
                    const px = x.getPixelForValue(lab.x);
                    // Clamp label x to keep text inside the chart area
                    const clamped = Math.min(Math.max(px, chartArea.left + 2), chartArea.right - 2);
                    c.fillText(lab.text, clamped, labelY);
                }
                c.restore();
            }
        };

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [''],
                datasets: [{
                    data: [[barLo, barHi]],
                    backgroundColor: accent + '33',
                    borderColor: accent + '99',
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
                                `Min ${formatThroughputHuman(vals.min)}  |  ` +
                                `Expected ${formatThroughputHuman(vals.expected)}  |  ` +
                                `Max ${formatThroughputHuman(vals.max)}`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: xMax,
                        title: { display: true, text: 'GiB/s', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: '#333' }
                    },
                    y: {
                        ticks: { display: false },
                        grid: { display: false }
                    }
                },
                layout: { padding: { bottom: 24 } } // room for numeric labels drawn under the bar
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
