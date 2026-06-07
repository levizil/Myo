/**
 * Unloads a model from Ollama's memory immediately.
 * @param modelName Name of the model to unload
 * @param baseUrl Base URL of the Ollama server
 */
export async function unloadOllamaModel(
	modelName: string,
	baseUrl: string = 'http://localhost:11434'
): Promise<void> {
	const response = await fetch(`${baseUrl}/api/generate`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: modelName,
			prompt: '',
			keep_alive: 0
		})
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`Failed to unload model "${modelName}": ${errText}`);
	}
}
