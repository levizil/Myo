import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

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

// Lean User Stories validation schema
export const UserStorySchema = z.object({
	role: z.string(),
	action: z.string(),
	value: z.string()
});
export const UserStoriesSchema = z.array(UserStorySchema);

export type UserStoryData = z.infer<typeof UserStorySchema>;

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

export const C4RelationshipSchema = z.object({
	sourceNode: z.string(),
	sourceType: z.string(),
	relationship: z.string(),
	targetNode: z.string(),
	targetType: z.string()
});
export const C4ContextSchema = z.array(C4RelationshipSchema);

export type C4Relationship = z.infer<typeof C4RelationshipSchema>;

/**
 * Resiliently parses a fenced JSON block containing C4 System Context data
 * and programmatically constructs a styled Mermaid.js flowchart diagram.
 * @param text Raw response text containing a fenced JSON array
 */
export function parseC4ContextJsonAndBuildMermaid(text: string): string {
	const jsonText = extractJsonFromMarkdown(text);
	let relationships: C4Relationship[] = [];

	try {
		const rawObj = JSON.parse(jsonText);
		relationships = C4ContextSchema.parse(rawObj);
	} catch (parseError: any) {
		if (jsonText !== text.trim()) {
			try {
				const rawParsedFallback = JSON.parse(text.trim());
				relationships = C4ContextSchema.parse(rawParsedFallback);
			} catch (e) {
				return '```mermaid\ngraph TD\n  Error["No C4 context data could be parsed from output."]\n```';
			}
		} else {
			return '```mermaid\ngraph TD\n  Error["No C4 context data could be parsed from output."]\n```';
		}
	}

	if (relationships.length === 0) {
		return '```mermaid\ngraph TD\n  Error["No C4 context data could be parsed from output."]\n```';
	}

	// Unique nodes tracker
	const nodeMap = new Map<string, { id: string; className: string }>();
	let countA = 1;
	let countB = 1;

	// Helper to add node to registry and resolve properties
	const registerNode = (nodeName: string, nodeType: string) => {
		const normName = nodeName.toLowerCase();
		if (nodeMap.has(normName)) {
			return;
		}

		const normType = nodeType.toLowerCase();
		let id = '';
		let className = '';

		if (normType === 'system' || normType === 'person') {
			id = `A${countA++}`;
			className = normType === 'system' ? 'component' : 'person';
		} else {
			id = `B${countB++}`;
			className = 'boundary';
		}

		nodeMap.set(normName, { id, className });
	};

	// Register all sources and targets
	for (const rel of relationships) {
		registerNode(rel.sourceNode, rel.sourceType);
		registerNode(rel.targetNode, rel.targetType);
	}

	// Resolve node names mapping (we want to preserve original casing)
	const nameMap = new Map<string, string>();
	for (const rel of relationships) {
		nameMap.set(rel.sourceNode.toLowerCase(), rel.sourceNode);
		nameMap.set(rel.targetNode.toLowerCase(), rel.targetNode);
	}

	// Start building Mermaid graph
	const mermaidLines: string[] = ['graph TD'];

	// 1. Node definitions
	for (const [normName, info] of nodeMap.entries()) {
		const originalName = nameMap.get(normName) || normName;
		mermaidLines.push(`  ${info.id}["${originalName}"]:::${info.className}`);
	}

	mermaidLines.push(''); // spacing

	// 2. Connections (relationships)
	for (const rel of relationships) {
		const sourceInfo = nodeMap.get(rel.sourceNode.toLowerCase());
		const targetInfo = nodeMap.get(rel.targetNode.toLowerCase());
		if (sourceInfo && targetInfo) {
			const relText = rel.relationship.trim();
			if (relText) {
				mermaidLines.push(`  ${sourceInfo.id} -->|${relText}| ${targetInfo.id}`);
			} else {
				mermaidLines.push(`  ${sourceInfo.id} --> ${targetInfo.id}`);
			}
		}
	}

	mermaidLines.push(''); // spacing

	// 3. Class definitions
	mermaidLines.push('  classDef component fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#01579b,font-size:14px');
	mermaidLines.push('  classDef boundary fill:#fff3e0,stroke:#ff6f00,stroke-width:2px,color:#ff6f00,font-size:14px');
	mermaidLines.push('  classDef person fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#2e7d32,font-size:14px');

	return `\`\`\`mermaid\n${mermaidLines.join('\n')}\n\`\`\``;
}

