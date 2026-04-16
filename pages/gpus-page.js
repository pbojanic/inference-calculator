// ---------------------------------------------------------------------------
// GPUs page: manage GPU profiles (list, add, edit, remove, reset)
// ---------------------------------------------------------------------------

function renderGpusPage(container) {
    let editingGpuId = null;
    let editDirty = false;

    function render() {
        container.innerHTML = '';

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;';
        header.innerHTML = '<h2 style="margin: 0; border: none; padding: 0;">GPU Profiles</h2>';

        const headerActions = document.createElement('div');
        headerActions.className = 'actions';
        headerActions.style.margin = '0';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-danger btn-small';
        resetBtn.textContent = 'Reset to Defaults';
        resetBtn.onclick = async () => {
            const ok = await confirmDialog('Reset GPU list to application defaults? This will remove custom GPUs and restore deleted defaults.');
            if (ok) {
                resetGpusToDefaults();
                editingGpuId = null;
                editDirty = false;
                State.setDirty(false);
                render();
            }
        };

        headerActions.appendChild(resetBtn);
        header.appendChild(headerActions);
        container.appendChild(header);

        // GPU list
        const gpus = getGpuList();
        const list = document.createElement('div');
        list.className = 'gpu-list';

        for (const gpu of gpus) {
            list.appendChild(buildGpuCard(gpu));
        }

        container.appendChild(list);

        // Add GPU form
        container.appendChild(buildAddForm());
    }

    // -----------------------------------------------------------------------
    // GPU card
    // -----------------------------------------------------------------------
    function buildGpuCard(gpu) {
        const card = document.createElement('div');
        card.className = 'card';

        if (editingGpuId === gpu.id) {
            card.appendChild(buildEditForm(gpu));
            return card;
        }

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const info = document.createElement('div');
        info.innerHTML = `<span class="gpu-card-name">${gpu.name}</span> <span class="gpu-card-mem">${gpu.memoryGB} GB usable</span>`;

        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.style.margin = '0';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-secondary btn-small';
        editBtn.textContent = 'Edit';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            if (editDirty) return;
            editingGpuId = gpu.id;
            render();
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-danger btn-small';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = async (e) => {
            e.stopPropagation();
            const inUse = isGpuInUse(gpu.id);
            if (inUse.length > 0) {
                const ok = await confirmDialog(
                    `"${gpu.name}" is used by: ${inUse.join(', ')}. Remove anyway? Those models will need a new GPU assigned.`
                );
                if (!ok) return;
            } else {
                const ok = await confirmDialog(`Remove "${gpu.name}"?`);
                if (!ok) return;
            }
            removeGpu(gpu.id);
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
    function buildEditForm(gpu) {
        const form = document.createElement('div');
        form.className = 'edit-form';
        form.onclick = (e) => e.stopPropagation();

        form.innerHTML = `
            <div class="gpu-form">
                <label>Name
                    <input type="text" id="gpu-edit-name" value="${gpu.name}">
                </label>
                <label>Usable memory (GB)
                    <input type="number" id="gpu-edit-mem" value="${gpu.memoryGB}" step="0.1" min="0.1">
                </label>
            </div>
            <div class="actions">
                <button class="btn-primary btn-small" id="gpu-edit-save">Save</button>
                <button class="btn-secondary btn-small" id="gpu-edit-cancel">Cancel</button>
            </div>
        `;

        form.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('input', () => {
                editDirty = true;
                State.setDirty(true);
            });
        });

        setTimeout(() => {
            const saveBtn = document.getElementById('gpu-edit-save');
            const cancelBtn = document.getElementById('gpu-edit-cancel');
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const name = document.getElementById('gpu-edit-name').value.trim();
                    const mem = parseFloat(document.getElementById('gpu-edit-mem').value);
                    if (!name || !mem || mem <= 0) return;
                    saveGpu({ id: gpu.id, name, memoryGB: mem });
                    editingGpuId = null;
                    editDirty = false;
                    State.setDirty(false);
                    render();
                };
            }
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    editingGpuId = null;
                    editDirty = false;
                    State.setDirty(false);
                    render();
                };
            }
        }, 0);

        return form;
    }

    // -----------------------------------------------------------------------
    // Add GPU form
    // -----------------------------------------------------------------------
    function buildAddForm() {
        const section = document.createElement('div');
        section.style.marginTop = '16px';
        section.innerHTML = `
            <h2>Add GPU</h2>
            <div class="gpu-form">
                <label>Name
                    <input type="text" id="gpu-add-name" placeholder="e.g. H200 141GB">
                </label>
                <label>Usable memory (GB)
                    <input type="number" id="gpu-add-mem" placeholder="e.g. 140.0" step="0.1" min="0.1">
                </label>
                <button class="btn-primary btn-small" id="gpu-add-btn" style="align-self: flex-end;">Add</button>
            </div>
            <div id="gpu-add-status" style="font-size: 0.75rem; margin-top: 4px; min-height: 1.2em;"></div>
        `;

        setTimeout(() => {
            const addBtn = document.getElementById('gpu-add-btn');
            if (addBtn) {
                addBtn.onclick = () => {
                    const nameEl = document.getElementById('gpu-add-name');
                    const memEl = document.getElementById('gpu-add-mem');
                    const statusEl = document.getElementById('gpu-add-status');
                    const name = nameEl.value.trim();
                    const mem = parseFloat(memEl.value);

                    if (!name) {
                        statusEl.textContent = 'Enter a name.';
                        statusEl.className = 'status-err';
                        return;
                    }
                    if (!mem || mem <= 0) {
                        statusEl.textContent = 'Enter valid memory.';
                        statusEl.className = 'status-err';
                        return;
                    }

                    saveGpu({ name, memoryGB: mem });
                    render();
                };
            }
        }, 0);

        return section;
    }

    render();
    return null;
}
