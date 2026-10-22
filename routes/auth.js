const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { logAudit } = require('../audit');
require('dotenv').config();

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const jwtSecret = process.env.JWT_SECRET || 'mi_secreto_super_seguro_jufra_2026';

const rateLimit = require('express-rate-limit');

// Rate limiter para login y registro (máx 20 intentos por 15 min por IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Demasiados intentos de acceso desde esta conexión. Por seguridad, intente en 15 minutos.' }
});

// Middleware para verificar que la petición proviene de un usuario autenticado
const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ msg: 'No se proporcionó token de autenticación' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded.user;
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token inválido o expirado' });
  }
};

// Middleware para verificar que la petición proviene de un Administrador
const requireAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ msg: 'No se proporcionó token de autenticación' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded.user;

    if (req.user.rol !== 'admin') {
      return res.status(403).json({ msg: 'Acceso denegado: Se requieren permisos de Administrador' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token inválido o expirado' });
  }
};

// ==============================================================================
// 0. VERIFICAR DNI EN EL PADRÓN DE VOLUNTARIOS (AUTOCOMPLETADO Y VÍNCULO)
// ==============================================================================
router.get('/verificar-dni/:dni', async (req, res) => {
  const { dni } = req.params;
  const cleanDni = String(dni || '').replace(/\D/g, '').trim();

  if (cleanDni.length < 8) {
    return res.status(400).json({ exists: false, msg: 'El DNI debe tener 8 dígitos.' });
  }

  try {
    // 1. Verificar si ya tiene cuenta en usuarios
    const { data: userAccount } = await supabase
      .from('usuarios')
      .select('id, correo, estado')
      .eq('dni', cleanDni)
      .maybeSingle();

    if (userAccount) {
      return res.json({
        existsInPadrón: false,
        hasAccount: true,
        accountStatus: userAccount.estado,
        msg: userAccount.estado === 'pendiente' 
          ? 'Ya existe una solicitud pendiente con este DNI.' 
          : 'Este DNI ya tiene una cuenta activa. Puedes iniciar sesión.'
      });
    }

    // 2. Buscar en paralelo en ambas tablas (Fase 1 General y Fase 2)
    const [resF1, resF2] = await Promise.all([
      supabase
        .from('voluntarios_general')
        .select('dni, nombres_apellidos, correo, telefono, distrito, jurisdiccion, estado')
        .eq('dni', cleanDni)
        .maybeSingle(),
      supabase
        .from('voluntarios')
        .select('dni, nombres_apellidos, correo, telefono, distrito, jurisdiccion, estado')
        .eq('dni', cleanDni)
        .maybeSingle()
    ]);

    const f1 = resF1.data || null;
    const f2 = resF2.data || null;

    if (f1 || f2) {
      // Priorizar el correo y teléfono de Fase 1 (que tiene la ficha completa de inscripción)
      const nombres = (f1?.nombres_apellidos || f2?.nombres_apellidos || '').trim();
      const correo = (f1?.correo || f2?.correo || '').trim();
      const telefono = (f1?.telefono || f2?.telefono || '').trim();
      const distrito = (f1?.distrito || f2?.distrito || f1?.jurisdiccion || f2?.jurisdiccion || '').trim();
      const fase = f2 ? 'Fase 2' : 'Fase 1';
      const estado = f2?.estado || f1?.estado || 'REGISTRADO';

      return res.json({
        existsInPadrón: true,
        hasAccount: false,
        voluntario: {
          nombres,
          correo,
          telefono,
          distrito,
          fase,
          estado
        }
      });
    }

    res.json({ existsInPadrón: false, hasAccount: false });
  } catch (err) {
    console.error('Error verificando DNI:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
// 1. SOLICITUD DE REGISTRO DE CUENTA AMARRADA A DNI (ESTILO JUFRA POMALCA)
// ==============================================================================
router.post('/register', authLimiter, async (req, res) => {
  const { nombre, email, password, telefono, dni } = req.body;

  try {
    if (!nombre || !email || !password || !dni) {
      return res.status(400).json({ msg: 'Por favor completa todos los campos requeridos, incluyendo tu DNI.' });
    }

    const cleanDni = String(dni).replace(/\D/g, '').trim();
    if (cleanDni.length !== 8) {
      return res.status(400).json({ msg: 'El DNI debe tener exactamente 8 dígitos numéricos.' });
    }

    // Validación de complejidad de contraseña (mínimo 8 caracteres, al menos 1 letra y 1 número)
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (password.length < 8 || !hasLetter || !hasNumber) {
      return res.status(400).json({
        msg: 'La contraseña debe tener al menos 8 caracteres y combinar letras y números.'
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Verificar si el correo ya existe
    const { data: existingEmail, error: emailErr } = await supabase
      .from('usuarios')
      .select('id, correo, estado')
      .eq('correo', cleanEmail);

    if (emailErr) throw emailErr;

    if (existingEmail && existingEmail.length > 0) {
      const existing = existingEmail[0];
      if (existing.estado === 'pendiente') {
        return res.status(400).json({
          msg: 'Ya existe una solicitud pendiente con este correo. Por favor espera a que el Administrador la apruebe.'
        });
      } else if (existing.estado === 'aprobado') {
        return res.status(400).json({
          msg: 'Este correo ya tiene una cuenta aprobada. Puedes iniciar sesión directamente.'
        });
      } else {
        return res.status(400).json({
          msg: 'Esta cuenta se encuentra rechazada o desactivada. Contacta al Administrador.'
        });
      }
    }

    // 2. Verificar si el DNI ya está registrado en usuarios
    const { data: existingDni, error: dniErr } = await supabase
      .from('usuarios')
      .select('id, dni, estado')
      .eq('dni', cleanDni);

    if (dniErr) throw dniErr;

    if (existingDni && existingDni.length > 0) {
      return res.status(400).json({
        msg: `El DNI ${cleanDni} ya tiene una cuenta o solicitud en el sistema.`
      });
    }

    // 3. Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 4. Insertar usuario amarrado a su DNI en estado 'pendiente'
    const { data: newUser, error: insertErr } = await supabase
      .from('usuarios')
      .insert([
        {
          dni: cleanDni,
          nombre: nombre.trim(),
          correo: cleanEmail,
          password_hash,
          telefono: telefono ? telefono.trim() : null,
          rol: 'comision',
          estado: 'pendiente'
        }
      ])
      .select('id, dni, nombre, correo, estado, created_at')
      .single();

    if (insertErr) throw insertErr;

    // Registrar en auditoría
    await logAudit({
      req,
      usuario: newUser,
      accion: 'REGISTRO_SOLICITUD',
      detalles: { dni: cleanDni, nombre: nombre.trim(), correo: cleanEmail, telefono }
    });

    res.status(201).json({
      success: true,
      msg: '¡Solicitud enviada con éxito! Tu cuenta está en revisión y debe ser aprobada por el Administrador antes de ingresar.',
      usuario: newUser
    });
  } catch (error) {
    console.error('Error en register:', error.message);
    res.status(500).json({ msg: 'Error interno del servidor al procesar el registro' });
  }
});

// ==============================================================================
// 2. INICIO DE SESIÓN (SOPORTA CORREO ELECTRÓNICO O DNI)
// ==============================================================================
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ msg: 'Ingresa correo/DNI y contraseña' });
    }

    const cleanInput = String(email).trim().toLowerCase();
    const isDni = /^\d{8}$/.test(cleanInput);

    // 1. Buscar usuario por correo O por DNI
    let query = supabase.from('usuarios').select('*');
    if (isDni) {
      query = query.or(`dni.eq.${cleanInput},correo.eq.${cleanInput}`);
    } else {
      query = query.eq('correo', cleanInput);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    if (!users || users.length === 0) {
      await logAudit({
        req,
        accion: 'LOGIN_FALLIDO',
        detalles: { input: cleanInput, motivo: 'Usuario no encontrado' }
      });
      return res.status(401).json({ msg: 'Credenciales inválidas' });
    }

    const user = users[0];

    // 2. Verificar contraseña con bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logAudit({
        req,
        usuario: { id: user.id, nombre: user.nombre, correo: user.correo },
        accion: 'LOGIN_FALLIDO',
        detalles: { input: cleanInput, motivo: 'Contraseña incorrecta' }
      });
      return res.status(401).json({ msg: 'Credenciales inválidas' });
    }

    // 3. Validar estado de la cuenta (Aprobación estilo Jufra)
    if (user.estado === 'pendiente') {
      return res.status(403).json({
        msg: '⏳ Tu cuenta está pendiente de aprobación por el Administrador. Podrás ingresar en cuanto sea autorizada.'
      });
    }

    if (user.estado === 'rechazado') {
      return res.status(403).json({
        msg: '❌ Tu solicitud de acceso fue rechazada o desactivada. Contacta al Administrador.'
      });
    }

    // 4. Generar JWT para usuarios aprobados con caducidad automática de 8 horas
    const payload = {
      user: {
        id: user.id,
        dni: user.dni || null,
        nombre: user.nombre,
        correo: user.correo,
        rol: user.rol || 'comision',
        estado: user.estado || 'aprobado',
        telefono: user.telefono || null,
        lider_nombre: user.lider_nombre || null,
        coordinador_nombre: user.coordinador_nombre || null
      }
    };

    jwt.sign(
      payload,
      jwtSecret,
      { expiresIn: '8h' }, // Sesión expira automáticamente tras 8 horas por seguridad
      async (err, token) => {
        if (err) throw err;

        // Registrar login exitoso en auditoría
        await logAudit({
          req,
          usuario: payload.user,
          accion: 'LOGIN_EXITOSO',
          detalles: { dni: user.dni, correo: user.correo, rol: user.rol }
        });

        res.json({ token, user: payload.user });
      }
    );
  } catch (error) {
    console.error('Error en login:', error.message);
    res.status(500).json({ msg: 'Error del servidor al iniciar sesión' });
  }
});

