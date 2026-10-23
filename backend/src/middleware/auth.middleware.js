import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export async function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return res.status(401).json({ message: 'Invalid access token.' });

  let payload;
  try {
    payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload.id !== 'string' || !payload.id ||
        !['ADMIN', 'CLIENT', 'TECHNICIAN'].includes(payload.role) ||
        !Number.isFinite(payload.exp)) {
      return res.status(401).json({ message: 'Invalid access token.' });
    }
  } catch {
    return res.status(401).json({ message: 'Invalid access token.' });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id }, select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid access token.' });
    }
    req.user = { id: user.id, role: user.role };
  } catch (error) {
    if (error.code === 'P2023') {
      return res.status(401).json({ message: 'Invalid access token.' });
    }
    return res.status(500).json({ message: 'Unable to authenticate user.' });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }
  return next();
}
