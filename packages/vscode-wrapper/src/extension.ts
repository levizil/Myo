import * as vscode from 'vscode';
import * as path from 'path';
import {
	generateLeanUserStories,
	generateAdrFromCode,
	generateSystemContextDiagram,
	GitHubClient,
	parseLeanUserStoriesFromMarkdown,
	initializeSkeletonParser,
	extractSkeleton
} from '@myo/core';

class MyoVirtualDocumentProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this._onDidChange.event;

	private documents = new Map<string, string>();

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.documents.get(uri.toString()) || '';
	}

	setDocumentContent(uri: vscode.Uri, content: string) {
		this.documents.set(uri.toString(), content);
		this._onDidChange.fire(uri);
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "myo-vs-code" is now active!');

	initializeSkeletonParser(
		path.join(__dirname),
		path.join(__dirname, 'tree-sitter-typescript.wasm')
	).catch((err: Error) => {
		console.error('[Myo] B.O.N.E.S. parser failed to initialize:', err.message);
	});

	const virtualDocProvider = new MyoVirtualDocumentProvider();
	const providerRegistration = vscode.workspace.registerTextDocumentContentProvider('myo', virtualDocProvider);
	context.subscriptions.push(providerRegistration);

	const helloDisposable = vscode.commands.registerCommand('myo.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Myo!');
	});

	const githubAuthenticateDisposable = vscode.commands.registerCommand('myo.githubAuthenticate', async () => {
		try {
			const session = await vscode.authentication.getSession('github', ['project', 'repo'], { createIfNone: true });
			if (session) {
				vscode.window.showInformationMessage(`Successfully authenticated as ${session.account.label}`);
			} else {
				vscode.window.showWarningMessage('Authentication failed or was cancelled.');
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`GitHub authentication error: ${err.message}`);
		}
	});

	const userStoriesDisposable = vscode.commands.registerCommand('myo.generateUserStories', async (prefilledInput?: string) => {
		let input = prefilledInput;
		const editor = vscode.window.activeTextEditor;

		if (!input) {
			let selectedText = '';
			if (editor) {
				const selection = editor.selection;
				selectedText = editor.document.getText(selection).trim();
			}

			input = await vscode.window.showInputBox({
				prompt: 'Describe your rough feature idea',
				value: selectedText,
				placeHolder: 'e.g., A dark mode toggle in the settings menu',
				ignoreFocusOut: true
			});
		}

		if (!input || !input.trim()) {
			return;
		}

		const ollamaConfig = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = ollamaConfig.get<string>('url') || 'http://localhost:11434';
		const model = ollamaConfig.get<string>('model') || 'llama3.1:8b';

		const githubConfig = vscode.workspace.getConfiguration('myo.github');
		const githubOwner = githubConfig.get<string>('owner') || '';
		const githubProjectNumber = githubConfig.get<number>('projectNumber') || 1;

		let githubToken: string | undefined;

		if (githubOwner) {
			try {
				const session = await vscode.authentication.getSession('github', ['project', 'repo'], { createIfNone: true });
				if (session) {
					githubToken = session.accessToken;
				}
			} catch (err: any) {
				vscode.window.showWarningMessage(`GitHub authentication failed, generating user stories without Icebox context: ${err.message}`);
			}
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Generating Lean user stories...',
			cancellable: false
		}, async () => {
			try {
				const result = await generateLeanUserStories(input, {
					baseUrl,
					model,
					githubToken,
					githubOwner: githubOwner || undefined,
					githubProjectNumber
				});
				
				const uri = vscode.Uri.parse(`myo:/user-stories/draft-${Date.now()}.md`);
				virtualDocProvider.setDocumentContent(uri, result);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to generate user stories: ${err.message}`);
			}
		});
	});

	const pushSingleStoryDisposable = vscode.commands.registerCommand('myo.pushSingleStoryToBacklog', async (story: any) => {
		if (!story || !story.role || !story.action || !story.value) {
			vscode.window.showErrorMessage('Invalid story data provided.');
			return;
		}

		const githubConfig = vscode.workspace.getConfiguration('myo.github');
		const owner = githubConfig.get<string>('owner') || '';
		const projectNumber = githubConfig.get<number>('projectNumber') || 1;

		if (!owner) {
			vscode.window.showWarningMessage('GitHub owner is not configured in VS Code settings. Please set "myo.github.owner".');
			return;
		}

		// Authenticate and get token
		let githubToken: string | undefined;
		try {
			const session = await vscode.authentication.getSession('github', ['project', 'repo'], { createIfNone: true });
			if (session) {
				githubToken = session.accessToken;
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`GitHub authentication is required to push to backlog: ${err.message}`);
			return;
		}

		if (!githubToken) {
			vscode.window.showErrorMessage('GitHub authentication token is required.');
			return;
		}

		const client = new GitHubClient(githubToken);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Pushing story to Backlog: "${story.action}"...`,
			cancellable: false
		}, async () => {
			try {
				const title = `As a ${story.role}, I want to ${story.action}`;
				const body = `As a ${story.role}, I want to ${story.action}, So that ${story.value}`;
				await client.addStoryToBacklog(owner, projectNumber, title, body);
				vscode.window.showInformationMessage(`Successfully pushed story: "${story.action}"`);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to push story "${story.action}": ${err.message}`);
			}
		});
	});

	const pushStoriesDisposable = vscode.commands.registerCommand('myo.pushStoriesToBacklog', async (uri?: vscode.Uri) => {
		const githubConfig = vscode.workspace.getConfiguration('myo.github');
		const owner = githubConfig.get<string>('owner') || '';
		const projectNumber = githubConfig.get<number>('projectNumber') || 1;

		if (!owner) {
			vscode.window.showWarningMessage('GitHub owner is not configured in VS Code settings. Please set "myo.github.owner".');
			return;
		}

		let content = '';
		if (uri && uri instanceof vscode.Uri) {
			const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
			if (doc) {
				content = doc.getText();
			}
		}

		if (!content) {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('No active Markdown file with user stories.');
				return;
			}
			content = editor.document.getText();
		}

		const cleanedContent = content.replace(/\[\+\]\(command:myo\.pushSingleStoryToBacklog\?[^)]+\)/g, '');
		const stories = parseLeanUserStoriesFromMarkdown(cleanedContent);

		if (stories.length === 0) {
			vscode.window.showWarningMessage('Could not find any user stories in the current context matching: "As a ..., I want to ..., So that ...".');
			return;
		}

		// Prompt user with multi-select QuickPick
		const quickPickItems = stories.map(story => ({
			label: `As a ${story.role}, I want to ${story.action}`,
			description: `So that ${story.value}`,
			picked: true,
			story
		}));

		const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
			canPickMany: true,
			title: 'Select user stories to push to GitHub Backlog'
		});

		if (!selectedItems || selectedItems.length === 0) {
			return; // cancelled or none selected
		}

		// Authenticate and get token
		let githubToken: string | undefined;
		try {
			const session = await vscode.authentication.getSession('github', ['project', 'repo'], { createIfNone: true });
			if (session) {
				githubToken = session.accessToken;
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`GitHub authentication is required to push to backlog: ${err.message}`);
			return;
		}

		if (!githubToken) {
			vscode.window.showErrorMessage('GitHub authentication token is required.');
			return;
		}

		const client = new GitHubClient(githubToken);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Pushing user stories to Backlog...',
			cancellable: false
		}, async (progress) => {
			let count = 0;
			for (const item of selectedItems) {
				const title = item.label;
				const body = `${item.label}\n${item.description}`;
				progress.report({ message: `Story ${++count} of ${selectedItems.length}: "${item.story.action}"` });

				try {
					await client.addStoryToBacklog(owner, projectNumber, title, body);
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to push story "${item.story.action}": ${err.message}`);
				}
			}
		});

		vscode.window.showInformationMessage(`Successfully pushed ${selectedItems.length} stories to the Backlog!`);
	});

	const fetchIceboxDisposable = vscode.commands.registerCommand('myo.fetchIcebox', async () => {
		const githubConfig = vscode.workspace.getConfiguration('myo.github');
		const owner = githubConfig.get<string>('owner') || '';
		const projectNumber = githubConfig.get<number>('projectNumber') || 1;

		if (!owner) {
			vscode.window.showWarningMessage('GitHub owner is not configured in VS Code settings. Please set "myo.github.owner".');
			return;
		}

		// Authenticate and get token
		let githubToken: string | undefined;
		try {
			const session = await vscode.authentication.getSession('github', ['project', 'repo'], { createIfNone: true });
			if (session) {
				githubToken = session.accessToken;
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`GitHub authentication is required to fetch Icebox items: ${err.message}`);
			return;
		}

		if (!githubToken) {
			vscode.window.showErrorMessage('GitHub authentication token is required.');
			return;
		}

		const client = new GitHubClient(githubToken);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Fetching Icebox items from project #${projectNumber}...`,
			cancellable: false
		}, async () => {
			try {
				const items = await client.fetchIceboxItems(owner, projectNumber);
				if (items.length === 0) {
					vscode.window.showInformationMessage('No items found in the Icebox column.');
					return;
				}

				const markdownContent = `# GitHub Icebox Items (Project #${projectNumber} under "${owner}")
 
Here are the current items in the "Icebox" column of your Project board:
 
${items.map(item => `## ${item.title}\n\n${item.body}`).join('\n\n')}
`;

				const uri = vscode.Uri.parse(`myo:/icebox/items-${Date.now()}.md`);
				virtualDocProvider.setDocumentContent(uri, markdownContent);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to fetch Icebox items: ${err.message}`);
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

		const ollamaConfig = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = ollamaConfig.get<string>('url') || 'http://localhost:11434';
		const model = ollamaConfig.get<string>('model') || 'llama3.1:8b';

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
				
				const uri = vscode.Uri.parse(`myo:/adr/draft-${Date.now()}.md`);
				virtualDocProvider.setDocumentContent(uri, markdownContent);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to draft ADR: ${err.message}`);
			}
		});
	});

	const testParseDisposable = vscode.commands.registerCommand('myo.testParseFile', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open a TypeScript file to test B.O.N.E.S. parsing.');
			return;
		}
		let skeleton: string;
		try {
			skeleton = extractSkeleton(editor.document.getText());
		} catch (err: any) {
			vscode.window.showErrorMessage(`B.O.N.E.S.: ${err.message}`);
			return;
		}
		const ch = vscode.window.createOutputChannel('Myo B.O.N.E.S.');
		ch.clear();
		ch.appendLine(`=== Skeleton: ${editor.document.fileName} ===\n`);
		ch.appendLine(skeleton || '(no exported symbols found)');
		ch.show(true);
	});

	const c4Disposable = vscode.commands.registerCommand('myo.generateC4Diagram', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showWarningMessage('Please open a folder first to generate a C4 diagram.');
			return;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;

		const ollamaConfig = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = ollamaConfig.get<string>('url') || 'http://localhost:11434';
		const model = ollamaConfig.get<string>('model') || 'llama3.1:8b';

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Analyzing workspace and generating C4 Context diagram...',
			cancellable: false
		}, async () => {
			try {
				const result = await generateSystemContextDiagram(rootPath, { baseUrl, model });
				
				const markdownContent = `# C4 System Context Diagram
 
Here is the system context diagram for your workspace generated by Myo. Open the VS Code Markdown Preview (press \`Ctrl+K V\` or \`Cmd+K V\`) to see the diagram render.
 
${result}
`;

				const doc = await vscode.workspace.openTextDocument({
					content: markdownContent,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(doc);
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to generate C4 Context diagram: ${err.message}`);
			}
		});
	});

	class UserStoriesCodeLensProvider implements vscode.CodeLensProvider {
		provideCodeLenses(
			document: vscode.TextDocument,
			token: vscode.CancellationToken
		): vscode.ProviderResult<vscode.CodeLens[]> {
			const content = document.getText();

			// Case 1: If it's a fetched Icebox items doc, show generate buttons above headers
			const lines = content.split(/\r?\n/);
			const lenses: vscode.CodeLens[] = [];
			let isIceboxDoc = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('# GitHub Icebox Items')) {
					isIceboxDoc = true;
				}
				if (isIceboxDoc && line.startsWith('## ')) {
					const title = line.substring(3).trim();
					if (title) {
						const range = new vscode.Range(i, 0, i, 0);
						lenses.push(
							new vscode.CodeLens(range, {
								title: `✨ Generate Lean User Stories`,
								command: 'myo.generateUserStories',
								arguments: [title]
							})
						);
					}
				}
			}

			if (isIceboxDoc && lenses.length > 0) {
				return lenses;
			}

			// Case 2: If it's a user story document, show push story buttons for each individual story
			const cleanedContent = content.replace(/\[\+\]\(command:myo\.pushSingleStoryToBacklog\?[^)]+\)/g, '');
			const stories = parseLeanUserStoriesFromMarkdown(cleanedContent);
			
			if (stories.length > 0) {
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i].trim();
					if (line.toLowerCase().startsWith('as a ') || line.toLowerCase().startsWith('as an ')) {
						const matchingStory = stories.find(s => {
							return line.includes(s.role) && 
								   (lines[i+1]?.includes(s.action) || lines[i]?.includes(s.action));
						});
						
						if (matchingStory) {
							const range = new vscode.Range(i, 0, i, 0);
							lenses.push(
								new vscode.CodeLens(range, {
									title: `➕ Push Story to Backlog`,
									command: 'myo.pushSingleStoryToBacklog',
									arguments: [matchingStory]
								})
							);
						}
					}
				}
			}
			return lenses;
		}
	}

	const fileCodeLensProvider = vscode.languages.registerCodeLensProvider(
		{ language: 'markdown', scheme: 'file' },
		new UserStoriesCodeLensProvider()
	);

	const untitledCodeLensProvider = vscode.languages.registerCodeLensProvider(
		{ language: 'markdown', scheme: 'untitled' },
		new UserStoriesCodeLensProvider()
	);

	const myoCodeLensProvider = vscode.languages.registerCodeLensProvider(
		{ language: 'markdown', scheme: 'myo' },
		new UserStoriesCodeLensProvider()
	);

	context.subscriptions.push(
		helloDisposable,
		githubAuthenticateDisposable,
		userStoriesDisposable,
		pushStoriesDisposable,
		pushSingleStoryDisposable,
		fetchIceboxDisposable,
		adrDisposable,
		c4Disposable,
		testParseDisposable,

		fileCodeLensProvider,
		untitledCodeLensProvider,
		myoCodeLensProvider
	);
}

export function deactivate() {}
