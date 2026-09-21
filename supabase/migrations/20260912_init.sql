-- ============================================================
-- GÓLGOTA — Esquema inicial
-- Supabase / PostgreSQL
-- Septiembre 2026
-- ============================================================

BEGIN;

-- ============================================================
-- TIPOS
-- ============================================================

CREATE TYPE estado_cliente_enum AS ENUM (
  'Activo',
  'Inactivo',
  'Suspendido',
  'Cancelado'
);

CREATE TYPE tipo_cliente_enum AS ENUM (
  'Fidelizados',
  'Ocasionales',
  'Potencial',
  'Visitante'
);

CREATE TYPE motivo_creacion_enum AS ENUM (
  'Nuevo',
  'Visitante',
  'Referido'
);

CREATE TYPE estado_pago_enum AS ENUM (
  'ACTIVA',
  'PAGADO',
  'PENDIENTE',
  'VENCIDO',
  'CANCELADA'
);

CREATE TYPE metodo_pago_enum AS ENUM (
  'Efectivo',
  'Transferencia',
  'Tarjeta',
  'Cheque',
  'Otro'
);

CREATE TYPE rol_usuario_enum AS ENUM (
  'admin',
  'owner',
  'staff'
);

CREATE TYPE tipo_gasto_enum AS ENUM (
  'Alquiler',
  'Servicios Básicos',
  'Internet',
  'Pago del personal',
  'Campaña Publicitaria',
  'Impresos',
  'Mercadería',
  'Mantenimiento',
  'Compra de maquinaria',
  'Otro'
);

-- ============================================================
-- USUARIOS
-- ============================================================

CREATE TABLE usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  rol rol_usuario_enum NOT NULL DEFAULT 'staff',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO usuarios (
    id,
    email,
    nombre
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'nombre',
      NEW.email
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCIÓN PARA OBTENER EL ROL
-- ============================================================

CREATE FUNCTION public.mi_rol()
RETURNS rol_usuario_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol
  FROM usuarios
  WHERE id = auth.uid()
$$;

-- ============================================================
-- CLIENTES
-- ============================================================

CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cedula VARCHAR(20)
    UNIQUE
    NOT NULL,

  nombre_completo VARCHAR(255)
    NOT NULL,

  fecha_registro DATE
    NOT NULL
    DEFAULT CURRENT_DATE,

  celular VARCHAR(20),

  email VARCHAR(255),

  fecha_nacimiento DATE,

  tipo_cliente tipo_cliente_enum
    DEFAULT 'Ocasionales',

  motivo_creacion motivo_creacion_enum,

  como_llego VARCHAR(100),

  referido_por UUID
    REFERENCES clientes(id),

  quien_refirio VARCHAR(255),

  estado_cliente estado_cliente_enum
    DEFAULT 'Activo',

  comentarios TEXT,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW(),

  created_by UUID
    REFERENCES usuarios(id),

  CONSTRAINT cedula_format
    CHECK (cedula ~ '^[0-9]+$')
);

-- ============================================================
-- PLANES
-- ============================================================

CREATE TABLE planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  nombre VARCHAR(100)
    NOT NULL,

  duracion_dias INT
    NOT NULL
    CHECK (duracion_dias > 0),

  precio DECIMAL(10,2)
    NOT NULL
    CHECK (precio > 0),

  descripcion TEXT,

  activo BOOLEAN
    DEFAULT true,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW()
);

INSERT INTO planes (
  nombre,
  duracion_dias,
  precio,
  descripcion
)
VALUES
('1 DÍA', 1, 10.00, 'Acceso un día'),
('1 MES', 30, 45.00, 'Acceso un mes'),
('2 MESES (PROMOCIÓN)', 60, 80.00, 'Dos meses con descuento'),
('3 MESES', 90, 120.00, 'Acceso tres meses'),
('6 MESES', 180, 220.00, 'Acceso seis meses'),
('1 AÑO', 365, 400.00, 'Acceso anual');

-- ============================================================
-- HORARIOS
-- ============================================================

CREATE TABLE horarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  hora_inicio TIME
    NOT NULL,

  hora_fin TIME
    NOT NULL,

  nombre VARCHAR(100),

  cupo_maximo INT
    CHECK (
      cupo_maximo IS NULL
      OR cupo_maximo > 0
    ),

  activo BOOLEAN
    DEFAULT true,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  CONSTRAINT hora_valida
    CHECK (hora_inicio < hora_fin)
);

