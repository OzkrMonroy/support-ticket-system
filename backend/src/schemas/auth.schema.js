import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string({ error: 'Email is required and must be a string.' })
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address.'),
  password: z.string({ error: 'Password is required and must be a string.' })
    .refine((value) => value.trim().length > 0, 'Password is required.'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string({ error: 'Refresh token is required and must be a string.' })
    .refine((value) => value.trim().length > 0, 'Refresh token is required.'),
});
