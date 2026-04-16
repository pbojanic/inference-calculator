// ---------------------------------------------------------------------------
// Home page: settings, working models list, add/search/edit/remove
// ---------------------------------------------------------------------------

const POPULAR_MODELS = [
    'Qwen/Qwen3-32B',
    'meta-llama/Llama-3.2-1B-Instruct',
    'meta-llama/Llama-3.1-70B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct'
];

function renderHomePage(container) {
    let selectedId = null;
    let searchTimeout = null;

    function render() {
        container.innerHTML = '';

        // Working models
        const section = document.createElement('div');
        section.innerHTML = '<h2>Working Models</h2>';
        container.appendChild(section);

        const workspace = getWorkspaceModels();
        if (workspace.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No models yet. Add a model below to get started.';
            container.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.className = 'model-list';
            for (const entry of workspace) {
                list.appendChild(buildModelCard(entry));
            }
            container.appendChild(list);
        }

        // Add model section
        container.appendChild(buildAddModelSection());
    }

    // -----------------------------------------------------------------------
    // Model card
    // -----------------------------------------------------------------------
    function buildModelCard(entry) {
        const config = entry.config;
        const deployment = entry.deployment || defaultDeployment(config);
        const card = document.createElement('div');
        card.className = 'card' + (selectedId === entry.id ? ' selected' : '');

        const nameDiv = document.createElement('div');
        nameDiv.className = 'model-card-name';
        nameDiv.textContent = entry.title;
        if (entry.title !== entry.baseModel) {
            const base = document.createElement('span');
            base.style.cssText = 'font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-left: 8px;';
            base.textContent = entry.baseModel;
            nameDiv.appendChild(base);
        }
        card.appendChild(nameDiv);

        if (config) {
            const stats = document.createElement('div');
            stats.className = 'model-card-stats';

            const params = calculateModelParameters(config);
            const weightGB = (params.total_params * (deployment.bytesPerWeight || 2)) / (1024 ** 3);
            const ctxLen = deployment.contextOverride || config.max_position_embeddings || 131072;
            const kv = calculateKVCacheMemory(config, 1, ctxLen, deployment.tp || 1, deployment.bytesPerKV || 2);
            const gpu = getGpu(deployment.gpuId);
            const gpuName = gpu ? gpu.name : 'No GPU';

            const swCap = config.sliding_window ? ` (sw: ${(config.sliding_window / 1024).toFixed(0)}K)` : '';

            stats.innerHTML = `
                <span>${gpuName}</span>
                <span>Weights: ${weightGB.toFixed(1)} GiB</span>
                <span>KV Cache: ${kv.total_kv_cache_gb.toFixed(1)} GiB</span>
                <span>Context: ${(ctxLen / 1024).toFixed(0)}K${swCap}</span>
            `;
            card.appendChild(stats);
        }

        card.onclick = (e) => {
            if (e.target.closest('button')) return;
            selectedId = selectedId === entry.id ? null : entry.id;
            render();
        };

        if (selectedId === entry.id) {
            card.appendChild(buildDetailPanel(entry));
        }

        return card;
    }

    // -----------------------------------------------------------------------
    // Detail panel (read-only, shown when selected)
    // -----------------------------------------------------------------------
    function buildDetailPanel(entry) {
        const panel = document.createElement('div');
        panel.className = 'model-detail-panel';

        const config = entry.config;
        const deployment = entry.deployment || defaultDeployment(config);
        const ctxLen = deployment.contextOverride || (config && config.max_position_embeddings) || 131072;

        if (config) {
            const params = calculateModelParameters(config);
            const weightGB = (params.total_params * (deployment.bytesPerWeight || 2)) / (1024 ** 3);
            const kv = calculateKVCacheMemory(config, 1, ctxLen, deployment.tp || 1, deployment.bytesPerKV || 2);

            const defaultCtx = (config.max_position_embeddings) || 131072;
            const ctxNote = deployment.contextOverride
                ? ` (overridden, default: ${(defaultCtx / 1024).toFixed(0)}K)`
                : '';

            const swNote = config.sliding_window
                ? `<div class="model-detail-row"><span class="label">Sliding window:</span> ${config.sliding_window.toLocaleString()} tokens (${(config.sliding_window / 1024).toFixed(0)}K) — caps KV cache per layer</div>`
                : '';
            const kvNote = kv.effective_kv_length !== ctxLen
                ? ` (effective KV: ${(kv.effective_kv_length / 1024).toFixed(0)}K)`
                : '';

            const gpu = getGpu(deployment.gpuId);
            const gpuDisplay = gpu ? `${gpu.name} (${gpu.memoryGB} GB)` : 'No GPU assigned';

            panel.innerHTML = `
                <div class="model-detail-row"><span class="label">GPU:</span> ${gpuDisplay}</div>
                <div class="model-detail-row"><span class="label">Max context:</span> ${(ctxLen / 1024).toFixed(0)}K tokens${ctxNote}</div>
                ${swNote}
                <div class="model-detail-row"><span class="label">Weight memory:</span> ${weightGB.toFixed(2)} GiB</div>
                <div class="model-detail-row"><span class="label">KV Cache (agg):</span> ${kv.total_kv_cache_gb.toFixed(2)} GiB${kvNote}</div>
                <div class="model-detail-row"><span class="label">Tensor parallel:</span> ${deployment.tp}</div>
                <div class="model-detail-row"><span class="label">Precision:</span> ${deployment.bytesPerWeight} bytes/weight (${deployment.precisionMode})</div>
            `;
        }

        const actions = document.createElement('div');
        actions.className = 'actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'btn-primary btn-small';
        openBtn.textContent = 'Open';
        openBtn.onclick = (e) => { e.stopPropagation(); Router.navigate('#model/' + encodeURIComponent(entry.id)); };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger btn-small';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await confirmDialog(`Remove "${entry.title}" from your working models?`);
            if (ok) {
                removeFromWorkspace(entry.id);
                selectedId = null;
                render();
            }
        };

        actions.appendChild(openBtn);
        actions.appendChild(removeBtn);
        panel.appendChild(actions);

        return panel;
    }

    // -----------------------------------------------------------------------
    // Add model section
    // -----------------------------------------------------------------------
    function buildAddModelSection() {
        const section = document.createElement('div');
        section.className = 'add-model-section';
        section.innerHTML = '<h2>Add a Model</h2>';

        // Popular models (always shown — same base model can be added multiple times)
        const label = document.createElement('div');
        label.style.cssText = 'font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;';
        label.textContent = 'Popular models:';
        section.appendChild(label);

        const chips = document.createElement('div');
        chips.className = 'popular-models';
        for (const name of POPULAR_MODELS) {
            const chip = document.createElement('div');
            chip.className = 'popular-chip';
            chip.textContent = name;
            chip.onclick = () => addModelByName(name);
            chips.appendChild(chip);
        }
        section.appendChild(chips);

        // Search HuggingFace
        const searchLabel = document.createElement('div');
        searchLabel.style.cssText = 'font-size: 0.8rem; color: var(--text-muted); margin-top: 12px;';
        searchLabel.textContent = 'Search HuggingFace:';
        section.appendChild(searchLabel);

        const searchContainer = document.createElement('div');
        searchContainer.className = 'search-container';

        const searchRow = document.createElement('div');
        searchRow.className = 'search-row';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'e.g. Qwen/ or meta-llama/Llama-3';
        searchInput.id = 'hf-search-input';

        const searchBtn = document.createElement('button');
        searchBtn.className = 'btn-secondary btn-small';
        searchBtn.textContent = 'Search';

        searchRow.appendChild(searchInput);
        searchRow.appendChild(searchBtn);
        searchContainer.appendChild(searchRow);

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'search-results';
        resultsDiv.style.display = 'none';
        searchContainer.appendChild(resultsDiv);

        const statusDiv = document.createElement('div');
        statusDiv.style.cssText = 'font-size: 0.75rem; margin-top: 4px; min-height: 1.2em;';
        searchContainer.appendChild(statusDiv);

        async function doSearch() {
            const query = searchInput.value.trim();
            if (!query) return;

            statusDiv.textContent = 'Searching...';
            statusDiv.className = 'status-loading';
            resultsDiv.style.display = 'none';

            try {
                const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=text-generation&sort=downloads&direction=-1&limit=20`;
                const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
                const models = await resp.json();

                resultsDiv.innerHTML = '';
                if (models.length === 0) {
                    statusDiv.textContent = 'No models found.';
                    statusDiv.className = 'status-err';
                    return;
                }

                statusDiv.textContent = `${models.length} result(s)`;
                statusDiv.className = 'status-ok';

                for (const m of models) {
                    const modelId = m.id || m.modelId;
                    const item = document.createElement('div');
                    item.className = 'search-result-item';
                    item.textContent = modelId;
                    item.onclick = () => {
                        resultsDiv.style.display = 'none';
                        searchInput.value = '';
                        addModelByName(modelId);
                    };
                    resultsDiv.appendChild(item);
                }
                resultsDiv.style.display = 'block';
            } catch (e) {
                statusDiv.textContent = e.message;
                statusDiv.className = 'status-err';
            }
        }

        searchBtn.onclick = doSearch;
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (searchInput.value.trim().length >= 3) doSearch();
            }, 500);
        });

        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target)) {
                resultsDiv.style.display = 'none';
            }
        });

        section.appendChild(searchContainer);
        return section;
    }

    // -----------------------------------------------------------------------
    // Add a model by name (fetch from HF if needed, then add to workspace)
    // -----------------------------------------------------------------------
    async function addModelByName(hfName) {
        const statusDiv = container.querySelector('.search-container div:last-child') ||
            (() => { const d = document.createElement('div'); container.appendChild(d); return d; })();

        // Check if config is already cached in the model store
        let config = getModelConfig(hfName);
        if (!config) {
            statusDiv.textContent = `Fetching ${hfName}...`;
            statusDiv.className = 'status-loading';
            try {
                const token = getHFToken();
                config = await fetchModelFromHF(hfName, token);
                // Cache in model store for future adds
                saveModelConfig(hfName, config);
            } catch (e) {
                statusDiv.textContent = e.message;
                statusDiv.className = 'status-err';
                return;
            }
        }

        // Use the HF name as the default title
        let title = hfName;

        // If this exact title already exists, append a number
        if (isWorkspaceTitleTaken(title)) {
            let n = 2;
            while (isWorkspaceTitleTaken(`${hfName} (${n})`)) n++;
            title = `${hfName} (${n})`;
        }

        const newId = addToWorkspace(hfName, config, title);
        selectedId = newId;
        render();
    }

    render();
    return null;
}
