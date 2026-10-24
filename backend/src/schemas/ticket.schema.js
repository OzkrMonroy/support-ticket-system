import { z } from 'zod';

export const createTicketSchema = z.strictObject({
  title: z.string({ error: 'Title is required and must be a string.' })
    .trim().min(1, 'Title is required.').max(200, 'Title must not exceed 200 characters.'),
  description: z.string({ error: 'Description is required and must be a string.' })
    .trim().min(1, 'Description is required.').max(5000, 'Description must not exceed 5000 characters.'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH'], { error: 'Priority must be LOW, MEDIUM, or HIGH.' }),
});
