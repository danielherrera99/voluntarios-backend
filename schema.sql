-- Crear tabla de Grupos
CREATE TABLE grupos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  lider_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Crear tabla de Comisiones
CREATE TABLE comisiones (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  coordinador_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Crear tabla principal de Voluntarios
CREATE TABLE voluntarios (
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
  alergias TEXT,
  medicacion TEXT,
  fotografia_url VARCHAR,
  departamento VARCHAR,
  provincia VARCHAR,
  distrito VARCHAR,
  direccion TEXT,
  jurisdiccion VARCHAR,
  pertenece_iglesia_institucion BOOLEAN,
  nombre_institucion VARCHAR,
  funcion_institucion VARCHAR,
  grupo_integra VARCHAR,
  nombre_responsable VARCHAR,
  telefono_responsable VARCHAR,
  ocupacion_laboral VARCHAR,
  exp_eventos_masivos BOOLEAN,
  formacion_primeros_auxilios BOOLEAN,
  exp_organizacion_eventos BOOLEAN,
  pertenece_seguridad TEXT,
  servicio VARCHAR,
  talla VARCHAR,
  estado VARCHAR,
  fase VARCHAR,
  fecha_inscripcion TIMESTAMP WITH TIME ZONE,
  autorizacion_datos BOOLEAN,
  archivo_cul_url VARCHAR,
  archivo_carta_url VARCHAR,
  archivo_compromiso_url VARCHAR,
  info_validada BOOLEAN DEFAULT false,
  observacion TEXT,
  grupo_id UUID REFERENCES grupos(id) ON DELETE SET NULL,
  comision_id UUID REFERENCES comisiones(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Actualizar las referencias de las cabezas (Foreign Keys circulares)
ALTER TABLE grupos ADD CONSTRAINT fk_grupos_lider FOREIGN KEY (lider_id) REFERENCES voluntarios(id) ON DELETE SET NULL;
ALTER TABLE comisiones ADD CONSTRAINT fk_comisiones_coordinador FOREIGN KEY (coordinador_id) REFERENCES voluntarios(id) ON DELETE SET NULL;

-- 1. Crear tabla de usuarios (Para Login propio)
CREATE TABLE usuarios (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre VARCHAR NOT NULL,
  correo VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  rol VARCHAR DEFAULT 'admin',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Insertar tu usuario por defecto (Contraseña: 123456)
INSERT INTO usuarios (nombre, correo, password_hash) 
VALUES (
  'Administrador', 
  'dh19992015@gmail.com', 
  '$2b$10$GlpaAgjDVlN/fRTz5dS2H.LonUAMCmq6b4a//Al9/8rPWevMbNIF.'
);
