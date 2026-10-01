# GOLGOTA CROSSFIT - DECISIONES DEL PROYECTO

## Roles

Los roles actuales son:

- admin
- owner
- staff

## Staff

Staff puede:

- consultar clientes;
- buscar clientes;
- crear clientes;
- consultar informacion operativa;
- consultar membresia;
- consultar vigencia y vencimiento.

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

Solo un pago APROBADO se aplica como pago real.

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