/**
 * Recursively scans a directory to list all file paths relative to baseDir.
 * Ignores node_modules, .git, out, and dist directories.
 */
export async function scanWorkspaceDir(dir: string, baseDir: string = dir): Promise<string[]> {
	let results: string[] = [];
	try {
		const list = await fs.readdir(dir, { withFileTypes: true });
		for (const file of list) {
			const res = path.resolve(dir, file.name);
			const relative = path.relative(baseDir, res);
			
			// Ignore standard non-source folders
			if (file.isDirectory()) {
				if (
					file.name === 'node_modules' ||
					file.name === '.git' ||
					file.name === 'out' ||
					file.name === 'dist' ||
					file.name === '.vscode' ||
					file.name === '.vscode-test'
				) {
					continue;
				}
				const subResults = await scanWorkspaceDir(res, baseDir);
				results = results.concat(subResults);
			} else {
				results.push(relative);
			}
		}
	} catch (e) {
		// Ignore readdir failures (e.g. permission errors)
	}
	return results;
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
You must output ONLY a standard JSON array inside standard triple-backtick Markdown fences (eg: \`\`\`json [ ... ] \`\`\`).
No preambles, no introductions, no explanations, no text before or after the JSON fences.

Each object in the JSON array must strictly follow this schema:
{
	"role": "the role/user type",
	"action": "the action/goal",
	"value": "the benefit/value"
}`;

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
 * Scans the workspace at workspaceRootPath, analyzes dependencies, and queries
 * Ollama to generate a C4 System Context diagram using Mermaid flowchart syntax.
 * @param workspaceRootPath Path to the root workspace directory
 * @param options Host configurations (baseUrl and model)
 */
export async function generateSystemContextDiagram(
	workspaceRootPath: string,
	options?: LeanUserStoriesOptions
): Promise<string> {
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

	// 1. Read package.json manifest if it exists
	let manifestContent = '';
	try {
		const packageJsonPath = path.join(workspaceRootPath, 'package.json');
		manifestContent = await fs.readFile(packageJsonPath, 'utf-8');
	} catch (e) {
		manifestContent = 'No package.json found.';
	}

	// 2. Scan workspace directory structure
	const files = await scanWorkspaceDir(workspaceRootPath);
	const fileListSummary = files.slice(0, 150).join('\n');
	const fileCountWarning = files.length > 150 ? `\n...and ${files.length - 150} more files` : '';

	const systemPrompt = `You are an expert software architect. Analyze the provided project manifest and files structure to identify system boundaries, primary systems, key user actors, and external dependencies.
You must output ONLY a standard JSON array inside standard triple-backtick Markdown fences (eg: \`\`\`json [ ... ] \`\`\`).
No preambles, no introductions, no explanations, no text before or after the JSON fences.

Each object in the JSON array represents a relationship in the C4 System Context and must strictly follow this schema:
{
	"sourceNode": "name of the source node",
	"sourceType": "type of the source node",
	"relationship": "description of the relationship",
	"targetNode": "name of the target node",
	"targetType": "type of the target node"
}

The sourceType and targetType must be one of:
- Person (for human actors, developers, users)
- System (for the main central software system being analyzed)
- WebApp / Database / API / System_Ext (for external applications, databases, external APIs, external dependencies)

Example Markdown Output:
\`\`\`json
[
	{
		"sourceNode": "Users",
		"sourceType": "Person",
		"relationship": "interact",
		"targetNode": "Calculator System",
		"targetType": "System"
	},
	{
		"sourceNode": "Calculator System",
		"sourceType": "System",
		"relationship": "depends on",
		"targetNode": "Database Server",
		"targetType": "Database"
	}
]
\`\`\``;

	const userPrompt = `Project Manifest (package.json):
\`\`\`json
${manifestContent}
\`\`\`

Workspace Source Files Structure:
${fileListSummary}${fileCountWarning}

Draft the system context diagram.`;

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

	const result = data.message?.content;
	if (!result) {
		throw new Error('Received empty response from Ollama.');
	}

	const mermaidDiagram = parseC4ContextJsonAndBuildMermaid(result);

	return `Here is the C4 System Context Data analyzed from your workspace:\n\n${result}\n\n### C4 System Context Diagram\n\n${mermaidDiagram}`;
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
