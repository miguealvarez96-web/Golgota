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
vigencia, saldo e historial, y registra reportes de pago con comprobante JPG,
JPEG, PNG o PDF de hasta 5 MB que nacen `PENDIENTE`.
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

La migración aditiva `20261005_comprobantes_pago_v1.sql` crea el bucket privado
`payment-receipts`, conserva banco y referencia solo por compatibilidad histórica
y exige comprobante en los reportes nuevos. El alumno carga bajo
`{auth_user_id}/{uuid}.{ext}` y consulta únicamente archivos enlazados a sus
propios reportes; admin/owner consultan todos mediante URL firmada temporal y
`staff` no tiene acceso. No se implementa reemplazo de evidencia en esta fase.

El ajuste `20261006_limpieza_comprobantes_pago.sql` reduce la conservación:
mientras el reporte está `PENDIENTE` el archivo permanece disponible; después de
aprobar o rechazar, el servidor intenta eliminarlo y anula la ruta solo tras
confirmar la eliminación. La fila del reporte, los datos financieros, MIME y
tamaño originales y `comprobante_eliminado_at` se conservan. Un fallo de Storage
no revierte la decisión ni el pago real: queda marcado para reintento idempotente
por admin/owner. Los comprobantes ya resueltos antes del ajuste quedan `LEGACY` y
no se limpian automáticamente.

El BLOQUE 2 de pagos completos está preparado en
`20261004_pagos_completos_v1.sql`. La aprobación bloquea reporte y membresía,
rechaza saldo cero, cancelaciones y sobrepagos, reutiliza `registrar_pago` y
vincula el pago real de forma atómica. La bandeja de admin/owner incorpora
búsqueda, filtros, membresía, revisor, fechas y vínculo de trazabilidad. El
rechazo exige motivo y nunca escribe en pagos o membresías. Falta ejecutar el
dry-run y autorizar las migraciones reales.

## Dashboard

El Dashboard de `admin` y `owner` contiene cinco KPI: clientes activos, membresías vigentes, membresías por vencer, ingresos del mes y pagos pendientes. La vista `v_dashboard_kpis` centraliza estos valores y usa la fecha de negocio de `America/Guayaquil`.

El Dashboard de `staff` es exclusivamente operativo: búsqueda rápida de alumnos, próximos a vencer, vencidos, WOD publicado del día, comunicados recientes y acceso a crear cliente. Usa `v_membresias_verificacion` y no consulta pagos, saldos, abonos, ingresos ni `v_dashboard_kpis`.

## Reportes de gestión

El BLOQUE 5 reemplaza el placeholder de `/reportes` por una vista ejecutiva exclusiva para `admin` y `owner`. Permite consultar hoy, mes actual, mes anterior o un rango personalizado usando la fecha de negocio de Ecuador. Incluye clientes activos, vigencias, ingresos confirmados, cartera, gastos, resultado neto, cobranza priorizada, próximas renovaciones, stock bajo, distribución de membresías, gráficos y exportación CSV de cobranza.

Los ingresos se obtienen únicamente de `public.pagos`, que contiene pagos reales. Los reportes de alumno pendientes o rechazados no se consultan ni se suman. El saldo pendiente se presenta como cartera y nunca como ingreso. Las ventas pagadas se usan solo para un ranking de productos; no se incorporan al resultado neto porque el esquema actual de ventas no tiene un historial de cobros equivalente a `public.pagos`.

No fue necesario añadir SQL: las tablas y vistas existentes son suficientes, y la sesión server-side conserva las políticas RLS financieras para `admin` y `owner`. `staff` y `alumno` quedan rechazados además por el control de acceso específico de la ruta.

## Portal Coach / Staff

El BLOQUE 3 está completo en código y preparado para dry-run SQL. La búsqueda de clientes muestra plan, inicio, vencimiento y los estados `POR INICIAR`, `VIGENTE`, `POR VENCER`, `VENCE HOY` y `VENCIDA` mediante una proyección operativa sin columnas financieras. Staff conserva el alta de clientes, pero no puede editar, inactivar, crear o renovar membresías ni entrar a pagos, gastos o reportes financieros.

`/wod` y `/comunicados` son módulos responsive. Admin y owner crean, editan y publican; staff solo consulta contenido publicado. RLS y permisos de columna aplican la misma separación en PostgreSQL, y alumno no recibe acceso al portal coach. La migración `20261004_coaches_completos_v1.sql` aún no se ha aplicado.

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

## PWA e interfaz

El BLOQUE 4 convierte el portal en una PWA instalable con manifest de App Router, iconos propios, soporte de instalación en navegadores compatibles, orientación para iOS y fallback visual sin conexión. La referencia rota `public/golgota-logo.png` fue resuelta a partir del logo oficial `images.jpg`, conservando el tigre, el texto "GÓLGOTA CF / ONE BOX, ONE FAMILY", sus colores y su composición. El favicon predeterminado de Vercel también fue reemplazado por un derivado de ese mismo logo.

El service worker conserva únicamente assets públicos y el fallback offline. Las navegaciones siempre consultan la red con `no-store`; no se cachean páginas autenticadas, respuestas de Supabase, pagos, saldos ni datos de alumnos. La interfaz mantiene fondo claro, superficies blancas, texto navy, acentos cobre/naranja y comportamiento responsive.

## Privacidad y LOPDP

El BLOQUE 6 incorpora un aviso público provisional y versionado, evidencia de lectura, consentimiento promocional opcional y separado, solicitudes del titular y una bandeja de revisión exclusiva de admin/owner. Alumno solo consulta y crea registros propios; staff no accede. RLS, RPC, permisos y auditoría refuerzan estas reglas en PostgreSQL, sin eliminación automática.

La migración `20261004_privacidad_lopdp_v1.sql` está preparada pero no aplicada. El contenido legal sigue siendo provisional: razón social, RUC, domicilio, contacto, bases, retención, proveedores y transferencias requieren definición y validación legal/administrativa. `docs/PRIVACIDAD.md` contiene el inventario y la auditoría de minimización, sin afirmar cumplimiento total.

## Cierre técnico de producción

El BLOQUE FINAL revisa la aplicación completa sin añadir SQL. La navegación visible queda limitada por rol: admin/owner acceden a los módulos terminados; staff recibe solo Dashboard operativo, Clientes, WOD y Comunicados; alumno dispone de Portal, Privacidad y cierre de sesión. Las rutas placeholder de Asistencia y Gastos se conservan por compatibilidad, pero ya no se enlazan.

Login y recuperación manejan también excepciones de red, existen estados de carga y límites de error para ambos portales, y la aplicación incorpora una página 404 coherente con la identidad visual. `scripts/verificar-produccion.ps1` comprueba el build, rutas críticas, PWA, iconos, navegación, variables públicas y ausencia de secretos evidentes. El estado operativo, las dependencias de Supabase y los pendientes externos se consolidan en `docs/ESTADO-FINAL.md`.

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
