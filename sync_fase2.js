const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Falta SUPABASE_URL o SUPABASE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1Gi1rklB4qUSGHIFTemzlFEMBzChCwwkqxvSXbiTBmzk/export?format=csv';

function normalizeDni(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d+$/.test(str) && str.length < 8) {
    return str.padStart(8, '0');
  }
  return str;
}

function parseExcelDateTime(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const p = xlsx.SSF.parse_date_code(val);
    if (!p) return null;
    const y = String(p.y);
    const m = String(p.m).padStart(2, '0');
    const d = String(p.d).padStart(2, '0');
    const H = String(p.H || 0).padStart(2, '0');
    const M = String(p.M || 0).padStart(2, '0');
    const S = String(p.S || 0).padStart(2, '0');
    return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function getDniFromRow(r) {
  for (const k of Object.keys(r)) {
    if (k.toLowerCase().includes('digite')) {
      const v = r[k];
      if (v) return normalizeDni(v);
    }
  }
  return null;
}

function getUrl(r, term) {
  for (const k of Object.keys(r)) {
    if (k.toLowerCase().includes(term.toLowerCase())) {
      const v = r[k];
      if (typeof v === 'string' && v.startsWith('http')) return v.trim();
    }
  }
  return null;
}

function getObservationFromRow(r) {
  const parts = [];
  for (const [k, v] of Object.entries(r)) {
    if (!v) continue;
    const key = k.toLowerCase().trim();
    const val = String(v).trim();
    if (!val) continue;

    // Ignorar urls de drive o valores de columnas fijas conocidas
    if (val.startsWith('http')) continue;
    if (key.includes('marca temporal') || key.includes('nombre') || key.includes('dni') || key === 'validado') continue;
    if (val === 'LAMBAYEQUE' || val === 'UNI' || val === 'NO' || val === 'SI' || val === 'SÍ') continue;

    if (
      key.includes('observaci') ||
      key.includes('criterio') ||
      key.includes('columna 10') ||
      key.includes('obs') ||
      key.includes('motivo') ||
      key.includes('verificar')
    ) {
      if (!parts.includes(val)) {
        parts.push(val);
      }
    }
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

async function syncFase2Data() {
  console.log(`\n======================================================`);
  console.log(`🚀 SINCRONIZACIÓN DE FASE 2 DESDE GOOGLE SHEETS`);
  console.log(`🌐 Descargando datos en vivo de Google Sheets...`);
  console.log(`======================================================\n`);

  let csvText;
  try {
    const res = await fetch(GOOGLE_SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    csvText = await res.text();
  } catch (err) {
    console.error('❌ Error al descargar el CSV de Google Sheets:', err.message);
    return { success: false, error: err.message };
  }

  const wb = xlsx.read(csvText, { type: 'string' });
  const sheetName = wb.SheetNames[0];
  const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);

  console.log(`📋 Total de filas recibidas de Google Sheets: ${rawRows.length}`);

  if (rawRows.length === 0) {
    console.log('⚠️ La hoja de Google Sheets está vacía.');
    return { success: true, count: 0 };
  }

  // Filtrar filas válidas y extraer DNIs dando prioridad a los registros VALIDADOS
  const validMap = new Map();

  for (const r of rawRows) {
    const dni = getDniFromRow(r);
    if (!dni) continue;

    const valStr = String(r['VALIDADO'] || '').trim().toUpperCase();
    const isApproved = valStr === 'SI' || valStr === 'SÍ';
    const isVerificar = valStr.includes('VERIFICAR');

    if (!validMap.has(dni)) {
      validMap.set(dni, r);
    } else {
      const prevValStr = String(validMap.get(dni)['VALIDADO'] || '').trim().toUpperCase();
      const prevApproved = prevValStr === 'SI' || prevValStr === 'SÍ';
      const prevVerificar = prevValStr.includes('VERIFICAR');

      if (!prevApproved && isApproved) {
        validMap.set(dni, r);
      } else if (!prevApproved && !prevVerificar && isVerificar) {
        validMap.set(dni, r);
      } else if (!prevApproved && !isApproved) {
        validMap.set(dni, r);
      }
    }
  }

  const validRows = [];
  const dnisToLookup = [];
  for (const [dni, r] of validMap.entries()) {
    validRows.push({ raw: r, dni });
    dnisToLookup.push(dni);
  }

  console.log(`🔍 Registros únicos con DNI válido: ${validRows.length}`);

  // Cruce con tabla voluntarios_general (Fase 1) por DNI
  console.log(`🔗 Cruzando con la tabla 'voluntarios_general' (Fase 1)...`);
  const generalMap = new Map();
  const CHUNK_SIZE = 500;
  for (let i = 0; i < dnisToLookup.length; i += CHUNK_SIZE) {
    const chunk = dnisToLookup.slice(i, i + CHUNK_SIZE);
    const { data: generalData, error } = await supabase
      .from('voluntarios_general')
      .select('dni, codigo, servicio, talla, departamento, provincia, distrito, correo, telefono, contacto_emergencia, telefono_emergencia, fecha_nacimiento, edad')
      .in('dni', chunk);

    if (error) {
      console.warn('⚠️ Error al consultar lote en voluntarios_general:', error.message);
    } else if (generalData) {
      generalData.forEach(g => generalMap.set(g.dni, g));
    }
  }

  console.log(`✅ Coincidencias encontradas en Fase 1: ${generalMap.size} de ${validRows.length}`);

  // Obtener el último correlativo VOL-2026-CIX para nuevos registros
  const { data: maxCixData } = await supabase
    .from('voluntarios')
    .select('codigo')
    .ilike('codigo', 'VOL-2026-CIX%')
    .order('codigo', { ascending: false })
    .limit(1);

  let nextCixNumber = 1;
  if (maxCixData && maxCixData.length > 0 && maxCixData[0].codigo) {
    const match = maxCixData[0].codigo.match(/CIX(\d+)/);
    if (match) nextCixNumber = parseInt(match[1], 10) + 1;
  }

  const f1NewRecords = [];

  // Construir registros para la tabla voluntarios
  const rowsToUpsert = [];

  for (const item of validRows) {
    const r = item.raw;
    const dni = item.dni;
    const g = generalMap.get(dni) || {};

    let codigoVoluntario = g.codigo || null;
    if (!codigoVoluntario) {
      codigoVoluntario = `VOL-2026-CIX${String(nextCixNumber).padStart(3, '0')}`;
      nextCixNumber++;
      f1NewRecords.push({
        dni: dni,
        codigo: codigoVoluntario,
        nombres_apellidos: String(r['NOMBRES Y APELLIDOS'] || r['APELLIDOS Y NOMBRES'] || r['Nombres y Apellidos'] || 'Sin Nombre').trim().toUpperCase(),
        jurisdiccion: 'Chiclayo',
        estado: 'CON_FASE2',
        fase: '2',
        tiene_whatsapp: false
      });
    }

    const valStr = String(r['VALIDADO'] || '').trim().toUpperCase();
    const isApproved = valStr === 'SI' || valStr === 'SÍ';
    const isVerificar = valStr.includes('VERIFICAR');
    const isRejected = valStr === 'NO' || valStr.startsWith('NO') || valStr.includes('RECHAZ');

    let estado = 'PENDIENTE';
    let fase = '2';

    if (isApproved) {
      estado = 'SELECCIONADO';
      fase = '3';
    } else if (isRejected) {
      estado = 'NO SELECCIONADO';
      fase = '2';
    } else if (isVerificar) {
      estado = 'EN REVISIÓN';
      fase = '2';
    }

    // Extraer observaciones (Columna 10, Criterio de observación, etc.)
    const observacion = getObservationFromRow(r);

    const row = {
      dni: dni,
      codigo: codigoVoluntario,
      nombres_apellidos: String(r['Nombres y Apellidos'] || g.nombres_apellidos || '').trim().toUpperCase(),
      fecha_nacimiento: g.fecha_nacimiento || null,
      edad: g.edad || null,
      correo: g.correo || null,
      telefono: g.telefono || null,
      contacto_emergencia: g.contacto_emergencia || null,
      telefono_emergencia: g.telefono_emergencia || null,
      departamento: g.departamento || null,
      provincia: g.provincia || null,
      distrito: g.distrito || null,
      servicio: g.servicio || null,
      talla: g.talla || null,
      archivo_compromiso_url: getUrl(r, 'dni') || getUrl(r, 'pasaporte') || null,
      archivo_cul_url: getUrl(r, 'cul') || null,
      archivo_carta_url: getUrl(r, 'carta') || null,
      info_validada: isApproved,
      estado: estado,
      fase: fase,
      observacion: observacion,
      fecha_inscripcion: parseExcelDateTime(r['..'])
    };

    rowsToUpsert.push(row);
  }

  // Upsert en lotes de 200 en voluntarios
  const BATCH_SIZE = 200;
  const totalBatches = Math.ceil(rowsToUpsert.length / BATCH_SIZE);
  let totalSaved = 0;

  console.log(`📦 Guardando en Supabase tabla 'voluntarios' (${totalBatches} lotes)...`);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const end = start + BATCH_SIZE;
    const batch = rowsToUpsert.slice(start, end);

    const { error } = await supabase
      .from('voluntarios')
      .upsert(batch, { onConflict: 'dni' });

    if (error) {
      console.error(`⚠️ Error en lote ${b + 1}:`, error.message);
    } else {
      totalSaved += batch.length;
    }
  }

  console.log(`\n🎉 Sincronización completada: ${totalSaved} registros guardados en 'voluntarios'.`);
  const aprobadosCount = rowsToUpsert.filter(r => r.info_validada).length;
  console.log(`🏆 Postulantes SELECCIONADOS que pasan a Fase 3: ${aprobadosCount}`);
  console.log(`🔍 Postulantes en REVISIÓN/OBSERVADOS: ${rowsToUpsert.filter(r => r.estado === 'EN REVISIÓN').length}`);
  console.log(`⏳ Postulantes PENDIENTES: ${rowsToUpsert.filter(r => r.estado === 'PENDIENTE').length}\n`);

  // Cruce y actualización en la tabla 'voluntarios_general' (Fase 1)
  console.log(`🔄 Actualizando estado de Fase 2 en 'voluntarios_general' (Fase 1)...`);
  try {
    // 0. Si hay voluntarios nuevos sin registro en Fase 1, insertarlos primero
    if (f1NewRecords.length > 0) {
      console.log(`📥 Registrando ${f1NewRecords.length} nuevos voluntarios con código CIX en 'voluntarios_general'...`);
      for (let i = 0; i < f1NewRecords.length; i += 100) {
        const chunk = f1NewRecords.slice(i, i + 100);
        await supabase.from('voluntarios_general').upsert(chunk, { onConflict: 'dni' });
      }
      console.log(`✅ ${f1NewRecords.length} nuevos voluntarios incorporados a Fase 1.`);
    }

    const f2Dnis = rowsToUpsert.map(r => r.dni);
    // 1. Marcar en lotes de 500 los que sí enviaron Fase 2
    for (let i = 0; i < f2Dnis.length; i += 500) {
      const chunk = f2Dnis.slice(i, i + 500);
      await supabase.from('voluntarios_general').update({ estado: 'CON_FASE2', fase: '2' }).in('dni', chunk);
    }
    console.log(`✅ Cruce con 'voluntarios_general' completado.`);

    // 2. Heredar jurisdicción desde Fase 1 para mantener coherencia geográfica
    await supabase.rpc('exec_sql', {
      sql: `UPDATE voluntarios v SET jurisdiccion = vg.jurisdiccion FROM voluntarios_general vg WHERE v.dni = vg.dni AND (v.jurisdiccion IS NULL OR v.jurisdiccion = '') AND vg.jurisdiccion IS NOT NULL;`
    });
    console.log(`✅ Jurisdicciones sincronizadas en Fase 2.`);
  } catch (errSync) {
    console.warn(`⚠️ Error actualizando estado en voluntarios_general:`, errSync.message);
  }

  return {
    success: true,
    total: totalSaved,
    aprobados: aprobadosCount
  };
}

// Si se ejecuta directamente desde la terminal
if (require.main === module) {
  syncFase2Data();
}

module.exports = { syncFase2Data };
