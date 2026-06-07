import { unloadOllamaModel } from '../clients/ollama';
import { extractJsonFromMarkdown } from '../utils/markdown';
import { UserStoryData, UserStoriesSchema } from '../schemas/userStory';
import { GitHubClient } from '../clients/github';

export interface LeanUserStoriesOptions {
	baseUrl?: string;
	model?: string;
	githubToken?: string;
	githubOwner?: string;
	githubProjectNumber?: number;
}

/**
 * Resiliently parses a fenced JSON block containing Lean User Stories,
 * validates it with Zod, and formats it as a Markdown string.
 * @param text Raw response text containing a fenced JSON array
 */
export function parseLeanUserStories(text: string): string {
	const jsonText = extractJsonFromMarkdown(text);
	let stories: UserStoryData[] = [];
	try {
		const rawObj = JSON.parse(jsonText);
		stories = UserStoriesSchema.parse(rawObj);
	} catch (parseError: any) {
		if (jsonText !== text.trim()) {
			try {
				const rawParsedFallback = JSON.parse(text.trim());
				stories = UserStoriesSchema.parse(rawParsedFallback);
			} catch (e) {
				throw new Error(`User stories schema validation failed: ${parseError.message}`);
			}
		} else {
			throw new Error(`User stories schema validation failed: ${parseError.message}`);
		}
	}

	return stories.map(story => {
		return `As a ${story.role},\nI want to ${story.action},\nSo that ${story.value}`;
	}).join('\n\n').trim();
}

/**
 * Parses user stories from markdown text back into structured objects.
 */
export function parseLeanUserStoriesFromMarkdown(content: string): UserStoryData[] {
	const regex = /As an?\s+(.+?)(?:,|\s*)\n\s*I want to\s+(.+?)(?:,|\s*)\n\s*So that\s+(.+?)(?=\r?\n\s*\r?\n|\s*$|\s*As an?\s)/gi;
	const stories: UserStoryData[] = [];
	let match;
	regex.lastIndex = 0;
	while ((match = regex.exec(content)) !== null) {
		const role = match[1].trim();
		const action = match[2].trim();
		const value = match[3].trim();
		if (role && action && value) {
			stories.push({ role, action, value });
		}
	}
	return stories;
}

/**
 * Sends a feature idea to local Ollama API to generate formatted Lean user stories.
 * Enforces JIT memory management by checking running models and unloading conflicts,
 * and applying a zero-keep-alive policy.
 * @param featureIdea Rough description of the feature
 * @param options Host configurations (baseUrl and model) and GitHub integration parameters
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

	// Fetch Icebox context if configured
	let iceboxPrompt = '';
	if (options?.githubToken && options?.githubOwner && options?.githubProjectNumber !== undefined) {
		try {
			const client = new GitHubClient(options.githubToken);
			const items = await client.fetchIceboxItems(options.githubOwner, options.githubProjectNumber);
			if (items.length > 0) {
				iceboxPrompt = `\n\nHere are existing items from the Icebox column of our project board:
${items.map(item => `- Title: ${item.title}\n  Description: ${item.body}`).join('\n')}

Use these existing items as context to avoid duplicates, build upon existing ideas, or maintain consistency.`;
			}
		} catch (githubError: any) {
			console.warn('Failed to fetch Icebox items for context:', githubError.message);
		}
	}

	const systemPrompt = `You are a professional product manager assistant. Convert the given rough feature idea into properly formatted Lean user stories.
You must output ONLY a standard JSON array inside standard triple-backtick Markdown fences (eg: \`\`\`json [ ... ] \`\`\`).
No preambles, no introductions, no explanations, no text before or after the JSON fences.

Each object in the JSON array must strictly follow this schema:
{
	"role": "the role/user type",
	"action": "the action/goal",
	"value": "the benefit/value"
}${iceboxPrompt}`;

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

	return parseLeanUserStories(result);
}
