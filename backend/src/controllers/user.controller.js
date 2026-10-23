import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const publicFields = { id: true, name: true, email: true, role: true, isActive: true };

export async function createUser(req, res) {
  const { name, email, password, role } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || !password.trim() ||
      Buffer.byteLength(password, 'utf8') > 72 ||
      !['CLIENT', 'TECHNICIAN'].includes(role)) {
    return res.status(400).json({ message: 'Valid name, email, password (maximum 72 UTF-8 bytes), and role (CLIENT or TECHNICIAN) are required.' });
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(), email: email.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(password, 12), role,
      },
      select: publicFields,
    });
    return res.status(201).json(user);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Email already exists.' });
    }
    return res.status(500).json({ message: 'Unable to create user.' });
  }
}

export async function listUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: publicFields, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return res.json(users);
  } catch {
    return res.status(500).json({ message: 'Unable to list users.' });
  }
}

export async function deactivateUser(req, res) {
  if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) {
    return res.status(403).json({ message: 'You cannot deactivate your own account.' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.params.id }, data: { isActive: false }, select: publicFields,
    });
    return res.json(user);
  } catch (error) {
    if (error.code === 'P2025' || error.code === 'P2023') {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.status(500).json({ message: 'Unable to deactivate user.' });
  }
}
