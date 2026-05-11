// GPU Memory Calculator — ported from Python modules
// All calculations are pure arithmetic, no external dependencies.

// ---------------------------------------------------------------------------
// Backfill MoE structural fields on a config that predates MoE support.
// Workspace entries cached before normalizeModelConfig grew MoE awareness
// still carry the raw HF fields (num_local_experts, n_routed_experts, etc.)
// but lack the normalized is_moe flag. Re-derive on demand so the
// architecture-aware calc path is reachable without forcing a re-fetch.
// Idempotent: when is_moe is already set, returns the input unchanged.
// ---------------------------------------------------------------------------
function ensureMoEFields(config) {
    if (!config || config.is_moe !== undefined) return config;
    if (typeof normalizeMoEFields !== 'function') return config;
    return { ...config, ...normalizeMoEFields(config) };
}

// ---------------------------------------------------------------------------
// Model parameters — from model_specs.py calculate_model_parameters()
// MoE-aware: counts ALL experts as resident weights even though only
// num_experts_per_tok fire per token. Active params are reported separately.
// ---------------------------------------------------------------------------
function calculateModelParameters(config) {
    config = ensureMoEFields(config);
    const hs = config.hidden_size;
    const L = config.num_transformer_layers;
    const H = config.num_attention_heads;
    const G = config.num_kv_heads;
    const D = config.head_dimension;
    const V = config.vocab_size;
    const tieEmb = config.tie_word_embeddings !== false;
    const hiddenAct = (config.hidden_act || "silu").toLowerCase();
    const isGLU = hiddenAct.includes("glu") || hiddenAct === "silu" || hiddenAct === "swish";
    const ffnFactor = isGLU ? 3 : 2;

    // Attention: Q, K, V, O projections (per layer)
    const q_proj = hs * (H * D);
    const k_proj = hs * (G * D);
    const v_proj = hs * (G * D);
    const o_proj = (H * D) * hs;
    const attention_params = q_proj + k_proj + v_proj + o_proj;

    // Norms (RMSNorm/LayerNorm per layer: attention + MLP)
    const norm_params = 2 * hs;

    const embedding_params = V * hs;
    const lm_head_params = tieEmb ? 0 : embedding_params;

    const isMoE = !!config.is_moe && (config.num_routed_experts || 0) > 1;

    if (!isMoE) {
        // Dense path — single FFN block per layer.
        const I = config.intermediate_size;
        const mlp_params = ffnFactor * hs * I;
        const per_layer_params = attention_params + mlp_params + norm_params;
        const total_params = per_layer_params * L + embedding_params + lm_head_params;
        return {
            is_moe: false,
            attention_params,
            mlp_params,
            norm_params,
            per_layer_params,
            embedding_params,
            lm_head_params,
            total_params,
            active_params: total_params
        };
    }

    // MoE path.
    const numRouted = config.num_routed_experts;
    const expertsPerTok = config.num_experts_per_tok || 0;
    const numShared = config.num_shared_experts || 0;
    const moeI = config.moe_intermediate_size || config.intermediate_size;
    const sharedI = config.shared_intermediate_size || 0;
    const numDense = Math.min(config.num_dense_layers || 0, L);
    const numMoELayers = L - numDense;
    const numMtp = config.num_mtp_modules || 0;
    // Dense-prefix FFN width (DeepSeek convention). MoE configs that don't
    // have any dense prefix layers may legitimately omit intermediate_size,
    // so default to 0 to avoid NaN poisoning the totals via 0 * undefined
    // when numDense === 0.
    const denseI = config.intermediate_size || 0;

    // Per-expert FFN block.
    const per_expert_ffn = ffnFactor * hs * moeI;

    // Per-layer FFN totals.
    const dense_layer_mlp = numDense > 0 ? ffnFactor * hs * denseI : 0;
    const moe_layer_routed = numRouted * per_expert_ffn;
    const moe_layer_router = hs * numRouted;
    const moe_layer_shared = sharedI > 0 ? ffnFactor * hs * sharedI : 0;
    const moe_layer_mlp = moe_layer_routed + moe_layer_router + moe_layer_shared;

    const per_dense_layer_params = attention_params + dense_layer_mlp + norm_params;
    const per_moe_layer_params = attention_params + moe_layer_mlp + norm_params;

    const decoder_params =
        numDense * per_dense_layer_params +
        numMoELayers * per_moe_layer_params;

    // MTP modules: each is approximately one MoE-style transformer layer plus
    // an `eh_proj` of size 2*hs*hs that fuses the previous hidden state with
    // the next-token embedding, plus an extra norm. The lm_head is shared
    // with the main model so it adds nothing.
    const eh_proj = 2 * hs * hs;
    const per_mtp_params = per_moe_layer_params + eh_proj + hs;
    const mtp_params = numMtp * per_mtp_params;

    const total_params = decoder_params + embedding_params + lm_head_params + mtp_params;

    // Active params per token: attention + norms + (top-k routed + shared
    // experts + router) per MoE layer, dense FFN for dense layers. MTP
    // modules don't fire on the standard decode path, so they don't count
    // toward active.
    const active_moe_layer_mlp =
        expertsPerTok * per_expert_ffn + moe_layer_router + moe_layer_shared;
    const active_per_moe_layer = attention_params + active_moe_layer_mlp + norm_params;
    const active_decoder =
        numDense * per_dense_layer_params + numMoELayers * active_per_moe_layer;
    const active_params = active_decoder + embedding_params + lm_head_params;

    return {
        is_moe: true,
        attention_params,
        norm_params,
        embedding_params,
        lm_head_params,
        // MoE structure
        num_routed_experts: numRouted,
        num_experts_per_tok: expertsPerTok,
        num_shared_experts: numShared,
        num_dense_layers: numDense,
        num_moe_layers: numMoELayers,
        num_mtp_modules: numMtp,
        moe_intermediate_size: moeI,
        shared_intermediate_size: sharedI,
        dense_intermediate_size: denseI,
        // Per-layer breakdowns
        mlp_dense_layer_params: dense_layer_mlp,
        mlp_moe_routed_params: moe_layer_routed,
        mlp_moe_router_params: moe_layer_router,
        mlp_moe_shared_params: moe_layer_shared,
        per_dense_layer_params,
        per_moe_layer_params,
        decoder_params,
        mtp_params,
        // Totals
        total_params,
        active_params,
        // Legacy aliases (so callers that reference these keep working).
        mlp_params: moe_layer_mlp,
        per_layer_params: per_moe_layer_params
    };
}

