// ---------------------------------------------------------------------------
// GPU profile data layer (localStorage CRUD)
// ---------------------------------------------------------------------------
const LS_GPUS_KEY = 'gpu_calc_gpus';

const DEFAULT_GPUS = {
    gpu_default_1: { id: 'gpu_default_1', name: 'A100 40GB', memoryGB: 39.6 },
    gpu_default_2: { id: 'gpu_default_2', name: 'A100 80GB', memoryGB: 79.7 },
    gpu_default_3: { id: 'gpu_default_3', name: 'H100 80GB', memoryGB: 79.7 },
    gpu_default_4: { id: 'gpu_default_4', name: 'H200 94GB', memoryGB: 93.1 },
    gpu_default_5: { id: 'gpu_default_5', name: 'B300 288GB', memoryGB: 288.0 },
    gpu_default_6: { id: 'gpu_default_6', name: 'Vera Rubin 288GB', memoryGB: 288.0 }
};

function initGpuStore() {
    if (!localStorage.getItem(LS_GPUS_KEY)) {
        localStorage.setItem(LS_GPUS_KEY, JSON.stringify(DEFAULT_GPUS));
    }
}

function getAllGpus() {
    initGpuStore();
    return JSON.parse(localStorage.getItem(LS_GPUS_KEY));
}

function getGpuList() {
    const gpus = getAllGpus();
    return Object.values(gpus).sort((a, b) => a.name.localeCompare(b.name));
}

function getGpu(id) {
    const gpus = getAllGpus();
    return gpus[id] || null;
}

function saveGpu(gpu) {
    const gpus = getAllGpus();
    if (!gpu.id) {
        gpu.id = 'gpu_' + crypto.randomUUID().slice(0, 8);
    }
    gpus[gpu.id] = { ...gpu };
    localStorage.setItem(LS_GPUS_KEY, JSON.stringify(gpus));
    return gpu.id;
}

function removeGpu(id) {
    const gpus = getAllGpus();
    delete gpus[id];
    localStorage.setItem(LS_GPUS_KEY, JSON.stringify(gpus));
}

function isGpuInUse(gpuId) {
    const entries = getWorkspaceModels();
    const inUse = [];
    for (const entry of entries) {
        if (entry.deployment && entry.deployment.gpuId === gpuId) {
            inUse.push(entry.title);
        }
    }
    return inUse;
}

function resetGpusToDefaults() {
    localStorage.setItem(LS_GPUS_KEY, JSON.stringify(DEFAULT_GPUS));
}

function getDefaultGpuId() {
    return 'gpu_default_2'; // A100 80GB
}
