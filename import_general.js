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
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return null;
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
    return new Date(val).toISOString();
  }
  return null;
}

function normalizeDni(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d+$/.test(str) && str.length < 8) {
    return str.padStart(8, '0');
  }
  return str;
}

async function runImport() {
  const filename = process.argv[2] || 'Chiclayo-general.xlsx';
  const filePath = path.resolve(__dirname, filename);

  console.log(`\n======================================================`);
  console.log(`🚀 IMPORTACIÓN A TABLA PRINCIPAL: voluntarios_general (FASE 1)`);
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
  const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
  console.log(`📋 Total de filas encontradas en el Excel: ${rawRows.length}\n`);

  if (rawRows.length === 0) {
    console.log('⚠️ El archivo está vacío.');
    return;
  }

  const seenDnis = new Set();
  const sanitizedRows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const dni = normalizeDni(r['DNI']);

    if (!dni) continue;
    if (seenDnis.has(dni)) continue;
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
      estado: r['Estado'] ? String(r['Estado']).trim() : 'PENDIENTE',
      fase: '1',
      fecha_inscripcion: parseExcelDateTime(r['Fecha de inscripción'])
    };

    sanitizedRows.push(row);
  }

  console.log(`✅ Registros válidos listos para importar a 'voluntarios_general': ${sanitizedRows.length}`);

  const BATCH_SIZE = 250;
  const totalBatches = Math.ceil(sanitizedRows.length / BATCH_SIZE);
  let totalUpserted = 0;

  for (let b = 0; b < totalBatches; b++) {
    const start = b * BATCH_SIZE;
    const end = start + BATCH_SIZE;
    const batch = sanitizedRows.slice(start, end);

    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      try {
        const { error } = await supabase
          .from('voluntarios_general')
          .upsert(batch, { onConflict: 'dni' });

        if (error) throw error;

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
          console.error(`   ❌ No se pudo completar el lote ${b + 1}.`);
        }
      }
    }
  }

  const { count, error: countErr } = await supabase
    .from('voluntarios_general')
    .select('id', { count: 'exact', head: true });

  if (!countErr) {
    console.log(`\n🎉 ¡IMPORTACIÓN EXITOSA!`);
    console.log(`📊 Total en tabla 'voluntarios_general': ${count} registros.`);
  } else {
    console.log(`\n✅ Proceso completado. Total procesado: ${totalUpserted}`);
  }
}

runImport();
