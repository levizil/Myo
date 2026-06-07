import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Myo extension commands exist', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('myo.generateUserStories'), 'generateUserStories command should be registered');
		assert.ok(commands.includes('myo.fetchIcebox'), 'fetchIcebox command should be registered');
		assert.ok(commands.includes('myo.generateADR'), 'generateADR command should be registered');
		assert.ok(commands.includes('myo.pushSingleStoryToBacklog'), 'pushSingleStoryToBacklog command should be registered');
	});
});
