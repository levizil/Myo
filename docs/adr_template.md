# ADR [Number]: [Short, descriptive title - e.g., Use Regex and Fenced JSON for Model Output]

**Date:** [YYYY-MM-DD]  
**Status:** [Proposed | Accepted | Superseded | Deprecated]  

## Context
[Describe the problem you are solving and the constraints you are working under. Why is a decision needed right now? What are the limitations of the current system or the tools available? Keep it to 2-3 sentences. 
*Example: We are using 8B parameter models which struggle with strict JSON schemas, leading to generation failures and increased latency.*]

## Decision
[State the exact technical choice you made. Be definitive.
*Example: We will prompt the LLM to output natural markdown and wrap any required structured data in standard ` ```json ` fences, which we will extract using Regex before validation.*]

## Consequences
[What happens because of this decision? This is the most important section for an engineering portfolio.]

**Positive:**
* [Benefit 1: e.g., Lower cognitive load on the LLM.]
* [Benefit 2: e.g., Degrades gracefully to readable text in the VS Code Webview if parsing fails.]

**Negative/Trade-offs:**
* [Trade-off 1: e.g., Requires an additional Regex parsing step in the orchestrator.]
* [Trade-off 2: e.g., We must implement Zod validation post-extraction to guarantee schema adherence.]