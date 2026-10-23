import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export async function login(req, res) {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ message: 'Email and password are required strings.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const accessToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
    return res.json({
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch {
    return res.status(500).json({ message: 'Unable to log in.' });
  }
}
