export interface LeanUserStoriesOptions {
	baseUrl?: string;
	model?: string;
}

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