// ---------------------------------------------------------------------------
// KV cache memory — from kv_cache_calc.py calculate_kv_cache_memory()
//
// Pipeline parallelism (pp): each pipeline stage holds KV only for the
// ceil(L / pp) layers it owns, so per-rank KV scales by layers-per-stage
// rather than total layers. Aggregate KV bytes (totalKV) are unchanged —
// the storage tier still sees the full sum across all stages.
//
// KV head sharding under TP:
//   G >= tp  and  G %  tp === 0   → clean shard, kv_heads_per_gpu = G / tp
//   G >= tp  and  G %  tp !== 0   → engines typically refuse; we round up
//                                    (ceil) and flag `kv_uneven_shard` so the
//                                    UI can warn.
//   G <  tp                       → KV head cannot shard below 1; engines
//                                    replicate the head across ALL tp ranks
//                                    (MLA does this by design). Each rank
//                                    then holds the FULL KV slice for its
//                                    stage's layers. Aggregate VRAM consumed
//                                    by KV is tp × the unique KV.
// ---------------------------------------------------------------------------
function calculateKVCacheMemory(config, maxNumSeqs, promptLength, tensorParallel, bytesPerKV, pipelineParallel) {
    const L = config.num_transformer_layers;
    const G = config.num_kv_heads;
    const D = config.head_dimension;
    const pp = pipelineParallel || 1;
    const tp = tensorParallel || 1;

    // Cap effective KV length by sliding_window when present
    const effectiveKVLength = config.sliding_window
        ? Math.min(promptLength, config.sliding_window)
        : promptLength;

    const kvPerSeqPerLayer = 2 * G * D * effectiveKVLength * bytesPerKV;
    const kvPerSeq = kvPerSeqPerLayer * L;
    const totalKV = kvPerSeq * maxNumSeqs;

    let kvHeadsPerGPU;
    let kvReplicated = false;
    let kvUnevenShard = false;
    if (G < tp) {
        kvHeadsPerGPU = G;
        kvReplicated = true;
    } else if (G % tp === 0) {
        kvHeadsPerGPU = G / tp;
    } else {
        kvHeadsPerGPU = Math.ceil(G / tp);
        kvUnevenShard = true;
    }

    const layersPerStage = Math.ceil(L / pp);
    const kvPerGPU = 2 * kvHeadsPerGPU * D * effectiveKVLength * bytesPerKV * layersPerStage * maxNumSeqs;

    // Aggregate VRAM consumed by KV across all ranks. Without replication
    // this equals totalKV (per-stage layer slices summed back to the full
    // model). With replication it's totalKV × tp because every TP rank
    // carries its own copy of the KV slice for its pipeline stage.
    const kvVRAMAcrossRanks = kvReplicated ? totalKV * tp : totalKV;

    return {
        kv_cache_per_seq_per_layer_bytes: kvPerSeqPerLayer,
        kv_cache_per_seq_bytes: kvPerSeq,
        total_kv_cache_bytes: totalKV,
        kv_cache_per_gpu_bytes: kvPerGPU,
        kv_vram_across_ranks_bytes: kvVRAMAcrossRanks,
        total_kv_cache_gb: totalKV / (1024 ** 3),
        kv_cache_per_gpu_gb: kvPerGPU / (1024 ** 3),
        kv_vram_across_ranks_gb: kvVRAMAcrossRanks / (1024 ** 3),
        kv_heads_per_gpu: kvHeadsPerGPU,
        kv_replicated: kvReplicated,
        kv_uneven_shard: kvUnevenShard,
        layers_per_stage: layersPerStage,
        effective_kv_length: effectiveKVLength
    };
}

