const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const { getDb, saveDb, makeId, findUserByEmail } = require('../pastoral/db');
const {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireRoles,
} = require('../pastoral/auth');
const authRouter = require('./auth');
const sendRecoveryEmail = authRouter.sendRecoveryEmail;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const VALID_PASTORAL_STATUSES = ['Activa', 'En Formación', 'Pausa'];
const VALID_PROSPECT_STAGES = [
  'Nuevo Prospecto',
  'Contactado',
  'En Acogida',
  'Integrado a Parroquia',
  'Archivado',
];
const VALID_MEMBER_STATUSES = ['Activo', 'En Formación', 'Inactivo'];
const VALID_EVENT_STATUSES = ['Programado', 'En Curso', 'Realizado', 'Cancelado'];
const VALID_ROLES = [
  'admin_diocesano',
  'coordinador_pastoral',
  'secretario_tesorero',
];

function cleanStr(value, maxLen = 240) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resolveScopedPastoralId(req, requestedPastoralId) {
  if (!req.authUser) return null;
  if (req.authUser.role === 'admin_diocesano') {
    const candidate = cleanStr(requestedPastoralId, 60);
    if (!candidate || candidate === 'all') return null;
    return candidate;
  }
  return req.authUser.pastoralId;
}

function hasPastoralAccess(req, recordPastoralId) {
  if (!req.authUser) return false;
  if (req.authUser.role === 'admin_diocesano') return true;
  return Boolean(req.authUser.pastoralId && req.authUser.pastoralId === recordPastoralId);
}

// ==========================================
// 1. PUBLIC PORTAL ENDPOINTS
// ==========================================

router.get('/api/public/overview', (_req, res) => {
  const db = getDb();
  const activePastorals = db.pastorals.filter((p) => p.status === 'Activa');
  const publicEvents = db.events
    .filter((e) => e.isPublic)
    .sort((a, b) => b.date.localeCompare(a.date));

  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  const celebrations = db.members
    .filter((m) => m.status === 'Activo' && m.birthDate)
    .slice(0, 3)
    .map((m) => {
      const parts = m.birthDate.split('-');
      const monthIdx = Math.max(0, Math.min(11, Number(parts[1] || '1') - 1));
      const day = Number(parts[2] || '1');
      return {
        id: `cel-${m.id}`,
        kind: 'birthday',
        title: m.fullName,
        subtitle: m.roleTitle,
        dateLabel: `${day} de ${monthNames[monthIdx]}`,
        parishOrRole: m.parish,
      };
    });

  celebrations.unshift({
    id: 'cel-anniv-sjo',
    kind: 'anniversary',
    title: 'Pastoral Juvenil P. San José Obrero',
    subtitle: '3 Años de servicio y entrega pastoral',
    dateLabel: '5 de noviembre',
    parishOrRole: 'Zona Centro-Oeste',
  });

  const payload = {
    stats: {
      activePastorals: activePastorals.length,
      registeredMembers: db.members.length,
      upcomingEvents: publicEvents.filter((e) => e.status === 'Programado').length,
      parishesReached: new Set(activePastorals.map((p) => p.zonaArciprestal || p.decanato)).size,
    },
    pastorals: db.pastorals,
    parishes: db.parishes || [],
    events: publicEvents,
    celebrations,
  };

  res.json(payload);
});

router.post('/api/public/leads', (req, res) => {
  const fullName = cleanStr(req.body?.fullName, 120);
  const parish = cleanStr(req.body?.parish, 120);
  const decanato = cleanStr(req.body?.zona || req.body?.decanato, 120) || 'Zona Chiclayo Centro';
  const phone = cleanStr(req.body?.phone, 40);
  const email = cleanStr(req.body?.email, 120);
  const pastoralId = cleanStr(req.body?.pastoralId, 60);
  const notes = cleanStr(req.body?.notes, 500);

  if (fullName.length < 3) {
    return res.status(400).json({ error: 'Ingresa tu nombre completo (mínimo 3 caracteres).' });
  }
  if (parish.length < 2) {
    return res.status(400).json({ error: 'Indica tu parroquia o comunidad de origen.' });
  }
  if (phone.length < 6 && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Ingresa un número de teléfono/WhatsApp o correo válido.' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: 'El formato del correo electrónico no es válido.' });
  }

  const db = getDb();
  const matchedPastoral = db.pastorals.find((p) => p.id === pastoralId) ?? db.pastorals[0];
  const today = new Date().toISOString().slice(0, 10);

  const newProspect = {
    id: makeId('pro'),
    fullName,
    parish,
    decanato,
    phone: phone || 'No registrado',
    email: email || 'Sin correo',
    pastoralId: matchedPastoral ? matchedPastoral.id : 'pas-juvenil',
    source: 'Web Pública',
    stage: 'Nuevo Prospecto',
    notes: notes || 'Solicitud registrada desde el portal web público.',
    assignedTo: matchedPastoral ? matchedPastoral.coordinatorName : 'Coordinación Diocesana',
    createdAt: today,
    updatedAt: today,
  };

  saveDb((draft) => {
    draft.prospects.unshift(newProspect);
  });

  res.status(201).json({
    message: 'Registro recibido con bendición. Un coordinador pastoral se pondrá en contacto contigo.',
    prospectId: newProspect.id,
  });
});

