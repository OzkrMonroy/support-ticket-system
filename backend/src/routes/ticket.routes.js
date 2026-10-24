import { Router } from 'express';
import { createTicket } from '../controllers/ticket.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createTicketSchema } from '../schemas/ticket.schema.js';

const router = Router();

router.post('/', authenticate, (req, res, next) => {
  if (!['CLIENT', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Client or administrator access required.' });
  }
  return next();
}, validate(createTicketSchema), createTicket);

export default router;
