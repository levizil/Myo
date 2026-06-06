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