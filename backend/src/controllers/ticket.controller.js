import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const publicUserSelect = { id: true, name: true, email: true, role: true };
const ticketRelations = {
  createdBy: { select: publicUserSelect },
  assignedTo: { select: publicUserSelect },
};

function visibilityFilter(user) {
  if (user.role === 'ADMIN') return {};
  if (user.role === 'CLIENT') return { createdById: user.id };
  return { assignedToId: user.id };
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
    const ticket = await prisma.ticket.create({
      data: { title, description, priority, createdById: req.user.id },
    });
    return res.status(201).json(ticket);
  } catch {
    return res.status(500).json({ message: 'Unable to create ticket.' });
  }
}
