# Myo: Local AI Developer Companion

Myo is a lightweight, local-first developer companion for Visual Studio Code. Powered by **Ollama** and local LLMs (such as `llama3.1:8b`), Myo helps you streamline your software design process by generating lean user stories, drafting Architectural Decision Records (ADRs) directly from your code, and automatically visualizing your workspace architecture with C4 system context diagrams.

Built with a modular monorepo structure, Myo separates core orchestration logic from VS Code specific APIs, guaranteeing strict isolation and enabling reliable execution.

---

## ⚡ Features

### 1. Lean User Story Generator
Turn rough, unstructured feature ideas into clean, actionable, and industry-standard user stories.
- **How it works:** Run the command, type your rough idea (e.g. *"A dark mode toggle in the settings menu"*), and get a clean list of stories formatted as:
  ```markdown
  As a [user role],
  I want to [action/goal],
  So that [benefit/value]
  ```

### 2. Guarded ADR Drafter (Architectural Decision Records)
Draft structured ADRs based on highlighted code blocks or custom instructions.
- **How it works:** Highlight a section of code or press the command to document a technical choice.
- **Resilience:** Built using **Application-Layer Guardrails (Zod validation)**. If the LLM generates preambles, conversational filler, or formatting noise, the parser isolates and enforces the schema structure, failing gracefully or falling back without crashing.
- **Output:** Automatically creates a markdown document formatted with:
  - Title, Date, and Status
  - Decision Context
  - Selected Decision
  - Positive Consequences & Trade-offs (Negative Consequences)

### 3. C4 System Context Diagrams via Mermaid.js
Scan your workspace structure and analyze dependencies to construct a high-level system boundary diagram.
- **How it works:** Scans `package.json` manifests and folders to build a prompt representing the workspace context.
- **Visualization:** Resolves relationships and constructs custom-styled **Mermaid.js** flowchart diagrams (class-defined actors, systems, and databases/APIs) renderable directly in VS Code's Markdown Preview.

### 4. Just-In-Time (JIT) Swapping & Zero Keep-Alive
Designed to run efficiently on consumer-grade hardware.
- **Resource Management:** Automatically checks Ollama's active models. If another model is active, it unloads it to clear space.
- **Memory Flushing:** Utilizes a strict "Zero Keep-Alive" policy (`"keep_alive": 0`), forcing Ollama to unload the model from VRAM/RAM immediately after token generation finishes. This prevents system thrashing or Out-Of-Memory (OOM) failures when switching between specialized models.

---

## ⚙️ Extension Settings

Configure the Ollama integration under VS Code Settings or add these properties to your global `settings.json`:

* `myo.ollama.url`: The base URL of your local Ollama server.
  - *Default:* `http://localhost:11434`
* `myo.ollama.model`: The Ollama model to use for chat and generation.
  - *Default:* `llama3.1:8b` (Recommended models: `llama3.1`, `qwen2.5-coder`)

---

## 🚀 Getting Started

1. **Install and run Ollama** locally. (Visit [ollama.com](https://ollama.com))
2. **Download your target model** (e.g., Llama 3.1):
   ```bash
   ollama pull llama3.1:8b
   ```
3. Open a project workspace in VS Code.
4. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for **Myo** commands:
   - `Myo: Generate Lean User Stories`
   - `Myo: Generate ADR Draft`
   - `Myo: Generate C4 Diagram`

---

## 🏗️ Architecture

Myo uses native NPM workspaces to enforce decoupling of domain layers:
- `@myo/core`: A pure TypeScript/Node package handling raw model prompts, regex fenced-content extraction, schema parsing with Zod, and Ollama JIT memory management.
- `myo-vs-code` (vscode-wrapper): The extension entry point managing command registrations, file workspaces, status notification progress, and new document views.

