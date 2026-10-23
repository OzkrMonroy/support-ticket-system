import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string({ error: 'Name is required and must be a string.' })
    .trim().min(1, 'Name is required.'),
  email: z.string({ error: 'Email is required and must be a string.' })
    .trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address.')
    .toLowerCase(),
  password: z.string({ error: 'Password is required and must be a string.' })
    .refine((value) => value.trim().length > 0, 'Password is required.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72,
      'Password must not exceed 72 UTF-8 bytes.'),
  role: z.enum(['CLIENT', 'TECHNICIAN'], { error: 'Role must be CLIENT or TECHNICIAN.' }),
});

export const userIdSchema = z.object({
  id: z.string({ error: 'User ID is required and must be a string.' })
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'User ID must be a valid UUID.'),
});