// ==============================================================================
// 3. MÓDULO EXCLUSIVO PARA ADMINISTRADOR: GESTIÓN DE SOLICITUDES Y USUARIOS
// ==============================================================================

// Obtener todas las solicitudes y usuarios enriquecidos con su estado en el Padrón
router.get('/solicitudes', requireAdmin, async (req, res) => {
  try {
    const { data: allUsers, error } = await supabase
      .from('usuarios')
      .select('id, dni, nombre, correo, telefono, rol, estado, created_at, lider_nombre, coordinador_nombre')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Obtener los DNIs de todos los usuarios
    const dnis = (allUsers || [])
      .map(u => u.dni ? String(u.dni).replace(/\D/g, '').trim() : null)
      .filter(Boolean);

    let f1Map = {};
    let f2Map = {};

    if (dnis.length > 0) {
      const [resF1, resF2] = await Promise.all([
        supabase
          .from('voluntarios_general')
          .select('dni, nombres_apellidos, estado, distrito, jurisdiccion')
          .in('dni', dnis),
        supabase
          .from('voluntarios')
          .select('dni, nombres_apellidos, estado, distrito, jurisdiccion')
          .in('dni', dnis)
      ]);

      (resF1.data || []).forEach(r => { if (r.dni) f1Map[r.dni] = r; });
      (resF2.data || []).forEach(r => { if (r.dni) f2Map[r.dni] = r; });
    }

    // Enriquecer cada usuario con la marca de si pertenece o no al Padrón
    const enrichedUsers = (allUsers || []).map(u => {
      const cleanDni = u.dni ? String(u.dni).replace(/\D/g, '').trim() : null;
      const f1 = cleanDni ? f1Map[cleanDni] : null;
      const f2 = cleanDni ? f2Map[cleanDni] : null;

      const inPadron = Boolean(f1 || f2);
      const padronFase = f2 ? 'Fase 2' : (f1 ? 'Fase 1' : null);
      const padronEstado = f2?.estado || f1?.estado || null;
      const padronDistrito = f1?.distrito || f2?.distrito || f1?.jurisdiccion || f2?.jurisdiccion || null;

      return {
        ...u,
        inPadron,
        padronFase,
        padronEstado,
        padronDistrito
      };
    });

    const pendientes = enrichedUsers.filter(u => u.estado === 'pendiente');
    const aprobados = enrichedUsers.filter(u => u.estado === 'aprobado');
    const rechazados = enrichedUsers.filter(u => u.estado === 'rechazado');

    res.json({
      pendientes,
      aprobados,
      rechazados,
      totalPendientes: pendientes.length,
      totalAprobados: aprobados.length
    });
  } catch (error) {
    console.error('Error obteniendo solicitudes:', error.message);
    res.status(500).json({ msg: 'Error al obtener lista de solicitudes' });
  }
});

