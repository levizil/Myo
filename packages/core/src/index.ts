export interface LeanUserStoriesOptions {
	baseUrl?: string;
	model?: string;
}

/**
 * Sends a feature idea to local Ollama API to generate formatted Lean user stories.
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
			stream: false
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
