const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Rutas
app.use('/api/auth', require('./routes/auth'));

// Ruta básica para verificar que el servidor funciona
app.get('/', (req, res) => {
  res.send('API Voluntarios Funcionando');
});

// Obtener todos los voluntarios
app.get('/api/voluntarios', async (req, res) => {
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

// Consultar padrón general por DNI (Fase 1)
app.get('/api/voluntarios-general/:dni', async (req, res) => {
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

// Ruta para sincronizar manualmente o por webhook
app.get('/api/sync-fase2', async (req, res) => {
  try {
    const result = await syncFase2Data();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint unificado de consulta por DNI (Cruce Fase 2 y Fase 1)
app.get('/api/consulta/:dni', async (req, res) => {
  try {
    const { dni } = req.params;
    const cleanDni = dni.trim();

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