// ==========================================
// 2. AUTH & BOOTSTRAP ENDPOINTS (usuarios_pj)
// ==========================================

// 1. Registro en nueva tabla usuarios_pj
router.post('/api/pastoral/auth/register', async (req, res) => {
  try {
    const usuario = cleanStr(req.body?.usuario, 60).toLowerCase();
    const nombreCompleto = cleanStr(req.body?.nombreCompleto || req.body?.name, 120);
    const correo = cleanStr(req.body?.correo || req.body?.email, 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const pastoralId = cleanStr(req.body?.pastoralId, 80) || 'general';
    const pastoralNombre = cleanStr(req.body?.pastoralNombre, 150) || 'Coordinación General / Por Definir';
    const telefono = cleanStr(req.body?.telefono, 30);
    const parroquia = cleanStr(req.body?.parroquia, 150) || 'Por asignar';
    const zona = cleanStr(req.body?.zona || req.body?.decanato, 150) || 'Zona Chiclayo Centro';
    const rol = cleanStr(req.body?.rol, 50) || 'miembro';

    if (!usuario || usuario.length < 3) {
      return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }
    if (!nombreCompleto || nombreCompleto.length < 3) {
      return res.status(400).json({ error: 'Ingresa tu nombre completo.' });
    }
    if (!isValidEmail(correo)) {
      return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Verificar si ya existe usuario o correo en usuarios_pj
    const { data: existingUsers } = await supabase
      .from('usuarios_pj')
      .select('id, usuario, correo')
      .or(`correo.eq.${correo},usuario.eq.${usuario}`);

    if (existingUsers && existingUsers.length > 0) {
      const match = existingUsers[0];
      if (match.correo.toLowerCase() === correo) {
        return res.status(409).json({ error: 'Ya existe una cuenta registrada con este correo electrónico.' });
      }
      return res.status(409).json({ error: 'El nombre de usuario ya está en uso. Por favor elige otro.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: newUser, error: insertError } = await supabase
      .from('usuarios_pj')
      .insert({
        usuario,
        nombre_completo: nombreCompleto,
        correo,
        password_hash: passwordHash,
        pastoral_id: pastoralId,
        pastoral_nombre: pastoralNombre,
        rol,
        telefono,
        parroquia,
        decanato: zona,
        zona,
        estado: 'activo'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error insertando en usuarios_pj:', insertError);
      return res.status(500).json({ error: 'Error al registrar usuario en la base de datos diocesana.' });
    }

    const token = signToken(newUser.id, newUser.rol);

    res.status(201).json({
      success: true,
      message: '¡Cuenta creada con bendición en la Pastoral Juvenil de Chiclayo!',
      token,
      user: {
        id: newUser.id,
        usuario: newUser.usuario,
        name: newUser.nombre_completo,
        email: newUser.correo,
        role: newUser.rol,
        pastoralId: newUser.pastoral_id,
        pastoralNombre: newUser.pastoral_nombre,
        parroquia: newUser.parroquia,
        telefono: newUser.telefono,
        createdAt: newUser.created_at,
      }
    });
  } catch (err) {
    console.error('Error en register:', err);
    res.status(500).json({ error: 'Error interno del servidor al procesar el registro.' });
  }
});

// 2. Iniciar sesión desde usuarios_pj
router.post('/api/pastoral/auth/login', async (req, res) => {
  try {
    const loginInput = cleanStr(req.body?.login || req.body?.email || req.body?.usuario, 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!loginInput || !password) {
      return res.status(400).json({ error: 'Ingresa tu usuario/correo y contraseña.' });
    }

    const { data: users, error: searchError } = await supabase
      .from('usuarios_pj')
      .select('*')
      .or(`correo.eq.${loginInput},usuario.eq.${loginInput}`)
      .limit(1);

    if (searchError || !users || users.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos en el sistema pastoral.' });
    }

    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = signToken(user.id, user.rol);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        usuario: user.usuario,
        name: user.nombre_completo,
        email: user.correo,
        role: user.rol,
        pastoralId: user.pastoral_id,
        pastoralNombre: user.pastoral_nombre,
        parroquia: user.parroquia,
        telefono: user.telefono,
        createdAt: user.created_at,
      }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión en el servidor.' });
  }
});

// 3. Solicitar código de recuperación de contraseña
router.post('/api/pastoral/auth/forgot-password', async (req, res) => {
  try {
    const loginInput = cleanStr(req.body?.login || req.body?.email || req.body?.correo, 120).toLowerCase();
    if (!loginInput) {
      return res.status(400).json({ error: 'Ingresa tu correo electrónico o nombre de usuario.' });
    }

    const { data: users, error } = await supabase
      .from('usuarios_pj')
      .select('id, correo, usuario, nombre_completo')
      .or(`correo.eq.${loginInput},usuario.eq.${loginInput}`)
      .limit(1);

    if (error || !users || users.length === 0) {
      return res.status(404).json({ error: 'No se encontró ninguna cuenta asociada a este correo o usuario.' });
    }

    const user = users[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutos

    await supabase
      .from('usuarios_pj')
      .update({
        reset_token: code,
        reset_token_expires: expires,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    // Enviar código real por correo electrónico (Brevo / Nodemailer)
    let emailResult = { sent: false };
    if (typeof sendRecoveryEmail === 'function') {
      try {
        emailResult = await sendRecoveryEmail({
          toEmail: user.correo,
          toName: user.nombre_completo || user.usuario || 'Hermano(a)',
          code
        });
      } catch (e) {
        console.error('Error enviando correo de recuperación en usuarios_pj:', e.message);
      }
    }

    const emailMasked = user.correo.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c);

    res.json({
      success: true,
      message: `Código de recuperación enviado a ${emailMasked}. Revisa tu bandeja de entrada o spam.`,
      emailMasked,
      emailSent: emailResult.sent,
      ...(emailResult.isDev ? { code } : {}) // Solo muestra el código en pantalla si no hay credenciales SMTP configuradas
    });
  } catch (err) {
    console.error('Error en forgot-password:', err);
    res.status(500).json({ error: 'Error al procesar la solicitud de recuperación.' });
  }
});

// 3.1 Verificar código de recuperación antes de crear nueva contraseña
router.post('/api/pastoral/auth/verify-code', async (req, res) => {
  try {
    const loginInput = cleanStr(req.body?.login || req.body?.email || req.body?.correo, 120).toLowerCase();
    const code = cleanStr(req.body?.code, 20);

    if (!loginInput || !code) {
      return res.status(400).json({ error: 'Ingresa tu usuario/correo y el código de verificación.' });
    }

    const { data: users, error } = await supabase
      .from('usuarios_pj')
      .select('id, reset_token, reset_token_expires')
      .or(`correo.eq.${loginInput},usuario.eq.${loginInput}`)
      .limit(1);

    if (error || !users || users.length === 0) {
      return res.status(404).json({ error: 'No se encontró la cuenta asociada.' });
    }

    const user = users[0];
    if (!user.reset_token || user.reset_token !== code) {
      return res.status(400).json({ error: 'El código de verificación ingresado es incorrecto.' });
    }

    if (new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ error: 'El código de verificación ha expirado. Solicita uno nuevo.' });
    }

    res.json({
      success: true,
      message: 'Código verificado correctamente. Ahora puedes crear tu nueva contraseña.'
    });
  } catch (err) {
    console.error('Error en verify-code:', err);
    res.status(500).json({ error: 'Error al verificar el código.' });
  }
});

// 4. Restablecer contraseña con código
router.post('/api/pastoral/auth/reset-password', async (req, res) => {
  try {
    const loginInput = cleanStr(req.body?.login || req.body?.email || req.body?.correo, 120).toLowerCase();
    const code = cleanStr(req.body?.code, 20);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!loginInput || !code || !newPassword) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const { data: users, error } = await supabase
      .from('usuarios_pj')
      .select('id, reset_token, reset_token_expires')
      .or(`correo.eq.${loginInput},usuario.eq.${loginInput}`)
      .limit(1);

    if (error || !users || users.length === 0) {
      return res.status(404).json({ error: 'Cuenta no encontrada.' });
    }

    const user = users[0];
    if (!user.reset_token || user.reset_token !== code) {
      return res.status(400).json({ error: 'El código de verificación ingresado es incorrecto.' });
    }
    if (new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ error: 'El código de verificación ha expirado. Solicita uno nuevo.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase
      .from('usuarios_pj')
      .update({
        password_hash: newHash,
        reset_token: null,
        reset_token_expires: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    res.json({
      success: true,
      message: '¡Contraseña restablecida exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
    });
  } catch (err) {
    console.error('Error en reset-password:', err);
    res.status(500).json({ error: 'Error al restablecer contraseña.' });
  }
});

router.get('/api/auth/status', (_req, res) => {
  const db = getDb();
  res.json({
    needsSetup: false,
    hasUsers: true,
  });
});

router.post('/api/auth/bootstrap', (req, res) => {
  const db = getDb();
  if (db.users.length > 0) {
    return res.status(409).json({ error: 'El administrador inicial ya fue configurado. Inicia sesión.' });
  }

  const name = cleanStr(req.body?.name, 100);
  const email = cleanStr(req.body?.email, 120).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (name.length < 3) {
    return res.status(400).json({ error: 'El nombre debe tener al menos 3 caracteres.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  const adminUser = {
    id: makeId('usr'),
    name,
    email,
    role: 'admin_diocesano',
    pastoralId: null,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString().slice(0, 10),
  };

  saveDb((draft) => {
    if (draft.users.length === 0) {
      draft.users.push(adminUser);
    }
  });

  const token = signToken(adminUser.id, adminUser.role);
  res.status(201).json({
    token,
    user: {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: adminUser.role,
      pastoralId: adminUser.pastoralId,
      createdAt: adminUser.createdAt,
    },
  });
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

// ==========================================
// 3. ERP DASHBOARD & PASTORALS
// ==========================================

router.get('/api/erp/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const isGlobalAdmin =
    req.authUser?.role === 'admin_diocesano' ||
    req.authUser?.role === 'admin' ||
    req.authUser?.email === 'danielitoeltravieso2000@gmail.com';

  if (!isGlobalAdmin && !req.authUser?.pastoralId) {
    return res.status(403).json({
      error: 'Tu cuenta no tiene una pastoral asignada. Solicita al Administrador Diocesano asignarte una.',
    });
  }

  const activeScopeId = resolveScopedPastoralId(req, req.query.pastoralId);
  const activePastoral = activeScopeId
    ? db.pastorals.find((p) => p.id === activeScopeId) ?? null
    : null;

  const scopedPastorals = activeScopeId
    ? db.pastorals.filter((p) => p.id === activeScopeId)
    : db.pastorals;
  const scopedMembers = activeScopeId
    ? db.members.filter((m) => m.pastoralId === activeScopeId)
    : db.members;
  const scopedProspects = activeScopeId
    ? db.prospects.filter((p) => p.pastoralId === activeScopeId)
    : db.prospects;
  const scopedEvents = activeScopeId
    ? db.events.filter((e) => e.pastoralId === activeScopeId)
    : db.events;
  const scopedFinances = activeScopeId
    ? db.finances.filter((f) => f.pastoralId === activeScopeId)
    : db.finances;
  const scopedDocuments = activeScopeId
    ? db.documents.filter((d) => d.pastoralId === activeScopeId)
    : db.documents;

  const totalIncome = scopedFinances
    .filter((f) => f.type === 'Ingreso')
    .reduce((sum, f) => sum + f.amountPen, 0);
  const totalExpense = scopedFinances
    .filter((f) => f.type === 'Egreso')
    .reduce((sum, f) => sum + f.amountPen, 0);

  res.json({
    scopedPastoralId: activeScopeId,
    activePastoral,
    availablePastorals:
      isGlobalAdmin ? db.pastorals : scopedPastorals,
    pastorals: scopedPastorals,
    parishes: db.parishes || [],
    members: scopedMembers,
    prospects: scopedProspects,
    events: scopedEvents,
    finances: scopedFinances,
    documents: scopedDocuments,
    summary: {
      activePastorals: scopedPastorals.filter((p) => p.status === 'Activa').length,
      totalPastorals: scopedPastorals.length,
      activeMembers: scopedMembers.filter((m) => m.status === 'Activo').length,
      openProspects: scopedProspects.filter(
        (p) => p.stage !== 'Integrado a Parroquia' && p.stage !== 'Archivado',
      ).length,
      upcomingEvents: scopedEvents.filter((e) => e.status === 'Programado').length,
      balancePen: totalIncome - totalExpense,
      totalIncomePen: totalIncome,
      totalExpensePen: totalExpense,
    },
  });
});

router.post('/api/erp/pastorals', requireAuth, requireRoles('admin_diocesano'), (req, res) => {
  const name = cleanStr(req.body?.name, 120);
  const shortName = cleanStr(req.body?.shortName, 40) || name.slice(0, 24);
  const code = cleanStr(req.body?.code, 16) || `P-${Math.floor(10 + Math.random() * 89)}`;
  const coordinatorName = cleanStr(req.body?.coordinatorName, 100);
  const adviserName = cleanStr(req.body?.adviserName, 100) || 'Por asignar';
  const parishCount = Math.max(0, Math.min(200, Number(req.body?.parishCount) || 0));
  const focusArea = cleanStr(req.body?.focusArea, 140);
  const status = VALID_PASTORAL_STATUSES.includes(req.body?.status) ? req.body.status : 'Activa';
  const accentColor = cleanStr(req.body?.accentColor, 20) || '#0A6EB4';
  const description = cleanStr(req.body?.description, 400);

  if (name.length < 3 || coordinatorName.length < 3) {
    return res.status(400).json({ error: 'El nombre de la pastoral y del coordinador son obligatorios.' });
  }

  const item = {
    id: makeId('pas'),
    code,
    name,
    shortName,
    coordinatorName,
    adviserName,
    parishCount,
    focusArea: focusArea || 'Coordinación Diocesana',
    status,
    accentColor,
    description: description || 'Pastoral registrada en el sistema diocesano.',
    createdAt: new Date().toISOString().slice(0, 10),
  };

  saveDb((draft) => {
    draft.pastorals.push(item);
  });

  res.status(201).json(item);
});

router.patch(
  '/api/erp/pastorals/:id',
  requireAuth,
  requireRoles('admin_diocesano', 'coordinador_pastoral'),
  (req, res) => {
    const { id } = req.params;
    if (!hasPastoralAccess(req, id)) {
      return res.status(403).json({ error: 'Solo puedes personalizar los datos de tu propia pastoral.' });
    }
    const db = getDb();
    const existing = db.pastorals.find((p) => p.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Pastoral no encontrada.' });
    }

    saveDb((draft) => {
      const target = draft.pastorals.find((p) => p.id === id);
      if (!target) return;
      if (req.body?.name) target.name = cleanStr(req.body.name, 120);
      if (req.body?.shortName) target.shortName = cleanStr(req.body.shortName, 40);
      if (req.body?.coordinatorName) target.coordinatorName = cleanStr(req.body.coordinatorName, 100);
      if (req.body?.adviserName) target.adviserName = cleanStr(req.body.adviserName, 100);
      if (req.body?.parishCount !== undefined) {
        target.parishCount = Math.max(0, Math.min(200, Number(req.body.parishCount) || 0));
      }
      if (req.body?.focusArea) target.focusArea = cleanStr(req.body.focusArea, 140);
      if (req.authUser?.role === 'admin_diocesano' && VALID_PASTORAL_STATUSES.includes(req.body?.status)) {
        target.status = req.body.status;
      }
      if (req.body?.accentColor) target.accentColor = cleanStr(req.body.accentColor, 20);
      if (req.body?.description) target.description = cleanStr(req.body.description, 400);
    });

    res.json(getDb().pastorals.find((p) => p.id === id));
  },
);

router.delete('/api/erp/pastorals/:id', requireAuth, requireRoles('admin_diocesano'), (req, res) => {
  const { id } = req.params;
  const db = getDb();
  if (!db.pastorals.some((p) => p.id === id)) {
    return res.status(404).json({ error: 'Pastoral no encontrada.' });
  }
  saveDb((draft) => {
    draft.pastorals = draft.pastorals.filter((p) => p.id !== id);
  });
  res.json({ deleted: true });
});

// ==========================================
// 4. CRM PROSPECTS
// ==========================================

router.post('/api/crm/prospects', requireAuth, (req, res) => {
  const fullName = cleanStr(req.body?.fullName, 120);
  const parish = cleanStr(req.body?.parish, 120);
  const decanato = cleanStr(req.body?.zona || req.body?.decanato, 120) || 'Zona Chiclayo Centro';
  const phone = cleanStr(req.body?.phone, 40);
  const email = cleanStr(req.body?.email, 120);
  const forcedPastoral = resolveScopedPastoralId(req, req.body?.pastoralId);
  const pastoralId = forcedPastoral || cleanStr(req.body?.pastoralId, 60) || 'pas-juvenil';
  const assignedTo = cleanStr(req.body?.assignedTo, 100) || req.authUser?.name || 'Coordinación Pastoral';
  const notes = cleanStr(req.body?.notes, 500);
  const stage = VALID_PROSPECT_STAGES.includes(req.body?.stage) ? req.body.stage : 'Nuevo Prospecto';

  if (fullName.length < 3 || parish.length < 2) {
    return res.status(400).json({ error: 'Nombre completo y parroquia son obligatorios.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const prospect = {
    id: makeId('pro'),
    fullName,
    parish,
    decanato,
    phone: phone || 'Sin teléfono',
    email: email || 'Sin correo',
    pastoralId,
    source: 'Parroquia',
    stage,
    notes,
    assignedTo,
    createdAt: today,
    updatedAt: today,
  };

  saveDb((draft) => {
    draft.prospects.unshift(prospect);
  });

  res.status(201).json(prospect);
});

router.patch('/api/crm/prospects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prospects.find((p) => p.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'Prospecto no encontrado.' });
  }
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a prospectos de otra pastoral.' });
  }

  saveDb((draft) => {
    const target = draft.prospects.find((p) => p.id === id);
    if (!target) return;
    if (VALID_PROSPECT_STAGES.includes(req.body?.stage)) {
      target.stage = req.body.stage;
    }
    if (req.body?.notes !== undefined) target.notes = cleanStr(req.body.notes, 500);
    if (req.body?.assignedTo) target.assignedTo = cleanStr(req.body.assignedTo, 100);
    if (req.authUser?.role === 'admin_diocesano' && req.body?.pastoralId) {
      target.pastoralId = cleanStr(req.body.pastoralId, 60);
    }
    target.updatedAt = new Date().toISOString().slice(0, 10);
  });

  res.json(getDb().prospects.find((p) => p.id === id));
});

router.post('/api/crm/prospects/:id/convert', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const prospect = db.prospects.find((p) => p.id === id);
  if (!prospect) {
    return res.status(404).json({ error: 'Prospecto no encontrado.' });
  }
  if (!hasPastoralAccess(req, prospect.pastoralId)) {
    return res.status(403).json({ error: 'No tienes permisos para convertir prospectos de otra pastoral.' });
  }

  const roleTitle = cleanStr(req.body?.roleTitle, 80) || 'Miembro Activo';
  const birthDate = cleanStr(req.body?.birthDate, 20) || '2000-01-01';
  const today = new Date().toISOString().slice(0, 10);

  const newMember = {
    id: makeId('mem'),
    fullName: prospect.fullName,
    roleTitle,
    pastoralId: prospect.pastoralId,
    parish: prospect.parish,
    decanato: prospect.decanato,
    phone: prospect.phone,
    email: prospect.email,
    birthDate,
    joinedDate: today,
    status: 'Activo',
  };

  saveDb((draft) => {
    const targetProspect = draft.prospects.find((p) => p.id === id);
    if (targetProspect) {
      targetProspect.stage = 'Integrado a Parroquia';
      targetProspect.updatedAt = today;
    }
    draft.members.unshift(newMember);
  });

  res.status(201).json({ member: newMember });
});

router.delete('/api/crm/prospects/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prospects.find((p) => p.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'Prospecto no encontrado.' });
  }
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a prospectos de otra pastoral.' });
  }
  saveDb((draft) => {
    draft.prospects = draft.prospects.filter((p) => p.id !== id);
  });
  res.json({ deleted: true });
});

// ==========================================
// 5. MEMBERS, EVENTS, FINANCES, DOCUMENTS
// ==========================================

router.post('/api/erp/members', requireAuth, (req, res) => {
  const fullName = cleanStr(req.body?.fullName, 120);
  const roleTitle = cleanStr(req.body?.roleTitle, 80) || 'Miembro';
  const forcedPastoral = resolveScopedPastoralId(req, req.body?.pastoralId);
  const pastoralId = forcedPastoral || cleanStr(req.body?.pastoralId, 60) || 'pas-juvenil';
  const parish = cleanStr(req.body?.parish, 120);
  const decanato = cleanStr(req.body?.zona || req.body?.decanato, 120) || 'Zona Chiclayo Centro';
  const phone = cleanStr(req.body?.phone, 40);
  const email = cleanStr(req.body?.email, 120);
  const birthDate = cleanStr(req.body?.birthDate, 20) || '2001-01-01';
  const status = VALID_MEMBER_STATUSES.includes(req.body?.status) ? req.body.status : 'Activo';

  if (fullName.length < 3 || parish.length < 2) {
    return res.status(400).json({ error: 'Nombre y parroquia son requeridos.' });
  }

  const member = {
    id: makeId('mem'),
    fullName,
    roleTitle,
    pastoralId,
    parish,
    decanato,
    phone: phone || 'Sin teléfono',
    email: email || 'Sin correo',
    birthDate,
    joinedDate: new Date().toISOString().slice(0, 10),
    status,
  };

  saveDb((draft) => {
    draft.members.unshift(member);
  });

  res.status(201).json(member);
});

router.patch('/api/erp/members/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.members.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: 'Miembro no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a miembros de otra pastoral.' });
  }

  saveDb((draft) => {
    const target = draft.members.find((m) => m.id === id);
    if (!target) return;
    if (req.body?.fullName) target.fullName = cleanStr(req.body.fullName, 120);
    if (req.body?.roleTitle) target.roleTitle = cleanStr(req.body.roleTitle, 80);
    if (req.body?.parish) target.parish = cleanStr(req.body.parish, 120);
    if (req.body?.decanato || req.body?.zona) target.decanato = cleanStr(req.body.zona || req.body.decanato, 120);
    if (req.body?.phone) target.phone = cleanStr(req.body.phone, 40);
    if (req.body?.email) target.email = cleanStr(req.body.email, 120);
    if (req.body?.birthDate) target.birthDate = cleanStr(req.body.birthDate, 20);
    if (VALID_MEMBER_STATUSES.includes(req.body?.status)) target.status = req.body.status;
  });

  res.json(getDb().members.find((m) => m.id === id));
});

router.delete('/api/erp/members/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.members.find((m) => m.id === id);
  if (!existing) return res.status(404).json({ error: 'Miembro no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a miembros de otra pastoral.' });
  }
  saveDb((draft) => {
    draft.members = draft.members.filter((m) => m.id !== id);
  });
  res.json({ deleted: true });
});

router.post('/api/erp/events', requireAuth, (req, res) => {
  const title = cleanStr(req.body?.title, 140);
  const forcedPastoral = resolveScopedPastoralId(req, req.body?.pastoralId);
  const pastoralId = forcedPastoral || cleanStr(req.body?.pastoralId, 60) || 'pas-juvenil';
  const parishHost = cleanStr(req.body?.parishHost, 120);
  const eventType = req.body?.eventType || 'Jornada';
  const date = cleanStr(req.body?.date, 20) || new Date().toISOString().slice(0, 10);
  const time = cleanStr(req.body?.time, 20) || '19:00';
  const location = cleanStr(req.body?.location, 160);
  const capacity = Math.max(10, Math.min(5000, Number(req.body?.capacity) || 100));
  const isPublic = Boolean(req.body?.isPublic);
  const status = VALID_EVENT_STATUSES.includes(req.body?.status) ? req.body.status : 'Programado';
  const description = cleanStr(req.body?.description, 500);

  if (title.length < 3 || location.length < 3) {
    return res.status(400).json({ error: 'Título y lugar son requeridos.' });
  }

  const evt = {
    id: makeId('evt'),
    title,
    pastoralId,
    parishHost,
    eventType,
    date,
    time,
    location,
    capacity,
    registeredCount: 0,
    isPublic,
    status,
    description,
  };

  saveDb((draft) => {
    draft.events.unshift(evt);
  });

  res.status(201).json(evt);
});

router.patch('/api/erp/events/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.events.find((e) => e.id === id);
  if (!existing) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a eventos de otra pastoral.' });
  }

  saveDb((draft) => {
    const target = draft.events.find((e) => e.id === id);
    if (!target) return;
    if (req.body?.title) target.title = cleanStr(req.body.title, 140);
    if (req.body?.location) target.location = cleanStr(req.body.location, 160);
    if (req.body?.date) target.date = cleanStr(req.body.date, 20);
    if (req.body?.time) target.time = cleanStr(req.body.time, 20);
    if (VALID_EVENT_STATUSES.includes(req.body?.status)) target.status = req.body.status;
    if (req.body?.isPublic !== undefined) target.isPublic = Boolean(req.body.isPublic);
  });

  res.json(getDb().events.find((e) => e.id === id));
});

