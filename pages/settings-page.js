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
        exportBtn.onclick = () => {
            const data = {
                version: 1,
                workspace: JSON.parse(localStorage.getItem(LS_WORKSPACE_KEY) || '{}'),
                gpus: JSON.parse(localStorage.getItem(LS_GPUS_KEY) || '{}'),
                models: JSON.parse(localStorage.getItem(LS_MODELS_KEY) || '{}'),
                plan: JSON.parse(localStorage.getItem(LS_PLAN_KEY) || '{}')
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `inference-calculator-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            status.textContent = 'Data exported.';
            status.className = 'status-ok';
            setTimeout(() => status.textContent = '', 2000);
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
                const ok = await confirmDialog('Import will replace your current workspace, GPUs, cached models, and plan data. Continue?');
                if (!ok) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data.workspace) localStorage.setItem(LS_WORKSPACE_KEY, JSON.stringify(data.workspace));
                    if (data.gpus) localStorage.setItem(LS_GPUS_KEY, JSON.stringify(data.gpus));
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

        container.appendChild(panel);
    }

    render();
    return null;
}
