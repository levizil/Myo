# ADR 001: Use Regex and Fenced JSON for Model Output

**Date:** 2026-06-06  
**Status:** Accepted  

## Context
Myo relies heavily on small-parameter local LLMs (specifically in the 7B-8B range). Forcing these models to output strict, raw JSON via schema enforcement or restrictive sampling often introduces massive generation latency, causes the model to hallucinate properties to satisfy the schema constraints, or triggers complete output breakdown. However, the VS Code extension engine requires deterministic, structured data to execute operations.

## Decision
We will not force the LLM to output raw JSON or use token-level JSON constraints. Instead, we will instruct the model via system prompts to use natural Markdown for explanations and wrap all structured programmatic data inside standard triple-backtick JSON code blocks (` ```json ... ``` `). The `@myo/core` package will use a regular expression to extract the fenced text block and then parse it using standard JavaScript JSON parsing followed by strict type validation.

## Consequences
**Positive:**
* Dramatically reduces cognitive load on 8B parameter models, leading to faster token generation.
* Allows the model to naturally use its pre-trained Markdown capabilities for reasoning.
* Provides a graceful degradation path: if parsing fails, the raw Markdown text can still be safely displayed to the user in the workspace.

**Negative/Trade-offs:**
* Requires an explicit regex extraction step in the orchestration layer before data processing can occur.
* Requires post-extraction schema validation (e.g., using Zod) to catch instances where the model structured the JSON incorrectly inside the fence.

---

# ADR 002: Monorepo Architecture using NPM Workspaces

**Date:** 2026-06-06
**Status:** Accepted

## Context
Myo consists of two distinct domains: the VS Code API wrapper (UI, commands, event listeners) and the core AI orchestrator (LLM interfacing, prompt building, AST parsing). Keeping these tightly coupled in a single package will make testing difficult and prevent the core logic from being reused outside of the VS Code ecosystem.

## Decision
We will utilize a monorepo structure managed by native NPM Workspaces. The project will be divided into at least two distinct packages:
* `@myo/core`: A pure TypeScript/Node.js package handling all LLM orchestration, regex extraction, and system prompts. It will have zero dependencies on the `vscode` API.
* `@myo/vscode`: The actual extension wrapper that handles user input and VS Code webviews, importing `@myo/core` as a local workspace dependency.

## Consequences
**Positive:**
* Enforces strict architectural boundaries; the core AI logic remains entirely decoupled from the IDE interface.
* Makes unit testing the `@myo/core` logic vastly easier, as it won't require a mocked VS Code extension host environment.

**Negative/Trade-offs:**
* Slightly increases initial boilerplate setup (configuring the root `package.json` workspaces array and TS project references).
* Packaging the VS Code extension for publishing requires specific build steps to ensure the workspace dependencies are bundled correctly.

---

# ADR 003: Structure Inversion via Application-Layer Guardrails

**Date:** 2026-06-06  
**Status:** Accepted  

## Context
When integrating LLMs into software development workflows, a common failure mode is attempting to force the model to guarantee syntactical correctness at the generation layer. For 8B parameter models, enforcing rigid programmatic output schemas natively inside the model's generation window consumes high computational overhead, restricts semantic depth, and introduces brittle failure vectors. If the model misses a single closing bracket, the entire orchestration sequence breaks down.

## Decision
We will invert the structural responsibility. We will treat the LLM as an unpredictable, completely untrusted natural-language generator that produces raw markdown text. The application runtime (`@myo/core`) will bear 100% of the structural enforcement responsibility through a strict, multi-tiered defensive barrier:
1.  **Isolation:** A deterministic regex pattern match locates and isolates programmatic content fences.
2.  **Parsing:** The isolated content is safely passed through standard JavaScript serialization checks (`JSON.parse`).
3.  **Guards:** A deterministic validation schema (using Zod) strictly enforces properties, types, and shape requirements.

The application layer will dictate whether the data structure is sound; the model is simply asked to populate the fields.

## Consequences
**Positive:**
* **Resilience:** If the LLM generates conversational conversational filler, preambles, or formatting noise outside the fences, the core engine safely ignores it without throwing runtime errors.
* **Predictable Error Handling:** Invalid structures are caught instantly at the type-validation step, allowing the orchestrator to fire fallback loops or request a regeneration deterministically.
* **Performance:** Offloading schema-compliance thinking from the 8B model minimizes execution latency and maximizes prompt execution speed.

**Negative/Trade-offs:**
* Increases the code footprint inside `@myo/core`, requiring explicit runtime definitions for every schema layout alongside our system prompts.
* Shakes off runtime errors but shifts the burden to the UI layer to cleanly communicate validation failures to the user if a fallback cannot resolve the mismatch.

---

# ADR 004: Just-In-Time (JIT) Model Swapping and Zero Keep-Alive

**Date:** 2026-06-06  
**Status:** Accepted  

## Context
Myo's long-term roadmap includes multi-step agentic workflows (e.g., Plan $\rightarrow$ Code $\rightarrow$ Heal loops) that require specialized local models (such as Llama3.1-8b for reasoning and Qwen2.5-coder-7b for execution). Consumer hardware imposes strict memory bottlenecks; loading two 7B+ parameter models simultaneously into RAM/VRAM will cause Out-Of-Memory (OOM) crashes or severe system thrashing. By default, Ollama keeps models hot in memory for 5 minutes after a request, which blocks the pipeline from loading the next required model.

