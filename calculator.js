// GPU Memory Calculator — ported from Python modules
// All calculations are pure arithmetic, no external dependencies.

// ---------------------------------------------------------------------------
// Model parameters — from model_specs.py calculate_model_parameters()
// ---------------------------------------------------------------------------
function calculateModelParameters(config) {
    const hs = config.hidden_size;
    const L = config.num_transformer_layers;
    const H = config.num_attention_heads;
    const G = config.num_kv_heads;
    const D = config.head_dimension;
    const I = config.intermediate_size;
    const V = config.vocab_size;
    const tieEmb = config.tie_word_embeddings !== false;
    const hiddenAct = (config.hidden_act || "silu").toLowerCase();

    // Attention: Q, K, V, O projections
    const q_proj = hs * (H * D);
    const k_proj = hs * (G * D);
    const v_proj = hs * (G * D);
    const o_proj = (H * D) * hs;
    const attention_params = q_proj + k_proj + v_proj + o_proj;

    // MLP
    const isGLU = hiddenAct.includes("glu") || hiddenAct === "silu" || hiddenAct === "swish";
    const mlp_params = isGLU ? 3 * hs * I : 2 * hs * I;

    // Norms (RMSNorm / LayerNorm per layer: attention + MLP)
    const norm_params = 2 * hs;

    const per_layer_params = attention_params + mlp_params + norm_params;
    const embedding_params = V * hs;
    const lm_head_params = tieEmb ? 0 : embedding_params;
    const total_params = per_layer_params * L + embedding_params + lm_head_params;

    return {
        attention_params,
        mlp_params,
        norm_params,
        per_layer_params,
        embedding_params,
        lm_head_params,
        total_params
    };
}

// ---------------------------------------------------------------------------
// KV cache memory — from kv_cache_calc.py calculate_kv_cache_memory()
// ---------------------------------------------------------------------------
function calculateKVCacheMemory(config, maxNumSeqs, promptLength, tensorParallel, bytesPerKV) {
    const L = config.num_transformer_layers;
    const G = config.num_kv_heads;
    const D = config.head_dimension;

    // Cap effective KV length by sliding_window when present
    const effectiveKVLength = config.sliding_window
        ? Math.min(promptLength, config.sliding_window)
        : promptLength;

    const kvPerSeqPerLayer = 2 * G * D * effectiveKVLength * bytesPerKV;
    const kvPerSeq = kvPerSeqPerLayer * L;
    const totalKV = kvPerSeq * maxNumSeqs;

    const kvHeadsPerGPU = Math.floor(G / tensorParallel);
    const kvPerGPU = 2 * kvHeadsPerGPU * D * effectiveKVLength * bytesPerKV * L * maxNumSeqs;

    return {
        kv_cache_per_seq_per_layer_bytes: kvPerSeqPerLayer,
        kv_cache_per_seq_bytes: kvPerSeq,
        total_kv_cache_bytes: totalKV,
        kv_cache_per_gpu_bytes: kvPerGPU,
        total_kv_cache_gb: totalKV / (1024 ** 3),
        kv_cache_per_gpu_gb: kvPerGPU / (1024 ** 3),
        kv_heads_per_gpu: kvHeadsPerGPU,
        effective_kv_length: effectiveKVLength
    };
}