// ---------------------------------------------------------------------------
// Activation memory — from activation_calc.py calculate_activation_memory()
// ---------------------------------------------------------------------------
function calculateActivationMemory(config, maxBatchedTokens, tensorParallel, bytesPerElement) {
    config = ensureMoEFields(config);
    const H = config.num_attention_heads;
    const G = config.num_kv_heads;
    const D = config.head_dimension;
    const hiddenAct = (config.hidden_act || "silu").toLowerCase();
    const isGLU = hiddenAct.includes("glu") || hiddenAct === "silu" || hiddenAct === "swish";
    const ffnAct = isGLU ? 2 : 1; // gate + up for GLU, just up for non-GLU

    // FFN intermediate width that actually materializes per token. For MoE,
    // only top-k routed experts fire (plus any shared experts).
    const isMoE = !!config.is_moe && (config.num_routed_experts || 0) > 1;
    let I;
    if (isMoE) {
        const expertsPerTok = config.num_experts_per_tok || 1;
        const moeI = config.moe_intermediate_size || config.intermediate_size || 0;
        const sharedI = config.shared_intermediate_size || 0;
        I = expertsPerTok * moeI + sharedI;
    } else {
        I = config.intermediate_size;
    }

    // Per-token activations (total)
    const q_act = H * D;
    const k_act = G * D;
    const v_act = G * D;
    const attn_scores = H * maxBatchedTokens;
    const mlp_act = ffnAct * I;
    const act_per_token = q_act + k_act + v_act + attn_scores + mlp_act;

    // Per GPU
    const headsPerGPU = Math.floor(H / tensorParallel);
    const kvHeadsPerGPU = Math.floor(G / tensorParallel);
    const mlpPerGPU = Math.floor(I / tensorParallel);

    const q_gpu = headsPerGPU * D;
    const k_gpu = kvHeadsPerGPU * D;
    const v_gpu = kvHeadsPerGPU * D;
    const attn_gpu = headsPerGPU * maxBatchedTokens;
    const mlp_gpu = ffnAct * mlpPerGPU;
    const act_per_token_gpu = q_gpu + k_gpu + v_gpu + attn_gpu + mlp_gpu;

    const totalBytes = act_per_token * maxBatchedTokens * bytesPerElement;
    const perGPUBytes = act_per_token_gpu * maxBatchedTokens * bytesPerElement;

    return {
        total_activation_bytes: totalBytes,
        activation_per_gpu_bytes: perGPUBytes,
        total_activation_gb: totalBytes / (1024 ** 3),
        activation_per_gpu_gb: perGPUBytes / (1024 ** 3)
    };
}

// ---------------------------------------------------------------------------
// CUDA graphs memory — from framework_overhead.py calculate_cuda_graphs_memory()
// ---------------------------------------------------------------------------
function calculateCUDAGraphsMemory(config, tensorParallel) {
    const layers = config.num_transformer_layers;
    const baseMB = layers * 2 + 50;
    const numVariants = 8;
    const variantsMB = baseMB * 0.3 * numVariants;
    const totalMB = baseMB + variantsMB;
    const perGPU_MB = totalMB / tensorParallel;

    return {
        base_graph_mb: baseMB,
        graph_variants_mb: variantsMB,
        total_cuda_graphs_mb: totalMB,
        cuda_graphs_per_gpu_mb: perGPU_MB,
        total_cuda_graphs_gb: totalMB / 1024,
        cuda_graphs_per_gpu_gb: perGPU_MB / 1024
    };
}

// ---------------------------------------------------------------------------
// Framework overhead — from framework_overhead.py calculate_framework_overhead()
// ---------------------------------------------------------------------------
function calculateFrameworkOverhead(gpuMemoryGB, maxNumSeqs, promptLength, tensorParallel) {
    const pytorchOH = Math.min(2.0, gpuMemoryGB * 0.05);
    const vllmOH = 0.5 + maxNumSeqs * 0.1 + Math.floor(promptLength / 10000) * 0.2;
    const cudaRuntime = 0.5;
    const fragmentation = gpuMemoryGB * 0.02;
    const total = pytorchOH + vllmOH + cudaRuntime + fragmentation;
    const perGPU = tensorParallel > 1 ? total / tensorParallel : total;

    return {
        pytorch_overhead_gb: pytorchOH,
        vllm_overhead_gb: vllmOH,
        cuda_runtime_gb: cudaRuntime,
        fragmentation_overhead_gb: fragmentation,
        total_framework_overhead_gb: total,
        framework_overhead_per_gpu_gb: perGPU
    };
}

