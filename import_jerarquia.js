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

function isHeader(val) {
  if (!val) return false;
  const s = String(val).trim().toUpperCase();
  return s === 'RESPONSABLE' || s === 'RESPONSABLES' || s === 'LIDER' || s === 'LIDERES' || s === 'GUÍA' || s === 'GÚIA' || s === 'GUIAS';
}

function cleanDni(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\D/g, '').trim();
  if (s.length < 8 && s.length > 0) return s.padStart(8, '0');
  return s || null;
}

async function run() {
  console.log('\n======================================================');
  console.log('🚀 IMPORTACIÓN DE CADENA DE MANDOS (RESPONSABLES, LÍDERES, GUÍAS)');
  console.log('======================================================\n');

  // 1. Asegurar tabla en base de datos
  console.log('🛠️ Verificando y creando tabla estructura_mandos...');
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS estructura_mandos (
      id BIGSERIAL PRIMARY KEY,
      cuadrilla_codigo VARCHAR(50) UNIQUE,
      responsable_nombre VARCHAR(255) NOT NULL,
      responsable_dni VARCHAR(20),
      responsable_carta BOOLEAN DEFAULT false,
      lider_nombre VARCHAR(255) NOT NULL,
      lider_dni VARCHAR(20),
      lider_carta BOOLEAN DEFAULT false,
      guia_nombre VARCHAR(255) NOT NULL,
      guia_dni VARCHAR(20),
      guia_carta BOOLEAN DEFAULT false,
      total_voluntarios INT DEFAULT 9,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    GRANT ALL ON estructura_mandos TO anon, authenticated, service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

    ALTER TABLE estructura_mandos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Permitir todo a estructura_mandos" ON estructura_mandos;
    CREATE POLICY "Permitir todo a estructura_mandos" ON estructura_mandos FOR ALL USING (true) WITH CHECK (true);

    CREATE INDEX IF NOT EXISTS idx_mandos_responsable ON estructura_mandos (responsable_nombre);
    CREATE INDEX IF NOT EXISTS idx_mandos_lider ON estructura_mandos (lider_nombre);
    CREATE INDEX IF NOT EXISTS idx_mandos_guia ON estructura_mandos (guia_nombre);
    CREATE INDEX IF NOT EXISTS idx_mandos_guia_dni ON estructura_mandos (guia_dni);
    CREATE INDEX IF NOT EXISTS idx_mandos_cuadrilla ON estructura_mandos (cuadrilla_codigo);
  `;

  const { error: rpcErr } = await supabase.rpc('exec_sql', { sql: createTableSql });
  if (rpcErr) {
    console.error('❌ Error al preparar tabla estructura_mandos:', rpcErr.message);
    process.exit(1);
  }
  console.log('✅ Tabla e índices listos en Supabase.');

  // 2. Leer jerarquia.xlsx
  console.log('📖 Leyendo jerarquia.xlsx...');
  const wb = xlsx.readFile('jerarquia.xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  let currentResp = null;
  let currentLider = null;
  const records = [];
  let cuadrillaCounter = 1;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const col0 = row[0] ? String(row[0]).trim() : '';
    const col3 = row[3] ? String(row[3]).trim() : '';
    const col6 = row[6] ? String(row[6]).trim() : '';

    // Saltar cabeceras intermedias
    if (isHeader(col0) || isHeader(col3) || isHeader(col6)) continue;

    // Si aparece un nuevo responsable
    if (col0 && col0.length > 2) {
      currentResp = {
        nombre: col0.toUpperCase(),
        dni: cleanDni(row[1]),
        carta: row[2] ? String(row[2]).trim().toUpperCase() : null
      };
      currentLider = null; // Un nuevo responsable no debe arrastrar el líder del responsable anterior
    }

    if (col3 && col3.length > 2) {
      currentLider = {
        nombre: col3.toUpperCase(),
        dni: cleanDni(row[4]),
        carta: row[5] ? String(row[5]).trim().toUpperCase() : null
      };
    }

    // Si aún no hay líder asignado en esta fila pero hay un líder más abajo en el bloque de este responsable
    let assignedLider = currentLider;
    if (!assignedLider && currentResp) {
      for (let j = i; j < Math.min(i + 15, data.length); j++) {
        const nextCol0 = data[j] && data[j][0] ? String(data[j][0]).trim() : '';
        if (j > i && nextCol0 && nextCol0.length > 2 && !isHeader(nextCol0)) break; // Comenzó otro responsable
        const nextCol3 = data[j] && data[j][3] ? String(data[j][3]).trim() : '';
        if (nextCol3 && nextCol3.length > 2 && !isHeader(nextCol3)) {
          assignedLider = {
            nombre: nextCol3.toUpperCase(),
            dni: cleanDni(data[j][4]),
            carta: data[j][5] ? String(data[j][5]).trim().toUpperCase() : null
          };
          currentLider = assignedLider;
          break;
        }
      }
    }

    // Registrar guía / cuadrilla (descartando filas que solo sean números como '733')
    if (col6 && col6.length > 2 && isNaN(Number(col6))) {
      const dniGuia = cleanDni(row[7]);
      const cartaGuia = row[8] ? String(row[8]).trim().toUpperCase() : null;
      const tv = row[9] ? parseInt(row[9], 10) : 9;

      const cuadrillaCodigo = `CUA-${String(cuadrillaCounter).padStart(3, '0')}`;
      cuadrillaCounter++;

      records.push({
        cuadrilla_codigo: cuadrillaCodigo,
        responsable_nombre: currentResp ? currentResp.nombre : 'SIN ASIGNAR',
        responsable_dni: currentResp ? currentResp.dni : null,
        responsable_carta: currentResp && (currentResp.carta === 'SI' || currentResp.carta === 'SÍ'),
        lider_nombre: assignedLider ? assignedLider.nombre : (currentResp ? currentResp.nombre : 'SIN ASIGNAR'),
        lider_dni: assignedLider ? assignedLider.dni : null,
        lider_carta: assignedLider && (assignedLider.carta === 'SI' || assignedLider.carta === 'SÍ'),
        guia_nombre: col6.toUpperCase(),
        guia_dni: dniGuia,
        guia_carta: cartaGuia === 'SI' || cartaGuia === 'SÍ',
        total_voluntarios: isNaN(tv) ? 9 : tv
      });
    }
  }

  console.log(`\n📊 Registros a insertar: ${records.length} Guías / Cuadrillas`);

  // 3. Limpiar tabla anterior si existiera y recargar
  await supabase.from('estructura_mandos').delete().neq('id', 0);

  // 4. Insertar en lotes de 100
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const { error: insErr } = await supabase.from('estructura_mandos').insert(chunk);
    if (insErr) {
      console.error(`❌ Error insertando lote ${i}-${i + 100}:`, insErr.message);
      process.exit(1);
    }
    process.stdout.write(`💾 Guardados ${Math.min(i + 100, records.length)} de ${records.length}...\r`);
  }

  console.log('\n\n✅ ¡Importación completada con éxito!');

  // 5. Estadísticas finales
  const respSet = new Set(records.map(r => r.responsable_nombre));
  const liderSet = new Set(records.map(r => r.lider_nombre));
  const capacidadTotal = records.reduce((acc, curr) => acc + (curr.total_voluntarios || 9), 0);

  console.log('\n======================================================');
  console.log('📋 RESUMEN ESTRUCTURA DE MANDOS 2026:');
  console.log(` - Responsables únicos: ${respSet.size}`);
  console.log(` - Líderes únicos: ${liderSet.size}`);
  console.log(` - Guías / Cuadrillas registradas: ${records.length}`);
  console.log(` - Capacidad total para voluntarios: ${capacidadTotal} cupos`);
  console.log('======================================================\n');
}

run();
