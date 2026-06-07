import { z } from 'zod';

// Lean User Stories validation schema
export const UserStorySchema = z.object({
	role: z.string(),
	action: z.string(),
	value: z.string()
});
export const UserStoriesSchema = z.array(UserStorySchema);

export type UserStoryData = z.infer<typeof UserStorySchema>;
