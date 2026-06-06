import * as vscode from 'vscode';

export interface OllamaMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export async function streamOllamaResponse(
	messages: OllamaMessage[],
	onChunk: (text: string) => void,
	onError: (err: string) => void,
	onComplete: () => void,
	abortSignal: AbortSignal
) {
	const config = vscode.workspace.getConfiguration('myo.ollama');
	const baseUrl = config.get<string>('url') || 'http://localhost:11434';
	const model = config.get<string>('model') || 'llama3.1:8b';

	// Set a 3-second connection timeout (only for initial connection, not the whole stream)
	const connectionAbort = new AbortController();
	const combinedSignal = abortSignal.aborted ? abortSignal : connectionAbort.signal;
	
	const timeoutId = setTimeout(() => {
		connectionAbort.abort(new Error('Connection timeout'));
	}, 3000);

	// Also listen to external abort
	abortSignal.addEventListener('abort', () => {
		connectionAbort.abort();
	});

	try {
		const response = await fetch(`${baseUrl}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				messages,
				stream: true
			}),
			signal: combinedSignal
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Status ${response.status}: ${errorText}`);
		}

		if (!response.body) {
			throw new Error('Response body is empty.');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		if (typeof (response.body as any)[Symbol.asyncIterator] === 'function') {
			for await (const chunk of (response.body as any)) {
				if (abortSignal.aborted) {
					break;
				}
				const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
				buffer += text;
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (line.trim()) {
						try {
							const parsed = JSON.parse(line);
							if (parsed.message?.content) {
								onChunk(parsed.message.content);
							}
						} catch (err) {
							console.error('Failed to parse line:', line, err);
						}
					}
				}
			}
		} else {
			const reader = response.body.getReader();
			try {
				while (!abortSignal.aborted) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					const text = decoder.decode(value, { stream: true });
					buffer += text;
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';
					for (const line of lines) {
						if (line.trim()) {
							try {
								const parsed = JSON.parse(line);
								if (parsed.message?.content) {
									onChunk(parsed.message.content);
								}
							} catch (err) {
								console.error('Failed to parse line:', line, err);
							}
						}
					}
				}
			} finally {
				reader.releaseLock();
			}
		}

		// Process remaining buffer
		if (buffer.trim() && !abortSignal.aborted) {
			try {
				const parsed = JSON.parse(buffer);
				if (parsed.message?.content) {
					onChunk(parsed.message.content);
				}
			} catch (err) {
				// Ignore partial parsing error
			}
		}

		if (!abortSignal.aborted) {
			onComplete();
		}
	} catch (err: any) {
		clearTimeout(timeoutId);
		if (abortSignal.aborted) {
			return; // Graceful cancellation
		}
		const isTimeout = err.message === 'Connection timeout' || err.name === 'AbortError';
		const errorMsg = isTimeout ? 'Connection timed out after 3000ms' : err.message;
		
		onError(`**Connection Error**: Could not connect to the Ollama server at **${baseUrl}** (${errorMsg}).\n\n` +
				`1. Make sure Ollama is running locally.\n` +
				`2. Verify the configuration \`myo.ollama.url\` is correct.\n` +
				`3. Make sure the model \`${model}\` is installed (run \`ollama pull ${model}\` in terminal).`);
	}
}

export function registerOllamaCommands(context: vscode.ExtensionContext) {
	const selectModelDisposable = vscode.commands.registerCommand('myo.selectOllamaModel', async () => {
		const config = vscode.workspace.getConfiguration('myo.ollama');
		const baseUrl = config.get<string>('url') || 'http://localhost:11434';

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), 3000);

		try {
			const response = await fetch(`${baseUrl}/api/tags`, {
				signal: abortController.signal
			});
			clearTimeout(timeoutId);
			if (!response.ok) {
				throw new Error(`Failed to fetch models: status ${response.status}`);
			}
			const data = (await response.json()) as { models?: { name: string }[] };
			const models = data.models || [];
			if (models.length === 0) {
				vscode.window.showWarningMessage('No models found on the Ollama server. Pull a model using "ollama pull <model>" first.');
				return;
			}
			const modelNames = models.map(m => m.name);
			const selected = await vscode.window.showQuickPick(modelNames, {
				placeHolder: 'Select an Ollama model for Myo Chat'
			});
			if (selected) {
				await config.update('model', selected, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage(`Myo Chat model set to: ${selected}`);
			}
		} catch (err: any) {
			clearTimeout(timeoutId);
			const isTimeout = err.name === 'AbortError';
			const errorMsg = isTimeout ? 'Connection timed out after 3000ms' : err.message;
			vscode.window.showErrorMessage(`Error connecting to Ollama: ${errorMsg}. Make sure Ollama is running and the URL is correct.`);
		}
	});

	context.subscriptions.push(selectModelDisposable);
}
