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
