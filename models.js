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
// Versioned localStorage payloads
//
// Each persisted payload is wrapped as { version: N, data: ... }. Per-payload
// version constants live next to their stores. On read:
//   - missing key            → seed defaults at the current version.
//   - matching version       → return stored data.
//   - mismatched version     → toast + reset to defaults.
//   - unwrapped legacy value → if silentUpgrade, treat as current data and
//                              re-save wrapped; otherwise toast + reset.
// ---------------------------------------------------------------------------
function loadVersionedPayload(key, currentVersion, defaultFactory, label, opts) {
    const silentUpgrade = !!(opts && opts.silentUpgrade);
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') {
        const defaults = defaultFactory();
        saveVersionedPayload(key, currentVersion, defaults);
        return defaults;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        if (typeof showToast === 'function') {
            showToast(`${label} was unreadable and has been reset to defaults.`);
        }
        const defaults = defaultFactory();
        saveVersionedPayload(key, currentVersion, defaults);
        return defaults;
    }

    const isWrapped = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && 'version' in parsed && 'data' in parsed;

    if (isWrapped) {
        if (parsed.version === currentVersion) return parsed.data;
        if (typeof showToast === 'function') {
            showToast(`${label} was created by a different version and has been reset to defaults.`);
        }
        const defaults = defaultFactory();
        saveVersionedPayload(key, currentVersion, defaults);
        return defaults;
    }

    // Unwrapped legacy value.
    if (silentUpgrade) {
        saveVersionedPayload(key, currentVersion, parsed);
        return parsed;
    }
    if (typeof showToast === 'function') {
        showToast(`${label} was created by an older version and has been reset to defaults.`);
    }
    const defaults = defaultFactory();
    saveVersionedPayload(key, currentVersion, defaults);
    return defaults;
}

function saveVersionedPayload(key, currentVersion, data) {
    localStorage.setItem(key, JSON.stringify({ version: currentVersion, data }));
}

// ---------------------------------------------------------------------------
// localStorage model store
// ---------------------------------------------------------------------------
const LS_MODELS_KEY = "gpu_calc_models";
const LS_HF_TOKEN_KEY = "gpu_calc_hf_token";
const MODELS_VERSION = 1;

function initModelStore() {
    // Reading is enough — loadVersionedPayload seeds defaults when missing.
    getAllModels();
}

function getAllModels() {
    return loadVersionedPayload(
        LS_MODELS_KEY, MODELS_VERSION,
        () => ({ ...BUILTIN_MODELS }),
        'Cached model configs',
        { silentUpgrade: true }
    );
}

function _saveAllModels(models) {
    saveVersionedPayload(LS_MODELS_KEY, MODELS_VERSION, models);
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
    _saveAllModels(models);
}

// Remove a model from localStorage
function removeModelConfig(name) {
    const models = getAllModels();
    delete models[name];
    _saveAllModels(models);
}

// Check if a model is a built-in (not user-added)
function isBuiltinModel(name) {
    return name in BUILTIN_MODELS;
}

// Reset to built-in models only (clear all user-added)
function resetModelsToDefaults() {
    _saveAllModels({ ...BUILTIN_MODELS });
}

// ---------------------------------------------------------------------------
// Workspace — working model instances with unique IDs and editable titles
// ---------------------------------------------------------------------------
// Each workspace entry:
// { id, title, baseModel (HF name), config (architecture), deployment }
const LS_WORKSPACE_KEY = "gpu_calc_workspace";
// v2: deployment.gpuId → deployment.systemId. Existing workspaces are
// warn-and-reset because the old gpuIds reference systems that no longer exist.
const WORKSPACE_VERSION = 2;

function _getWorkspaceStore() {
    // v2 introduces systemId-keyed deployments. Anything older — including the
    // pre-version array form and the v1 gpuId-based shape — gets warn-and-reset.
    const data = loadVersionedPayload(
        LS_WORKSPACE_KEY, WORKSPACE_VERSION,
        () => ({}),
        'Workspace',
        { silentUpgrade: false }
    );
    return data;
}

