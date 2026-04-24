# Requirements for Inference Calculator

## Architecture

### Database

Uses strictly local storage.


## General UI

This is a multi-page application with URL routing. The Browser back button should work in a predictable way.

If I navigate away from a page with unsaved changes, the application should warn me and give me the option to stay or discard changes.

### Navigation

A global menu is always visible, providing quick access to the Models page, GPUs page, Plan page, Graphs page, References page, and Settings page. The current page should be visually indicated.


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

The exported JSON contains the workspace (working models with their configs and deployment settings), GPU profiles, cached model configs, and plan data. The HuggingFace token is excluded from the export for security. If the user cancels either dialog, nothing is saved and no status message is shown.

**Import** loads a previously exported JSON file and replaces the current workspace, GPU profiles, cached model configs, and plan data. The HuggingFace token is not affected by import. The application should confirm before importing since it replaces existing data.


## Home page

### Working models

The home page shows me a list of local models I'm already working with. The list of models starts off blank and then I add the models with which I want to work. Each working model has a unique internal ID and an editable title. The title defaults to the HuggingFace model name when added but can be changed to describe a specific configuration (e.g., "Qwen/Qwen3-32B on A100" vs "Qwen/Qwen3-32B on B200"). I can add multiple instances of the same base model with different titles and different deployment settings.

The most important data to show is the size of the model weights, the size of the KV Cache, and the assigned GPU type. The KV Cache size should reflect the user's overridden context length if they've changed it, otherwise the model's default max context size. The assigned GPU name should be shown prominently in the summary table alongside weights and KV cache.

### Model titles

Model titles must be unique across the workspace. If I try to save a model with a title that already exists, the application should prevent the save and show an error. When adding a model, the title defaults to the HuggingFace model name.

### Add a model

I press Add a model to add a new model. I can pick from a list of popular models from HuggingFace — the popular list is always fully visible since the same base model can be added multiple times with different titles. If I add a model whose title already exists, the application auto-appends a number (e.g., "Qwen/Qwen3-32B (2)"). Validate the model name before trying to do calculations. Download the relevant details of the model to the local working models list. Automatically calculate the KV cache size requirements for the model.

#### Model search

Allow me to specify any part of the model name and search for matches on HuggingFace. Example: Qwen/ or Qwen/Qwen3. Show results in a dropdown list below the search input, up to 20 results maximum.

#### Popular model list

Popular models are hard coded as: Qwen/Qwen3-32B, meta-llama/Llama-3.2-1B-Instruct, meta-llama/Llama-3.1-70B-Instruct, Qwen/Qwen2.5-7B-Instruct	

When I add the model, use the default max context size from the model (`max_position_embeddings`). Allow me to override the default max context freely — for example, to extend it with rope scaling. The application should capture `sliding_window` from the HuggingFace config when available.

#### Sliding window

Some models define a `sliding_window` value in their HuggingFace config. The sliding window caps the effective KV cache size per layer — each layer only attends to the most recent `sliding_window` tokens, regardless of the full sequence length. The sliding window does **not** restrict the sequence length input; the user can set the sequence length higher than the sliding window (the model still processes the full sequence, but KV cache per layer is bounded). When present, the sliding window value should be displayed prominently in the Deployment section, labeled as a KV cache cap. For models without a sliding window (the field is absent or null), there is no KV cache cap. The KV cache calculation should use `min(sequence_length, sliding_window)` when a sliding window is defined.

### Select a model

