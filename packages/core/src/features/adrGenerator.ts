import { unloadOllamaModel } from '../clients/ollama';
import { extractJsonFromMarkdown } from '../utils/markdown';
import { AdrData, AdrSchema } from '../schemas/adr';
import { LeanUserStoriesOptions } from './leanStories';

/**
 * Drafts an Architectural Decision Record (ADR) explaining a highlighted code block.
 * Enforces JIT memory manager and Zero Keep-Alive policies.
 * Returns the structured ADR JSON output parsed and validated with Zod.
 * @param code Highlighted code snippet
 * @param instruction Developer's optional prompt context
 * @param options Host configurations (baseUrl and model)
 */
export async function generateAdrFromCode(
	code: string,
	instruction: string,
	options?: LeanUserStoriesOptions
): Promise<AdrData> {
	const baseUrl = options?.baseUrl || 'http://localhost:11434';
	const model = options?.model || 'llama3.1:8b';

	// JIT Memory Management
	try {
		const psResponse = await fetch(`${baseUrl}/api/ps`);
		if (psResponse.ok) {
			const psData = await psResponse.json() as { models?: { name: string }[] };
			const loadedModels = psData.models || [];
			for (const loadedModel of loadedModels) {
				const normalizedLoaded = loadedModel.name.replace(':latest', '');
				const normalizedTarget = model.replace(':latest', '');
				if (normalizedLoaded !== normalizedTarget && loadedModel.name !== model) {
					console.log(`JIT Memory Manager: Unloading conflicting model "${loadedModel.name}" to load target "${model}"`);
					await unloadOllamaModel(loadedModel.name, baseUrl);
				}
			}
		}
	} catch (psError: any) {
		console.warn('JIT Memory Manager: Failed to query loaded models:', psError.message);
	}

	let systemPrompt = '';
	if (code && code.trim()) {
		systemPrompt = `You are a technical lead and architect. Draft an Architectural Decision Record (ADR) explaining the design pattern and choice represented in the highlighted code snippet, taking into consideration the developer's instructions.
You must output ONLY a standard JSON object inside standard triple-backtick Markdown fences (eg: \`\`\`json { ... } \`\`\`).
No preambles, no introductions, no explanations, no text before or after the JSON fences.

The JSON structure must match the following schema:
{
	"title": "A short, descriptive title",
	"context": "Context explaining the problem and why a decision was needed.",
	"decision": "The exact technical decision made.",
	"consequences": {
		"positive": ["Benefit 1", "Benefit 2"],
		"negative": ["Trade-off 1", "Trade-off 2"]
	}
}`;
	} else {
		systemPrompt = `You are a technical lead and architect. Draft an Architectural Decision Record (ADR) explaining the design pattern and choice described in the developer's instructions.
You must output ONLY a standard JSON object inside standard triple-backtick Markdown fences (eg: \`\`\`json { ... } \`\`\`).
No preambles, no introductions, no explanations, no text before or after the JSON fences.

The JSON structure must match the following schema:
{
	"title": "A short, descriptive title",
	"context": "Context explaining the problem and why a decision was needed.",
	"decision": "The exact technical decision made.",
	"consequences": {
		"positive": ["Benefit 1", "Benefit 2"],
		"negative": ["Trade-off 1", "Trade-off 2"]
	}
}`;
	}

	let userPrompt = '';
	if (code && code.trim()) {
		userPrompt = `Code block:
\`\`\`typescript
${code}
\`\`\`

Instructions:
${instruction || 'Explain the technical choices in the code.'}`;
	} else {
		userPrompt = `Instructions:
${instruction || 'Explain the technical choices.'}`;
	}

	const response = await fetch(`${baseUrl}/api/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			stream: false,
			keep_alive: 0 // Zero Keep-Alive Policy
		})
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
	}

	const data = await response.json() as {
		message?: {
			content?: string;
		};
	};

	const responseText = data.message?.content;
	if (!responseText) {
		throw new Error('Received empty response from Ollama.');
	}

	const jsonText = extractJsonFromMarkdown(responseText);

	// Parse and Validate (ADR 003)
	try {
		const rawObj = JSON.parse(jsonText);
		return AdrSchema.parse(rawObj);
	} catch (parseError: any) {
		// If parsing fails, see if the raw response text can be parsed directly as a fallback
		if (jsonText !== responseText.trim()) {
			try {
				const rawParsedFallback = JSON.parse(responseText.trim());
				return AdrSchema.parse(rawParsedFallback);
			} catch (e) {
				// Fall through to throw validation error
			}
		}
		throw new Error(`ADR schema validation failed: ${parseError.message}`);
	}
}
