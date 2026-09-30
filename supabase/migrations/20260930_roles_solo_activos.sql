-- Keep the existing role-based RLS rules, but do not grant a role to an
-- inactive profile through direct PostgREST/RPC requests.
BEGIN;

-- CREATE OR REPLACE retains the function owner and existing EXECUTE grants.
-- The function owner must remain the trusted migration role so that it can
-- read usuarios without recursive RLS evaluation.
CREATE OR REPLACE FUNCTION public.mi_rol()
RETURNS public.rol_usuario_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.rol
  FROM public.usuarios AS u
  WHERE u.id = auth.uid() AND u.activo
$$;

COMMIT;
