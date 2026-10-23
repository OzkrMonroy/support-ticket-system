import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    return res.status(201).json(user);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Email already exists.' });
    }
    return res.status(500).json({ message: 'Unable to create user.' });
  }
}
