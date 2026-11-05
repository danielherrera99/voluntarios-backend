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

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
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

  const itemsToUpdate = [];

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
      itemsToUpdate.push({ dni, lider, lugar });
    } else {
      sinLugar++;
    }
  }

  console.log(`- Asignados a Líder: ${asignadosLider}`);
  console.log(`- Asignados a Sede/Comisión: ${asignadosSede}`);
  console.log(`- Sin Asignación (vacíos): ${sinLugar}`);
  console.log(`- Total a actualizar por DNI: ${itemsToUpdate.length}`);

  // 3. Ejecutar actualizaciones en lotes SQL de alto rendimiento (SIN BORRAR NADA)
  console.log('3. Ejecutando actualización en Supabase...');
  const chunkSize = 500;
  for (let i = 0; i < itemsToUpdate.length; i += chunkSize) {
    const chunk = itemsToUpdate.slice(i, i + chunkSize);
    const valuesSql = chunk.map(item => `(${escapeSql(item.dni)}, ${escapeSql(item.lider)}, ${escapeSql(item.lugar)})`).join(',\n');

    // Actualizar Fase 1
    const sqlFase1 = `
      UPDATE voluntarios_general AS vg
      SET 
        responsable_nombre = COALESCE(v.lider, vg.responsable_nombre),
        lider_nombre = COALESCE(v.lider, vg.lider_nombre),
        lugar_asignado = COALESCE(v.lugar, vg.lugar_asignado)
      FROM (VALUES
        ${valuesSql}
      ) AS v(dni, lider, lugar)
      WHERE vg.dni = v.dni;
    `;
    const { error: err1 } = await supabase.rpc('exec_sql', { sql: sqlFase1 });
    if (err1) throw new Error(`Error en lote SQL Fase 1: ${err1.message}`);

    // Actualizar Fase 2
    const sqlFase2 = `
      UPDATE voluntarios AS v2
      SET 
        responsable_nombre = COALESCE(v.lider, v2.responsable_nombre),
        lider_nombre = COALESCE(v.lider, v2.lider_nombre),
        lugar_asignado = COALESCE(v.lugar, v2.lugar_asignado)
      FROM (VALUES
        ${valuesSql}
      ) AS v(dni, lider, lugar)
      WHERE v2.dni = v.dni;
    `;
    const { error: err2 } = await supabase.rpc('exec_sql', { sql: sqlFase2 });
    if (err2) throw new Error(`Error en lote SQL Fase 2: ${err2.message}`);

    console.log(`Progreso: ${Math.min(i + chunkSize, itemsToUpdate.length)} / ${itemsToUpdate.length} asignaciones cruzadas...`);
  }

  console.log('\n✅ SINCRONIZACIÓN DE ASIGNACIONES COMPLETADA EXITOSAMENTE');

  return {
    success: true,
    totalExcel: dataRows.length,
    asignadosLider,
    asignadosSede,
    sinAsignar: sinLugar,
    totalActualizados: itemsToUpdate.length
  };
}

module.exports = {
  syncAsignacionesVoluntarios
};