// Aprobar una solicitud
router.put('/solicitudes/:id/aprobar', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { rol = 'comision' } = req.body;

  try {
    const { data, error } = await supabase
      .from('usuarios')
      .update({
        estado: 'aprobado',
        rol: rol
      })
      .eq('id', id)
      .select('id, dni, nombre, correo, rol, estado')
      .single();

    if (error) throw error;

    await logAudit({
      req,
      accion: 'USUARIO_APROBADO',
      detalles: {
        usuario_aprobado_id: id,
        nombre: data.nombre,
        dni: data.dni,
        rol: data.rol
      }
    });

    res.json({
      success: true,
      msg: `Usuario "${data.nombre}" (${data.dni || 'Sin DNI'}) aprobado con éxito como "${data.rol}".`,
      usuario: data
    });
  } catch (error) {
    console.error('Error aprobando usuario:', error.message);
    res.status(500).json({ msg: 'Error al aprobar usuario' });
  }
});

// Rechazar una solicitud
router.put('/solicitudes/:id/rechazar', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('usuarios')
      .update({ estado: 'rechazado' })
      .eq('id', id)
      .select('id, dni, nombre, correo, estado')
      .single();

    if (error) throw error;

    await logAudit({
      req,
      accion: 'USUARIO_RECHAZADO',
      detalles: {
        usuario_rechazado_id: id,
        nombre: data.nombre,
        dni: data.dni
      }
    });

    res.json({
      success: true,
      msg: `Solicitud de "${data.nombre}" rechazada.`,
      usuario: data
    });
  } catch (error) {
    console.error('Error rechazando solicitud:', error.message);
    res.status(500).json({ msg: 'Error al rechazar solicitud' });
  }
});

