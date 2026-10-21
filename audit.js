const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Registra un evento en la tabla auditoria_logs
 * @param {Object} params
 * @param {Object} [params.req] - Express request (para extraer IP y usuario autenticado)
 * @param {Object} [params.usuario] - Datos explícitos del usuario { id, nombre, correo }
 * @param {string} params.accion - Código de la acción (ej. LOGIN_EXITOSO, CAMBIO_CONTACTADO)
 * @param {Object} [params.detalles] - JSON con información relevante del evento
 */
const logAudit = async ({ req, usuario, accion, detalles = {} }) => {
  try {
    const user = usuario || (req && req.user ? req.user : null);
    
    // Obtener IP cliente
    let clientIp = null;
    if (req) {
      const forwarded = req.headers['x-forwarded-for'];
      clientIp = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || null);
    }

    const { error } = await supabase.from('auditoria_logs').insert([
      {
        usuario_id: user?.id ? String(user.id) : null,
        usuario_nombre: user?.nombre || 'Sistema / Público',
        usuario_correo: user?.correo || null,
        accion: String(accion).trim(),
        detalles: detalles || {},
        ip: clientIp
      }
    ]);

    if (error) {
      console.warn('⚠️ No se pudo registrar en auditoria_logs:', error.message);
    }
  } catch (err) {
    console.warn('⚠️ Excepción al registrar auditoría:', err.message);
  }
};

module.exports = {
  logAudit,
  supabase
};
