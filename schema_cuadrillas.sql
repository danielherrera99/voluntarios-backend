-- ==============================================================================
-- SCRIPT SQL: CADENA DE MANDO (LÍDERES, COORDINADORES Y CUADRILLAS)
-- Diócesis de Chiclayo - Voluntariado Visita Papal
-- ==============================================================================

-- 1. Agregar columnas de jerarquía en voluntarios_general (Fase 1)
ALTER TABLE voluntarios_general 
ADD COLUMN IF NOT EXISTS lider_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS coordinador_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS cuadrilla_codigo VARCHAR;

-- 2. Crear índices para búsquedas y filtros ultrarrápidos
CREATE INDEX IF NOT EXISTS idx_voluntarios_general_lider ON voluntarios_general (lider_nombre);
CREATE INDEX IF NOT EXISTS idx_voluntarios_general_coordinador ON voluntarios_general (coordinador_nombre);
CREATE INDEX IF NOT EXISTS idx_voluntarios_general_cuadrilla ON voluntarios_general (cuadrilla_codigo);

-- 3. Agregar columnas en voluntarios (Fase 2) para mantener consistencia
ALTER TABLE voluntarios 
ADD COLUMN IF NOT EXISTS lider_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS coordinador_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS cuadrilla_codigo VARCHAR;

CREATE INDEX IF NOT EXISTS idx_voluntarios_lider ON voluntarios (lider_nombre);
CREATE INDEX IF NOT EXISTS idx_voluntarios_coordinador ON voluntarios (coordinador_nombre);
CREATE INDEX IF NOT EXISTS idx_voluntarios_cuadrilla ON voluntarios (cuadrilla_codigo);

-- 4. Ampliar la tabla de usuarios para asociar Líderes y Coordinadores a sus cuentas
ALTER TABLE usuarios 
ADD COLUMN IF NOT EXISTS lider_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS coordinador_nombre VARCHAR,
ADD COLUMN IF NOT EXISTS telefono VARCHAR;

-- 5. Actualizar roles existentes si es necesario
-- Roles soportados: 'admin', 'comision', 'lider', 'coordinador'
UPDATE usuarios SET rol = 'comision' WHERE correo = 'equipo@amigosdelpapa.pe';

-- 6. Función para ejecutar SQL desde backend si fuese necesario (opcional)
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