// Eliminar un usuario permanentemente
router.delete('/usuarios/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (req.user && req.user.id === id) {
      return res.status(400).json({ msg: 'No puedes eliminar tu propia cuenta de Administrador.' });
    }

    // Obtener información previa del usuario antes de eliminarlo
    const { data: userToDelete } = await supabase
      .from('usuarios')
      .select('id, nombre, correo, dni, rol')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase
      .from('usuarios')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logAudit({
      req,
      accion: 'USUARIO_ELIMINADO',
      detalles: {
        usuario_eliminado_id: id,
        nombre: userToDelete?.nombre || 'Desconocido',
        dni: userToDelete?.dni || null,
        correo: userToDelete?.correo || null
      }
    });

    res.json({
      success: true,
      msg: 'Usuario eliminado permanentemente del sistema.'
    });
  } catch (error) {
    console.error('Error eliminando usuario:', error.message);
    res.status(500).json({ msg: 'Error al eliminar usuario' });
  }
});

// ==============================================================================
// 4. RECUPERACIÓN Y CAMBIO DE CONTRASEÑA (ESTILO JUFRA POMALCA - OTP 6 DÍGITOS)
// ==============================================================================

async function sendRecoveryEmail({ toEmail, toName, code }) {
  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 580px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e7e5e4; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
      <div style="background: linear-gradient(135deg, #851C1D 0%, #5B1314 100%); padding: 30px 20px; text-align: center; color: white;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">Diócesis de Chiclayo</h2>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #fde68a;">Comisión Diocesana de Voluntariado</p>
      </div>
      <div style="padding: 30px 24px; color: #292524;">
        <h3 style="margin-top: 0; color: #1c1917; font-size: 18px;">Restablecer tu Contraseña</h3>
        <p style="font-size: 14px; line-height: 1.6; color: #57534e;">
          Hola <strong>${toName}</strong>,
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #57534e;">
          Has solicitado restablecer la contraseña de tu cuenta en la plataforma de Voluntariado. Utiliza el siguiente código de verificación de 6 dígitos para continuar:
        </p>
        <div style="background: #fafaf9; border: 2px dashed #f59e0b; border-radius: 12px; padding: 18px; margin: 24px 0; text-align: center;">
          <span style="font-family: monospace, Courier; font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #851C1D;">${code}</span>
        </div>
        <p style="font-size: 13px; color: #78716c; line-height: 1.5;">
          ⏳ Este código es de un solo uso y expirará en <strong>15 minutos</strong>.
        </p>
        <p style="font-size: 13px; color: #78716c; line-height: 1.5; margin-bottom: 0;">
          Si tú no realizaste esta solicitud, puedes ignorar este mensaje de manera segura. Tu contraseña permanecerá intacta hasta que se verifique este código.
        </p>
      </div>
      <div style="background-color: #fafaf9; border-top: 1px solid #e7e5e4; padding: 16px 20px; text-align: center; font-size: 11px; color: #a8a29e;">
        © 2026 Diócesis de Chiclayo • Sistema Oficial de Gestión del Voluntariado
      </div>
    </div>
  `;

  // 1. Brevo API (Recomendado en Render)
  if (process.env.BREVO_API_KEY) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: 'Voluntariado Diócesis de Chiclayo',
            email: process.env.EMAIL_USER || 'jufrapomalca@gmail.com'
          },
          to: [{ email: toEmail, name: toName }],
          subject: 'Código de Recuperación de Contraseña - Voluntariado Diócesis de Chiclayo',
          htmlContent
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Error Brevo API:', errorData);
        throw new Error(`Brevo API Error: ${errorData}`);
      }

      console.log(`✉️ Correo de recuperación enviado a ${toEmail} vía Brevo API.`);
      return { sent: true };
    } catch (err) {
      console.error('Falla enviando correo con Brevo API:', err.message);
    }
  }

  // 2. Nodemailer (Gmail / SMTP)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: `"Voluntariado Diócesis de Chiclayo" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: 'Código de Recuperación de Contraseña - Voluntariado Diócesis de Chiclayo',
        html: htmlContent
      });

      console.log(`✉️ Correo de recuperación enviado a ${toEmail} vía Nodemailer.`);
      return { sent: true };
    } catch (err) {
      console.error('Falla enviando correo con Nodemailer:', err.message);
    }
  }

  // 3. Fallback informativo si aún no hay credenciales configuradas
  console.warn(`⚠️ [MODO DESARROLLO / PRUEBAS] No hay BREVO_API_KEY o EMAIL_USER/PASS configurados en el backend.`);
  console.warn(`🔑 CÓDIGO GENERADO PARA ${toEmail}: [ ${code} ]`);
  return { sent: false, isDev: true, code };
}

