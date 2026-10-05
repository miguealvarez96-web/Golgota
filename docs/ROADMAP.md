# GOLGOTA CROSSFIT - ROADMAP

## Objetivo general

Construir Golgota CrossFit por etapas, manteniendo una sola base de datos y el mismo backend de Supabase.

La prioridad es avanzar rapido sin duplicar sistemas.

## Fase 1 - Consolidar portal interno

Estado: EN PROGRESO

Incluye:

- autenticacion;
- roles admin, owner y staff;
- clientes;
- membresias;
- pagos internos;
- dashboard;
- permisos STAFF;
- documentacion tecnica base.

Pendientes:

- cerrar modulos internos aun incompletos;
- revisar logo definitivo;
- completar pruebas funcionales restantes.

## Fase 2 - Portal del alumno

Estado: PREPARADO PARA DRY-RUN SQL

Funciones previstas:

- registro;
- completar datos personales;
- consultar membresia;
- consultar vencimiento;
- consultar historial permitido;
- renovar;
- reportar pago.

Portal V1 implementado: acceso segregado, perfil, membresía actual, vigencia,
saldo, historial, reportes de pago y cierre de sesión. Falta únicamente validar
el dry-run, autorizar/aplicar SQL, vincular una cuenta de prueba y desplegar.

## Fase 3 - Pagos reportados por alumnos

Estado: BLOQUE 2 COMPLETO, PREPARADO PARA DRY-RUN SQL

Flujo:

Alumno
-> reporta pago
-> PENDIENTE
-> Admin/Owner revisa
-> APRUEBA o RECHAZA

Regla critica:

Un pago PENDIENTE o RECHAZADO no modifica:

- abonos;
- saldos;
- estado financiero;
- activacion de membresia;
- renovacion.

Solo un pago APROBADO se aplica como pago real.

La implementación incluye pagos parciales y totales, protección contra
sobrepago y doble aprobación, trazabilidad completa, rechazo con motivo,
bandeja filtrable para admin/owner y aislamiento de staff/alumno.

## Fase 4 - Aplicacion instalable PWA

Estado: BLOQUE 4 COMPLETO, LISTO PARA CIERRE Y DESPLIEGUE

Objetivo:

Permitir que Golgota pueda instalarse en celulares y otros dispositivos desde el navegador.

Debe incluir:

- manifest;
- iconos;
- instalacion desde pantalla de inicio;
- experiencia responsive;
- funcionamiento correcto en movil.

La PWA utilizara el mismo frontend Next.js y el mismo backend Supabase.

Implementado:

- manifest compatible con Next.js 14 App Router;
- iconos 192, 512, maskable y Apple Touch;
- logo oficial y favicon derivado sin rutas rotas;
- metadata global, theme color y modo standalone;
- service worker seguro limitado a assets públicos;
- fallback offline sin información privada;
- ayuda discreta de instalación para navegadores compatibles e iOS;
- pruebas y macro de cierre sin dependencia de SQL.

Pendiente únicamente: autorizar commit/push y despliegue mediante el macro del BLOQUE 4.

## Fase 5 - Privacidad y LOPDP

Estado: PENDIENTE

Trabajar gradualmente:

- inventario de datos personales;
- finalidad de cada dato;
- politica de privacidad;
- consentimiento cuando corresponda;
- derechos de titulares;
- retencion y eliminacion;
- proveedores;
- transferencias;
- seguridad;
- trazabilidad.

Antes de abrir el portal a muchos alumnos, revisar esta fase.

## Fase 6 - Coach / Staff operativo

Estado: BLOQUE 3 COMPLETO, PREPARADO PARA DRY-RUN SQL

Funciones previstas:

- buscar alumnos;
- consultar vigencia;
- crear clientes;
- WOD del dia;
- foto del WOD;
- texto del WOD;
- comunicados;
- noticias de comunidad;
- asistencia.

Mantener fuera de Staff toda informacion financiera.

Implementado en BLOQUE 3:

- dashboard operativo responsive;
- búsqueda de alumnos con plan, fechas y cinco estados de vigencia;
- alertas de próximos a vencer y vencidos;
- creación de clientes con las validaciones existentes;
- WOD administrado por admin/owner y publicado para staff;
- comunicados administrados por admin/owner y publicados para staff;
- RLS, permisos de columna, preflight, postflight, rollback, dry-run y macro de cierre.

Pendiente únicamente: ejecutar dry-run autorizado, aplicar la migración, validar postflight, commit/push y despliegue mediante el macro.

## Fase 7 - Reportes y gestion

Estado: BLOQUE 5 COMPLETO, LISTO PARA CIERRE

Posibles mejoras:

- reportes operativos;
- reportes financieros para admin/owner;
- vencimientos;
- cartera;
- ingresos;
- asistencia;
- indicadores de gestion.

Implementado:

- filtros por hoy, mes actual, mes anterior y rango personalizado;
- ocho KPI de operación, cobranza y resultado financiero;
- ingresos limitados a pagos reales confirmados;
- gastos, resultado neto y cartera separados correctamente;
- cobranza priorizada y exportable a CSV;
- distribución de vigencias y próximas renovaciones;
- stock bajo, agotados y ranking opcional de ventas pagadas;
- acceso server-side exclusivo de admin/owner apoyado por RLS existente;
- gráficos responsive, pruebas y macro de cierre sin SQL nuevo.

## Fase 8 - Aplicacion movil nativa

Estado: FUTURO

Evaluar solamente cuando la web responsive y la PWA esten maduras.

La app movil debe reutilizar el mismo backend de Supabase.

No duplicar logica de negocio innecesariamente.

## Arquitectura objetivo

Web responsive
-> PWA instalable
-> futura app movil

Todo conectado al mismo backend Supabase.

## Regla de ejecucion

Cada fase debe trabajarse asi:

1. revisar;
2. definir tarea pequena;
3. implementar;
4. probar;
5. verificar;
6. commit;
7. push;
8. continuar.

No desarrollar varias fases simultaneamente.
