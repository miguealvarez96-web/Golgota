# GÓLGOTA CROSSFIT

Este archivo guía el trabajo en el proyecto GÓLGOTA CROSSFIT.

## Stack

Next.js 14, App Router, TypeScript, Tailwind CSS, Supabase, PostgreSQL, Supabase Auth, RLS, RPC, React Hook Form, Zod, TanStack Query, Recharts y Vercel.

## Alcance y control de cambios

- Trabajar una sola tarea a la vez. No continuar automáticamente con otra tarea.
- No ampliar el alcance sin autorización.
- No ejecutar SQL real sin autorización. Para cambios SQL importantes, seguir este orden: revisión -> dry-run -> rollback -> autorización -> ejecución real.
- No borrar datos ni realizar cambios destructivos.
- No hacer commit ni push automáticamente. Esperar autorización cuando corresponda.
- Después de cualquier cambio, ejecutar `git status`, `git diff` y `git diff --check`.
- Después de modificar código, ejecutar las validaciones correspondientes.
- Al terminar, informar qué cambió, qué se probó y cuál fue el resultado.

## Seguridad y reglas de negocio

- La seguridad importante debe aplicarse también en backend, RLS, RPC y PostgreSQL; ocultar controles en frontend no es suficiente.
- Los roles actuales son `admin`, `owner` y `staff`.
- `staff` no puede ver información financiera, pagos, saldos ni ingresos, ni crear o renovar membresías.
- Las renovaciones crean una nueva membresía y conservan el historial anterior.
- Las membresías no canceladas de un mismo cliente no deben solaparse.
- Un pago reportado por un alumno queda `PENDIENTE` hasta que `admin` u `owner` lo apruebe.
- Un pago pendiente o rechazado no modifica abonos, saldos ni estado financiero.

## Interfaz

- Mantener una interfaz clara, profesional y responsive, con fondo claro, superficies blancas, texto navy y acentos cobre/naranja.

## Regla crítica

Antes de cualquier cambio importante:

1. revisar;
2. explicar;
3. modificar;
4. probar;
5. verificar;
6. esperar autorización para commit/push cuando corresponda.
