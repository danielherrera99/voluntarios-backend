const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Falta SUPABASE_URL o SUPABASE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function cleanDni(raw) {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').trim();
}

function cleanName(n) {
  if (!n) return '';
  return String(n).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cleanPhone(p) {
  if (!p) return null;
  const num = String(p).replace(/\D/g, '').trim();
  if (num.length === 9) return num;
  if (num.length > 9 && num.startsWith('51')) return num.slice(2, 11);
  return num || null;
}

function parseBirthDate(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    // DD/MM/YYYY
    const parts = val.split('/');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }
    const dt = new Date(val);
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
  }
  return null;
}

async function runAssignment() {
  console.log('\n======================================================');
  console.log('🚀 PROCESO DE REGISTRO Y ASIGNACIÓN DE CÓDIGOS VOL-2026-CIX');
  console.log('======================================================\n');

  // 1. Obtener registros sin código en Fase 2 (voluntarios)
  const { data: f2SinCodigo, error: f2Err } = await supabase
    .from('voluntarios')
    .select('*')
    .or('codigo.is.null,codigo.eq.')
    .order('nombres_apellidos', { ascending: true });

  if (f2Err) {
    console.error('❌ Error al obtener voluntarios sin código:', f2Err.message);
    process.exit(1);
  }

  console.log(`📋 Total de registros en Fase 2 sin código: ${f2SinCodigo.length}`);
  if (f2SinCodigo.length === 0) {
    console.log('✅ No hay registros pendientes de código.');
    return;
  }

  // 2. Revisar si alguno ya tiene código en voluntarios_general
  const f2Dnis = f2SinCodigo.map(x => cleanDni(x.dni)).filter(Boolean);
  const { data: f1Matches, error: f1Err } = await supabase
    .from('voluntarios_general')
    .select('dni, codigo, nombres_apellidos, telefono, correo, departamento, provincia, distrito, jurisdiccion')
    .in('dni', f2Dnis);

  if (f1Err) console.warn('⚠️ Error consultando F1 previo:', f1Err.message);

  const f1Map = new Map();
  (f1Matches || []).forEach(f => {
    if (f.dni) f1Map.set(cleanDni(f.dni), f);
  });

  // 3. Cargar el archivo de Google Sheet descargado
  const wb = xlsx.readFile('sheet_filtrado.csv');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const sheetRows = xlsx.utils.sheet_to_json(sheet);
  console.log(`📄 Filas leídas del Google Sheet: ${sheetRows.length}`);

  const sheetDniMap = new Map();
  const sheetNameMap = new Map();

  sheetRows.forEach(r => {
    const d = cleanDni(r['DNI']);
    if (d) sheetDniMap.set(d, r);
    const nm = cleanName(r['NOMBRES Y APELLIDOS COMPLETOS']);
    if (nm) sheetNameMap.set(nm, r);
  });

  // 4. Buscar el último código CIX existente (por si se re-ejecuta)
  const { data: existingCix } = await supabase
    .from('voluntarios')
    .select('codigo')
    .ilike('codigo', 'VOL-2026-CIX%')
    .order('codigo', { ascending: false })
    .limit(1);

  let cixCounter = 1;
  if (existingCix && existingCix.length > 0 && existingCix[0].codigo) {
    const match = existingCix[0].codigo.match(/CIX(\d+)/);
    if (match) {
      cixCounter = parseInt(match[1], 10) + 1;
      console.log(`ℹ️ Último código CIX encontrado: ${existingCix[0].codigo}. Empezando en: CIX${String(cixCounter).padStart(3, '0')}`);
    }
  }

  let countOficialesF1 = 0;
  let countNuevosCIX = 0;
  let countRescatadosSheet = 0;
  let countInsertadosF1 = 0;
  let countActualizadosF2 = 0;

  const f1ToInsert = [];

  for (const v of f2SinCodigo) {
    const cd = cleanDni(v.dni);
    const cn = cleanName(v.nombres_apellidos);

    const f1 = f1Map.get(cd);
    const sheetData = sheetDniMap.get(cd) || sheetNameMap.get(cn);

    let finalCodigo = '';
    let telefono = v.telefono || null;
    let correo = v.correo || null;
    let fechaNac = v.fecha_nacimiento || null;
    let edad = v.edad || null;
    let fotoUrl = v.fotografia_url || null;
    let ocupacion = v.ocupacion_laboral || null;
    let instNombre = v.nombre_institucion || null;
    let instFuncion = v.funcion_institucion || null;

    if (f1 && f1.codigo) {
      finalCodigo = f1.codigo;
      telefono = telefono || f1.telefono;
      correo = correo || f1.correo;
      countOficialesF1++;
    } else {
      finalCodigo = `VOL-2026-CIX${String(cixCounter).padStart(3, '0')}`;
      cixCounter++;
      countNuevosCIX++;
    }

    if (sheetData) {
      countRescatadosSheet++;
      telefono = telefono || cleanPhone(sheetData['CELULAR (NÃ\x9AMERO DE WHATSAPP)'] || sheetData['CELULAR (NÚMERO DE WHATSAPP)']);
      correo = correo || sheetData['CORREO ELECTRÃ\x93NICO'] || sheetData['CORREO ELECTRÓNICO'];
      if (!fechaNac && sheetData['FECHA DE NACIMIENTO']) fechaNac = parseBirthDate(sheetData['FECHA DE NACIMIENTO']);
      if (!edad && sheetData['EDAD']) edad = parseInt(sheetData['EDAD'], 10) || null;
      if (!fotoUrl && sheetData['FotografÃ­a actual. TamaÃ±o carnet (a color) ']) fotoUrl = sheetData['FotografÃ­a actual. TamaÃ±o carnet (a color) '];
      if (!ocupacion && sheetData['OcupaciÃ³n laboral actual  (si eres estudiante, escribe esa condiciÃ³n como ocupaciÃ³n laboral) :  ']) {
        ocupacion = sheetData['OcupaciÃ³n laboral actual  (si eres estudiante, escribe esa condiciÃ³n como ocupaciÃ³n laboral) :  '];
      }
      if (!instNombre && sheetData['Indica a quÃ© InstituciÃ³n/organizaciÃ³n perteneces (Universidad, instituto, CETPRO, etc):']) {
        instNombre = sheetData['Indica a quÃ© InstituciÃ³n/organizaciÃ³n perteneces (Universidad, instituto, CETPRO, etc):'];
      }
      if (!instFuncion && sheetData['CuÃ¡l es tu funciÃ³n dentro de esa InstituciÃ³n / organizaciÃ³n:']) {
        instFuncion = sheetData['CuÃ¡l es tu funciÃ³n dentro de esa InstituciÃ³n / organizaciÃ³n:'];
      }
    }

    // Actualizar registro en Fase 2 (voluntarios)
    const updateF2Payload = {
      codigo: finalCodigo,
      telefono: telefono || null,
      correo: correo || null,
      fecha_nacimiento: fechaNac || null,
      edad: edad || null,
      fotografia_url: fotoUrl || null,
      ocupacion_laboral: ocupacion || null,
      nombre_institucion: instNombre || null,
      funcion_institucion: instFuncion || null
    };

    const { error: updErr } = await supabase
      .from('voluntarios')
      .update(updateF2Payload)
      .eq('id', v.id);

    if (updErr) {
      console.warn(`⚠️ Error actualizando voluntario ${v.dni}:`, updErr.message);
    } else {
      countActualizadosF2++;
    }

    // Si ya existía en Fase 1, actualizarlo
    if (f1) {
      await supabase
        .from('voluntarios_general')
        .update({
          codigo: finalCodigo,
          telefono: telefono || f1.telefono || null,
          correo: correo || f1.correo || null,
          estado: 'CON_FASE2',
          fase: '2'
        })
        .eq('dni', f1.dni);
    } else {
      // Si NO existía en Fase 1, preparar inserción
      f1ToInsert.push({
        dni: v.dni,
        codigo: finalCodigo,
        nombres_apellidos: v.nombres_apellidos,
        telefono: telefono || null,
        correo: correo || null,
        fecha_nacimiento: fechaNac || null,
        edad: edad || null,
        jurisdiccion: 'Chiclayo',
        servicio: v.servicio || null,
        estado: 'CON_FASE2',
        fase: '2',
        tiene_whatsapp: telefono ? true : false
      });
    }
  }

  // Insertar en lotes a voluntarios_general
  if (f1ToInsert.length > 0) {
    console.log(`\n📥 Insertando ${f1ToInsert.length} voluntarios en voluntarios_general (Fase 1)...`);
    const CHUNK_SIZE = 50;
    for (let i = 0; i < f1ToInsert.length; i += CHUNK_SIZE) {
      const chunk = f1ToInsert.slice(i, i + CHUNK_SIZE);
      const { error: insErr } = await supabase
        .from('voluntarios_general')
        .insert(chunk);

      if (insErr) {
        console.warn(`⚠️ Error insertando lote en voluntarios_general:`, insErr.message);
      } else {
        countInsertadosF1 += chunk.length;
      }
    }
  }

  console.log('\n======================================================');
  console.log('🎉 PROCESO COMPLETADO EXITOSAMENTE');
  console.log('======================================================');
  console.log(`✅ Voluntarios actualizados en Fase 2: ${countActualizadosF2}`);
  console.log(`✅ Códigos oficiales nacionales restaurados de F1: ${countOficialesF1}`);
  console.log(`✅ Nuevos códigos VOL-2026-CIX creados: ${countNuevosCIX}`);
  console.log(`✅ Teléfonos y correos rescatados del Google Sheet: ${countRescatadosSheet}`);
  console.log(`✅ Nuevos voluntarios dados de alta en Fase 1: ${countInsertadosF1}`);
  console.log('======================================================\n');
}

runAssignment().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
