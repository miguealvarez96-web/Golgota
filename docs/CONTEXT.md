# Estado del proyecto GÓLGOTA CROSSFIT

Este documento resume el estado funcional y las reglas de trabajo del portal. La rama observada es `main`, en `210d61f`.

## Stack

Next.js 14 con App Router, TypeScript, Tailwind CSS, Supabase, PostgreSQL, Supabase Auth, RLS y RPC. El proyecto también incluye React Hook Form, Zod, TanStack Query, Recharts y Vercel.

## Roles

- **Admin:** acceso total a la operación y administración técnica.
- **Owner:** administra clientes, membresías y pagos, consulta saldos e historial y usa el Dashboard financiero; no tiene administración técnica.
- **Staff / coach:** consulta y busca clientes, puede crear clientes y consultar información operativa de membresías. No edita clientes ni accede a datos financieros, pagos, saldos o ingresos; tampoco crea ni renueva membresías.

La autorización se comprueba en el servidor y en RLS/RPC. Ocultar controles en la interfaz no sustituye esos controles.

## Clientes

El módulo `/clientes` está conectado a Supabase. Incluye búsqueda y filtro, alta, edición e inactivación sin borrado físico. `staff` puede consultar, buscar y crear; solo `admin` y `owner` editan o inactivan. La consulta de vigencia desde el listado de clientes se reserva a `admin` y `owner`.

Los datos se validan en frontend y servidor. Nombres se normalizan a mayúsculas; cédulas se conservan como texto, con ceros iniciales y unicidad; teléfono y correo se normalizan. La migración `supabase/migrations/20260930_normaliza_clientes.sql` ya fue aplicada correctamente a Supabase.

## Membresías

`/membresias` agrupa el historial por cliente y muestra una membresía de resumen, renovaciones futuras y anteriores. El historial conserva registros previos. Las renovaciones crean una membresía nueva. PostgreSQL aplica la protección contra solapamientos mediante el trigger `zz_membresias_evitar_solapamiento`; ignora las membresías `CANCELADA` al evaluar la regla.

`admin` tiene control completo. `owner` puede consultar, crear, renovar y cobrar. `staff` usa una proyección operativa reducida que expone cliente, plan, fecha de fin y vigencia, sin columnas financieras ni historial de pagos.

## Portal del alumno V1

El código del Portal del Alumno V1 está completo y preparado para dry-run SQL,
pero la migración `20261002_portal_alumno_v1.sql` todavía no se ha aplicado. Un
alumno activo entra por `/portal`, consulta únicamente su perfil, membresía,
vigencia, saldo e historial, y registra reportes de pago que nacen `PENDIENTE`.
Admin y owner disponen de la bandeja de revisión; staff no puede consultarla ni
aprobar o rechazar reportes.

La relación conserva `auth.users -> public.usuarios -> public.clientes` mediante
`clientes.auth_user_id`. La operación manual
`supabase/operations/20261002_vincular_cuenta_alumno.sql` vincula una cuenta y un
cliente existentes dentro de una sola transacción, sin duplicar clientes ni
autoasociar identidades.

## Pagos

Los pagos registrados son transacciones individuales asociadas a una membresía. `registrar_pago` valida el monto, evita sobrepagos y pagos a membresías canceladas, y actualiza los agregados de saldo dentro de la operación. Solo `admin` y `owner` registran pagos o consultan su historial; el historial no se borra ni edita desde la API normal.

El reporte de comprobantes por alumnos y su aprobación o rechazo están
preparados en código y SQL pendiente de aplicación. Un pago reportado queda
`PENDIENTE` hasta que `admin` u `owner` lo apruebe; un pago pendiente o rechazado
no modifica abonos, saldos ni el estado financiero.

El BLOQUE 2 de pagos completos está preparado en
`20261004_pagos_completos_v1.sql`. La aprobación bloquea reporte y membresía,
rechaza saldo cero, cancelaciones y sobrepagos, reutiliza `registrar_pago` y
vincula el pago real de forma atómica. La bandeja de admin/owner incorpora
búsqueda, filtros, membresía, revisor, fechas y vínculo de trazabilidad. El
rechazo exige motivo y nunca escribe en pagos o membresías. Falta ejecutar el
dry-run y autorizar las migraciones reales.

## Dashboard

El Dashboard de `admin` y `owner` contiene cinco KPI: clientes activos, membresías vigentes, membresías por vencer, ingresos del mes y pagos pendientes. La vista `v_dashboard_kpis` centraliza estos valores y usa la fecha de negocio de `America/Guayaquil`. `staff` recibe un panel operativo en construcción; la página no consulta la vista financiera.

## Permisos de STAFF probados

Además de las pruebas automatizadas locales, se hicieron pruebas manuales reales en el navegador con la cuenta STAFF de prueba. Se confirmó:

- login correcto;
- búsqueda y consulta de clientes;
- creación de clientes;
- no puede editar ni inactivar clientes;
- membresías visibles sin información financiera;
- no puede renovar ni crear membresías;
- recibe el Dashboard operativo;
- Gastos y Reportes están ocultos en la navegación, y el acceso directo se bloquea o redirige.

Las pruebas automatizadas también verifican que las acciones directas de edición, creación de membresías y registro de pagos no ejecuten escrituras/RPC para `staff`, que el historial y listado usen solo la proyección operativa y que el Dashboard no consulte `v_dashboard_kpis`.

## Interfaz y pendiente conocido

La interfaz sigue el estilo claro, profesional y responsive: fondo claro, superficies blancas, texto navy y acentos cobre/naranja. El componente de marca tiene un fallback visual, pero `public/golgota-logo.png` no está presente y la ruta produce un 404. Queda pendiente incorporar o resolver el recurso en una tarea autorizada.

## Privacidad y LOPDP

Gólgota debe considerar el cumplimiento de la Ley Orgánica de Protección de Datos Personales de Ecuador. Queda pendiente trabajar gradualmente:

- inventario de datos personales;
- finalidades de tratamiento;
- política de privacidad;
- consentimiento cuando corresponda;
- derechos de los titulares;
- retención y eliminación;
- proveedores y transferencias;
- seguridad y trazabilidad.

No se ha implementado todavía trabajo específico de LOPDP; queda documentado como requisito pendiente.

## Commits relevantes

- `7e4f0b5` — `docs: add Codex project rules`: agrega `AGENTS.md` con las reglas del proyecto.
- `210d61f` — `fix: restrict staff access to financial modules`: restringe navegación y acceso de `staff` a Gastos y Reportes.

## Forma de trabajo segura

- Trabajar una sola tarea a la vez y no ampliar el alcance sin autorización.
- No ejecutar SQL real sin autorización. Para SQL importante: revisión -> dry-run -> rollback -> autorización -> ejecución real.
- No borrar datos ni hacer cambios destructivos.
- No hacer commit ni push automáticamente.
- Después de cambios, revisar `git status`, `git diff` y `git diff --check`; después de modificar código, ejecutar las validaciones pertinentes.
- La seguridad importante debe estar en backend, RLS, RPC y PostgreSQL, no solo en la interfaz.
- Antes de un cambio importante: revisar, explicar, modificar, probar, verificar y esperar autorización para commit/push cuando corresponda.
- Al cerrar una tarea, informar qué cambió, qué se probó y el resultado; no continuar automáticamente con otra.
