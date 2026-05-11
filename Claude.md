# Project: Inference Calculator

## Requirements

The requirements are elaborated in docs/requirements.md

When we add new features to the application, update the appropraite requirements file(s) to keep them in sync with the functionality.


## Architecture

This application is intended to be run from a browser with no backend.

It uses local storage in the browser.

We expect an Internet connection for access to Hugging Face and to download other browser-based dependencies.


## Testing

The calculation algorithms in `calculator.js` (and the field-normalization layer in `models.js`) are quality-checked against an authoritative model fixture suite under `test/`. Every fixture is a verbatim snapshot of a model's HuggingFace `config.json` paired with the published total and active parameter counts from the model card or technical report, plus a citation URL and snapshot date.

Run the suite with:

```
node test/check-math.js
```

The runner pushes each fixture's HF config through the same `normalizeModelConfig` the browser uses, computes `calculateModelParameters`, and compares against the published numbers within a per-fixture tolerance. It exits non-zero on any regression and prints, per fixture, the got/expected/delta along with the citation so a failure is self-explanatory.

### Coverage requirement

The fixture set must include at least one model from each architectural family below so that any change to the math is exercised against modern sophistication. Adding a new family means adding a new fixture.

- A dense GQA baseline with untied embeddings (e.g. Llama-3.1-8B-Instruct).
- A large dense GQA model where embedding/head are negligible relative to layers (e.g. Llama-3.1-70B-Instruct).
- A dense model carrying a `sliding_window` field (e.g. Qwen2.5-7B-Instruct).
- A Mixtral-style MoE where `intermediate_size` is the per-expert width (e.g. Mixtral-8x7B-Instruct-v0.1).
- A DeepSeek-style MoE combining shared experts, a dense prefix (`first_k_dense_replace`), and MTP modules (e.g. DeepSeek-V3 — note the MLA caveat under `docs/requirements.md` "Known limitations").
- A MiniMax-style MoE with a very large routed-expert pool (e.g. MiniMax-M2).

### When to run it

Run the suite after any edit to `calculator.js`, `models.js`, or any file under `test/`. If a fixture fails, resolve it in one of these ways — **never** silently widen tolerance to mask a regression:

1. The fix is the calculator. Identify the bug, repair the math, and re-run.
2. The published numbers changed. Re-snapshot the fixture from its citation URL, update `snapshotDate`, and update the expected values.
3. The discrepancy is structural and intentional (e.g. MLA attention not yet supported). Document the gap in `docs/requirements.md` under "Known limitations" and widen the fixture's `tolerancePct` with an inline comment that names the source of the gap and what would close it.

### Adding a new fixture

1. Copy the model's `config.json` fields verbatim into a new fixture entry — do not rename, simplify, or reformat. The fixture is also a regression test for `normalizeModelConfig`.
2. Record the citation URL (the HF blob URL of the config) and the snapshot date.
3. Source expected total and active parameter counts from the model card, technical report, or a primary blog post — not a third-party summary.
4. Choose `tolerancePct` based on the architecture's match to the calculator's assumptions: ±3% for standard MHA/GQA dense or MoE; ±5% if the published number is rounded; widen with a written note when an architectural feature isn't yet modelled.
