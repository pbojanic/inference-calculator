// Embedded model configurations — ported from model_specs.py MODEL_CONFIGS
// These are the built-in defaults that seed localStorage on first visit.
const BUILTIN_MODELS = {
    "meta-llama/Llama-3.2-3B-Instruct": {
        hidden_size: 3072,
        num_transformer_layers: 28,
        num_attention_heads: 24,
        num_kv_heads: 8,
        head_dimension: 128,
        intermediate_size: 8192,
        vocab_size: 128256,
        tie_word_embeddings: true,
        hidden_act: "silu",
        max_position_embeddings: 131072
    },
    "meta-llama/Llama-3.2-1B-Instruct": {
        hidden_size: 2048,
        num_transformer_layers: 16,
        num_attention_heads: 32,
        num_kv_heads: 8,
        head_dimension: 64,
        intermediate_size: 8192,
        vocab_size: 128256,
        tie_word_embeddings: true,
        hidden_act: "silu",
        max_position_embeddings: 131072
    },
    "meta-llama/Llama-3.1-8B-Instruct": {
        hidden_size: 4096,
        num_transformer_layers: 32,
        num_attention_heads: 32,
        num_kv_heads: 8,
        head_dimension: 128,
        intermediate_size: 14336,
        vocab_size: 128256,
        tie_word_embeddings: true,
        hidden_act: "silu",
        max_position_embeddings: 131072
    },
    "meta-llama/Llama-3.1-70B-Instruct": {
        hidden_size: 8192,
        num_transformer_layers: 80,
        num_attention_heads: 64,
        num_kv_heads: 8,
        head_dimension: 128,
        intermediate_size: 28672,
        vocab_size: 128256,
        tie_word_embeddings: true,
        hidden_act: "silu",
        max_position_embeddings: 131072
    },
    "Qwen/Qwen2.5-7B-Instruct": {
        hidden_size: 4096,
        num_transformer_layers: 28,
        num_attention_heads: 32,
        num_kv_heads: 4,
        head_dimension: 128,
        intermediate_size: 11008,
        vocab_size: 152064,
        tie_word_embeddings: false,
        hidden_act: "silu",
        max_position_embeddings: 32768,
        sliding_window: 131072
    },
    "Qwen/Qwen2.5-32B-Instruct": {
        hidden_size: 5120,
        num_transformer_layers: 64,
        num_attention_heads: 40,
        num_kv_heads: 8,
        head_dimension: 128,
        intermediate_size: 13824,
        vocab_size: 152064,
        tie_word_embeddings: false,
        hidden_act: "silu",
        max_position_embeddings: 32768,
        sliding_window: 131072
    }
};

// ---------------------------------------------------------------------------
// localStorage model store
// ---------------------------------------------------------------------------
const LS_MODELS_KEY = "gpu_calc_models";
const LS_HF_TOKEN_KEY = "gpu_calc_hf_token";

// Seed localStorage with built-in models if empty or missing
function initModelStore() {
    const existing = localStorage.getItem(LS_MODELS_KEY);
    if (!existing) {
        localStorage.setItem(LS_MODELS_KEY, JSON.stringify(BUILTIN_MODELS));
    }
}

// Get all models from localStorage
function getAllModels() {
    initModelStore();
    return JSON.parse(localStorage.getItem(LS_MODELS_KEY));
}

// Get list of available model names (sorted)
function getAvailableModels() {
    return Object.keys(getAllModels()).sort();
}

// Get a model config by name (returns normalized copy, or null)
function getModelConfig(name) {
    const models = getAllModels();
    const cfg = models[name];
    if (!cfg) return null;
    return { ...cfg };
}

// Save a model config to localStorage
function saveModelConfig(name, config) {
    const models = getAllModels();
    models[name] = config;
    localStorage.setItem(LS_MODELS_KEY, JSON.stringify(models));
}

// Remove a model from localStorage
function removeModelConfig(name) {
    const models = getAllModels();
    delete models[name];
    localStorage.setItem(LS_MODELS_KEY, JSON.stringify(models));
}

// Check if a model is a built-in (not user-added)
function isBuiltinModel(name) {
    return name in BUILTIN_MODELS;
}

// Reset to built-in models only (clear all user-added)
function resetModelsToDefaults() {
    localStorage.setItem(LS_MODELS_KEY, JSON.stringify(BUILTIN_MODELS));
}

