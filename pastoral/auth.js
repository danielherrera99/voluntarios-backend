const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { findUserById } = require('./db');

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret() {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : EPHEMERAL_SECRET;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function signToken(uid, role) {
  const payload = {
    uid,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const segments = token.split('.');
  if (segments.length !== 2) {
    return null;
  }
  const [encoded, signature] = segments;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed.uid || !parsed.role || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesión requerida. Inicia sesión para acceder al ERP.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Tu sesión ha expirado o el token es inválido. Vuelve a iniciar sesión.' });
    return;
  }

  let user = findUserById(payload.uid);
  if (!user && supabase) {
    try {
      const { data, error } = await supabase
        .from('usuarios_pj')
        .select('*')
        .eq('id', payload.uid)
        .limit(1);
      if (!error && data && data.length > 0) {
        const u = data[0];
        user = {
          id: u.id,
          name: u.nombre_completo || u.usuario,
          email: u.correo,
          role: u.rol,
          pastoralId: u.pastoral_id,
          estado: u.estado
        };
      }
    } catch (e) {
      console.error('Error resolviendo usuario_pj en requireAuth:', e.message);
    }
  }

  if (!user) {
    res.status(401).json({ error: 'Usuario no encontrado o dado de baja.' });
    return;
  }

  if (user.estado && user.estado !== 'activo') {
    res.status(403).json({ error: 'Tu cuenta aún no está activa o ha sido suspendida.' });
    return;
  }

  req.authUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    pastoralId: user.pastoralId,
  };
  next();
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Sesión no autenticada.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Acción reservada para roles: ${allowedRoles.join(', ')}. Tu rol actual es ${req.authUser.role}.`,
      });
      return;
    }
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  requireRoles,
};
