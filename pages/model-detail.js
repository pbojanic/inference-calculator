// ---------------------------------------------------------------------------
// Model Details page: full GPU memory analysis with auto-calculate
// ---------------------------------------------------------------------------

function renderModelDetailPage(container, params) {
    const entryId = params.id;
    if (!entryId) {
        container.innerHTML = '<p>No model specified. <a href="#home">Go home</a></p>';
        return null;
    }

    const entry = getWorkspaceEntry(entryId);
    if (!entry) {
        container.innerHTML = `<p>Model not found. <a href="#home">Go home</a></p>`;
        return null;
    }

    const config = entry.config;
    let barChartInstance = null;
    let stackChartInstance = null;
    let lastReport = '';
    let savedDeployment = { ...(entry.deployment || defaultDeployment(config)) };
    // Ensure seqLen reflects contextOverride if it was set but seqLen wasn't synced
    if (savedDeployment.contextOverride && savedDeployment.seqLen !== savedDeployment.contextOverride) {
        savedDeployment.seqLen = savedDeployment.contextOverride;
    }
    let currentDeployment = { ...savedDeployment };
    let savedTitle = entry.title;
    let currentTitle = entry.title;
    let calcTimeout = null;

    function render() {
        container.innerHTML = '';

        const backLink = document.createElement('a');
        backLink.href = '#home';
        backLink.className = 'detail-back';
        backLink.textContent = '\u2190 Back to Models';
        backLink.onclick = (e) => {
            e.preventDefault();
            Router.navigate('#home');
        };
        container.appendChild(backLink);

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px;';
        const titleEl = document.createElement('h2');
        titleEl.textContent = currentTitle;
        titleEl.style.cssText = 'border: none; margin: 0; padding: 0;';
        titleRow.appendChild(titleEl);
        if (currentTitle !== entry.baseModel) {
            const baseSpan = document.createElement('span');
            baseSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-muted);';
            baseSpan.textContent = entry.baseModel;
            titleRow.appendChild(baseSpan);
        }
        container.appendChild(titleRow);

        // Summary stats (updated dynamically by runCalculation)
        const summaryRow = document.createElement('div');
        summaryRow.className = 'model-card-stats';
        summaryRow.id = 'detail-summary-stats';
        summaryRow.style.marginBottom = '12px';
        summaryRow.innerHTML = '<span>Calculating...</span>';
        container.appendChild(summaryRow);

        const layout = document.createElement('div');
        layout.className = 'detail-layout';

        // Left: Input panel
        const inputPanel = document.createElement('div');
        inputPanel.className = 'panel';
        inputPanel.appendChild(buildTitleSection());
        inputPanel.appendChild(buildModelSelectorSection());
        inputPanel.appendChild(buildGPUSection());
        inputPanel.appendChild(buildDeploymentSection());
        inputPanel.appendChild(buildStorageSection());
        inputPanel.appendChild(buildPrecisionSection());
        inputPanel.appendChild(buildOptionsSection());
        inputPanel.appendChild(buildActionsSection());
        layout.appendChild(inputPanel);

        // Right: Output panel
        const outputCol = document.createElement('div');

        const reportPanel = document.createElement('div');
        reportPanel.className = 'panel';
        reportPanel.innerHTML = '<h2>Memory Breakdown</h2>';
        const reportDiv = document.createElement('div');
        reportDiv.id = 'detail-report';
        reportDiv.className = 'report-output';
        reportDiv.textContent = 'Calculating...';
        reportPanel.appendChild(reportDiv);

        const exportActions = document.createElement('div');
        exportActions.className = 'actions';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-secondary btn-small';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = copyReport;
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn-secondary btn-small';
        dlBtn.textContent = 'Download';
        dlBtn.onclick = downloadReport;
        exportActions.appendChild(copyBtn);
        exportActions.appendChild(dlBtn);
        reportPanel.appendChild(exportActions);

        outputCol.appendChild(reportPanel);

        const chartPanel = document.createElement('div');
        chartPanel.className = 'panel';
        chartPanel.style.marginTop = '16px';
        chartPanel.innerHTML = '<h2>Visualization</h2>';
        const chartsGrid = document.createElement('div');
        chartsGrid.className = 'charts-grid';
        chartsGrid.innerHTML = `
            <div class="chart-container"><canvas id="detail-bar-chart"></canvas></div>
            <div class="chart-container"><canvas id="detail-stack-chart"></canvas></div>
        `;
        chartPanel.appendChild(chartsGrid);
        outputCol.appendChild(chartPanel);

        layout.appendChild(outputCol);
        container.appendChild(layout);

        // Auto-calculate on load
        setTimeout(() => runCalculation(), 0);
    }

    // -----------------------------------------------------------------------
    // Input change handler — auto-recalculate
    // -----------------------------------------------------------------------
    function onInputChange() {
        readFormValues();
        markDirty();
        clearTimeout(calcTimeout);
        calcTimeout = setTimeout(() => runCalculation(), 200);
    }

    function markDirty() {
        const changed = currentTitle !== savedTitle ||
            JSON.stringify(currentDeployment) !== JSON.stringify(savedDeployment);
        State.setDirty(changed);
    }

    function readFormValues() {
        const el = (id) => document.getElementById(id);
        if (!el('detail-seqLen')) return;

        currentTitle = el('detail-title').value.trim() || savedTitle;
        const newSeqLen = parseInt(el('detail-seqLen').value) || 131072;
        const modelDefault = config.max_position_embeddings || 131072;
        currentDeployment.seqLen = newSeqLen;
        currentDeployment.contextOverride = newSeqLen !== modelDefault ? newSeqLen : null;
        currentDeployment.maxSeqs = parseInt(el('detail-maxSeqs').value) || 1;
        currentDeployment.batchTokens = parseInt(el('detail-batchTokens').value) || 8192;
        currentDeployment.tp = parseInt(el('detail-tp').value) || 1;
        currentDeployment.gpuId = el('detail-gpu').value;
        currentDeployment.gpuUtil = parseFloat(el('detail-gpuUtil').value) || 0.85;
        currentDeployment.cufileBuf = parseFloat(el('detail-cufileBuf').value) || 0;
        currentDeployment.bytesPerWeight = parseFloat(el('detail-bpw').value) || 2;
        currentDeployment.bytesPerKV = parseFloat(el('detail-bpk').value) || 2;
        currentDeployment.bytesPerActivation = parseFloat(el('detail-bpa').value) || 2;
        currentDeployment.showCUDAGraphs = el('detail-cuda').checked;
        currentDeployment.showFrameworkOH = el('detail-fw').checked;
    }

    // -----------------------------------------------------------------------
    // Title
    // -----------------------------------------------------------------------
    function buildTitleSection() {
        const div = document.createElement('div');
        div.innerHTML = `
            <h2>Title</h2>
            <input type="text" id="detail-title" value="${currentTitle}">
            <div id="detail-title-error" class="status-err" style="min-height: 1.2em; font-size: 0.75rem;"></div>
        `;
        setTimeout(() => {
            const inp = document.getElementById('detail-title');
            if (inp) inp.addEventListener('input', () => {
                const errEl = document.getElementById('detail-title-error');
                if (errEl) errEl.textContent = '';
                onInputChange();
            });
        }, 0);
        return div;
    }

    // -----------------------------------------------------------------------
    // Base model selector — change the HuggingFace model architecture
    // -----------------------------------------------------------------------
    function buildModelSelectorSection() {
        const div = document.createElement('div');
        const availableModels = getAvailableModels();

        let options = availableModels.map(name =>
            `<option value="${name}" ${name === entry.baseModel ? 'selected' : ''}>${name}</option>`
        ).join('');

        div.innerHTML = `
            <label>Base model
                <select id="detail-base-model">${options}</select>
            </label>
        `;

        setTimeout(() => {
            const sel = document.getElementById('detail-base-model');
            if (sel) sel.addEventListener('change', () => {
                const newBase = sel.value;
                if (newBase === entry.baseModel) return;
                const newConfig = getModelConfig(newBase);
                if (!newConfig) return;

                // Update the working config and reset precision to auto-detected
                Object.assign(config, newConfig);
                entry.baseModel = newBase;
                entry.config = { ...newConfig };

                currentDeployment.bytesPerWeight = newConfig.bytes_per_weight || 2;
                currentDeployment.bytesPerKV = newConfig.bytes_per_kv_element || 2;
                currentDeployment.bytesPerActivation = newConfig.bytes_per_activation || 2;
                currentDeployment.precisionMode = 'auto';

                // Reset context to new model's default
                const newDefault = newConfig.max_position_embeddings || 131072;
                currentDeployment.seqLen = newDefault;
                currentDeployment.contextOverride = null;

                markDirty();
                render();
            });
        }, 0);

        return div;
    }

    // -----------------------------------------------------------------------
    // Deployment parameters
    // -----------------------------------------------------------------------
    function buildDeploymentSection() {
        const div = document.createElement('div');
        const modelDefault = config.max_position_embeddings || 131072;
        const slidingWindow = config.sliding_window || null;
        const swDisplay = slidingWindow
            ? `<div class="model-detail-row" style="margin-bottom: 8px;">
                   <span class="label">Sliding window:</span>
                   <span style="color: var(--accent);">${slidingWindow.toLocaleString()} tokens (${(slidingWindow / 1024).toFixed(0)}K)</span>
                   <span style="font-size: 0.7rem; color: var(--text-muted);"> — caps KV cache per layer</span>
               </div>`
            : `<div class="model-detail-row" style="margin-bottom: 8px;">
                   <span class="label">Sliding window:</span>
                   <span style="color: var(--text-muted);">None</span>
               </div>`;

        div.innerHTML = `
            <h2>Deployment</h2>
            ${swDisplay}
            <div class="row">
                <label>Sequence length
                    <input type="number" id="detail-seqLen" value="${currentDeployment.seqLen}" min="1">
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Model default: ${modelDefault.toLocaleString()} (override for rope scaling)</span>
                    <div id="detail-seqLen-error" class="status-err" style="min-height: 1em; font-size: 0.75rem;"></div>
                </label>
                <label>Max sequences
                    <input type="number" id="detail-maxSeqs" value="${currentDeployment.maxSeqs}" min="1">
                </label>
            </div>
            <div class="row">
                <label>Max batched tokens
                    <input type="number" id="detail-batchTokens" value="${currentDeployment.batchTokens}" min="1">
                </label>
                <label>Tensor parallel
                    <input type="number" id="detail-tp" value="${currentDeployment.tp}" min="1">
                </label>
            </div>
        `;
        div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', onInputChange));
        return div;
    }

    // -----------------------------------------------------------------------
    // GPU configuration
    // -----------------------------------------------------------------------
    function buildGPUSection() {
        const div = document.createElement('div');
        const gpus = getGpuList();

        let options = gpus.map(g =>
            `<option value="${g.id}" ${g.id === currentDeployment.gpuId ? 'selected' : ''}>${g.name} (${g.memoryGB} GB)</option>`
        ).join('');

        div.innerHTML = `
            <h2>GPU</h2>
            <label>GPU profile
                <select id="detail-gpu">${options}</select>
            </label>
            <label>Memory utilization: <span id="detail-utilLabel">${Math.round(currentDeployment.gpuUtil * 100)}%</span>
                <input type="range" id="detail-gpuUtil" min="0.10" max="0.99" step="0.01" value="${currentDeployment.gpuUtil}">
            </label>
        `;

        setTimeout(() => {
            const sel = document.getElementById('detail-gpu');
            const slider = document.getElementById('detail-gpuUtil');
            if (sel) sel.addEventListener('change', onInputChange);
            if (slider) {
                slider.addEventListener('input', () => {
                    document.getElementById('detail-utilLabel').textContent = Math.round(slider.value * 100) + '%';
                    onInputChange();
                });
            }
        }, 0);

        return div;
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------
    function buildStorageSection() {
        const div = document.createElement('div');
        div.innerHTML = `
            <h2>Storage</h2>
            <label>cuFile buffer (GB)
                <input type="number" id="detail-cufileBuf" value="${currentDeployment.cufileBuf}" step="0.5" min="0">
            </label>
        `;
        div.querySelector('input').addEventListener('input', onInputChange);
        return div;
    }

    // -----------------------------------------------------------------------
    // Precision
    // -----------------------------------------------------------------------
    function buildPrecisionSection() {
        const div = document.createElement('div');
        div.innerHTML = `
            <h2>Precision <span class="auto-tag" id="detail-precisionTag">${currentDeployment.precisionMode || 'auto'}</span></h2>
            <div class="row3">
                <label>Bytes/weight
                    <input type="number" id="detail-bpw" value="${currentDeployment.bytesPerWeight}" step="0.5" min="0.5">
                </label>
                <label>Bytes/KV
                    <input type="number" id="detail-bpk" value="${currentDeployment.bytesPerKV}" step="0.5" min="0.5">
                </label>
                <label>Bytes/activation
                    <input type="number" id="detail-bpa" value="${currentDeployment.bytesPerActivation}" step="0.5" min="0.5">
                </label>
            </div>
        `;
        div.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                currentDeployment.precisionMode = 'manual';
                const tag = document.getElementById('detail-precisionTag');
                if (tag) tag.textContent = 'manual';
                onInputChange();
            });
        });
        return div;
    }

    // -----------------------------------------------------------------------
    // Options
    // -----------------------------------------------------------------------
    function buildOptionsSection() {
        const div = document.createElement('div');
        div.innerHTML = `
            <h2>Options</h2>
            <div class="toggle-row">
                <input type="checkbox" id="detail-cuda" ${currentDeployment.showCUDAGraphs ? 'checked' : ''}>
                <label for="detail-cuda">CUDA graphs memory</label>
            </div>
            <div class="toggle-row">
                <input type="checkbox" id="detail-fw" ${currentDeployment.showFrameworkOH ? 'checked' : ''}>
                <label for="detail-fw">Framework overhead</label>
            </div>
        `;
        div.querySelectorAll('input').forEach(inp => inp.addEventListener('change', onInputChange));
        return div;
    }

    // -----------------------------------------------------------------------
    // Actions: Save / Cancel
    // -----------------------------------------------------------------------
    function buildActionsSection() {
        const div = document.createElement('div');
        div.className = 'actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.textContent = 'Save';
        saveBtn.onclick = () => {
            readFormValues();

            // Validate title uniqueness
            if (!currentTitle) {
                const errEl = document.getElementById('detail-title-error');
                if (errEl) errEl.textContent = 'Title cannot be empty.';
                return;
            }
            if (isWorkspaceTitleTaken(currentTitle, entryId)) {
                const errEl = document.getElementById('detail-title-error');
                if (errEl) errEl.textContent = 'A model with this title already exists.';
                return;
            }

            entry.title = currentTitle;
            entry.deployment = { ...currentDeployment };
            saveWorkspaceEntry(entry);
            savedDeployment = { ...currentDeployment };
            savedTitle = currentTitle;
            State.setDirty(false);
            location.hash = '#home';
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            currentDeployment = { ...savedDeployment };
            currentTitle = savedTitle;
            State.setDirty(false);
            location.hash = '#home';
        };

        div.appendChild(saveBtn);
        div.appendChild(cancelBtn);
        return div;
    }

    // -----------------------------------------------------------------------
    // Calculation & rendering
    // -----------------------------------------------------------------------
    function runCalculation() {
        const gpu = getGpu(currentDeployment.gpuId);
        const gpuMemoryGB = gpu ? gpu.memoryGB : 79.7;

        const result = calculateCompleteAnalysis({
            config,
            modelName: currentTitle,
            maxNumSeqs: currentDeployment.maxSeqs,
            promptLength: currentDeployment.seqLen,
            maxBatchedTokens: currentDeployment.batchTokens,
            gpuMemoryGB,
            gpuMemoryUtil: currentDeployment.gpuUtil,
            tensorParallel: currentDeployment.tp,
            cufileBufferGB: currentDeployment.cufileBuf,
            bytesPerWeight: currentDeployment.bytesPerWeight,
            bytesPerKV: currentDeployment.bytesPerKV,
            bytesPerActivation: currentDeployment.bytesPerActivation,
            showCUDAGraphs: currentDeployment.showCUDAGraphs,
            showFrameworkOH: currentDeployment.showFrameworkOH
        });

        lastReport = formatReport(result);
        const reportEl = document.getElementById('detail-report');
        if (reportEl) reportEl.textContent = lastReport;

        // Update summary stats
        const summaryEl = document.getElementById('detail-summary-stats');
        if (summaryEl) {
            const gpuName = gpu ? gpu.name : 'No GPU';
            const ctxK = (currentDeployment.seqLen / 1024).toFixed(0);
            summaryEl.innerHTML = `
                <span>${gpuName}</span>
                <span>Weights: ${result.totalWeightsGB.toFixed(1)} GiB</span>
                <span>KV Cache: ${result.kv.total_kv_cache_gb.toFixed(1)} GiB</span>
                <span>Context: ${ctxK}K</span>
            `;
        }

        renderBarChart(result);
        renderStackChart(result);
    }

    // -----------------------------------------------------------------------
    // Charts
    // -----------------------------------------------------------------------
    const COLORS = {
        weights: '#D71612',
        kv: '#4ECDC4',
        activations: '#F04E23',
        cuda: '#898A8A',
        framework: '#FFEAA7',
        cufile: '#A29BFE',
        driver: '#D9D9D9',
        unused: '#555555'
    };

    function renderBarChart(r) {
        const canvas = document.getElementById('detail-bar-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (barChartInstance) barChartInstance.destroy();

        // Group bars: vLLM budget | gap | Outside budget
        const labels = [];
        const data = [];
        const colors = [];
        const borderColors = [];

        // vLLM budget components
        labels.push('Weights'); data.push(r.weightsPerRankGB); colors.push(COLORS.weights + 'CC'); borderColors.push(COLORS.weights);
        labels.push('KV Cache'); data.push(r.kv.kv_cache_per_gpu_gb); colors.push(COLORS.kv + 'CC'); borderColors.push(COLORS.kv);
        labels.push('Activations'); data.push(r.act.activation_per_gpu_gb); colors.push(COLORS.activations + 'CC'); borderColors.push(COLORS.activations);

        // Separator
        labels.push(''); data.push(0); colors.push('transparent'); borderColors.push('transparent');

        // Outside budget components
        if (r.showCUDAGraphs) { labels.push('CUDA Graphs'); data.push(r.cudaPerRank); colors.push(COLORS.cuda + 'CC'); borderColors.push(COLORS.cuda); }
        if (r.showFrameworkOH) { labels.push('Framework OH'); data.push(r.fwPerRank); colors.push(COLORS.framework + 'CC'); borderColors.push(COLORS.framework); }
        labels.push('cuFile Buf'); data.push(r.cufileBufferGB); colors.push(COLORS.cufile + 'CC'); borderColors.push(COLORS.cufile);
        labels.push('Driver'); data.push(r.driverContext); colors.push(COLORS.driver + 'CC'); borderColors.push(COLORS.driver);

        barChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors, borderColor: borderColors, borderWidth: 1 }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: `Per-Rank Memory Components`, color: '#fff', font: { size: 13 } },
                    tooltip: {
                        filter: ctx => ctx.parsed.y > 0,
                        callbacks: { label: ctx => `${ctx.parsed.y.toFixed(2)} GB (${((ctx.parsed.y / r.gpuMemoryGB) * 100).toFixed(1)}%)` }
                    }
                },
                scales: {
                    y: { title: { display: true, text: 'Memory (GB)', color: '#aaa' }, ticks: { color: '#aaa' }, grid: { color: '#333' } },
                    x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { display: false } }
                }
            },
            plugins: [{
                id: 'zoneLabels',
                afterDraw(chart) {
                    const xScale = chart.scales.x;
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.font = 'bold 10px -apple-system, sans-serif';
                    ctx.textAlign = 'center';

                    // vLLM Budget label (over first 3 bars)
                    const budgetLeft = xScale.getPixelForValue(0);
                    const budgetRight = xScale.getPixelForValue(2);
                    ctx.fillStyle = '#4ECDC4';
                    ctx.fillText('vLLM Budget', (budgetLeft + budgetRight) / 2, chart.chartArea.top - 4);

                    // Outside label (over remaining bars)
                    const sepIdx = 3; // separator index
                    const outsideStart = sepIdx + 1;
                    const outsideEnd = chart.data.labels.length - 1;
                    if (outsideEnd >= outsideStart) {
                        const outsideLeft = xScale.getPixelForValue(outsideStart);
                        const outsideRight = xScale.getPixelForValue(outsideEnd);
                        ctx.fillStyle = '#898A8A';
                        ctx.fillText('Outside Budget', (outsideLeft + outsideRight) / 2, chart.chartArea.top - 4);
                    }

                    ctx.restore();
                }
            }]
        });
    }

    function renderStackChart(r) {
        const canvas = document.getElementById('detail-stack-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (stackChartInstance) stackChartInstance.destroy();

        const utilPct = (r.gpuMemoryUtil * 100).toFixed(0);

        // Two horizontal stacked bars, one per zone.
        // Each bar fills to its zone's total allocation.
        // indexAxis: 'y' makes them horizontal.
        // Row 0 = vLLM Budget, Row 1 = Outside Budget
        const datasets = [];

        // --- vLLM budget components (row 0 only) ---
        datasets.push({ label: 'Model Weights', data: [r.weightsPerRankGB, 0], backgroundColor: COLORS.weights + 'CC', borderColor: COLORS.weights, borderWidth: 1 });
        datasets.push({ label: 'KV Cache', data: [r.kv.kv_cache_per_gpu_gb, 0], backgroundColor: COLORS.kv + 'CC', borderColor: COLORS.kv, borderWidth: 1 });
        datasets.push({ label: 'Activations', data: [r.act.activation_per_gpu_gb, 0], backgroundColor: COLORS.activations + 'CC', borderColor: COLORS.activations, borderWidth: 1 });
        const unusedBudget = Math.max(0, r.vllmAvailable);
        if (unusedBudget > 0.01) {
            datasets.push({ label: 'Available', data: [unusedBudget, 0], backgroundColor: COLORS.unused + '33', borderColor: COLORS.unused + '88', borderWidth: 1 });
        }

        // --- Outside budget components (row 1 only) ---
        if (r.showCUDAGraphs) {
            datasets.push({ label: 'CUDA Graphs', data: [0, r.cudaPerRank], backgroundColor: COLORS.cuda + 'CC', borderColor: COLORS.cuda, borderWidth: 1 });
        }
        if (r.showFrameworkOH) {
            datasets.push({ label: 'Framework OH', data: [0, r.fwPerRank], backgroundColor: COLORS.framework + 'CC', borderColor: COLORS.framework, borderWidth: 1 });
        }
        datasets.push({ label: 'cuFile Buffer', data: [0, r.cufileBufferGB], backgroundColor: COLORS.cufile + 'CC', borderColor: COLORS.cufile, borderWidth: 1 });
        datasets.push({ label: 'Driver/Context', data: [0, r.driverContext], backgroundColor: COLORS.driver + 'CC', borderColor: COLORS.driver, borderWidth: 1 });
        const unusedReserve = Math.max(0, r.outsideAvailable);
        if (unusedReserve > 0.01) {
            datasets.push({ label: 'Available', data: [0, unusedReserve], backgroundColor: COLORS.unused + '33', borderColor: COLORS.unused + '88', borderWidth: 1 });
        }

        // Compute the max value any bar reaches so we can set x-axis to show overflow
        const vllmTotal = r.weightsPerRankGB + r.kv.kv_cache_per_gpu_gb + r.act.activation_per_gpu_gb;
        const outsideTotal = (r.showCUDAGraphs ? r.cudaPerRank : 0) + (r.showFrameworkOH ? r.fwPerRank : 0) + r.cufileBufferGB + r.driverContext;
        const maxBarValue = Math.max(vllmTotal, r.vllmAllocated, outsideTotal, r.systemReserved);
        const xMax = Math.max(r.gpuMemoryGB, maxBarValue) * 1.02;

        stackChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [
                    `vLLM Budget (${utilPct}%) \u2014 ${r.vllmAllocated.toFixed(1)} GB`,
                    `Outside Budget \u2014 ${r.systemReserved.toFixed(1)} GB`
                ],
                datasets
            },
            options: {
                responsive: true,
                indexAxis: 'y',
                layout: { padding: { top: 4, bottom: 4 } },
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: 'Memory (GB)', color: '#aaa' },
                        ticks: { color: '#aaa' },
                        grid: { color: '#333' },
                        min: 0,
                        max: xMax
                    },
                    y: {
                        stacked: true,
                        ticks: { color: '#ccc', font: { size: 11, weight: 'bold' } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    title: { display: true, text: `GPU Memory \u2014 ${r.gpuMemoryGB.toFixed(1)} GB (Per Rank)`, color: '#fff', font: { size: 13 } },
                    legend: {
                        display: true, position: 'bottom',
                        labels: {
                            color: '#ccc', font: { size: 10 }, boxWidth: 12,
                            filter: (item, data) => {
                                if (item.text === 'Available' && item.datasetIndex !== datasets.findIndex(d => d.label === 'Available')) return false;
                                return true;
                            }
                        }
                    },
                    tooltip: { callbacks: { label: tooltipCtx => {
                        const v = tooltipCtx.parsed.x;
                        if (v < 0.01) return null;
                        const zone = tooltipCtx.dataIndex === 0 ? r.vllmAllocated : r.systemReserved;
                        return `${tooltipCtx.dataset.label}: ${v.toFixed(2)} GB (${((v / zone) * 100).toFixed(1)}% of zone)`;
                    }}}
                }
            },
            plugins: [{
                id: 'budgetBoxes',
                beforeDatasetsDraw(chart) {
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;
                    const drawCtx = chart.ctx;
                    drawCtx.save();

                    // For each row, draw a bounding box at the zone's allocation limit.
                    // The box extends from x=0 to x=zoneAllocation, and vertically
                    // a bit wider than the bar so it clearly encompasses the components.
                    const zones = [
                        { index: 0, limit: r.vllmAllocated, color: '#4ECDC4', label: `${r.vllmAllocated.toFixed(1)} GB` },
                        { index: 1, limit: r.systemReserved, color: '#898A8A', label: `${r.systemReserved.toFixed(1)} GB` }
                    ];

                    // Find bar height from first dataset's first element
                    const barMeta = chart.getDatasetMeta(0);
                    if (!barMeta.data.length) { drawCtx.restore(); return; }
                    const barHeight = barMeta.data[0].height || 30;
                    const pad = 6; // extra padding around bar

                    for (const zone of zones) {
                        const barElement = barMeta.data[zone.index];
                        if (!barElement) continue;

                        const xLeft = xScale.getPixelForValue(0);
                        const xRight = xScale.getPixelForValue(zone.limit);
                        const yCenter = barElement.y;
                        const yTop = yCenter - barHeight / 2 - pad;
                        const yBottom = yCenter + barHeight / 2 + pad;

                        // Draw the bounding box
                        drawCtx.strokeStyle = zone.color;
                        drawCtx.lineWidth = 2;
                        drawCtx.setLineDash([]);
                        drawCtx.strokeRect(xLeft, yTop, xRight - xLeft, yBottom - yTop);

                        // Label at top-right corner of box
                        drawCtx.font = '10px monospace';
                        drawCtx.fillStyle = zone.color;
                        drawCtx.textBaseline = 'bottom';
                        drawCtx.textAlign = 'right';
                        drawCtx.fillText(zone.label, xRight, yTop - 2);
                    }

                    drawCtx.restore();
                }
            }]
        });
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------
    function copyReport() {
        if (!lastReport) return;
        navigator.clipboard.writeText(lastReport);
    }

    function downloadReport() {
        if (!lastReport) return;
        const blob = new Blob([lastReport], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gpu_memory_${currentTitle.replace(/[/\s]/g, '_')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------
    function cleanup() {
        clearTimeout(calcTimeout);
        if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
        if (stackChartInstance) { stackChartInstance.destroy(); stackChartInstance = null; }
    }

    render();
    return cleanup;
}
