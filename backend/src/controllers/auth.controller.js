import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const refreshDays = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? 7);
if (!Number.isInteger(refreshDays) || refreshDays < 1 || refreshDays > 36500) {
  throw new Error('REFRESH_TOKEN_EXPIRES_DAYS must be an integer between 1 and 36500.');
}

function signAccessToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: '15m',
  });
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken(userId) {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    data: {
      userId, tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + refreshDays * 86400000),
    },
  };
}

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

    const accessToken = signAccessToken(user);
    const refresh = createRefreshToken(user.id);
    await prisma.refreshSession.create({ data: refresh.data });
    return res.json({
      accessToken,
      refreshToken: refresh.token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch {
    return res.status(500).json({ message: 'Unable to log in.' });
  }
}

export async function refresh(req, res) {
  const { refreshToken } = req.body ?? {};
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    return res.status(400).json({ message: 'Refresh token is required and must be a string.' });
  }

  try {
    const tokens = await prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash: hashToken(refreshToken) }, include: { user: true },
      });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) {
        return null;
      }

      const accessToken = signAccessToken(session.user);
      const replacement = createRefreshToken(session.userId);
      // A conditional update allows only one concurrent request to consume this session.
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) return null;
      await tx.refreshSession.create({ data: replacement.data });
      return { accessToken, refreshToken: replacement.token };
    });

    if (!tokens) return res.status(401).json({ message: 'Invalid refresh token.' });
    return res.json(tokens);
  } catch {
    return res.status(500).json({ message: 'Unable to refresh access token.' });
  }
}
