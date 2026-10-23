import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return res.status(401).json({ message: 'Invalid access token.' });

  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload.id !== 'string' || !payload.id ||
        !['ADMIN', 'CLIENT', 'TECHNICIAN'].includes(payload.role) ||
        !Number.isFinite(payload.exp)) {
      return res.status(401).json({ message: 'Invalid access token.' });
    }
    req.user = { id: payload.id, role: payload.role };
  } catch {
    return res.status(401).json({ message: 'Invalid access token.' });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }
  return next();
}
