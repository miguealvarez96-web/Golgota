# Privacidad y protección de datos

Documento técnico de trabajo para el BLOQUE 6. No sustituye asesoría jurídica ni declara cumplimiento total de la Ley Orgánica de Protección de Datos Personales (LOPDP). Antes de publicar el aviso como definitivo, Gólgota debe validar los campos marcados como pendientes con la persona responsable y asesoría legal ecuatoriana.

## Alcance implementado

- Aviso público versionado en `/privacidad`.
- Reconocimiento del aviso vigente por el alumno, con versión, fecha, contexto y finalidades explícitas.
- Consentimiento opcional y separado para comunicaciones promocionales, nunca premarcado.
- Solicitudes de acceso, rectificación, actualización, eliminación cuando proceda, oposición, portabilidad, suspensión u otra.
- Consulta de solicitudes propias por el alumno.
- Revisión humana por `admin` u `owner`, con estado, respuesta, revisor y fecha.
- RLS, RPC y permisos de tabla; `staff` no accede a evidencia ni solicitudes.
- Auditoría de altas y cambios de estado mediante `public.registrar_auditoria()`.
- Ninguna solicitud modifica o elimina datos automáticamente.

## Inventario técnico de datos

| Conjunto | Datos principales | Finalidad técnica actual | Acceso |
| --- | --- | --- | --- |
| Supabase Auth | UUID, correo, credenciales administradas por Supabase, metadatos mínimos de sesión | Autenticación y recuperación de acceso | Proveedor de autenticación; la aplicación no almacena contraseñas |
| `public.usuarios` | UUID, nombre, correo, rol, estado activo | Perfil, autorización y trazabilidad | Titular sobre su flujo; admin/owner según funciones |
| `public.clientes` | identificación, contacto, datos operativos y vínculo Auth | Gestión del servicio y membresías | Roles operativos conforme a RLS |
| Membresías y pagos | plan, fechas, valores, saldo e historial de pagos | Prestación del servicio, cobranza e historial financiero | Alumno sobre sus datos; admin/owner; staff sin finanzas |
| Asistencia | cliente, fecha, horario | Control de acceso y operación del gimnasio | Roles operativos autorizados |
| Reportes de pago | monto, fecha, comprobante privado, MIME, tamaño, observación y revisión; origen/referencia solo históricos | Verificar una comunicación de pago antes de registrarla | Alumno propio y admin/owner; staff sin acceso |
| Privacidad | versión aceptada, fecha, finalidades, preferencia promocional, solicitud, respuesta y revisor | Evidencia, atención de derechos y trazabilidad | Alumno propio y admin/owner |
| Auditoría | operación, tabla, UUID actor y copias JSON de fila anterior/nueva | Seguridad y trazabilidad | Actualmente admin según RLS; requiere revisión de retención |

## Finalidades y bases por validar

El aviso distingue prestación del servicio, administración de membresías y pagos, seguridad/autorización, atención de solicitudes y comunicaciones promocionales. La aceptación del aviso demuestra lectura de una versión; no se presenta como consentimiento universal. La base aplicable a cada tratamiento, los plazos de conservación y las obligaciones legales deben validarse antes de declarar el documento definitivo.

Las comunicaciones promocionales usan una decisión opcional separada. Rechazarlas no impide usar el portal ni solicitar el servicio.

## Flujo de solicitudes

1. El alumno autenticado crea una solicitud sobre su propia cuenta mediante RPC.
2. La solicitud queda `RECIBIDA`; no produce cambios automáticos.
3. Admin u owner puede pasarla a `EN_REVISION`.
4. Para cerrar como `ATENDIDA` o `RECHAZADA` se exige una respuesta.
5. Un caso cerrado no se reabre mediante la RPC actual. Cualquier ejecución material sobre otros datos requiere revisión humana, validación de identidad, análisis de procedencia y un procedimiento separado.

## Auditoría de minimización pendiente

No se eliminan datos existentes en este bloque. Se documentan los siguientes puntos para decisión administrativa y legal:

