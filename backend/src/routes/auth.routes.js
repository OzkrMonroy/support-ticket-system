import { Router } from 'express';
import { login, refresh, logout } from '../controllers/auth.controller.js';

import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, refreshTokenSchema } from '../schemas/auth.schema.js';

const router = Router();

router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshTokenSchema), refresh);
router.post('/logout', validate(refreshTokenSchema), logout);

export default router;