// ---------------------------------------------------------------------------
// Complete memory analysis — from complete_analysis.py
// ---------------------------------------------------------------------------
function calculateCompleteAnalysis(params) {
    const {
        modelName,
        maxNumSeqs,
        promptLength,
        maxBatchedTokens,
        gpuMemoryGB,
        gpuMemoryUtil,
        tensorParallel,
        cufileBufferGB,
        bytesPerWeight,
        bytesPerKV,
        bytesPerActivation,
        showCUDAGraphs,
        showFrameworkOH
    } = params;
    // Re-derive MoE fields once so downstream calcs and the report formatter
    // all see the same architecture-aware config (handles legacy cached
    // configs that predate MoE support).
    const config = ensureMoEFields(params.config);
    const pipelineParallel = params.pipelineParallel || 1;

    // Model parameters & weights. With pipeline parallelism, each rank holds
    // weights for only 1/pp of the layers (in addition to TP's width split).
    const paramBreakdown = calculateModelParameters(config);
    const totalWeightsGB = (paramBreakdown.total_params * bytesPerWeight) / (1024 ** 3);
    const weightsPerRankGB = totalWeightsGB / (tensorParallel * pipelineParallel);

    // KV cache — also distributes across pipeline stages.
    const kv = calculateKVCacheMemory(config, maxNumSeqs, promptLength, tensorParallel, bytesPerKV, pipelineParallel);

    // Activations
    const act = calculateActivationMemory(config, maxBatchedTokens, tensorParallel, bytesPerActivation);

    // CUDA graphs
    const cuda = calculateCUDAGraphsMemory(config, tensorParallel);

    // Framework overhead
    const fw = calculateFrameworkOverhead(gpuMemoryGB, maxNumSeqs, promptLength, tensorParallel);

    // Memory breakdown — two zones:
    // 1. vLLM budget (gpu_memory_utilization): weights, KV cache, activations
    // 2. Outside budget: CUDA graphs, framework OH, cuFile buffer, driver context
    // CUDA graphs are outside by default (captured after KV cache allocation)
    // Framework OH split: PyTorch/vLLM internals profiled inside, but CUDA driver outside
    const vllmAllocated = gpuMemoryGB * gpuMemoryUtil;
    const systemReserved = gpuMemoryGB - vllmAllocated;

    const cudaPerRank = showCUDAGraphs ? cuda.cuda_graphs_per_gpu_gb : 0;
    const fwPerRank = showFrameworkOH ? fw.framework_overhead_per_gpu_gb : 0;

    // Inside vLLM budget: profiled components only
    const vllmUsed = weightsPerRankGB + kv.kv_cache_per_gpu_gb + act.activation_per_gpu_gb;
    const vllmAvailable = vllmAllocated - vllmUsed;

    // Outside vLLM budget: CUDA graphs, framework OH, cuFile, driver
    const driverContext = 2.0;
    const outsideUsed = cudaPerRank + fwPerRank + cufileBufferGB + driverContext;
    const outsideAvailable = systemReserved - outsideUsed;

    const totalUsed = vllmUsed + outsideUsed;
    const totalAvailable = vllmAvailable + outsideAvailable;

    return {
        modelName,
        config,
        paramBreakdown,
        totalWeightsGB,
        weightsPerRankGB,
        kv,
        act,
        cuda,
        fw,
        vllmAllocated,
        systemReserved,
        cudaPerRank,
        fwPerRank,
        vllmUsed,
        vllmAvailable,
        driverContext,
        outsideUsed,
        outsideAvailable,
        totalUsed,
        totalAvailable,
        // Input params echoed back
        maxNumSeqs,
        promptLength,
        maxBatchedTokens,
        gpuMemoryGB,
        gpuMemoryUtil,
        tensorParallel,
        pipelineParallel,
        cufileBufferGB,
        bytesPerWeight,
        bytesPerKV,
        bytesPerActivation,
        showCUDAGraphs,
        showFrameworkOH
    };
}

// ---------------------------------------------------------------------------
// Plan page calculations — KV cache size and IO throughput for capacity planning
// ---------------------------------------------------------------------------

// KV cache bytes for a single sequence at a given context length (aggregate, not per-rank)
function kvCacheBytesForContext(config, contextSize, bytesPerKV) {
    const result = calculateKVCacheMemory(config, 1, contextSize, 1, bytesPerKV);
    return result.total_kv_cache_bytes;
}

