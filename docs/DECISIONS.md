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

Los reportes nuevos requieren un comprobante privado JPG, JPEG, PNG o PDF de
hasta 5 MB. El nombre original nunca identifica el objeto: Storage usa
`{auth_user_id}/{uuid}.{ext}` y la tabla guarda únicamente ruta, MIME y tamaño.
Las columnas históricas de banco y referencia se conservan, aceptan `NULL` y no
se solicitan en el flujo nuevo. Los reportes anteriores sin archivo siguen
visibles y se identifican como históricos.

El bucket `payment-receipts` no es público. Alumno solo carga y firma archivos
propios enlazados a sus reportes; admin y owner pueden firmar cualquier
comprobante de la bandeja; staff no tiene acceso. Una carga fallida y aún no
enlazada no concede por sí misma permiso DELETE al alumno; tampoco existe UPDATE
ni reemplazo del comprobante una vez creado el reporte.

La conservación física termina al resolver reportes nuevos. Aprobación o rechazo
se confirman primero en PostgreSQL; después se elimina el objeto de Storage. La
limpieza nunca forma parte de la transacción financiera, por lo que un fallo al
borrar no revierte un pago aprobado ni un rechazo registrado. En ese caso se
conserva la ruta solo para reintento admin/owner, pero la política y la acción de
firma bloquean su consulta desde que el estado deja de ser `PENDIENTE`.

Al confirmar la eliminación se anulan ruta, MIME y tamaño operativos, y se
conservan `comprobante_original_mime`, `comprobante_original_size` y
`comprobante_eliminado_at`. Alumno no dispone de DELETE manual. Los reportes
resueltos antes de la migración quedan `LEGACY` y no se depuran automáticamente.

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

## PWA

La aplicación usa el manifest nativo de Next.js App Router y no añade una dependencia PWA externa. El service worker se registra únicamente en producción y limita su caché a iconos, logo, fallback offline y archivos versionados de `/_next/static`.

Las páginas autenticadas y la navegación usan red con `no-store`; nunca se persisten respuestas de Supabase, credenciales, pagos, saldos ni datos personales para uso offline. La pérdida de conexión muestra una página informativa, no una copia de información privada.

La instalación se ofrece de forma discreta mediante `beforeinstallprompt`; Safari en iOS recibe una guía manual bajo demanda.

## Reportes de gestión

`/reportes` es exclusivo de `admin` y `owner`; la autorización se valida en servidor y se apoya en las políticas RLS existentes de pagos, membresías, gastos y ventas. Staff y alumno no reciben acceso directo ni navegación hacia el módulo.

El resultado neto se define como pagos confirmados en `public.pagos` menos gastos del período. La cartera pendiente es una métrica separada y no forma parte de los ingresos. `pagos_reportados` no es una fuente de ingresos: solo una aprobación que haya creado el pago real puede reflejarse en el reporte.

Las vigencias se obtienen de `v_membresias_estado` y de las utilidades de membresías existentes. El umbral operativo de stock bajo es de una a cinco unidades; stock cero se muestra por separado. Las ventas con estado `PAGADO` permiten un ranking, pero no se agregan a caja mientras no exista un historial fiable de cobros de ventas.

## Privacidad y LOPDP

La aceptación registra la lectura de una versión del aviso y no se usa como consentimiento universal. Las comunicaciones promocionales se mantienen como finalidad opcional, separada y no premarcada.

Las solicitudes de titulares no ejecutan borrado ni edición automática: quedan para revisión humana de admin/owner, con respuesta, revisor, fecha y auditoría. Staff no puede consultar ni gestionar estos registros. Los datos existentes no se eliminan en este bloque; primero se documenta su necesidad, retención y dependencia.

El aviso público se considera provisional hasta completar los datos del responsable y validar jurídicamente bases, conservación, proveedores y transferencias. No se declara cumplimiento total de la LOPDP.

## Autorregistro público

- El rol no viaja desde el formulario: PostgreSQL asigna siempre `alumno`.
- Solo identificaciones nuevas se autorregistran. Un cliente histórico, incluso sin vínculo, requiere ayuda y vinculación humana; conocer cédula, correo o teléfono no basta para apropiarse de su ficha.
- El intento temporal no guarda contraseñas y vence a los 30 minutos. El trigger de Auth crea perfil, cliente, vínculo y aceptación de privacidad dentro de la misma transacción.
- Altas Auth ajenas al flujo quedan como `alumno` inactivo, nunca con el `staff` predeterminado histórico.
- No se crean membresías ni pagos. La aceptación obligatoria usa `REGISTRO_PUBLICO`; promociones son opcionales y no premarcadas.
- Existe limitación básica de cinco intentos por hora por correo o identificación. CAPTCHA y rate limiting por IP/edge quedan como endurecimiento externo pendiente.

## Cierre de producción

La navegación se define mediante listas permitidas por rol. Staff ve únicamente Dashboard operativo, Clientes, WOD y Comunicados; los enlaces financieros, administrativos y los placeholders no se muestran. Las rutas históricas de Asistencia y Gastos se conservan para no romper referencias, sin presentarlas como módulos terminados.

El BLOQUE FINAL no crea ni aplica SQL. Su macro se detiene si Git detecta cualquier archivo SQL nuevo o modificado, aísla el staging a los archivos del cierre y exige confirmaciones independientes para commit/push y deploy. El checklist de producción inspecciona artefactos del build, rutas, PWA, recursos visuales, variables públicas y referencias sensibles sin imprimir secretos.

Un build correcto no demuestra que las migraciones estén aplicadas en Supabase ni que Vercel tenga su entorno configurado. Esas verificaciones siguen siendo puertas externas obligatorias antes de declarar la operación productiva.

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
