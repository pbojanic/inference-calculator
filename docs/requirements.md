# Requirements for Inference Calculator

## Architecture

### Database

Uses strictly local storage.

### Data versioning

Each persisted localStorage payload (workspace, GPU profiles, cached model configs, plan data, settings) carries an integer `version` field at the top level, and the application defines a current version constant for each payload. On load:

- If the stored payload's `version` matches the current version, it is used as-is.
- If the stored `version` is missing, lower than the current version, or higher than the current version (e.g. data written by a newer build), the application shows a non-blocking warning toast naming the payload (e.g. `Plan data was created by an older version and has been reset to defaults.`) and replaces the payload with its default shape. Old data is discarded — the project does not maintain backwards-compatible migrations.
- The version number is bumped any time a persisted payload's shape changes incompatibly. Additive changes that read cleanly under the existing default-merge logic do not require a bump.

Each payload tracks its own version independently, so a schema change in one area (e.g. plan data) does not invalidate unrelated payloads (e.g. the workspace or GPU list). The Settings export bundles the current version of every payload; on import, the same warn-and-reset behaviour applies per payload if any version is unrecognised.


## General UI

This is a multi-page application with URL routing. The Browser back button should work in a predictable way.

If I navigate away from a page with unsaved changes, the application should warn me and give me the option to stay or discard changes.

### Navigation

A global menu is always visible, providing quick access (in workflow order) to the Systems page, Models page, Plan page, Graphs page, Settings page, and References page. The current page should be visually indicated.


## System modeling

The application reasons about *systems*, not bare GPUs. A **system** is a deployable unit (e.g. DGX H100, GB200 NVL72) made of:

- A fixed number of GPUs of a specific type, with a known per-GPU memory size.
- A read-bandwidth and write-bandwidth cap on access to the shared KV-cache storage tier.

This shapes the rest of the app:

