import * as assert from 'assert';
import { extractJsonFromMarkdown, AdrSchema } from '../index';

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
});
