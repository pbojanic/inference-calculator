// ---------------------------------------------------------------------------
// Plan page: capacity planning for inference workloads
// Calculates KV cache storage size and IO throughput (GiB/s)
// ---------------------------------------------------------------------------

const LS_PLAN_KEY = 'gpu_calc_plan';

// Context size presets for distribution buckets — log-spaced, each mapped to a
// recognizable use case so a sales engineer can pick a realistic workload.
const CONTEXT_PRESETS = [
    { value: 512,     label: '512 · Short Q&A',  title: 'Single query / FAQ' },
    { value: 2048,    label: '2K · Chat',        title: 'Standard chat turn' },
    { value: 8192,    label: '8K · Support',     title: 'Long chat / support transcript' },
    { value: 16384,   label: '16K · Summarize',  title: 'Document summarization' },
    { value: 32768,   label: '32K · RAG',        title: 'Multi-doc RAG' },
    { value: 131072,  label: '128K · Book',      title: 'Full book / large codebase' },
    { value: 204800,  label: '200K · Agent',     title: 'Long-context agent (Claude-class)' },
    { value: 1048576, label: '1M · Repo',        title: 'Frontier long-context (full repo)' },
];

function formatContextTokens(n) {
    if (n >= 1048576) return `${Math.round(n / 1048576)}M`;
    if (n >= 1024) return `${Math.round(n / 1024)}K`;
    return `${n}`;
}

