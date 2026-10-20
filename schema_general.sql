-- ==============================================================================
-- SCRIPT SQL PARA SUPABASE: CREACIÓN DE TABLA PADRÓN GENERAL (FASE 1)
-- ==============================================================================

-- 1. Crear tabla para la Primera Fase (7,241 registros del Excel Chiclayo-general.xlsx)
CREATE TABLE IF NOT EXISTS voluntarios_general (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  codigo VARCHAR,
  nombres_apellidos VARCHAR NOT NULL,
  dni VARCHAR UNIQUE NOT NULL,
  fecha_nacimiento DATE,
  edad INTEGER,
  correo VARCHAR,
  telefono VARCHAR,
  contacto_emergencia VARCHAR,
  telefono_emergencia VARCHAR,
  departamento VARCHAR,
  provincia VARCHAR,
  distrito VARCHAR,
  direccion TEXT,
  jurisdiccion VARCHAR,
  servicio VARCHAR,
  talla VARCHAR,
  estado VARCHAR DEFAULT 'PENDIENTE',
  fase VARCHAR DEFAULT '1',
  fecha_inscripcion TIMESTAMP WITH TIME ZONE,
  tiene_whatsapp BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Índice rápido por DNI para consultas inmediatas
CREATE INDEX IF NOT EXISTS idx_voluntarios_general_dni ON voluntarios_general (dni);

-- 3. Habilitar políticas de seguridad y lectura pública
ALTER TABLE voluntarios_general ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'voluntarios_general' AND policyname = 'Permitir lectura publica voluntarios_general'
  ) THEN
    CREATE POLICY "Permitir lectura publica voluntarios_general" ON voluntarios_general FOR SELECT USING (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'voluntarios_general' AND policyname = 'Permitir todo service role voluntarios_general'
  ) THEN
    CREATE POLICY "Permitir todo service role voluntarios_general" ON voluntarios_general FOR ALL USING (true);
  END IF;
END $$;
