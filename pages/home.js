// ---------------------------------------------------------------------------
// Home page: settings, working models list, add/search/edit/remove
// ---------------------------------------------------------------------------

const POPULAR_MODELS = [
    'Qwen/Qwen3-32B',
    'meta-llama/Llama-3.2-1B-Instruct',
    'meta-llama/Llama-3.1-70B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct'
];

// If the user pastes a full HF model ID (`<owner>/<model>`) or an HF URL,
// return the canonical `<owner>/<model>` so we can skip the search API and
// fetch the config directly. Returns null when the input is a search term
// (anything that doesn't look like a complete identifier).
//
// HF allows letters, numbers, underscores, dots, and hyphens in both the
// owner and model segments. We accept either a bare id, or a URL on
// huggingface.co / hf.co (with or without protocol, with or without an
// extra path like /tree/main or /blob/main/config.json).
function extractHfModelId(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;

    const urlRe = /^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co|hf\.co)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i;
    const m = trimmed.match(urlRe);
    if (m) return `${m[1]}/${m[2]}`;

    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;

    return null;
}

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
            const sys = getSystem(deployment.systemId);
            const sysName = sys ? sys.name : 'No system';

            const swCap = config.sliding_window ? ` (sw: ${(config.sliding_window / 1024).toFixed(0)}K)` : '';
            const moeNote = params.is_moe
                ? ` <span style="color: var(--text-muted); font-size: 0.85em;">(MoE ${params.num_routed_experts}\u00d7${params.moe_intermediate_size}, top-${params.num_experts_per_tok || '?'})</span>`
                : '';
            const totalB = (params.total_params / 1e9).toFixed(1);
            const paramsLabel = params.is_moe
                ? `${(params.active_params / 1e9).toFixed(1)}B act / ${totalB}B`
                : `${totalB}B`;

            stats.innerHTML = `
                <span>${sysName}</span>
                <span>Params: ${paramsLabel}</span>
                <span>Weights: ${weightGB.toFixed(1)} GiB${moeNote}</span>
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
            const activeGB = (params.active_params * (deployment.bytesPerWeight || 2)) / (1024 ** 3);
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

            const sys = getSystem(deployment.systemId);
            const sysDisplay = sys
                ? `${sys.name} — ${sys.gpuCount}× ${sys.gpuType} @ ${sys.gpuMemoryGB} GB/GPU`
                : 'No system assigned';
            const ppVal = deployment.pp || 1;
            const tpPpLabel = ppVal > 1
                ? `TP=${deployment.tp}, PP=${ppVal} (${deployment.tp * ppVal} GPUs/instance)`
                : `TP=${deployment.tp}`;

            const moeRow = params.is_moe
                ? `<div class="model-detail-row"><span class="label">Architecture:</span> MoE — ${params.num_routed_experts} routed experts (top-${params.num_experts_per_tok || '?'} per token)${params.num_shared_experts > 0 ? `, ${params.num_shared_experts} shared` : ''}${params.num_mtp_modules > 0 ? `, ${params.num_mtp_modules} MTP` : ''}</div>
                <div class="model-detail-row"><span class="label">Active params:</span> ${(params.active_params / 1e9).toFixed(2)}B / ${(params.total_params / 1e9).toFixed(2)}B total (${activeGB.toFixed(2)} GiB active)</div>`
                : `<div class="model-detail-row"><span class="label">Parameters:</span> ${(params.total_params / 1e9).toFixed(2)}B</div>`;

            panel.innerHTML = `
                <div class="model-detail-row"><span class="label">System:</span> ${sysDisplay}</div>
                <div class="model-detail-row"><span class="label">Max context:</span> ${(ctxLen / 1024).toFixed(0)}K tokens${ctxNote}</div>
                ${swNote}
                ${moeRow}
                <div class="model-detail-row"><span class="label">Weight memory:</span> ${weightGB.toFixed(2)} GiB</div>
                <div class="model-detail-row"><span class="label">KV Cache (agg):</span> ${kv.total_kv_cache_gb.toFixed(2)} GiB${kvNote}</div>
                <div class="model-detail-row"><span class="label">Parallelism:</span> ${tpPpLabel}</div>
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
        searchInput.placeholder = 'Search by name, or paste a full HF id / URL';
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

        async function doSearch(opts) {
            const explicit = !!(opts && opts.explicit);
            const query = searchInput.value.trim();
            if (!query) return;

            // Cancel any pending debounced search so it can't overwrite our
            // status mid-fetch (race: explicit Enter fires before a 500ms
            // typing-debounce timer that was queued by the paste).
            if (explicit) clearTimeout(searchTimeout);

            // Fast-path: when the user pastes a full HF model ID or URL on an
            // explicit submit (Enter or Search button), skip the search API
            // and fetch the config directly. Saves a click for the very case
            // where search-by-popularity buries fresh releases (a brand-new
            // model with low downloads won't make our `limit=20` page).
            //
            // Gated on `explicit` so the debounced typing path doesn't fire
            // a fetch mid-keystroke when the input briefly looks like a
            // complete id (e.g. user pauses after typing "mistralai/Mistral").
            // The paste event handler also routes through here with
            // explicit:true so a pasted URL fires immediately.
            if (explicit) {
                const directId = extractHfModelId(query);
                if (directId) {
                    statusDiv.textContent = `Fetching ${directId}...`;
                    statusDiv.className = 'status-loading';
                    resultsDiv.style.display = 'none';
                    await addModelByName(directId);
                    return;
                }
            }

            statusDiv.textContent = 'Searching...';
            statusDiv.className = 'status-loading';
            resultsDiv.style.display = 'none';

            try {
                // Build the query params from the input shape. An "owner/" or
                // "owner/partial" query is scoped to that org via the HF
                // `author=` filter (an exact namespace match), with any text
                // after the slash narrowing within the org via `search=`. A
                // slash-less query keeps the plain full-text `search=` behavior.
                const params = new URLSearchParams();
                const slash = query.indexOf('/');
                if (slash !== -1) {
                    params.set('author', query.slice(0, slash));
                    const rest = query.slice(slash + 1).trim();
                    if (rest) params.set('search', rest);
                } else {
                    params.set('search', query);
                }
                params.set('filter', 'text-generation');
                params.set('sort', 'downloads');
                params.set('direction', '-1');
                params.set('limit', '20');
                const url = `https://huggingface.co/api/models?${params.toString()}`;
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

        searchBtn.onclick = () => doSearch({ explicit: true });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch({ explicit: true }); }
        });

        // Paste a full HF id or URL → fire the fast-path right away rather
        // than waiting 500ms for the debounced search (which would hit the
        // search API and report "No models found" for a brand-new release
        // not yet in the top-20-by-downloads). We read the pasted text from
        // clipboardData because the input.value isn't updated yet at this
        // point in the event sequence.
        searchInput.addEventListener('paste', (e) => {
            const cb = e.clipboardData || window.clipboardData;
            if (!cb) return;
            const pasted = cb.getData('text');
            const directId = extractHfModelId(pasted);
            if (!directId) return;
            e.preventDefault();
            searchInput.value = directId;
            clearTimeout(searchTimeout);
            doSearch({ explicit: true });
        });

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                // Debounced typing: never trigger the explicit fast-path so a
                // mid-keystroke pause on "mistralai/Mistral" doesn't fire a
                // fetch the user didn't intend.
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
    // Add a model by name. Fetches from HF if not cached, then stages a
    // PENDING entry on State.pendingNewModel and routes to Model Details.
    // The model is NOT persisted to the workspace until the user presses
    // Save on the Details page (and clears mandatory-field validation).
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
                // Cache the architecture config for future adds. This is
                // the cached model store, not the workspace — caching the
                // raw HF config is fine even if the user cancels.
                saveModelConfig(hfName, config);
            } catch (e) {
                statusDiv.textContent = e.message;
                statusDiv.className = 'status-err';
                return;
            }
        }

        // Default title is the HF name; auto-suffix if it collides with an
        // existing workspace entry so the user lands on a saveable default.
        let title = hfName;
        if (isWorkspaceTitleTaken(title)) {
            let n = 2;
            while (isWorkspaceTitleTaken(`${hfName} (${n})`)) n++;
            title = `${hfName} (${n})`;
        }

        State.pendingNewModel = { baseModel: hfName, config, title };
        Router.navigate('#model/_new');
    }

    render();
    return null;
}
