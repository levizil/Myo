import * as vscode from 'vscode';
import { generateLeanUserStories, generateAdrFromCode } from '@myo/core';

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

	const adrDisposable = vscode.commands.registerCommand('myo.generateADR', async () => {
		const editor = vscode.window.activeTextEditor;
		let selectedText = '';
		if (editor) {
			const selection = editor.selection;
			selectedText = editor.document.getText(selection);
		}

		let promptMessage = 'Provide optional context or design goals for this ADR';
		let placeholderText = 'e.g., Use a repository pattern for data access to decouple backend framework dependency.';

		if (!selectedText || !selectedText.trim()) {
			promptMessage = 'Describe the technical choice or design pattern you want to document in an ADR';
			placeholderText = 'e.g., Implement strict schema validation at runtime using Zod.';
		}

		const instruction = await vscode.window.showInputBox({
			prompt: promptMessage,
			placeHolder: placeholderText,
			ignoreFocusOut: true
		});

		if (instruction === undefined) {
			return;
		}

		if ((!selectedText || !selectedText.trim()) && (!instruction || !instruction.trim())) {
			vscode.window.showWarningMessage('Please select some code or describe the technical choice to generate an ADR.');
			return;
		}

		const config = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = config.get<string>('url') || 'http://localhost:11434';
		const model = config.get<string>('model') || 'llama3.1:8b';

		const progressTitle = selectedText && selectedText.trim()
			? 'Drafting ADR from highlighted code...'
			: 'Drafting ADR from prompt...';

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: progressTitle,
			cancellable: false
		}, async () => {
			try {
				const adrData = await generateAdrFromCode(selectedText, instruction, { baseUrl, model });
				
				const today = new Date().toISOString().split('T')[0];
				
				const markdownContent = `# ADR: ${adrData.title}

**Date:** ${today}  
**Status:** Proposed  

## Context
${adrData.context}

## Decision
${adrData.decision}

## Consequences

**Positive:**
${adrData.consequences.positive.map(p => `* ${p}`).join('\n')}

**Negative/Trade-offs:**
${adrData.consequences.negative.map(n => `* ${n}`).join('\n')}
`;
				
				const doc = await vscode.workspace.openTextDocument({
					content: markdownContent,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to draft ADR: ${err.message}`);
			}
		});
	});

	context.subscriptions.push(helloDisposable, userStoriesDisposable, adrDisposable);
}

export function deactivate() {}
