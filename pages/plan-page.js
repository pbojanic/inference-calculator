// ---------------------------------------------------------------------------
// Plan page: capacity planning for inference workloads
//
// Inputs are framed in inference-DC vocabulary:
//   - global planning horizon (days)
//   - per-model system instances (count of physical systems)
//   - per-model aggregate requests/sec (Average / Peak scenarios)
//   - per-model context-size distribution with cache hit rates
//
// Capacity = sustained writes × horizon (no system cap on storage).
// Throughput = aggregate rps split by hit rate, capped at
// `systemInstances × system.bandwidth` independently for read and write.
// Server-side fleet sizing reasoning lives entirely in the system concept;
// `serverInstances` from the v2 schema is gone.
// ---------------------------------------------------------------------------

const LS_PLAN_KEY = 'gpu_calc_plan';
// v3: serverInstances → systemInstances, depends on workspace systemId, and
// throughput capping at system bandwidth. v2 plan data is warn-and-reset.
const PLAN_VERSION = 3;
const DEFAULT_PLANNING_HORIZON_DAYS = 30;
const SECONDS_PER_DAY = 86400;

// Context size presets for distribution buckets.
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

function _defaultPlanData() {
    return {
        planningHorizonDays: DEFAULT_PLANNING_HORIZON_DAYS,
        entries: {}
    };
}

function _getPlanStore() {
    return loadVersionedPayload(
        LS_PLAN_KEY, PLAN_VERSION,
        _defaultPlanData,
        'Plan data',
        { silentUpgrade: false }
    );
}

function _savePlanStore(store) {
    saveVersionedPayload(LS_PLAN_KEY, PLAN_VERSION, store);
}

function defaultPlanEntry(workspaceId) {
    return {
        workspaceId,
        systemInstances: 1,
        rpsAverage: 1.0,
        rpsPeak: 1.0,
        distribution: [
            { contextSize: 500, percentage: 100, cacheHitRate: 0 }
        ]
    };
}

// Sync plan store with current workspace.
function syncPlanWithWorkspace() {
    const workspaceModels = getWorkspaceModels();
    const wsIds = new Set(workspaceModels.map(m => m.id));
    const store = _getPlanStore();

    if (!store.entries) store.entries = {};
    if (typeof store.planningHorizonDays !== 'number' || store.planningHorizonDays <= 0) {
        store.planningHorizonDays = DEFAULT_PLANNING_HORIZON_DAYS;
    }

    for (const id of Object.keys(store.entries)) {
        if (!wsIds.has(id)) delete store.entries[id];
    }
    for (const model of workspaceModels) {
        if (!store.entries[model.id]) {
            store.entries[model.id] = defaultPlanEntry(model.id);
        }
    }

    _savePlanStore(store);
    return store;
}

function getMaxContextForEntry(entry) {
    const dep = entry.deployment;
    return (dep && dep.seqLen) || entry.config.max_position_embeddings || 131072;
}

// Helpers for derived deployment shape. With pipeline parallelism, one
// model instance spans `tp \u00d7 pp` GPUs — possibly across multiple systems
// when pp > 1. The "instances per system" notion only really applies when
// pp === 1; for pp > 1 the spread spans systems, and the meaningful number
// is total model instances across the available GPU pool.
function gpusPerInstance(wsEntry) {
    const dep = wsEntry.deployment || {};
    return (dep.tp || 1) * (dep.pp || 1);
}

function instancesPerSystem(wsEntry) {
    const dep = wsEntry.deployment || {};
    const sys = getSystem(dep.systemId);
    if (!sys) return 0;
    const pp = dep.pp || 1;
    if (pp > 1) return 0; // multi-system spread; not a per-system count
    const tp = dep.tp || 1;
    return Math.floor(sys.gpuCount / tp);
}

function totalGpus(plan, wsEntry) {
    const sys = getSystem(wsEntry.deployment && wsEntry.deployment.systemId);
    if (!sys) return 0;
    return plan.systemInstances * sys.gpuCount;
}

function totalModelInstances(plan, wsEntry) {
    const total = totalGpus(plan, wsEntry);
    const per = gpusPerInstance(wsEntry);
    if (per <= 0) return 0;
    return Math.floor(total / per);
}

function planCardTitle(wsEntry) {
    const dep = wsEntry.deployment || {};
    const sys = getSystem(dep.systemId);
    const tp = dep.tp || 1;
    const pp = dep.pp || 1;
    const parallelism = pp > 1 ? `TP=${tp}, PP=${pp}` : `TP=${tp}`;
    const sysName = sys ? sys.name : 'no system';
    return `${wsEntry.title} (${parallelism}) on ${sysName}`;
}