I can select one of the models and see high level details: assigned GPU type, max context length (either default or overridden, with the model's default shown for reference), memory requirements (in GiB), KV Cache memory requirements (aggregated, even if TP>1).

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

### GPU configuration

I can select a GPU from my managed GPU list (see GPUs page). I can adjust the GPU memory utilization percentage via a slider (default 85%). The GPU section appears directly below the model title/selection area, before the deployment parameters.

### Deployment parameters

I can configure the deployment scenario for the model:

- Sequence length — shows the current working value (which may be overridden) and displays the model's default max context size for reference. When the model has a sliding window, display it and enforce it as the maximum allowed value
- Max sequences — how many concurrent sequences (default 1)
- Max batched tokens — the vLLM batched token limit (default 8192)
- Tensor parallel — number of GPUs across which the model is sharded (default 2)

### Storage

I can specify the cuFile buffer size in GB (default 2.0).

### Precision

Precision settings (bytes per weight, bytes per KV element, bytes per activation) are auto-detected from the model config. I can override them manually if needed. The UI indicates whether values are auto-detected or manually set.

### Options

I can toggle the inclusion of CUDA graphs memory and framework overhead in the calculation.

### Memory breakdown

The page shows a text report with the full GPU memory breakdown including model weights, KV cache, activations, CUDA graphs, framework overhead, cuFile buffer, and system overhead. The report updates automatically whenever any parameter changes. The report shows per-rank values when tensor parallelism is used.

### Visualization

The page shows two charts alongside the memory breakdown:

- A bar chart showing each memory component's size in GB per rank
- A stacked bar chart showing how the total GPU memory is consumed, with a dashed line marking the vLLM allocation boundary

### Export

I can copy the text report to the clipboard or download it as a text file.


## GPUs page

The GPUs page lets me manage the list of GPU profiles available throughout the application. Each GPU is stored with an internal ID so that model configurations reference GPUs stably even if a GPU is renamed.

### Default GPUs

The application ships with a pre-populated list of common GPUs:

- A100 40GB (39.6 GB usable)
- A100 80GB (79.7 GB usable)
- H100 80GB (79.7 GB usable)
- H200 94GB (93.1 GB usable)
- B300 288GB (288.0 GB usable) — NVIDIA Blackwell Ultra, HBM3e
- Vera Rubin 288GB (288.0 GB usable) — NVIDIA Rubin GPU, HBM4

On first launch, these defaults are copied into local storage. From that point on, the list is managed entirely locally. Users whose GPU list was already populated from an earlier version of the app will not automatically receive newly added defaults; they can pick them up by pressing "Reset to defaults" on the GPUs page or by adding them manually.

### GPU list

The page shows all GPUs in my local list with their name and usable memory.

### Add a GPU

I can add a new GPU profile by specifying a name and usable memory in GB.

### Edit a GPU

I can edit any GPU's name and usable memory, including the ones that shipped as defaults. I press Save to persist or Cancel to revert.

### Remove a GPU

I can remove any GPU from the list, including the defaults. The application should confirm before deleting. If a GPU is currently in use by a model's saved configuration, warn me before allowing deletion.

### Reset to defaults

I can reset the GPU list back to the application defaults. This removes any custom GPUs and restores any deleted defaults. The application should confirm before resetting.


## Plan Page

The Plan page provides capacity planning for inference workloads. It calculates aggregate KV cache storage size and IO throughput (reads and writes in GiB/s) across all workspace models. KV cache is stored on shared central storage — all inference server instances access the same storage pool. Operations are assumed to be continuous (24/7).

### Navigation

The Plan page is accessible from the global navigation bar as "Plan", alongside "Models" and "GPUs". The current page is visually indicated.

### Plan entries

The Plan page displays one row per workspace model, identified by the model's title and linked to the workspace entry by its internal ID. When a workspace model is added or removed on the Home page, the Plan page reflects this automatically: entries for deleted models are cleaned up on page load, and new models appear with default plan values.

### Per-model inputs

Each plan entry has the following editable fields:

- **Server instances** (positive integer, default 1) — the number of inference server instances running this model. This equals total GPUs divided by the model's tensor parallelism setting. More instances means more IO to the shared storage.
- **Total users** (*range*: low / high, each a positive integer; default low = high = 100) — the total number of users who have stored KV caches for this model. Every downstream number that depends on total users is computed as a range (a Low result and a High result) and displayed across the app as `Low – High`.
- **Concurrent users** (*range*: low / high, each a positive integer; default low = high = 10) — the number of users actively using the model at any given moment. Both bounds must be ≤ the corresponding Total users bound (`concurrentUsersLow ≤ totalUsersLow`, `concurrentUsersHigh ≤ totalUsersHigh`).
- **Stored exchanges per user** (*range*: low / high, each a positive integer; default low = high = 50) — the number of distinct input contexts (exchanges) stored per user. For chat applications this might be ~50; for coding agents ~200. Drives the size calculation.
- **Exchange rate per hour** (*range*: low / high, each a positive number; default low = high = 10) — the number of new exchanges generated per concurrent user per hour. Drives the throughput calculation.
- **Derived GPU count** — Each plan entry displays the total number of GPUs the planned deployment represents, calculated as:

  ```
  gpus = serverInstances × deployment.tp
  ```

  where `deployment.tp` is the tensor-parallel value configured on the model's Model Details page (default 1). The derived value is shown inline next to the Server instances input as muted read-only text (e.g. `→ 80 GPUs (TP=8)`), and updates automatically whenever the server-instance count changes on the Plan page or the tensor-parallel setting is changed on the Model Details page. The value is read-only — it can only be influenced by editing its two inputs. For models deployed at TP=1, the readout shows just the GPU count (e.g. `→ 1 GPUs`).

**Scenario ranges** — The fuzzy inputs listed above (*Total users*, *Concurrent users*, *Stored exchanges per user*, *Exchange rate per hour*) are captured as `{low, high}` ranges rather than single numbers. Per-bucket distribution values (context size, percentage, cache hit rate) remain single numbers because they describe workload shape, not scale uncertainty. Every computed quantity that depends on a range (KV cache size, throughput, roll-ups, Graphs-page bars) is also a range: the Low case substitutes every `*Low` value, the High case substitutes every `*High` value, and the output is reported as `Low – High`. Validation: `low ≤ high` for each range, all values positive; the concurrent-users range is also bounded by the total-users range at each end.

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

KV cache size is reported as a **range**. The Low bound substitutes `totalUsersLow` and `exchangesPerUserLow`; the High bound substitutes `totalUsersHigh` and `exchangesPerUserHigh`. Both bounds are computed the same way:

```
kv_bytes_per_sequence = calculateKVCacheMemory(config, maxNumSeqs=1, promptLength=C, tensorParallel=1, bytesPerKV)

total_kv_size_{bound} = Σ over all buckets:
    totalUsers_{bound} × exchangesPerUser_{bound} × (percentage / 100) × kv_bytes_per_sequence(contextSize)
```

- Based on **total users** — all contexts are stored
- **NOT** multiplied by server instances — shared storage holds one copy
- Cache hit rates do **not** affect the size calculation

Display in human-readable units (GiB or TiB as appropriate) as `Low – High`, e.g. `60 GiB – 240 GiB`.

### KV cache throughput calculation

Throughput is reported as a **range**. The Low bound substitutes `concurrentUsersLow` and `exchangeRatePerHourLow`; the High bound substitutes `concurrentUsersHigh` and `exchangeRatePerHourHigh`. Per-bucket cache hit rates are not part of the range (they describe workload shape, not uncertainty).

For each bucket and each bound:

```
exchange_rate_per_second_{bound} = exchangeRatePerHour_{bound} / 3600

bucket_exchanges_per_second_{bound} = serverInstances × concurrentUsers_{bound} × exchange_rate_per_second_{bound} × (percentage / 100)

write_throughput_{bound} = bucket_exchanges_per_second_{bound} × (1 − cacheHitRate / 100) × kv_bytes_per_sequence(contextSize)
read_throughput_{bound}  = bucket_exchanges_per_second_{bound} × (cacheHitRate / 100)     × kv_bytes_per_sequence(contextSize)
```

Total throughput range for the model:

```
total_write_GiBps_{bound} = Σ write_throughput_{bound} across all buckets / (1024³)
total_read_GiBps_{bound}  = Σ read_throughput_{bound}  across all buckets / (1024³)
```

- Based on **concurrent users** — only active users generate IO
- **Multiplied by server instances** — each instance generates IO to the shared storage independently
- Cache misses produce **writes**; cache hits produce **reads**
- Display each output as a `Low – High` range in GiB/s

### Roll-up summary

Below all model entries, display an aggregate summary:

- **Total GPUs** — sum of `serverInstances × deployment.tp` across all plan entries. A single number (not a range) because neither factor is a range input.
- **Total KV cache size** — sum of each model's Low into an aggregate Low, sum of each model's High into an aggregate High. Displayed as `Low – High`.
- **Total write throughput** — per-bound sum across all models, displayed as `Low – High`.
- **Total read throughput** — per-bound sum across all models, displayed as `Low – High`.

### Calculation details toggle

A "Show calculation details" checkbox appears between the model cards and the roll-up summary. When enabled, each model card and the roll-up display additional detail breakdowns intended to let a reader (typically a sales engineer in conversation with a customer) audit every headline KV-cache and throughput range back to the inputs that produced it. The breakdowns deliberately do not re-derive architectural details (number of layers, heads, etc.) — those live on the Model Details page. The reader is assumed to trust the per-sequence KV cache size for each model and to be auditing only how the plan inputs compose into the aggregate.

Because every headline number is a range, the details views render the Low and High cases in parallel: one line for each bound in the preambles, and range cells (`Low – High`) in the bucket tables.

**Per-model details** show, in this order:

1. **KV cache size derivation** — a preamble that substitutes each bound's inputs explicitly:

   ```
   total_exchanges_low  = totalUsersLow  × exchangesPerUserLow  =  50 ×  25 = 1,250  stored exchanges
   total_exchanges_high = totalUsersHigh × exchangesPerUserHigh = 200 × 100 = 20,000 stored exchanges
   ```

   followed by the per-bucket table with columns: context size, percentage, **exchanges** (range), KV cache per sequence, **size subtotal** (range). A summary row shows the model's total KV cache size as a range.

2. **Throughput derivation** — a preamble that substitutes each bound's inputs explicitly:

   ```
   aggregate_exchanges_per_sec_low  = serverInstances × concurrentUsersLow  × exchangeRatePerHourLow  ÷ 3600
                                    = 1 × 5  × 5  ÷ 3600 = 0.007  exchanges/sec
   aggregate_exchanges_per_sec_high = serverInstances × concurrentUsersHigh × exchangeRatePerHourHigh ÷ 3600
                                    = 1 × 20 × 20 ÷ 3600 = 0.111  exchanges/sec
   ```

   followed by the per-bucket table with columns: context size, percentage, **exchanges/sec** (range), cache hit rate, **hits/sec** (range), **misses/sec** (range), **write GiB/s** (range), **read GiB/s** (range). A summary row shows totals as ranges.

Every preamble writes out the formula once per bound (Low and High) so a customer reading over the sales engineer's shoulder can reproduce both extremes.

**Roll-up details** show a per-model summary table with each model's GPU count (single number), KV cache size (range), write throughput (range), and read throughput (range). Totals appear in a summary row.

### Auto-calculation

Calculations update automatically as the user changes any input field, debounced at 200ms. The results display updates immediately without requiring a save.

### Persistence

Plan data is saved to localStorage under the key `gpu_calc_plan`. The user presses "Save" to persist current inputs. The unsaved-changes guard applies: navigating away with unsaved changes triggers the confirmation dialog.

Plan data is included in the Settings Export/Import operations. The Import confirmation dialog mentions plan data.

### Edge cases

- If a workspace model is deleted, its corresponding plan entry is removed from saved plan data on next page load.
- If a workspace model's deployment settings change (e.g., context length reduced), distribution buckets with context sizes exceeding the new maximum are flagged with a validation error on the Plan page.
- If the workspace is empty, the Plan page shows an empty state message directing the user to add models on the Home page.
- The Save button is disabled when validation errors exist.


## Graphs page

The Graphs page is a dedicated top-level page accessible from the navigation bar, between Plan and References. Its purpose is to let a sales engineer visualize how a planned deployment's throughput scales with concurrent users and how wide the uncertainty band is. The page consumes plan data saved to `gpu_calc_plan` — it does not have its own inputs. If no plan data exists for a workspace model, the card shows an empty state directing the user to the Plan page.

### Layout

One card per workspace model, in the same order as the Plan page. Each per-model card shows:

- The model title (matches the Plan page title).
- Three stacked range-bar charts: **Capacity (GiB)** on top, then **Write throughput (GiB/s)**, then **Read throughput (GiB/s)**.

Below the per-model cards, a final **Aggregate** card rolls up all workspace models into three corresponding charts: Total capacity, Total write throughput, Total read throughput.

### Chart form (shared)

Every chart on the Graphs page uses the same horizontal range-bar idiom:

- **Chart type:** horizontal floating-bar with `data = [[low, high]]`.
- **Shared x-axis scale:** all charts of the same type (capacity, write throughput, read throughput) use an identical x-axis range — computed once from the Aggregate High for that type, as `1.15 × Aggregate.High`. Per-model bars appear visually small relative to the aggregate, making cross-model comparison direct. The axis unit label is GiB for capacity and GiB/s for throughput.
- **Bar:** spans from Low to High, semi-transparent in the accent color.
- **Summary line:** a small centered text line *outside the canvas* (rendered as a `<div class="graphs-chart-summary">`) directly beneath each chart, reading `Low 0.12 · High 0.36` (values formatted via `formatSizeHuman` for capacity or `formatThroughputHuman` for throughput). When Low = High the summary collapses to the single value. Placing the summary in the DOM rather than on the canvas guarantees it never collides with the x-axis tick labels.
- **No-range fallback:** when Low = High the floating bar would have zero width. A minimum visible width (~1% of the shared x-axis) is drawn centered on the Low = High value so the chart is never blank.

### Per-model: Capacity

The capacity chart shows the range of KV cache storage needed for this model, driven by the `totalUsers` and `exchangesPerUser` ranges.

- **Low** — `calculatePlanEntry` with `totalUsers = totalUsersLow`, `exchangesPerUser = exchangesPerUserLow`; other range inputs (concurrent users, exchange rate per hour) substitute their Low values, but those don't affect capacity anyway.
- **High** — same structure, all `*High` values.
- **Chart title:** `Capacity`.

### Per-model: Throughput (Write and Read)

The throughput charts show the range of read/write throughput driven by both the `concurrentUsers` and `exchangeRatePerHour` ranges. The Low bound uses both at their Low value; the High bound uses both at their High value. Per-bucket cache hit rates are not ranged.

- **Low** — `calculatePlanEntry` with `concurrentUsers = concurrentUsersLow`, `exchangeRatePerHour = exchangeRatePerHourLow`.
- **High** — same with `*High` values.
- **Chart titles:** `Write throughput`, `Read throughput`.

### Aggregate card

A single card at the bottom of the page, rolling up all workspace models. Three stacked range bars with the same form as the per-model card:

- **Total capacity** — per-bound sum across all models: `totalLow = Σ model.capacityLow`, `totalHigh = Σ model.capacityHigh`. Matches the Plan-page Aggregate `Total KV cache size` range exactly.
- **Total write throughput** — per-bound sum of per-model write throughput values.
- **Total read throughput** — per-bound sum of per-model read throughput values.

Sums are performed in the bound direction (low-with-low, high-with-high). This implicitly assumes each model's uncertainty is perfectly correlated with the others — a deliberately conservative-but-wide bound appropriate for sales-conversation "what-if" framing.

### Empty and edge states

- **No workspace models:** page shows empty state directing the user to the Home page to add a model.
- **No plan data for a model:** that per-model card shows an empty state directing the user to the Plan page; the model is excluded from the aggregate roll-up.
- **No range (Low = High):** range bars collapse to their minimum visible width; the summary line continues to show `Low X · High X` so the value is readable.