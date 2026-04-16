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