- The Model Details page selects a **system** for each workspace entry; the system's per-GPU memory drives the GPU memory analysis. Tensor-parallel must be ≤ the system's GPU count (each pipeline stage's TP ranks must share NVLink within one system).
- The Plan page measures fleet size in **system instances** (e.g. "3× DGX H100"), not raw server processes. Total GPUs = `systemInstances × system.gpuCount`. GPUs per model instance = `tp × pp`. Model instances per fleet = `floor(totalGPUs / (tp × pp))`. When `pp = 1`, this reduces to the previous "instances per system" framing.
- Throughput is **capped** at `systemInstances × system.bandwidth` for each of read and write. Both caps are independent. There is no capacity (storage size) cap.

### Parallelism — TP and PP

The application models two axes of parallelism for each workspace entry:

- **Tensor parallel (`tp`)** — splits the model along its width (attention heads, FFN columns). All TP ranks for a given pipeline stage must share NVLink within a single system, so `tp ≤ system.gpuCount`.
- **Pipeline parallel (`pp`)** — splits the model along its depth (transformer layers). PP can span multiple systems when the layer count is large enough that no single system can hold all weights at the chosen TP. Each pipeline stage holds `ceil(num_transformer_layers / pp)` layers' worth of weights and KV cache. PP defaults to 1 (no pipelining); existing workspace entries that predate the feature read as `pp = 1` via default-merge.

Combined GPUs per model instance = `tp × pp`. The combined check `tp × pp ≤ totalGPUs` belongs on the Plan page where `systemInstances` is known; the Model Details page only enforces the per-stage `tp ≤ system.gpuCount` constraint.

PP changes how weights, KV cache, and activations distribute per rank, but does **not** change aggregate parameter count or aggregate KV demand at the shared storage tier — those are properties of the model and workload, not of how the model is sharded across GPUs.


## References page

The References page is a dedicated top-level page accessible from the navigation bar. Its purpose is to give sales engineers a compact, defensible bibliography they can use when discussing inference sizing, context-length workload assumptions, and KV-cache memory behavior with customers.

### Content

The page lists a curated set of compelling, peer-reviewed or industry-authoritative studies, grouped into short sections:

- **Long-context evaluation benchmarks** — RULER (NVIDIA), LongBench (Tsinghua), Lost in the Middle (Liu et al.).
- **Real-world inference workloads** — MLPerf Inference (MLCommons) reference datasets and workload definitions.
- **Model capability reports** — Gemini 1.5 Technical Report (DeepMind), and other model-family technical reports as they become relevant.
- **Vendor sizing guides** — VMware LLM Inference Sizing and Performance Guidance (Broadcom/VMware), Lenovo LLM Sizing Guide.

Each entry shows:
- The title.
- Primary authors or publishing organization.
- Venue and year (e.g., "COLM 2024", "TACL 2024", "MLCommons, 2024").
- A one-sentence "why it matters for sizing" note grounded in the Plan-page use case.
- An external link that opens in a new tab (`target="_blank" rel="noopener noreferrer"`).

Local PDFs bundled in the repo (e.g., Lenovo and VMware sizing guides in `docs/`) are referenced via relative links so they work in offline environments.

### Maintenance

Every entry on the References page must have been verified (link opens to the correct document, authors and venue confirmed) before being added. If a link rots or a paper is superseded, update or remove the entry rather than leaving a stale reference.


## Settings page

The Settings page is a dedicated top-level page accessible from the navigation bar.

### HuggingFace Token

The HuggingFace token is entered on the Settings page. Settings save automatically (on blur). A "Test Token" button validates the token by making an authenticated request to the HuggingFace API and reports whether the token is valid.

### Export / Import

The Settings page includes Export and Import buttons for backing up and restoring all application data.

**Export** always prompts the user before saving — the user never sees a silent download. Two paths, chosen at runtime:

1. **Native Save As dialog** (preferred) — when the browser supports the File System Access API and the page is in a compatible context (Chromium browsers on HTTPS or localhost), clicking Export opens the OS's native Save As dialog so the user can pick both the folder and the filename. The suggested filename is `inference-calculator-backup-YYYY-MM-DD.json`.
2. **Filename prompt fallback** — when the File System Access API is unavailable (Safari, Firefox) or blocked (Chromium on a `file://` origin), the app shows its own modal prompting the user to confirm or edit the filename before triggering a standard anchor-based download. The file then lands in the browser's default Downloads folder. The modal uses the same overlay pattern as `confirmDialog` and the unsaved-changes guard.

The exported JSON contains the workspace (working models with their configs and deployment settings), Systems list, cached model configs, and plan data. Each payload is exported in its versioned wrapper form so a round-trip preserves the schema version. The HuggingFace token is excluded from the export for security. If the user cancels either dialog, nothing is saved and no status message is shown.

**Import** loads a previously exported JSON file and replaces the current workspace, Systems list, cached model configs, and plan data. The HuggingFace token is not affected by import. The application should confirm before importing since it replaces existing data. Per the [Data versioning](#data-versioning) policy, any imported payload whose version does not match the current schema is reset to defaults with a warning toast — old backups will not silently corrupt the new app.

### Start new plan

The Settings page includes a **Start new plan** button that resets all planning inputs (planning horizon, per-model server instances, requests/sec ranges, distribution buckets, etc.) to their defaults. The button is destructive, so the app prompts for confirmation via a modal dialog before clearing anything. Workspace models, GPU profiles, and cached model configs are not affected — only the plan data stored under `gpu_calc_plan`. After the reset, the Plan page renders default entries (one per workspace model) on next render via `syncPlanWithWorkspace`.


## Home page

### Working models

The home page shows me a list of local models I'm already working with. The list of models starts off blank and then I add the models with which I want to work. Each working model has a unique internal ID and an editable title. The title defaults to the HuggingFace model name when added but can be changed to describe a specific configuration (e.g., "Qwen/Qwen3-32B on A100" vs "Qwen/Qwen3-32B on B200"). I can add multiple instances of the same base model with different titles and different deployment settings.

The most important data to show is the size of the model weights, the size of the KV Cache, and the assigned system. The KV Cache size should reflect the user's overridden context length if they've changed it, otherwise the model's default max context size. The assigned system name should be shown prominently in the summary table alongside weights and KV cache. For MoE models, the weights line annotates the architecture inline (e.g. `Weights: 240.0 GiB (MoE 256×1536, top-8)`), and the expanded detail panel shows total vs. active parameter counts.

### Model titles

Model titles must be unique across the workspace. If I try to save a model with a title that already exists, the application should prevent the save and show an error. When adding a model, the title defaults to the HuggingFace model name.

### Add a model

I press Add a model to add a new model. I can pick from a list of popular models from HuggingFace — the popular list is always fully visible since the same base model can be added multiple times with different titles. If I add a model whose title already exists, the application auto-appends a number (e.g., "Qwen/Qwen3-32B (2)"). Validate the model name before trying to do calculations. Download the architecture config to the cached model store so it can be reused for future adds, and automatically calculate the KV cache size requirements for the model.

#### Deferred save (draft flow)

Adding a model **does not immediately save it to the workspace**. Instead the application stages the chosen model as an in-memory draft and routes me to the Model Details page. The model is only persisted to the workspace when I press **Save** on that page and validation passes. If I press **Cancel**, navigate away and discard via the unsaved-changes dialog, or close the tab, the draft is discarded and nothing appears in my Working Models list.

The draft is held on `State.pendingNewModel` (an in-memory slot, not localStorage) and addressed by the synthetic route `#model/_new`. The HuggingFace architecture config is still cached in the model store on first fetch — caching the raw architecture is independent of saving an entry to the workspace, and lets a subsequent add of the same model skip the network round-trip.

The **System** field starts empty so I am prompted to choose where this model will run; the placeholder reads "Select a system…" and a red help line points me at the Systems page if I need to add or edit one. The exception: if exactly one system is configured in the workspace, the new entry adopts it automatically (since there is no choice to make). Save is blocked until a system is selected — see "Save validation" below.

#### Model search

Allow me to specify any part of the model name and search for matches on HuggingFace. Example: Qwen/ or Qwen/Qwen3. Show results in a dropdown list below the search input, up to 20 results maximum.

The HuggingFace search API call sorts by downloads and is capped at 20 results, so a brand-new release (low download count, ranked behind years-old peers) may not appear in the dropdown for a partial-name query. To handle this case, the search input also accepts a **full HuggingFace model identifier** (`<owner>/<model>`) or a **HuggingFace URL** (`https://huggingface.co/<owner>/<model>` or any deeper path on the same model, e.g. `/blob/main/config.json`). When the input matches that shape, the application bypasses the search API entirely and fetches the model's `config.json` directly. The fast-path triggers in three places:

- **Paste** — the input's `paste` event reads `clipboardData` and, if the pasted text matches the id/URL shape, fires the fast-path immediately and prevents the default paste so the debounced search doesn't get a chance to overwrite the status with "No models found."
- **Enter key** — submits the current input value through the fast-path.
- **Search button** — same as Enter.

The same fast-path is **not** applied to the debounced typing path, so a mid-keystroke pause on a string that briefly looks like a complete identifier doesn't trigger an unintended fetch. On any explicit submit (paste / Enter / Search), the debounce timer is cleared so a queued debounced search can't race with the fast-path's fetch.

#### Popular model list

Popular models are hard coded as: Qwen/Qwen3-32B, meta-llama/Llama-3.2-1B-Instruct, meta-llama/Llama-3.1-70B-Instruct, Qwen/Qwen2.5-7B-Instruct	

When I add the model, use the default max context size from the model (`max_position_embeddings`). Allow me to override the default max context freely — for example, to extend it with rope scaling. The application should capture `sliding_window` from the HuggingFace config when available.

#### params.json compatibility mode

Some checkpoints — notably Mistral's larger releases (e.g. `mistralai/Mistral-Large-3-675B-Instruct-2512`) — ship only Mistral's native `params.json` and no HF transformers `config.json` at the root of `main`. When the primary `config.json` fetch returns 404, the application falls back to fetching `params.json` and translating its native field names into the HF shape that the rest of the loader expects:

- `dim → hidden_size`, `n_layers → num_hidden_layers`, `n_heads → num_attention_heads`, `n_kv_heads → num_key_value_heads`, `head_dim → head_dim`, `hidden_dim → intermediate_size`, `norm_eps → rms_norm_eps`.
- The nested `moe` block (`num_experts`, `num_experts_per_tok`, `intermediate_size`) follows Mixtral conventions and is flattened to `num_local_experts`, `num_experts_per_tok`, and (for MoE) the per-expert `intermediate_size`.
- `tie_word_embeddings` defaults to `false` when `params.json` is silent, since every Mistral large/MoE config uses untied embeddings — overriding `normalizeModelConfig`'s default-of-true.

When the fallback succeeds, the application:

1. Shows a non-blocking warning toast naming the model and noting that estimates may differ from a future HF-format release.
2. Stamps `_compatibilityMode: 'mistral-params'` on the cached config, which the Model Details page renders as a persistent `params.json compatibility` badge next to the model title.

If `params.json` is also absent, the original "Model not found" error is raised. Access-denied (401/403) on either file surfaces the gated/license-acceptance message.

#### Multimodal models (text_config hoisting)

Vision-language checkpoints (Pixtral, Llama-3.2-Vision, Mistral3 e.g. `mistralai/Mistral-Medium-3.5-128B`, LLaVA-style, Gemma3-vision) ship a `config.json` whose language-model architecture is nested under `text_config`, with a separate `vision_config` for the vision tower. When the loader detects a `text_config` sub-object, it hoists those fields onto the top level (text_config wins on collisions like `tie_word_embeddings` because it carries the authoritative LM architecture) and stamps `_multimodal: true` on the normalized config.

When a multimodal config is loaded, the application:

1. Shows a non-blocking warning toast noting that only the language-model portion is modelled — vision encoder weights, KV, and activations are excluded.
2. Renders a persistent `LLM only` badge next to the model title on the Model Details page, with a tooltip restating the caveat.

The vision tower's contribution is typically small relative to the LM (e.g. for Mistral-Medium-3.5-128B the vision encoder is ~0.5B parameters against ~124B for the LM), but operators sizing for multimodal inference workloads should account for it separately. See "Known limitations" below.

#### Sliding window

Some models define a `sliding_window` value in their HuggingFace config. The sliding window caps the effective KV cache size per layer — each layer only attends to the most recent `sliding_window` tokens, regardless of the full sequence length. The sliding window does **not** restrict the sequence length input; the user can set the sequence length higher than the sliding window (the model still processes the full sequence, but KV cache per layer is bounded). When present, the sliding window value should be displayed prominently in the Deployment section, labeled as a KV cache cap. For models without a sliding window (the field is absent or null), there is no KV cache cap. The KV cache calculation should use `min(sequence_length, sliding_window)` when a sliding window is defined.

### Select a model

I can select one of the models and see high level details: assigned system, max context length (either default or overridden, with the model's default shown for reference), parameter count (computed via `calculateModelParameters` — total for dense models, active/total for MoE), memory requirements (in GiB), KV Cache memory requirements (aggregated, even if TP>1).

The compact stats line on each model card and the summary stats line on the Model Details page both display a `Params:` value next to the system name. Format:
- Dense: `Params: X.XB`
- MoE: `Params: A.AB act / T.TB` (active per token, then total resident).

### Open a model

When I have a model selected, I can press "Open" to navigate to the Model Details page where all editing takes place. There is no inline edit form on the Models page — all model configuration is done on the Model Details page.

### Remove a model

I can remove a model from my working models list. The application should confirm before deleting.

### Model details

When I want to see the details of a model, take me to the Model Details page.

## Model Details page

When I select a model and view its details, I see the full GPU memory analysis for that model. Calculations and graphs update automatically when the page opens and whenever I change any parameter. When I press "Save", the current values are persisted to local storage and I am taken back to the Models page. When I press "Cancel", I am taken back to the Models page with values unchanged. The global navigation remains available for navigating without saving or cancelling.

### Base model selection

Below the model title, a dropdown lists all locally cached HuggingFace models (downloaded via search or popular model chips). Changing the base model updates the architecture config, resets precision to auto-detected values, and resets context length to the new model's default. This allows reusing a workspace entry's title and deployment settings with a different model architecture.

### System configuration

I can select a system from my managed Systems list (see Systems page). The system contributes its per-GPU memory and bandwidth caps to all downstream calculations. I can adjust the GPU memory utilization percentage via a slider (default 85%). The System section appears directly below the model title/selection area, before the deployment parameters.

### Deployment parameters

I can configure the deployment scenario for the model:

- Sequence length — shows the current working value (which may be overridden) and displays the model's default max context size for reference. When the model has a sliding window, display it and enforce it as the maximum allowed value
- Max sequences — how many concurrent sequences (default 1)
- Max batched tokens — the vLLM batched token limit (default 8192)
- Tensor parallel (`tp`) — width-wise sharding within a single system. Must be ≥ 1 and **must not exceed the assigned system's GPU count** (e.g. on a DGX H100 with 8 GPUs, TP ≤ 8) since all TP ranks for a stage share NVLink. Save is blocked with a validation error if TP exceeds the system's GPU count. Default 2.
- Pipeline parallel (`pp`) — depth-wise sharding across pipeline stages. Must be ≥ 1. Default 1 (no pipelining). The Model Details page does not enforce a `tp × pp` combined check — that constraint depends on `systemInstances`, which is set on the Plan page. The Model Details page only enforces the per-stage `tp ≤ system.gpuCount` rule and per-input bounds.

### Storage

I can specify the cuFile buffer size in GB (default 2.0).

### Precision

Precision settings (bytes per weight, bytes per KV element, bytes per activation) are auto-detected from the model config. I can override them manually if needed. The UI indicates whether values are auto-detected or manually set.

### Options

I can toggle the inclusion of CUDA graphs memory and framework overhead in the calculation.

### Mixture of Experts (MoE)

Some modern models (Mixtral, DeepSeek-V2/V3, Qwen-MoE, MiniMax-M2, etc.) are MoE rather than dense: each transformer layer holds a pool of expert FFN blocks, and only a small subset (`num_experts_per_tok`) fires per token. **All experts must reside in VRAM** — routing is dynamic so every expert is reachable — even though they don't all run on every token. Treating an MoE model as dense undercounts weights by 1–2 orders of magnitude (e.g. MiniMax-M2 reads as ~5 GB instead of ~230 GB).

The application detects MoE structure by reading the following HuggingFace config fields, which differ between model families:

| Concept                    | DeepSeek                       | Mixtral / MiniMax       | Qwen-MoE                              |
|----------------------------|--------------------------------|--------------------------|----------------------------------------|
| Total routed experts       | `n_routed_experts`             | `num_local_experts`     | `num_experts`                         |
| Experts active per token   | `num_experts_per_tok`          | `num_experts_per_tok`   | `num_experts_per_tok`                 |
| Per-expert FFN width       | `moe_intermediate_size`        | `intermediate_size`     | `moe_intermediate_size`               |
| Dense FFN width (prefix)   | `intermediate_size`            | n/a                      | `intermediate_size` (if dense layers) |
| Dense prefix layer count   | `first_k_dense_replace`        | 0                        | 0                                      |
| Shared expert count        | `n_shared_experts`             | 0                        | 1 (when `shared_expert_intermediate_size` is set) |
| Shared expert FFN width    | `n_shared_experts × moe_intermediate_size` | 0           | `shared_expert_intermediate_size`     |
| MTP (multi-token predict)  | `num_nextn_predict_layers`     | 0                        | 0                                      |

Normalization picks whichever name is present and stores the result on the model config under stable internal names (`num_routed_experts`, `num_experts_per_tok`, `num_shared_experts`, `moe_intermediate_size`, `shared_intermediate_size`, `num_dense_layers`, `num_mtp_modules`, plus an `is_moe` flag). Dense models receive zeros for these fields and `is_moe = false`.

#### Weight calculation

For MoE layers, the per-layer FFN weight count is:

```
per_expert_ffn       = ffn_factor × hidden_size × moe_intermediate_size
                       (ffn_factor = 3 for SwiGLU/SiLU, 2 otherwise)
routed_experts_total = num_routed_experts × per_expert_ffn
router               = hidden_size × num_routed_experts
shared               = ffn_factor × hidden_size × shared_intermediate_size  (if any)

moe_layer_ffn = routed_experts_total + router + shared
```

For dense prefix layers (when `num_dense_layers > 0`), the FFN block uses the standard dense formula with `intermediate_size` (the dense field, distinct from `moe_intermediate_size`).

MTP modules are counted as `num_mtp_modules × (one MoE-style layer + 2 × hidden_size² for the eh_proj + one extra norm)`. Their lm_head is shared with the main model and contributes nothing extra.

The total parameter count is therefore:

```
total = num_dense_layers × dense_layer_params
      + (num_transformer_layers − num_dense_layers) × moe_layer_params
      + embedding + (lm_head if untied)
      + num_mtp_modules × mtp_module_params
```

#### Active parameters

The report also surfaces an **active parameter count** — the params that fire per token on the standard decode path:

```
active_moe_layer = attention + norms + (num_experts_per_tok × per_expert_ffn) + router + shared
active_total     = num_dense_layers × dense_layer + num_moe_layers × active_moe_layer
                 + embedding + (lm_head if untied)
```

MTP modules are excluded from active params since they do not fire on standard decode. The headline weight memory is still computed from `total_params` (storage requirement); active params are informational and answer "how much compute moves per token?"

#### Activation memory

For MoE layers, the per-token FFN intermediate that materializes is `num_experts_per_tok × moe_intermediate_size + shared_intermediate_size` rather than a single `intermediate_size`. The activation calculation uses this MoE-aware value when `is_moe` is true.

#### Pipeline parallelism — per-rank distribution

Pipeline parallelism (`pp`) splits the model along its layer dimension. Each pipeline stage holds `ceil(num_transformer_layers / pp)` layers. The math:

```
weights_per_rank   = total_weights / (tp × pp)
kv_per_rank        = 2 × kv_heads_per_rank × head_dim × effective_kv_length × bytes_per_kv
                     × ceil(L / pp) × max_num_seqs
total_kv_aggregate = unchanged — independent of tp and pp; this is the storage-tier truth
```

The aggregate KV cache size that hits the shared storage tier is independent of how the model is sharded. PP only redistributes which rank holds which slice — total bytes flowing to and from the shared storage are the same. Plan-page capacity and throughput math is therefore unaffected by PP.

Activations are not currently re-scaled by PP. The activation formula already represents transient state at one layer's interface (it does not multiply by `L`), which is a reasonable approximation of one pipeline stage's in-flight activation memory for inference. If a future workload reveals material under-sizing, this can be revisited as a separate enhancement.

#### KV head sharding under TP

The number of KV heads (`G = num_kv_heads`) determines how cleanly KV cache distributes across TP ranks:

- **`G ≥ tp` and `G % tp = 0` (clean shard)** — `kv_heads_per_rank = G / tp`. Each rank holds 1/tp of the KV. Standard GQA/MHA case.
- **`G ≥ tp` but `G % tp ≠ 0` (uneven shard)** — `kv_heads_per_rank = ceil(G / tp)`. Most engines refuse this configuration at startup; the calculator computes a ceiling estimate and surfaces an `(UNEVEN — not divisible; most engines refuse this)` note in the report so the user can tell at a glance.
- **`G < tp` (replication)** — KV heads cannot shard below 1, so the engine **replicates** the KV across all `tp` ranks. Each rank holds the FULL KV slice for its pipeline stage's layers; `kv_heads_per_rank = G`. This is normal for MLA-shaped models (DeepSeek-V2/V3 with `num_kv_heads = 1`) and explicitly handled by MLA-aware engines.

When KV is replicated, the calculator distinguishes two aggregate views:

- **VRAM across ranks** — physical memory consumed: `kv_per_rank × tp × pp`. With replication this is `tp` times the unique KV.
- **Unique KV (storage tier)** — one logical copy: independent of `tp` and `pp`. This is what the Plan page uses for capacity/throughput sizing because the shared storage tier sees a single copy regardless of how many TP ranks each holding their own VRAM copy.

The report makes this explicit: when `G < tp`, the KV section shows a `KV REPLICATED` notice, the per-rank value is annotated `(replicated copy)`, and a separate line gives the unique storage-tier total.

#### Known limitations

- **Multi-head Latent Attention (MLA)** — DeepSeek-V2/V3 uses MLA, which compresses Q/K/V through a low-rank latent projection plus a separate decoupled-rope dimension. The application currently uses the standard MHA/GQA attention shape (`4 × hidden_size × hidden_size`), which overcounts MLA attention by roughly 30–40%. For MiniMax-M2, Mixtral, Qwen-MoE and other standard GQA-based MoEs the math is correct; DeepSeek-V2/V3 totals will read ~4–5% high at the model level. A future enhancement should detect MLA from the config (`q_lora_rank`, `kv_lora_rank`, `qk_rope_head_dim`, `v_head_dim`) and use the MLA attention formula instead.

- **Vision encoders in multimodal models** — when a config carries `text_config` and `vision_config` sub-objects, the application hoists the LM architecture out of `text_config` and ignores `vision_config` entirely. The vision tower's parameters, KV cache, and activations are not counted toward the totals. Operators sizing storage or compute for multimodal inference should add the vision encoder's footprint separately. A future enhancement could parse `vision_config`, compute the vision-tower parameters, and add a separate line item to the Memory Breakdown.

### Memory breakdown

The page shows a text report with the full GPU memory breakdown including model weights, KV cache, activations, CUDA graphs, framework overhead, cuFile buffer, and system overhead. The report updates automatically whenever any parameter changes. The report shows per-rank values when tensor parallelism is used.

For MoE models, the report includes the architecture summary (routed expert count, top-k, shared experts, MTP modules) and reports both **total** and **active per token** parameter counts so the operator can see the storage cost vs. the compute cost at a glance.

### Visualization

The page shows two charts alongside the memory breakdown:

- A bar chart showing each memory component's size in GB per rank
- A stacked bar chart showing how the total GPU memory is consumed, with a dashed line marking the vLLM allocation boundary

### Export

I can copy the text report to the clipboard or download it as a text file. The Memory Breakdown panel header carries an icon-only copy button (clipboard glyph) as the primary affordance — clicking it copies the full report and the icon swaps to a green checkmark for ~1.5 seconds as confirmation. If the browser blocks clipboard access (e.g. served from `file://`), a warning toast surfaces the underlying error rather than silently failing. The text **Copy** and **Download** buttons remain at the bottom of the panel for the download path and as a fallback affordance.

### Save validation

When I press **Save**, the page validates the entry against every mandatory rule below in a single pass and presents the results together. The Save button never silently no-ops: either the entry is persisted, or a modal dialog (`alertDialog`) lists every issue I need to fix before saving — for example "No system selected" alongside "Title cannot be empty" — so I see the full punch list at once rather than discovering issues one save click at a time.

Mandatory fields and rules:

- **Title** — non-empty, and not already used by another workspace entry (case-sensitive exact match). The `_new` draft uses a synthetic id for the self-comparison check, so the auto-suffixed default title is recognized as not-yet-saved.
- **System** — a system must be selected. Save is blocked when the System dropdown is on its "Select a system…" placeholder.
- **Tensor parallel** — must be ≥ 1 and ≤ the assigned system's `gpuCount`.
- **Pipeline parallel** — must be ≥ 1. The combined `tp × pp` check against the total GPU pool is intentionally deferred to the Plan page (where `systemInstances` is known); on Model Details we only enforce the per-stage NVLink constraint.

Inline error markers (the red help line under the system selector, the validation text under the title and TP inputs) are still updated when validation fails, so the field-level cues remain visible after the dialog is dismissed. The same validation pass applies to both new drafts (`#model/_new`) and edits to existing entries — the dialog wording does not differentiate.


## Systems page

The Systems page lets me manage the list of GPU systems available throughout the application. A system is a deployable unit (DGX-class pod, NVL rack-scale platform, etc.) made of multiple GPUs of the same type, with a known set of bandwidth caps to shared storage. Each system is stored with an internal ID so that model configurations reference systems stably even if a system is renamed.

The Systems page replaces the previous GPUs page. The localStorage key is `gpu_calc_systems` (the legacy `gpu_calc_gpus` key, if present, is removed on first load after upgrade).

### System fields

Every system has:

- **Name** — display name (e.g. `DGX H100`).
- **GPU type** — the GPU model in the system (e.g. `H100`).
- **GPU count** — number of GPUs per system (positive integer; e.g. 8 for DGX-class, 72 for NVL72).
- **GPU memory (GB)** — usable HBM per GPU (e.g. 80 for H100, 141 for H200).
- **Read bandwidth (GiB/s)** — sustained read throughput from the shared KV-cache storage tier per system instance.
- **Write bandwidth (GiB/s)** — sustained write throughput per system instance.

### Default systems

The application ships with a pre-populated list of inference-relevant systems. Bandwidth values below are illustrative defaults, not vendor-quoted figures, and should be validated against current platform specs before being used in customer-facing sizing:

| Name | GPU type | GPUs | GPU mem (GB) | Read (GiB/s) | Write (GiB/s) |
|---|---|---:|---:|---:|---:|
| DGX A100 (80 GB) | A100 | 8 | 80 | 30 | 25 |
| DGX H100        | H100 | 8 | 80 | 60 | 80 |
| DGX H200        | H200 | 8 | 141 | 90 | 90 |
| HGX H100        | H100 | 8 | 80 | 60 | 80 |
| HGX H200        | H200 | 8 | 141 | 90 | 90 |
| GB200 NVL72     | B200 | 72 | 192 | 400 | 400 |

On first launch, these defaults are copied into local storage. From that point on, the list is managed entirely locally. Users whose Systems list was populated from an earlier build do not automatically receive newly added defaults — they can pick them up via "Reset to defaults" on the Systems page or by adding them manually.

### System list

The page shows all systems in my local list, each row showing name, GPU type, GPU count, GPU memory, and the two bandwidth caps.

### Add a system

I can add a new system by specifying all six fields above. Validation: name non-empty, GPU type non-empty, GPU count ≥ 1, GPU memory > 0, both bandwidths > 0.

### Edit a system

I can edit any system's fields, including the ones that shipped as defaults. I press Save to persist or Cancel to revert.

### Remove a system

I can remove any system from the list, including the defaults. The application should confirm before deleting. If a system is currently in use by a model's saved configuration, warn me before allowing deletion (the warning lists the affected workspace models).

### Reset to defaults

I can reset the Systems list back to the application defaults. This removes any custom systems and restores any deleted defaults. The application should confirm before resetting.

### Schema version

Systems data follows the general [Data versioning](#data-versioning) policy with its own version counter. Because this concept replaces the previous GPUs concept entirely, any pre-existing `gpu_calc_gpus` data is not migrated; the user starts with the default systems list, and a non-blocking warning toast is shown on the first load after the upgrade.


## Plan Page

The Plan page provides capacity planning for inference workloads. It calculates aggregate KV cache storage size and IO throughput (reads and writes in GiB/s) across all workspace models. KV cache is stored on shared central storage — all inference server instances access the same storage pool. Operations are assumed to be continuous (24/7).

The Plan page speaks the language of an inference data-centre operator: aggregate **requests/sec** rather than user counts, an explicit **planning horizon** rather than an implicit "stored exchanges per user", and **Average / Peak** scenarios rather than abstract Low/High bounds. This matches how customers actually quote their workloads in sizing conversations.

### Navigation

The Plan page is accessible from the global navigation bar as "Plan", alongside "Models" and "GPUs". The current page is visually indicated.

### Planning horizon

A single top-level input applies to the entire Plan page: **planning horizon** (positive integer, in days; default 30). The horizon represents how long KV cache is retained in shared storage before rolling off — equivalently, how far into operation the storage tier is being sized for. It drives the capacity calculation only; it does not affect throughput. Capacity scales linearly with the horizon: at 0% cache hit rate, doubling the horizon doubles the storage requirement.

The planning-horizon input is rendered above the per-model cards on the Plan page and is included in the persisted plan data and Settings export/import. It is also surfaced on the Graphs page as a small caption beneath each capacity chart (e.g. `Sized for 30 days`) so the reader can see what the storage range is sized against.

### Plan entries

The Plan page displays one row per workspace model, identified by the model's title and linked to the workspace entry by its internal ID. When a workspace model is added or removed on the Home page, the Plan page reflects this automatically: entries for deleted models are cleaned up on page load, and new models appear with default plan values.

### Per-model card identification

Each plan-entry card is titled **`<workspace title> (<parallelism>) on <system name>`** where `<parallelism>` is `TP=<tp>` when `pp = 1`, or `TP=<tp>, PP=<pp>` when `pp > 1`. Example: `Llama-3.2-1B-Instruct (TP=2) on DGX H100`, or `DeepSeek-V4-Pro (TP=8, PP=3) on DGX H100`. The same format is used for the Graphs-page card title so the two pages stay aligned. The `<workspace title>` segment uses the user's current title; `<tp>`, `<pp>`, and `<system>` come from the model's deployment settings.

### Per-model inputs

Each plan entry has the following editable fields:

- **System instances** (positive integer, default 1) — the number of physical systems (e.g. DGX H100s) running this model. Drives GPU count, total model instances, and the system bandwidth cap.
- **Requests/sec** (*Average* / *Peak*, each a positive number; default avg = peak = 1.0) — the aggregate inference request rate across all users for this model. Average represents steady-state load over the planning horizon and drives capacity sizing. Peak represents the busiest sustained period and drives throughput headroom. Validation: both positive, `average ≤ peak`.
- **Derived deployment readout** — each plan entry displays the deployment shape inline next to the System instances input, as muted read-only text. The format depends on whether the workspace entry uses pipeline parallelism:

  - When `pp = 1`: `→ 3× DGX H100 = 24 GPUs (TP=4, 2 instances/sys, 6 model instances)` — same as before.
  - When `pp > 1`: `→ 4× DGX H100 = 32 GPUs (TP=8 × PP=4 = 32 GPUs/instance, 1 model instance)` — multi-system spread, no per-system instance count.

  Components in either case:

  ```
  totalGPUs            = systemInstances × system.gpuCount
  gpusPerInstance      = deployment.tp × deployment.pp
  totalModelInstances  = floor(totalGPUs / gpusPerInstance)
  instancesPerSystem   = floor(system.gpuCount / deployment.tp)   (only when pp = 1)
  ```

  where `system` is the workspace entry's currently-assigned system. The plan-entry validation surfaces an error when `tp > system.gpuCount` (each pipeline stage must fit one system) or when `tp × pp > totalGPUs` (insufficient GPU pool for even one model instance).

**Average vs Peak framing** — Real inference data centres size storage for steady-state writes (Average request rate sustained over the planning horizon) and IO throughput for the busiest sustained period (Peak request rate). The Plan page captures both as a single Avg/Peak range per model. Per-bucket distribution values (context size, percentage, cache hit rate) remain single numbers because they describe workload shape, not load uncertainty. Every computed quantity that depends on the request rate is reported as `Average – Peak` (capacity, throughput, roll-ups, Graphs-page bars). When a range collapses (avg = peak), the UI shows a single value.

### Input token distribution

Each plan entry contains an editable histogram of context sizes and their relative frequency. Each distribution entry (bucket) consists of:

- **Context size** (positive integer, in tokens) — the input context length for this bucket. Must not exceed the model's effective maximum sequence length (i.e., `deployment.seqLen` if overridden, otherwise `config.max_position_embeddings`, capped by `config.sliding_window` if present).
- **Percentage** (number, 0–100) — the fraction of exchanges that fall into this bucket.
- **Cache hit rate** (number, 0–100, default 0) — the percentage of exchanges at this context size that are cache hits (reads from existing cache rather than new writes).

**Default distribution:** A new plan entry starts with a single bucket: context size = 500, percentage = 100%, cache hit rate = 0%.

**Context size presets:** The context size input in each bucket is accompanied by a row of 8 clickable preset chips to help a sales engineer reason about realistic workloads. Each chip is labeled with both the token count and a representative use case, and clicking a chip fills the context size input with that value. The user can still enter any custom value directly. The preset spread is:

| Tokens  | Label               | Use case                          |
|--------:|---------------------|-----------------------------------|
|     512 | `512 · Short Q&A`   | Single query / FAQ                |
|   2,048 | `2K · Chat`         | Standard chat turn                |
|   8,192 | `8K · Support`      | Long chat / support transcript    |
|  16,384 | `16K · Summarize`   | Document summarization            |
|  32,768 | `32K · RAG`         | Multi-doc RAG                     |
| 131,072 | `128K · Book`       | Full book / large codebase        |
| 204,800 | `200K · Agent`      | Long-context agent (Claude-class) |
| 1,048,576 | `1M · Repo`       | Frontier long-context (full repo) |

Chips whose value exceeds the model's effective maximum sequence length are rendered disabled (dimmed, not clickable) with a tooltip explaining the limit (e.g., "Exceeds model's 32K context"). This keeps the full spread visible for cross-model comparison while preventing invalid entries.

**Validation rules for the distribution:**
- The sum of all bucket percentages must equal exactly 100%. The UI displays the current sum and highlights when it does not equal 100%.
- Each context size must be a positive integer.
- Each context size must not exceed the model's maximum allowed sequence length.
- No two buckets may have the same context size.
- Cache hit rate must be between 0 and 100 inclusive.
- There must be at least one bucket. The remove button is disabled when only one bucket remains.

The user can add and remove distribution buckets via an "Add Bucket" button and a remove button on each row.

### KV cache size calculation

KV cache size is reported as an **Average–Peak range**. Both bounds are computed identically, substituting the corresponding requests/sec value. Capacity accumulates from cache misses (writes) over the planning horizon — cache hits do not add new storage.

```
horizon_seconds       = planning_horizon_days × 86400
kv_bytes_per_sequence = calculateKVCacheMemory(config, maxNumSeqs=1, promptLength=C, tensorParallel=1, bytesPerKV)

total_kv_size_{scenario} = Σ over all buckets:
    rps_{scenario} × (1 − cacheHitRate / 100) × (percentage / 100) × kv_bytes_per_sequence(contextSize) × horizon_seconds
```

- Driven by the **request rate × horizon** — capacity equals sustained writes per second multiplied by how long they are retained.
- Cache hits do **not** add storage (they re-read existing entries).
- **NOT** multiplied by server instances — shared storage holds one copy regardless of how many inference servers write to it.
- The Average bound represents storage required if Average load is sustained for the full horizon; the Peak bound represents the headroom required if Peak load were sustained for the full horizon. The latter is deliberately conservative — real systems are unlikely to hold peak load 24/7 — but it gives the customer an upper bound to size against.

Display in human-readable units (GiB or TiB as appropriate) as `Average – Peak`, e.g. `60 GiB – 240 GiB`.

### KV cache throughput calculation

Throughput is reported in three forms per direction (read, write):

1. **Demand** — the uncapped request load expressed as bytes/sec.
2. **System bandwidth** — the total bandwidth available across all system instances assigned to this model.
3. **Achievable** — `min(demand, systemBandwidth)`, i.e. demand clamped to the available bandwidth.

Demand is reported as an **Average–Peak range**. Both bounds are computed identically, substituting the corresponding requests/sec value. Per-bucket cache hit rates are not part of the range (they describe workload shape, not load uncertainty).

For each bucket and each scenario:

```
bucket_requests_per_second_{scenario} = rps_{scenario} × (percentage / 100)

write_demand_{scenario} = bucket_requests_per_second_{scenario} × (1 − cacheHitRate / 100) × kv_bytes_per_sequence(contextSize)
read_demand_{scenario}  = bucket_requests_per_second_{scenario} × (cacheHitRate / 100)     × kv_bytes_per_sequence(contextSize)
```

Total demand for the model, per scenario, in GiB/s:

```
total_write_demand_GiBps_{scenario} = Σ write_demand_{scenario} across all buckets / (1024³)
total_read_demand_GiBps_{scenario}  = Σ read_demand_{scenario}  across all buckets / (1024³)
```

System bandwidth is a single number (not ranged) — neither factor depends on the rps scenario:

```
system_write_bandwidth_GiBps = systemInstances × system.writeBandwidthGiBps
system_read_bandwidth_GiBps  = systemInstances × system.readBandwidthGiBps
```

Achievable throughput, per scenario:

```
write_achievable_{scenario} = min(total_write_demand_GiBps_{scenario}, system_write_bandwidth_GiBps)
read_achievable_{scenario}  = min(total_read_demand_GiBps_{scenario},  system_read_bandwidth_GiBps)
```

A bucket-level capping note: capping is applied at the model-aggregate level, **not** per bucket. A model whose distribution mixes small and large buckets in a way that pushes one bucket past the cap is still fine as long as the model-aggregate demand stays under the system cap.

Reading and writing are independent — capping each direction does not affect the other.

### Per-model display of throughput

The plan card surfaces three values per direction. When demand fits within the cap the result is unambiguous and we collapse to two lines per direction:

```
Write throughput
  Demand:      0.5 – 5 GiB/s
  System cap:  80 GiB/s   (1× DGX H100)
```

When demand exceeds the cap on either bound, the achievable value differs from demand and we show all three lines plus a `⚠ capped` flag:

```
Write throughput   ⚠ capped on Peak
  Demand:      50 – 120 GiB/s
  System cap:  80 GiB/s   (1× DGX H100)
  Achievable:  50 – 80 GiB/s
```

Read throughput renders the same way.

- Cache misses produce **writes**; cache hits produce **reads**.
- Display each demand/achievable output as an `Average – Peak` range in GiB/s.

### Roll-up summary

Below all model entries, display an aggregate summary:

- **Total system instances** — sum of `systemInstances` grouped by system name (e.g. `2× DGX H100, 1× GB200 NVL72`).
- **Total GPUs** — sum of `systemInstances × system.gpuCount` across all plan entries. Single number.
- **Total model instances** — sum of `systemInstances × instancesPerSystem` across all plan entries. Single number.
- **Total KV cache size** — per-scenario sum across all models, displayed as `Average – Peak`.
- **Total write demand** — per-scenario sum of per-model write demand, displayed as `Average – Peak` (uncapped).
- **Total read demand** — per-scenario sum of per-model read demand, displayed as `Average – Peak` (uncapped).
- **Total system bandwidth (write / read)** — sum of per-model `system_write_bandwidth_GiBps` and `system_read_bandwidth_GiBps`. Single numbers each.
- **Total achievable write / read throughput** — per-scenario sum of per-model achievable values, displayed as `Average – Peak`. This is the **actual** delivered throughput once each model is independently capped at its own system bandwidth.
- **Capacity gap** — for each direction, `max(0, total_demand_{scenario} − total_system_bandwidth)`, displayed as `Average – Peak`. A non-zero gap means the planned fleet cannot serve the demand; this is the prompt to add system instances. When the gap is zero on both bounds the line reads `none`.

Sums are performed per-scenario (Avg-with-Avg, Peak-with-Peak). This implicitly assumes each model's load assumptions are correlated with the others — a deliberately conservative-but-wide bound appropriate for sales-conversation framing.

Capping is applied per model and then summed. The aggregate **system bandwidth total** is the sum across models, but reading the gap as "I need this much more bandwidth" only holds when the customer can move bandwidth between models (e.g. by adding shared system instances). For independent dedicated fleets, the per-model capped values are the relevant numbers — that's why the per-model card surfaces them too.

### Calculation details toggle

A "Show calculation details" checkbox appears between the model cards and the roll-up summary. When enabled, each model card and the roll-up display additional detail breakdowns intended to let a reader (typically a sales engineer in conversation with a customer) audit every headline KV-cache and throughput range back to the inputs that produced it. The breakdowns deliberately do not re-derive architectural details (number of layers, heads, etc.) — those live on the Model Details page. The reader is assumed to trust the per-sequence KV cache size for each model and to be auditing only how the plan inputs compose into the aggregate.

Because every headline number is a range, the details views render the Average and Peak cases in parallel: one line for each scenario in the preambles, and range cells (`Average – Peak`) in the bucket tables.

**Per-model details** show, in this order:

1. **KV cache size derivation** — a preamble that substitutes the planning horizon and per-scenario rates explicitly:

   ```
   horizon_seconds = planning_horizon_days × 86400 = 30 × 86400 = 2,592,000 seconds

   rps_avg  = 5    requests/sec
   rps_peak = 50   requests/sec
   ```

   followed by the per-bucket table with columns: context size, percentage, cache hit rate, **writes/sec** (range = `rps × (1 − hit/100) × pct/100`), KV cache per sequence, **size subtotal** (range = `writes/sec × bytes × horizon_seconds`). A summary row shows the model's total KV cache size as a range.

2. **Throughput derivation** — a preamble that states the per-scenario rps and the system bandwidth that will cap demand:

   ```
   rps_avg  = 5    requests/sec
   rps_peak = 50   requests/sec
   system_write_bw = systemInstances × system.writeBandwidth = 1 × 80 = 80 GiB/s
   system_read_bw  = systemInstances × system.readBandwidth  = 1 × 60 = 60 GiB/s
   ```

   followed by the per-bucket table with columns: context size, percentage, **requests/sec** (range = `rps × pct/100`), cache hit rate, **hits/sec** (range), **misses/sec** (range), **write demand GiB/s** (range), **read demand GiB/s** (range). A summary row shows demand totals as ranges plus the achievable totals after capping. When demand exceeds the cap on either bound, that scenario's row in the summary is flagged `⚠ capped`.

Every preamble writes out the relevant input once per scenario (Average and Peak) so a customer reading over the sales engineer's shoulder can reproduce both cases.

**Roll-up details** show a per-model summary table with each model's system mix (e.g. `1× DGX H100`), GPU count, KV cache size (range), write demand (range), write achievable (range), read demand (range), read achievable (range). Totals appear in a summary row, including the capacity-gap line.

### Auto-calculation

Calculations update automatically as the user changes any input field, debounced at 200ms. The results display updates immediately without requiring a save.

### Persistence

Plan data is saved to localStorage under the key `gpu_calc_plan`. The user presses "Save" to persist current inputs. The unsaved-changes guard applies: navigating away with unsaved changes triggers the confirmation dialog.

Plan data is included in the Settings Export/Import operations. The Import confirmation dialog mentions plan data.

### Edge cases

- If a workspace model is deleted, its corresponding plan entry is removed from saved plan data on next page load.
- If a workspace model's deployment settings change (e.g., context length reduced), distribution buckets with context sizes exceeding the new maximum are flagged with a validation error on the Plan page.
- If the workspace is empty, the Plan page shows an empty state message directing the user to add models on the Home page.
- **Save is never blocked by validation issues.** A sales engineer is free to save a partial or aspirational plan (e.g. one where `TP × PP` exceeds the currently-planned system instances, or where a distribution doesn't yet sum to 100%) and revisit it later. Save persists the plan as-is. Validation errors are not stored; they are recomputed from the inputs on every render, so reopening a saved plan re-highlights the same per-card red error lines automatically. Next to the Save button, an inline status reads `⚠ N unresolved validation issue(s) — Save will persist as-is` whenever `N > 0`, so the user sees what they're carrying forward without being prevented from saving.

### Schema version

Plan data follows the general [Data versioning](#data-versioning) policy with its own version counter. The current schema introduces `systemInstances` (replacing the previous `serverInstances`) and depends on the workspace entry's assigned **system** (with bandwidth caps) rather than a bare GPU type. Both prior shapes — the un-versioned legacy plan with user-count fields, and the v2 plan that used `serverInstances` — are treated as stale schemas. On first load after upgrade, the user sees a warning toast and the plan is replaced with default entries (one per workspace model) at the current schema version.

The workspace store is also bumped, since `deployment.gpuId` is replaced by `deployment.systemId` and TP validation is now system-aware. Existing workspace data is reset on first load with a warning toast (per the Data versioning policy). Models (cached HF configs) are unaffected.


## Graphs page

The Graphs page is a dedicated top-level page accessible from the navigation bar, between Plan and References. Its purpose is to let a sales engineer visualize how a planned deployment's storage and throughput scale between Average and Peak request rates, and how wide the resulting band is. The page consumes plan data saved to `gpu_calc_plan` — it does not have its own inputs. If no plan data exists for a workspace model, the card shows an empty state directing the user to the Plan page.

### Layout

The page's first card is the **Aggregate** card, rolling up all workspace models into three range-bar charts: Total capacity, Total write throughput, Total read throughput. It is visually distinguished from the per-model cards by a 2-pixel accent-colored border (with a subtle outer halo) and a same-color title, so the headline numbers stand out as the first thing a customer sees.

Below the Aggregate card, one per-model card per workspace model appears in the same order as the Plan page. Each per-model card shows:

- The card title in the Plan-page format: `<workspace title> (TP=<tp>) on <system name>`.
- Three stacked range-bar charts: **Capacity (GiB)** on top, then **Write throughput (GiB/s)**, then **Read throughput (GiB/s)**.

### Chart form (shared)

Every chart on the Graphs page uses the same horizontal range-bar idiom:

- **Chart type:** horizontal floating-bar with `data = [[avg, peak]]`.
- **Shared x-axis scale:** all charts of the same type (capacity, write throughput, read throughput) use an identical x-axis range — computed once from the Aggregate Peak for that type, as `1.15 × Aggregate.Peak`. Per-model bars appear visually small relative to the aggregate, making cross-model comparison direct. The axis unit label is GiB for capacity and GiB/s for throughput.
- **Bar:** spans from Average to Peak, semi-transparent in the accent color.
- **Summary line:** a small centered text line *outside the canvas* (rendered as a `<div class="graphs-chart-summary">`) directly beneath each chart, reading `Avg 0.12 · Peak 0.36` (values formatted via `formatSizeHuman` for capacity or `formatThroughputHuman` for throughput). When Avg = Peak the summary collapses to the single value. Placing the summary in the DOM rather than on the canvas guarantees it never collides with the x-axis tick labels.
- **Capacity-chart caption:** beneath every capacity chart's summary line, a small muted caption shows the active planning horizon, e.g. `Sized for 30 days`. This makes the storage range's time basis visible without forcing the reader back to the Plan page.
- **No-range fallback:** when Avg = Peak the floating bar would have zero width. A minimum visible width (~1% of the shared x-axis) is drawn centered on the Avg = Peak value so the chart is never blank.

### Per-model: Capacity

The capacity chart shows the range of KV cache storage needed for this model, driven by the `requests/sec` Avg/Peak range and the global planning horizon.

- **Average** — `calculatePlanEntry` with `rps = rpsAverage` and `planningHorizonDays` substituted from the page-level input.
- **Peak** — same structure with `rps = rpsPeak`.
- **Chart title:** `Capacity`.

### Per-model: Throughput (Write and Read)

The throughput charts show the range of **demand** read/write throughput driven by the `requests/sec` Avg/Peak range, with the system bandwidth cap drawn as a vertical reference line on the same axis. Per-bucket cache hit rates are not ranged.

- **Average bar end** — `calculatePlanEntry` with `rps = rpsAverage`.
- **Peak bar end** — same with `rps = rpsPeak`.
- **System cap line** — a vertical line at `systemInstances × system.bandwidth` (write or read), drawn on top of the bar in a contrasting muted color. Sits at the same x-coordinate regardless of whether demand is below or above the cap.
- **Caption beneath the summary line** — `System cap: 80 GiB/s (1× DGX H100)`. When the demand range straddles or exceeds the cap, the caption is prefixed `⚠ capped` and the bar segment beyond the cap is rendered in a darker shade so the gap is visible at a glance.
- **Chart titles:** `Write throughput`, `Read throughput`.

The aggregate throughput charts use the **sum** of per-model demand for the bar and the **sum** of per-model system bandwidth for the cap reference line. The capacity gap surfaced on the Plan page is therefore directly readable: bar segment past the line = gap.

### Aggregate card

A single card at the **top** of the page, rolling up all workspace models. Three stacked range bars with the same form as the per-model card. Visually emphasized with an accent-colored border so it reads as the headline.

- **Total capacity** — per-scenario sum across all models: `totalAvg = Σ model.capacityAvg`, `totalPeak = Σ model.capacityPeak`. Matches the Plan-page Aggregate `Total KV cache size` range exactly. No system cap reference (capacity is unconstrained).
- **Total write throughput** — per-scenario sum of per-model write demand. The bar's vertical reference line is `Σ model.systemWriteBandwidth`. The caption reads `System cap: <total> GiB/s · gap: <range>` when the gap is non-zero, otherwise `System cap: <total> GiB/s`.
- **Total read throughput** — same structure with read values.

Sums are performed in the scenario direction (Avg-with-Avg, Peak-with-Peak). This implicitly assumes each model's load assumptions are correlated with the others — a deliberately conservative-but-wide bound appropriate for sales-conversation framing.

### Empty and edge states

- **No workspace models:** page shows empty state directing the user to the Home page to add a model.
- **No plan data for a model:** that per-model card shows an empty state directing the user to the Plan page; the model is excluded from the aggregate roll-up.
- **No range (Avg = Peak):** range bars collapse to their minimum visible width; the summary line continues to show `Avg X · Peak X` so the value is readable.