import { Router } from 'express';
import { createUser, listUsers, deactivateUser } from '../controllers/user.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, requireAdmin, listUsers);
router.patch('/:id/deactivate', authenticate, requireAdmin, deactivateUser);
router.post('/', authenticate, requireAdmin, createUser);

export default router;
