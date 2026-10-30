const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Falta SUPABASE_URL o SUPABASE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function cleanDni(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\D/g, '').trim();
  if (s.length < 8 && s.length > 0) return s.padStart(8, '0');
  return s || null;
}

function cleanPhone(p) {
  if (!p) return null;
  const num = String(p).replace(/\D/g, '').trim();
  if (num.length === 9) return num;
  if (num.length > 9 && num.startsWith('51')) return num.slice(2, 11);
  return num || null;
}

function cleanStr(val) {
  if (!val) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

async function run() {
  console.log('\n================================================================');
  console.log('🚀 MIGRACIÓN Y ACTUALIZACIÓN OFICIAL DE JERARQUÍA Y MANDOS 2026');
  console.log('================================================================\n');

  // 1. Crear Backup y alterar columnas en Supabase
  console.log('📦 1. Creando backup en Supabase y asegurando nuevas columnas...');
  const setupSql = `
    -- Crear tabla de respaldo si no existe
    CREATE TABLE IF NOT EXISTS estructura_mandos_backup_20261029 AS 
    TABLE estructura_mandos;

    -- Agregar columnas de contacto
    ALTER TABLE estructura_mandos
    ADD COLUMN IF NOT EXISTS responsable_telefono VARCHAR(50),
    ADD COLUMN IF NOT EXISTS responsable_correo VARCHAR(255),
    ADD COLUMN IF NOT EXISTS lider_telefono VARCHAR(50),
    ADD COLUMN IF NOT EXISTS lider_correo VARCHAR(255),
    ADD COLUMN IF NOT EXISTS guia_telefono VARCHAR(50),
    ADD COLUMN IF NOT EXISTS guia_correo VARCHAR(255);
  `;

  const { error: sqlErr } = await supabase.rpc('exec_sql', { sql: setupSql });
  if (sqlErr) {
    console.warn('⚠️ exec_sql devolvió aviso/error:', sqlErr.message);
  } else {
    console.log('✅ Backup y columnas aseguradas en Supabase.');
  }

  // 2. Leer jerarquia_actualizada.xlsx
  console.log('📖 2. Leyendo jerarquia_actualizada.xlsx y parseando dinámicamente...');
  const wb = xlsx.readFile('jerarquia_actualizada.xlsx');
  
  const records = [];
  let cuadrillaCounter = 1;

  for (let sIdx = 0; sIdx < wb.SheetNames.length; sIdx++) {
    const sheetName = wb.SheetNames[sIdx];
    if (sheetName === 'SANTA CRUZ') continue; // Solo omitir SANTA CRUZ (vacía)

    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    if (!rows || rows.length < 2) continue;

    const row1 = rows[1] || [];
    
    // Encontrar índices de columnas de nombres
    const nameCols = [];
    row1.forEach((val, i) => {
      if (val && String(val).toUpperCase().includes('APELLIDOS')) {
        nameCols.push(i);
      }
    });

    const respCol = nameCols[0] ?? 0;
    const liderCol = nameCols[1] ?? 5;
    const guiaCol = nameCols[2] ?? 10;

    function findCol(start, end, keywords) {
      for (let c = start; c < end; c++) {
        const h = String(row1[c] || '').toUpperCase();
        if (keywords.some(k => h.includes(k))) return c;
      }
      return -1;
    }

    const colMap = {
      resp: {
        nombre: respCol,
        dni: findCol(respCol, liderCol, ['DNI']),
        carta: findCol(respCol, liderCol, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(respCol, liderCol, ['CELULAR', 'TELEF']),
        email: findCol(respCol, liderCol, ['CORREO', 'EMAIL'])
      },
      lider: {
        nombre: liderCol,
        dni: findCol(liderCol, guiaCol, ['DNI']),
        carta: findCol(liderCol, guiaCol, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(liderCol, guiaCol, ['CELULAR', 'TELEF']),
        email: findCol(liderCol, guiaCol, ['CORREO', 'EMAIL'])
      },
      guia: {
        nombre: guiaCol,
        dni: findCol(guiaCol, guiaCol + 7, ['DNI']),
        carta: findCol(guiaCol, guiaCol + 7, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(guiaCol, guiaCol + 7, ['CELULAR', 'TELEF']),
        email: findCol(guiaCol, guiaCol + 7, ['CORREO', 'EMAIL'])
      }
    };

    let currentResp = null;
    let currentLider = null;

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.length === 0) continue;

      // Leer Responsable
      const rNom = cleanStr(row[colMap.resp.nombre]);
      if (rNom && rNom.length > 2 && !rNom.toUpperCase().includes('APELLIDOS')) {
        currentResp = {
          nombre: rNom.toUpperCase(),
          dni: colMap.resp.dni !== -1 ? cleanDni(row[colMap.resp.dni]) : null,
          carta: colMap.resp.carta !== -1 ? (cleanStr(row[colMap.resp.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.resp.carta])?.toUpperCase() === 'SÍ') : false,
          telefono: colMap.resp.tel !== -1 ? cleanPhone(row[colMap.resp.tel]) : null,
          correo: colMap.resp.email !== -1 ? cleanStr(row[colMap.resp.email]) : null
        };
      }

      // Leer Líder
      const lNom = cleanStr(row[colMap.lider.nombre]);
      if (lNom && lNom.length > 2 && !lNom.toUpperCase().includes('APELLIDOS')) {
        currentLider = {
          nombre: lNom.toUpperCase(),
          dni: colMap.lider.dni !== -1 ? cleanDni(row[colMap.lider.dni]) : null,
          carta: colMap.lider.carta !== -1 ? (cleanStr(row[colMap.lider.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.lider.carta])?.toUpperCase() === 'SÍ') : false,
          telefono: colMap.lider.tel !== -1 ? cleanPhone(row[colMap.lider.tel]) : null,
          correo: colMap.lider.email !== -1 ? cleanStr(row[colMap.lider.email]) : null
        };
      }

      // Leer Guía
      const gNom = cleanStr(row[colMap.guia.nombre]);
      if (gNom && gNom.length > 2 && !gNom.toUpperCase().includes('APELLIDOS')) {
        const gDni = colMap.guia.dni !== -1 ? cleanDni(row[colMap.guia.dni]) : null;
        const gCarta = colMap.guia.carta !== -1 ? (cleanStr(row[colMap.guia.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.guia.carta])?.toUpperCase() === 'SÍ') : false;
        const gTel = colMap.guia.tel !== -1 ? cleanPhone(row[colMap.guia.tel]) : null;
        const gEmail = colMap.guia.email !== -1 ? cleanStr(row[colMap.guia.email]) : null;

        // Comprobar si en las celdas adyacentes dice "NO CONTINUA"
        const rowStr = row.map(c => String(c || '').toUpperCase()).join(' ');
        if (rowStr.includes('NO CONTINUA') && !gDni && !gTel) {
          // Descartar guía dado de baja sin datos
          continue;
        }

        const cuadrillaCodigo = `CUA-${String(cuadrillaCounter).padStart(3, '0')}`;
        cuadrillaCounter++;

        records.push({
          cuadrilla_codigo: cuadrillaCodigo,
          responsable_nombre: currentResp ? currentResp.nombre : sheetName.toUpperCase(),
          responsable_dni: currentResp ? currentResp.dni : null,
          responsable_carta: currentResp ? currentResp.carta : false,
          responsable_telefono: currentResp ? currentResp.telefono : null,
          responsable_correo: currentResp ? currentResp.correo : null,

          lider_nombre: currentLider ? currentLider.nombre : (currentResp ? currentResp.nombre : sheetName.toUpperCase()),
          lider_dni: currentLider ? currentLider.dni : null,
          lider_carta: currentLider ? currentLider.carta : false,
          lider_telefono: currentLider ? currentLider.telefono : null,
          lider_correo: currentLider ? currentLider.correo : null,

          guia_nombre: gNom.toUpperCase(),
          guia_dni: gDni,
          guia_carta: gCarta,
          guia_telefono: gTel,
          guia_correo: gEmail,
          total_voluntarios: 9
        });
      }
    }
  }

  console.log(`\n📊 Total cuadrillas / guías procesadas para insertar: ${records.length}`);

  // 3. Limpiar tabla actual de estructura_mandos
  console.log('🧹 3. Limpiando tabla actual estructura_mandos...');
  const { error: delErr } = await supabase.from('estructura_mandos').delete().neq('id', 0);
  if (delErr) {
    console.error('❌ Error al limpiar estructura_mandos:', delErr.message);
    process.exit(1);
  }
  console.log('✅ Tabla limpia.');

  // 4. Insertar en lotes de 100
  console.log('💾 4. Insertando nuevos registros enriquecidos...');
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const { error: insErr } = await supabase.from('estructura_mandos').insert(chunk);
    if (insErr) {
      console.error(`❌ Error en lote ${i}-${i + chunk.length}:`, insErr.message);
      process.exit(1);
    }
    process.stdout.write(`  -> Guardadas ${Math.min(i + chunk.length, records.length)} de ${records.length} cuadrillas...\r`);
  }

  console.log('\n\n🎉 ¡Actualización de Estructura de Mandos completada exitosamente!');

  // Estadísticas finales
  const respSet = new Set(records.map(r => r.responsable_nombre));
  const liderSet = new Set(records.map(r => r.lider_nombre));
  const capacidad = records.reduce((acc, curr) => acc + (curr.total_voluntarios || 9), 0);
  const conTel = records.filter(r => r.guia_telefono).length;
  const conEmail = records.filter(r => r.guia_correo).length;

  console.log('\n================================================================');
  console.log('📋 RESUMEN FINAL DE LA BASE DE DATOS:');
  console.log(` - Responsables únicos: ${respSet.size}`);
  console.log(` - Líderes de sector únicos: ${liderSet.size}`);
  console.log(` - Guías / Cuadrillas activas: ${records.length}`);
  console.log(` - Guías con teléfono celular: ${conTel}`);
  console.log(` - Guías con correo electrónico: ${conEmail}`);
  console.log(` - Capacidad total de voluntarios: ${capacidad} cupos`);
  console.log('================================================================\n');
}

run().catch(console.error);