INSERT INTO horarios (
  hora_inicio,
  hora_fin,
  nombre,
  cupo_maximo
)
VALUES
('05:00','06:00','5:00 - 6:00 AM',25),
('06:00','07:00','6:00 - 7:00 AM',25),
('07:00','08:00','7:00 - 8:00 AM',25),
('08:00','09:00','8:00 - 9:00 AM',25),
('09:00','10:00','9:00 - 10:00 AM',25),
('17:00','18:00','5:00 - 6:00 PM',25),
('18:00','19:00','6:00 - 7:00 PM',25),
('19:00','20:00','7:00 - 8:00 PM',25),
('20:00','21:00','8:00 - 9:00 PM',25);

-- ============================================================
-- MEMBRESÍAS
-- ============================================================

CREATE TABLE membresias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cliente_id UUID
    NOT NULL
    REFERENCES clientes(id)
    ON DELETE CASCADE,

  plan_id UUID
    NOT NULL
    REFERENCES planes(id),

  horario_id UUID
    REFERENCES horarios(id),

  fecha_inicio DATE
    NOT NULL,

  fecha_vencimiento DATE
    NOT NULL,

  dias_duracion INT
    NOT NULL
    CHECK (dias_duracion > 0),

  valor DECIMAL(10,2)
    NOT NULL
    CHECK (valor > 0),

  abono DECIMAL(10,2)
    NOT NULL
    DEFAULT 0,

  saldo DECIMAL(10,2)
    NOT NULL,

  metodo_pago metodo_pago_enum,

  estado estado_pago_enum
    DEFAULT 'ACTIVA',

  observaciones TEXT,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW(),

  created_by UUID
    REFERENCES usuarios(id),

  CONSTRAINT abono_membresia_valido
    CHECK (
      abono >= 0
      AND abono <= valor
    ),

  CONSTRAINT saldo_membresia_valido
    CHECK (saldo >= 0),

  CONSTRAINT saldo_correcto
    CHECK (saldo = valor - abono),

  CONSTRAINT fechas_validas
    CHECK (
      fecha_vencimiento >= fecha_inicio
    )
);

-- ============================================================
-- PRODUCTOS
-- ============================================================

CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  nombre VARCHAR(255)
    NOT NULL,

  valor_unitario DECIMAL(10,2)
    NOT NULL
    CHECK (valor_unitario > 0),

  stock INT
    NOT NULL
    DEFAULT 0
    CHECK (stock >= 0),

  descripcion TEXT,

  activo BOOLEAN
    DEFAULT true,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW()
);

INSERT INTO productos (
  nombre,
  valor_unitario,
  stock
)
VALUES
('Camiseta XS',30.00,10),
('Camiseta S',30.00,15),
('Camiseta M',30.00,20),
('Camiseta L',30.00,15),
('Camiseta XL',35.00,10),
('Camiseta XXL',35.00,5),
('Cuerda (PVC)',11.00,30),
('Cuerda (Metal)',20.00,20),
('Bloque de Magnesio',5.00,50),
('Cayeras',13.00,15);

-- ============================================================
-- VENTAS
-- ============================================================

CREATE TABLE ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cliente_id UUID
    NOT NULL
    REFERENCES clientes(id)
    ON DELETE CASCADE,

  producto_id UUID
    NOT NULL
    REFERENCES productos(id),

  fecha_venta DATE
    NOT NULL
    DEFAULT CURRENT_DATE,

  cantidad INT
    NOT NULL
    CHECK (cantidad > 0),

  valor_unitario DECIMAL(10,2)
    NOT NULL
    CHECK (valor_unitario > 0),

  valor_total DECIMAL(10,2)
    NOT NULL,

  abono DECIMAL(10,2)
    NOT NULL
    DEFAULT 0,

  saldo DECIMAL(10,2)
    NOT NULL,

  metodo_pago metodo_pago_enum,

  estado estado_pago_enum
    DEFAULT 'PENDIENTE',

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW(),

  created_by UUID
    REFERENCES usuarios(id),

  CONSTRAINT total_correcto
    CHECK (
      valor_total =
      cantidad * valor_unitario
    ),

  CONSTRAINT abono_venta_valido
    CHECK (
      abono >= 0
      AND abono <= valor_total
    ),

  CONSTRAINT saldo_venta_valido
    CHECK (saldo >= 0),

  CONSTRAINT saldo_venta
    CHECK (
      saldo =
      valor_total - abono
    )
);

