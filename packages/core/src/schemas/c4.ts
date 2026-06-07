import { z } from 'zod';

export const C4RelationshipSchema = z.object({
	sourceNode: z.string(),
	sourceType: z.string(),
	relationship: z.string(),
	targetNode: z.string(),
	targetType: z.string()
});
export const C4ContextSchema = z.array(C4RelationshipSchema);

export type C4Relationship = z.infer<typeof C4RelationshipSchema>;
