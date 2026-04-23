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

**Export** saves a JSON file containing the workspace (working models with their configs and deployment settings), GPU profiles, cached model configs, and plan data. The HuggingFace token is excluded from the export for security.

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
- **Total users** (positive integer, default 100) — the total number of users who have stored KV caches for this model.
- **Concurrent users** (*triple*: low / expected / high, each a positive integer; expected default 10) — the number of users actively using the model at any given moment. Must be less than or equal to total users. The Plan page's headline KV-cache and throughput calculations use the **Expected** value. Low and High values are only consulted by the Graphs page. Default values for Low and High are equal to Expected (i.e. no uncertainty until the user widens the range).
- **Stored exchanges per user** (positive integer, default 50) — the number of distinct input contexts (exchanges) stored per user. For chat applications this might be ~50; for coding agents ~200. This drives the size calculation.
- **Exchange rate per hour** (*triple*: low / expected / high, each a positive number; expected default 10) — the number of new exchanges generated per concurrent user per hour. Same Expected-drives-Plan-page, triple-drives-Graphs rule applies.
- **Derived GPU count** — Each plan entry displays the total number of GPUs the planned deployment represents, calculated as:

  ```
  gpus = serverInstances × deployment.tp
  ```

  where `deployment.tp` is the tensor-parallel value configured on the model's Model Details page (default 1). The derived value is shown inline next to the Server instances input as muted read-only text (e.g. `→ 80 GPUs (TP=8)`), and updates automatically whenever the server-instance count changes on the Plan page or the tensor-parallel setting is changed on the Model Details page. The value is read-only — it can only be influenced by editing its two inputs. For models deployed at TP=1, the readout shows just the GPU count (e.g. `→ 1 GPUs`).

**Scenario triples** — Selected fuzzy inputs (*Concurrent users*, *Exchange rate per hour*) are captured as `{low, expected, high}` triples rather than single numbers. The Plan page's headline computations and the Calculation details view continue to use only the Expected value, preserving current behavior. The Graphs page consumes the triples to render cones of uncertainty. Validation: `low ≤ expected ≤ high` for each triple, all values positive.

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

KV cache size represents the total storage required on the shared storage system to hold all cached contexts. It is based on **total users** (not concurrent), because every user's context must be stored regardless of whether they are active.

For a single bucket with context size `C` and percentage `P`:

```
kv_bytes_per_sequence = calculateKVCacheMemory(config, maxNumSeqs=1, promptLength=C, tensorParallel=1, bytesPerKV)
```

This uses the existing KV cache calculation with tensor parallelism = 1 to get the aggregate (not per-rank) cache size per sequence.

Total KV cache size for the model:

```
total_kv_size = Σ over all buckets:
    totalUsers × exchangesPerUser × (percentage / 100) × kv_bytes_per_sequence(contextSize)
```

- Based on **total users** — all contexts are stored
- **NOT** multiplied by server instances — shared storage holds one copy
- Cache hit rates do **not** affect the size calculation

Display in human-readable units (GiB or TiB as appropriate).

### KV cache throughput calculation

Throughput represents the rate of IO operations (reads and writes) to the shared storage system, in GiB/s. It is based on **concurrent users** and **server instances**.

For each bucket:

```
exchange_rate_per_second = exchangeRatePerHour / 3600

bucket_exchanges_per_second = serverInstances × concurrentUsers × exchange_rate_per_second × (percentage / 100)

write_throughput = bucket_exchanges_per_second × (1 - cacheHitRate / 100) × kv_bytes_per_sequence(contextSize)
read_throughput  = bucket_exchanges_per_second × (cacheHitRate / 100) × kv_bytes_per_sequence(contextSize)
```

Total throughput for the model:

```
total_write_GiBps = Σ write_throughput across all buckets / (1024³)
total_read_GiBps  = Σ read_throughput across all buckets / (1024³)
```

- Based on **concurrent users** — only active users generate IO
- **Multiplied by server instances** — each instance generates IO to the shared storage independently
- Cache misses produce **writes**; cache hits produce **reads**
- Display in GiB/s