function _saveWorkspaceStore(store) {
    saveVersionedPayload(LS_WORKSPACE_KEY, WORKSPACE_VERSION, store);
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
    // Only auto-assign a system when exactly one is available. Otherwise leave
    // it null so the Model Details page prompts the user to pick one.
    const systems = (typeof getSystemList === 'function') ? getSystemList() : [];
    const systemId = systems.length === 1 ? systems[0].id : null;
    return {
        systemId,
        seqLen: config && config.max_position_embeddings ? config.max_position_embeddings : 131072,
        maxSeqs: 1,
        batchTokens: 8192,
        tp: 2,
        pp: 1,
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

// Convenience: get deployment from a workspace entry. Backfills additive
// fields (e.g. `pp`) for legacy entries that predate them so callers don't
// need defensive `?? 1` checks at every read site.
function getEntryDeployment(entry) {
    if (entry && entry.deployment) {
        const d = { ...entry.deployment };
        if (d.pp === undefined) d.pp = 1;
        return d;
    }
    return defaultDeployment(entry ? entry.config : null);
}

// ---------------------------------------------------------------------------
// Migration — ensure data stores exist and are compatible
// ---------------------------------------------------------------------------
function migrateLocalStorage() {
    // Drop any legacy `gpu_calc_gpus` key from the previous GPUs concept.
    cleanupLegacyGpusKey();
    // Seed Systems store if missing
    initSystemStore();
    // Seed model store if missing
    initModelStore();
    // Trigger workspace load (warns-and-resets on schema version mismatch)
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
//
// Tries the HF transformers `config.json` first. When that 404s, falls back
// to Mistral's native `params.json` (different field names — see
// translateMistralParamsJson). Fallback is announced via a toast and
// recorded on the returned config as `_compatibilityMode` so callers can
// surface a badge.
// ---------------------------------------------------------------------------
async function fetchModelFromHF(modelName, hfToken) {
    const headers = {};
    if (hfToken) {
        headers["Authorization"] = `Bearer ${hfToken}`;
    }

    const accessDenied = (status) => status === 401 || status === 403;
    const fetchJson = async (path) => {
        const url = `https://huggingface.co/${modelName}/raw/main/${path}`;
        return fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    };

    let raw;
    let compatibilityMode = null;

    const configResp = await fetchJson('config.json');
    if (configResp.ok) {
        raw = await configResp.json();
    } else if (configResp.status === 404) {
        // No HF transformers config — try Mistral-native params.json.
        const paramsResp = await fetchJson('params.json');
        if (paramsResp.ok) {
            const params = await paramsResp.json();
            raw = translateMistralParamsJson(params);
            compatibilityMode = 'mistral-params';
            if (typeof showToast === 'function') {
                showToast(
                    `Loaded "${modelName}" via Mistral params.json compatibility mode — no HF config.json was published. Estimates may differ from a future HF-format release.`,
                    'warn',
                    12000
                );
            }
        } else if (paramsResp.status === 404) {
            throw new Error(`Model "${modelName}" not found on HuggingFace.`);
        } else if (accessDenied(paramsResp.status)) {
            throw new Error(`Access denied for "${modelName}". This model may require an HF token or license acceptance.`);
        } else {
            throw new Error(`HuggingFace returned ${paramsResp.status}: ${paramsResp.statusText}`);
        }
    } else if (accessDenied(configResp.status)) {
        throw new Error(`Access denied for "${modelName}". This model may require an HF token or license acceptance.`);
    } else {
        throw new Error(`HuggingFace returned ${configResp.status}: ${configResp.statusText}`);
    }

    const normalized = normalizeModelConfig(raw, modelName);
    if (compatibilityMode) {
        normalized._compatibilityMode = compatibilityMode;
    }
    if (normalized._multimodal && typeof showToast === 'function') {
        showToast(
            `"${modelName}" is a multimodal model — only the language-model portion is modelled. Vision encoder weights, KV, and activations are excluded.`,
            'warn',
            12000
        );
    }

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
// Translate Mistral's native params.json shape into the HF transformers
// field names that normalizeModelConfig expects. Mistral large checkpoints
// (e.g. Mistral-Large-3-675B-Instruct-2512) ship only this format.
//
// Mistral's tie_embeddings is `false` for every Mistral large/MoE config we've
// seen, so when the field is absent we set tie_word_embeddings explicitly to
// `false` to override normalizeModelConfig's default-of-true.
// ---------------------------------------------------------------------------
function translateMistralParamsJson(params) {
    const out = { ...params };

    if ('dim' in params) out.hidden_size = params.dim;
    if ('n_layers' in params) out.num_hidden_layers = params.n_layers;
    if ('n_heads' in params) out.num_attention_heads = params.n_heads;
    if ('n_kv_heads' in params) out.num_key_value_heads = params.n_kv_heads;
    if ('head_dim' in params) out.head_dim = params.head_dim;
    if ('hidden_dim' in params) out.intermediate_size = params.hidden_dim;
    if ('norm_eps' in params) out.rms_norm_eps = params.norm_eps;

    out.tie_word_embeddings =
        'tie_embeddings' in params ? !!params.tie_embeddings :
        'tie_word_embeddings' in params ? !!params.tie_word_embeddings :
        false;

    // Nested MoE block follows Mixtral conventions: `intermediate_size` here is
    // the per-expert FFN width, which is what normalizeMoEFields expects when
    // moe_intermediate_size is absent.
    if (params.moe && typeof params.moe === 'object') {
        const moe = params.moe;
        if ('num_experts' in moe) out.num_local_experts = moe.num_experts;
        if ('num_experts_per_tok' in moe) out.num_experts_per_tok = moe.num_experts_per_tok;
        if ('intermediate_size' in moe) out.intermediate_size = moe.intermediate_size;
    }

    return out;
}

// ---------------------------------------------------------------------------
// Normalize a raw HuggingFace config.json into our expected field names
// Ported from model_loader.py normalize_model_config()
// ---------------------------------------------------------------------------
function normalizeModelConfig(config, modelName) {
    // Multimodal HF configs (Pixtral, Llama-3.2-Vision, Mistral3, LLaVA-style,
    // Gemma3-vision, etc.) nest the language-model architecture under
    // `text_config` and put a vision tower under `vision_config`. The calculator
    // models the LLM only, so we hoist text_config fields onto the top level —
    // text_config wins on collisions because it carries the authoritative LM
    // architecture (e.g. tie_word_embeddings can appear at both levels).
    let source = config;
    let isMultimodal = false;
    if (config && typeof config.text_config === 'object' && config.text_config !== null) {
        source = { ...config, ...config.text_config };
        isMultimodal = true;
    }
    const normalized = { ...source };
    if (isMultimodal) normalized._multimodal = true;

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

    // Pull MoE fields if present. Different model families use different names:
    //   Mixtral / MiniMax: num_local_experts + intermediate_size (per-expert width)
    //   DeepSeek-V2/V3:    n_routed_experts + moe_intermediate_size + n_shared_experts
    //                      + first_k_dense_replace + num_nextn_predict_layers
    //   Qwen-MoE:          num_experts + moe_intermediate_size + shared_expert_intermediate_size
    Object.assign(normalized, normalizeMoEFields(config));

    // Add precision detection
    const precision = detectPrecisionFromConfig(config, modelName || "");
    Object.assign(normalized, precision);

    return normalized;
}

// Detect MoE structure from a raw HF config and return our normalized fields.
// All MoE numerics are 0 for dense models.
function normalizeMoEFields(config) {
    const numRouted =
        config.num_local_experts ||
        config.n_routed_experts ||
        config.num_experts ||
        0;

    if (numRouted <= 1) {
        return {
            is_moe: false,
            num_routed_experts: 0,
            num_experts_per_tok: 0,
            num_shared_experts: 0,
            moe_intermediate_size: 0,
            shared_intermediate_size: 0,
            num_dense_layers: 0,
            num_mtp_modules: 0
        };
    }

    // Per-expert FFN width.
    // - When `moe_intermediate_size` is present (DeepSeek/Qwen-MoE), it's the
    //   per-expert width and `intermediate_size` is reserved for the dense
    //   prefix layers (`first_k_dense_replace`).
    // - When only `intermediate_size` is present (Mixtral/MiniMax), that field
    //   IS the per-expert width.
    const moeIntermediate = config.moe_intermediate_size || config.intermediate_size || 0;

    // Shared experts. n_shared_experts is the count; total shared FFN width is
    // either an explicit `shared_expert_intermediate_size` (Qwen-MoE) or
    // n_shared_experts × moe_intermediate_size (DeepSeek convention).
    const numShared =
        config.n_shared_experts ||
        (config.shared_expert_intermediate_size ? 1 : 0) ||
        0;
    let sharedIntermediate = 0;
    if (config.shared_expert_intermediate_size) {
        sharedIntermediate = config.shared_expert_intermediate_size;
    } else if (numShared > 0) {
        sharedIntermediate = numShared * moeIntermediate;
    }

    // Dense prefix layers (DeepSeek leaves the first N layers as dense FFNs).
    const numDenseLayers = config.first_k_dense_replace || 0;

    // MTP (multi-token prediction) modules — extra near-full layers stacked
    // after the main decoder.
    const numMtpModules =
        config.num_nextn_predict_layers ||
        config.num_mtp_modules ||
        0;

    return {
        is_moe: true,
        num_routed_experts: numRouted,
        num_experts_per_tok: config.num_experts_per_tok || 0,
        num_shared_experts: numShared,
        moe_intermediate_size: moeIntermediate,
        shared_intermediate_size: sharedIntermediate,
        num_dense_layers: numDenseLayers,
        num_mtp_modules: numMtpModules
    };
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
