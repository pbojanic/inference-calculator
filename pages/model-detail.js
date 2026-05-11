// ---------------------------------------------------------------------------
// Model Details page: full GPU memory analysis with auto-calculate
// ---------------------------------------------------------------------------

function renderModelDetailPage(container, params) {
    const entryId = params.id;
    if (!entryId) {
        container.innerHTML = '<p>No model specified. <a href="#home">Go home</a></p>';
        return null;
    }

    // `_new` is a synthetic id for an unsaved draft staged by the Home page
    // on State.pendingNewModel. The model is not yet in the workspace; it
    // gets persisted (via addToWorkspace) only when Save passes validation.
    const isDraft = entryId === '_new';
    let entry;
    if (isDraft) {
        const pending = State.pendingNewModel;
        if (!pending) {
            // The draft was lost (page refresh, or arrived here directly).
            // Send the user back home rather than fabricating a blank entry.
            container.innerHTML = '<p>No pending model. <a href="#home">Go home</a></p>';
            setTimeout(() => Router.navigate('#home'), 0);
            return null;
        }
        entry = {
            id: '_new',
            title: pending.title,
            baseModel: pending.baseModel,
            config: pending.config,
            deployment: defaultDeployment(pending.config)
        };
    } else {
        entry = getWorkspaceEntry(entryId);
        if (!entry) {
            container.innerHTML = `<p>Model not found. <a href="#home">Go home</a></p>`;
            return null;
        }
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

    // A draft entry is unsaved by definition — flip the dirty flag so the
    // unsaved-changes guard fires if the user navigates away without saving.
    if (isDraft) {
        State.setDirty(true);
    }

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
        // Note: `params` here is a plain object provided by our hash router
        // (router.js _parseHash). This is NOT a Next.js page.

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
        if (config && config._compatibilityMode === 'mistral-params') {
            const badge = document.createElement('span');
            badge.className = 'compat-badge';
            badge.textContent = 'params.json compatibility';
            badge.title = 'Loaded from Mistral-native params.json — no HF transformers config.json was published. Estimates may differ from a future HF-format release.';
            titleRow.appendChild(badge);
        }
        if (config && config._multimodal) {
            const badge = document.createElement('span');
            badge.className = 'compat-badge';
            badge.textContent = 'LLM only';
            badge.title = 'Multimodal model — only the language-model portion is modelled. Vision encoder weights, KV cache, and activations are excluded from the totals.';
            titleRow.appendChild(badge);
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
        inputPanel.appendChild(buildSystemSection());
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
        const reportHeader = document.createElement('div');
        reportHeader.className = 'section-header';
        const reportTitle = document.createElement('h2');
        reportTitle.textContent = 'Memory Breakdown';
        const headerCopyBtn = document.createElement('button');
        headerCopyBtn.type = 'button';
        headerCopyBtn.className = 'icon-btn';
        headerCopyBtn.title = 'Copy report to clipboard';
        headerCopyBtn.setAttribute('aria-label', 'Copy report to clipboard');
        const COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const CHECK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        headerCopyBtn.innerHTML = COPY_ICON_SVG;
        headerCopyBtn.onclick = async () => {
            const ok = await copyReport();
            if (!ok) return;
            headerCopyBtn.innerHTML = CHECK_ICON_SVG;
            headerCopyBtn.classList.add('icon-btn--ok');
            setTimeout(() => {
                headerCopyBtn.innerHTML = COPY_ICON_SVG;
                headerCopyBtn.classList.remove('icon-btn--ok');
            }, 1500);
        };
        reportHeader.appendChild(reportTitle);
        reportHeader.appendChild(headerCopyBtn);
        reportPanel.appendChild(reportHeader);
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
        currentDeployment.pp = parseInt(el('detail-pp').value) || 1;
        currentDeployment.systemId = el('detail-system').value || null;
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
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Splits within one system (NVLink). Must be \u2264 system GPU count.</span>
                    <div id="detail-tp-error" class="status-err" style="min-height: 1em; font-size: 0.75rem;"></div>
                </label>
            </div>
            <div class="row">
                <label>Pipeline parallel
                    <input type="number" id="detail-pp" value="${currentDeployment.pp || 1}" min="1">
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Stages across systems (or within a large system). GPUs per instance = TP \u00d7 PP.</span>
                    <div id="detail-pp-error" class="status-err" style="min-height: 1em; font-size: 0.75rem;"></div>
                </label>
            </div>
        `;
        div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', onInputChange));
        return div;
    }

    function validateTpAgainstSystem() {
        const errEl = document.getElementById('detail-tp-error');
        const sys = getSystem(currentDeployment.systemId);
        if (!errEl) return true;
        if (!sys) { errEl.textContent = ''; return true; }
        if (currentDeployment.tp > sys.gpuCount) {
            errEl.textContent = `TP=${currentDeployment.tp} exceeds ${sys.name}'s ${sys.gpuCount} GPUs.`;
            return false;
        }
        errEl.textContent = '';
        return true;
    }

    // -----------------------------------------------------------------------
    // System configuration
    // -----------------------------------------------------------------------
    function buildSystemSection() {
        const div = document.createElement('div');
        const systems = getSystemList();

        const noSystemSelected = !currentDeployment.systemId;
        const placeholder = noSystemSelected
            ? '<option value="" disabled selected>Select a system…</option>'
            : '';
        const options = placeholder + systems.map(s =>
            `<option value="${s.id}" ${s.id === currentDeployment.systemId ? 'selected' : ''}>${s.name} — ${s.gpuCount}× ${s.gpuType} @ ${s.gpuMemoryGB} GB</option>`
        ).join('');

        div.innerHTML = `
            <h2>System</h2>
            <label>System
                <select id="detail-system">${options}</select>
            </label>
            <div id="detail-system-info" class="model-detail-row" style="font-size: 0.75rem; color: var(--text-muted);"></div>
            <label>Memory utilization: <span id="detail-utilLabel">${Math.round(currentDeployment.gpuUtil * 100)}%</span>
                <input type="range" id="detail-gpuUtil" min="0.10" max="0.99" step="0.01" value="${currentDeployment.gpuUtil}">
            </label>
        `;

        setTimeout(() => {
            const sel = document.getElementById('detail-system');
            const slider = document.getElementById('detail-gpuUtil');
            if (sel) sel.addEventListener('change', () => {
                onInputChange();
                renderSystemInfo();
            });
            if (slider) {
                slider.addEventListener('input', () => {
                    document.getElementById('detail-utilLabel').textContent = Math.round(slider.value * 100) + '%';
                    onInputChange();
                });
            }
            renderSystemInfo();
        }, 0);

        return div;
    }

    function renderSystemInfo() {
        const infoEl = document.getElementById('detail-system-info');
        if (!infoEl) return;
        const sys = getSystem(currentDeployment.systemId);
        if (!sys) {
            infoEl.innerHTML = '<span class="status-err">Pick a system to continue. Add or edit systems on the <a href="#systems" style="color: var(--accent);">Systems page</a>.</span>';
            return;
        }
        infoEl.innerHTML =
            `Bandwidth: read ${sys.readBandwidthGiBps} GiB/s · write ${sys.writeBandwidthGiBps} GiB/s · ` +
            `TP must be ≤ ${sys.gpuCount}.`;
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
        saveBtn.onclick = async () => {
            readFormValues();

            // Collect every validation issue up front so the user sees the
            // whole list in one dialog rather than fixing one issue at a
            // time and re-pressing Save. Identity-against-self uses the
            // synthetic '_new' id for drafts so the title-uniqueness check
            // doesn't accidentally collide with itself.
            const issues = [];
            const titleErrEl = document.getElementById('detail-title-error');
            if (titleErrEl) titleErrEl.textContent = '';

            if (!currentTitle) {
                issues.push('Title is required.');
                if (titleErrEl) titleErrEl.textContent = 'Title cannot be empty.';
            } else if (isWorkspaceTitleTaken(currentTitle, entryId)) {
                issues.push(`A model with the title "${currentTitle}" already exists. Pick a different title.`);
                if (titleErrEl) titleErrEl.textContent = 'A model with this title already exists.';
            }

            const ppErrEl = document.getElementById('detail-pp-error');
            if (ppErrEl) ppErrEl.textContent = '';
            const ppVal = currentDeployment.pp || 1;
            if (ppVal < 1) {
                issues.push('Pipeline parallel must be at least 1.');
                if (ppErrEl) ppErrEl.textContent = 'Must be \u2265 1.';
            }

            if (!currentDeployment.systemId) {
                issues.push('No system selected. Pick a system in the System section. Add or edit systems on the Systems page.');
                renderSystemInfo();
            } else {
                const sys = getSystem(currentDeployment.systemId);
                // Each pipeline stage's TP ranks share NVLink within one
                // system, so TP itself can never exceed system.gpuCount —
                // even when PP > 1 spans systems.
                if (sys && currentDeployment.tp > sys.gpuCount) {
                    issues.push(`Tensor parallel (${currentDeployment.tp}) exceeds ${sys.name}'s ${sys.gpuCount} GPUs. Each pipeline stage must fit within one system's NVLink fabric.`);
                    validateTpAgainstSystem();
                }
                // The combined `tp \u00d7 pp \u2264 totalGPUsAvailable` check is
                // intentionally deferred to the Plan page where systemInstances
                // is known. Here we only assert the per-stage NVLink constraint.
            }

            if (issues.length) {
                await alertDialog('Cannot save \u2014 please fix:', issues);
                return;
            }

            // Validation passed. For a draft, addToWorkspace persists the
            // entry for the first time and returns the new id.
            if (isDraft) {
                const newId = addToWorkspace(entry.baseModel, config, currentTitle);
                const persisted = getWorkspaceEntry(newId);
                if (persisted) {
                    persisted.deployment = { ...currentDeployment };
                    saveWorkspaceEntry(persisted);
                }
                State.pendingNewModel = null;
            } else {
                entry.title = currentTitle;
                entry.deployment = { ...currentDeployment };
                saveWorkspaceEntry(entry);
            }

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
            // A draft has nothing on disk — discarding it just means
            // dropping the in-memory pending slot and going home.
            if (isDraft) State.pendingNewModel = null;
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
        validateTpAgainstSystem();
        const sys = getSystem(currentDeployment.systemId);
        if (!sys) {
            const reportEl = document.getElementById('detail-report');
            if (reportEl) reportEl.textContent = 'Select a system to see the memory analysis.';
            const summaryEl = document.getElementById('detail-summary-stats');
            if (summaryEl) summaryEl.innerHTML = '<span class="status-err">No system selected — pick one in the System section above.</span>';
            if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
            if (stackChartInstance) { stackChartInstance.destroy(); stackChartInstance = null; }
            lastReport = '';
            return;
        }
        const gpuMemoryGB = sys.gpuMemoryGB;

        const result = calculateCompleteAnalysis({
            config,
            modelName: currentTitle,
            maxNumSeqs: currentDeployment.maxSeqs,
            promptLength: currentDeployment.seqLen,
            maxBatchedTokens: currentDeployment.batchTokens,
            gpuMemoryGB,
            gpuMemoryUtil: currentDeployment.gpuUtil,
            tensorParallel: currentDeployment.tp,
            pipelineParallel: currentDeployment.pp || 1,
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
            const ppVal = currentDeployment.pp || 1;
            const tpLabel = ppVal > 1
                ? `TP=${currentDeployment.tp}, PP=${ppVal}`
                : `TP=${currentDeployment.tp}`;
            const sysLabel = sys ? `${sys.name} (${tpLabel})` : 'No system';
            const ctxK = (currentDeployment.seqLen / 1024).toFixed(0);
            const totalB = (result.paramBreakdown.total_params / 1e9).toFixed(1);
            const paramsLabel = result.paramBreakdown.is_moe
                ? `${(result.paramBreakdown.active_params / 1e9).toFixed(1)}B act / ${totalB}B`
                : `${totalB}B`;
            summaryEl.innerHTML = `
                <span>${sysLabel}</span>
                <span>Params: ${paramsLabel}</span>
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
    async function copyReport() {
        if (!lastReport) return false;
        try {
            await navigator.clipboard.writeText(lastReport);
            return true;
        } catch (e) {
            if (typeof showToast === 'function') {
                showToast('Could not copy to clipboard: ' + e.message, 'warn');
            }
            return false;
        }
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
        // Whenever we leave the draft page, drop the pending slot. Save and
        // Cancel already null this; this catches the nav-bar / browser-back
        // discard path so a stale draft can't resurface on revisit.
        if (isDraft) State.pendingNewModel = null;
    }

    render();
    return cleanup;
}