-- ============================================================
-- GASTOS
-- ============================================================

CREATE TABLE gastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tipo_gasto tipo_gasto_enum
    NOT NULL,

  descripcion TEXT
    NOT NULL,

  monto DECIMAL(10,2)
    NOT NULL
    CHECK (monto > 0),

  fecha_gasto DATE
    NOT NULL
    DEFAULT CURRENT_DATE,

  metodo_pago metodo_pago_enum,

  comprobante VARCHAR(255),

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW(),

  created_by UUID
    REFERENCES usuarios(id)
);

-- ============================================================
-- ASISTENCIA
-- ============================================================

CREATE TABLE asistencia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cliente_id UUID
    NOT NULL
    REFERENCES clientes(id)
    ON DELETE CASCADE,

  fecha_asistencia DATE
    NOT NULL
    DEFAULT CURRENT_DATE,

  horario_id UUID
    REFERENCES horarios(id),

  presente BOOLEAN
    NOT NULL
    DEFAULT true,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  UNIQUE (
    cliente_id,
    fecha_asistencia
  )
);

-- ============================================================
-- AUDITORÍA
-- ============================================================

CREATE TABLE auditoria_logs (
  id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

  usuario_id UUID
    REFERENCES usuarios(id)
    ON DELETE SET NULL,

  tabla VARCHAR(100)
    NOT NULL,

  accion VARCHAR(20)
    NOT NULL,

  registro_id VARCHAR(255),

  datos_anteriores JSONB,

  datos_nuevos JSONB,

  creado_en TIMESTAMPTZ
    DEFAULT NOW()
);

-- ============================================================
-- UPDATED_AT AUTOMÁTICO
-- ============================================================

CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_updated_at
BEFORE UPDATE ON usuarios
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER clientes_updated_at
BEFORE UPDATE ON clientes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER planes_updated_at
BEFORE UPDATE ON planes
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER membresias_updated_at
BEFORE UPDATE ON membresias
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER productos_updated_at
BEFORE UPDATE ON productos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER ventas_updated_at
BEFORE UPDATE ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER gastos_updated_at
BEFORE UPDATE ON gastos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- FUNCIÓN DE AUDITORÍA
-- ============================================================

CREATE FUNCTION public.registrar_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registro_id TEXT;
BEGIN

  IF TG_OP = 'INSERT' THEN

    v_registro_id := NEW.id::TEXT;

    INSERT INTO auditoria_logs (
      usuario_id,
      tabla,
      accion,
      registro_id,
      datos_anteriores,
      datos_nuevos
    )
    VALUES (
      auth.uid(),
      TG_TABLE_NAME,
      'INSERT',
      v_registro_id,
      NULL,
      TO_JSONB(NEW)
    );

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN

    v_registro_id := NEW.id::TEXT;

    INSERT INTO auditoria_logs (
      usuario_id,
      tabla,
      accion,
      registro_id,
      datos_anteriores,
      datos_nuevos
    )
    VALUES (
      auth.uid(),
      TG_TABLE_NAME,
      'UPDATE',
      v_registro_id,
      TO_JSONB(OLD),
      TO_JSONB(NEW)
    );

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN

    v_registro_id := OLD.id::TEXT;

    INSERT INTO auditoria_logs (
      usuario_id,
      tabla,
      accion,
      registro_id,
      datos_anteriores,
      datos_nuevos
    )
    VALUES (
      auth.uid(),
      TG_TABLE_NAME,
      'DELETE',
      v_registro_id,
      TO_JSONB(OLD),
      NULL
    );

    RETURN OLD;

  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- TRIGGERS DE AUDITORÍA
-- ============================================================

