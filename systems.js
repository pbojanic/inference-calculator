// ---------------------------------------------------------------------------
// Systems data layer
//
// A "system" is a deployable unit (DGX H100, GB200 NVL72, …) made up of a
// fixed number of GPUs of the same type, with read- and write-bandwidth caps
// to shared KV-cache storage.
//
// Replaces the previous "GPU profiles" concept. The legacy `gpu_calc_gpus`
// localStorage key is removed in migrateLocalStorage if present.
// ---------------------------------------------------------------------------

const LS_SYSTEMS_KEY = 'gpu_calc_systems';
const SYSTEMS_VERSION = 1;

const DEFAULT_SYSTEMS = {
    sys_default_dgx_a100: {
        id: 'sys_default_dgx_a100',
        name: 'DGX A100 (80 GB)',
        gpuType: 'A100',
        gpuCount: 8,
        gpuMemoryGB: 80,
        readBandwidthGiBps: 30,
        writeBandwidthGiBps: 25
    },
    sys_default_dgx_h100: {
        id: 'sys_default_dgx_h100',
        name: 'DGX H100',
        gpuType: 'H100',
        gpuCount: 8,
        gpuMemoryGB: 80,
        readBandwidthGiBps: 60,
        writeBandwidthGiBps: 80
    },
    sys_default_dgx_h200: {
        id: 'sys_default_dgx_h200',
        name: 'DGX H200',
        gpuType: 'H200',
        gpuCount: 8,
        gpuMemoryGB: 141,
        readBandwidthGiBps: 90,
        writeBandwidthGiBps: 90
    },
    sys_default_hgx_h100: {
        id: 'sys_default_hgx_h100',
        name: 'HGX H100',
        gpuType: 'H100',
        gpuCount: 8,
        gpuMemoryGB: 80,
        readBandwidthGiBps: 60,
        writeBandwidthGiBps: 80
    },
    sys_default_hgx_h200: {
        id: 'sys_default_hgx_h200',
        name: 'HGX H200',
        gpuType: 'H200',
        gpuCount: 8,
        gpuMemoryGB: 141,
        readBandwidthGiBps: 90,
        writeBandwidthGiBps: 90
    },
    sys_default_gb200_nvl72: {
        id: 'sys_default_gb200_nvl72',
        name: 'GB200 NVL72',
        gpuType: 'B200',
        gpuCount: 72,
        gpuMemoryGB: 192,
        readBandwidthGiBps: 400,
        writeBandwidthGiBps: 400
    }
};

function initSystemStore() {
    // Reading is enough — loadVersionedPayload seeds defaults when missing.
    getAllSystems();
}

function getAllSystems() {
    return loadVersionedPayload(
        LS_SYSTEMS_KEY, SYSTEMS_VERSION,
        () => ({ ...DEFAULT_SYSTEMS }),
        'Systems list',
        { silentUpgrade: true }
    );
}

function _saveAllSystems(systems) {
    saveVersionedPayload(LS_SYSTEMS_KEY, SYSTEMS_VERSION, systems);
}

function getSystemList() {
    const systems = getAllSystems();
    return Object.values(systems).sort((a, b) => a.name.localeCompare(b.name));
}

function getSystem(id) {
    const systems = getAllSystems();
    return systems[id] || null;
}

function saveSystem(system) {
    const systems = getAllSystems();
    if (!system.id) {
        system.id = 'sys_' + crypto.randomUUID().slice(0, 8);
    }
    systems[system.id] = { ...system };
    _saveAllSystems(systems);
    return system.id;
}

function removeSystem(id) {
    const systems = getAllSystems();
    delete systems[id];
    _saveAllSystems(systems);
}

function isSystemInUse(systemId) {
    const entries = getWorkspaceModels();
    const inUse = [];
    for (const entry of entries) {
        if (entry.deployment && entry.deployment.systemId === systemId) {
            inUse.push(entry.title);
        }
    }
    return inUse;
}

function resetSystemsToDefaults() {
    _saveAllSystems({ ...DEFAULT_SYSTEMS });
}

function getDefaultSystemId() {
    return 'sys_default_dgx_h100';
}

// One-time cleanup: remove the legacy `gpu_calc_gpus` key if present.
// Safe to call repeatedly — does nothing once the key is gone.
function cleanupLegacyGpusKey() {
    if (localStorage.getItem('gpu_calc_gpus') !== null) {
        localStorage.removeItem('gpu_calc_gpus');
    }
}
