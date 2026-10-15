const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Falta SUPABASE_URL o SUPABASE_KEY en el archivo .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Función auxiliar para parsear fechas de Excel (números de serie) a formato YYYY-MM-DD
function parseExcelDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const p = xlsx.SSF.parse_date_code(val);
    if (!p) return null;
    const y = String(p.y);
    const m = String(p.m).padStart(2, '0');
    const d = String(p.d).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.includes('T')) return trimmed.split('T')[0];
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) return trimmed;
    // Formato DD/MM/YYYY
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return null;
}

// Función auxiliar para parsear fecha con hora (Fecha de inscripción)
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
    return new Date(val).toISOString();
  }
  return null;
}

// Normalizador de DNI
function normalizeDni(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  // Si es numérico y tiene entre 6 y 7 dígitos, rellenar con ceros a la izquierda
  if (/^\d+$/.test(str) && str.length < 8) {
    return str.padStart(8, '0');
  }
  return str;
}

async function runImport() {
  const filename = process.argv[2] || 'Chiclayo-general.xlsx';
  const filePath = path.resolve(__dirname, filename);

  console.log(`\n======================================================`);
  console.log(`🚀 INICIANDO IMPORTACIÓN MASIVA - ETAPA 1 (PADRÓN GENERAL)`);
  console.log(`📁 Archivo: ${filename}`);
  console.log(`======================================================\n`);

  let wb;
  try {
    wb = xlsx.readFile(filePath);
  } catch (err) {
    console.error(`❌ No se pudo abrir el archivo ${filePath}:`, err.message);
    process.exit(1);
  }

  const sheetName = wb.SheetNames[0];
  console.log(`📄 Leyendo hoja: "${sheetName}"...`);
  const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`📋 Total de filas encontradas en el Excel: ${rawRows.length}\n`);

  if (rawRows.length === 0) {
    console.log('⚠️ El archivo está vacío.');
    return;
  }

  // Mapear y sanear cada fila
  const seenDnis = new Set();
  const sanitizedRows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const dni = normalizeDni(r['DNI']);

    if (!dni) {
      console.warn(`⚠️ Fila ${i + 2}: DNI vacío, se omitirá.`);
      continue;
    }

    if (seenDnis.has(dni)) {
      console.warn(`⚠️ Fila ${i + 2}: DNI duplicado (${dni}) en el Excel, se toma la primera ocurrencia.`);
      continue;
    }
    seenDnis.add(dni);

    const row = {
      codigo: r['Código'] ? String(r['Código']).trim() : null,
      nombres_apellidos: String(r['Nombres y apellidos'] || '').trim().toUpperCase(),
      dni: dni,
      fecha_nacimiento: parseExcelDate(r['Fecha de nacimiento']),
      edad: parseInt(r['Edad'], 10) || null,
      correo: r['Correo'] ? String(r['Correo']).trim().toLowerCase() : null,
      telefono: r['Teléfono'] ? String(r['Teléfono']).trim() : null,
      contacto_emergencia: r['Contacto de emergencia'] ? String(r['Contacto de emergencia']).trim() : null,
      telefono_emergencia: r['Teléfono de emergencia'] ? String(r['Teléfono de emergencia']).trim() : null,
      departamento: r['Departamento'] ? String(r['Departamento']).trim().toUpperCase() : null,
      provincia: r['Provincia'] ? String(r['Provincia']).trim().toUpperCase() : null,
      distrito: r['Distrito'] ? String(r['Distrito']).trim().toUpperCase() : null,
      direccion: r['Dirección'] ? String(r['Dirección']).trim() : null,
      jurisdiccion: r['Jurisdicción'] ? String(r['Jurisdicción']).trim() : null,
      servicio: r['Servicio'] ? String(r['Servicio']).trim() : null,
      talla: r['Talla'] ? String(r['Talla']).trim().toUpperCase() : null,
      estado: 'PENDIENTE',
      fase: r['Fase'] ? String(r['Fase']).trim() : '1',
      fecha_inscripcion: parseExcelDateTime(r['Fecha de inscripción'])
    };

    sanitizedRows.push(row);
  }

  console.log(`✅ Registros válidos listos para sincronizar: ${sanitizedRows.length}`);

  // Dividir en lotes (chunks) de 250 registros para no saturar la API
  const BATCH_SIZE = 250;
  const totalBatches = Math.ceil(sanitizedRows.length / BATCH_SIZE);
  let totalUpserted = 0;

  console.log(`📦 Procesando en ${totalBatches} lotes de ${BATCH_SIZE} registros...\n`);

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const end = start + BATCH_SIZE;
    const batch = sanitizedRows.slice(start, end);

    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      try {
        const { error } = await supabase
          .from('voluntarios')
          .upsert(batch, { onConflict: 'dni' });

        if (error) {
          throw error;
        }

        totalUpserted += batch.length;
        const percent = ((totalUpserted / sanitizedRows.length) * 100).toFixed(1);
        console.log(`   [Lote ${b + 1}/${totalBatches}] Sincronizados ${totalUpserted} de ${sanitizedRows.length} (${percent}%)`);
        success = true;
      } catch (err) {
        retries--;
        console.error(`   ⚠️ Error en Lote ${b + 1} (${err.message}). Reintentos restantes: ${retries}`);
        if (retries > 0) {
          await new Promise(res => setTimeout(res, 2000));
        } else {
          console.error(`   ❌ No se pudo completar el lote ${b + 1}. Se continuará con el siguiente.`);
        }
      }
    }
  }

  // Verificación final en Supabase
  console.log(`\n------------------------------------------------------`);
  const { count, error: countErr } = await supabase
    .from('voluntarios')
    .select('id', { count: 'exact', head: true });

  if (!countErr) {
    console.log(`🎉 ¡IMPORTACIÓN FINALIZADA CON ÉXITO!`);
    console.log(`📊 Total actual de voluntarios en Supabase: ${count} registros.`);
  } else {
    console.log(`✅ Proceso finalizado. Total procesado: ${totalUpserted}`);
  }
  console.log(`======================================================\n`);
}

runImport();
