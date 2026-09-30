-- Preparacion para importaciones: normalizacion de clientes sin cambiar IDs,
-- relaciones, auth_user_id, RLS ni permisos de escritura por columna.
-- Toda la verificacion y el saneamiento se confirman o revierten juntos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public.clientes IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalizar_cliente_nombre(p_valor text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v_nombre text;
BEGIN
  IF p_valor IS NULL THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio.' USING ERRCODE = '23514';
  END IF;
  -- Convertir espacios conocidos y letras explicitamente, sin depender
  -- de las reglas de mayusculas del locale de PostgreSQL.
  v_nombre := btrim(regexp_replace(
    translate(p_valor,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160),
      '      '),
    ' +', ' ', 'g'));
  v_nombre := translate(v_nombre,
    'abcdefghijklmnopqrstuvwxyz' || U&'\00E1\00E9\00ED\00F3\00FA\00FC\00F1',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' || U&'\00C1\00C9\00CD\00D3\00DA\00DC\00D1');
  IF char_length(v_nombre) NOT BETWEEN 2 AND 255
     OR (v_nombre COLLATE "C") !~ U&'^[A-Z\00C1\00C9\00CD\00D3\00DA\00DC\00D1]+([ \0027\2019-][A-Z\00C1\00C9\00CD\00D3\00DA\00DC\00D1]+)*$' THEN
    RAISE EXCEPTION 'Nombre invalido: solo letras, N con tilde, vocales acentuadas, espacios, guion y apostrofe.'
      USING ERRCODE = '23514';
  END IF;
  RETURN v_nombre;
END;
$$;

-- Comprobar nuestra funcion, no las reglas de mayusculas del locale.
DO $$
BEGIN
  IF (public.normalizar_cliente_nombre(U&'  miguel   fernando \00E1lvarez mu\00F1oz  ') COLLATE "C")
       <> (U&'MIGUEL FERNANDO \00C1LVAREZ MU\00D1OZ' COLLATE "C")
     OR (public.normalizar_cliente_nombre(U&'  \00E1 \00E9 \00ED \00F3 \00FA \00FC \00F1  ') COLLATE "C")
       <> (U&'\00C1 \00C9 \00CD \00D3 \00DA \00DC \00D1' COLLATE "C")
     OR (public.normalizar_cliente_nombre(U&'  jos\00E9 pe\00F1a  ') COLLATE "C")
       <> (U&'JOS\00C9 PE\00D1A' COLLATE "C")
     OR (public.normalizar_cliente_nombre(U&'  mar\00EDa-jos\00E9  ') COLLATE "C")
       <> (U&'MAR\00CDA-JOS\00C9' COLLATE "C") THEN
    RAISE EXCEPTION 'La normalizacion determinista de nombres espanoles no produjo el resultado esperado.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalizar_cliente_celular(p_valor text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v_celular text;
BEGIN
  IF p_valor IS NULL OR btrim(replace(p_valor, chr(160), ' ')) = '' THEN
    RETURN NULL;
  END IF;
  v_celular := regexp_replace(replace(p_valor, chr(160), ' '), '[[:space:]()-]', '', 'g');
  IF char_length(v_celular) > 20 OR v_celular !~ '^\+?[0-9]{7,20}$' THEN
    RAISE EXCEPTION 'Telefono invalido: usa 7 a 20 digitos y, opcionalmente, un + inicial.'
      USING ERRCODE = '23514';
  END IF;
  RETURN v_celular;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalizar_cliente_email(p_valor text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v_email text;
BEGIN
  v_email := lower(btrim(replace(coalesce(p_valor, ''), chr(160), ' ')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;
  IF char_length(v_email) > 255
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@.]+([.][^[:space:]@.]+)+$' THEN
    RAISE EXCEPTION 'Correo electronico invalido.' USING ERRCODE = '23514';
  END IF;
  RETURN v_email;
END;
$$;

-- Permitir importar telefonos con formato antes del trigger; los almacenados
-- siguen limitados a 20 caracteres tras normalizarse.
ALTER TABLE public.clientes ALTER COLUMN celular TYPE varchar(64);

CREATE OR REPLACE FUNCTION public.normalizar_cliente_datos()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.nombre_completo := public.normalizar_cliente_nombre(NEW.nombre_completo);
  -- El CHECK cedula_format y el UNIQUE existentes siguen siendo la autoridad
  -- para formato y duplicados; no anadir aqui reglas ecuatorianas nuevas.
  NEW.cedula := btrim(NEW.cedula);
  NEW.celular := public.normalizar_cliente_celular(NEW.celular);
  NEW.email := public.normalizar_cliente_email(NEW.email);
  RETURN NEW;
END;
$$;

-- El trigger invocador necesita poder llamar las tres funciones puras.
REVOKE ALL ON FUNCTION public.normalizar_cliente_nombre(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalizar_cliente_celular(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalizar_cliente_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalizar_cliente_datos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalizar_cliente_nombre(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_cliente_celular(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_cliente_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_cliente_datos() TO authenticated;

DROP TRIGGER IF EXISTS clientes_normalizar_datos ON public.clientes;
CREATE TRIGGER clientes_normalizar_datos
BEFORE INSERT OR UPDATE OF nombre_completo, cedula, celular, email
ON public.clientes FOR EACH ROW
EXECUTE FUNCTION public.normalizar_cliente_datos();

-- Examinar todas las filas antes de actualizar alguna. Ante cualquier valor
-- ambiguo o no normalizable, abortar toda la transaccion e indicar el ID.
DO $$
DECLARE v_cliente record;
BEGIN
  FOR v_cliente IN
    SELECT id, cedula, nombre_completo, celular, email FROM public.clientes
  LOOP
    BEGIN
      PERFORM public.normalizar_cliente_nombre(v_cliente.nombre_completo);
      PERFORM public.normalizar_cliente_celular(v_cliente.celular);
      PERFORM public.normalizar_cliente_email(v_cliente.email);
      IF v_cliente.cedula IS NULL OR btrim(v_cliente.cedula) !~ '^[0-9]{1,20}$' THEN
        RAISE EXCEPTION 'Identificacion invalida: para cedula, usa 1 a 20 digitos.';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'No se puede normalizar el cliente %: %', v_cliente.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

WITH normalizados AS MATERIALIZED (
  SELECT id,
    public.normalizar_cliente_nombre(nombre_completo) AS nombre,
    btrim(cedula) AS identificacion,
    public.normalizar_cliente_celular(celular) AS telefono,
    public.normalizar_cliente_email(email) AS correo
  FROM public.clientes
)
UPDATE public.clientes AS c
SET nombre_completo = n.nombre,
    cedula = n.identificacion,
    celular = n.telefono,
    email = n.correo
FROM normalizados AS n
WHERE c.id = n.id
  AND (c.nombre_completo, c.cedula, c.celular, c.email)
      IS DISTINCT FROM (n.nombre, n.identificacion, n.telefono, n.correo);

COMMIT;
