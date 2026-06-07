import { z } from 'zod';

// ADR validation schema (ADR 003)
export const AdrSchema = z.object({
	title: z.string(),
	context: z.string(),
	decision: z.string(),
	consequences: z.object({
		positive: z.array(z.string()),
		negative: z.array(z.string())
	})
});

export type AdrData = z.infer<typeof AdrSchema>;
