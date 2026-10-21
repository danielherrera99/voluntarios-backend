const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// 1. Cabeceras de seguridad HTTP con Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 2. Configuración segura de CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'https://voluntarios-chiclayo.web.app',
  'https://voluntarios-web.onrender.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.endsWith('.web.app') ||
      origin.endsWith('.firebaseapp.com') ||
      origin.endsWith('.onrender.com') ||
      origin.includes('localhost')
    ) {
      return callback(null, true);
    }
    return callback(new Error('Bloqueado por política CORS'));
  },
  credentials: true
}));

app.use(express.json());

// 3. Limitadores de Tasa (Rate Limiting)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes al servidor. Por favor espere unos momentos.' }
});

const consultaLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15, // Máximo 15 consultas por minuto por IP (bloquea scraping masivo)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ha superado el límite de consultas por minuto. Por favor espere un momento antes de volver a consultar.' }
});

app.use('/api', generalLimiter);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const authRouter = require('./routes/auth');
const requireAuth = authRouter.requireAuth;
const requireAdmin = authRouter.requireAdmin;
const { logAudit } = require('./audit');

// Rutas
app.use('/api/auth', authRouter);

// Endpoint para registrar eventos de auditoría desde el cliente autenticado
app.post('/api/auditoria', requireAuth, async (req, res) => {
  try {
    const { accion, detalles } = req.body;
    if (!accion) {
      return res.status(400).json({ error: 'El campo "accion" es obligatorio' });
    }

    await logAudit({
      req,
      accion,
      detalles: detalles || {}
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error registrando auditoría:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint exclusivo para Administrador: Consultar el historial de auditoría
app.get('/api/auditoria', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    const { data, error } = await supabase
      .from('auditoria_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error obteniendo historial de auditoría:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ruta básica para verificar que el servidor funciona
app.get('/', (req, res) => {
  res.send('API Voluntarios Funcionando');
});

// Obtener todos los voluntarios (Protegido por token)
app.get('/api/voluntarios', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('voluntarios')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Consultar padrón general por DNI (Fase 1) - Con rate limit anti-scraping
app.get('/api/voluntarios-general/:dni', consultaLimiter, async (req, res) => {
  try {
    const { dni } = req.params;
    const { data, error } = await supabase
      .from('voluntarios_general')
      .select('*')
      .eq('dni', dni)
      .maybeSingle();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const { syncFase2Data } = require('./sync_fase2');

// Ruta para sincronizar manualmente o por webhook (Protegido por token)
app.get('/api/sync-fase2', requireAuth, async (req, res) => {
  try {
    const result = await syncFase2Data();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Función para verificar el token de Google reCAPTCHA v2
const verifyRecaptcha = async (token) => {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY || '6Lde1vctAAAAAHKTkIASqGD6KutJp0KdophSafdh';
  if (!secretKey) return true;
  if (!token) return false;

  try {
    const params = new URLSearchParams({
      secret: secretKey,
      response: token
    });

    const googleRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await googleRes.json();
    return Boolean(data.success);
  } catch (err) {
    console.error('Error validando reCAPTCHA con Google:', err);
    return true;
  }
};

// Endpoint unificado de consulta por DNI (Cruce Fase 2 y Fase 1) - Con rate limit anti-scraping y reCAPTCHA
app.get('/api/consulta/:dni', consultaLimiter, async (req, res) => {
  try {
    const { dni } = req.params;
    const cleanDni = dni.trim();

    // Verificación de reCAPTCHA (si se envía el token o en producción)
    const recaptchaToken = req.headers['x-recaptcha-token'] || req.query.recaptchaToken;
    if (recaptchaToken) {
      const isHuman = await verifyRecaptcha(recaptchaToken);
      if (!isHuman) {
        return res.status(400).json({ error: 'Verificación de reCAPTCHA no válida. Por favor vuelve a marcar la casilla.' });
      }
    }

    // 1. Buscar en Fase 2 (voluntarios)
    const { data: f2Data, error: f2Error } = await supabase
      .from('voluntarios')
      .select('*')
      .eq('dni', cleanDni)
      .maybeSingle();

    if (f2Error) throw f2Error;

    if (f2Data) {
      let status = 'PENDING';
      if (f2Data.info_validada || f2Data.estado === 'SELECCIONADO') {
        status = 'SELECTED';
      } else if (f2Data.estado === 'EN REVISIÓN') {
        status = 'PENDING';
      }

      return res.json({
        found: true,
        fase: f2Data.fase || '2',
        status: status,
        name: f2Data.nombres_apellidos,
        dni: f2Data.dni,
        codigo: f2Data.codigo,
        comision: f2Data.servicio || 'Servicio General',
        area: f2Data.departamento || 'Diócesis de Chiclayo',
        observacion: f2Data.observacion,
        info_validada: f2Data.info_validada
      });
    }

    // 2. Si no está en Fase 2, buscar en Fase 1 (voluntarios_general)
    const { data: f1Data, error: f1Error } = await supabase
      .from('voluntarios_general')
      .select('*')
      .eq('dni', cleanDni)
      .maybeSingle();

    if (f1Error) throw f1Error;

    if (f1Data) {
      return res.json({
        found: true,
        fase: '1',
        status: 'FASE1_REGISTRADO',
        name: f1Data.nombres_apellidos,
        dni: f1Data.dni,
        codigo: f1Data.codigo,
        comision: f1Data.servicio,
        area: f1Data.departamento,
        observacion: 'Registrado/a en el Padrón Inicial (Fase 1). Tu postulación a la Segunda Fase aún no ha sido registrada o está en proceso.'
      });
    }

    // 3. No encontrado en ninguna base
    return res.json({
      found: false,
      status: 'NOT_FOUND',
      dni: cleanDni
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para repartir equitativamente los postulantes de Fase 1 entre colaboradores (Protegido)
app.post('/api/distribute-voluntarios', requireAuth, async (req, res) => {
  try {
    const { collaborators } = req.body;
    if (!collaborators || !Array.isArray(collaborators) || collaborators.length === 0) {
      return res.status(400).json({ error: 'Debes enviar una lista de colaboradores' });
    }

    const cleanNames = collaborators.map(c => String(c).trim()).filter(Boolean);
    if (cleanNames.length === 0) {
      return res.status(400).json({ error: 'No se encontraron nombres válidos' });
    }

    console.log(`⚡ Iniciando reparto equitativo entre ${cleanNames.length} colaboradores:`, cleanNames);

    // 1. Obtener solo los postulantes que AÚN NO han sido contactados (SIN_FASE2)
    // Esto protege a todos los que ya fueron contactados (CONTACTADO), manteniendo su asignación intacta.
    let allIds = [];
    let page = 0;
    const size = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('voluntarios_general')
        .select('id')
        .eq('estado', 'SIN_FASE2')
        .order('nombres_apellidos', { ascending: true })
        .range(page * size, (page + 1) * size - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allIds.push(...data.map(d => d.id));
      if (data.length < size) break;
      page++;
    }

    const total = allIds.length;
    const numCollaborators = cleanNames.length;
    const chunkSize = Math.ceil(total / numCollaborators);

    console.log(`📊 Total a repartir: ${total} (~${chunkSize} por persona)`);

    const distributionSummary = [];

    for (let i = 0; i < numCollaborators; i++) {
      const collaboratorName = cleanNames[i];
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, total);
      const collaboratorIds = allIds.slice(start, end);

      if (collaboratorIds.length > 0) {
        // Actualizar en lotes de 500
        for (let j = 0; j < collaboratorIds.length; j += 500) {
          const subChunk = collaboratorIds.slice(j, j + 500);
          const { error: upErr } = await supabase
            .from('voluntarios_general')
            .update({ fase: collaboratorName })
            .in('id', subChunk);

          if (upErr) console.warn(`⚠️ Error asignando a ${collaboratorName}:`, upErr.message);
        }

        distributionSummary.push({
          name: collaboratorName,
          count: collaboratorIds.length
        });
      }
    }

    console.log('✅ Reparto completado con éxito:', distributionSummary);

    await logAudit({
      req,
      accion: 'REPARTO_VOLUNTARIOS',
      detalles: {
        totalAsignados: total,
        totalColaboradores: numCollaborators,
        resumen: distributionSummary
      }
    });

    res.json({
      success: true,
      total,
      collaborators: distributionSummary
    });
  } catch (err) {
    console.error('❌ Error en distribute-voluntarios:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener estadísticas y avance por colaborador
app.get('/api/collaborators-stats', async (req, res) => {
  try {
    let allRows = [];
    let page = 0;
    const size = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('voluntarios_general')
        .select('fase, estado')
        .or('estado.eq.SIN_FASE2,estado.eq.CONTACTADO')
        .range(page * size, (page + 1) * size - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < size) break;
      page++;
    }

    const statsMap = {};
    for (const r of allRows) {
      const name = (r.fase && String(r.fase).trim()) ? String(r.fase).trim() : 'Sin asignar';
      if (!statsMap[name]) {
        statsMap[name] = { name, total: 0, contactados: 0, pendientes: 0 };
      }
      statsMap[name].total++;
      if (r.estado === 'CONTACTADO') {
        statsMap[name].contactados++;
      } else {
        statsMap[name].pendientes++;
      }
    }

    const result = Object.values(statsMap).map(s => ({
      ...s,
      porcentaje: s.total > 0 ? Math.round((s.contactados / s.total) * 100) : 0
    })).sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (err) {
    console.error('❌ Error en collaborators-stats:', err);
    res.status(500).json({ error: err.message });
  }
});



// Endpoint para chocolotear / repartir equitativamente entre Líderes y Cuadrillas
app.post('/api/distribute-cuadrillas', async (req, res) => {
  try {
    const { hierarchy, shuffle = true, targetFase = 'sin_fase2' } = req.body;
    // hierarchy es un array de líderes:
    // [ { nombre: 'Líder 1', coordinadores: ['Coord 1A', 'Coord 1B'] }, ... ]
    if (!hierarchy || !Array.isArray(hierarchy) || hierarchy.length === 0) {
      return res.status(400).json({ error: 'Debes enviar la estructura de líderes y coordinadores' });
    }

    console.log(`🎲 Iniciando chocoloteo / reparto de cuadrillas entre ${hierarchy.length} líderes...`);

    // 1. Obtener los IDs de los postulantes según el target
    let query = supabase.from('voluntarios_general').select('id, dni');
    if (targetFase === 'sin_fase2') {
      query = query.or('estado.eq.SIN_FASE2,estado.eq.CONTACTADO');
    }
    
    let allVoluntarios = [];
    let page = 0;
    const size = 1000;
    while (true) {
      const { data, error } = await query
        .order('nombres_apellidos', { ascending: true })
        .range(page * size, (page + 1) * size - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allVoluntarios.push(...data);
      if (data.length < size) break;
      page++;
    }

    const total = allVoluntarios.length;
    if (total === 0) {
      return res.status(400).json({ error: 'No se encontraron voluntarios para repartir' });
    }

    // 2. Si shuffle es true, aplicamos Fisher-Yates ("Chocoloteado aleatorio")
    let pool = [...allVoluntarios];
    if (shuffle) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    // 3. Contar número total de cuadrillas / coordinadores en toda la jerarquía
    let totalCoordinadores = 0;
    hierarchy.forEach(l => {
      const coords = l.coordinadores && l.coordinadores.length > 0 ? l.coordinadores : [l.nombre];
      totalCoordinadores += coords.length;
    });

    const chunkSize = Math.ceil(total / totalCoordinadores);
    console.log(`📊 Total a repartir: ${total} entre ${totalCoordinadores} coordinadores (~${chunkSize} c/u)`);

    let currentIndex = 0;
    const summary = [];

    for (let lIdx = 0; lIdx < hierarchy.length; lIdx++) {
      const lider = hierarchy[lIdx];
      const liderNombre = String(lider.nombre).trim();
      const coords = (lider.coordinadores && lider.coordinadores.length > 0) 
        ? lider.coordinadores.map(c => String(c).trim()).filter(Boolean)
        : [liderNombre];

      const liderSummary = {
        lider: liderNombre,
        coordinadores: [],
        totalLider: 0
      };

      for (let cIdx = 0; cIdx < coords.length; cIdx++) {
        const coordNombre = coords[cIdx];
        const cuadrillaCode = `L${String(lIdx + 1).padStart(2, '0')}-C${String(cIdx + 1).padStart(2, '0')}`;
        const start = currentIndex;
        const end = Math.min(start + chunkSize, total);
        const chunk = pool.slice(start, end);
        currentIndex = end;

        if (chunk.length > 0) {
          const ids = chunk.map(v => v.id);
          const dnis = chunk.map(v => v.dni);

          // Actualizar en lotes de 500 en voluntarios_general
          for (let b = 0; b < ids.length; b += 500) {
            const subIds = ids.slice(b, b + 500);
            const { error: upErr } = await supabase
              .from('voluntarios_general')
              .update({
                lider_nombre: liderNombre,
                coordinador_nombre: coordNombre,
                cuadrilla_codigo: cuadrillaCode
              })
              .in('id', subIds);

            if (upErr) console.warn(`⚠️ Error asignando lote a ${coordNombre}:`, upErr.message);
          }

          // Actualizar en voluntarios (Fase 2) si existen
          for (let b = 0; b < dnis.length; b += 500) {
            const subDnis = dnis.slice(b, b + 500);
            await supabase
              .from('voluntarios')
              .update({
                lider_nombre: liderNombre,
                coordinador_nombre: coordNombre,
                cuadrilla_codigo: cuadrillaCode
              })
              .in('dni', subDnis);
          }

          liderSummary.coordinadores.push({
            coordinador: coordNombre,
            cuadrilla: cuadrillaCode,
            count: chunk.length
          });
          liderSummary.totalLider += chunk.length;
        }

        if (currentIndex >= total) break;
      }

      summary.push(liderSummary);
      if (currentIndex >= total) break;
    }

    console.log('✅ Chocoloteo y reparto de cuadrillas finalizado con éxito.');

    await logAudit({
      req,
      accion: 'REPARTO_CUADRILLAS',
      detalles: {
        totalAsignados: total,
        totalLideres: hierarchy.length,
        resumen: summary
      }
    });

    res.json({
      success: true,
      total,
      summary
    });
  } catch (err) {
    console.error('❌ Error en distribute-cuadrillas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para asignación manual o en bloque de cuadrilla
app.post('/api/asignar-cuadrilla', async (req, res) => {
  try {
    const { ids, lider_nombre, coordinador_nombre, cuadrilla_codigo } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos un ID' });
    }

    const { error: upErr } = await supabase
      .from('voluntarios_general')
      .update({
        lider_nombre: lider_nombre || null,
        coordinador_nombre: coordinador_nombre || null,
        cuadrilla_codigo: cuadrilla_codigo || null
      })
      .in('id', ids);

    if (upErr) throw upErr;

    // Obtener DNIs para sincronizar también en Fase 2
    const { data: volData } = await supabase
      .from('voluntarios_general')
      .select('dni')
      .in('id', ids);

    if (volData && volData.length > 0) {
      const dnis = volData.map(v => v.dni);
      await supabase
        .from('voluntarios')
        .update({
          lider_nombre: lider_nombre || null,
          coordinador_nombre: coordinador_nombre || null,
          cuadrilla_codigo: cuadrilla_codigo || null
        })
        .in('dni', dnis);
    }

    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('❌ Error en asignar-cuadrilla:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener estadísticas y avance por Líder y Coordinador
app.get('/api/cuadrillas-stats', async (req, res) => {
  try {
    let allRows = [];
    let page = 0;
    const size = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('voluntarios_general')
        .select('lider_nombre, coordinador_nombre, cuadrilla_codigo, estado')
        .range(page * size, (page + 1) * size - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < size) break;
      page++;
    }

    const lideresMap = {};

    for (const r of allRows) {
      const lider = r.lider_nombre || 'Sin Líder Asignado';
      const coord = r.coordinador_nombre || 'Sin Coordinador';
      const cuadrilla = r.cuadrilla_codigo || '-';

      if (!lideresMap[lider]) {
        lideresMap[lider] = {
          nombre: lider,
          total: 0,
          contactados: 0,
          pendientes: 0,
          coordinadoresMap: {}
        };
      }

      lideresMap[lider].total++;
      const isContacted = (r.estado === 'CONTACTADO' || r.estado === 'CON_FASE2');
      if (isContacted) {
        lideresMap[lider].contactados++;
      } else {
        lideresMap[lider].pendientes++;
      }

      if (!lideresMap[lider].coordinadoresMap[coord]) {
        lideresMap[lider].coordinadoresMap[coord] = {
          nombre: coord,
          cuadrilla: cuadrilla,
          total: 0,
          contactados: 0,
          pendientes: 0
        };
      }

      lideresMap[lider].coordinadoresMap[coord].total++;
      if (isContacted) {
        lideresMap[lider].coordinadoresMap[coord].contactados++;
      } else {
        lideresMap[lider].coordinadoresMap[coord].pendientes++;
      }
    }

    const result = Object.values(lideresMap).map(l => {
      const coordinadores = Object.values(l.coordinadoresMap).map(c => ({
        ...c,
        porcentaje: c.total > 0 ? Math.round((c.contactados / c.total) * 100) : 0
      })).sort((a, b) => b.total - a.total);

      delete l.coordinadoresMap;
      return {
        ...l,
        porcentaje: l.total > 0 ? Math.round((l.contactados / l.total) * 100) : 0,
        coordinadores
      };
    }).sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (err) {
    console.error('❌ Error en cuadrillas-stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener lista única de Líderes y Coordinadores asignados
app.get('/api/lideres-coordinadores', async (req, res) => {
  try {
    const { data: lideresData } = await supabase
      .from('voluntarios_general')
      .select('lider_nombre, coordinador_nombre, cuadrilla_codigo')
      .not('lider_nombre', 'is', null);

    const lideresSet = new Set();
    const coordinadoresMap = {};

    (lideresData || []).forEach(r => {
      if (r.lider_nombre) {
        lideresSet.add(r.lider_nombre);
        if (!coordinadoresMap[r.lider_nombre]) {
          coordinadoresMap[r.lider_nombre] = new Set();
        }
        if (r.coordinador_nombre) {
          coordinadoresMap[r.lider_nombre].add(r.coordinador_nombre);
        }
      }
    });

    const responseData = {
      lideres: Array.from(lideresSet).sort(),
      coordinadoresPorLider: {}
    };

    for (const [lider, coordsSet] of Object.entries(coordinadoresMap)) {
      responseData.coordinadoresPorLider[lider] = Array.from(coordsSet).sort();
    }

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);

  // Sincronización automática periódica cada 5 minutos
  console.log(`⏱️ Iniciando sincronizador automático en segundo plano (cada 5 min)...`);
  setInterval(() => {
    console.log(`🔄 [Auto-Sync] Verificando nuevas inscripciones en Google Sheets...`);
    syncFase2Data().catch(err => console.error('❌ Error en Auto-Sync:', err.message));
  }, 5 * 60 * 1000);

  // Keep-Alive cada 10 minutos para evitar que Render entre en suspensión (Cold Start)
  const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://voluntarios-backend.onrender.com';
  setInterval(() => {
    fetch(BACKEND_URL)
      .then(res => console.log(`💓 [Keep-Alive] Ping exitoso a ${BACKEND_URL} (${res.status})`))
      .catch(err => console.warn('⚠️ [Keep-Alive] Falló el ping:', err.message));
  }, 10 * 60 * 1000);
});