router.delete('/api/erp/events/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.events.find((e) => e.id === id);
  if (!existing) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a eventos de otra pastoral.' });
  }
  saveDb((draft) => {
    draft.events = draft.events.filter((e) => e.id !== id);
  });
  res.json({ deleted: true });
});

router.post('/api/erp/finances', requireAuth, (req, res) => {
  const concept = cleanStr(req.body?.concept, 140);
  const amountPen = Math.max(0, Number(req.body?.amountPen) || 0);
  const type = req.body?.type === 'Egreso' ? 'Egreso' : 'Ingreso';
  const forcedPastoral = resolveScopedPastoralId(req, req.body?.pastoralId);
  const pastoralId = forcedPastoral || cleanStr(req.body?.pastoralId, 60) || 'pas-juvenil';
  const category = cleanStr(req.body?.category, 60) || 'General';
  const reference = cleanStr(req.body?.reference, 60) || 'REC-S/N';

  if (concept.length < 3 || amountPen <= 0) {
    return res.status(400).json({ error: 'Concepto y monto válido son requeridos.' });
  }

  const fin = {
    id: makeId('fin'),
    date: new Date().toISOString().slice(0, 10),
    type,
    pastoralId,
    concept,
    category,
    amountPen,
    reference,
    recordedBy: req.authUser?.name || 'Tesorería',
  };

  saveDb((draft) => {
    draft.finances.unshift(fin);
  });

  res.status(201).json(fin);
});

