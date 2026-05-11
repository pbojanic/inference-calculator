// ---------------------------------------------------------------------------
// Systems page: manage GPU systems (DGX-class pods, NVL-rack platforms, …).
// Each system bundles GPU type, GPU count, per-GPU memory, and read/write
// bandwidth caps that drive Plan-page throughput capping.
// ---------------------------------------------------------------------------

function renderSystemsPage(container) {
    let editingSystemId = null;
    let editDirty = false;

    function render() {
        container.innerHTML = '';

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;';
        header.innerHTML = '<h2 style="margin: 0; border: none; padding: 0;">Systems</h2>';

        const headerActions = document.createElement('div');
        headerActions.className = 'actions';
        headerActions.style.margin = '0';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-danger btn-small';
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.onclick = async () => {
            const ok = await confirmDialog('Reset Systems list to application defaults? This will remove custom systems and restore deleted defaults.');
            if (ok) {
                resetSystemsToDefaults();
                editingSystemId = null;
                editDirty = false;
                State.setDirty(false);
                render();
            }
        };

        headerActions.appendChild(resetBtn);
        header.appendChild(headerActions);
        container.appendChild(header);

        const systems = getSystemList();
        const list = document.createElement('div');
        list.className = 'gpu-list';

        for (const sys of systems) {
            list.appendChild(buildSystemCard(sys));
        }

        container.appendChild(list);
        container.appendChild(buildAddForm());
    }

    // -----------------------------------------------------------------------
    // System card
    // -----------------------------------------------------------------------
    function buildSystemCard(sys) {
        const card = document.createElement('div');
        card.className = 'card';

        if (editingSystemId === sys.id) {
            card.appendChild(buildEditForm(sys));
            return card;
        }

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;';

        const info = document.createElement('div');
        info.innerHTML = `
            <div class="gpu-card-name">${sys.name}</div>
            <div class="gpu-card-mem">
                ${sys.gpuCount}× ${sys.gpuType} · ${sys.gpuMemoryGB} GB/GPU ·
                <span title="Per-system read bandwidth to shared storage">read ${sys.readBandwidthGiBps} GiB/s</span> ·
                <span title="Per-system write bandwidth to shared storage">write ${sys.writeBandwidthGiBps} GiB/s</span>
            </div>
        `;

        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.style.margin = '0';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-secondary btn-small';
        editBtn.textContent = 'Edit';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            if (editDirty) return;
            editingSystemId = sys.id;
            render();
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger btn-small';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = async (e) => {
            e.stopPropagation();
            const inUse = isSystemInUse(sys.id);
            if (inUse.length > 0) {
                const ok = await confirmDialog(
                    `"${sys.name}" is used by: ${inUse.join(', ')}. Remove anyway? Those models will need a new system assigned.`
                );
                if (!ok) return;
            } else {
                const ok = await confirmDialog(`Remove "${sys.name}"?`);
                if (!ok) return;
            }
            removeSystem(sys.id);
            render();
        };

        actions.appendChild(editBtn);
        actions.appendChild(removeBtn);

        row.appendChild(info);
        row.appendChild(actions);
        card.appendChild(row);

        return card;
    }

    // -----------------------------------------------------------------------
    // Edit form (inline, replaces card content)
    // -----------------------------------------------------------------------
    function buildEditForm(sys) {
        const form = document.createElement('div');
        form.className = 'edit-form';
        form.onclick = (e) => e.stopPropagation();

        form.innerHTML = `
            <div class="gpu-form">
                <label>Name
                    <input type="text" id="sys-edit-name" value="${sys.name}">
                </label>
                <label>GPU type
                    <input type="text" id="sys-edit-gpuType" value="${sys.gpuType}">
                </label>
                <label>GPU count
                    <input type="number" id="sys-edit-gpuCount" value="${sys.gpuCount}" step="1" min="1">
                </label>
                <label>GPU memory (GB)
                    <input type="number" id="sys-edit-gpuMem" value="${sys.gpuMemoryGB}" step="0.1" min="0.1">
                </label>
                <label>Read bandwidth (GiB/s)
                    <input type="number" id="sys-edit-readBw" value="${sys.readBandwidthGiBps}" step="0.1" min="0.1">
                </label>
                <label>Write bandwidth (GiB/s)
                    <input type="number" id="sys-edit-writeBw" value="${sys.writeBandwidthGiBps}" step="0.1" min="0.1">
                </label>
            </div>
            <div class="actions">
                <button class="btn-primary btn-small" id="sys-edit-save">Save</button>
                <button class="btn-secondary btn-small" id="sys-edit-cancel">Cancel</button>
            </div>
        `;

        form.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                editDirty = true;
                State.setDirty(true);
            });
        });

        setTimeout(() => {
            const saveBtn = document.getElementById('sys-edit-save');
            const cancelBtn = document.getElementById('sys-edit-cancel');
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const name      = document.getElementById('sys-edit-name').value.trim();
                    const gpuType   = document.getElementById('sys-edit-gpuType').value.trim();
                    const gpuCount  = parseInt(document.getElementById('sys-edit-gpuCount').value);
                    const gpuMem    = parseFloat(document.getElementById('sys-edit-gpuMem').value);
                    const readBw    = parseFloat(document.getElementById('sys-edit-readBw').value);
                    const writeBw   = parseFloat(document.getElementById('sys-edit-writeBw').value);
                    if (!name || !gpuType || !Number.isFinite(gpuCount) || gpuCount < 1
                        || !(gpuMem > 0) || !(readBw > 0) || !(writeBw > 0)) return;
                    saveSystem({
                        id: sys.id, name, gpuType, gpuCount, gpuMemoryGB: gpuMem,
                        readBandwidthGiBps: readBw, writeBandwidthGiBps: writeBw
                    });
                    editingSystemId = null;
                    editDirty = false;
                    State.setDirty(false);
                    render();
                };
            }
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    editingSystemId = null;
                    editDirty = false;
                    State.setDirty(false);
                    render();
                };
            }
        }, 0);

        return form;
    }

    // -----------------------------------------------------------------------
    // Add system form
    // -----------------------------------------------------------------------
    function buildAddForm() {
        const section = document.createElement('div');
        section.style.marginTop = '16px';
        section.innerHTML = `
            <h2>Add System</h2>
            <div class="gpu-form">
                <label>Name
                    <input type="text" id="sys-add-name" placeholder="e.g. DGX B200">
                </label>
                <label>GPU type
                    <input type="text" id="sys-add-gpuType" placeholder="e.g. B200">
                </label>
                <label>GPU count
                    <input type="number" id="sys-add-gpuCount" placeholder="e.g. 8" step="1" min="1">
                </label>
                <label>GPU memory (GB)
                    <input type="number" id="sys-add-gpuMem" placeholder="e.g. 192" step="0.1" min="0.1">
                </label>
                <label>Read bandwidth (GiB/s)
                    <input type="number" id="sys-add-readBw" placeholder="e.g. 90" step="0.1" min="0.1">
                </label>
                <label>Write bandwidth (GiB/s)
                    <input type="number" id="sys-add-writeBw" placeholder="e.g. 100" step="0.1" min="0.1">
                </label>
                <button class="btn-primary btn-small" id="sys-add-btn" style="align-self: flex-end;">Add</button>
            </div>
            <div id="sys-add-status" style="font-size: 0.75rem; margin-top: 4px; min-height: 1.2em;"></div>
        `;

        setTimeout(() => {
            const addBtn = document.getElementById('sys-add-btn');
            if (!addBtn) return;
            addBtn.onclick = () => {
                const statusEl = document.getElementById('sys-add-status');
                const name     = document.getElementById('sys-add-name').value.trim();
                const gpuType  = document.getElementById('sys-add-gpuType').value.trim();
                const gpuCount = parseInt(document.getElementById('sys-add-gpuCount').value);
                const gpuMem   = parseFloat(document.getElementById('sys-add-gpuMem').value);
                const readBw   = parseFloat(document.getElementById('sys-add-readBw').value);
                const writeBw  = parseFloat(document.getElementById('sys-add-writeBw').value);

                if (!name)      { statusEl.textContent = 'Enter a name.';            statusEl.className = 'status-err'; return; }
                if (!gpuType)   { statusEl.textContent = 'Enter a GPU type.';        statusEl.className = 'status-err'; return; }
                if (!Number.isFinite(gpuCount) || gpuCount < 1)
                                 { statusEl.textContent = 'GPU count must be ≥ 1.';   statusEl.className = 'status-err'; return; }
                if (!(gpuMem > 0))  { statusEl.textContent = 'Enter valid GPU memory.'; statusEl.className = 'status-err'; return; }
                if (!(readBw > 0))  { statusEl.textContent = 'Enter valid read bandwidth.';  statusEl.className = 'status-err'; return; }
                if (!(writeBw > 0)) { statusEl.textContent = 'Enter valid write bandwidth.'; statusEl.className = 'status-err'; return; }

                saveSystem({
                    name, gpuType, gpuCount, gpuMemoryGB: gpuMem,
                    readBandwidthGiBps: readBw, writeBandwidthGiBps: writeBw
                });
                render();
            };
        }, 0);

        return section;
    }

    render();
    return null;
}
