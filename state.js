// ---------------------------------------------------------------------------
// Shared app state: dirty tracking and beforeunload guard
// ---------------------------------------------------------------------------
const State = {
    _dirty: false,
    _previousHash: '#home',
    // In-memory holding slot for a model that the user has chosen but not
    // yet saved. Populated by the Home page when a model is added; consumed
    // by the Model Details page under the synthetic id `_new`. Cleared on
    // Save (after persistence) or Cancel. Intentionally NOT persisted —
    // refreshing the page mid-add discards the draft.
    pendingNewModel: null,

    isDirty() {
        return this._dirty;
    },

    setDirty(dirty) {
        this._dirty = dirty;
        if (dirty) {
            window.onbeforeunload = () => 'You have unsaved changes.';
        } else {
            window.onbeforeunload = null;
        }
    },

    getPreviousHash() {
        return this._previousHash;
    },

    setPreviousHash(hash) {
        this._previousHash = hash;
    }
};