// Calculate plan results for one model (includes per-bucket breakdown).
//
// Inputs:
//   planEntry: { distribution: [{contextSize, percentage, cacheHitRate}, ...] }
//   workspaceEntry: workspace model (for config + bytesPerKV)
//   options: { rps, horizonSeconds, system, systemInstances }
//     - rps: aggregate requests/sec at the chosen scenario (Average or Peak)
//     - horizonSeconds: planning horizon in seconds; capacity = writes/s × this
//     - system: assigned system { readBandwidthGiBps, writeBandwidthGiBps, ... }
//       (may be null/undefined when the workspace has no system assigned)
//     - systemInstances: count of physical systems running this model
//
// Throughput is NOT multiplied by systemInstances when computing demand —
// `rps` is the aggregate system rate. The system bandwidth IS multiplied by
// systemInstances since each system contributes its own bandwidth lane.
// Capacity is unbounded (no per-bucket cap).
function calculatePlanEntry(planEntry, workspaceEntry, options) {
    const config = workspaceEntry.config;
    const bytesPerKV = (workspaceEntry.deployment && workspaceEntry.deployment.bytesPerKV) || 2;
    const rps = options ? (options.rps || 0) : 0;
    const horizonSeconds = options ? (options.horizonSeconds || 0) : 0;
    const system = options ? options.system : null;
    const systemInstances = options ? (options.systemInstances || 0) : 0;

    let totalKVSizeBytes = 0;
    let totalWriteDemandBytesPerSec = 0;
    let totalReadDemandBytesPerSec = 0;
    const bucketDetails = [];

    for (const bucket of planEntry.distribution) {
        const pFrac = bucket.percentage / 100;
        const hitFrac = bucket.cacheHitRate / 100;
        const kvBytes = kvCacheBytesForContext(config, bucket.contextSize, bytesPerKV);

        const bucketRequestsPerSec = rps * pFrac;
        const bucketWritesPerSec = bucketRequestsPerSec * (1 - hitFrac);
        const bucketReadsPerSec = bucketRequestsPerSec * hitFrac;

        const bucketWriteBytes = bucketWritesPerSec * kvBytes;
        const bucketReadBytes = bucketReadsPerSec * kvBytes;
        totalWriteDemandBytesPerSec += bucketWriteBytes;
        totalReadDemandBytesPerSec += bucketReadBytes;

        // Capacity = sustained write bytes/sec × horizon. Cache hits don't
        // add new storage (re-reads of existing entries).
        const bucketSizeBytes = bucketWriteBytes * horizonSeconds;
        totalKVSizeBytes += bucketSizeBytes;

        bucketDetails.push({
            contextSize: bucket.contextSize,
            percentage: bucket.percentage,
            cacheHitRate: bucket.cacheHitRate,
            kvBytesPerSeq: kvBytes,
            requestsPerSec: bucketRequestsPerSec,
            writesPerSec: bucketWritesPerSec,
            readsPerSec: bucketReadsPerSec,
            writeBytesPerSec: bucketWriteBytes,
            readBytesPerSec: bucketReadBytes,
            sizeBytes: bucketSizeBytes
        });
    }

    // System bandwidth caps — single numbers (not ranged on rps scenario).
    // When no system or zero instances, caps are 0 → achievable also 0.
    const writeBwGiBps = system ? (system.writeBandwidthGiBps || 0) : 0;
    const readBwGiBps  = system ? (system.readBandwidthGiBps  || 0) : 0;
    const writeBandwidthBytesPerSec = systemInstances * writeBwGiBps * (1024 ** 3);
    const readBandwidthBytesPerSec  = systemInstances * readBwGiBps  * (1024 ** 3);

    const writeAchievableBytesPerSec = Math.min(totalWriteDemandBytesPerSec, writeBandwidthBytesPerSec);
    const readAchievableBytesPerSec  = Math.min(totalReadDemandBytesPerSec,  readBandwidthBytesPerSec);

    const GIB = 1024 ** 3;
    return {
        // Capacity (unbounded — no system cap).
        totalKVSizeBytes,
        totalKVSizeGiB: totalKVSizeBytes / GIB,
        // Throughput demand — what the workload would push if uncapped.
        totalWriteBytesPerSec: totalWriteDemandBytesPerSec,
        totalReadBytesPerSec: totalReadDemandBytesPerSec,
        totalWriteGiBps: totalWriteDemandBytesPerSec / GIB,
        totalReadGiBps:  totalReadDemandBytesPerSec  / GIB,
        // System bandwidth — what the system can sustain.
        writeBandwidthBytesPerSec,
        readBandwidthBytesPerSec,
        writeBandwidthGiBps: writeBandwidthBytesPerSec / GIB,
        readBandwidthGiBps:  readBandwidthBytesPerSec  / GIB,
        // Achievable — min(demand, bandwidth).
        writeAchievableBytesPerSec,
        readAchievableBytesPerSec,
        writeAchievableGiBps: writeAchievableBytesPerSec / GIB,
        readAchievableGiBps:  readAchievableBytesPerSec  / GIB,
        // Capping flags
        writeCapped: totalWriteDemandBytesPerSec > writeBandwidthBytesPerSec + 1e-6,
        readCapped:  totalReadDemandBytesPerSec  > readBandwidthBytesPerSec  + 1e-6,
        bucketDetails,
        rps,
        horizonSeconds,
        systemInstances,
        systemRef: system || null
    };
}

