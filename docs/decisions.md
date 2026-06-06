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