// Validate a plan entry against its workspace entry. Returns array of error strings.
function validatePlanEntry(plan, wsEntry, maxContext) {
    const errors = [];
    const dep = wsEntry.deployment || {};
    const sys = getSystem(dep.systemId);

    if (!Number.isInteger(plan.systemInstances) || plan.systemInstances < 1)
        errors.push('System instances must be at least 1');

    if (!sys) {
        errors.push('Workspace model has no system assigned — open it in Model Details and pick a system.');
    } else {
        const tp = dep.tp || 1;
        const pp = dep.pp || 1;
        if (tp > sys.gpuCount) {
            errors.push(`TP=${tp} exceeds ${sys.name}'s ${sys.gpuCount} GPUs (fix on Model Details page). Each pipeline stage must fit within one system.`);
        }
        // Combined TP \u00d7 PP must fit in the total GPU pool (systemInstances \u00d7 gpuCount).
        const totalGpusAvailable = (Number.isInteger(plan.systemInstances) && plan.systemInstances > 0)
            ? plan.systemInstances * sys.gpuCount
            : 0;
        const perInstance = tp * pp;
        if (totalGpusAvailable > 0 && perInstance > totalGpusAvailable) {
            errors.push(`TP\u00d7PP = ${tp}\u00d7${pp} = ${perInstance} GPUs/instance exceeds the ${totalGpusAvailable} GPUs available across ${plan.systemInstances}\u00d7 ${sys.name}. Increase System instances or reduce TP/PP.`);
        }
        if (perInstance > 0 && totalGpusAvailable > 0 && Math.floor(totalGpusAvailable / perInstance) < 1) {
            errors.push(`Cannot fit a model instance: TP\u00d7PP = ${perInstance} > ${totalGpusAvailable} available GPUs.`);
        }
    }

    if (typeof plan.rpsAverage !== 'number' || plan.rpsAverage <= 0)
        errors.push('Requests/sec (Average) must be greater than 0');
    if (typeof plan.rpsPeak !== 'number' || plan.rpsPeak <= 0)
        errors.push('Requests/sec (Peak) must be greater than 0');
    if (plan.rpsAverage > plan.rpsPeak)
        errors.push('Requests/sec: Average must not exceed Peak');

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

function validatePlanHorizon(days) {
    if (!Number.isInteger(days) || days < 1) return ['Planning horizon must be a positive integer (days)'];
    return [];
}


// ---------------------------------------------------------------------------
// Page renderer
// ---------------------------------------------------------------------------
function renderPlanPage(container) {
    let planData = _defaultPlanData();
    let savedData = _defaultPlanData();
    let debounceTimer = null;

    const cardOutputs = {};
    let rollupPanel = null;
    let showDetailsCheckbox = null;
    let saveBtnRef = null;
    let saveStatusRef = null;
    let horizonErrorsDiv = null;

    function loadData() {
        savedData = syncPlanWithWorkspace();
        planData = JSON.parse(JSON.stringify(savedData));
    }

    function markDirty() { State.setDirty(true); }

    function render() {
        container.innerHTML = '';
        Object.keys(cardOutputs).forEach(k => delete cardOutputs[k]);
        rollupPanel = null;
        saveBtnRef = null;
        saveStatusRef = null;
        horizonErrorsDiv = null;

        const workspaceModels = getWorkspaceModels();

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

        container.appendChild(buildHorizonPanel());

        for (const wsEntry of workspaceModels) {
            const plan = planData.entries[wsEntry.id];
            if (!plan) continue;
            container.appendChild(buildModelCard(wsEntry, plan));
        }

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

        rollupPanel = document.createElement('div');
        rollupPanel.className = 'panel plan-rollup';
        container.appendChild(rollupPanel);

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

        // Inline status text next to Save. When the plan has unresolved
        // validation issues we don't block Save (a sales engineer is
        // allowed to save a work-in-progress plan with known shortfalls
        // and revisit later). Instead we surface the count here so the
        // user sees what they're saving past. The per-card red error
        // lines stay as-is.
        const saveStatus = document.createElement('span');
        saveStatus.style.cssText = 'margin-left: 12px; font-size: 0.8rem; color: var(--text-muted);';
        saveStatusRef = saveStatus;
        actions.appendChild(saveStatus);

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

        updateOutputs();
    }

    function buildHorizonPanel() {
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.style.marginBottom = '12px';

        const label = document.createElement('label');
        label.textContent = 'Planning horizon (days)';
        label.style.fontWeight = '600';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = 1;
        input.step = 1;
        input.value = planData.planningHorizonDays;
        input.style.maxWidth = '120px';
        input.oninput = () => {
            const v = parseInt(input.value);
            if (!isNaN(v)) {
                planData.planningHorizonDays = v;
                markDirty();
                scheduleRecalc();
            }
        };
        label.appendChild(input);
        panel.appendChild(label);

        const help = document.createElement('p');
        help.style.cssText = 'margin: 6px 0 0; color: var(--text-muted); font-size: 0.8rem;';
        help.textContent =
            'How long KV cache is retained in shared storage. Drives capacity sizing only; ' +
            'doubling the horizon doubles the storage requirement at 0% hit rate.';
        panel.appendChild(help);

        horizonErrorsDiv = document.createElement('div');
        horizonErrorsDiv.style.marginTop = '4px';
        panel.appendChild(horizonErrorsDiv);

        return panel;
    }

    // -----------------------------------------------------------------------
    // Update outputs
    // -----------------------------------------------------------------------
    function updateOutputs() {
        const showDetails = showDetailsCheckbox ? showDetailsCheckbox.checked : false;
        const workspaceModels = getWorkspaceModels();
        const allResults = [];
        let totalErrorCount = 0;

        const horizonErrors = validatePlanHorizon(planData.planningHorizonDays);
        if (horizonErrorsDiv) {
            horizonErrorsDiv.innerHTML = horizonErrors.map(e => `<div class="status-err">${e}</div>`).join('');
        }
        totalErrorCount += horizonErrors.length;
        const horizonSeconds = (planData.planningHorizonDays || 0) * SECONDS_PER_DAY;

        for (const wsEntry of workspaceModels) {
            const plan = planData.entries[wsEntry.id];
            const refs = cardOutputs[wsEntry.id];
            if (!plan || !refs) continue;

            const maxCtx = getMaxContextForEntry(wsEntry);
            const errors = validatePlanEntry(plan, wsEntry, maxCtx);
            totalErrorCount += errors.length;

            refs.errorsDiv.innerHTML = errors.map(e => `<div class="status-err">${e}</div>`).join('');

            // % sum
            const pctSum = plan.distribution.reduce((s, b) => s + b.percentage, 0);
            const sumOk = Math.abs(pctSum - 100) < 0.01;
            refs.pctSumCell.className = sumOk ? 'status-ok' : 'status-err';
            refs.pctSumCell.style.fontSize = '0.8rem';
            refs.pctSumCell.style.fontWeight = '600';
            refs.pctSumCell.textContent = `Sum: ${pctSum.toFixed(1)}%${sumOk ? '' : ' (must be 100%)'}`;

            // KV cache per-seq cells
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

            // Context-size border highlight
            for (let i = 0; i < plan.distribution.length; i++) {
                const input = refs.ctxInputs[i];
                if (!input) continue;
                input.style.borderColor = plan.distribution[i].contextSize > maxCtx ? '#F04E23' : '';
            }

            // Refresh card title (workspace title may have changed)
            if (refs.titleSpan) refs.titleSpan.textContent = planCardTitle(wsEntry);

            // Derived deployment readout
            updateDerivedReadout(refs.derivedSpan, plan, wsEntry);

            // Calculate at both scenarios
            const sys = getSystem(wsEntry.deployment && wsEntry.deployment.systemId);
            const resultAvg  = calcAtScenario(plan, wsEntry, 'Average', horizonSeconds, sys);
            const resultPeak = calcAtScenario(plan, wsEntry, 'Peak',    horizonSeconds, sys);

            if (resultAvg && resultPeak) {
                allResults.push({ resultAvg, resultPeak, wsEntry, plan, sys });
                refs.resultsDiv.innerHTML = buildResultsHTML(resultAvg, resultPeak, plan, wsEntry, sys);
                refs.detailsDiv.innerHTML = showDetails ? buildDetailHTML(resultAvg, resultPeak, plan, wsEntry, horizonSeconds) : '';
            } else {
                refs.resultsDiv.innerHTML = '';
                refs.detailsDiv.innerHTML = '';
            }
        }

        // Roll-up
        if (rollupPanel) {
            if (allResults.length > 0) {
                const rollupAvg  = calculatePlanRollup(allResults.map(r => r.resultAvg));
                const rollupPeak = calculatePlanRollup(allResults.map(r => r.resultPeak));
                rollupPanel.innerHTML = buildRollupHTML(allResults, rollupAvg, rollupPeak);
                if (showDetails) {
                    const detailsDiv = document.createElement('div');
                    detailsDiv.className = 'plan-details';
                    detailsDiv.innerHTML = buildRollupDetailHTML(allResults);
                    rollupPanel.appendChild(detailsDiv);
                }
                rollupPanel.style.display = '';
            } else {
                rollupPanel.style.display = 'none';
            }
        }

        // Save is never blocked by validation issues — a sales engineer is
        // free to save a partial / aspirational plan and revisit. We only
        // surface the unresolved-issue count alongside the button so they
        // see what they're carrying forward. Errors recompute on next load
        // (they're derived from inputs), so reopening a saved plan
        // re-highlights the same issues automatically.
        if (saveStatusRef) {
            if (totalErrorCount > 0) {
                saveStatusRef.textContent = `\u26a0 ${totalErrorCount} unresolved validation issue${totalErrorCount === 1 ? '' : 's'} \u2014 Save will persist as-is.`;
                saveStatusRef.style.color = 'var(--accent, #F04E23)';
            } else {
                saveStatusRef.textContent = '';
                saveStatusRef.style.color = '';
            }
        }
    }

    // -----------------------------------------------------------------------
    // Per-model card
    // -----------------------------------------------------------------------
    function buildModelCard(wsEntry, plan) {
        const maxCtx = getMaxContextForEntry(wsEntry);

        const card = document.createElement('div');
        card.className = 'panel plan-card';

        const header = document.createElement('div');
        header.className = 'plan-card-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'plan-card-title';
        titleSpan.textContent = planCardTitle(wsEntry);
        header.appendChild(titleSpan);
        card.appendChild(header);

        const inputRow = document.createElement('div');
        inputRow.className = 'plan-inputs-row';

        const sysInstancesField = buildNumberField('System instances', plan.systemInstances, 1, null, true, v => {
            plan.systemInstances = v; markDirty(); scheduleRecalc();
        });
        const derivedSpan = document.createElement('span');
        derivedSpan.className = 'gpu-count-display';
        sysInstancesField.appendChild(derivedSpan);
        inputRow.appendChild(sysInstancesField);

        inputRow.appendChild(buildScenarioRangeField(
            'Requests/sec',
            plan.rpsAverage, plan.rpsPeak,
            (which, v) => {
                if (which === 'avg') plan.rpsAverage = v;
                else plan.rpsPeak = v;
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
            <th>% of Requests</th>
            <th>Cache Hit Rate %</th>
            <th>KV Cache/seq</th>
            <th></th>
        </tr>`;
        table.appendChild(thead);

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

        const addBucketBtn = document.createElement('button');
        addBucketBtn.className = 'btn-secondary btn-small';
        addBucketBtn.textContent = 'Add Bucket';
        addBucketBtn.style.marginTop = '6px';
        addBucketBtn.onclick = () => {
            plan.distribution.push({ contextSize: 1000, percentage: 0, cacheHitRate: 0 });
            markDirty();
            render();
        };
        distSection.appendChild(addBucketBtn);

        card.appendChild(distSection);

        const errorsDiv = document.createElement('div');
        errorsDiv.style.marginTop = '8px';
        card.appendChild(errorsDiv);

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'plan-results';
        card.appendChild(resultsDiv);

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'plan-details';
        card.appendChild(detailsDiv);

        cardOutputs[wsEntry.id] = {
            titleSpan, resultsDiv, errorsDiv, detailsDiv,
            pctSumCell, kvCells, ctxInputs, derivedSpan
        };

        return card;
    }

    function updateDerivedReadout(span, plan, wsEntry) {
        if (!span) return;
        const dep = wsEntry.deployment || {};
        const sys = getSystem(dep.systemId);
        const tp = dep.tp || 1;
        const pp = dep.pp || 1;
        if (!sys) {
            span.textContent = '\u2192 no system assigned';
            return;
        }
        const totGpus = totalGpus(plan, wsEntry);
        const totModels = totalModelInstances(plan, wsEntry);
        const perInstance = tp * pp;

        if (tp > sys.gpuCount) {
            span.textContent = `\u2192 TP=${tp} > ${sys.gpuCount} GPUs (each stage must fit one system)`;
            return;
        }
        if (perInstance > totGpus) {
            span.textContent = `\u2192 TP\u00d7PP = ${perInstance} > ${totGpus} available GPUs (need more system instances)`;
            return;
        }

        if (pp > 1) {
            // Multi-stage spread across systems (or within a large system).
            span.textContent =
                `\u2192 ${plan.systemInstances}\u00d7 ${sys.name} = ${totGpus} GPUs ` +
                `(TP=${tp} \u00d7 PP=${pp} = ${perInstance} GPUs/instance, ${totModels} model instance${totModels === 1 ? '' : 's'})`;
        } else {
            const ips = instancesPerSystem(wsEntry);
            span.textContent =
                `\u2192 ${plan.systemInstances}\u00d7 ${sys.name} = ${totGpus} GPUs ` +
                `(TP=${tp}, ${ips} instance${ips === 1 ? '' : 's'}/sys, ${totModels} model instance${totModels === 1 ? '' : 's'})`;
        }
    }

    function buildDistRow(plan, idx, maxCtx, wsEntry) {
        const bucket = plan.distribution[idx];
        const tr = document.createElement('tr');

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

        const kvCell = document.createElement('td');
        kvCell.style.fontSize = '0.8rem';
        kvCell.style.color = 'var(--text-muted)';
        tr.appendChild(kvCell);

        const tdRm = document.createElement('td');
        const rmBtn = document.createElement('button');
        rmBtn.className = 'btn-danger btn-small';
        rmBtn.textContent = '×';
        rmBtn.disabled = plan.distribution.length <= 1;
        rmBtn.onclick = () => {
            plan.distribution.splice(idx, 1);
            markDirty();
            render();
        };
        tdRm.appendChild(rmBtn);
        tr.appendChild(tdRm);

        return { tr, kvCell, ctxInput };
    }

    // -----------------------------------------------------------------------
    // Field builders
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

    function buildScenarioRangeField(labelText, avgValue, peakValue, onChange) {
        const wrapper = document.createElement('label');
        wrapper.textContent = labelText;
        const row = document.createElement('div');
        row.className = 'plan-range';

        const makeInput = (value, which, title, placeholder) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.min = 0.001;
            input.step = 0.1;
            input.title = title;
            input.placeholder = placeholder;
            input.oninput = () => {
                const v = parseFloat(input.value);
                if (!isNaN(v)) onChange(which, v);
            };
            return input;
        };

        row.appendChild(makeInput(avgValue,  'avg',  'Average — steady-state load',     'Avg'));
        row.appendChild(makeInput(peakValue, 'peak', 'Peak — busiest sustained period', 'Peak'));
        wrapper.appendChild(row);
        return wrapper;
    }

    // -----------------------------------------------------------------------
    // Scenario helpers
    // -----------------------------------------------------------------------
    function rpsForScenario(plan, scenario) {
        return scenario === 'Average' ? plan.rpsAverage : plan.rpsPeak;
    }

    function calcAtScenario(plan, wsEntry, scenario, horizonSeconds, sys) {
        try {
            const rps = rpsForScenario(plan, scenario);
            return calculatePlanEntry(plan, wsEntry, {
                rps,
                horizonSeconds,
                system: sys,
                systemInstances: plan.systemInstances
            });
        } catch (e) {
            return null;
        }
    }

    function fmtRangeSize(avgBytes, peakBytes) {
        if (Math.abs(peakBytes - avgBytes) < 1) return formatSizeHuman(avgBytes);
        return `${formatSizeHuman(avgBytes)} – ${formatSizeHuman(peakBytes)}`;
    }
    function fmtRangeTp(avg, peak) {
        if (Math.abs(peak - avg) < 1e-9) return formatThroughputHuman(avg);
        return `${formatThroughputHuman(avg)} – ${formatThroughputHuman(peak)}`;
    }
    function fmtRangeFloat(avg, peak, decimals = 3) {
        const a = avg.toFixed(decimals);
        const b = peak.toFixed(decimals);
        return a === b ? a : `${a} – ${b}`;
    }

    // -----------------------------------------------------------------------
    // Per-model results HTML — shows demand + system cap; achievable line
    // appears only when capping kicks in.
    // -----------------------------------------------------------------------
    function buildResultsHTML(resultAvg, resultPeak, plan, wsEntry, sys) {
        const writeCapped = resultAvg.writeCapped || resultPeak.writeCapped;
        const readCapped  = resultAvg.readCapped  || resultPeak.readCapped;
        const sysLabel = sys ? `(${plan.systemInstances}× ${sys.name})` : '(no system)';

        const writeDemand = fmtRangeTp(resultAvg.totalWriteGiBps, resultPeak.totalWriteGiBps);
        const readDemand  = fmtRangeTp(resultAvg.totalReadGiBps,  resultPeak.totalReadGiBps);
        const writeCap    = formatThroughputHuman(resultAvg.writeBandwidthGiBps);
        const readCap     = formatThroughputHuman(resultAvg.readBandwidthGiBps);
        const writeAch    = fmtRangeTp(resultAvg.writeAchievableGiBps, resultPeak.writeAchievableGiBps);
        const readAch     = fmtRangeTp(resultAvg.readAchievableGiBps,  resultPeak.readAchievableGiBps);

        const cap = (label) => `<span class="status-err" style="font-weight: 600;">${label}</span>`;

        const writeBlock = `
            <div class="plan-throughput-block">
                <div class="plan-throughput-title">
                    Write throughput${writeCapped ? ' ' + cap('⚠ capped') : ''}
                </div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Demand:</span><span>${writeDemand}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">System cap:</span><span>${writeCap} ${sysLabel}</span></div>
                ${writeCapped ? `<div class="plan-throughput-row"><span class="plan-throughput-label">Achievable:</span><span>${writeAch}</span></div>` : ''}
            </div>
        `;
        const readBlock = `
            <div class="plan-throughput-block">
                <div class="plan-throughput-title">
                    Read throughput${readCapped ? ' ' + cap('⚠ capped') : ''}
                </div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Demand:</span><span>${readDemand}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">System cap:</span><span>${readCap} ${sysLabel}</span></div>
                ${readCapped ? `<div class="plan-throughput-row"><span class="plan-throughput-label">Achievable:</span><span>${readAch}</span></div>` : ''}
            </div>
        `;

        return `
            <div class="plan-result-row">
                <span class="plan-result-label">KV Cache Size:</span>
                <span class="plan-result-value">${fmtRangeSize(resultAvg.totalKVSizeBytes, resultPeak.totalKVSizeBytes)}</span>
            </div>
            ${writeBlock}
            ${readBlock}
        `;
    }

    // -----------------------------------------------------------------------
    // Roll-up HTML
    // -----------------------------------------------------------------------
    function buildRollupHTML(allResults, rollupAvg, rollupPeak) {
        // System mix grouped by name → "2× DGX H100, 1× GB200 NVL72"
        const sysCounts = new Map();
        let totGpus = 0;
        let totModelInstances = 0;
        for (const { plan, wsEntry, sys } of allResults) {
            if (sys) {
                sysCounts.set(sys.name, (sysCounts.get(sys.name) || 0) + plan.systemInstances);
                totGpus += plan.systemInstances * sys.gpuCount;
                totModelInstances += totalModelInstances(plan, wsEntry);
            }
        }
        const sysMix = [...sysCounts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, count]) => `${count}× ${name}`)
            .join(', ') || 'none';

        const writeGap = fmtRangeTp(rollupAvg.writeGapGiBps, rollupPeak.writeGapGiBps);
        const readGap  = fmtRangeTp(rollupAvg.readGapGiBps,  rollupPeak.readGapGiBps);
        const writeGapText = (rollupAvg.writeGapGiBps === 0 && rollupPeak.writeGapGiBps === 0)
            ? '<span class="status-ok">none</span>'
            : `<span class="status-err">${writeGap}</span>`;
        const readGapText = (rollupAvg.readGapGiBps === 0 && rollupPeak.readGapGiBps === 0)
            ? '<span class="status-ok">none</span>'
            : `<span class="status-err">${readGap}</span>`;

        return `
            <h2 style="margin-top: 0;">Aggregate</h2>
            <div class="plan-result-row"><span class="plan-result-label">Systems:</span><span class="plan-result-value">${sysMix}</span></div>
            <div class="plan-result-row"><span class="plan-result-label">Total GPUs:</span><span class="plan-result-value">${totGpus}</span></div>
            <div class="plan-result-row"><span class="plan-result-label">Total model instances:</span><span class="plan-result-value">${totModelInstances}</span></div>
            <div class="plan-result-row"><span class="plan-result-label">Total KV Cache Size:</span><span class="plan-result-value">${fmtRangeSize(rollupAvg.totalKVSizeBytes, rollupPeak.totalKVSizeBytes)}</span></div>
            <div class="plan-throughput-block">
                <div class="plan-throughput-title">Write</div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Demand:</span><span>${fmtRangeTp(rollupAvg.totalWriteGiBps, rollupPeak.totalWriteGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">System cap:</span><span>${formatThroughputHuman(rollupAvg.writeBandwidthGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Achievable:</span><span>${fmtRangeTp(rollupAvg.writeAchievableGiBps, rollupPeak.writeAchievableGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Capacity gap:</span>${writeGapText}</div>
            </div>
            <div class="plan-throughput-block">
                <div class="plan-throughput-title">Read</div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Demand:</span><span>${fmtRangeTp(rollupAvg.totalReadGiBps, rollupPeak.totalReadGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">System cap:</span><span>${formatThroughputHuman(rollupAvg.readBandwidthGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Achievable:</span><span>${fmtRangeTp(rollupAvg.readAchievableGiBps, rollupPeak.readAchievableGiBps)}</span></div>
                <div class="plan-throughput-row"><span class="plan-throughput-label">Capacity gap:</span>${readGapText}</div>
            </div>
        `;
    }

    // -----------------------------------------------------------------------
    // Per-model detail HTML
    // -----------------------------------------------------------------------
    function buildDetailHTML(resultAvg, resultPeak, plan, wsEntry, horizonSeconds) {
        const lines = [];
        const sys = resultAvg.systemRef;

        lines.push('<h3 style="margin-top: 10px;">Calculation Details</h3>');

        const horizonDays = planData.planningHorizonDays;
        const kvPreamble =
            `horizon_seconds = ${horizonDays} × 86400 = ${horizonSeconds.toLocaleString()} seconds\n` +
            `rps_avg  = ${plan.rpsAverage}  requests/sec\n` +
            `rps_peak = ${plan.rpsPeak}  requests/sec`;

        lines.push('<div class="plan-detail-section">');
        lines.push('<strong>KV Cache Size</strong>');
        lines.push(`<div class="plan-detail-formula">${kvPreamble}</div>`);
        lines.push('<div class="plan-detail-table-wrap">');
        lines.push('<table class="plan-detail-table"><thead><tr><th>Context Size</th><th>%</th><th>Hit %</th><th>Writes/sec</th><th>KV/seq</th><th>Subtotal</th></tr></thead><tbody>');
        for (let i = 0; i < resultAvg.bucketDetails.length; i++) {
            const bA = resultAvg.bucketDetails[i];
            const bP = resultPeak.bucketDetails[i];
            lines.push(
                `<tr><td>${bA.contextSize.toLocaleString()}</td>` +
                `<td>${bA.percentage}%</td>` +
                `<td>${bA.cacheHitRate}%</td>` +
                `<td>${fmtRangeFloat(bA.writesPerSec, bP.writesPerSec)}</td>` +
                `<td>${formatSizeHuman(bA.kvBytesPerSeq)}</td>` +
                `<td>${fmtRangeSize(bA.sizeBytes, bP.sizeBytes)}</td></tr>`
            );
        }
        lines.push(`</tbody><tfoot><tr><td colspan="5" style="text-align: right; font-weight: 600;">Total:</td><td style="font-weight: 600;">${fmtRangeSize(resultAvg.totalKVSizeBytes, resultPeak.totalKVSizeBytes)}</td></tr></tfoot></table>`);
        lines.push('</div>');
        lines.push('</div>');

        // Throughput preamble names rps + system bandwidth caps
        const writeBw = sys ? `${plan.systemInstances} × ${sys.writeBandwidthGiBps} = ${(plan.systemInstances * sys.writeBandwidthGiBps).toFixed(2)} GiB/s` : 'no system';
        const readBw  = sys ? `${plan.systemInstances} × ${sys.readBandwidthGiBps}  = ${(plan.systemInstances * sys.readBandwidthGiBps).toFixed(2)} GiB/s`  : 'no system';
        const tpPreamble =
            `rps_avg  = ${plan.rpsAverage}  requests/sec\n` +
            `rps_peak = ${plan.rpsPeak}  requests/sec\n` +
            `system_write_bw = systemInstances × system.writeBandwidth = ${writeBw}\n` +
            `system_read_bw  = systemInstances × system.readBandwidth  = ${readBw}`;

        const writeCapNote = (resultAvg.writeCapped || resultPeak.writeCapped) ? ' <span class="status-err">⚠ capped</span>' : '';
        const readCapNote  = (resultAvg.readCapped  || resultPeak.readCapped)  ? ' <span class="status-err">⚠ capped</span>' : '';

        lines.push('<div class="plan-detail-section">');
        lines.push('<strong>Throughput</strong>');
        lines.push(`<div class="plan-detail-formula">${tpPreamble}</div>`);
        lines.push('<div class="plan-detail-table-wrap">');
        lines.push('<table class="plan-detail-table"><thead><tr><th>Context Size</th><th>%</th><th>Req/sec</th><th>Hit %</th><th>Hits/sec</th><th>Misses/sec</th><th>Write demand</th><th>Read demand</th></tr></thead><tbody>');
        for (let i = 0; i < resultAvg.bucketDetails.length; i++) {
            const bA = resultAvg.bucketDetails[i];
            const bP = resultPeak.bucketDetails[i];
            lines.push(
                `<tr><td>${bA.contextSize.toLocaleString()}</td>` +
                `<td>${bA.percentage}%</td>` +
                `<td>${fmtRangeFloat(bA.requestsPerSec, bP.requestsPerSec)}</td>` +
                `<td>${bA.cacheHitRate}%</td>` +
                `<td>${fmtRangeFloat(bA.readsPerSec,  bP.readsPerSec)}</td>` +
                `<td>${fmtRangeFloat(bA.writesPerSec, bP.writesPerSec)}</td>` +
                `<td>${fmtRangeTp(bA.writeBytesPerSec / (1024 ** 3), bP.writeBytesPerSec / (1024 ** 3))}</td>` +
                `<td>${fmtRangeTp(bA.readBytesPerSec  / (1024 ** 3), bP.readBytesPerSec  / (1024 ** 3))}</td></tr>`
            );
        }
        lines.push(`</tbody><tfoot>` +
            `<tr><td colspan="6" style="text-align: right; font-weight: 600;">Demand totals:</td>` +
            `<td style="font-weight: 600;">${fmtRangeTp(resultAvg.totalWriteGiBps, resultPeak.totalWriteGiBps)}${writeCapNote}</td>` +
            `<td style="font-weight: 600;">${fmtRangeTp(resultAvg.totalReadGiBps, resultPeak.totalReadGiBps)}${readCapNote}</td></tr>` +
            `<tr><td colspan="6" style="text-align: right; font-weight: 600;">Achievable totals:</td>` +
            `<td style="font-weight: 600;">${fmtRangeTp(resultAvg.writeAchievableGiBps, resultPeak.writeAchievableGiBps)}</td>` +
            `<td style="font-weight: 600;">${fmtRangeTp(resultAvg.readAchievableGiBps, resultPeak.readAchievableGiBps)}</td></tr>` +
            `</tfoot></table>`);
        lines.push('</div>');
        lines.push('</div>');

        return lines.join('');
    }

    // -----------------------------------------------------------------------
    // Roll-up detail
    // -----------------------------------------------------------------------
    function buildRollupDetailHTML(allResults) {
        const lines = [];
        lines.push('<h3 style="margin-top: 10px;">Per-Model Breakdown</h3>');
        lines.push('<table class="plan-detail-table"><thead><tr>' +
            '<th>Model</th><th>Systems</th><th>GPUs</th>' +
            '<th>KV Cache</th>' +
            '<th>Write demand</th><th>Write achievable</th>' +
            '<th>Read demand</th><th>Read achievable</th>' +
            '</tr></thead><tbody>');
        for (const { resultAvg, resultPeak, wsEntry, plan, sys } of allResults) {
            const sysCell = sys ? `${plan.systemInstances}× ${sys.name}` : 'no system';
            const gpus = sys ? plan.systemInstances * sys.gpuCount : 0;
            const writeNote = (resultAvg.writeCapped || resultPeak.writeCapped) ? ' <span class="status-err">⚠</span>' : '';
            const readNote  = (resultAvg.readCapped  || resultPeak.readCapped)  ? ' <span class="status-err">⚠</span>' : '';
            lines.push(
                `<tr>` +
                `<td>${planCardTitle(wsEntry)}</td>` +
                `<td>${sysCell}</td>` +
                `<td>${gpus}</td>` +
                `<td>${fmtRangeSize(resultAvg.totalKVSizeBytes, resultPeak.totalKVSizeBytes)}</td>` +
                `<td>${fmtRangeTp(resultAvg.totalWriteGiBps, resultPeak.totalWriteGiBps)}${writeNote}</td>` +
                `<td>${fmtRangeTp(resultAvg.writeAchievableGiBps, resultPeak.writeAchievableGiBps)}</td>` +
                `<td>${fmtRangeTp(resultAvg.totalReadGiBps, resultPeak.totalReadGiBps)}${readNote}</td>` +
                `<td>${fmtRangeTp(resultAvg.readAchievableGiBps, resultPeak.readAchievableGiBps)}</td>` +
                `</tr>`
            );
        }
        lines.push('</tbody></table>');
        return lines.join('');
    }

    function scheduleRecalc() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateOutputs, 200);
    }

    loadData();
    render();

    return () => {
        clearTimeout(debounceTimer);
    };
}
