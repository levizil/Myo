import { z } from 'zod';

export interface LeanUserStoriesOptions {
	baseUrl?: string;
	model?: string;
}

// ADR validation schema (ADR 003)
export const AdrSchema = z.object({
	title: z.string(),
	context: z.string(),
	decision: z.string(),
	consequences: z.object({
		positive: z.array(z.string()),
		negative: z.array(z.string())
	})
});

export type AdrData = z.infer<typeof AdrSchema>;

/**
 * Unloads a model from Ollama's memory immediately.
 * @param modelName Name of the model to unload
 * @param baseUrl Base URL of the Ollama server
 */
export async function unloadOllamaModel(
	modelName: string,
	baseUrl: string = 'http://localhost:11434'
): Promise<void> {
	const response = await fetch(`${baseUrl}/api/generate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: modelName,
			prompt: '',
			keep_alive: 0
		})
	});
	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Failed to unload model "${modelName}": ${errText}`);
	}
}

/**
 * Sends a feature idea to local Ollama API to generate formatted Lean user stories.
 * Enforces JIT memory management by checking running models and unloading conflicts,
 * and applying a zero-keep-alive policy.
 * @param featureIdea Rough description of the feature
 * @param options Host configurations (baseUrl and model)
 * @returns Generated markdown content containing user stories
 */
export async function generateLeanUserStories(
	featureIdea: string,
	options?: LeanUserStoriesOptions
): Promise<string> {
	const baseUrl = options?.baseUrl || 'http://localhost:11434';
	const model = options?.model || 'llama3.1:8b';

	// JIT Memory Management: check loaded models
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
		// If Ollama is serving but doesn't support /api/ps or is offline,
		// log and allow the main request to handle the endpoint connection failure.
		console.warn('JIT Memory Manager: Failed to query loaded models:', psError.message);
	}

	const systemPrompt = `You are a professional product manager assistant. Convert the given rough feature idea into properly formatted Lean user stories.
Each user story must strictly follow the format:
As a [role],
I want to [action],
So that [value]

Acceptance Criteria:
- The output must use standard Markdown.
- Every story must strictly follow the "As... I want to... So that..." format.
- Output ONLY the Markdown stories. No preambles, no introductions, no explanations, no chat filler.`;

	const response = await fetch(`${baseUrl}/api/chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: featureIdea }
			],
			stream: false,
			keep_alive: 0 // Zero Keep-Alive Policy (ADR 004)
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

	const result = data.message?.content;
	if (!result) {
		throw new Error('Received empty response from Ollama.');
	}

	return result.trim();
}

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

/**
 * Extracts raw text from standard triple-backtick Markdown fences.
 * If no fences are detected, returns the input text trimmed.
 * @param text The input string potentially containing markdown fences
 */
export function extractJsonFromMarkdown(text: string): string {
	const match = text.match(/```json\s*([\s\S]*?)\s*```/);
	if (!match) {
		return text.trim();
	}
	return match[1].trim();
}
