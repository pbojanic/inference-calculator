// ---------------------------------------------------------------------------
// Hash-based SPA router with navigation guard
// ---------------------------------------------------------------------------
const Router = {
    _routes: {},
    _currentCleanup: null,
    _guardActive: false,
    // Set when we programmatically revert location.hash after the user cancels
    // the unsaved-changes dialog. Consumed exactly once by the resulting
    // hashchange event so the dialog doesn't fire a second time.
    _ignoreNextHashChange: false,

    init(routes) {
        this._routes = routes;
        window.addEventListener('hashchange', () => this._onHashChange());
        // Initial route
        if (!location.hash || location.hash === '#') {
            location.hash = '#home';
        } else {
            this._onHashChange();
        }
    },

    async navigate(hash) {
        if (State.isDirty()) {
            const discard = await unsavedChangesDialog();
            if (!discard) return;
            State.setDirty(false);
        }
        location.hash = hash;
    },

    async _onHashChange() {
        // Swallow the hashchange fired by our own programmatic revert after
        // the user chose "keep editing" in the unsaved-changes dialog.
        if (this._ignoreNextHashChange) {
            this._ignoreNextHashChange = false;
            return;
        }
        if (this._guardActive) return;

        const hash = location.hash || '#home';

        // Check dirty state for back/forward navigation
        if (State.isDirty()) {
            this._guardActive = true;
            const discard = await unsavedChangesDialog();
            this._guardActive = false;
            if (!discard) {
                // Revert to previous hash. The resulting hashchange will be
                // consumed by the _ignoreNextHashChange branch above.
                this._ignoreNextHashChange = true;
                location.hash = State.getPreviousHash();
                return;
            }
            State.setDirty(false);
        }

        State.setPreviousHash(hash);
        this._render(hash);
    },

    _render(hash) {
        // Cleanup previous page
        if (this._currentCleanup) {
            this._currentCleanup();
            this._currentCleanup = null;
        }

        const { page, params } = this._parseHash(hash);
        const renderFn = this._routes[page];

        const app = document.getElementById('app');
        app.innerHTML = '';

        // Render nav
        const nav = renderNav(page);
        app.appendChild(nav);

        // Render page content
        const content = document.createElement('div');
        content.className = 'page-content';
        app.appendChild(content);

        if (renderFn) {
            this._currentCleanup = renderFn(content, params) || null;
        } else {
            content.innerHTML = '<p>Page not found.</p>';
        }
    },

    _parseHash(hash) {
        const raw = hash.replace(/^#/, '');
        const parts = raw.split('/');
        const page = parts[0] || 'home';
        const params = {};

        if (page === 'model' && parts.length > 1) {
            params.id = decodeURIComponent(parts.slice(1).join('/'));
            return { page: 'model', params };
        }

        return { page, params };
    },

    getCurrentRoute() {
        return this._parseHash(location.hash);
    }
};
