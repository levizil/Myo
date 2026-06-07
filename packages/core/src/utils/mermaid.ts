import { extractJsonFromMarkdown } from './markdown';
import { C4Relationship, C4ContextSchema } from '../schemas/c4';

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
