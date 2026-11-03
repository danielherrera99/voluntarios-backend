const https = require('https');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ASIGNACION_FILE_ID = '1md8kZdeTBda6x0kYRTqZBX-X8wgMgxPA';
const ASIGNACION_SHEET_URL = `https://docs.google.com/spreadsheets/d/${ASIGNACION_FILE_ID}/export?format=xlsx`;

// Mapeo canónico exacto de nombres/apodos a Líderes Oficiales
const LIDERES_MAP = {
  'SEBASTIAN': 'SEBASTIÁN LEÓN SALOMÉ',
  'CRISTINA': 'CRISTINA NOMBERA BAZÁN',
  'CRISTINA NOMBERA': 'CRISTINA NOMBERA BAZÁN',
  'MARIA LONGA': 'MARIA SOLEDAD LONGA GRANDA',
  'JHONATAN': 'JHONATAN FRANCISCO FIESTAS PATAZCA',
  'FATIMA': 'FATIMA ELIZABETH GONZALES FIESTAS',
  'MARIA BAUDAT': 'MARÍA ISABEL BAUDAT SANCHEZ',
  'RICARDO': 'RICARDO ACOSTA DEL AGUILA',
  'ANNGHY': 'ANNGHY GABRIELA SALAZAR GONZALES',
  'ANGIE': 'ANNGHY GABRIELA SALAZAR GONZALES',
  'XIOMARA': 'ELENA XIOMARA SOPLOPUCO LOCONI',
  'PAMELA': 'PAMELA DEL MILAGRO QUICIO MONJE',
  'PRISCILA': 'PRISCILLA NIÑO MALDONADO',
  'PRISCILLA': 'PRISCILLA NIÑO MALDONADO',
  'WALTER': 'WALTER GARCIA',
  'SANDY': 'SANDY LIMO ORÉ',
  'MELISSA': 'KATHERYN MELISA MARTINEZ',
  'ANYELO': 'ANYELO HERNAN CHISCUL ESQUIVES',
  'MAX': 'SANTOS MÁXIMO FIESTAS PATAZCA',
  'WILDER': 'WILDER ANIBAL LÓPEZ ALARCÓN'
};

const LUGARES_SEDES = [
  'USAT', 'SANTUARIO', 'ZAÑA', 'SANTA CRUZ', 'COMUNIÓN',
  'TRADUCTOR', 'COMISIÓN CENTRAL', 'UNIVERSIDAD DE CAJAMARCA'
];

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Error descargando Google Sheet: status ${res.statusCode}`));
      }
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', reject);
  });
}

async function syncAsignacionesVoluntarios() {
  console.log('1. Descargando hoja oficial de Asignaciones de Voluntarios...');
  const buf = await downloadBuffer(ASIGNACION_SHEET_URL);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets['Voluntarios'];
  if (!sheet) throw new Error('No se encontró la hoja "Voluntarios" en el archivo de Google Sheets');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const dataRows = rows.slice(1).filter(r => r && r[5] && /^\d+$/.test(String(r[5]).trim()));

  console.log(`2. Total registros válidos con DNI en el Excel: ${dataRows.length}`);

  let asignadosLider = 0;
  let asignadosSede = 0;
  let sinLugar = 0;

  // Organizar mapa de actualizaciones por DNI
  const updatesMap = new Map();

  for (const r of dataRows) {
    const dni = String(r[5]).trim();
    const rawLugar = r[2] ? String(r[2]).trim().toUpperCase() : null;

    let lider = null;
    let lugar = null;

    if (rawLugar) {
      if (LIDERES_MAP[rawLugar]) {
        lider = LIDERES_MAP[rawLugar];
        lugar = `Equipo ${lider}`;
        asignadosLider++;
      } else if (LUGARES_SEDES.includes(rawLugar)) {
        lugar = rawLugar;
        asignadosSede++;
      } else {
        lugar = rawLugar;
      }
    } else {
      sinLugar++;
    }

    updatesMap.set(dni, { lider, lugar });
  }

  console.log(`- Asignados a Líder: ${asignadosLider}`);
  console.log(`- Asignados a Sede/Comisión: ${asignadosSede}`);
  console.log(`- Sin Asignación: ${sinLugar}`);

  // 3. Actualizar en lotes seguros SIN BORRAR NADA (actualizaciones por DNI)
  console.log('3. Actualizando voluntarios_general en Supabase...');
  const dniList = Array.from(updatesMap.keys());
  let totalUpdatedFase1 = 0;
  let totalUpdatedFase2 = 0;

  // Procesar por lotes de 200
  const batchSize = 200;
  for (let i = 0; i < dniList.length; i += batchSize) {
    const chunkDnis = dniList.slice(i, i + batchSize);

    // Actualizar uno a uno o por casos (en Supabase, procesamos concurrentemente en chunks)
    await Promise.all(chunkDnis.map(async (dni) => {
      const info = updatesMap.get(dni);
      if (info && (info.lider || info.lugar)) {
        const payload = {};
        if (info.lider) payload.lider_nombre = info.lider;
        if (info.lugar) payload.lugar_asignado = info.lugar;

        const { error: err1 } = await supabase
          .from('voluntarios_general')
          .update(payload)
          .eq('dni', dni);

        if (!err1) totalUpdatedFase1++;

        const { error: err2 } = await supabase
          .from('voluntarios')
          .update(payload)
          .eq('dni', dni);

        if (!err2) totalUpdatedFase2++;
      }
    }));

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= dniList.length) {
      console.log(`Progreso: ${Math.min(i + batchSize, dniList.length)} / ${dniList.length} DNIs procesados...`);
    }
  }

  console.log('\n✅ SINCRONIZACIÓN DE ASIGNACIONES COMPLETADA:');
  console.log(`- Total registros actualizados en Fase 1: ${totalUpdatedFase1}`);
  console.log(`- Total registros actualizados en Fase 2: ${totalUpdatedFase2}`);

  return {
    success: true,
    totalExcel: dataRows.length,
    asignadosLider,
    asignadosSede,
    sinAsignar: sinLugar,
    totalUpdatedFase1,
    totalUpdatedFase2
  };
}

module.exports = {
  syncAsignacionesVoluntarios
};
