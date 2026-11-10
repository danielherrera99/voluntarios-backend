const https = require('https');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

// Mapeo por DNI del Responsable
const LIDERES_DNI_MAP = {
  '73050638': 'SEBASTIÁN LEÓN SALOMÉ',
  '47584113': 'MARIA SOLEDAD LONGA GRANDA',
  '47814182': 'WILDER ANIBAL LÓPEZ ALARCÓN',
  '47844514': 'JHONATAN FRANCISCO FIESTAS PATAZCA',
  '72648617': 'CRISTINA NOMBERA BAZÁN',
  '16654195': 'PEDRO ALEJANDRO LEÓN BONILLA',
  '74447092': 'FATIMA ELIZABETH GONZALES FIESTAS',
  '75262428': 'MARÍA ISABEL BAUDAT SANCHEZ',
  '77212304': 'RICARDO ACOSTA DEL AGUILA',
  '72693556': 'ANNGHY GABRIELA SALAZAR GONZALES',
  '76069148': 'ELENA XIOMARA SOPLOPUCO LOCONI',
  '73381541': 'PAMELA DEL MILAGRO QUICIO MONJE',
  '75194090': 'PRISCILLA NIÑO MALDONADO',
  '71436152': 'LUIS MIGUEL CHUMAN MONTERO',
  '46066172': 'WALTER GARCIA',
  '72307847': 'SANDY TATIANA LIMO ORÉ',
  '75245598': 'KATHERYN MELISA MARTINEZ BARBADILLO',
  '46054145': 'CHISCUL ESQUIVES ANYELO HERNAN',
  '75879740': 'SANTOS MAXIMO FIESTAS PATAZCA'
};

// Directorio Oficial de Contactos de Responsables Generales
const LIDERES_CONTACTOS = {
  'SEBASTIÁN LEÓN SALOMÉ': { nombre: 'SEBASTIÁN LEÓN SALOMÉ', dni: '73050638', telefono: '969262965' },
  'CRISTINA NOMBERA BAZÁN': { nombre: 'CRISTINA NOMBERA BAZÁN', dni: '72648617', telefono: '965855389' },
  'MARIA SOLEDAD LONGA GRANDA': { nombre: 'MARIA SOLEDAD LONGA GRANDA', dni: '47584113', telefono: '973448224' },
  'PEDRO ALEJANDRO LEÓN BONILLA': { nombre: 'PEDRO ALEJANDRO LEÓN BONILLA', dni: '16654195', telefono: '977647804' },
  'JHONATAN FRANCISCO FIESTAS PATAZCA': { nombre: 'JHONATAN FRANCISCO FIESTAS PATAZCA', dni: '47844514', telefono: '902090251' },
  'FATIMA ELIZABETH GONZALES FIESTAS': { nombre: 'FATIMA ELIZABETH GONZALES FIESTAS', dni: '74447092', telefono: '902464835' },
  'MARÍA ISABEL BAUDAT SANCHEZ': { nombre: 'MARÍA ISABEL BAUDAT SANCHEZ', dni: '75262428', telefono: '933355980' },
  'RICARDO ACOSTA DEL AGUILA': { nombre: 'RICARDO ACOSTA DEL AGUILA', dni: '77212304', telefono: '978775922' },
  'ANNGHY GABRIELA SALAZAR GONZALES': { nombre: 'ANNGHY GABRIELA SALAZAR GONZALES', dni: '72693556', telefono: '902889214' },
  'ELENA XIOMARA SOPLOPUCO LOCONI': { nombre: 'ELENA XIOMARA SOPLOPUCO LOCONI', dni: '76069148', telefono: '948977709' },
  'PAMELA DEL MILAGRO QUICIO MONJE': { nombre: 'PAMELA DEL MILAGRO QUICIO MONJE', dni: '73381541', telefono: '971113192' },
  'PRISCILLA NIÑO MALDONADO': { nombre: 'PRISCILLA NIÑO MALDONADO', dni: '75194090', telefono: '916323470' },
  'LUIS MIGUEL CHUMAN MONTERO': { nombre: 'LUIS MIGUEL CHUMAN MONTERO', dni: '71436152', telefono: '988337192' },
  'WALTER GARCIA': { nombre: 'WALTER GARCIA', dni: '46066172', telefono: '979355434' },
  'SANDY TATIANA LIMO ORÉ': { nombre: 'SANDY TATIANA LIMO ORÉ', dni: '72307847', telefono: '985663156' },
  'KATHERYN MELISA MARTINEZ BARBADILLO': { nombre: 'KATHERYN MELISA MARTINEZ BARBADILLO', dni: '75245598', telefono: '962263041' },
  'CHISCUL ESQUIVES ANYELO HERNAN': { nombre: 'CHISCUL ESQUIVES ANYELO HERNAN', dni: '46054145', telefono: '970227489' },
  'SANTOS MAXIMO FIESTAS PATAZCA': { nombre: 'SANTOS MAXIMO FIESTAS PATAZCA', dni: '75879740', telefono: '946951209' },
  'WILDER ANIBAL LÓPEZ ALARCÓN': { nombre: 'WILDER ANIBAL LÓPEZ ALARCÓN', dni: '47814182', telefono: '920381638' }
};

