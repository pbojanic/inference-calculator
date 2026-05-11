// ---------------------------------------------------------------------------
// Confirm dialog and unsaved-changes modal
// ---------------------------------------------------------------------------
function confirmDialog(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        const msg = document.createElement('p');
        msg.textContent = message;
        box.appendChild(msg);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const btnOk = document.createElement('button');
        btnOk.className = 'btn-primary';
        btnOk.textContent = 'OK';
        btnOk.onclick = () => { overlay.remove(); resolve(true); };

        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-secondary';
        btnCancel.textContent = 'Cancel';
        btnCancel.onclick = () => { overlay.remove(); resolve(false); };

        actions.appendChild(btnOk);
        actions.appendChild(btnCancel);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        btnOk.focus();
    });
}

function unsavedChangesDialog() {
    return confirmDialog('You have unsaved changes. Discard?');
}

// Single-button modal for surfacing a blocking message (e.g. "fix these
// mandatory fields before saving"). Resolves when the user dismisses.
//   title — heading shown above the body.
//   body  — a string (rendered as a paragraph) OR an array of strings
//           (rendered as a bullet list, useful for listing several issues).
function alertDialog(title, body) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        if (title) {
            const heading = document.createElement('h3');
            heading.textContent = title;
            heading.style.cssText = 'margin: 0 0 8px 0; border: none; padding: 0;';
            box.appendChild(heading);
        }

        if (Array.isArray(body)) {
            const ul = document.createElement('ul');
            ul.style.cssText = 'margin: 0 0 12px 0; padding-left: 20px;';
            for (const item of body) {
                const li = document.createElement('li');
                li.textContent = item;
                li.style.marginBottom = '4px';
                ul.appendChild(li);
            }
            box.appendChild(ul);
        } else if (body) {
            const p = document.createElement('p');
            p.textContent = body;
            box.appendChild(p);
        }

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const btnOk = document.createElement('button');
        btnOk.className = 'btn-primary';
        btnOk.textContent = 'OK';
        btnOk.onclick = () => { overlay.remove(); resolve(); };

        actions.appendChild(btnOk);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        btnOk.focus();
    });
}

// ---------------------------------------------------------------------------
// Toast — non-blocking warning/info messages, e.g. "data was reset to defaults"
// ---------------------------------------------------------------------------
function _ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, kind, timeoutMs) {
    const container = _ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast--${kind || 'warn'}`;

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    toast.appendChild(text);

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '×';
    close.onclick = () => toast.remove();
    toast.appendChild(close);

    container.appendChild(toast);

    const ms = typeof timeoutMs === 'number' ? timeoutMs : 6000;
    if (ms > 0) {
        setTimeout(() => toast.remove(), ms);
    }
}

// Modal with a text input. Resolves to the entered string, or null if
// cancelled. okLabel customizes the confirm button text.
function promptDialog(message, defaultValue, okLabel) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        const msg = document.createElement('p');
        msg.textContent = message;
        box.appendChild(msg);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue || '';
        input.style.width = '100%';
        input.style.marginTop = '8px';
        box.appendChild(input);

        const actions = document.createElement('div');
        actions.className = 'modal-actions';

        const btnOk = document.createElement('button');
        btnOk.className = 'btn-primary';
        btnOk.textContent = okLabel || 'OK';
        btnOk.onclick = () => { overlay.remove(); resolve(input.value); };

        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn-secondary';
        btnCancel.textContent = 'Cancel';
        btnCancel.onclick = () => { overlay.remove(); resolve(null); };

        actions.appendChild(btnOk);
        actions.appendChild(btnCancel);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnOk.click();
            else if (e.key === 'Escape') btnCancel.click();
        });

        setTimeout(() => { input.focus(); input.select(); }, 0);
    });
}