router.delete('/api/erp/finances/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.finances.find((f) => f.id === id);
  if (!existing) return res.status(404).json({ error: 'Registro financiero no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a finanzas de otra pastoral.' });
  }
  saveDb((draft) => {
    draft.finances = draft.finances.filter((f) => f.id !== id);
  });
  res.json({ deleted: true });
});

router.post('/api/erp/documents', requireAuth, (req, res) => {
  const title = cleanStr(req.body?.title, 140);
  const docType = req.body?.docType || 'Prospecto';
  const forcedPastoral = resolveScopedPastoralId(req, req.body?.pastoralId);
  const pastoralId = forcedPastoral || cleanStr(req.body?.pastoralId, 60) || 'pas-juvenil';
  const summary = cleanStr(req.body?.summary, 500);

  if (title.length < 3) {
    return res.status(400).json({ error: 'El título del documento es obligatorio.' });
  }

  const doc = {
    id: makeId('doc'),
    title,
    docType,
    pastoralId,
    summary,
    date: new Date().toISOString().slice(0, 10),
    author: req.authUser?.name || 'Comisión Diocesana',
  };

  saveDb((draft) => {
    draft.documents.unshift(doc);
  });

  res.status(201).json(doc);
});

router.delete('/api/erp/documents/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.documents.find((d) => d.id === id);
  if (!existing) return res.status(404).json({ error: 'Documento no encontrado.' });
  if (!hasPastoralAccess(req, existing.pastoralId)) {
    return res.status(403).json({ error: 'No tienes acceso a documentos de otra pastoral.' });
  }
  saveDb((draft) => {
    draft.documents = draft.documents.filter((d) => d.id !== id);
  });
  res.json({ deleted: true });
});

module.exports = router;