// Aggregate plan results across all models. Sums demand, system bandwidth,
// and achievable; the capacity gap is `max(0, demand − bandwidth)`.
function calculatePlanRollup(results) {
    let totalSize = 0;
    let totalWriteDemand = 0, totalReadDemand = 0;
    let totalWriteBw = 0,    totalReadBw  = 0;
    let totalWriteAch = 0,   totalReadAch = 0;
    for (const r of results) {
        totalSize        += r.totalKVSizeBytes;
        totalWriteDemand += r.totalWriteBytesPerSec;
        totalReadDemand  += r.totalReadBytesPerSec;
        totalWriteBw     += r.writeBandwidthBytesPerSec || 0;
        totalReadBw      += r.readBandwidthBytesPerSec  || 0;
        totalWriteAch    += r.writeAchievableBytesPerSec || 0;
        totalReadAch     += r.readAchievableBytesPerSec  || 0;
    }
    const GIB = 1024 ** 3;
    const writeGap = Math.max(0, totalWriteDemand - totalWriteBw);
    const readGap  = Math.max(0, totalReadDemand  - totalReadBw);
    return {
        totalKVSizeBytes: totalSize,
        totalKVSizeGiB:   totalSize / GIB,
        // Demand (uncapped)
        totalWriteBytesPerSec: totalWriteDemand,
        totalReadBytesPerSec:  totalReadDemand,
        totalWriteGiBps: totalWriteDemand / GIB,
        totalReadGiBps:  totalReadDemand  / GIB,
        // Bandwidth (sum of per-model caps)
        writeBandwidthBytesPerSec: totalWriteBw,
        readBandwidthBytesPerSec:  totalReadBw,
        writeBandwidthGiBps: totalWriteBw / GIB,
        readBandwidthGiBps:  totalReadBw  / GIB,
        // Achievable
        writeAchievableBytesPerSec: totalWriteAch,
        readAchievableBytesPerSec:  totalReadAch,
        writeAchievableGiBps: totalWriteAch / GIB,
        readAchievableGiBps:  totalReadAch  / GIB,
        // Capacity gap
        writeGapBytesPerSec: writeGap,
        readGapBytesPerSec:  readGap,
        writeGapGiBps: writeGap / GIB,
        readGapGiBps:  readGap  / GIB
    };
}

// Format bytes as human-readable GiB or TiB
function formatSizeHuman(bytes) {
    const gib = bytes / (1024 ** 3);
    if (gib >= 1024) {
        return (gib / 1024).toFixed(2) + ' TiB';
    }
    return gib.toFixed(2) + ' GiB';
}

// Format GiB/s throughput with appropriate units
function formatThroughputHuman(gibps) {
    if (gibps >= 1024) {
        return (gibps / 1024).toFixed(2) + ' TiB/s';
    }
    if (gibps < 0.001) {
        return (gibps * 1024).toFixed(2) + ' MiB/s';
    }
    return gibps.toFixed(2) + ' GiB/s';
}