const LIDER_ALIASES = {
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
  'SANDY': 'SANDY TATIANA LIMO ORÉ',
  'SANDY LIMO ORÉ': 'SANDY TATIANA LIMO ORÉ',
  'SANDY LIMO ORE': 'SANDY TATIANA LIMO ORÉ',
  'MELISSA': 'KATHERYN MELISA MARTINEZ BARBADILLO',
  'KATHERYN MELISA MARTINEZ': 'KATHERYN MELISA MARTINEZ BARBADILLO',
  'ANYELO': 'CHISCUL ESQUIVES ANYELO HERNAN',
  'ANYELO HERNAN CHISCUL ESQUIVES': 'CHISCUL ESQUIVES ANYELO HERNAN',
  'MAX': 'SANTOS MAXIMO FIESTAS PATAZCA',
  'SANTOS MÁXIMO FIESTAS PATAZCA': 'SANTOS MAXIMO FIESTAS PATAZCA',
  'WILDER': 'WILDER ANIBAL LÓPEZ ALARCÓN',
  'PEDRO LEON': 'PEDRO ALEJANDRO LEÓN BONILLA',
  'PEDRO LEÓN': 'PEDRO ALEJANDRO LEÓN BONILLA',
  'LUIS CHUMAN': 'LUIS MIGUEL CHUMAN MONTERO'
};

let mandosCache = null;
let mandosCacheExpiry = 0;

async function getLiveMandosContactos() {
  const now = Date.now();
  if (mandosCache && now < mandosCacheExpiry) {
    return mandosCache;
  }
  try {
    const { data, error } = await supabase
      .from('estructura_mandos')
      .select('responsable_nombre, responsable_dni, responsable_telefono')
      .not('responsable_nombre', 'is', null);

    if (error) {
      console.error('Error cargando estructura_mandos para contactos:', error.message);
      return mandosCache || LIDERES_CONTACTOS;
    }

    const map = {};
    (data || []).forEach(row => {
      if (row.responsable_nombre) {
        const norm = row.responsable_nombre.trim().toUpperCase();
        if (!map[norm] || (!map[norm].telefono && row.responsable_telefono)) {
          map[norm] = {
            nombre: row.responsable_nombre,
            dni: row.responsable_dni,
            telefono: row.responsable_telefono
          };
        }
      }
    });

    mandosCache = map;
    mandosCacheExpiry = now + 30000; // Cache 30 segundos
    return mandosCache;
  } catch (err) {
    console.error('Error en getLiveMandosContactos:', err.message);
    return mandosCache || LIDERES_CONTACTOS;
  }
}

