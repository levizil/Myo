import * as vscode from 'vscode';
import { streamOllamaResponse, OllamaMessage } from './ollama';

export class MyoChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'myo.chatView';
	private _view?: vscode.WebviewView;
	private _history: OllamaMessage[] = [];
	private _abortController?: AbortController;

	constructor(private readonly _context: vscode.ExtensionContext) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._context.extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview();

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'sendPrompt':
					await this.handleSendPrompt(data.value);
					break;
				case 'abort':
					this.handleAbort();
					break;
				case 'clear':
					this._history = [];
					webviewView.webview.postMessage({ type: 'cleared' });
					break;
			}
		});
	}

	private async handleSendPrompt(prompt: string) {
		if (!this._view) return;

		this._history.push({ role: 'user', content: prompt });
		
		const config = vscode.workspace.getConfiguration('myo.ollama');
		const systemPrompt = config.get<string>('systemPrompt') || 'You are a helpful programming assistant inside VS Code.';
		
		const messages: OllamaMessage[] = [
			{ role: 'system', content: systemPrompt },
			...this._history
		];

		this._abortController = new AbortController();

		this._view.webview.postMessage({ type: 'startResponse' });

		let responseText = '';
		
		await streamOllamaResponse(
			messages,
			(chunk) => {
				responseText += chunk;
				this._view?.webview.postMessage({ type: 'chunk', value: chunk });
			},
			(error) => {
				this._view?.webview.postMessage({ type: 'error', value: error });
			},
			() => {
				this._history.push({ role: 'assistant', content: responseText });
				this._view?.webview.postMessage({ type: 'endResponse' });
			},
			this._abortController.signal
		);
	}

	private handleAbort() {
		if (this._abortController) {
			this._abortController.abort();
		}
	}

	private _getHtmlForWebview() {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<style>
					body {
						font-family: var(--vscode-font-family);
						color: var(--vscode-foreground);
						background-color: var(--vscode-editor-background);
						padding: 10px;
						display: flex;
						flex-direction: column;
						height: 100vh;
						box-sizing: border-box;
						margin: 0;
					}
					#chat-container {
						flex-grow: 1;
						overflow-y: auto;
						display: flex;
						flex-direction: column;
						gap: 10px;
						margin-bottom: 10px;
						padding-right: 5px;
					}
					.message {
						padding: 8px 12px;
						border-radius: 6px;
						line-height: 1.4;
						word-wrap: break-word;
						white-space: pre-wrap;
					}
					.user-message {
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						align-self: flex-end;
						max-width: 85%;
					}
					.assistant-message {
						background-color: var(--vscode-editor-inactiveSelectionBackground);
						align-self: flex-start;
						max-width: 95%;
					}
					.error-message {
						color: var(--vscode-errorForeground);
					}
					#input-container {
						display: flex;
						gap: 5px;
						padding-bottom: 10px;
					}
					#prompt-input {
						flex-grow: 1;
						background-color: var(--vscode-input-background);
						color: var(--vscode-input-foreground);
						border: 1px solid var(--vscode-input-border);
						padding: 6px;
						border-radius: 2px;
						font-family: var(--vscode-font-family);
						resize: vertical;
						min-height: 28px;
						max-height: 150px;
					}
					button {
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 6px 12px;
						border-radius: 2px;
						cursor: pointer;
					}
					button:hover {
						background-color: var(--vscode-button-hoverBackground);
					}
					button:disabled {
						opacity: 0.5;
						cursor: not-allowed;
					}
				</style>
			</head>
			<body>
				<div id="chat-container"></div>
				<div id="input-container">
					<textarea id="prompt-input" rows="1" placeholder="Ask Myo..."></textarea>
					<button id="send-button">Send</button>
				</div>

				<script>
					const vscode = acquireVsCodeApi();
					const chatContainer = document.getElementById('chat-container');
					const promptInput = document.getElementById('prompt-input');
					const sendButton = document.getElementById('send-button');

					let currentAssistantMessage = null;
					let currentContent = '';
					let isGenerating = false;

					promptInput.addEventListener('keydown', (e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendPrompt();
						}
					});

					sendButton.addEventListener('click', () => {
						if (isGenerating) {
							vscode.postMessage({ type: 'abort' });
						} else {
							sendPrompt();
						}
					});

					function sendPrompt() {
						const text = promptInput.value.trim();
						if (!text) return;
						
						appendMessage('user', text);
						promptInput.value = '';
						promptInput.style.height = 'auto';
						
						isGenerating = true;
						updateButtonState();
						vscode.postMessage({ type: 'sendPrompt', value: text });
					}

					function appendMessage(role, text) {
						const el = document.createElement('div');
						el.className = 'message ' + role + '-message';
						el.innerText = text;
						chatContainer.appendChild(el);
						chatContainer.scrollTop = chatContainer.scrollHeight;
						return el;
					}

					function updateButtonState() {
						sendButton.innerText = isGenerating ? 'Stop' : 'Send';
					}

					window.addEventListener('message', event => {
						const message = event.data;
						switch (message.type) {
							case 'startResponse':
								currentAssistantMessage = appendMessage('assistant', '');
								currentContent = '';
								break;
							case 'chunk':
								if (currentAssistantMessage) {
									currentContent += message.value;
									currentAssistantMessage.innerText = currentContent;
									chatContainer.scrollTop = chatContainer.scrollHeight;
								}
								break;
							case 'error':
								appendMessage('assistant error', message.value);
								isGenerating = false;
								updateButtonState();
								break;
							case 'endResponse':
								isGenerating = false;
								updateButtonState();
								break;
							case 'cleared':
								chatContainer.innerHTML = '';
								break;
						}
					});

					promptInput.addEventListener('input', function() {
						this.style.height = 'auto';
						this.style.height = (this.scrollHeight) + 'px';
					});
				</script>
			</body>
			</html>`;
	}
}