function _getPlanStore() {
    const raw = localStorage.getItem(LS_PLAN_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
}

function _savePlanStore(store) {
    localStorage.setItem(LS_PLAN_KEY, JSON.stringify(store));
}

function defaultPlanEntry(workspaceId) {
    return {
        workspaceId,
        serverInstances: 1,
        totalUsersLow: 100,
        totalUsersHigh: 100,
        concurrentUsersLow: 10,
        concurrentUsersHigh: 10,
        exchangesPerUserLow: 50,
        exchangesPerUserHigh: 50,
        exchangeRatePerHourLow: 10,
        exchangeRatePerHourHigh: 10,
        distribution: [
            { contextSize: 500, percentage: 100, cacheHitRate: 0 }
        ]
    };
}

// Sync plan store with current workspace: remove orphans, add defaults for new models
function syncPlanWithWorkspace() {
    const workspaceModels = getWorkspaceModels();
    const wsIds = new Set(workspaceModels.map(m => m.id));
    const store = _getPlanStore();

    // Remove orphaned entries
    for (const id of Object.keys(store)) {
        if (!wsIds.has(id)) delete store[id];
    }

    // Add defaults for new models
    for (const model of workspaceModels) {
        if (!store[model.id]) {
            store[model.id] = defaultPlanEntry(model.id);
        }
    }

    // Migrate older plans. Two historical shapes are possible:
    //   1. Single point estimate per input (pre-triples): seed low and high to the point.
    //   2. Triple {low, expected, high}: keep low/high and drop the Expected field.
    // After migration only `*Low` and `*High` fields remain.
    for (const plan of Object.values(store)) {
        if (plan.totalUsersLow === undefined) plan.totalUsersLow = plan.totalUsers ?? 100;
        if (plan.totalUsersHigh === undefined) plan.totalUsersHigh = plan.totalUsers ?? 100;
        if (plan.concurrentUsersLow === undefined) plan.concurrentUsersLow = plan.concurrentUsers ?? 10;
        if (plan.concurrentUsersHigh === undefined) plan.concurrentUsersHigh = plan.concurrentUsers ?? 10;
        if (plan.exchangesPerUserLow === undefined) plan.exchangesPerUserLow = plan.exchangesPerUser ?? 50;
        if (plan.exchangesPerUserHigh === undefined) plan.exchangesPerUserHigh = plan.exchangesPerUser ?? 50;
        if (plan.exchangeRatePerHourLow === undefined) plan.exchangeRatePerHourLow = plan.exchangeRatePerHour ?? 10;
        if (plan.exchangeRatePerHourHigh === undefined) plan.exchangeRatePerHourHigh = plan.exchangeRatePerHour ?? 10;
        delete plan.totalUsers;
        delete plan.concurrentUsers;
        delete plan.exchangesPerUser;
        delete plan.exchangeRatePerHour;
    }

    _savePlanStore(store);
    return store;
}

// Get the max allowed context size for a workspace entry
// Bounded by the user's configured sequence length, not by sliding window
// (sliding window caps KV cache size per layer, not the sequence length)
function getMaxContextForEntry(entry) {
    const dep = entry.deployment;
    return (dep && dep.seqLen) || entry.config.max_position_embeddings || 131072;
}

// Validate a plan entry against its workspace entry. Returns array of error strings.
function validatePlanEntry(plan, maxContext) {
    const errors = [];

    if (!Number.isInteger(plan.serverInstances) || plan.serverInstances < 1)
        errors.push('Server instances must be at least 1');

    // Scenario-range validation: each fuzzy input is a {low, high} pair.
    if (!Number.isInteger(plan.totalUsersLow) || plan.totalUsersLow < 1)
        errors.push('Total users (low) must be a positive integer');
    if (!Number.isInteger(plan.totalUsersHigh) || plan.totalUsersHigh < 1)
        errors.push('Total users (high) must be a positive integer');
    if (plan.totalUsersLow > plan.totalUsersHigh)
        errors.push('Total users: low must not exceed high');

    if (!Number.isInteger(plan.concurrentUsersLow) || plan.concurrentUsersLow < 1)
        errors.push('Concurrent users (low) must be a positive integer');
    if (!Number.isInteger(plan.concurrentUsersHigh) || plan.concurrentUsersHigh < 1)
        errors.push('Concurrent users (high) must be a positive integer');
    if (plan.concurrentUsersLow > plan.concurrentUsersHigh)
        errors.push('Concurrent users: low must not exceed high');
    if (plan.concurrentUsersLow > plan.totalUsersLow)
        errors.push('Concurrent users (low) cannot exceed Total users (low)');
    if (plan.concurrentUsersHigh > plan.totalUsersHigh)
        errors.push('Concurrent users (high) cannot exceed Total users (high)');

    if (!Number.isInteger(plan.exchangesPerUserLow) || plan.exchangesPerUserLow < 1)
        errors.push('Exchanges per user (low) must be a positive integer');
    if (!Number.isInteger(plan.exchangesPerUserHigh) || plan.exchangesPerUserHigh < 1)
        errors.push('Exchanges per user (high) must be a positive integer');
    if (plan.exchangesPerUserLow > plan.exchangesPerUserHigh)
        errors.push('Exchanges per user: low must not exceed high');

    if (typeof plan.exchangeRatePerHourLow !== 'number' || plan.exchangeRatePerHourLow <= 0)
        errors.push('Exchange rate (low) must be greater than 0');
    if (typeof plan.exchangeRatePerHourHigh !== 'number' || plan.exchangeRatePerHourHigh <= 0)
        errors.push('Exchange rate (high) must be greater than 0');
    if (plan.exchangeRatePerHourLow > plan.exchangeRatePerHourHigh)
        errors.push('Exchange rate: low must not exceed high');

    const pctSum = plan.distribution.reduce((s, b) => s + b.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01)
        errors.push(`Distribution must sum to 100% (currently ${pctSum.toFixed(1)}%)`);

    const seenSizes = new Set();
    for (const bucket of plan.distribution) {
        if (!Number.isInteger(bucket.contextSize) || bucket.contextSize < 1)
            errors.push(`Context size must be a positive integer`);
        if (bucket.contextSize > maxContext)
            errors.push(`Context size ${bucket.contextSize.toLocaleString()} exceeds max ${maxContext.toLocaleString()}`);
        if (seenSizes.has(bucket.contextSize))
            errors.push(`Duplicate context size: ${bucket.contextSize.toLocaleString()}`);
        seenSizes.add(bucket.contextSize);
        if (bucket.percentage < 0 || bucket.percentage > 100)
            errors.push(`Percentage must be 0–100`);
        if (bucket.cacheHitRate < 0 || bucket.cacheHitRate > 100)
            errors.push(`Cache hit rate must be 0–100`);
    }

    return errors;
}


// ---------------------------------------------------------------------------
// Page renderer
// ---------------------------------------------------------------------------
function renderPlanPage(container) {
    let planData = {};       // working copy (unsaved)
    let savedData = {};      // last saved snapshot
    let debounceTimer = null;

    // Stable DOM references for live-updating outputs (no full re-render needed)
    // Keyed by workspace model ID
    const cardOutputs = {};  // { wsId: { resultsDiv, errorsDiv, detailsDiv, pctSumCell, kvCells[], ctxInputs[] } }
    let rollupPanel = null;
    let rollupDetailsDiv = null;
    let showDetailsCheckbox = null;
    let saveBtnRef = null;

    function loadData() {
        savedData = syncPlanWithWorkspace();
        planData = JSON.parse(JSON.stringify(savedData));
    }

    function markDirty() {
        State.setDirty(true);
    }

    // -----------------------------------------------------------------------
    // Full render — only called on initial load, add/remove bucket, cancel
    // -----------------------------------------------------------------------
    function render() {
        container.innerHTML = '';
        Object.keys(cardOutputs).forEach(k => delete cardOutputs[k]);
        rollupPanel = null;
        rollupDetailsDiv = null;
        saveBtnRef = null;

        const workspaceModels = getWorkspaceModels();

        // Empty state
        if (workspaceModels.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = 'No models in workspace. <a href="#home" style="color: var(--accent);">Add models</a> to start planning.';
            container.appendChild(empty);
            return;
        }

        const title = document.createElement('h2');
        title.style.cssText = 'margin: 0 0 12px; border: none; padding: 0;';
        title.textContent = 'Capacity Plan';
        container.appendChild(title);

        for (const wsEntry of workspaceModels) {
            const plan = planData[wsEntry.id];
            if (!plan) continue;
            container.appendChild(buildModelCard(wsEntry, plan));
        }

        // Show details toggle
        const toggleRow = document.createElement('div');
        toggleRow.className = 'toggle-row';
        toggleRow.style.marginTop = '12px';
        showDetailsCheckbox = document.createElement('input');
        showDetailsCheckbox.type = 'checkbox';
        showDetailsCheckbox.id = 'plan-show-details';
        const toggleLabel = document.createElement('label');
        toggleLabel.htmlFor = 'plan-show-details';
        toggleLabel.textContent = 'Show calculation details';
        showDetailsCheckbox.onchange = () => updateOutputs();
        toggleRow.appendChild(showDetailsCheckbox);
        toggleRow.appendChild(toggleLabel);
        container.appendChild(toggleRow);

        // Roll-up placeholder
        rollupPanel = document.createElement('div');
        rollupPanel.className = 'panel plan-rollup';
        container.appendChild(rollupPanel);

        // Roll-up details placeholder
        rollupDetailsDiv = document.createElement('div');
        rollupDetailsDiv.className = 'plan-details';
        rollupPanel.appendChild(rollupDetailsDiv);

        // Save / Cancel buttons
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.style.marginTop = '16px';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-primary';
        saveBtn.textContent = 'Save';
        saveBtn.onclick = () => {
            _savePlanStore(planData);
            savedData = JSON.parse(JSON.stringify(planData));
            State.setDirty(false);
        };
        saveBtnRef = saveBtn;
        actions.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            planData = JSON.parse(JSON.stringify(savedData));
            State.setDirty(false);
            render();
        };
        actions.appendChild(cancelBtn);

        container.appendChild(actions);

        // Initial calculation update
        updateOutputs();
    }

    // -----------------------------------------------------------------------
    // Lightweight output update — updates results, errors, KV cells, rollup
    // without touching inputs or rebuilding the DOM
    // -----------------------------------------------------------------------
    function updateOutputs() {
        const showDetails = showDetailsCheckbox ? showDetailsCheckbox.checked : false;
        const workspaceModels = getWorkspaceModels();
        const allResults = [];
        let hasErrors = false;

        for (const wsEntry of workspaceModels) {
            const plan = planData[wsEntry.id];
            const refs = cardOutputs[wsEntry.id];
            if (!plan || !refs) continue;

            const maxCtx = getMaxContextForEntry(wsEntry);
            const errors = validatePlanEntry(plan, maxCtx);
            if (errors.length > 0) hasErrors = true;

            // Update errors div
            refs.errorsDiv.innerHTML = errors.map(e => `<div class="status-err">${e}</div>`).join('');

            // Update percentage sum
            const pctSum = plan.distribution.reduce((s, b) => s + b.percentage, 0);
            const sumOk = Math.abs(pctSum - 100) < 0.01;
            refs.pctSumCell.className = sumOk ? 'status-ok' : 'status-err';
            refs.pctSumCell.style.fontSize = '0.8rem';
            refs.pctSumCell.style.fontWeight = '600';
            refs.pctSumCell.textContent = `Sum: ${pctSum.toFixed(1)}%${sumOk ? '' : ' (must be 100%)'}`;

            // Update KV cache per sequence cells
            const bytesPerKV = (wsEntry.deployment && wsEntry.deployment.bytesPerKV) || 2;
            for (let i = 0; i < plan.distribution.length; i++) {
                const cell = refs.kvCells[i];
                if (!cell) continue;
                try {
                    const kvBytes = kvCacheBytesForContext(wsEntry.config, plan.distribution[i].contextSize, bytesPerKV);
                    cell.textContent = formatSizeHuman(kvBytes);
                } catch (e) {
                    cell.textContent = '—';
                }
            }

            // Update context size input borders
            for (let i = 0; i < plan.distribution.length; i++) {
                const input = refs.ctxInputs[i];
                if (!input) continue;
                input.style.borderColor = plan.distribution[i].contextSize > maxCtx ? '#F04E23' : '';
            }

            // Update derived GPU count readout next to Server instances input
            const tp = (wsEntry.deployment && wsEntry.deployment.tp) || 1;
            const gpus = plan.serverInstances * tp;
            if (refs.gpuCountSpan) {
                refs.gpuCountSpan.textContent = tp > 1
                    ? `→ ${gpus} GPUs (TP=${tp})`
                    : `→ ${gpus} GPUs`;
            }

            // Calculate both bounds (Low and High) and render each result
            // as a range.
            const resultLow = calcAtBound(plan, wsEntry, 'Low');
            const resultHigh = calcAtBound(plan, wsEntry, 'High');

            if (resultLow && resultHigh) {
                allResults.push({ resultLow, resultHigh, wsEntry, plan, gpus, tp });
                refs.resultsDiv.innerHTML = `
                    <div class="plan-result-row">
                        <span class="plan-result-label">KV Cache Size:</span>
                        <span class="plan-result-value">${formatRangeSize(resultLow.totalKVSizeBytes, resultHigh.totalKVSizeBytes)}</span>
                    </div>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Write Throughput:</span>
                        <span class="plan-result-value">${formatRangeThroughput(resultLow.totalWriteGiBps, resultHigh.totalWriteGiBps)}</span>
                    </div>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Read Throughput:</span>
                        <span class="plan-result-value">${formatRangeThroughput(resultLow.totalReadGiBps, resultHigh.totalReadGiBps)}</span>
                    </div>
                `;
                refs.detailsDiv.innerHTML = showDetails ? buildDetailHTML(resultLow, resultHigh, plan, wsEntry) : '';
            } else {
                refs.resultsDiv.innerHTML = '';
                refs.detailsDiv.innerHTML = '';
            }
        }

        // Update roll-up
        if (rollupPanel) {
            if (allResults.length > 0) {
                const rollupLow = calculatePlanRollup(allResults.map(r => r.resultLow));
                const rollupHigh = calculatePlanRollup(allResults.map(r => r.resultHigh));
                const totalGpus = allResults.reduce((s, r) => s + r.gpus, 0);
                let rollupHTML = `
                    <h2 style="margin-top: 0;">Aggregate</h2>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Total GPUs:</span>
                        <span class="plan-result-value">${totalGpus}</span>
                    </div>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Total KV Cache Size:</span>
                        <span class="plan-result-value">${formatRangeSize(rollupLow.totalKVSizeBytes, rollupHigh.totalKVSizeBytes)}</span>
                    </div>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Total Write Throughput:</span>
                        <span class="plan-result-value">${formatRangeThroughput(rollupLow.totalWriteGiBps, rollupHigh.totalWriteGiBps)}</span>
                    </div>
                    <div class="plan-result-row">
                        <span class="plan-result-label">Total Read Throughput:</span>
                        <span class="plan-result-value">${formatRangeThroughput(rollupLow.totalReadGiBps, rollupHigh.totalReadGiBps)}</span>
                    </div>
                `;
                if (showDetails) {
                    rollupHTML += '<div class="plan-details">' + buildRollupDetailHTML(allResults) + '</div>';
                }
                rollupPanel.innerHTML = rollupHTML;
                rollupPanel.style.display = '';
            } else {
                rollupPanel.style.display = 'none';
            }
        }

        // Update save button state
        if (saveBtnRef) {
            saveBtnRef.disabled = hasErrors;
        }
    }

    // -----------------------------------------------------------------------
    // Model card — builds the full card with stable output references
    // -----------------------------------------------------------------------
    function buildModelCard(wsEntry, plan) {
        const maxCtx = getMaxContextForEntry(wsEntry);

        const card = document.createElement('div');
        card.className = 'panel plan-card';

        // Header
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

        // Input fields row
        const inputRow = document.createElement('div');
        inputRow.className = 'plan-inputs-row';

        const serverInstancesField = buildNumberField('Server instances', plan.serverInstances, 1, null, true, v => {
            plan.serverInstances = v; markDirty(); scheduleRecalc();
        });
        const gpuCountSpan = document.createElement('span');
        gpuCountSpan.className = 'gpu-count-display';
        serverInstancesField.appendChild(gpuCountSpan);
        inputRow.appendChild(serverInstancesField);
        inputRow.appendChild(buildRangeField(
            'Total users',
            plan.totalUsersLow, plan.totalUsersHigh,
            true,
            (which, v) => {
                if (which === 'low') plan.totalUsersLow = v;
                else plan.totalUsersHigh = v;
                markDirty(); scheduleRecalc();
            }
        ));
        inputRow.appendChild(buildRangeField(
            'Concurrent users',
            plan.concurrentUsersLow, plan.concurrentUsersHigh,
            true,
            (which, v) => {
                if (which === 'low') plan.concurrentUsersLow = v;
                else plan.concurrentUsersHigh = v;
                markDirty(); scheduleRecalc();
            }
        ));
        inputRow.appendChild(buildRangeField(
            'Exchanges/user',
            plan.exchangesPerUserLow, plan.exchangesPerUserHigh,
            true,
            (which, v) => {
                if (which === 'low') plan.exchangesPerUserLow = v;
                else plan.exchangesPerUserHigh = v;
                markDirty(); scheduleRecalc();
            }
        ));
        inputRow.appendChild(buildRangeField(
            'Rate/hr/user',
            plan.exchangeRatePerHourLow, plan.exchangeRatePerHourHigh,
            false,
            (which, v) => {
                if (which === 'low') plan.exchangeRatePerHourLow = v;
                else plan.exchangeRatePerHourHigh = v;
                markDirty(); scheduleRecalc();
            }
        ));

        card.appendChild(inputRow);

        // Distribution table
        const distSection = document.createElement('div');
        distSection.style.marginTop = '12px';

        const distHeader = document.createElement('h3');
        distHeader.textContent = 'Input Token Distribution';
        distHeader.style.marginBottom = '6px';
        distSection.appendChild(distHeader);

        const table = document.createElement('table');
        table.className = 'distribution-table';

        const thead = document.createElement('thead');
        thead.innerHTML = `<tr>
            <th>Context Size</th>
            <th>% of Exchanges</th>
            <th>Cache Hit Rate %</th>
            <th>KV Cache/seq</th>
            <th></th>
        </tr>`;
        table.appendChild(thead);

        // Track output cells per row
        const kvCells = [];
        const ctxInputs = [];

        const tbody = document.createElement('tbody');
        for (let i = 0; i < plan.distribution.length; i++) {
            const { tr, kvCell, ctxInput } = buildDistRow(plan, i, maxCtx, wsEntry);
            tbody.appendChild(tr);
            kvCells.push(kvCell);
            ctxInputs.push(ctxInput);
        }
        table.appendChild(tbody);

        // Footer: percentage sum (stable reference)
        const tfoot = document.createElement('tfoot');
        const sumRow = document.createElement('tr');
        const emptyTd = document.createElement('td');
        const pctSumCell = document.createElement('td');
        const restTd = document.createElement('td');
        restTd.colSpan = 3;
        sumRow.appendChild(emptyTd);
        sumRow.appendChild(pctSumCell);
        sumRow.appendChild(restTd);
        tfoot.appendChild(sumRow);
        table.appendChild(tfoot);

        distSection.appendChild(table);

        // Add bucket button
        const addBucketBtn = document.createElement('button');
        addBucketBtn.className = 'btn-secondary btn-small';
        addBucketBtn.textContent = 'Add Bucket';
        addBucketBtn.style.marginTop = '6px';
        addBucketBtn.onclick = () => {
            plan.distribution.push({ contextSize: 1000, percentage: 0, cacheHitRate: 0 });
            markDirty();
            render(); // full re-render needed for structural change
        };
        distSection.appendChild(addBucketBtn);

        card.appendChild(distSection);

        // Errors placeholder (stable reference)
        const errorsDiv = document.createElement('div');
        errorsDiv.style.marginTop = '8px';
        card.appendChild(errorsDiv);

        // Results placeholder (stable reference)
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'plan-results';
        card.appendChild(resultsDiv);

        // Calculation details placeholder (stable reference, shown via toggle)
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'plan-details';
        card.appendChild(detailsDiv);

        // Store stable output references
        cardOutputs[wsEntry.id] = { resultsDiv, errorsDiv, detailsDiv, pctSumCell, kvCells, ctxInputs, gpuCountSpan };

        return card;
    }

    // -----------------------------------------------------------------------
    // Distribution row — returns { tr, kvCell, ctxInput } for output tracking
    // -----------------------------------------------------------------------
    function buildDistRow(plan, idx, maxCtx, wsEntry) {
        const bucket = plan.distribution[idx];
        const tr = document.createElement('tr');

        // Context size
        const tdCtx = document.createElement('td');
        const ctxInput = document.createElement('input');
        ctxInput.type = 'number';
        ctxInput.value = bucket.contextSize;
        ctxInput.min = 1;
        ctxInput.max = maxCtx;
        ctxInput.step = 1;
        ctxInput.oninput = () => {
            bucket.contextSize = parseInt(ctxInput.value) || 0;
            markDirty(); scheduleRecalc();
        };

        // Preset chip row — fills the input on click; chips over the model's
        // max context render disabled with a tooltip explaining the limit.
        const presetRow = document.createElement('div');
        presetRow.className = 'context-preset-row';
        for (const preset of CONTEXT_PRESETS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'context-preset-chip';
            chip.textContent = preset.label;
            if (preset.value > maxCtx) {
                chip.disabled = true;
                chip.classList.add('context-preset-chip--over-limit');
                chip.title = `Exceeds model's ${formatContextTokens(maxCtx)} context`;
            } else {
                chip.title = preset.title;
                chip.onclick = () => {
                    ctxInput.value = preset.value;
                    ctxInput.dispatchEvent(new Event('input', { bubbles: true }));
                };
            }
            presetRow.appendChild(chip);
        }
        tdCtx.appendChild(presetRow);
        tdCtx.appendChild(ctxInput);
        tr.appendChild(tdCtx);

        // Percentage
        const tdPct = document.createElement('td');
        const pctInput = document.createElement('input');
        pctInput.type = 'number';
        pctInput.value = bucket.percentage;
        pctInput.min = 0;
        pctInput.max = 100;
        pctInput.step = 0.1;
        pctInput.oninput = () => {
            bucket.percentage = parseFloat(pctInput.value) || 0;
            markDirty(); scheduleRecalc();
        };
        tdPct.appendChild(pctInput);
        tr.appendChild(tdPct);

        // Cache hit rate
        const tdHit = document.createElement('td');
        const hitInput = document.createElement('input');
        hitInput.type = 'number';
        hitInput.value = bucket.cacheHitRate;
        hitInput.min = 0;
        hitInput.max = 100;
        hitInput.step = 1;
        hitInput.oninput = () => {
            bucket.cacheHitRate = parseFloat(hitInput.value) || 0;
            markDirty(); scheduleRecalc();
        };
        tdHit.appendChild(hitInput);
        tr.appendChild(tdHit);

        // KV cache per sequence (read-only output cell)
        const kvCell = document.createElement('td');
        kvCell.style.fontSize = '0.8rem';
        kvCell.style.color = 'var(--text-muted)';
        tr.appendChild(kvCell);

        // Remove button
        const tdRm = document.createElement('td');
        const rmBtn = document.createElement('button');
        rmBtn.className = 'btn-danger btn-small';
        rmBtn.textContent = '×';
        rmBtn.disabled = plan.distribution.length <= 1;
        rmBtn.onclick = () => {
            plan.distribution.splice(idx, 1);
            markDirty();
            render(); // full re-render for structural change
        };
        tdRm.appendChild(rmBtn);
        tr.appendChild(tdRm);

        return { tr, kvCell, ctxInput };
    }

    // -----------------------------------------------------------------------
    // Number input field builder
    // -----------------------------------------------------------------------
    function buildNumberField(labelText, value, min, max, isInt, onChange) {
        const wrapper = document.createElement('label');
        wrapper.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        if (min !== null) input.min = min;
        if (max !== null) input.max = max;
        input.step = isInt ? 1 : 0.1;
        input.oninput = () => {
            const v = isInt ? parseInt(input.value) : parseFloat(input.value);
            if (!isNaN(v)) onChange(v);
        };
        wrapper.appendChild(input);
        return wrapper;
    }

    // Range (low / high) field builder. onChange receives (which, value)
    // where which is 'low' | 'high'.
    function buildRangeField(labelText, lowValue, highValue, isInt, onChange) {
        const wrapper = document.createElement('label');
        wrapper.textContent = labelText;
        const row = document.createElement('div');
        row.className = 'plan-range';

        const makeInput = (value, which, title) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.min = isInt ? 1 : 0.1;
            input.step = isInt ? 1 : 0.1;
            input.title = title;
            input.oninput = () => {
                const v = isInt ? parseInt(input.value) : parseFloat(input.value);
                if (!isNaN(v)) onChange(which, v);
            };
            return input;
        };

        row.appendChild(makeInput(lowValue, 'low', 'Low / conservative'));
        row.appendChild(makeInput(highValue, 'high', 'High / aggressive'));
        wrapper.appendChild(row);
        return wrapper;
    }

    // -----------------------------------------------------------------------
    // Scenario-range helpers
    // -----------------------------------------------------------------------

    // Build a point-estimate plan object for a given bound ('Low' or 'High')
    // suitable for passing to calculator.js functions that expect the legacy
    // single-value field names (totalUsers, concurrentUsers, etc.).
    function planAtBound(plan, bound) {
        return {
            ...plan,
            totalUsers: plan[`totalUsers${bound}`],
            concurrentUsers: plan[`concurrentUsers${bound}`],
            exchangesPerUser: plan[`exchangesPerUser${bound}`],
            exchangeRatePerHour: plan[`exchangeRatePerHour${bound}`]
        };
    }

    function calcAtBound(plan, wsEntry, bound) {
        try {
            return calculatePlanEntry(planAtBound(plan, bound), wsEntry);
        } catch (e) {
            return null;
        }
    }

    function formatRangeSize(lowBytes, highBytes) {
        if (Math.abs(highBytes - lowBytes) < 1) return formatSizeHuman(lowBytes);
        return `${formatSizeHuman(lowBytes)} – ${formatSizeHuman(highBytes)}`;
    }

    function formatRangeThroughput(lowGiBps, highGiBps) {
        if (Math.abs(highGiBps - lowGiBps) < 1e-9) return formatThroughputHuman(lowGiBps);
        return `${formatThroughputHuman(lowGiBps)} – ${formatThroughputHuman(highGiBps)}`;
    }

    function formatRangeCount(lowN, highN) {
        const lo = Math.round(lowN).toLocaleString();
        const hi = Math.round(highN).toLocaleString();
        return lo === hi ? lo : `${lo} – ${hi}`;
    }

    function formatRangeFloat(lowN, highN, decimals = 3) {
        const lo = lowN.toFixed(decimals);
        const hi = highN.toFixed(decimals);
        return lo === hi ? lo : `${lo} – ${hi}`;
    }

    // -----------------------------------------------------------------------
    // Detail breakdown HTML for a single model — renders both bounds in parallel
    // -----------------------------------------------------------------------
    function buildDetailHTML(resultLow, resultHigh, plan, wsEntry) {
        const lines = [];

        lines.push('<h3 style="margin-top: 10px;">Calculation Details</h3>');

        // KV Cache Size derivation — one substituted line per bound
        const totalExchLow  = plan.totalUsersLow  * plan.exchangesPerUserLow;
        const totalExchHigh = plan.totalUsersHigh * plan.exchangesPerUserHigh;
        const kvPreamble =
            `total_exchanges_low  = ${plan.totalUsersLow.toLocaleString()} × ${plan.exchangesPerUserLow.toLocaleString()} = ${totalExchLow.toLocaleString()} stored exchanges\n` +
            `total_exchanges_high = ${plan.totalUsersHigh.toLocaleString()} × ${plan.exchangesPerUserHigh.toLocaleString()} = ${totalExchHigh.toLocaleString()} stored exchanges`;

        lines.push('<div class="plan-detail-section">');
        lines.push('<strong>KV Cache Size</strong>');
        lines.push(`<div class="plan-detail-formula">${kvPreamble}</div>`);

        lines.push('<div class="plan-detail-table-wrap">');
        lines.push('<table class="plan-detail-table"><thead><tr><th>Context Size</th><th>%</th><th>Exchanges</th><th>KV/seq</th><th>Subtotal</th></tr></thead><tbody>');
        for (let i = 0; i < resultLow.bucketDetails.length; i++) {
            const bL = resultLow.bucketDetails[i];
            const bH = resultHigh.bucketDetails[i];
            lines.push(
                `<tr><td>${bL.contextSize.toLocaleString()}</td>` +
                `<td>${bL.percentage}%</td>` +
                `<td>${formatRangeCount(bL.exchanges, bH.exchanges)}</td>` +
                `<td>${formatSizeHuman(bL.kvBytesPerSeq)}</td>` +
                `<td>${formatRangeSize(bL.sizeBytes, bH.sizeBytes)}</td></tr>`
            );
        }
        lines.push(`</tbody><tfoot><tr><td colspan="4" style="text-align: right; font-weight: 600;">Total:</td><td style="font-weight: 600;">${formatRangeSize(resultLow.totalKVSizeBytes, resultHigh.totalKVSizeBytes)}</td></tr></tfoot></table>`);
        lines.push('</div>');
        lines.push('</div>');

        // Throughput derivation — one substituted line per bound
        const rateLowPerSec  = plan.serverInstances * plan.concurrentUsersLow  * plan.exchangeRatePerHourLow  / 3600;
        const rateHighPerSec = plan.serverInstances * plan.concurrentUsersHigh * plan.exchangeRatePerHourHigh / 3600;
        const tpPreamble =
            `aggregate_exchanges_per_sec_low  = ${plan.serverInstances} × ${plan.concurrentUsersLow} × ${plan.exchangeRatePerHourLow} ÷ 3600 = ${rateLowPerSec.toFixed(3)} exchanges/sec\n` +
            `aggregate_exchanges_per_sec_high = ${plan.serverInstances} × ${plan.concurrentUsersHigh} × ${plan.exchangeRatePerHourHigh} ÷ 3600 = ${rateHighPerSec.toFixed(3)} exchanges/sec`;

        lines.push('<div class="plan-detail-section">');
        lines.push('<strong>Throughput</strong>');
        lines.push(`<div class="plan-detail-formula">${tpPreamble}</div>`);

        lines.push('<div class="plan-detail-table-wrap">');
        lines.push('<table class="plan-detail-table"><thead><tr><th>Context Size</th><th>%</th><th>Exch/sec</th><th>Hit Rate</th><th>Hits/sec</th><th>Misses/sec</th><th>Write</th><th>Read</th></tr></thead><tbody>');
        for (let i = 0; i < resultLow.bucketDetails.length; i++) {
            const bL = resultLow.bucketDetails[i];
            const bH = resultHigh.bucketDetails[i];
            const hitFrac = bL.cacheHitRate / 100;
            const hitsLowPerSec    = bL.exchangesPerSec * hitFrac;
            const hitsHighPerSec   = bH.exchangesPerSec * hitFrac;
            const missesLowPerSec  = bL.exchangesPerSec * (1 - hitFrac);
            const missesHighPerSec = bH.exchangesPerSec * (1 - hitFrac);
            lines.push(
                `<tr><td>${bL.contextSize.toLocaleString()}</td>` +
                `<td>${bL.percentage}%</td>` +
                `<td>${formatRangeFloat(bL.exchangesPerSec, bH.exchangesPerSec)}</td>` +
                `<td>${bL.cacheHitRate}%</td>` +
                `<td>${formatRangeFloat(hitsLowPerSec, hitsHighPerSec)}</td>` +
                `<td>${formatRangeFloat(missesLowPerSec, missesHighPerSec)}</td>` +
                `<td>${formatRangeThroughput(bL.writeBytesPerSec / (1024 ** 3), bH.writeBytesPerSec / (1024 ** 3))}</td>` +
                `<td>${formatRangeThroughput(bL.readBytesPerSec  / (1024 ** 3), bH.readBytesPerSec  / (1024 ** 3))}</td></tr>`
            );
        }
        lines.push(`</tbody><tfoot><tr><td colspan="6" style="text-align: right; font-weight: 600;">Total:</td><td style="font-weight: 600;">${formatRangeThroughput(resultLow.totalWriteGiBps, resultHigh.totalWriteGiBps)}</td><td style="font-weight: 600;">${formatRangeThroughput(resultLow.totalReadGiBps, resultHigh.totalReadGiBps)}</td></tr></tfoot></table>`);
        lines.push('</div>');
        lines.push('</div>');

        return lines.join('');
    }

    // -----------------------------------------------------------------------
    // Rollup detail: per-model contribution summary
    // -----------------------------------------------------------------------
    function buildRollupDetailHTML(allResults) {
        const lines = [];
        lines.push('<h3 style="margin-top: 10px;">Per-Model Breakdown</h3>');
        lines.push('<table class="plan-detail-table"><thead><tr><th>Model</th><th>GPUs</th><th>KV Cache Size</th><th>Write</th><th>Read</th></tr></thead><tbody>');
        for (const { resultLow, resultHigh, wsEntry, gpus, tp } of allResults) {
            const gpuCell = tp > 1 ? `${gpus} (TP=${tp})` : `${gpus}`;
            lines.push(
                `<tr><td>${wsEntry.title}</td>` +
                `<td>${gpuCell}</td>` +
                `<td>${formatRangeSize(resultLow.totalKVSizeBytes, resultHigh.totalKVSizeBytes)}</td>` +
                `<td>${formatRangeThroughput(resultLow.totalWriteGiBps, resultHigh.totalWriteGiBps)}</td>` +
                `<td>${formatRangeThroughput(resultLow.totalReadGiBps, resultHigh.totalReadGiBps)}</td></tr>`
            );
        }
        lines.push('</tbody></table>');
        return lines.join('');
    }

    // -----------------------------------------------------------------------
    // Debounced recalculation — only updates outputs, never rebuilds inputs
    // -----------------------------------------------------------------------
    function scheduleRecalc() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateOutputs, 200);
    }

    // Initial load and render
    loadData();
    render();

    // Return cleanup function
    return () => {
        clearTimeout(debounceTimer);
    };
}
