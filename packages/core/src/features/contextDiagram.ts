import * as path from 'path';
import * as fs from 'fs/promises';
import { unloadOllamaModel } from '../clients/ollama';
import { scanWorkspaceDir } from '../utils/fs';
import { parseC4ContextJsonAndBuildMermaid } from '../utils/mermaid';
import { LeanUserStoriesOptions } from './leanStories';

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
- WebApp / Database / API / System_Ext (for external applications, databases, external dependencies, external APIs)

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