// 4.1 Solicitar código de recuperación
router.post('/recuperar-password', authLimiter, async (req, res) => {
  try {
    const { usernameOrEmail } = req.body;
    if (!usernameOrEmail) {
      return res.status(400).json({ success: false, msg: 'Por favor ingresa tu DNI o correo electrónico registrado.' });
    }

    const cleanInput = String(usernameOrEmail).trim().toLowerCase();
    const isDni = /^\d{8}$/.test(cleanInput);

    // Buscar usuario por correo O por DNI
    let query = supabase.from('usuarios').select('id, nombre, correo, dni, estado');
    if (isDni) {
      query = query.or(`dni.eq.${cleanInput},correo.eq.${cleanInput}`);
    } else {
      query = query.eq('correo', cleanInput);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        msg: 'No se encontró ninguna cuenta registrada con ese DNI o correo.'
      });
    }

    const usuario = users[0];

    if (!usuario.correo) {
      return res.status(400).json({
        success: false,
        msg: 'Esta cuenta no tiene un correo electrónico registrado. Por favor contacta al Administrador.'
      });
    }

    if (usuario.estado === 'rechazado') {
      return res.status(403).json({
        success: false,
        msg: 'Esta cuenta se encuentra desactivada o rechazada. Contacta al Administrador.'
      });
    }

    // Generar código de 6 dígitos
    const crypto = require('crypto');
    const resetCode = crypto.randomInt(100000, 999999).toString();

    // Hashear el código antes de guardarlo por seguridad
    const salt = await bcrypt.genSalt(10);
    const reset_password_code = await bcrypt.hash(resetCode, salt);
    const reset_password_expire = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutos

    const { error: updateErr } = await supabase
      .from('usuarios')
      .update({
        reset_password_code,
        reset_password_expire
      })
      .eq('id', usuario.id);

    if (updateErr) throw updateErr;

    // Enviar correo
    const emailResult = await sendRecoveryEmail({
      toEmail: usuario.correo,
      toName: usuario.nombre,
      code: resetCode
    });

    if (!emailResult.sent && !emailResult.isDev) {
      // Si falló el envío y no es modo desarrollo
      await supabase
        .from('usuarios')
        .update({ reset_password_code: null, reset_password_expire: null })
        .eq('id', usuario.id);

      return res.status(500).json({
        success: false,
        msg: emailResult.error || 'No se pudo enviar el correo de recuperación. Verifica la configuración de correo.'
      });
    }

    // Registrar en auditoría
    await logAudit({
      req,
      usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
      accion: 'SOLICITUD_RECUPERACION_PASSWORD',
      detalles: { dni: usuario.dni, correo: usuario.correo }
    });

    // Censurar correo para la respuesta (ej. d***a@gmail.com)
    const [local, domain] = usuario.correo.split('@');
    const maskedLocal = local.length > 2 
      ? `${local[0]}***${local[local.length - 1]}` 
      : `${local[0]}***`;
    const maskedEmail = `${maskedLocal}@${domain}`;

    res.json({
      success: true,
      msg: `Código de seguridad enviado a ${maskedEmail}. Revisa tu bandeja de entrada o spam.`,
      maskedEmail,
      devCode: emailResult.isDev ? resetCode : undefined
    });
  } catch (err) {
    console.error('Error en recuperar-password:', err);
    res.status(500).json({ success: false, msg: 'Error interno del servidor al procesar la recuperación.' });
  }
});

