-- Endurecimiento de ACL para membresías y pagos.
-- No modifica políticas RLS ni permisos de service_role/postgres.
BEGIN;

-- Revocar en PUBLIC elimina también la vía heredada por anon/authenticated.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.membresias, public.pagos
  FROM PUBLIC, anon, authenticated;

-- MAINTAIN existe desde PostgreSQL 17; mantener compatibilidad con versiones
-- anteriores mediante SQL dinámico ejecutado solo cuando el privilegio existe.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON TABLE public.membresias, public.pagos FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

-- Ningún cliente anónimo necesita borrar registros. Authenticated tampoco lo
-- necesita para el flujo actual; las escrituras de membresías son por columna.
REVOKE DELETE ON TABLE public.membresias, public.pagos
  FROM PUBLIC, anon, authenticated;

COMMIT;
