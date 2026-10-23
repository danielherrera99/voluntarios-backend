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
  const s = String(raw).replace(/\D/g, '').trim();
  if (s.length < 8 && s.length > 0) return s.padStart(8, '0');
  return s;
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
  if (typeof val === 'number') {
    const parsed = xlsx.SSF.parse_date_code(val);
    if (parsed && parsed.y) {
      const y = parsed.y;
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  if (typeof val === 'string') {
    const parts = val.trim().split('/');
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

async function run() {
  console.log('📖 Leyendo contactos.xlsx...');
  const wb = xlsx.readFile('contactos.xlsx');
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log(`📊 Total registros en el Excel: ${rows.length}`);

  const sheetMap = new Map();
  rows.forEach(r => {
    const d = cleanDni(r['DNI']);
    if (d) sheetMap.set(d, r);
  });

  const dnis = Array.from(sheetMap.keys());

  // 1. Consultar en Fase 2 (voluntarios)
  const { data: vList, error: vErr } = await supabase
    .from('voluntarios')
    .select('id, dni, codigo, nombres_apellidos, telefono, correo, fecha_nacimiento, edad')
    .in('dni', dnis);

  if (vErr) {
    console.error('❌ Error al consultar voluntarios:', vErr.message);
    return;
  }

  console.log(`\n🔍 Coincidencias en Fase 2 (voluntarios): ${vList.length} de ${dnis.length}`);

  let updatedF2Count = 0;
  let updatedPhonesF2 = 0;
  let updatedEmailsF2 = 0;
  let updatedBirthdaysF2 = 0;
  let updatedAgesF2 = 0;

  for (const v of vList) {
    const cd = cleanDni(v.dni);
    const row = sheetMap.get(cd);
    if (!row) continue;

    const updates = {};

    // Solo actualizar si actualmente está vacío/nulo
    if (!v.telefono || String(v.telefono).trim() === '') {
      const newPhone = cleanPhone(row['NUMERO DE TELEFONO']);
      if (newPhone) {
        updates.telefono = newPhone;
        updatedPhonesF2++;
      }
    }

    if (!v.correo || String(v.correo).trim() === '') {
      const newEmail = row['CORREO'] ? String(row['CORREO']).trim() : null;
      if (newEmail) {
        updates.correo = newEmail;
        updatedEmailsF2++;
      }
    }

    if (!v.fecha_nacimiento) {
      const newDate = parseBirthDate(row['FECHA DE NACIMIENTO']);
      if (newDate) {
        updates.fecha_nacimiento = newDate;
        updatedBirthdaysF2++;
      }
    }

    if (!v.edad) {
      const newAge = parseInt(row['EDAD'], 10);
      if (newAge && !isNaN(newAge)) {
        updates.edad = newAge;
        updatedAgesF2++;
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabase
        .from('voluntarios')
        .update(updates)
        .eq('id', v.id);

      if (upErr) {
        console.error(`⚠️ Error actualizando voluntario ${v.dni}:`, upErr.message);
      } else {
        updatedF2Count++;
      }
    }
  }

  console.log(`\n✅ Resumen de actualizaciones en Fase 2 (voluntarios):`);
  console.log(`   - Voluntarios actualizados: ${updatedF2Count}`);
  console.log(`   - Teléfonos/celulares agregados: ${updatedPhonesF2}`);
  console.log(`   - Correos agregados: ${updatedEmailsF2}`);
  console.log(`   - Fechas de nacimiento agregadas: ${updatedBirthdaysF2}`);
  console.log(`   - Edades agregadas: ${updatedAgesF2}`);

  // 2. También sincronizar los campos faltantes en Fase 1 (voluntarios_general)
  const { data: gList, error: gErr } = await supabase
    .from('voluntarios_general')
    .select('id, dni, telefono, correo, fecha_nacimiento, edad')
    .in('dni', dnis);

  if (!gErr && gList) {
    let updatedF1Count = 0;
    for (const g of gList) {
      const cd = cleanDni(g.dni);
      const row = sheetMap.get(cd);
      if (!row) continue;

      const updates = {};
      if (!g.telefono || String(g.telefono).trim() === '') {
        const newPhone = cleanPhone(row['NUMERO DE TELEFONO']);
        if (newPhone) updates.telefono = newPhone;
      }
      if (!g.correo || String(g.correo).trim() === '') {
        const newEmail = row['CORREO'] ? String(row['CORREO']).trim() : null;
        if (newEmail) updates.correo = newEmail;
      }
      if (!g.fecha_nacimiento) {
        const newDate = parseBirthDate(row['FECHA DE NACIMIENTO']);
        if (newDate) updates.fecha_nacimiento = newDate;
      }
      if (!g.edad) {
        const newAge = parseInt(row['EDAD'], 10);
        if (newAge && !isNaN(newAge)) updates.edad = newAge;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('voluntarios_general').update(updates).eq('id', g.id);
        updatedF1Count++;
      }
    }
    console.log(`\n✅ Fase 1 (voluntarios_general) actualizada: ${updatedF1Count} registros sincronizados.`);
  }

  // 3. Revisar si quedó alguno sin teléfono en Fase 2
  const { count: sinTelRestantes } = await supabase
    .from('voluntarios')
    .select('id', { count: 'exact', head: true })
    .or('telefono.is.null,telefono.eq.');

  console.log(`\n🏁 Total restante en Fase 2 SIN teléfono: ${sinTelRestantes}`);
}

run();
