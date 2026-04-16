// ---------------------------------------------------------------------------
// Shared app state: dirty tracking and beforeunload guard
// ---------------------------------------------------------------------------
const State = {
    _dirty: false,
    _previousHash: '#home',

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
