export async function assignTicket(prisma, ticketId, onSkip = () => {}) {
  const skip = (reason) => {
    onSkip(reason);
    return 'skipped';
  };
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { deletedAt: true, assignedToId: true, status: true },
  });
  if (!ticket) return skip('not-found');
  if (ticket.deletedAt !== null) return skip('soft-deleted');
  if (ticket.assignedToId !== null) return skip('already-assigned');
  if (ticket.status !== 'OPEN') return skip('not-open');
  const technicians = await prisma.user.findMany({
    where: { role: 'TECHNICIAN', isActive: true },
    select: { id: true, _count: { select: { assignedTickets: { where: {
      deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] },
    } } } } },
    orderBy: { id: 'asc' },
  });
  if (!technicians.length) return 'no-technicians';
  const technician = technicians.reduce((best, current) =>
    current._count.assignedTickets < best._count.assignedTickets ? current : best);
  const result = await prisma.ticket.updateMany({
    where: { id: ticketId, deletedAt: null, assignedToId: null, status: 'OPEN' },
    data: { assignedToId: technician.id },
  });
  return result.count ? 'assigned' : skip('eligibility-changed');
}

export async function handleAssignment(channel, message, prisma, log = console) {
  if (!message) throw new Error('Assignment consumer cancelled.');
  let ticketId;
  try {
    ({ ticketId } = JSON.parse(message.content.toString()));
    if (typeof ticketId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
      throw new Error('Invalid assignment message.');
    }
    let skipReason;
    const outcome = await assignTicket(prisma, ticketId, (reason) => { skipReason = reason; });
    log.info(`Ticket assignment ${ticketId}: ${outcome}${skipReason ? ` (${skipReason})` : ''}`);
    channel.ack(message);
  } catch {
    log.error(`Ticket assignment failed${ticketId && /^[0-9a-f-]{36}$/i.test(ticketId) ? `: ${ticketId}` : ''}; rejected without requeue.`);
    channel.nack(message, false, false);
  }
}
