# GOLGOTA CROSSFIT - DECISIONES DEL PROYECTO

## Roles

Los roles actuales son:

- admin
- owner
- staff
- alumno

`alumno` accede únicamente a `/portal`, a su ficha vinculada mediante
`clientes.auth_user_id`, a sus membresías y a sus propios reportes de pago. No
accede al portal administrativo ni hereda capacidades operativas de `staff`.

## Staff

Staff puede:

- consultar clientes;
- buscar clientes;
- crear clientes;
- consultar informacion operativa;
- consultar membresia;
- consultar vigencia y vencimiento.
- consultar WOD publicado del dia;
- consultar comunicados publicados.

Staff no puede:

- editar clientes;
- inactivar clientes;
- ver pagos;
- ver saldos;
- ver ingresos;
- registrar pagos;
- crear membresias;
- renovar membresias;
- acceder a Gastos;
- acceder a Reportes financieros.

## Portal Coach

`staff` representa operativamente al coach. Su dashboard prioriza búsqueda de alumnos, vigencias urgentes, WOD y comunicados, sin KPI financieros.

WOD y comunicados V1 se administran únicamente por `admin` y `owner`. Staff tiene lectura de contenido publicado. Alumno no hereda acceso de coach. No se permite borrado desde la aplicación y la autorización se aplica también con RLS y permisos de columna.

La proyección `v_membresias_verificacion` es la única fuente de vigencia para staff. Incluye plan y fechas, pero nunca valor, abono, saldo, estado de pago ni historial de pagos.

## Seguridad

La seguridad no debe depender solamente del frontend.

Las reglas importantes deben protegerse tambien mediante:

- servidor;
- RLS;
- RPC;
- PostgreSQL;

cuando corresponda.

Ocultar botones o enlaces no reemplaza la autorizacion real.

## Clientes

Decisiones:

- no realizar borrado fisico;
- identificacion almacenada como texto;
- conservar ceros iniciales;
- nombres normalizados;
- telefonos normalizados;
- emails normalizados;
- no inventar tildes.

## Membresias

Decisiones:

- renovar crea una nueva membresia;
- conservar siempre el historial;
- no sobrescribir membresias anteriores;
- impedir solapamientos para el mismo cliente;
- membresias CANCELADA no bloquean la regla de solapamiento.

Estados:

- POR INICIAR
- VIGENTE
- POR VENCER
- VENCE HOY
- VENCIDA

## Pagos

Regla critica:

Un pago reportado por un alumno no se considera pago real hasta que admin u owner lo apruebe.

Mientras este PENDIENTE:

- no aumenta abono;
- no disminuye saldo;
- no cambia el estado financiero;
- no activa membresias;
- no renueva automaticamente.

Si es RECHAZADO:

- no modifica valores financieros;
- debe conservar trazabilidad.
- requiere un motivo de rechazo.

Solo un pago APROBADO se aplica como pago real.

La aprobación usa `registrar_pago` como única fuente de escritura financiera,
bloquea el reporte y la membresía, rechaza sobrepagos y enlaza exactamente un
`pago_real_id`. Pagos parciales mantienen `PENDIENTE`; cuando el saldo llega a
cero la membresía queda `PAGADO`.

La cuenta del alumno se vincula de forma explícita y transaccional a un cliente
existente. No se crean ni se asocian clientes automáticamente por correo,
teléfono u otro dato coincidente.

## Interfaz

Identidad visual acordada:

- fondo claro;
- superficies blancas;
- texto navy;
- detalles cobre/naranja;
- diseño limpio;
- profesional;
- moderno;
- responsive.

No volver al diseño general de fondo azul oscuro.

## Privacidad y LOPDP

La Ley Organica de Proteccion de Datos Personales de Ecuador debe considerarse un requisito del proyecto.

La implementacion sera gradual.

Pendientes:

- inventario de datos personales;
- finalidades de tratamiento;
- politica de privacidad;
- consentimiento cuando corresponda;
- derechos de los titulares;
- retencion y eliminacion;
- proveedores y transferencias;
- seguridad y trazabilidad.

## Forma de trabajo

Trabajar una sola tarea a la vez.

Antes de cambios importantes:

1. revisar;
2. explicar;
3. modificar;
4. probar;
5. verificar.

SQL real:

revision
-> dry-run
-> rollback
-> autorizacion
-> ejecucion real

No hacer commit ni push automaticamente.

El usuario autoriza commit y push.