// ---------------------------------------------------------------------------
// Text report — from complete_analysis.py + gpu_memory_visualizer.py
// ---------------------------------------------------------------------------
function formatReport(r) {
    const lines = [];
    const hr = "=".repeat(72);

    lines.push("GPU MEMORY ANALYSIS REPORT");
    lines.push(hr);

    // Model info
    lines.push("");
    lines.push("MODEL INFORMATION");
    lines.push(`Model: ${r.modelName}`);
    lines.push(`Layers: ${r.config.num_transformer_layers}`);
    lines.push(`Attention heads: ${r.config.num_attention_heads}`);
    lines.push(`KV heads: ${r.config.num_kv_heads}`);
    lines.push(`Hidden size: ${r.config.hidden_size}`);
    lines.push(`Head dimension: ${r.config.head_dimension}`);
    if (r.paramBreakdown.is_moe) {
        lines.push(`Architecture: Mixture of Experts`);
        lines.push(`Routed experts: ${r.paramBreakdown.num_routed_experts} (top-${r.paramBreakdown.num_experts_per_tok || '?'} per token)`);
        if (r.paramBreakdown.num_shared_experts > 0) {
            lines.push(`Shared experts: ${r.paramBreakdown.num_shared_experts} (width ${r.paramBreakdown.shared_intermediate_size})`);
        }
        lines.push(`Per-expert intermediate size: ${r.paramBreakdown.moe_intermediate_size}`);
        if (r.paramBreakdown.num_dense_layers > 0) {
            lines.push(`Dense prefix layers: ${r.paramBreakdown.num_dense_layers} (intermediate size ${r.paramBreakdown.dense_intermediate_size})`);
        }
        if (r.paramBreakdown.num_mtp_modules > 0) {
            lines.push(`MTP modules: ${r.paramBreakdown.num_mtp_modules}`);
        }
    } else {
        lines.push(`Intermediate size: ${r.config.intermediate_size}`);
    }
    lines.push(`Vocab size: ${r.config.vocab_size}`);
    lines.push(`Max position embeddings: ${(r.config.max_position_embeddings || "N/A").toLocaleString()}`);
    if (r.config.sliding_window) {
        lines.push(`Sliding window: ${r.config.sliding_window.toLocaleString()} (max context limit)`);
    }

    // Precision
    lines.push("");
    lines.push("PRECISION");
    lines.push(`Bytes per weight: ${r.bytesPerWeight}`);
    lines.push(`Bytes per KV element: ${r.bytesPerKV}`);
    lines.push(`Bytes per activation: ${r.bytesPerActivation}`);

    // Deployment
    lines.push("");
    lines.push("DEPLOYMENT CONFIGURATION");
    lines.push(`Max sequences: ${r.maxNumSeqs}`);
    lines.push(`Sequence length: ${r.promptLength.toLocaleString()}`);
    lines.push(`Max batched tokens: ${r.maxBatchedTokens.toLocaleString()}`);
    lines.push(`Tensor parallel: ${r.tensorParallel}`);
    if ((r.pipelineParallel || 1) > 1) {
        lines.push(`Pipeline parallel: ${r.pipelineParallel} (\u2248 ${r.kv.layers_per_stage} layers/stage)`);
        lines.push(`GPUs per model instance: ${r.tensorParallel * r.pipelineParallel} (TP \u00d7 PP)`);
    }
    lines.push(`GPU memory: ${r.gpuMemoryGB.toFixed(1)} GB`);
    lines.push(`GPU memory utilization: ${(r.gpuMemoryUtil * 100).toFixed(0)}%`);
    lines.push(`cuFile buffer: ${r.cufileBufferGB.toFixed(1)} GB`);

    // Model weights
    lines.push("");
    lines.push("MODEL MEMORY");
    lines.push(`Parameters: ${r.paramBreakdown.total_params.toLocaleString()}`);
    if (r.paramBreakdown.is_moe) {
        lines.push(`Active per token: ${r.paramBreakdown.active_params.toLocaleString()} (${(r.paramBreakdown.active_params / r.paramBreakdown.total_params * 100).toFixed(1)}%)`);
        lines.push(`  Routed FFN per layer: ${r.paramBreakdown.num_routed_experts} experts \u00d7 ${(r.paramBreakdown.mlp_moe_routed_params / r.paramBreakdown.num_routed_experts).toLocaleString()} = ${r.paramBreakdown.mlp_moe_routed_params.toLocaleString()}`);
        if (r.paramBreakdown.mlp_moe_shared_params > 0) {
            lines.push(`  Shared FFN per layer: ${r.paramBreakdown.mlp_moe_shared_params.toLocaleString()}`);
        }
        lines.push(`  Router per layer: ${r.paramBreakdown.mlp_moe_router_params.toLocaleString()}`);
        if (r.paramBreakdown.mtp_params > 0) {
            lines.push(`  MTP modules: ${r.paramBreakdown.mtp_params.toLocaleString()}`);
        }
    }
    const pp = r.pipelineParallel || 1;
    const splitLabel = pp > 1 ? `TP=${r.tensorParallel}, PP=${pp}` : `TP=${r.tensorParallel}`;
    const splitDenom = r.tensorParallel * pp;
    lines.push(`Total weights: ${r.totalWeightsGB.toFixed(2)} GB`);
    lines.push(`Per rank @${splitLabel}: ${r.weightsPerRankGB.toFixed(2)} GB`);

    // KV cache
    lines.push("");
    lines.push("KV CACHE CALCULATIONS");
    lines.push(`Config: ${r.config.num_transformer_layers} layers, ${r.config.num_kv_heads} KV heads, ${r.config.head_dimension} head dim`);
    if (r.config.sliding_window && r.kv.effective_kv_length !== r.promptLength) {
        lines.push(`Effective KV length: min(${r.promptLength.toLocaleString()}, ${r.config.sliding_window.toLocaleString()}) = ${r.kv.effective_kv_length.toLocaleString()} (capped by sliding window)`);
    }
    lines.push(`Per sequence: 2 x ${r.config.num_kv_heads} x ${r.config.head_dimension} x ${r.kv.effective_kv_length.toLocaleString()} x ${r.bytesPerKV} bytes \u00d7 ${r.config.num_transformer_layers} layers = ${r.kv.kv_cache_per_seq_bytes.toLocaleString()} bytes`);
    lines.push(`All sequences: ${r.kv.kv_cache_per_seq_bytes.toLocaleString()} x ${r.maxNumSeqs} = ${r.kv.total_kv_cache_bytes.toLocaleString()} bytes`);
    if (r.kv.kv_replicated) {
        lines.push(`Tensor parallel: ${r.config.num_kv_heads} KV heads < TP=${r.tensorParallel} \u2014 KV REPLICATED across all ${r.tensorParallel} TP ranks (cannot shard below 1 head)`);
    } else if (r.kv.kv_uneven_shard) {
        lines.push(`Tensor parallel: ${r.config.num_kv_heads} KV heads / ${r.tensorParallel} = ${r.kv.kv_heads_per_gpu} heads per rank (UNEVEN \u2014 not divisible; most engines refuse this)`);
    } else {
        lines.push(`Tensor parallel: ${r.config.num_kv_heads} KV heads / ${r.tensorParallel} = ${r.kv.kv_heads_per_gpu} heads per rank`);
    }
    if (pp > 1) {
        lines.push(`Pipeline parallel: ${r.config.num_transformer_layers} layers / ${pp} stages = ${r.kv.layers_per_stage} layers per rank`);
    }
    lines.push(`Per rank: ${r.kv.kv_cache_per_gpu_bytes.toLocaleString()} bytes = ${r.kv.kv_cache_per_gpu_gb.toFixed(2)} GB${r.kv.kv_replicated ? ' (replicated copy)' : ''}`);
    if (r.kv.kv_replicated) {
        lines.push(`VRAM across all ${splitDenom} ranks: ${(r.kv.kv_cache_per_gpu_gb * splitDenom).toFixed(2)} GB (= per-rank \u00d7 ${splitDenom} due to replication)`);
        lines.push(`Unique KV (storage tier): ${r.kv.total_kv_cache_gb.toFixed(2)} GB (one logical copy)`);
    } else {
        lines.push(`Total across ranks: ${r.kv.total_kv_cache_gb.toFixed(2)} GB (aggregate, sums to one full KV across all ${splitDenom} ranks)`);
    }

    // Memory breakdown — two zones
    lines.push("");
    lines.push("MEMORY BREAKDOWN (Per GPU/Rank)");
    lines.push(`Total GPU Memory: ${r.gpuMemoryGB.toFixed(1)} GB`);
    lines.push("");
    lines.push(`\u250C\u2500 vLLM Budget (--gpu-memory-utilization ${(r.gpuMemoryUtil * 100).toFixed(0)}%): ${r.vllmAllocated.toFixed(1)} GB`);
    lines.push(`\u2502  \u251C\u2500 Model Weights: ${r.weightsPerRankGB.toFixed(1)} GB (SPLIT: ${r.totalWeightsGB.toFixed(1)}GB / ${splitDenom})`);
    lines.push(`\u2502  \u251C\u2500 KV Cache: ${r.kv.kv_cache_per_gpu_gb.toFixed(1)} GB (per-stage: ${r.kv.layers_per_stage} of ${r.config.num_transformer_layers} layers)`);
    lines.push(`\u2502  \u251C\u2500 Activations: ${r.act.activation_per_gpu_gb.toFixed(1)} GB (SPLIT: ${r.act.total_activation_gb.toFixed(1)}GB / ${r.tensorParallel})`);
    lines.push(`\u2502  \u2514\u2500 Available for KV growth: ${r.vllmAvailable.toFixed(1)} GB`);
    lines.push("");
    lines.push(`\u2514\u2500 Outside Budget: ${r.systemReserved.toFixed(1)} GB`);
    if (r.showCUDAGraphs) {
        lines.push(`   \u251C\u2500 CUDA Graphs: ${r.cudaPerRank.toFixed(1)} GB (captured after KV alloc)`);
    }
    if (r.showFrameworkOH) {
        lines.push(`   \u251C\u2500 Framework OH: ${r.fwPerRank.toFixed(1)} GB`);
    }
    lines.push(`   \u251C\u2500 cuFile Buffer: ${r.cufileBufferGB.toFixed(1)} GB`);
    lines.push(`   \u251C\u2500 Driver/Context: ${r.driverContext.toFixed(1)} GB`);
    lines.push(`   \u2514\u2500 Available: ${r.outsideAvailable.toFixed(1)} GB`);
    lines.push("");
    lines.push(`Total Used: ${r.totalUsed.toFixed(1)} GB`);
    lines.push(`Total Available: ${(r.vllmAvailable + r.outsideAvailable).toFixed(1)} GB`);

    // Analysis
    lines.push("");
    if (r.vllmAvailable > 1.0) {
        lines.push("ANALYSIS: vLLM has headroom");
        lines.push(`  ${r.vllmAvailable.toFixed(1)} GB available within budget for KV growth`);
    } else if (r.vllmAvailable < -0.5) {
        lines.push("WARNING: vLLM budget exceeded!");
        lines.push(`  ${r.vllmAvailable.toFixed(1)} GB over budget`);
        lines.push("  Risk of out-of-memory errors");
        lines.push("  Reduce gpu_memory_util, max_num_seqs, or batch size");
    } else {
        lines.push("ANALYSIS: vLLM budget well-utilized");
        lines.push(`  ${r.vllmAvailable.toFixed(1)} GB available within budget`);
    }
    if (r.outsideAvailable < 0) {
        lines.push("");
        lines.push("WARNING: Outside-budget components exceed reserved VRAM!");
        lines.push(`  ${r.outsideAvailable.toFixed(1)} GB deficit`);
        lines.push("  Reduce cuFile buffer or lower gpu_memory_utilization");
    }

    return lines.join("\n");
}