function resolverContactoResponsable(rawName, rawDni, liveMap = null) {
  let canonical = null;
  if (rawDni && LIDERES_DNI_MAP[rawDni]) {
    canonical = LIDERES_DNI_MAP[rawDni];
  } else if (rawName) {
    const clean = String(rawName).replace(/^Equipo\s+/i, '').trim().toUpperCase();
    if (LIDERES_CONTACTOS[clean]) {
      canonical = clean;
    } else if (LIDER_ALIASES[clean]) {
      canonical = LIDER_ALIASES[clean];
    } else if (LIDERES_MAP[clean]) {
      canonical = LIDERES_MAP[clean];
    } else {
      canonical = clean;
    }
  }

  if (!canonical) return null;

  // 1. Prioridad: Buscar en la base de datos viva (estructura_mandos)
  if (liveMap && liveMap[canonical] && liveMap[canonical].telefono) {
    return liveMap[canonical];
  }

  // 2. Si liveMap no tiene coincidencia exacta, buscar por similitud
  if (liveMap) {
    const keys = Object.keys(liveMap);
    const foundKey = keys.find(k => k === canonical || k.includes(canonical) || canonical.includes(k));
    if (foundKey && liveMap[foundKey]?.telefono) {
      return liveMap[foundKey];
    }
  }

  // 3. Fallback a directorio base
  if (LIDERES_CONTACTOS[canonical]) {
    return LIDERES_CONTACTOS[canonical];
  }

  return null;
}

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
  const headerRow = rows[0] || [];

  // Detección dinámica de columnas según nombres oficiales
  let colDniVol = headerRow.findIndex((h) => h && /dni/i.test(String(h)) && !/resp/i.test(String(h)));
  if (colDniVol === -1) colDniVol = 6;

  let colCruzLopez = headerRow.findIndex((h) => h && /cruz\s*l[oó]pe?z/i.test(String(h)));
  if (colCruzLopez === -1) colCruzLopez = 2;

  let colDniResp = headerRow.findIndex((h) => h && /dni\s*resp/i.test(String(h)));
  if (colDniResp === -1) colDniResp = 3;

  console.log(`Columnas mapeadas -> DNI Voluntario: [${colDniVol}] ${headerRow[colDniVol]} | Cruz López: [${colCruzLopez}] ${headerRow[colCruzLopez]} | DNI Responsable: [${colDniResp}] ${headerRow[colDniResp]}`);

  const dataRows = rows.slice(1).filter(r => r && r[colDniVol] && /^\d+$/.test(String(r[colDniVol]).trim()));

  console.log(`2. Total registros válidos con DNI en el Excel: ${dataRows.length}`);

  let asignadosLider = 0;
  let asignadosSede = 0;
  let sinLugar = 0;

  const itemsToUpdate = [];

  for (const r of dataRows) {
    const dni = String(r[colDniVol]).trim();
    const rawCruz = r[colCruzLopez] ? String(r[colCruzLopez]).trim().toUpperCase() : null;
    const rawDniResp = r[colDniResp] && /^\d+$/.test(String(r[colDniResp]).trim()) ? String(r[colDniResp]).trim() : null;

    let lider = null;
    let lugar = null;

    // 1. Prioridad: Resolver por DNI del Responsable si existe
    if (rawDniResp && LIDERES_DNI_MAP[rawDniResp]) {
      lider = LIDERES_DNI_MAP[rawDniResp];
      lugar = `Equipo ${lider}`;
    }

    // 2. Resolver o complementar por Columna Cruz López
    if (rawCruz) {
      if (LIDERES_MAP[rawCruz]) {
        lider = LIDERES_MAP[rawCruz];
        lugar = `Equipo ${lider}`;
      } else if (LUGARES_SEDES.includes(rawCruz)) {
        lugar = rawCruz;
      } else if (!lugar) {
        lugar = rawCruz;
      }
    }

    if (lider) {
      asignadosLider++;
      itemsToUpdate.push({ dni, lider, lugar });
    } else if (lugar) {
      asignadosSede++;
      itemsToUpdate.push({ dni, lider: null, lugar });
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
  syncAsignacionesVoluntarios,
  resolverContactoResponsable,
  getLiveMandosContactos,
  LIDERES_CONTACTOS,
  LIDERES_MAP,
  LIDERES_DNI_MAP
};
