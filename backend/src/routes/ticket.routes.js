import { Router } from 'express';
import { createTicket, listTickets, getTicket, updateTicket, deleteTicket } from '../controllers/ticket.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createTicketSchema, ticketIdSchema, updateTicketSchema } from '../schemas/ticket.schema.js';

const router = Router();

router.get('/', authenticate, listTickets);
router.get('/:id', authenticate, validate(ticketIdSchema, 'params'), getTicket);
router.delete('/:id', authenticate, validate(ticketIdSchema, 'params'), deleteTicket);
router.patch('/:id', authenticate, validate(ticketIdSchema, 'params'),
  validate(updateTicketSchema), updateTicket);

router.post('/', authenticate, (req, res, next) => {
  if (!['CLIENT', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Client or administrator access required.' });
  }
  return next();
}, validate(createTicketSchema), createTicket);

export default router;