## Decision
The `@myo/core` orchestrator will act as a Just-In-Time (JIT) memory manager, utilizing a strict "Zero Keep-Alive" policy for pipeline handoffs. When executing multi-model loops, the core orchestrator will append `"keep_alive": 0` to the inference payload for intermediate steps. This forces Ollama to instantly flush the current model from memory the moment token generation completes, guaranteeing the hardware is clear to load the subsequent model in the chain.

## Consequences
**Positive:**
* **Pipeline Viability:** Unlocks the ability to run complex, multi-agent orchestration loops entirely locally on standard consumer hardware.
* **System Stability:** Eliminates OOM crashes caused by overlapping model footprints.
* **Predictable State:** The orchestrator maintains deterministic control over the host machine's memory utilization.

**Negative/Trade-offs:**
* **Handoff Latency:** Introduces unavoidable "Cold Start" delays (5-15 seconds) *during* the execution pipeline while the system swaps models from disk to memory.
* **UX Impact:** Requires the VS Code UI (`@myo/vscode`) to handle longer, multi-stage loading states gracefully so the user does not assume the extension has frozen during a model swap.

---

Here are the next Architecture Decision Records (ADRs 005–007) based on the structural, storage, and orchestration strategies we established for the Myo project. They follow your exact template format and threshold logic.

# ADR 005: AST Skeleton Extraction (B.O.N.E.S.) for LLM Context

**Date:** 2026-06-08
**Status:** Proposed

## Context

Feeding raw, multi-file source code to an 8B parameter model rapidly consumes its context window, leading to "context collapse" where the model forgets instructions or hallucinates logic. We need a way to provide the model with deep workspace awareness (dependencies, interfaces, neighbors) without the crippling token bloat of raw implementation details.

## Decision

We will use `tree-sitter` to parse the Abstract Syntax Tree (AST) of workspace files and extract purely structural skeletons (B.O.N.E.S.). Before passing context to the LLM, the `@myo/core` engine will elide all internal function block logic, retaining only exports, function signatures, types, and docstrings.

## Consequences

**Positive:**

* Dramatically reduces token payload, maximizing the 8B model's attention span for the actual execution logic.
* Offloads the heavy lifting of workspace routing from the probabilistic LLM to deterministic tooling.

**Negative/Trade-offs:**

* Requires shipping and managing `tree-sitter` WebAssembly bindings within the Antigravity IDE environment.
* The model operates completely blind to the internal logic of sibling functions, requiring docstrings or descriptive signatures to be well-maintained by the developer.

---

# ADR 006: In-Memory Semantic Indexing via Local Vectors (L.I.T.E.)

**Date:** 2026-06-08
**Status:** Proposed

## Context

Attempting to use an 8B LLM to sequentially evaluate files for semantic relevance ("LLM-in-the-loop" search) causes unacceptable latency and single-threaded compute bottlenecks. We need a way to instantly find semantically relevant functions across the workspace without spinning up external database servers or exceeding the 8GB VRAM ceiling.

## Decision

We will implement an embedded Retrieval-Augmented Generation (RAG) pipeline utilizing LanceDB and `@xenova/transformers.js`. The extension will use a tiny, CPU-bound quantized model to translate AST skeletons into vector embeddings. These vectors will be persisted locally to a hidden `.myo/vector_store` directory at the workspace root, which is automatically appended to the user's `.gitignore`.

## Consequences

**Positive:**

* Achieves lightning-fast semantic search (milliseconds) without consuming any VRAM or conflicting with Ollama's model footprint.
* Serverless architecture perfectly respects the local-first, zero-configuration philosophy of the extension.

**Negative/Trade-offs:**

* Adds native Node.js dependencies (`vectordb`, Wasm models) which require careful build-step configuration to bundle correctly within the monorepo architecture.
* Occupies a small amount of disk space in the user's local project directory.

---

# ADR 007: Event-Driven Vector Cache Invalidation (E.C.H.O.)

**Date:** 2026-06-08
**Status:** Proposed

## Context

As the user develops, the local vector database will quickly become stale, pointing the LLM toward outdated AST skeletons or deleted functions. Polling the entire workspace filesystem to rebuild the index is computationally wasteful and creates unresponsive UI experiences.

## Decision

We will strictly hook into the extension host's native file lifecycle events (`vscode.workspace.onDidSaveTextDocument`) to manage cache invalidation. Upon save, the extension will parse only the modified file, generate new embeddings, and perform a direct database Upsert or Delete using a deterministic string hash (`filePath::symbolName`) as the primary key. Implementation note: the event listener lives strictly in @myo/vscode package and delegates to a generic API in @my/core

## Consequences

**Positive:**

* Guarantees the semantic vector index remains perfectly synchronized with the workspace state with zero manual intervention or background polling.
* CPU cost is amortized across natural file-save events rather than batched in massive indexing sweeps.

**Negative/Trade-offs:**

* Requires strict adherence to deterministic ID generation; a bug in the hashing logic will result in orphaned or duplicated vectors silently polluting the LanceDB tables.