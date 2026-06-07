/**
 * Extracts raw text from standard triple-backtick Markdown fences.
 * If no fences are detected, returns the input text trimmed.
 * @param text The input string potentially containing markdown fences
 */
export function extractJsonFromMarkdown(text: string): string {
	const match = text.match(/```json\s*([\s\S]*?)\s*```/);
	if (!match) {
		return text.trim();
	}
	return match[1].trim();
}
