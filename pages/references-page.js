// ---------------------------------------------------------------------------
// References page: curated bibliography for defending sizing assumptions
// (context-length workload presets, KV-cache behavior, inference sizing)
// ---------------------------------------------------------------------------

const REFERENCE_SECTIONS = [
    {
        heading: 'Long-context evaluation benchmarks',
        entries: [
            {
                title: "RULER: What's the Real Context Size of Your Long-Context Language Models?",
                authors: 'Hsieh, Sun, Kriman, Acharya, Rekesh, Jia, Zhang, Ginsburg (NVIDIA)',
                venue: 'COLM 2024',
                url: 'https://arxiv.org/abs/2404.06654',
                note: 'Evaluates 17 long-context LLMs at 4K / 8K / 16K / 32K / 64K / 128K across 13 task categories. Headline finding: of models claiming 32K+ context, only half maintain satisfactory performance at 32K. The standard peer-reviewed yardstick for choosing a realistic context tier.'
            },
            {
                title: 'LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding',
                authors: 'Bai, Lv, Zhang, Lyu, et al. (Tsinghua)',
                venue: 'ACL 2024',
                url: 'https://arxiv.org/abs/2308.14508',
                note: '21 datasets across 6 task categories (single-doc QA, multi-doc QA, summarization, few-shot, synthetic, code). Avg length ~6,700 words (~9K tokens). Closest thing to a use-case-to-length reference table in the academic literature.'
            },
            {
                title: 'Lost in the Middle: How Language Models Use Long Contexts',
                authors: 'Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni, Liang',
                venue: 'TACL 2024',
                url: 'https://arxiv.org/abs/2307.03172',
                note: 'Shows retrieval accuracy degrades when relevant information sits in the middle of a long context, even for explicitly long-context models. Supports the argument for matching workload to effective (not advertised) context length.'
            }
        ]
    },
    {
        heading: 'Real-world inference workloads',
        entries: [
            {
                title: 'Llama 2 70B: An MLPerf Inference Benchmark for Large Language Models',
                authors: 'MLCommons',
                venue: 'MLCommons, 2024',
                url: 'https://mlcommons.org/2024/03/mlperf-llama2-70b/',
                note: 'Industry-standard LLM inference benchmark. Uses an OpenOrca-derived input distribution with sequence lengths up to 1,024 tokens and a 294-token output target. The reference workload every hyperscaler submits against — most defensible "real workload shape" citation.'
            },
            {
                title: 'MLPerf Inference — Llama 2 70B reference implementation',
                authors: 'MLCommons',
                venue: 'GitHub',
                url: 'https://github.com/mlcommons/inference/tree/master/language/llama2-70b',
                note: 'Source code and dataset processing for the MLPerf Llama 2 70B workload. Useful when a customer asks exactly how the input-length distribution is constructed.'
            }
        ]
    },
    {
        heading: 'Model capability reports',
        entries: [
            {
                title: 'Gemini 1.5: Unlocking Multimodal Understanding Across Millions of Tokens of Context',
                authors: 'Gemini Team, Google DeepMind',
                venue: 'arXiv, 2024',
                url: 'https://arxiv.org/abs/2403.05530',
                note: 'Technical report documenting 1M-token production context with tested performance up to 10M tokens, near-perfect retrieval (>99%) through 10M. Defends the upper tiers of the context-preset grid (200K, 1M).'
            }
        ]
    },
    {
        heading: 'Vendor sizing guides',
        entries: [
            {
                title: 'LLM Inference Sizing and Performance Guidance',
                authors: 'Yuankun Fu (Broadcom / VMware)',
                venue: 'VMware Cloud Foundation Blog, Sept 2024 (updated Aug 2025)',
                url: 'https://blogs.vmware.com/cloud-foundation/2024/09/25/llm-inference-sizing-and-performance-guidance/',
                note: 'End-to-end worked example for sizing vLLM/SGLang/TensorRT-LLM deployments. Uses 4,096-token "real-world average" context window (Table 5) and concrete TTFT < 200 ms / TPS ≥ 30 targets. Directly anchors the 2K–8K chat/support tiers.'
            },
            {
                title: 'Lenovo LLM Sizing Guide',
                authors: 'Lenovo Press',
                venue: 'Lenovo (local PDF)',
                url: 'docs/Lenovo LLM Sizing Guide.pdf',
                note: 'Vendor sizing guide with a worked chatbot example at 100 concurrent users and 8,000-token average context (7K input, 1K output). Direct defense of the 8K "Support" tier.'
            },
            {
                title: 'VMware LLM Inference Sizing and Performance Guidance (local archive)',
                authors: 'Yuankun Fu (Broadcom / VMware)',
                venue: 'VMware (local PDF)',
                url: 'docs/VMware LLM Inference Sizing and Performance Guidance - VMware Cloud Foundation Blog.pdf',
                note: 'Offline copy of the VMware sizing guide, bundled with the repo so the References page works without network access.'
            }
        ]
    }
];

function renderReferencesPage(container) {
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.style.cssText = 'margin: 0 0 8px; border: none; padding: 0;';
    title.textContent = 'References';
    container.appendChild(title);

    const intro = document.createElement('p');
    intro.style.cssText = 'margin: 0 0 16px; color: var(--text-muted); max-width: 780px;';
    intro.textContent =
        'Curated studies that defend the assumptions baked into this calculator — the context-length preset spread on the Plan page, the KV-cache math, and the inference-sizing rules of thumb. Each entry links to the primary source; every link has been verified.';
    container.appendChild(intro);

    for (const section of REFERENCE_SECTIONS) {
        const sectionHeading = document.createElement('h3');
        sectionHeading.textContent = section.heading;
        container.appendChild(sectionHeading);

        const list = document.createElement('div');
        list.className = 'references-list';

        for (const entry of section.entries) {
            list.appendChild(buildReferenceCard(entry));
        }

        container.appendChild(list);
    }
}

function buildReferenceCard(entry) {
    const card = document.createElement('div');
    card.className = 'reference-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'reference-title-row';

    const link = document.createElement('a');
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'reference-title';
    link.textContent = entry.title;
    titleRow.appendChild(link);

    card.appendChild(titleRow);

    const meta = document.createElement('div');
    meta.className = 'reference-meta';
    meta.textContent = `${entry.authors} · ${entry.venue}`;
    card.appendChild(meta);

    const note = document.createElement('div');
    note.className = 'reference-note';
    note.textContent = entry.note;
    card.appendChild(note);

    return card;
}
