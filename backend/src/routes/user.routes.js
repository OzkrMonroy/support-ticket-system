import { Router } from 'express';
import { createUser, listUsers, deactivateUser, getOwnProfile } from '../controllers/user.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/me', authenticate, getOwnProfile);
router.get('/', authenticate, requireAdmin, listUsers);
router.patch('/:id/deactivate', authenticate, requireAdmin, deactivateUser);
router.post('/', authenticate, requireAdmin, createUser);

export default router;
