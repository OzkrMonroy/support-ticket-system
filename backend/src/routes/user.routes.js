import { Router } from 'express';
import { createUser, listUsers, deactivateUser, getOwnProfile } from '../controllers/user.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

import { validate } from '../middleware/validate.middleware.js';
import { createUserSchema, userIdSchema } from '../schemas/user.schema.js';

const router = Router();

router.get('/me', authenticate, getOwnProfile);
router.get('/', authenticate, requireAdmin, listUsers);
router.patch('/:id/deactivate', authenticate, requireAdmin, validate(userIdSchema, 'params'), deactivateUser);
router.post('/', authenticate, requireAdmin, validate(createUserSchema), createUser);

export default router;