- `clientes.fecha_nacimiento`, `tipo_cliente`, `motivo_creacion`, `como_llego`, `referido_por`, `quien_refirio` y `comentarios`: justificar necesidad, restringir texto libre y asignar retención; si no son necesarios, dejar de recopilarlos antes de plantear una depuración controlada.
- `usuarios.email` y `clientes.email`: documentar cuál representa acceso a la cuenta y cuál contacto del cliente, definir fuente de verdad y evitar duplicación innecesaria.
- `membresias.estado_legacy` y `membresias.metodo_pago`: son campos históricos conservados; definir retención y acceso sin reintroducir escritura.
- `auditoria_logs.old_data/new_data`: pueden replicar datos personales completos. Revisar acceso, campos capturados, retención y un mecanismo seguro de depuración que preserve obligaciones de trazabilidad.
- WOD, comunicados y observaciones: evitar datos personales, información de salud y otros datos no necesarios en texto libre.
- Comprobantes y observaciones de pagos reportados: definir conservación después de la revisión; banco y referencia dejan de solicitarse y permanecen solo en históricos.
- No se capturan IP, agente de usuario, geolocalización ni huella de dispositivo como evidencia de aceptación en este bloque.

## Proveedores, transferencias y retención

Supabase y Vercel son proveedores técnicos conocidos por la arquitectura. Sus roles contractuales, regiones de tratamiento, subencargados, medidas, transferencias internacionales y mecanismos aplicables están pendientes de validación administrativa/legal. No deben completarse con supuestos.

También están pendientes la razón social o nombre completo del responsable, RUC/identificación, domicilio, correo específico de privacidad, delegado o contacto responsable, plazos de atención y tabla de retención por categoría.

## Seguridad operativa

- El navegador usa la clave publicable y la sesión del usuario; no se incorpora `service_role`.
- Las RPC derivan el titular y el revisor desde `auth.uid()` y vuelven a comprobar el rol.
- Las tablas no conceden INSERT, UPDATE ni DELETE directo a `authenticated`.
- Los comprobantes usan un bucket privado, rutas UUID y URL firmada temporal; alumno no recibe permiso de borrado manual.
- Los comprobantes nuevos se conservan físicamente solo mientras el reporte está pendiente. Después de aprobar o rechazar se elimina el objeto, se anula la ruta firmable y quedan fecha de eliminación, MIME y tamaño originales; los fallos se reintentan sin revertir la revisión financiera.
- El service worker no precarga `/privacidad`; las navegaciones usan red con `no-store` y no persisten páginas autenticadas.
- No guardar contraseñas ni URL de conexión en archivos, logs o commits. El macro usa únicamente `SUPABASE_DB_URL` en memoria.

## Registro público de alumnos

El alta pública registra la versión vigente, `accepted_at`, contexto `REGISTRO_PUBLICO`, lectura obligatoria y consentimiento promocional separado. La promoción permanece desmarcada por defecto. La contraseña se entrega únicamente a Supabase Auth y nunca se guarda en tablas públicas ni en el intento temporal.

Los intentos conservan nombre, identificación, teléfono, correo y preferencias durante el proceso para completar el alta de forma recuperable. Vencen operativamente a los 30 minutos y no tienen políticas ni privilegios de lectura directa para `anon` o `authenticated`. La definición formal de retención y depuración de estos intentos requiere validación legal/administrativa; no se implementa borrado automático en este bloque.

El control de abuso incluido limita intentos por correo o identificación. No se capturan IP ni huellas del dispositivo. CAPTCHA y limitación en edge/proveedor quedan pendientes para una fase de endurecimiento.

## Pendientes antes de publicación definitiva

- Completar y aprobar todos los marcadores `[PENDIENTE DE DEFINICIÓN Y VALIDACIÓN LEGAL/ADMINISTRATIVA]`.
- Validar bases, finalidades, destinatarios, transferencias, retención y proceso de verificación de identidad.
- Definir responsable interno, canal de privacidad, plazos y procedimiento material de respuesta.
- Revisar contratos y configuración de Supabase y Vercel.
- Ejecutar el dry-run, autorizar SQL real y aprobar el postflight.