### Roll-up summary

Below all model entries, display an aggregate summary:

- **Total GPUs** — sum of `serverInstances × deployment.tp` across all plan entries. Represents the total GPU footprint of the planned deployment. Shown alongside the existing aggregate KV-cache-size and throughput figures.
- **Total KV cache size** — sum of all models' KV cache sizes
- **Total write throughput** — sum of all models' write throughput (GiB/s)
- **Total read throughput** — sum of all models' read throughput (GiB/s)

### Calculation details toggle

A "Show calculation details" checkbox appears between the model cards and the roll-up summary. When enabled, each model card and the roll-up display additional detail breakdowns intended to let a reader (typically a sales engineer in conversation with a customer) audit every headline KV-cache and throughput number back to the inputs that produced it. The breakdowns deliberately do not re-derive architectural details (number of layers, heads, etc.) — those live on the Model Details page. The reader is assumed to trust the per-sequence KV cache size for each model and to be auditing only how the plan inputs compose into the aggregate.

**Per-model details** show, in this order:

1. **KV cache size derivation** — a three-line preamble written out with the actual plan inputs substituted:

   ```
   total_exchanges = totalUsers × exchangesPerUser
                   = 100 × 50
                   = 5,000 stored exchanges
   ```

   followed by the per-bucket table with columns: context size, percentage, exchanges, KV cache per sequence, size subtotal. A summary row shows the model's total.

2. **Throughput derivation** — a three-line preamble showing the per-second conversion with substituted values:

   ```
   aggregate_exchanges_per_sec = serverInstances × concurrentUsers × exchangeRatePerHour ÷ 3600
                               = 10 × 10 × 10 ÷ 3600
                               = 0.278 exchanges/sec
   ```

   followed by the per-bucket table with columns: context size, percentage, **exchanges/sec**, cache hit rate, **hits/sec**, **misses/sec**, write GiB/s, read GiB/s. The hits/misses columns make the cache-hit mechanism explicit — misses drive writes, hits drive reads — rather than leaving the reader to infer the split from the headline write/read values. A summary row shows totals.

Every formula preamble uses the three-line symbolic → substituted → result form so a customer reading over the sales engineer's shoulder can reproduce the math step by step.

**Roll-up details** show a per-model summary table with each model's GPU count (`serverInstances × deployment.tp`), KV cache size, write throughput, and read throughput. Totals appear in a summary row.

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

One card per workspace model, in the same order as the Plan page. Each card shows:

- The model title (matches the Plan page title).
- Two stacked line charts: **Write throughput (GiB/s)** on top, **Read throughput (GiB/s)** below, sharing the same x-axis.

### First chart: throughput vs concurrent users

- **x-axis:** concurrent users, swept from 0 to `max(1.5 × concurrentUsers.high, 20)`.
- **y-axis:** GiB/s (write or read depending on which chart).
- **Three curves per chart:**
  - **Low** — computed with `exchangeRatePerHour = exchangeRatePerHourLow`, per-bucket cacheHitRate unchanged.
  - **Expected** — computed with `exchangeRatePerHour = exchangeRatePerHourExpected`, per-bucket cacheHitRate unchanged. Drawn as a solid line.
  - **High** — computed with `exchangeRatePerHour = exchangeRatePerHourHigh`, per-bucket cacheHitRate unchanged.
- **Cone shading:** filled area between the Low and High curves, semi-transparent, same color family as the Expected line.
- **Vertical markers:** three dashed vertical lines at x = `concurrentUsersLow`, `concurrentUsersExpected`, `concurrentUsersHigh`. Marker at Expected is slightly darker.

### Empty and edge states

- **No workspace models:** page shows empty state directing the user to the Home page to add a model.
- **No plan data for a model:** card shows empty state directing the user to the Plan page.
- **All three triple values equal (no uncertainty):** the cone collapses to a single line — the Expected curve. Low and High lines overlap the Expected line. This is the no-uncertainty default and must render cleanly.