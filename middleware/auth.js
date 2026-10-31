const jwt = require('jsonwebtoken');

const VALID_ROLES = new Set(['ADMIN', 'MANAGER', 'USER']);

function createAuthentication({ db, secret, issuer, audience }) {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes.');
  }

  return async function authenticate(req, res, next) {
    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    let claims;
    try {
      claims = jwt.verify(match[1], secret, {
        algorithms: ['HS256'],
        issuer,
        audience
      });
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
        return res.status(401).json({ error: 'Invalid or expired authentication token.' });
      }
      return next(error);
    }

    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Authentication token must have a valid expiry.' });
    }

    const userId = typeof claims.sub === 'string' ? Number(claims.sub) : NaN;
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return res.status(401).json({ error: 'Invalid authentication subject.' });
    }

    try {
      const { rows } = await db.query(
        'SELECT id, tenant_id, role, manager_id FROM users WHERE id = $1',
        [userId]
      );
      const user = rows[0];

      if (!user || !VALID_ROLES.has(user.role)) {
        return res.status(401).json({ error: 'Authenticated user is unavailable.' });
      }

      req.auth = Object.freeze({
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        managerId: user.manager_id
      });
      return next();
    } catch (error) {
      console.error('Authentication lookup failed:', error);
      return res.status(500).json({ error: 'Failed to authenticate request.' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    return next();
  };
}

module.exports = { createAuthentication, requireRole };