// ---------------------------------------------------------------------------
// Workspace — working model instances with unique IDs and editable titles
// ---------------------------------------------------------------------------
// Each workspace entry:
// { id, title, baseModel (HF name), config (architecture), deployment }
const LS_WORKSPACE_KEY = "gpu_calc_workspace";

function _getWorkspaceStore() {
    const raw = localStorage.getItem(LS_WORKSPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migrate from old format (array of model name strings) to new format (object of entries)
    if (Array.isArray(parsed)) {
        const migrated = {};
        for (const name of parsed) {
            const config = getModelConfig(name);
            if (config) {
                const id = 'wm_' + crypto.randomUUID().slice(0, 8);
                migrated[id] = {
                    id,
                    title: name,
                    baseModel: name,
                    config: { ...config },
                    deployment: defaultDeployment(config)
                };
            }
        }
        _saveWorkspaceStore(migrated);
        return migrated;
    }
    return parsed;
}

function _saveWorkspaceStore(store) {
    localStorage.setItem(LS_WORKSPACE_KEY, JSON.stringify(store));
}

// Returns array of workspace entry objects, sorted by title
function getWorkspaceModels() {
    return Object.values(_getWorkspaceStore()).sort((a, b) => a.title.localeCompare(b.title));
}

// Get a single workspace entry by ID
function getWorkspaceEntry(id) {
    const store = _getWorkspaceStore();
    return store[id] ? { ...store[id] } : null;
}

// Add a new model to the workspace. Returns the new entry's ID.
function addToWorkspace(baseModel, config, title) {
    const store = _getWorkspaceStore();
    const id = 'wm_' + crypto.randomUUID().slice(0, 8);
    store[id] = {
        id,
        title: title || baseModel,
        baseModel,
        config: { ...config },
        deployment: defaultDeployment(config)
    };
    _saveWorkspaceStore(store);
    return id;
}

// Update a workspace entry (title, deployment, etc.)
function saveWorkspaceEntry(entry) {
    const store = _getWorkspaceStore();
    if (!store[entry.id]) return;
    store[entry.id] = { ...entry };
    _saveWorkspaceStore(store);
}

// Remove a workspace entry by ID
function removeFromWorkspace(id) {
    const store = _getWorkspaceStore();
    delete store[id];
    _saveWorkspaceStore(store);
}

// Check if a title is already used by another workspace entry (excluding the given ID)
function isWorkspaceTitleTaken(title, excludeId) {
    const entries = getWorkspaceModels();
    return entries.some(e => e.title === title && e.id !== excludeId);
}

// ---------------------------------------------------------------------------
// Per-model deployment settings
// ---------------------------------------------------------------------------
function defaultDeployment(config) {
    return {
        gpuId: getDefaultGpuId(),
        seqLen: config && config.max_position_embeddings ? config.max_position_embeddings : 131072,
        maxSeqs: 1,
        batchTokens: 8192,
        tp: 2,
        gpuUtil: 0.85,
        cufileBuf: 2.0,
        bytesPerWeight: config ? (config.bytes_per_weight || 2) : 2,
        bytesPerKV: config ? (config.bytes_per_kv_element || 2) : 2,
        bytesPerActivation: config ? (config.bytes_per_activation || 2) : 2,
        precisionMode: 'auto',
        showCUDAGraphs: true,
        showFrameworkOH: true,
        contextOverride: null
    };
}

// Convenience: get deployment from a workspace entry
function getEntryDeployment(entry) {
    if (entry && entry.deployment) return { ...entry.deployment };
    return defaultDeployment(entry ? entry.config : null);
}

// ---------------------------------------------------------------------------
// Migration — ensure data stores exist and are compatible
// ---------------------------------------------------------------------------
function migrateLocalStorage() {
    // Seed GPU store if missing
    initGpuStore();
    // Seed model store if missing
    initModelStore();
    // Trigger workspace migration (old array format → new object format)
    _getWorkspaceStore();
}

// ---------------------------------------------------------------------------
// HF token management
// ---------------------------------------------------------------------------
function getHFToken() {
    return localStorage.getItem(LS_HF_TOKEN_KEY) || "";
}

function saveHFToken(token) {
    if (token) {
        localStorage.setItem(LS_HF_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(LS_HF_TOKEN_KEY);
    }
}

// ---------------------------------------------------------------------------
// Fetch model config from HuggingFace
// ---------------------------------------------------------------------------
async function fetchModelFromHF(modelName, hfToken) {
    const url = `https://huggingface.co/${modelName}/raw/main/config.json`;
    const headers = {};
    if (hfToken) {
        headers["Authorization"] = `Bearer ${hfToken}`;
    }

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Model "${modelName}" not found on HuggingFace.`);
        } else if (response.status === 401 || response.status === 403) {
            throw new Error(`Access denied for "${modelName}". This model may require an HF token or license acceptance.`);
        }
        throw new Error(`HuggingFace returned ${response.status}: ${response.statusText}`);
    }

    const raw = await response.json();
    const normalized = normalizeModelConfig(raw, modelName);

    // Validate that we got the essential fields
    const required = ["hidden_size", "num_transformer_layers", "num_attention_heads", "head_dimension"];
    for (const field of required) {
        if (!normalized[field]) {
            throw new Error(`Model config missing required field: ${field}`);
        }
    }

    return normalized;
}

// ---------------------------------------------------------------------------
// Normalize a raw HuggingFace config.json into our expected field names
// Ported from model_loader.py normalize_model_config()
// ---------------------------------------------------------------------------
function normalizeModelConfig(config, modelName) {
    const normalized = { ...config };

    // Field name mappings: HF name -> our name
    const mappings = {
        num_hidden_layers: "num_transformer_layers",
        num_key_value_heads: "num_kv_heads",
        head_dim: "head_dimension"
    };

    for (const [hfName, ourName] of Object.entries(mappings)) {
        if (hfName in normalized && !(ourName in normalized)) {
            normalized[ourName] = normalized[hfName];
        }
    }

    // Calculate head_dimension if not present
    if (!("head_dimension" in normalized) && normalized.hidden_size && normalized.num_attention_heads) {
        normalized.head_dimension = Math.floor(normalized.hidden_size / normalized.num_attention_heads);
    }

    // Default num_kv_heads to num_attention_heads (MHA) if not specified
    if (!normalized.num_kv_heads && normalized.num_attention_heads) {
        normalized.num_kv_heads = normalized.num_attention_heads;
    }

    // Default hidden_act
    if (!normalized.hidden_act) {
        normalized.hidden_act = "silu";
    }

    // Default tie_word_embeddings
    if (normalized.tie_word_embeddings === undefined) {
        normalized.tie_word_embeddings = true;
    }

    // Add precision detection
    const precision = detectPrecisionFromConfig(config, modelName || "");
    Object.assign(normalized, precision);

    return normalized;
}

// Detect precision (bytes per element) from model configuration
// Ported from model_loader.py detect_precision_from_config()
function detectPrecisionFromConfig(config, modelName) {
    let bytes_per_weight = 2;
    let bytes_per_kv_element = 2;
    let bytes_per_activation = 2;

    // Check for quantization config (highest priority)
    const quantConfig = config.quantization_config;
    if (quantConfig) {
        const quantMethod = (quantConfig.quant_method || "").toLowerCase();
        if (quantMethod.includes("fp8") || quantConfig.bits === 8) {
            bytes_per_weight = 1;
        } else if (quantMethod.includes("int4") || quantConfig.bits === 4) {
            bytes_per_weight = 0.5;
        } else if (quantMethod.includes("int8")) {
            bytes_per_weight = 1;
        } else if (quantMethod.includes("nf4") || quantMethod.includes("4bit")) {
            bytes_per_weight = 0.5;
        }
    }

    // Check torch_dtype for base precision
    const torchDtype = (config.torch_dtype || "").toLowerCase();
    if (torchDtype) {
        if (torchDtype.includes("float32") || torchDtype.includes("fp32")) {
            if (bytes_per_weight === 2) bytes_per_weight = 4;
            bytes_per_kv_element = 4;
            bytes_per_activation = 4;
        }
    }

    // Heuristic: check model name for precision hints (lowest priority)
    if (!quantConfig) {
        const nameLower = modelName.toLowerCase();
        if (nameLower.includes("fp8") || nameLower.includes("-fp8")) {
            bytes_per_weight = 1;
        } else if (nameLower.includes("int4") || nameLower.includes("gptq") || nameLower.includes("awq")) {
            bytes_per_weight = 0.5;
        } else if (nameLower.includes("int8")) {
            bytes_per_weight = 1;
        }
    }

    return { bytes_per_weight, bytes_per_kv_element, bytes_per_activation };
}