// ---------------------------------------------------------------------------
// Activation memory — from activation_calc.py calculate_activation_memory()
// ---------------------------------------------------------------------------
function calculateActivationMemory(config, maxBatchedTokens, tensorParallel, bytesPerElement) {
    const H = config.num_attention_heads;
    const G = config.num_kv_heads;
    const D = config.head_dimension;
    const I = config.intermediate_size;
    const hiddenAct = (config.hidden_act || "silu").toLowerCase();
    const isGLU = hiddenAct.includes("glu") || hiddenAct === "silu" || hiddenAct === "swish";

    // Per-token activations (total)
    const q_act = H * D;
    const k_act = G * D;
    const v_act = G * D;
    const attn_scores = H * maxBatchedTokens;
    const mlp_act = isGLU ? 2 * I : I;
    const act_per_token = q_act + k_act + v_act + attn_scores + mlp_act;

    // Per GPU
    const headsPerGPU = Math.floor(H / tensorParallel);
    const kvHeadsPerGPU = Math.floor(G / tensorParallel);
    const mlpPerGPU = Math.floor(I / tensorParallel);

    const q_gpu = headsPerGPU * D;
    const k_gpu = kvHeadsPerGPU * D;
    const v_gpu = kvHeadsPerGPU * D;
    const attn_gpu = headsPerGPU * maxBatchedTokens;
    const mlp_gpu = isGLU ? 2 * mlpPerGPU : mlpPerGPU;
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
        config,
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

    // Model parameters & weights
    const paramBreakdown = calculateModelParameters(config);
    const totalWeightsGB = (paramBreakdown.total_params * bytesPerWeight) / (1024 ** 3);
    const weightsPerRankGB = totalWeightsGB / tensorParallel;

    // KV cache
    const kv = calculateKVCacheMemory(config, maxNumSeqs, promptLength, tensorParallel, bytesPerKV);

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

// Calculate plan results for one model (includes per-bucket breakdown)
function calculatePlanEntry(planEntry, workspaceEntry) {
    const config = workspaceEntry.config;
    const bytesPerKV = (workspaceEntry.deployment && workspaceEntry.deployment.bytesPerKV) || 2;

    let totalKVSizeBytes = 0;
    let totalWriteBytesPerSec = 0;
    let totalReadBytesPerSec = 0;

    const exchangeRatePerSec = planEntry.exchangeRatePerHour / 3600;
    const bucketDetails = [];

    for (const bucket of planEntry.distribution) {
        const pFrac = bucket.percentage / 100;
        const hitFrac = bucket.cacheHitRate / 100;
        const kvBytes = kvCacheBytesForContext(config, bucket.contextSize, bytesPerKV);

        // Size: based on total users, NOT multiplied by server instances (shared storage)
        const bucketExchanges = planEntry.totalUsers * planEntry.exchangesPerUser * pFrac;
        const bucketSizeBytes = bucketExchanges * kvBytes;
        totalKVSizeBytes += bucketSizeBytes;

        // Throughput: based on concurrent users × server instances
        const bucketExchangesPerSec = planEntry.serverInstances * planEntry.concurrentUsers * exchangeRatePerSec * pFrac;
        const bucketWriteBytes = bucketExchangesPerSec * (1 - hitFrac) * kvBytes;
        const bucketReadBytes = bucketExchangesPerSec * hitFrac * kvBytes;
        totalWriteBytesPerSec += bucketWriteBytes;
        totalReadBytesPerSec += bucketReadBytes;

        bucketDetails.push({
            contextSize: bucket.contextSize,
            percentage: bucket.percentage,
            cacheHitRate: bucket.cacheHitRate,
            kvBytesPerSeq: kvBytes,
            exchanges: bucketExchanges,
            sizeBytes: bucketSizeBytes,
            exchangesPerSec: bucketExchangesPerSec,
            writeBytesPerSec: bucketWriteBytes,
            readBytesPerSec: bucketReadBytes
        });
    }

    return {
        totalKVSizeBytes,
        totalWriteBytesPerSec,
        totalReadBytesPerSec,
        totalKVSizeGiB: totalKVSizeBytes / (1024 ** 3),
        totalWriteGiBps: totalWriteBytesPerSec / (1024 ** 3),
        totalReadGiBps: totalReadBytesPerSec / (1024 ** 3),
        bucketDetails,
        // Echo inputs used in calculation for the detail view
        totalUsers: planEntry.totalUsers,
        exchangesPerUser: planEntry.exchangesPerUser,
        serverInstances: planEntry.serverInstances,
        concurrentUsers: planEntry.concurrentUsers,
        exchangeRatePerHour: planEntry.exchangeRatePerHour
    };
}

// Aggregate plan results across all models
function calculatePlanRollup(results) {
    let totalSize = 0, totalWrite = 0, totalRead = 0;
    for (const r of results) {
        totalSize += r.totalKVSizeBytes;
        totalWrite += r.totalWriteBytesPerSec;
        totalRead += r.totalReadBytesPerSec;
    }
    return {
        totalKVSizeBytes: totalSize,
        totalWriteBytesPerSec: totalWrite,
        totalReadBytesPerSec: totalRead,
        totalKVSizeGiB: totalSize / (1024 ** 3),
        totalWriteGiBps: totalWrite / (1024 ** 3),
        totalReadGiBps: totalRead / (1024 ** 3)
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
    lines.push(`Intermediate size: ${r.config.intermediate_size}`);
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
    lines.push(`GPU memory: ${r.gpuMemoryGB.toFixed(1)} GB`);
    lines.push(`GPU memory utilization: ${(r.gpuMemoryUtil * 100).toFixed(0)}%`);
    lines.push(`cuFile buffer: ${r.cufileBufferGB.toFixed(1)} GB`);

    // Model weights
    lines.push("");
    lines.push("MODEL MEMORY");
    lines.push(`Parameters: ${r.paramBreakdown.total_params.toLocaleString()}`);
    lines.push(`Total weights: ${r.totalWeightsGB.toFixed(2)} GB`);
    lines.push(`Per rank @TP=${r.tensorParallel}: ${r.weightsPerRankGB.toFixed(2)} GB`);

    // KV cache
    lines.push("");
    lines.push("KV CACHE CALCULATIONS");
    lines.push(`Config: ${r.config.num_transformer_layers} layers, ${r.config.num_kv_heads} KV heads, ${r.config.head_dimension} head dim`);
    if (r.config.sliding_window && r.kv.effective_kv_length !== r.promptLength) {
        lines.push(`Effective KV length: min(${r.promptLength.toLocaleString()}, ${r.config.sliding_window.toLocaleString()}) = ${r.kv.effective_kv_length.toLocaleString()} (capped by sliding window)`);
    }
    lines.push(`Per sequence: 2 x ${r.config.num_kv_heads} x ${r.config.head_dimension} x ${r.kv.effective_kv_length.toLocaleString()} x ${r.bytesPerKV} bytes = ${r.kv.kv_cache_per_seq_bytes.toLocaleString()} bytes`);
    lines.push(`All sequences: ${r.kv.kv_cache_per_seq_bytes.toLocaleString()} x ${r.maxNumSeqs} = ${r.kv.total_kv_cache_bytes.toLocaleString()} bytes`);
    lines.push(`Tensor parallel: ${r.config.num_kv_heads} KV heads / ${r.tensorParallel} = ${r.kv.kv_heads_per_gpu} heads per rank`);
    lines.push(`Per rank: ${r.kv.kv_cache_per_gpu_bytes.toLocaleString()} bytes = ${r.kv.kv_cache_per_gpu_gb.toFixed(1)} GB`);
    lines.push(`Total across ranks: ${r.kv.kv_cache_per_gpu_gb.toFixed(1)} GB x ${r.tensorParallel} = ${r.kv.total_kv_cache_gb.toFixed(1)} GB`);

    // Memory breakdown — two zones
    lines.push("");
    lines.push("MEMORY BREAKDOWN (Per GPU/Rank)");
    lines.push(`Total GPU Memory: ${r.gpuMemoryGB.toFixed(1)} GB`);
    lines.push("");
    lines.push(`\u250C\u2500 vLLM Budget (--gpu-memory-utilization ${(r.gpuMemoryUtil * 100).toFixed(0)}%): ${r.vllmAllocated.toFixed(1)} GB`);
    lines.push(`\u2502  \u251C\u2500 Model Weights: ${r.weightsPerRankGB.toFixed(1)} GB (SPLIT: ${r.totalWeightsGB.toFixed(1)}GB / ${r.tensorParallel})`);
    lines.push(`\u2502  \u251C\u2500 KV Cache: ${r.kv.kv_cache_per_gpu_gb.toFixed(1)} GB (SPLIT: ${r.kv.total_kv_cache_gb.toFixed(1)}GB / ${r.tensorParallel})`);
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
