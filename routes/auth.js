const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const jwtSecret = process.env.JWT_SECRET || 'mi_secreto_super_seguro_jufra_2026';

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
router.post('/register', async (req, res) => {
  const { nombre, email, password, telefono, dni } = req.body;

  try {
    if (!nombre || !email || !password || !dni) {
      return res.status(400).json({ msg: 'Por favor completa todos los campos requeridos, incluyendo tu DNI.' });
    }

    const cleanDni = String(dni).replace(/\D/g, '').trim();
    if (cleanDni.length !== 8) {
      return res.status(400).json({ msg: 'El DNI debe tener exactamente 8 dígitos numéricos.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ msg: 'La contraseña debe tener al menos 6 caracteres.' });
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
router.post('/login', async (req, res) => {
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
      return res.status(401).json({ msg: 'Credenciales inválidas' });
    }

    const user = users[0];

    // 2. Verificar contraseña con bcrypt
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
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

    // 4. Generar JWT para usuarios aprobados
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
      { expiresIn: '3d' }, // Token válido por 3 días
      (err, token) => {
        if (err) throw err;
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

// Obtener todas las solicitudes y usuarios
router.get('/solicitudes', requireAdmin, async (req, res) => {
  try {
    const { data: allUsers, error } = await supabase
      .from('usuarios')
      .select('id, dni, nombre, correo, telefono, rol, estado, created_at, lider_nombre, coordinador_nombre')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const pendientes = (allUsers || []).filter(u => u.estado === 'pendiente');
    const aprobados = (allUsers || []).filter(u => u.estado === 'aprobado');
    const rechazados = (allUsers || []).filter(u => u.estado === 'rechazado');

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

    const { error } = await supabase
      .from('usuarios')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      success: true,
      msg: 'Usuario eliminado permanentemente del sistema.'
    });
  } catch (error) {
    console.error('Error eliminando usuario:', error.message);
    res.status(500).json({ msg: 'Error al eliminar usuario' });
  }
});

module.exports = router;
