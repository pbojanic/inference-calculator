// ---------------------------------------------------------------------------
// Global navigation header + nav links
// ---------------------------------------------------------------------------
function renderNav(currentPage) {
    const header = document.createElement('div');
    header.className = 'app-header';

    header.innerHTML = `
        <div class="header-brand">
            <img src="assets/ddn-logo-light.svg" alt="DDN" class="header-logo">
            <div class="header-text">
                <h1>GPU Memory Calculator for LLM Inference</h1>
                <p class="subtitle">Calculate GPU memory requirements for vLLM deployments.</p>
            </div>
        </div>
        <nav class="nav-bar">
            <a href="#home" class="nav-link ${currentPage === 'home' ? 'active' : ''}">Models</a>
            <a href="#gpus" class="nav-link ${currentPage === 'gpus' ? 'active' : ''}">GPUs</a>
            <a href="#plan" class="nav-link ${currentPage === 'plan' ? 'active' : ''}">Plan</a>
            <a href="#references" class="nav-link ${currentPage === 'references' ? 'active' : ''}">References</a>
            <a href="#settings" class="nav-link ${currentPage === 'settings' ? 'active' : ''}">Settings</a>
        </nav>
    `;

    return header;
}
