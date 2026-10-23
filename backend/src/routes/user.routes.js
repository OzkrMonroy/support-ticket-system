import { Router } from 'express';
import { createUser } from '../controllers/user.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/', authenticate, requireAdmin, createUser);

export default router;