// 4.2 Verificar código de 6 dígitos
router.post('/verificar-codigo', authLimiter, async (req, res) => {
  try {
    const { usernameOrEmail, codigo } = req.body;
    if (!usernameOrEmail || !codigo) {
      return res.status(400).json({ success: false, msg: 'Falta información requerida.' });
    }

    const cleanInput = String(usernameOrEmail).trim().toLowerCase();
    const cleanCode = String(codigo).trim();

    if (cleanCode.length !== 6) {
      return res.status(400).json({ success: false, msg: 'El código debe tener exactamente 6 dígitos.' });
    }

    const isDni = /^\d{8}$/.test(cleanInput);

    let query = supabase
      .from('usuarios')
      .select('id, nombre, correo, dni, reset_password_code, reset_password_expire');

    if (isDni) {
      query = query.or(`dni.eq.${cleanInput},correo.eq.${cleanInput}`);
    } else {
      query = query.eq('correo', cleanInput);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(400).json({ success: false, msg: 'Usuario no encontrado.' });
    }

    const user = users[0];

    if (!user.reset_password_code || !user.reset_password_expire) {
      return res.status(400).json({ success: false, msg: 'No hay ninguna solicitud de recuperación activa o el código ya fue utilizado.' });
    }

    // Verificar si ya expiró
    const expireDate = new Date(user.reset_password_expire);
    if (new Date() > expireDate) {
      return res.status(400).json({ success: false, msg: 'El código de seguridad ha expirado (validez de 15 minutos). Solicita uno nuevo.' });
    }

    // Comparar código con bcrypt
    const isMatch = await bcrypt.compare(cleanCode, user.reset_password_code);
    if (!isMatch) {
      return res.status(400).json({ success: false, msg: 'Código de verificación incorrecto. Verifica los 6 dígitos ingresados.' });
    }

    res.json({
      success: true,
      msg: 'Código verificado con éxito. Ya puedes crear tu nueva contraseña.'
    });
  } catch (err) {
    console.error('Error en verificar-codigo:', err);
    res.status(500).json({ success: false, msg: 'Error al verificar el código.' });
  }
});

