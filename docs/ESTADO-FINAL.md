# Estado final de Gólgota CrossFit

Fecha de revisión técnica: 2026-10-05.

El código queda preparado para operación diaria y cierre controlado. Esta revisión no ejecutó SQL, no publicó cambios y no confirma por sí sola el estado de la base remota ni del despliegue de Vercel.

## Módulos terminados

- Autenticación: login, logout y recuperación de contraseña con mensajes seguros.
- Clientes: búsqueda, filtros, alta, edición autorizada, inactivación e identificación de vigencia.
- Membresías: alta, renovación histórica, control de solapamientos, vigencia y detalle financiero por rol.
- Pagos: pagos reales transaccionales, reportes del alumno con comprobante privado y revisión admin/owner.
- Productos: catálogo, stock, imágenes privadas y gestión admin/owner.
- Portal coach: panel operativo, clientes, WOD y comunicados sin datos financieros.
- Portal alumno: perfil, membresía, historial, saldo, reporte de pago y privacidad.
- Reportes: indicadores ejecutivos, cobranza, gastos, stock, vigencias y exportación CSV.
- Privacidad: aviso público provisional, evidencia versionada y solicitudes con revisión humana.
- PWA: manifest, iconos oficiales, instalación y fallback offline sin cachear datos privados.

`/asistencia` y `/gastos` conservan rutas históricas como placeholders, pero no aparecen en la navegación de producción. Los gastos existentes sí alimentan reportes; este cierre no crea un módulo nuevo de captura.

## Roles y navegación

| Rol | Navegación principal | Restricciones |
| --- | --- | --- |
| `admin` / `owner` | `/`, `/clientes`, `/membresias`, `/productos`, `/pagos-reportados`, `/wod`, `/comunicados`, `/reportes`, `/solicitudes-privacidad` | Acceso financiero y de gestión conforme a RLS/RPC |
| `staff` | `/`, `/clientes`, `/wod`, `/comunicados` | Sin pagos, saldos, ingresos, reportes, productos administrativos ni privacidad de terceros |
| `alumno` | `/portal`, `/privacidad` y cierre de sesión | Solo datos y solicitudes propias |

La ocultación de enlaces complementa, pero no reemplaza, las validaciones de servidor, RLS y RPC.

## URLs públicas y operativas

- Públicas: `/login`, `/reset-password`, `/auth/callback`, `/privacidad`, `/offline`.
- Internas: `/`, `/clientes`, `/membresias`, `/productos`, `/pagos-reportados`, `/wod`, `/comunicados`, `/reportes`, `/solicitudes-privacidad`.
- Alumno: `/portal`.
- Existe una página 404 de marca y límites de error diferenciados para portal interno y portal alumno.

## Supabase

El frontend usa únicamente `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no incorpora `service_role`. Las operaciones sensibles se controlan mediante sesión, rol activo, RLS, privilegios de tabla y RPC.

Antes de producción debe comprobarse en la base remota, mediante los macros y postflight de cada bloque, que estén aplicadas las migraciones preparadas de Portal Alumno, pagos completos, coaches y privacidad. El BLOQUE FINAL nunca aplica SQL y se detiene si encuentra archivos SQL nuevos o modificados.

El bloque de comprobantes añade `20261005_comprobantes_pago_v1.sql` después de
Portal Alumno y Pagos Completos. La migración sigue pendiente de dry-run y
autorización real; no se ejecutó contra Supabase durante esta revisión.

El ajuste `20261006_limpieza_comprobantes_pago.sql` elimina el archivo privado
después de una aprobación o rechazo exitosos, conserva la fila y metadatos
originales, bloquea nuevas firmas al resolver y permite reintentos idempotentes
si Storage falla. Los archivos históricos ya resueltos no se eliminan al migrar.

## Vercel y PWA

No se realizó deploy en esta revisión. Vercel debe tener las variables públicas de Supabase configuradas para producción. El logo oficial y sus derivados PWA están presentes; el service worker solo precachea assets públicos y usa red con `no-store` para navegaciones.

## Seguridad verificada

- Separación server-side de admin/owner, staff y alumno.
- Staff sin navegación financiera ni acceso a las bandejas de pagos o privacidad.
- Alumno redirigido fuera del portal administrativo y limitado a sus datos por RLS/RPC.
- Mensajes de aplicación sin detalles internos de PostgreSQL/Supabase.
- Sin contraseñas, tokens, URL de base con credenciales ni service role en `src/public`.
- Imágenes de productos en Storage privado con URLs firmadas temporales.
- Comprobantes de pago en `payment-receipts` privado, con límite de 5 MB, MIME y firma binaria validados, rutas UUID y URLs firmadas por 120 segundos.
- Alumno limitado a comprobantes propios; admin/owner con lectura; staff sin acceso. Los comprobantes enlazados no se reemplazan ni eliminan desde el flujo normal.
- Tras la revisión, solo admin/owner ejecutan la limpieza automática o su reintento; alumno no tiene DELETE y ningún rol puede firmar un comprobante resuelto.
- Navegaciones autenticadas no persistidas por la PWA.
- No hay borrado automático de clientes, historiales, pagos ni solicitudes de privacidad.

## Scripts de cierre

- `scripts/cerrar-bloque-pagos.ps1`
- `scripts/cerrar-bloque-comprobantes-pago.ps1`
- `scripts/cerrar-ajuste-limpieza-comprobantes.ps1`
- `scripts/cerrar-bloque-coaches.ps1`
- `scripts/cerrar-bloque-pwa.ps1`
- `scripts/cerrar-bloque-reportes.ps1`
- `scripts/cerrar-bloque-privacidad.ps1`
- `scripts/verificar-produccion.ps1`
- `scripts/cerrar-proyecto-golgota.ps1`

El macro final ejecuta pruebas, TypeScript, build, revisión Git y checklist; aísla archivos del bloque, solicita confirmación para commit/push y deploy, y usa un proceso robusto para `vercel --prod`.

## Pendientes reales antes de operar

1. Ejecutar los dry-run y postflight de bloques con SQL, incluido comprobantes de pago, y autorizar cada aplicación pendiente.
2. Vincular y probar cuentas reales de cada rol, especialmente un alumno, en la base objetivo.
3. Configurar y verificar variables de entorno en Vercel.
4. Completar y validar los datos legales/administrativos señalados en `docs/PRIVACIDAD.md`.
5. Realizar una prueba manual en dispositivos móviles reales; la sesión de automatización de este cierre no tuvo navegador disponible.
6. Decidir en una fase futura si Asistencia y captura de Gastos se implementan o permanecen fuera de navegación.

## Recomendaciones futuras

- Monitoreo de errores y disponibilidad sin registrar información personal innecesaria.
- Pruebas end-to-end autenticadas con cuentas aisladas de cada rol.
- Revisión periódica de dependencias, políticas RLS, Storage y retención de auditoría.
- Evaluar aplicación móvil nativa solo después de estabilizar la operación web/PWA.
