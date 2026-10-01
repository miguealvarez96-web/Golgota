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

Estado: PENDIENTE

Funciones previstas:

- registro;
- completar datos personales;
- consultar membresia;
- consultar vencimiento;
- consultar historial permitido;
- renovar;
- reportar pago.

No construir todo de golpe.

## Fase 3 - Pagos reportados por alumnos

Estado: PENDIENTE

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

## Fase 4 - Aplicacion instalable PWA

Estado: PENDIENTE

Objetivo:

Permitir que Golgota pueda instalarse en celulares y otros dispositivos desde el navegador.

Debe incluir:

- manifest;
- iconos;
- instalacion desde pantalla de inicio;
- experiencia responsive;
- funcionamiento correcto en movil.

La PWA utilizara el mismo frontend Next.js y el mismo backend Supabase.

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

Estado: PENDIENTE

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

## Fase 7 - Reportes y gestion

Estado: PENDIENTE

Posibles mejoras:

- reportes operativos;
- reportes financieros para admin/owner;
- vencimientos;
- cartera;
- ingresos;
- asistencia;
- indicadores de gestion.

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