CREATE TRIGGER audit_usuarios
AFTER INSERT OR UPDATE OR DELETE
ON usuarios
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_clientes
AFTER INSERT OR UPDATE OR DELETE
ON clientes
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_planes
AFTER INSERT OR UPDATE OR DELETE
ON planes
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_horarios
AFTER INSERT OR UPDATE OR DELETE
ON horarios
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_membresias
AFTER INSERT OR UPDATE OR DELETE
ON membresias
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_productos
AFTER INSERT OR UPDATE OR DELETE
ON productos
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_ventas
AFTER INSERT OR UPDATE OR DELETE
ON ventas
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_gastos
AFTER INSERT OR UPDATE OR DELETE
ON gastos
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_asistencia
AFTER INSERT OR UPDATE OR DELETE
ON asistencia
FOR EACH ROW
EXECUTE FUNCTION public.registrar_auditoria();

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX idx_clientes_cedula
ON clientes(cedula);

CREATE INDEX idx_clientes_estado
ON clientes(estado_cliente);

CREATE INDEX idx_membresias_cliente
ON membresias(cliente_id);

CREATE INDEX idx_membresias_estado
ON membresias(estado);

CREATE INDEX idx_membresias_vencimiento
ON membresias(fecha_vencimiento);

CREATE INDEX idx_ventas_cliente
ON ventas(cliente_id);

CREATE INDEX idx_asistencia_cliente_fecha
ON asistencia(
  cliente_id,
  fecha_asistencia
);

CREATE INDEX idx_gastos_fecha
ON gastos(fecha_gasto);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE usuarios
ENABLE ROW LEVEL SECURITY;

ALTER TABLE clientes
ENABLE ROW LEVEL SECURITY;

ALTER TABLE planes
ENABLE ROW LEVEL SECURITY;

ALTER TABLE horarios
ENABLE ROW LEVEL SECURITY;

ALTER TABLE membresias
ENABLE ROW LEVEL SECURITY;

ALTER TABLE productos
ENABLE ROW LEVEL SECURITY;

ALTER TABLE ventas
ENABLE ROW LEVEL SECURITY;

ALTER TABLE gastos
ENABLE ROW LEVEL SECURITY;

ALTER TABLE asistencia
ENABLE ROW LEVEL SECURITY;

ALTER TABLE auditoria_logs
ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLÍTICAS: USUARIOS
-- ============================================================

CREATE POLICY usuarios_propio
ON usuarios
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
);

CREATE POLICY usuarios_admin
ON usuarios
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: PLANES
-- ============================================================

CREATE POLICY planes_lectura
ON planes
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY planes_admin
ON planes
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: HORARIOS
-- ============================================================

CREATE POLICY horarios_lectura
ON horarios
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY horarios_admin
ON horarios
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: CLIENTES
-- ============================================================

CREATE POLICY clientes_lectura
ON clientes
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY clientes_admin
ON clientes
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: MEMBRESÍAS
-- ============================================================

CREATE POLICY membresias_lectura
ON membresias
FOR SELECT
TO authenticated
USING (
  public.mi_rol()
  IN ('admin','owner')
);

CREATE POLICY membresias_admin
ON membresias
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: PRODUCTOS
-- ============================================================

CREATE POLICY productos_lectura
ON productos
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY productos_admin
ON productos
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: VENTAS
-- ============================================================

CREATE POLICY ventas_lectura
ON ventas
FOR SELECT
TO authenticated
USING (
  public.mi_rol()
  IN ('admin','owner')
);

CREATE POLICY ventas_admin
ON ventas
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: GASTOS
-- ============================================================

CREATE POLICY gastos_lectura
ON gastos
FOR SELECT
TO authenticated
USING (
  public.mi_rol()
  IN ('admin','owner')
);

CREATE POLICY gastos_admin
ON gastos
FOR ALL
TO authenticated
USING (
  public.mi_rol() = 'admin'
)
WITH CHECK (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- POLÍTICAS: ASISTENCIA
-- ============================================================

CREATE POLICY asistencia_lectura
ON asistencia
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY asistencia_escritura
ON asistencia
FOR ALL
TO authenticated
USING (
  public.mi_rol()
  IN ('admin','staff')
)
WITH CHECK (
  public.mi_rol()
  IN ('admin','staff')
);

-- ============================================================
-- POLÍTICAS: AUDITORÍA
-- ============================================================

CREATE POLICY auditoria_admin
ON auditoria_logs
FOR SELECT
TO authenticated
USING (
  public.mi_rol() = 'admin'
);

-- ============================================================
-- FINAL
-- ============================================================

COMMIT;