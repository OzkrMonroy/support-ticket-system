import { PrismaClient } from '@prisma/client';
import { createJob, dispatchJobs, publicJobSelect } from '../jobs/async-jobs.js';

const prisma = new PrismaClient();

const publicUserSelect = { id: true, name: true, email: true, role: true };
const ticketRelations = {
  createdBy: { select: publicUserSelect },
  assignedTo: { select: publicUserSelect },
};

function visibilityFilter(user) {
  if (user.role === 'ADMIN') return { deletedAt: null };
  if (user.role === 'CLIENT') return { deletedAt: null, createdById: user.id };
  return { deletedAt: null, assignedToId: user.id };
}

function canUpdateTicket(role, ticket, changes) {
  if (ticket.status === 'CLOSED') return false;
  const hasContent = Object.keys(changes).some((field) => field !== 'status');
  if (role === 'CLIENT') {
    if (ticket.status === 'OPEN') return changes.status === undefined;
    return ticket.status === 'RESOLVED' && !hasContent && changes.status === 'CLOSED';
  }
  if (role === 'TECHNICIAN' && (hasContent || ticket.status === 'RESOLVED')) return false;
  if (changes.status === undefined) return role === 'ADMIN';
  const nextStatus = { OPEN: 'IN_PROGRESS', IN_PROGRESS: 'RESOLVED', RESOLVED: 'CLOSED' };
  return changes.status === nextStatus[ticket.status] ||
    (role === 'ADMIN' && changes.status === 'CLOSED');
}

export async function deleteTicket(req, res) {
  try {
    const where = { id: req.params.id, ...visibilityFilter(req.user) };
    const ticket = await prisma.ticket.findFirst({ where });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    if (req.user.role === 'TECHNICIAN' ||
        (req.user.role === 'CLIENT' && ticket.status !== 'OPEN')) {
      return res.status(403).json({ message: 'Ticket deletion is not permitted.' });
    }
    // Recheck visibility and the client's permitted state when writing.
    const deleted = await prisma.ticket.updateMany({
      where: { ...where, ...(req.user.role === 'CLIENT' ? { status: 'OPEN' } : {}) },
      data: { deletedAt: new Date() },
    });
    if (deleted.count === 0) {
      const current = await prisma.ticket.findFirst({ where });
      return res.status(current ? 403 : 404).json({
        message: current ? 'Ticket deletion is not permitted.' : 'Ticket not found.',
      });
    }
    return res.status(204).end();
  } catch {
    return res.status(500).json({ message: 'Unable to delete ticket.' });
  }
}

export async function updateTicket(req, res) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const where = { id: req.params.id, ...visibilityFilter(req.user) };
      const ticket = await tx.ticket.findFirst({ where });
      if (!ticket) return { status: 404, body: { message: 'Ticket not found.' } };
      if (!canUpdateTicket(req.user.role, ticket, req.body)) {
        if (req.user.role === 'CLIENT' && req.body.status === 'CLOSED' && ticket.status !== 'RESOLVED') {
          return { status: 403, body: { message: 'Clients can only close resolved tickets.' } };
        }
        return { status: 403, body: { message: 'Ticket update is not permitted.' } };
      }
      // Recheck the starting state and visibility when writing to prevent stale transitions.
      const updated = await tx.ticket.updateMany({
        where: { ...where, status: ticket.status }, data: req.body,
      });
      if (updated.count === 0) {
        return { status: 403, body: { message: 'Ticket update is not permitted.' } };
      }
      const body = await tx.ticket.findUnique({ where: { id: ticket.id }, include: ticketRelations });
      if (['RESOLVED', 'CLOSED'].includes(req.body.status)) {
        await createJob(tx, 'EMAIL_NOTIFICATION', body, `TICKET_${req.body.status}`);
      }
      return { status: 200, body };
    });
    if (result.status === 200) await dispatchJobs(prisma, undefined, result.body.id);
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(500).json({ message: 'Unable to update ticket.' });
  }
}

export async function listTickets(req, res) {
  try {
    const tickets = await prisma.ticket.findMany({
      where: visibilityFilter(req.user),
      include: ticketRelations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return res.status(200).json(tickets);
  } catch {
    return res.status(500).json({ message: 'Unable to list tickets.' });
  }
}

export async function getTicket(req, res) {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, ...visibilityFilter(req.user) },
      include: ticketRelations,
    });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    return res.status(200).json(ticket);
  } catch {
    return res.status(500).json({ message: 'Unable to retrieve ticket.' });
  }
}

export async function createTicket(req, res) {
  const { title, description, priority } = req.body;
  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({ data: { title, description, priority, createdById: req.user.id } });
      await createJob(tx, 'TICKET_ASSIGNMENT', created);
      await createJob(tx, 'EMAIL_NOTIFICATION', created, 'TICKET_CREATED');
      return created;
    });
    await dispatchJobs(prisma, undefined, ticket.id);
    return res.status(201).json(ticket);
  } catch {
    return res.status(500).json({ message: 'Unable to create ticket.' });
  }
}

export async function getTicketJobs(req, res) {
  try {
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, ...visibilityFilter(req.user) } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    const jobs = await prisma.asyncJob.findMany({ where: { ticketId: ticket.id,
      ticket: visibilityFilter(req.user) }, select: publicJobSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return res.json(jobs);
  } catch { return res.status(500).json({ message: 'Unable to retrieve jobs.' }); }
}
