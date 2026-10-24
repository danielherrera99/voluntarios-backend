const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  console.log('Otorgando permisos en puntos_tacticos...');
  const sql = `
    GRANT ALL ON TABLE puntos_tacticos TO postgres, anon, authenticated, service_role;
    GRANT ALL ON SEQUENCE puntos_tacticos_id_seq TO postgres, anon, authenticated, service_role;
    
    ALTER TABLE puntos_tacticos ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Permitir lectura publica puntos" ON puntos_tacticos;
    CREATE POLICY "Permitir lectura publica puntos" ON puntos_tacticos FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Permitir escritura completa puntos" ON puntos_tacticos;
    CREATE POLICY "Permitir escritura completa puntos" ON puntos_tacticos FOR ALL USING (true);

    NOTIFY pgrst, 'reload schema';
  `;

  await supabase.rpc('exec_sql', { sql });
  await new Promise(r => setTimeout(r, 1500));

  const { data, error } = await supabase.from('puntos_tacticos').select('*').limit(2);
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('✅ Permisos configurados con éxito. Filas existentes:', data.length);
  }
}

main();
