import * as vscode from 'vscode';
import { generateLeanUserStories } from '@myo/core';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "myo-vs-code" is now active!');

	const helloDisposable = vscode.commands.registerCommand('myo.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Myo!');
	});

	const userStoriesDisposable = vscode.commands.registerCommand('myo.generateUserStories', async () => {
		const input = await vscode.window.showInputBox({
			prompt: 'Describe your rough feature idea',
			placeHolder: 'e.g., A dark mode toggle in the settings menu',
			ignoreFocusOut: true
		});

		if (!input || !input.trim()) {
			return;
		}

		const config = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = config.get<string>('url') || 'http://localhost:11434';
		const model = config.get<string>('model') || 'llama3.1:8b';

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating Lean user stories...',
			cancellable: false
		}, async () => {
			try {
				const result = await generateLeanUserStories(input, { baseUrl, model });
				
				const doc = await vscode.workspace.openTextDocument({
					content: result,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to generate user stories: ${err.message}`);
			}
		});
	});

	context.subscriptions.push(helloDisposable, userStoriesDisposable);
}

export function deactivate() {}
