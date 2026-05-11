// ---------------------------------------------------------------------------
// Settings page: HuggingFace token, export/import
// ---------------------------------------------------------------------------

function renderSettingsPage(container) {

    function render() {
        container.innerHTML = '';

        const title = document.createElement('h2');
        title.style.cssText = 'margin: 0 0 12px; border: none; padding: 0;';
        title.textContent = 'Settings';
        container.appendChild(title);

        const panel = document.createElement('div');
        panel.className = 'panel';

        // HuggingFace token
        const tokenLabel = document.createElement('label');
        tokenLabel.textContent = 'HuggingFace Token (for gated/private models)';
        panel.appendChild(tokenLabel);

        const row = document.createElement('div');
        row.className = 'token-row';

        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'hf_...';
        input.value = getHFToken();
        input.addEventListener('blur', () => {
            saveHFToken(input.value.trim());
            status.textContent = input.value.trim() ? 'Token saved' : 'Token cleared';
            setTimeout(() => status.textContent = '', 2000);
        });

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-secondary btn-small';
        toggleBtn.textContent = 'Show';
        toggleBtn.onclick = () => {
            if (input.type === 'password') {
                input.type = 'text';
                toggleBtn.textContent = 'Hide';
            } else {
                input.type = 'password';
                toggleBtn.textContent = 'Show';
            }
        };

        const testBtn = document.createElement('button');
        testBtn.className = 'btn-secondary btn-small';
        testBtn.textContent = 'Test';
        testBtn.onclick = async () => {
            const token = input.value.trim();
            if (!token) {
                status.textContent = 'Enter a token first.';
                status.className = 'status-err';
                return;
            }
            testBtn.disabled = true;
            testBtn.textContent = '...';
            status.textContent = 'Testing...';
            status.className = 'status-loading';
            try {
                const resp = await fetch('https://huggingface.co/api/whoami-v2', {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: AbortSignal.timeout(10000)
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const name = data.name || data.fullname || 'unknown';
                    status.textContent = `Valid token (${name})`;
                    status.className = 'status-ok';
                } else if (resp.status === 401) {
                    status.textContent = 'Invalid token.';
                    status.className = 'status-err';
                } else {
                    status.textContent = `HuggingFace returned ${resp.status}`;
                    status.className = 'status-err';
                }
            } catch (e) {
                status.textContent = e.message;
                status.className = 'status-err';
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = 'Test';
            }
        };

        row.appendChild(input);
        row.appendChild(toggleBtn);
        row.appendChild(testBtn);
        panel.appendChild(row);

        const status = document.createElement('div');
        status.className = 'token-status';
        panel.appendChild(status);

        // Export / Import
        const dataLabel = document.createElement('label');
        dataLabel.style.marginTop = '16px';
        dataLabel.textContent = 'Data backup';
        panel.appendChild(dataLabel);

        const dataRow = document.createElement('div');
        dataRow.className = 'actions';
        dataRow.style.marginTop = '4px';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn-secondary btn-small';
        exportBtn.textContent = 'Export';
        exportBtn.onclick = async () => {
            const data = {
                version: 2,
                workspace: JSON.parse(localStorage.getItem(LS_WORKSPACE_KEY) || '{}'),
                systems: JSON.parse(localStorage.getItem(LS_SYSTEMS_KEY) || '{}'),
                models: JSON.parse(localStorage.getItem(LS_MODELS_KEY) || '{}'),
                plan: JSON.parse(localStorage.getItem(LS_PLAN_KEY) || '{}')
            };
            const json = JSON.stringify(data, null, 2);
            const suggestedName = `inference-calculator-backup-${new Date().toISOString().slice(0, 10)}.json`;

            // Preferred path: native OS Save As dialog via the File System
            // Access API. Only available in Chromium browsers AND requires a
            // secure context — it often fails on file:// origins.
            if (typeof window.showSaveFilePicker === 'function') {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName,
                        types: [{
                            description: 'JSON file',
                            accept: { 'application/json': ['.json'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(json);
                    await writable.close();
                    status.textContent = 'Data exported.';
                    status.className = 'status-ok';
                    setTimeout(() => status.textContent = '', 2000);
                    return;
                } catch (err) {
                    // User dismissed the native picker — stop silently.
                    if (err && err.name === 'AbortError') return;
                    // API is present but failed (e.g., SecurityError on a
                    // file:// origin). Log and fall through to the prompt-
                    // based fallback so the user still gets a prompt.
                    console.warn('showSaveFilePicker failed, using prompt fallback:', err);
                }
            }

            // Fallback: the browser either doesn't support showSaveFilePicker
            // (Safari, Firefox) or blocked it (file:// origin). Show our own
            // filename prompt so the user is never surprised by a silent
            // download.
            const filename = await promptDialog(
                'Save exported data as (file will be saved to your browser\'s default Downloads folder):',
                suggestedName,
                'Download'
            );
            if (filename === null) return; // cancelled

            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (filename.trim() || suggestedName);
            a.click();
            URL.revokeObjectURL(url);
            status.textContent = `Exported as ${a.download}.`;
            status.className = 'status-ok';
            setTimeout(() => status.textContent = '', 3000);
        };

        const importBtn = document.createElement('button');
        importBtn.className = 'btn-secondary btn-small';
        importBtn.textContent = 'Import';
        importBtn.onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                if (!file) return;
                const ok = await confirmDialog('Import will replace your current workspace, Systems, cached models, and plan data. Continue?');
                if (!ok) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data.workspace) localStorage.setItem(LS_WORKSPACE_KEY, JSON.stringify(data.workspace));
                    if (data.systems) localStorage.setItem(LS_SYSTEMS_KEY, JSON.stringify(data.systems));
                    if (data.models) localStorage.setItem(LS_MODELS_KEY, JSON.stringify(data.models));
                    if (data.plan) localStorage.setItem(LS_PLAN_KEY, JSON.stringify(data.plan));
                    status.textContent = 'Data imported.';
                    status.className = 'status-ok';
                    render();
                } catch (e) {
                    status.textContent = 'Invalid file: ' + e.message;
                    status.className = 'status-err';
                }
            };
            fileInput.click();
        };

        dataRow.appendChild(exportBtn);
        dataRow.appendChild(importBtn);
        panel.appendChild(dataRow);

        // Plan data
        const planLabel = document.createElement('label');
        planLabel.style.marginTop = '16px';
        planLabel.textContent = 'Plan data';
        panel.appendChild(planLabel);

        const planHelp = document.createElement('p');
        planHelp.style.cssText = 'margin: 2px 0 4px; color: var(--text-muted); font-size: 0.8rem;';
        planHelp.textContent =
            'Reset all planning inputs (planning horizon, per-model server instances, requests/sec ranges, distribution buckets) to their defaults. ' +
            'Your workspace models, GPU list, and cached model configs are not affected.';
        panel.appendChild(planHelp);

        const planRow = document.createElement('div');
        planRow.className = 'actions';
        planRow.style.marginTop = '4px';

        const newPlanBtn = document.createElement('button');
        newPlanBtn.className = 'btn-secondary btn-small';
        newPlanBtn.textContent = 'Start new plan';
        newPlanBtn.onclick = async () => {
            const ok = await confirmDialog(
                'Start a new plan? This will reset all per-model planning inputs to defaults. ' +
                'Workspace models, GPUs, and cached model configs are not affected.'
            );
            if (!ok) return;
            localStorage.removeItem(LS_PLAN_KEY);
            status.textContent = 'Plan data reset to defaults.';
            status.className = 'status-ok';
            setTimeout(() => status.textContent = '', 2500);
        };
        planRow.appendChild(newPlanBtn);
        panel.appendChild(planRow);

        container.appendChild(panel);
    }

    render();
    return null;
}
