const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log('Verificando / Creando tabla puntos_tacticos...');

  // Intentamos crear la tabla usando exec_sql si existe
  const sql = `
    CREATE TABLE IF NOT EXISTS puntos_tacticos (
      id BIGSERIAL PRIMARY KEY,
      sede_id VARCHAR(50) NOT NULL DEFAULT 'misa-central',
      tipo VARCHAR(30) NOT NULL, -- 'medica', 'agua', 'puerta', 'altar', 'mando', 'cuadrilla'
      nombre VARCHAR(150) NOT NULL,
      descripcion TEXT,
      lat NUMERIC(10, 6) NOT NULL,
      lng NUMERIC(10, 6) NOT NULL,
      icono VARCHAR(10) DEFAULT '📍',
      color VARCHAR(20) DEFAULT '#9B1C22',
      cuadrilla_codigo VARCHAR(20),
      creado_por VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_puntos_tacticos_sede ON puntos_tacticos(sede_id);
    CREATE INDEX IF NOT EXISTS idx_puntos_tacticos_tipo ON puntos_tacticos(tipo);
  `;

  try {
    const { error: rpcErr } = await supabase.rpc('exec_sql', { sql });
    if (rpcErr) {
      console.warn('exec_sql RPC no disponible o falló:', rpcErr.message);
    } else {
      console.log('✅ Tabla puntos_tacticos verificada/creada mediante exec_sql.');
    }
  } catch (e) {
    console.warn('Excepción ejecutando exec_sql:', e.message);
  }

  // Comprobar si la tabla ya responde a queries
  const { data: existing, error: selectErr } = await supabase
    .from('puntos_tacticos')
    .select('id, nombre, sede_id')
    .limit(5);

  if (selectErr) {
    console.error('❌ La tabla puntos_tacticos aún no existe o falló la consulta:', selectErr.message);
    process.exit(1);
  }

  console.log(`✅ Conexión exitosa. Puntos existentes: ${existing.length}`);

  // Si está vacía, sembramos los puntos iniciales
  if (existing.length === 0) {
    console.log('🌱 Sembrando puntos tácticos iniciales oficiales...');
    const seedPoints = [
      // Explanada
      { sede_id: 'misa-central', tipo: 'altar', nombre: 'Altar Mayor Papal', lat: -6.777800, lng: -79.851000, icono: '✝️', color: '#B5871D', descripcion: 'Presbiterio principal y zona litúrgica' },
      { sede_id: 'misa-central', tipo: 'medica', nombre: 'Carpa Médica #1 (Norte)', lat: -6.777000, lng: -79.852500, icono: '🚑', color: '#E11D48', descripcion: 'Atención de primeros auxilios y ambulancia SAMU' },
      { sede_id: 'misa-central', tipo: 'medica', nombre: 'Carpa Médica #2 (Sur)', lat: -6.779800, lng: -79.849500, icono: '🚑', color: '#E11D48', descripcion: 'Puesto de socorro y evacuación sur' },
      { sede_id: 'misa-central', tipo: 'agua', nombre: 'Punto Hidratación Central', lat: -6.778500, lng: -79.850200, icono: '💧', color: '#2563EB', descripcion: 'Bidones de agua y reposición para cuadrillas' },
      { sede_id: 'misa-central', tipo: 'puerta', nombre: 'Puerta Principal de Evacuación', lat: -6.780200, lng: -79.851500, icono: '🚪', color: '#059669', descripcion: 'Vía despejada hacia corredor de emergencia' },
      { sede_id: 'misa-central', tipo: 'mando', nombre: 'Puesto de Mando Diócesis', lat: -6.777200, lng: -79.849800, icono: '🛡️', color: '#6B0D12', descripcion: 'Centro de coordinación general de voluntarios' },

      // Catedral
      { sede_id: 'catedral-chiclayo', tipo: 'altar', nombre: 'Atrio Catedral Santa María', lat: -6.771900, lng: -79.838900, icono: '⛪', color: '#B5871D', descripcion: 'Escalinatas y atrio principal de recepción' },
      { sede_id: 'catedral-chiclayo', tipo: 'puerta', nombre: 'Acceso San José / Balta', lat: -6.772500, lng: -79.839800, icono: '🚪', color: '#059669', descripcion: 'Control perimétrico y cordón de honor' },
      { sede_id: 'catedral-chiclayo', tipo: 'medica', nombre: 'Ambulancia Plaza Mayor', lat: -6.771500, lng: -79.839600, icono: '🚑', color: '#E11D48', descripcion: 'Unidad de respuesta médica rápida' },
      { sede_id: 'catedral-chiclayo', tipo: 'agua', nombre: 'Punto Hidratación Plaza', lat: -6.772200, lng: -79.838500, icono: '💧', color: '#2563EB', descripcion: 'Distribución de agua a cuadrillas en cordón' },

      // Santuario
      { sede_id: 'santuario-paz', tipo: 'altar', nombre: 'Nave Central del Santuario', lat: -6.820300, lng: -79.869800, icono: '🕊️', color: '#10B981', descripcion: 'Espacio de oración y bendición de enfermos' },
      { sede_id: 'santuario-paz', tipo: 'medica', nombre: 'Puesto Médico Especializado', lat: -6.820900, lng: -79.870500, icono: '🚑', color: '#E11D48', descripcion: 'Atención a personas con discapacidad' },
      { sede_id: 'santuario-paz', tipo: 'agua', nombre: 'Módulo de Hidratación Santuario', lat: -6.820100, lng: -79.870400, icono: '💧', color: '#2563EB', descripcion: 'Punto de recarga de agua' },

      // Zaña
      { sede_id: 'zana-historica', tipo: 'altar', nombre: 'Convento San Agustín de Zaña', lat: -6.924200, lng: -79.584200, icono: '✝️', color: '#8B5CF6', descripcion: 'Homenaje a Santo Toribio de Mogrovejo' },
      { sede_id: 'zana-historica', tipo: 'medica', nombre: 'Carpa Médica Centro Histórico', lat: -6.924500, lng: -79.585200, icono: '🚑', color: '#E11D48', descripcion: 'Puesto de salud de avanzada' },
      { sede_id: 'zana-historica', tipo: 'agua', nombre: 'Punto Hidratación Zaña', lat: -6.924800, lng: -79.583800, icono: '💧', color: '#2563EB', descripcion: 'Punto de asistencia a peregrinos' },

      // Santa Cruz
      { sede_id: 'santa-cruz', tipo: 'altar', nombre: 'Templo Matriz Santa Cruz', lat: -6.626200, lng: -78.945600, icono: '⛰️', color: '#D97706', descripcion: 'Encuentro con delegaciones andinas' },
      { sede_id: 'santa-cruz', tipo: 'medica', nombre: 'Centro de Salud Santa Cruz', lat: -6.626900, lng: -78.946300, icono: '🚑', color: '#E11D48', descripcion: 'Soporte médico para comunidades' },
      { sede_id: 'santa-cruz', tipo: 'agua', nombre: 'Módulo Hidratación Sierra', lat: -6.625800, lng: -78.945200, icono: '💧', color: '#2563EB', descripcion: 'Distribución de bebidas e hidratación' }
    ];

    const { error: insErr } = await supabase.from('puntos_tacticos').insert(seedPoints);
    if (insErr) {
      console.error('Error insertando puntos iniciales:', insErr.message);
    } else {
      console.log(`✅ ${seedPoints.length} puntos tácticos sembrados con éxito.`);
    }
  }

  console.log('¡Listo!');
}

main().catch(err => console.error(err));
