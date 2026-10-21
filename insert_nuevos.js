const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
const path = require('path');
const { logAudit } = require('./audit');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function normalizeDoc(raw) {
  if (!raw) return null;
  let str = String(raw).trim().toUpperCase();
  if (/^\d+$/.test(str) && str.length < 8) {
    str = str.padStart(8, '0');
  }
  return str;
}

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
    try {
      return new Date(val).toISOString();
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function runInsert() {
  console.log('\n=============================================================');
  console.log('🚀 INSERCIÓN LIMPIA DE NUEVOS VOLUNTARIOS (FASE 1)');
  console.log('=============================================================\n');

  console.log('🔍 1. Descargando DNIs y Códigos actuales para garantizar 0 duplicados...');
  const existingDnis = new Set();
  const existingCodigos = new Set();
  let page = 0;
  const size = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('voluntarios_general')
      .select('dni, codigo')
      .range(page * size, (page + 1) * size - 1);

    if (error) {
      console.error('❌ Error consultando base de datos:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (r.dni) existingDnis.add(normalizeDoc(r.dni));
      if (r.codigo) existingCodigos.add(String(r.codigo).trim().toUpperCase());
    }

    if (data.length < size) break;
    page++;
  }

  const prevTotal = existingDnis.size;
  console.log(`✅ Base de datos actual: ${prevTotal} registros existentes verificados.`);

  console.log('\n📖 2. Procesando archivo nuevos_voluntarios.xlsx...');
  const filePath = path.resolve(__dirname, 'nuevos_voluntarios.xlsx');
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = xlsx.utils.sheet_to_json(sheet);

  const seenInFile = new Set();
  const toInsert = [];
  let yaExistentes = 0;

  for (const r of rawRows) {
    const doc = normalizeDoc(r['DNI']);
    const cod = r['Código'] ? String(r['Código']).trim().toUpperCase() : null;

    if (!doc || seenInFile.has(doc)) continue;
    seenInFile.add(doc);

    if (existingDnis.has(doc) || (cod && existingCodigos.has(cod))) {
      yaExistentes++;
      continue;
    }

    toInsert.push({
      codigo: r['Código'] ? String(r['Código']).trim() : null,
      nombres_apellidos: String(r['Nombres y apellidos'] || '').trim().toUpperCase(),
      dni: doc,
      fecha_nacimiento: parseExcelDate(r['Fecha de nacimiento']),
      edad: parseInt(r['Edad'], 10) || null,
      correo: r['Correo'] ? String(r['Correo']).trim().toLowerCase() : null,
      telefono: r['Teléfono'] ? String(r['Teléfono']).trim() : null,
      departamento: r['Departamento'] ? String(r['Departamento']).trim().toUpperCase() : null,
      provincia: r['Provincia'] ? String(r['Provincia']).trim().toUpperCase() : null,
      distrito: r['Distrito'] ? String(r['Distrito']).trim().toUpperCase() : null,
      direccion: r['Dirección'] ? String(r['Dirección']).trim() : null,
      jurisdiccion: r['Jurisdicción'] ? String(r['Jurisdicción']).trim() : null,
      servicio: r['Servicio'] ? String(r['Servicio']).trim() : null,
      talla: r['Talla'] ? String(r['Talla']).trim().toUpperCase() : null,
      estado: 'SIN_FASE2', // Listo para ser contactado
      fase: null, // Sin asignar a colaborador todavía
      tiene_whatsapp: true,
      fecha_inscripcion: parseExcelDateTime(r['Fecha de inscripción'])
    });
  }

  console.log(`\n📊 Análisis del archivo:`);
  console.log(`   - Filas totales:            ${rawRows.length}`);
  console.log(`   - Omitidos (ya registrados): ${yaExistentes} (se mantienen intactos)`);
  console.log(`   - Nuevos a insertar:         ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('\n⚠️ No hay nuevos voluntarios para insertar. Todos ya están registrados.');
    return;
  }

  console.log(`\n💾 3. Insertando ${toInsert.length} nuevos voluntarios en lotes de 200...`);
  const BATCH_SIZE = 200;
  let insertedCount = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const chunk = toInsert.slice(i, i + BATCH_SIZE);
    const { error: insErr } = await supabase
      .from('voluntarios_general')
      .insert(chunk);

    if (insErr) {
      console.error(`❌ Error insertando lote ${i} - ${i + chunk.length}:`, insErr.message);
    } else {
      insertedCount += chunk.length;
      console.log(`   ✓ Insertados ${insertedCount} de ${toInsert.length}...`);
    }
  }

  // Registrar en historial de auditoría
  await logAudit({
    accion: 'CARGA_NUEVOS_VOLUNTARIOS',
    detalles: {
      archivo: 'nuevos_voluntarios.xlsx',
      filasExcel: rawRows.length,
      nuevosInsertados: insertedCount,
      existentesOmitidos: yaExistentes,
      totalPadrónAnterior: prevTotal,
      nuevoTotalPadrón: prevTotal + insertedCount
    }
  });

  const { count: finalCount } = await supabase
    .from('voluntarios_general')
    .select('id', { count: 'exact', head: true });

  console.log('\n=============================================================');
  console.log('🎉 ¡INSERCIÓN COMPLETADA EXITOSAMENTE!');
  console.log(`   - Anteriores en la base:  ${prevTotal}`);
  console.log(`   - Nuevos incorporados:    +${insertedCount}`);
  console.log(`   - Total final actualizado: ${finalCount} registros en voluntarios_general`);
  console.log('=============================================================\n');
}

runInsert();
