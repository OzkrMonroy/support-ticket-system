import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
