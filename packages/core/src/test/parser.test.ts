import * as assert from 'assert';
import * as path from 'path';
import { extractJsonFromMarkdown, AdrSchema, scanWorkspaceDir, parseC4ContextJsonAndBuildMermaid, parseLeanUserStories, parseLeanUserStoriesFromMarkdown } from '../index';

suite('Core Parsing & Validation Tests', () => {
	suite('extractJsonFromMarkdown', () => {
		test('Successfully extracts JSON string inside standard fences', () => {
			const input = 'Here is the response:\n```json\n{\n  "title": "A Test"\n}\n```\nHope it helps!';
			const extracted = extractJsonFromMarkdown(input);
			assert.strictEqual(extracted, '{\n  "title": "A Test"\n}');
		});

		test('Returns trimmed text when no fences are present', () => {
			const input = '  {\n  "title": "A Test"\n}  ';
			const extracted = extractJsonFromMarkdown(input);
			assert.strictEqual(extracted, '{\n  "title": "A Test"\n}');
		});

		test('Gracefully handles extra whitespaces around json label', () => {
			const input = '```json   \n{"value": 1}\n```';
			const extracted = extractJsonFromMarkdown(input);
			assert.strictEqual(extracted, '{"value": 1}');
		});
	});

	suite('AdrSchema', () => {
		test('Successfully parses a fully conforming ADR structure', () => {
			const validJson = {
				title: 'Use TypeScript Monorepo',
				context: 'We want modularity and separation of concerns.',
				decision: 'Use NPM workspaces with TypeScript project references.',
				consequences: {
					positive: ['Strict isolation of VS Code API', 'Fast core testing'],
					negative: ['Boilerplate config setup']
				}
			};

			const validated = AdrSchema.parse(validJson);
			assert.strictEqual(validated.title, 'Use TypeScript Monorepo');
			assert.deepStrictEqual(validated.consequences.positive, [
				'Strict isolation of VS Code API',
				'Fast core testing'
			]);
		});

		test('Throws validation error on missing required properties', () => {
			const invalidJson = {
				title: 'Invalid ADR',
				context: 'Missing decision and consequences'
			};

			assert.throws(() => {
				AdrSchema.parse(invalidJson);
			});
		});

		test('Throws validation error if consequences lists are not arrays', () => {
			const invalidJson = {
				title: 'Invalid consequences',
				context: 'context content',
				decision: 'decision content',
				consequences: {
					positive: 'Should be an array but is a string',
					negative: ['This is correct']
				}
			};

			assert.throws(() => {
				AdrSchema.parse(invalidJson);
			});
		});
	});

	suite('scanWorkspaceDir', () => {
		test('Recursively scans directory and includes core files while ignoring node_modules and build directories', async () => {
			const coreRoot = path.resolve(__dirname, '../../');
			const files = await scanWorkspaceDir(coreRoot);

			// Assertions on expected files
			assert.ok(files.includes('package.json'), 'Should include package.json');
			assert.ok(files.includes('tsconfig.json'), 'Should include tsconfig.json');
			assert.ok(files.includes(path.join('src', 'index.ts')), 'Should include src/index.ts');
			assert.ok(files.includes(path.join('src', 'test', 'parser.test.ts')), 'Should include parser.test.ts');

			// Assertions that ignored folders are indeed ignored
			const nodeModulesExists = files.some(f => f.includes('node_modules'));
			const outDirExists = files.some(f => f.includes('out' + path.sep));
			const gitExists = files.some(f => f.includes('.git' + path.sep));

			assert.strictEqual(nodeModulesExists, false, 'Should ignore node_modules');
			assert.strictEqual(outDirExists, false, 'Should ignore out directory');
			assert.strictEqual(gitExists, false, 'Should ignore .git directory');
		});
	});

	suite('parseC4ContextJsonAndBuildMermaid', () => {
		test('Successfully parses a valid C4 JSON structure inside standard fences', () => {
			const text = `
Here is the diagram data:

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
\`\`\`
`;
			const mermaid = parseC4ContextJsonAndBuildMermaid(text);

			// Should be wrapped in mermaid block
			assert.ok(mermaid.startsWith('```mermaid\n'));
			assert.ok(mermaid.endsWith('\n```'));

			// Check node definitions
			assert.ok(mermaid.includes('A1["Users"]:::person'));
			assert.ok(mermaid.includes('A2["Calculator System"]:::component'));
			assert.ok(mermaid.includes('B1["Database Server"]:::boundary'));

			// Check relationships
			assert.ok(mermaid.includes('A1 -->|interact| A2'));
			assert.ok(mermaid.includes('A2 -->|depends on| B1'));

			// Check class definitions
			assert.ok(mermaid.includes('classDef component fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#01579b,font-size:14px'));
			assert.ok(mermaid.includes('classDef boundary fill:#fff3e0,stroke:#ff6f00,stroke-width:2px,color:#ff6f00,font-size:14px'));
			assert.ok(mermaid.includes('classDef person fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#2e7d32,font-size:14px'));
		});

		test('Resilient to direct JSON input (fallback without fences)', () => {
			const text = `
[
	{
		"sourceNode": "My WebApp",
		"sourceType": "WebApp",
		"relationship": "calls",
		"targetNode": "My API",
		"targetType": "API"
	}
]
`;
			const mermaid = parseC4ContextJsonAndBuildMermaid(text);

			assert.ok(mermaid.includes('B1["My WebApp"]:::boundary'));
			assert.ok(mermaid.includes('B2["My API"]:::boundary'));
			assert.ok(mermaid.includes('B1 -->|calls| B2'));
		});

		test('Returns error mermaid block when JSON fails schema validation', () => {
			const text = `
\`\`\`json
[
	{
		"sourceNode": "Incomplete",
		"sourceType": "System"
	}
]
\`\`\`
`;
			const mermaid = parseC4ContextJsonAndBuildMermaid(text);

			assert.ok(mermaid.includes('Error["No C4 context data could be parsed from output."]'));
		});

		test('Returns error mermaid block when no valid JSON is present', () => {
			const text = 'Just some description and no JSON whatsoever.';
			const mermaid = parseC4ContextJsonAndBuildMermaid(text);

			assert.ok(mermaid.includes('Error["No C4 context data could be parsed from output."]'));
		});
	});

	suite('parseLeanUserStories', () => {
		test('Successfully parses and formats valid user stories JSON array', () => {
			const input = `
Here are the user stories you requested:
\`\`\`json
[
	{
		"role": "developer",
		"action": "run automated tests",
		"value": "ensure the system functions correctly"
	},
	{
		"role": "product manager",
		"action": "view story drafts",
		"value": "refine feature requirements"
	}
]
\`\`\`
Hope this helps!
`;
			const result = parseLeanUserStories(input);
			const expected = [
				'As a developer,',
				'I want to run automated tests,',
				'So that ensure the system functions correctly',
				'',
				'As a product manager,',
				'I want to view story drafts,',
				'So that refine feature requirements'
			].join('\n');

			assert.strictEqual(result, expected);
		});

		test('Throws a validation error when JSON is invalid or does not match schema', () => {
			const input = `
\`\`\`json
[
	{
		"role": "developer",
		"action": "missing value property"
	}
]
\`\`\`
`;
			assert.throws(() => {
				parseLeanUserStories(input);
			}, /validation failed/);
		});

		test('Resilient to extra whitespaces and fallback direct parsing', () => {
			const input = ' \n [\n  {\n   "role": "user",\n   "action": "click button",\n   "value": "see results"\n  }\n ] \n';
			const result = parseLeanUserStories(input);
			const expected = [
				'As a user,',
				'I want to click button,',
				'So that see results'
			].join('\n');

			assert.strictEqual(result, expected);
		});
	});

	suite('parseLeanUserStoriesFromMarkdown', () => {
		test('Successfully parses standard markdown formatted user stories', () => {
			const input = `
# Generated Stories

As a developer,
I want to run automated tests,
So that ensure the system functions correctly

As a product manager,
I want to view story drafts,
So that refine feature requirements
			`;

			const stories = parseLeanUserStoriesFromMarkdown(input);

			assert.strictEqual(stories.length, 2);
			assert.deepStrictEqual(stories[0], {
				role: 'developer',
				action: 'run automated tests',
				value: 'ensure the system functions correctly'
			});
			assert.deepStrictEqual(stories[1], {
				role: 'product manager',
				action: 'view story drafts',
				value: 'refine feature requirements'
			});
		});

		test('Handles different line endings and whitespaces', () => {
			const input = 'As a user\r\nI want to log in\r\nSo that I can see my profile\r\n\r\nAs an admin\nI want to ban users\nSo that keep board clean';
			const stories = parseLeanUserStoriesFromMarkdown(input);

			assert.strictEqual(stories.length, 2);
			assert.strictEqual(stories[0].role, 'user');
			assert.strictEqual(stories[0].action, 'log in');
			assert.strictEqual(stories[0].value, 'I can see my profile');
			assert.strictEqual(stories[1].role, 'admin');
			assert.strictEqual(stories[1].action, 'ban users');
			assert.strictEqual(stories[1].value, 'keep board clean');
		});
	});
});