// 4.3 Restablecer contraseña con código verificado
router.put('/reset-password', authLimiter, async (req, res) => {
  try {
    const { usernameOrEmail, codigo, newPassword } = req.body;
    if (!usernameOrEmail || !codigo || !newPassword) {
      return res.status(400).json({ success: false, msg: 'Faltan datos requeridos.' });
    }

    const cleanInput = String(usernameOrEmail).trim().toLowerCase();
    const cleanCode = String(codigo).trim();

    // Validación de seguridad de contraseña (mínimo 8 caracteres, al menos 1 letra y 1 número)
    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);
    if (newPassword.length < 8 || !hasLetter || !hasNumber) {
      return res.status(400).json({
        success: false,
        msg: 'La nueva contraseña debe tener al menos 8 caracteres y combinar letras y números.'
      });
    }

    const isDni = /^\d{8}$/.test(cleanInput);

    let query = supabase
      .from('usuarios')
      .select('id, nombre, correo, dni, reset_password_code, reset_password_expire');

    if (isDni) {
      query = query.or(`dni.eq.${cleanInput},correo.eq.${cleanInput}`);
    } else {
      query = query.eq('correo', cleanInput);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(400).json({ success: false, msg: 'Usuario no encontrado.' });
    }

    const user = users[0];

    if (!user.reset_password_code || !user.reset_password_expire) {
      return res.status(400).json({ success: false, msg: 'Código inválido o ya utilizado.' });
    }

    const expireDate = new Date(user.reset_password_expire);
    if (new Date() > expireDate) {
      return res.status(400).json({ success: false, msg: 'El código ha expirado. Solicita uno nuevo.' });
    }

    const isMatch = await bcrypt.compare(cleanCode, user.reset_password_code);
    if (!isMatch) {
      return res.status(400).json({ success: false, msg: 'Código incorrecto.' });
    }

    // Hashear nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);

    // Actualizar usuario y limpiar código
    const { error: updateErr } = await supabase
      .from('usuarios')
      .update({
        password_hash,
        reset_password_code: null,
        reset_password_expire: null
      })
      .eq('id', user.id);

    if (updateErr) throw updateErr;

    // Registrar en auditoría
    await logAudit({
      req,
      usuario: { id: user.id, nombre: user.nombre, correo: user.correo },
      accion: 'PASSWORD_RESTABLECIDA',
      detalles: { dni: user.dni, correo: user.correo }
    });

    res.json({
      success: true,
      msg: '¡Tu contraseña ha sido restablecida exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
    });
  } catch (err) {
    console.error('Error en reset-password:', err);
    res.status(500).json({ success: false, msg: 'Error al restablecer la contraseña.' });
  }
});

router.requireAdmin = requireAdmin;
router.requireAuth = requireAuth;

module.exports = router;
