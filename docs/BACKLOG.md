# Backlog — TFI Sistema de Gestión Financiera y Facturación Electrónica

Backlog completo, de punta a punta, desde donde está el proyecto hoy hasta
la entrega final. Todavía sin repartir entre los tres — primero cargamos
todo, después nos lo dividimos.

Los códigos entre corchetes (`[F3-10]`) son solo para referencia interna
de este documento (para poder decir "depende de F3-10" sin repetir el
título entero). No van en el título del issue.

Para cargar cada tarea como issue real, usar `scripts/github/new-issue.sh`
(ver `docs/CONTRIBUTING.md`). El campo "Prioridad" y "Área" no tienen
label propia todavía — de mínima ponerlos en el cuerpo del issue como acá
abajo; si más adelante queremos filtrar por eso en el board, se puede
agregar como campo custom en el Project (no hace falta ahora).

---

## Fase 0 — Cerrar correcciones de la primera entrega

### [F0-1] Revisar la devolución del docente punto por punto
**Descripción:** Leer la corrección completa y anotar, para cada
observación, en qué fase de este backlog queda resuelta. Es la forma de
no perder ningún punto en el camino.
**Criterios de cierre:**
- [ ] Cada observación del docente tiene una tarea asociada en este backlog.
- [ ] El documento de la primera entrega queda linkeado desde acá.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F0-2] Actualizar la propuesta con lo que ya cambió
**Descripción:** El PDF de la primera entrega quedó desactualizado en
algunos puntos (stack, alcance). Antes de seguir, alinearlo con lo que
realmente vamos a construir.
**Criterios de cierre:**
- [ ] `docs/TFI_Primera_Entrega` actualizado o con un anexo de cambios.
- [ ] El stack tecnológico coincide con lo que hay en el repo.
**Prioridad:** P1
**Área:** Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F0-3] Armar el backlog completo en GitHub Projects
**Descripción:** Cargar todas las tareas de este documento como issues
reales, con su fase, prioridad y área, para poder repartir el trabajo
después.
**Criterios de cierre:**
- [ ] Todas las tareas de fases 0 a 10 están cargadas como issues.
- [ ] El board tiene las 6 columnas definidas (Backlog, To Do, In Progress,
      Review, Testing, Done).
**Prioridad:** P0
**Área:** DevOps
**Dependencias:** Sin dependencia bloqueante.

---

## Fase 1 — Validar P0 y cerrar el dominio

### [F1-1] Hacer el relevamiento con usuarios reales
**Descripción:** Hablar con monotributistas de verdad (aunque sean
conocidos) que vendan productos, presten servicios o hagan ambas cosas,
para confirmar que el problema es real y que el P0 tiene sentido para
ellos.
**Criterios de cierre:**
- [ ] Al menos 3-5 monotributistas entrevistados o encuestados.
- [ ] Queda un resumen escrito de lo que dijeron.
**Prioridad:** P0
**Área:** Investigación
**Dependencias:** Sin dependencia bloqueante.

### [F1-2] Redactar las conclusiones del relevamiento y ajustar el P0
**Descripción:** A partir de las entrevistas, escribir qué confirma
nuestras hipótesis, qué no, y si hay que tocar el alcance del P0.
**Criterios de cierre:**
- [ ] Documento corto con los hallazgos.
- [ ] El P0 queda confirmado o ajustado por escrito.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Hacer el relevamiento con usuarios reales.

### [F1-3] Definir cómo se relacionan factura, pago y movimiento
**Descripción:** Dejar por escrito, antes de tocar código, que Invoice es
lo facturado, Payment es un cobro de una factura y Transaction es el
movimiento real de plata. Una factura puede tener varios pagos, y cada
pago genera como máximo un movimiento de ingreso.
**Criterios de cierre:**
- [ ] Documento (o sección del DER) con la definición de los tres conceptos.
- [ ] Queda claro qué genera qué: Invoice no genera Transaction directamente, Payment sí.
- [ ] Los tres lo revisamos y quedamos de acuerdo.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F1-4] Definir las reglas de negocio del dominio financiero
**Descripción:** Escribir las reglas que limitan el sistema: un movimiento
no puede tener importe negativo, la moneda es obligatoria, una factura
rechazada por ARCA no puede quedar como autorizada, el CAE solo se guarda
si la factura fue autorizada, facturado y cobrado son cosas
independientes.
**Criterios de cierre:**
- [ ] Lista de reglas escrita (puede partir de la de la propuesta, revisada).
- [ ] Cada regla tiene claro qué módulo la aplica.
- [ ] Las reglas de pagos parciales están incluidas.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Definir cómo se relacionan factura, pago y movimiento.

### [F1-5] Diseñar cómo funcionan los pagos parciales sin duplicar ingresos
**Descripción:** Definir el mecanismo exacto: si una factura de $10.000
recibe dos pagos de $6.000 y $4.000, tiene que quedar un ingreso por cada
pago —nunca uno por la factura completa— y el saldo pendiente tiene que
dar $0 al final.
**Criterios de cierre:**
- [ ] Documento con el flujo de pago parcial paso a paso.
- [ ] Queda definido qué pasa si un pago supera el saldo pendiente.
- [ ] Se valida con un ejemplo numérico completo.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Definir cómo se relacionan factura, pago y movimiento.

### [F1-6] Definir qué pasa con los datos de una factura ya autorizada
**Descripción:** Una vez que ARCA le dio el CAE a una factura, sus datos
(montos, cliente, fecha) no se pueden pisar aunque el cliente cambie de
nombre o de CUIT después. Definir cómo se guarda esa foto histórica.
**Criterios de cierre:**
- [ ] Queda definido si se usa un snapshot embebido o una tabla separada.
- [ ] Queda explícito que una factura autorizada no se puede borrar físicamente.
- [ ] Se anota en las reglas de negocio.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Definir cómo se relacionan factura, pago y movimiento.

---

## Fase 2 — DER, arquitectura y base de datos

### [F2-1] Armar el DER inicial completo
**Descripción:** Dibujar el diagrama entidad-relación con el núcleo del
dominio: User, Organization, Activity, PointOfSale, Client, Category,
ExchangeRate, Invoice, InvoiceItem, Payment y Transaction, con sus
relaciones y cardinalidades.
**Criterios de cierre:**
- [ ] Diagrama publicado en `docs/` (imagen o mermaid).
- [ ] Todas las entidades del núcleo están presentes.
- [ ] La relación Invoice-Payment-Transaction está dibujada explícitamente.
**Prioridad:** P0
**Área:** Documentación, Base de datos
**Dependencias:** Definir cómo se relacionan factura, pago y movimiento; Diseñar cómo funcionan los pagos parciales sin duplicar ingresos.

### [F2-2] Escribir el diccionario de datos
**Descripción:** Por cada entidad del DER, documentar sus campos, tipos,
si son obligatorios y una frase de qué significan. Sirve para que los
tres usemos los mismos nombres y no haya ambigüedad al codear.
**Criterios de cierre:**
- [ ] Cada entidad del DER tiene su tabla de campos documentada.
- [ ] Los campos de Invoice/Payment/Transaction distinguen estado fiscal de estado comercial.
**Prioridad:** P0
**Área:** Documentación, Base de datos
**Dependencias:** Armar el DER inicial completo.

### [F2-3] Definir la arquitectura del backend como monolito modular
**Descripción:** Confirmar cómo se separan los módulos dentro del backend
(auth, organizations, clients, transactions, invoices, payments,
exchange-rates, arca, bcra, dashboard) y qué puede importar a qué, para
no terminar con todo mezclado.
**Criterios de cierre:**
- [ ] Estructura de carpetas de `backend/src` definida y documentada.
- [ ] Queda claro qué módulo es dueño de qué entidad.
**Prioridad:** P0
**Área:** Backend, Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F2-4] Inicializar el proyecto de backend
**Descripción:** Levantar el esqueleto de Express + TypeScript según la
estructura de módulos definida, con la configuración base (tsconfig,
linter, variables de entorno, conexión a la base).
**Criterios de cierre:**
- [ ] `npm run dev` levanta el servidor sin errores.
- [ ] Existe un endpoint de salud (`/health`).
- [ ] La estructura de carpetas sigue lo definido en F2-3.
**Prioridad:** P0
**Área:** Backend
**Dependencias:** Definir la arquitectura del backend como monolito modular.

### [F2-5] Inicializar el proyecto de frontend
**Descripción:** Levantar el esqueleto de React + Vite + TypeScript +
Tailwind, con el router y la estructura de carpetas base para ir
agregando pantallas.
**Criterios de cierre:**
- [ ] `npm run dev` levanta la app sin errores.
- [ ] Tailwind funciona (una clase de prueba se ve aplicada).
- [ ] Hay pantallas placeholder para login y dashboard.
**Prioridad:** P0
**Área:** Frontend
**Dependencias:** Sin dependencia bloqueante.

### [F2-6] Modelar el schema de Prisma
**Descripción:** Traducir el DER y el diccionario de datos a
`schema.prisma`, con los modelos, relaciones y enums (tipo de movimiento,
estado de factura, etc.).
**Criterios de cierre:**
- [ ] `schema.prisma` incluye todas las entidades del núcleo.
- [ ] La relación Invoice 1:N Payment y Payment → Transaction queda explícita.
- [ ] `prisma validate` no tira errores.
**Prioridad:** P0
**Área:** Base de datos, Backend
**Dependencias:** Escribir el diccionario de datos; Inicializar el proyecto de backend.

### [F2-7] Configurar la base de datos y correr la primera migración
**Descripción:** Levantar PostgreSQL (local o en Railway/Supabase) y
correr la migración inicial de Prisma para tener las tablas creadas.
**Criterios de cierre:**
- [ ] `prisma migrate dev` corre sin errores contra una base real.
- [ ] Las tablas del núcleo existen en la base.
**Prioridad:** P0
**Área:** Base de datos, DevOps
**Dependencias:** Modelar el schema de Prisma.

### [F2-8] Armar los seeds de datos de prueba
**Descripción:** Script que cargue datos de ejemplo (un usuario, una
organización, clientes, categorías) para no tener que cargar todo a mano
cada vez que se resetea la base.
**Criterios de cierre:**
- [ ] Un comando corre el seed y deja datos usables.
- [ ] El seed no rompe si se corre dos veces.
**Prioridad:** P1
**Área:** Base de datos
**Dependencias:** Configurar la base de datos y correr la primera migración.

---

## Fase 3 — Vertical funcional inicial

Meta de la fase: **login → organización → cliente → movimiento →
dashboard** funcionando de punta a punta.

### [F3-1] Armar el registro e inicio de sesión
**Descripción:** Endpoint y pantalla para registrarse, loguearse y
cerrar sesión, con contraseña hasheada y JWT.
**Criterios de cierre:**
- [ ] Un usuario nuevo se puede registrar.
- [ ] El login devuelve un JWT válido.
- [ ] Las contraseñas se guardan con bcrypt/Argon2, nunca en texto plano.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Inicializar el proyecto de backend; Inicializar el proyecto de frontend; Configurar la base de datos y correr la primera migración.

### [F3-2] Proteger los endpoints privados con JWT
**Descripción:** Middleware que valide el token en cada request y que
asegure que un usuario no pueda ver datos de otra organización.
**Criterios de cierre:**
- [ ] Un request sin token a un endpoint privado devuelve 401.
- [ ] Un usuario no puede acceder a datos de otra organización aunque adivine el ID.
**Prioridad:** P0
**Área:** Backend, Testing
**Dependencias:** Armar el registro e inicio de sesión.

### [F3-3] Pantalla y endpoint para editar el perfil de usuario
**Descripción:** Que el usuario pueda ver y modificar sus datos básicos
(nombre, email, contraseña) una vez logueado.
**Criterios de cierre:**
- [ ] Se puede editar el perfil sin volver a loguearse.
- [ ] Cambiar la contraseña pide la actual.
**Prioridad:** P1
**Área:** Backend, Frontend
**Dependencias:** Armar el registro e inicio de sesión.

### [F3-4] Crear el perfil fiscal de la organización (Organization)
**Descripción:** Al loguearse por primera vez, el usuario tiene que poder
cargar los datos de su actividad: CUIT, razón social, condición fiscal y
moneda base.
**Criterios de cierre:**
- [ ] Se puede crear y editar la Organization del usuario.
- [ ] La moneda base queda guardada y no se puede dejar vacía.
- [ ] Un usuario sin Organization no puede avanzar a cargar clientes o movimientos.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Proteger los endpoints privados con JWT.

### [F3-5] CRUD de actividades del monotributista (Activity)
**Descripción:** Permitir cargar las actividades bajo las que factura
(por ejemplo "venta de indumentaria" o "desarrollo de software"), que
después se usan para clasificar facturas e ítems.
**Criterios de cierre:**
- [ ] Se puede crear, editar y listar actividades de la organización.
- [ ] Una organización puede tener más de una actividad.
- [ ] Queda modelado que una actividad puede ser de productos, servicios o ambas.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Crear el perfil fiscal de la organización.

### [F3-6] CRUD de puntos de venta (PointOfSale)
**Descripción:** Cargar el o los puntos de venta habilitados en ARCA,
que más adelante van a ser obligatorios para emitir cualquier
comprobante.
**Criterios de cierre:**
- [ ] Se puede crear y listar puntos de venta de la organización.
- [ ] El número de punto de venta es obligatorio y único por organización.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Crear el perfil fiscal de la organización.

### [F3-7] CRUD de clientes
**Descripción:** Alta, edición, búsqueda y baja lógica de clientes, con
sus datos básicos (nombre/razón social, CUIT/CUIL, condición fiscal,
contacto).
**Criterios de cierre:**
- [ ] Se puede crear, editar, buscar y dar de baja un cliente.
- [ ] La baja es lógica, no borra el registro.
- [ ] Un cliente dado de baja no aparece en el buscador por defecto, pero se puede consultar su historial.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Crear el perfil fiscal de la organización.

### [F3-8] Historial de operaciones por cliente
**Descripción:** Pantalla donde, al entrar a un cliente, se vean sus
movimientos y —más adelante— sus facturas y pagos.
**Criterios de cierre:**
- [ ] Se ve una lista de movimientos asociados al cliente.
- [ ] Se puede filtrar por fecha.
**Prioridad:** P1
**Área:** Backend, Frontend
**Dependencias:** CRUD de clientes.

### [F3-9] CRUD de categorías
**Descripción:** Crear categorías para clasificar ingresos y egresos
(por ejemplo "venta de productos", "alquiler", "servicios contratados").
**Criterios de cierre:**
- [ ] Se puede crear, editar y listar categorías.
- [ ] Cada categoría tiene un tipo asociado (ingreso, egreso, o ambos).
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Crear el perfil fiscal de la organización.

### [F3-10] Registrar ingresos y egresos a mano (Transaction)
**Descripción:** El corazón de la vertical inicial: cargar un movimiento
con tipo, importe, moneda, categoría, fecha y cliente opcional, sin pasar
todavía por una factura.
**Criterios de cierre:**
- [ ] Se puede registrar un ingreso y un egreso.
- [ ] El importe no puede ser negativo.
- [ ] La moneda es obligatoria y, si no es la moneda base, se guarda el tipo de cambio usado.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** CRUD de categorías; CRUD de clientes.

### [F3-11] Filtros e historial de movimientos
**Descripción:** Ver la lista de movimientos filtrando por período, tipo
y categoría, para no tener que scrollear todo.
**Criterios de cierre:**
- [ ] Se puede filtrar por rango de fechas.
- [ ] Se puede filtrar por tipo y por categoría, combinados.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Registrar ingresos y egresos a mano.

### [F3-12] Armar el dashboard con lo mínimo
**Descripción:** Pantalla que muestre ingresos y egresos del período
elegido y el resultado (ingresos menos egresos), cerrando la vertical
login → organización → cliente → movimiento → dashboard.
**Criterios de cierre:**
- [ ] Se ve el total de ingresos y egresos del período.
- [ ] Se ve el resultado neto.
- [ ] Los números coinciden con los movimientos cargados (se valida a mano).
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Filtros e historial de movimientos.

---

## Fase 4 — Multimoneda y BCRA

### [F4-1] Definir qué cotización usamos para gestión
**Descripción:** Antes de programar nada, decidir de qué fuente sacamos
el tipo de cambio para uso interno (dashboard, conversión de
movimientos), y dejar claro que es una decisión distinta de la cotización
que se va a usar al facturar fiscalmente.
**Criterios de cierre:**
- [ ] Queda escrito qué cotización se usa para gestión (oficial, blue, mayorista) y por qué.
- [ ] Queda explícito que esta decisión no aplica a la cotización fiscal de ARCA.
**Prioridad:** P0
**Área:** Investigación, Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F4-2] Investigar y probar la API del BCRA
**Descripción:** Meterse en la documentación de la API oficial del BCRA,
entender qué endpoints hay disponibles y probar una consulta real antes
de integrarla al backend.
**Criterios de cierre:**
- [ ] Se identifica el endpoint que da la cotización elegida en F4-1.
- [ ] Se hace al menos una llamada de prueba exitosa (Postman o script).
**Prioridad:** P0
**Área:** Investigación, BCRA
**Dependencias:** Definir qué cotización usamos para gestión.

### [F4-3] Integrar la consulta de cotizaciones del BCRA al backend
**Descripción:** Módulo que llame a la API del BCRA, guarde el resultado
con la fecha de actualización y lo exponga para usarlo al registrar
movimientos.
**Criterios de cierre:**
- [ ] Un endpoint propio devuelve la cotización actual.
- [ ] La consulta se cachea, no se pega a la API en cada request.
- [ ] Si el BCRA no responde, el sistema no se cae.
**Prioridad:** P0
**Área:** Backend, BCRA
**Dependencias:** Investigar y probar la API del BCRA.

### [F4-4] Usar la cotización del BCRA al registrar movimientos
**Descripción:** Al cargar un movimiento en una moneda distinta a la
base, traer automáticamente la cotización del día en vez de tipearla a
mano.
**Criterios de cierre:**
- [ ] Al elegir otra moneda, se sugiere la cotización actual.
- [ ] El usuario puede sobreescribirla.
- [ ] El tipo de cambio queda guardado en el movimiento, no se recalcula después.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Integrar la consulta de cotizaciones del BCRA al backend; Registrar ingresos y egresos a mano.

### [F4-5] Confirmar que modificar la cotización actual no toca movimientos viejos
**Descripción:** Escribir un test que pruebe que, si la cotización de hoy
cambia, los movimientos ya registrados con la de ayer no se alteran.
**Criterios de cierre:**
- [ ] Existe un test automático para este caso.
- [ ] Queda documentado en las reglas de negocio.
**Prioridad:** P0
**Área:** Testing, Backend
**Dependencias:** Usar la cotización del BCRA al registrar movimientos.

### [F4-6] Mostrar los montos multimoneda convertidos en el dashboard
**Descripción:** Que el dashboard sume todo a la moneda base usando el
tipo de cambio histórico de cada movimiento, para que el resultado del
período tenga sentido aunque haya ingresos en dólares y en pesos.
**Criterios de cierre:**
- [ ] El dashboard convierte y suma todo en la moneda base.
- [ ] Un movimiento en USD se refleja con su propio tipo de cambio histórico, no el actual.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Confirmar que modificar la cotización actual no toca movimientos viejos; Armar el dashboard con lo mínimo.

---

## Fase 5 — Spike técnico ARCA

### [F5-1] Conseguir el certificado de homologación de ARCA
**Descripción:** Tramitar o generar el certificado y la clave privada
para autenticarse contra el ambiente de homologación (WSAA), el primer
paso obligatorio antes de hablar con cualquier otro servicio.
**Criterios de cierre:**
- [ ] El certificado y la clave están generados.
- [ ] Quedan guardados fuera del repositorio (nunca committeados).
**Prioridad:** P0
**Área:** ARCA, Investigación
**Dependencias:** Sin dependencia bloqueante.

### [F5-2] Implementar la autenticación WSAA
**Descripción:** Armar el llamado que firma el login ticket request
(TRA), lo manda a WSAA y recibe el ticket de acceso (token y sign).
**Criterios de cierre:**
- [ ] Se obtiene un ticket de acceso válido contra homologación.
- [ ] El ticket se guarda con su fecha de expiración.
- [ ] Hay manejo de error si el certificado está vencido o mal formado.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Conseguir el certificado de homologación de ARCA.

### [F5-3] Renovar el ticket de acceso automáticamente
**Descripción:** El ticket de WSAA vence, así que hay que cachearlo y
renovarlo solo cuando esté por vencer, en vez de pedirlo en cada llamada.
**Criterios de cierre:**
- [ ] El sistema reutiliza el ticket mientras sea válido.
- [ ] Se renueva automáticamente antes de vencer.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Implementar la autenticación WSAA.

### [F5-4] Hacer la primera llamada válida a WSFEv1
**Descripción:** Con el ticket de acceso funcionando, probar el método
más simple de WSFEv1 (por ejemplo, consultar el último comprobante
autorizado) para confirmar que toda la cadena funciona de punta a punta.
**Criterios de cierre:**
- [ ] Se obtiene una respuesta válida de WSFEv1 en homologación.
- [ ] Queda un ejemplo guardado (request y response) para referencia del equipo.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Renovar el ticket de acceso automáticamente.

### [F5-5] Definir el plan B si ARCA se atrasa
**Descripción:** Con lo aprendido en el spike, decidir qué pasa si
integrar ARCA completo lleva más tiempo del planeado: qué queda como P0
igual (el modelo de Invoice sin CAE, por ejemplo) y qué se puede mover a
P1.
**Criterios de cierre:**
- [ ] Queda una lista escrita de qué funcionalidades pasan a P1 si hace falta.
- [ ] La decisión está acordada entre los tres.
**Prioridad:** P0
**Área:** Documentación, ARCA
**Dependencias:** Hacer la primera llamada válida a WSFEv1.

---

## Fase 6 — Facturación completa

### [F6-1] CRUD de facturas sin ARCA todavía (Invoice + InvoiceItem)
**Descripción:** Crear una factura con uno o más ítems, calculando
subtotales y total, guardada como borrador antes de mandarla a autorizar.
**Criterios de cierre:**
- [ ] Se puede crear una factura con al menos un ítem.
- [ ] El sistema calcula subtotales y total solo.
- [ ] Una factura sin ítems no se puede guardar.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** CRUD de puntos de venta; CRUD de clientes.

### [F6-2] Definir los estados de una factura
**Descripción:** Modelar el ciclo de vida: borrador, pendiente de
autorización, autorizada, rechazada. Una vez rechazada o autorizada, no
puede volver para atrás.
**Criterios de cierre:**
- [ ] Los estados posibles están definidos en el schema (enum).
- [ ] Las transiciones inválidas están bloqueadas en el backend, no solo en el frontend.
**Prioridad:** P0
**Área:** Backend, Documentación
**Dependencias:** CRUD de facturas sin ARCA todavía.

### [F6-3] Resolver el concepto: productos, servicios o ambos
**Descripción:** WSFEv1 pide saber si la factura es por productos,
servicios o ambas cosas, y eso cambia algunos campos obligatorios (como
las fechas de servicio). Definir cómo lo resolvemos según la actividad y
los ítems cargados.
**Criterios de cierre:**
- [ ] Queda definida la regla para decidir el concepto de la factura.
- [ ] El caso "productos y servicios" está contemplado, no solo los dos extremos.
**Prioridad:** P0
**Área:** ARCA, Documentación
**Dependencias:** CRUD de actividades del monotributista; Definir los estados de una factura.

### [F6-4] Armar el tipo de comprobante Factura C
**Descripción:** Para el P0 alcanza con Factura C (monotributista a
cualquier receptor). Dejar el modelo preparado para otros tipos más
adelante, pero implementar y probar solo este.
**Criterios de cierre:**
- [ ] Se puede armar (en borrador) una Factura C con los datos mínimos que pide ARCA.
- [ ] El tipo de comprobante queda como un campo, no hardcodeado en la lógica.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Resolver el concepto: productos, servicios o ambos.

### [F6-5] No asumir que los ítems internos son 1:1 con lo que se manda a WSFEv1
**Descripción:** WSFEv1 en varios casos solo pide el importe total del
comprobante, no el detalle de ítems. Separar el modelo interno de
InvoiceItem (que sí queremos guardar para nuestros reportes) de lo que
efectivamente viaja en el request a ARCA.
**Criterios de cierre:**
- [ ] Queda documentada la diferencia entre InvoiceItem interno y el payload de WSFEv1.
- [ ] La función que arma el request a ARCA no asume una relación 1:1 automática.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Armar el tipo de comprobante Factura C.

### [F6-6] Guardar snapshot histórico del receptor en cada factura
**Descripción:** Al crear la factura, copiar los datos del cliente
(nombre, CUIT, condición fiscal) dentro de la factura misma, para que si
el cliente cambia esos datos después, la factura vieja no se altere.
**Criterios de cierre:**
- [ ] La factura guarda su propia copia de los datos del receptor.
- [ ] Cambiar los datos del cliente no modifica facturas ya emitidas.
**Prioridad:** P0
**Área:** Backend, Base de datos
**Dependencias:** CRUD de facturas sin ARCA todavía; Definir qué pasa con los datos de una factura ya autorizada.

### [F6-7] Generar un Payment y como máximo un Transaction por cada pago
**Descripción:** Implementar el flujo definido en F1-5: registrar un pago
contra una factura genera un movimiento de ingreso, nunca más de uno, y
el saldo pendiente de la factura se recalcula solo.
**Criterios de cierre:**
- [ ] Registrar un pago crea exactamente un Transaction de tipo ingreso.
- [ ] El saldo pendiente de la factura baja en la misma proporción.
- [ ] Registrar dos pagos parciales no duplica ingresos (test automático).
**Prioridad:** P0
**Área:** Backend, Testing
**Dependencias:** CRUD de facturas sin ARCA todavía; Diseñar cómo funcionan los pagos parciales sin duplicar ingresos.

### [F6-8] Pantalla de pagos de una factura
**Descripción:** Ver, desde una factura, cuánto se cobró, cuánto falta y
cargar un pago nuevo sin salir de esa pantalla.
**Criterios de cierre:**
- [ ] Se ve el saldo pendiente actualizado.
- [ ] Se puede cargar un pago parcial o total desde ahí.
**Prioridad:** P0
**Área:** Frontend
**Dependencias:** Generar un Payment y como máximo un Transaction por cada pago.

### [F6-9] Agregar al dashboard la diferencia entre facturado y cobrado
**Descripción:** El dashboard tiene que distinguir cuánto se facturó en
el período de cuánto efectivamente se cobró, que son cosas distintas por
definición del dominio.
**Criterios de cierre:**
- [ ] El dashboard muestra ambos números por separado.
- [ ] La diferencia surge de datos reales, no de una resta manual.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Mostrar los montos multimoneda convertidos en el dashboard; Generar un Payment y como máximo un Transaction por cada pago.

### [F6-10] Guardar el campo para el CAE y su vencimiento
**Descripción:** Preparar en el modelo el lugar donde va a quedar el CAE
y su fecha de vencimiento una vez que ARCA autorice la factura (todavía
sin integración real, eso es Fase 7).
**Criterios de cierre:**
- [ ] El modelo tiene los campos de CAE y vencimiento.
- [ ] Una factura sin CAE no se puede marcar como autorizada.
**Prioridad:** P0
**Área:** Backend, Base de datos
**Dependencias:** Definir los estados de una factura.

### [F6-11] Generar el PDF del comprobante
**Descripción:** Armar la plantilla del comprobante (con o sin CAE
todavía) para poder descargarlo o mandarlo al cliente.
**Criterios de cierre:**
- [ ] Se genera un PDF con los datos de la factura.
- [ ] El PDF muestra el CAE y el vencimiento cuando existen, o aclara que es un borrador cuando no.
**Prioridad:** P1
**Área:** Backend, Frontend
**Dependencias:** Guardar el campo para el CAE y su vencimiento.

---

## Fase 7 — Integración ARCA completa

### [F7-1] Armar el servicio que arma y firma el request a WSFEv1
**Descripción:** Encapsular en un solo módulo la construcción del
request de autorización (FECAESolicitar) a partir de una factura en
estado pendiente, reutilizando lo aprendido en el spike.
**Criterios de cierre:**
- [ ] El módulo arma un request válido a partir de una Invoice real.
- [ ] Se prueba contra homologación con al menos una Factura C real.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Hacer la primera llamada válida a WSFEv1; Armar el tipo de comprobante Factura C.

### [F7-2] Guardar el resultado de la autorización
**Descripción:** Al recibir la respuesta de ARCA, guardar si fue
autorizada o rechazada, el CAE y el vencimiento si corresponde, y pasar
la factura al estado correcto.
**Criterios de cierre:**
- [ ] Una factura autorizada queda con su CAE y vencimiento guardados.
- [ ] Una factura rechazada queda marcada como tal, con el motivo.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Armar el servicio que arma y firma el request a WSFEv1; Guardar el campo para el CAE y su vencimiento.

### [F7-3] Manejar los errores de ARCA sin romper la app
**Descripción:** Contemplar los casos en que ARCA no responde, tarda, o
devuelve un error de validación, para que el usuario entienda qué pasó en
vez de ver una pantalla rota.
**Criterios de cierre:**
- [ ] Un timeout de ARCA muestra un mensaje claro, no un error genérico.
- [ ] La factura no queda duplicada si se reintenta el envío.
**Prioridad:** P0
**Área:** ARCA, Backend
**Dependencias:** Guardar el resultado de la autorización.

### [F7-4] Conectar el botón de facturar con ARCA de punta a punta
**Descripción:** Desde el frontend, que crear y autorizar una factura sea
un solo flujo para el usuario, aunque atrás se hagan varias llamadas
(WSAA si hace falta, WSFEv1, guardar resultado).
**Criterios de cierre:**
- [ ] El usuario puede facturar sin saber que existe WSAA.
- [ ] El resultado final (autorizada o rechazada) se ve claro en la pantalla.
**Prioridad:** P0
**Área:** Frontend, ARCA
**Dependencias:** Manejar los errores de ARCA sin romper la app.

### [F7-5] Probar el flujo completo con varios casos reales en homologación
**Descripción:** Facturar varios escenarios distintos (un ítem, varios
ítems, productos, servicios, con y sin CUIT del cliente) contra
homologación para confirmar que no quedó ningún caso raro sin cubrir.
**Criterios de cierre:**
- [ ] Al menos 5 casos distintos probados contra homologación.
- [ ] Cualquier caso que falle tiene su propio issue para arreglarlo.
**Prioridad:** P0
**Área:** ARCA, Testing
**Dependencias:** Conectar el botón de facturar con ARCA de punta a punta.

---

## Fase 8 — Testing, seguridad y estabilidad

### [F8-1] Escribir tests unitarios de la lógica de negocio
**Descripción:** Cubrir con tests las funciones que calculan saldos,
convierten moneda y deciden estados de factura, que son las que más
rompen si alguien las toca sin querer.
**Criterios de cierre:**
- [ ] Los cálculos de pagos parciales tienen test.
- [ ] Los cálculos de multimoneda tienen test.
**Prioridad:** P0
**Área:** Testing, Backend
**Dependencias:** Generar un Payment y como máximo un Transaction por cada pago; Usar la cotización del BCRA al registrar movimientos.

### [F8-2] Escribir tests de los endpoints principales (API)
**Descripción:** Con Supertest, probar que los endpoints de auth,
clientes, movimientos, facturas y pagos responden lo esperado y rechazan
lo que no corresponde.
**Criterios de cierre:**
- [ ] Cada módulo principal tiene al menos un test de éxito y uno de error.
- [ ] Los tests de autorización (401/403) están cubiertos.
**Prioridad:** P0
**Área:** Testing, Backend
**Dependencias:** Proteger los endpoints privados con JWT.

### [F8-3] Armar una colección de Postman para las integraciones externas
**Descripción:** Documentar y dejar probables los llamados reales a BCRA
y ARCA en Postman, para poder probarlos a mano sin levantar todo el
frontend.
**Criterios de cierre:**
- [ ] La colección cubre BCRA y ARCA (WSAA + WSFEv1).
- [ ] Las variables sensibles no quedan hardcodeadas en la colección.
**Prioridad:** P1
**Área:** Testing, ARCA, BCRA
**Dependencias:** Hacer la primera llamada válida a WSFEv1.

### [F8-4] Tests de integración de punta a punta del flujo principal
**Descripción:** Un test que registre un usuario, cree una organización,
un cliente, un movimiento, y verifique que el dashboard refleja bien los
números, todo en un solo recorrido.
**Criterios de cierre:**
- [ ] El test corre contra una base de test, no la de desarrollo.
- [ ] Cubre el flujo login → organización → cliente → movimiento → dashboard.
**Prioridad:** P0
**Área:** Testing
**Dependencias:** Armar el dashboard con lo mínimo; Escribir tests de los endpoints principales.

### [F8-5] Pruebas E2E de los flujos críticos
**Descripción:** Con una herramienta de E2E (o manual guiado si no da el
tiempo), probar el recorrido completo desde el navegador: login, cliente,
movimiento, facturar, cobrar y ver el dashboard.
**Criterios de cierre:**
- [ ] El flujo de facturación y el de pagos parciales están cubiertos.
- [ ] Se documenta cómo correrlos para quien no los escribió.
**Prioridad:** P1
**Área:** Testing
**Dependencias:** Probar el flujo completo con varios casos reales en homologación; Generar un Payment y como máximo un Transaction por cada pago.

### [F8-6] Revisar seguridad básica antes de mostrar el sistema
**Descripción:** Repasar que todo lo privado use HTTPS en producción, que
las contraseñas estén hasheadas, que no haya credenciales de servicios
externos en el código, y que las validaciones de importes/monedas estén
antes de guardar en la base.
**Criterios de cierre:**
- [ ] No hay ningún secreto commiteado en el repo.
- [ ] Todos los endpoints privados exigen JWT.
- [ ] Las validaciones de importe y moneda están del lado del backend.
**Prioridad:** P0
**Área:** Backend, Testing
**Dependencias:** Tests de integración de punta a punta del flujo principal.

### [F8-7] Implementar la auditoría básica
**Descripción:** Registrar en una tabla los eventos importantes (login,
creación de facturas, pagos) con quién y cuándo, para poder rastrear qué
pasó si algo sale mal.
**Criterios de cierre:**
- [ ] Los eventos clave quedan registrados con fecha y usuario.
- [ ] Se puede consultar el historial de una factura puntual.
**Prioridad:** P1
**Área:** Backend
**Dependencias:** Guardar el resultado de la autorización.

### [F8-8] Hacer responsive las pantallas principales
**Descripción:** Que el dashboard, la carga de movimientos y la
facturación se puedan usar razonablemente desde una tablet o el celular.
**Criterios de cierre:**
- [ ] Las pantallas principales no se rompen en un ancho de celular.
- [ ] Los formularios se completan sin scroll horizontal.
**Prioridad:** P1
**Área:** Frontend
**Dependencias:** Conectar el botón de facturar con ARCA de punta a punta.

---

## Fase 9 — Deploy y QA

### [F9-1] Configurar las variables de entorno y los secretos
**Descripción:** Centralizar en variables de entorno todo lo sensible
(conexión a la base, JWT secret, certificados de ARCA, claves de API) y
asegurarse de que nada quede en el repo.
**Criterios de cierre:**
- [ ] Existe un `.env.example` sin valores reales.
- [ ] El `.gitignore` cubre todos los archivos de secretos.
**Prioridad:** P0
**Área:** DevOps
**Dependencias:** Sin dependencia bloqueante.

### [F9-2] Desplegar el backend en Railway
**Descripción:** Dejar el backend corriendo en Railway conectado a la
base online, con las variables de entorno configuradas ahí.
**Criterios de cierre:**
- [ ] El backend responde en una URL pública.
- [ ] Los logs se pueden ver desde Railway.
**Prioridad:** P0
**Área:** DevOps, Backend
**Dependencias:** Configurar las variables de entorno y los secretos.

### [F9-3] Poner la base de datos online
**Descripción:** Migrar de una base local a Railway o Supabase, corriendo
las migraciones de Prisma contra la base real.
**Criterios de cierre:**
- [ ] La base online tiene el mismo schema que la de desarrollo.
- [ ] Las migraciones corren sin intervención manual.
**Prioridad:** P0
**Área:** Base de datos, DevOps
**Dependencias:** Configurar las variables de entorno y los secretos.

### [F9-4] Desplegar el frontend en Cloudflare
**Descripción:** Publicar el build de producción del frontend en
Cloudflare Pages, apuntando al backend ya desplegado.
**Criterios de cierre:**
- [ ] El frontend se ve en una URL pública.
- [ ] Las llamadas al backend funcionan desde ese dominio (CORS configurado).
**Prioridad:** P0
**Área:** DevOps, Frontend
**Dependencias:** Desplegar el backend en Railway.

### [F9-5] Probar el sistema desplegado de punta a punta
**Descripción:** Repetir a mano el recorrido completo (login, cliente,
movimiento, factura, pago, dashboard) contra las URLs desplegadas, no en
local.
**Criterios de cierre:**
- [ ] El flujo completo funciona en el ambiente desplegado.
- [ ] Se prueba con al menos dos usuarios para confirmar el aislamiento entre organizaciones.
**Prioridad:** P0
**Área:** Testing, DevOps
**Dependencias:** Desplegar el frontend en Cloudflare; Poner la base de datos online.

### [F9-6] Hacer una ronda de QA general y anotar bugs
**Descripción:** Recorrer todo el sistema como un usuario nuevo, anotando
cualquier cosa rara, aunque no rompa nada, para priorizar qué arreglar
antes de entregar.
**Criterios de cierre:**
- [ ] Se completa un checklist de QA de las pantallas principales.
- [ ] Cada bug encontrado queda como issue con pasos para reproducirlo.
**Prioridad:** P0
**Área:** Testing
**Dependencias:** Probar el sistema desplegado de punta a punta.

### [F9-7] Corregir los bugs bloqueantes de la ronda de QA
**Descripción:** Resolver los issues marcados como bloqueantes en F9-6
antes de armar la documentación final.
**Criterios de cierre:**
- [ ] No queda ningún bug marcado como bloqueante sin resolver.
- [ ] Se vuelve a probar cada caso puntual después del fix.
**Prioridad:** P0
**Área:** Backend, Frontend
**Dependencias:** Hacer una ronda de QA general y anotar bugs.

---

## Fase 10 — Documentación y entrega final

### [F10-1] Escribir el README completo
**Descripción:** Que cualquiera pueda clonar el repo y levantar el
proyecto local siguiendo el README, sin tener que preguntarnos nada.
**Criterios de cierre:**
- [ ] Incluye cómo instalar dependencias, variables de entorno y cómo correr frontend y backend.
- [ ] Incluye cómo correr migraciones y seeds.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Sin dependencia bloqueante.

### [F10-2] Documentar la arquitectura final
**Descripción:** Completar el documento de arquitectura con cómo quedó
realmente el sistema, no solo cómo se planeó al principio.
**Criterios de cierre:**
- [ ] Incluye el diagrama de módulos del backend actualizado.
- [ ] Incluye las decisiones que cambiaron durante el desarrollo y por qué.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Corregir los bugs bloqueantes de la ronda de QA.

### [F10-3] Documentar la API
**Descripción:** Dejar documentado cada endpoint (método, parámetros,
respuesta) para que sirva de referencia interna y para la defensa.
**Criterios de cierre:**
- [ ] Todos los endpoints públicos del backend están documentados.
- [ ] Incluye ejemplos de request y response reales.
**Prioridad:** P1
**Área:** Documentación
**Dependencias:** Documentar la arquitectura final.

### [F10-4] Armar los diagramas finales
**Descripción:** Dejar el DER actualizado con los cambios que hubo
durante el desarrollo, más un diagrama de arquitectura general.
**Criterios de cierre:**
- [ ] El DER refleja el `schema.prisma` real, no el de la propuesta inicial.
- [ ] Hay un diagrama de arquitectura (frontend, backend, base, integraciones).
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Documentar la arquitectura final.

### [F10-5] Escribir el informe final
**Descripción:** El documento que resume todo el trabajo: qué se hizo,
qué quedó afuera y por qué, y cómo se resolvieron las correcciones de la
primera entrega.
**Criterios de cierre:**
- [ ] Responde explícitamente cada corrección de la devolución del docente.
- [ ] Incluye qué quedó en P0 y qué se movió a P1, con la razón.
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Armar los diagramas finales; Documentar la API.

### [F10-6] Grabar el video o demo del sistema
**Descripción:** Si la cátedra lo pide, grabar un recorrido corto
mostrando el flujo completo funcionando en el ambiente desplegado.
**Criterios de cierre:**
- [ ] El video muestra el flujo login → organización → cliente → factura → pago → dashboard.
- [ ] Dura lo que pide la consigna.
**Prioridad:** P1
**Área:** Documentación
**Dependencias:** Probar el sistema desplegado de punta a punta.

### [F10-7] Preparar la defensa oral
**Descripción:** Repartir entre los tres qué parte explica cada uno, y
ensayar las preguntas más probables (por qué esta arquitectura, cómo
funciona ARCA, qué haríamos distinto).
**Criterios de cierre:**
- [ ] Cada integrante sabe explicar de punta a punta al menos su parte.
- [ ] Hay respuesta preparada para "por qué esto quedó en P1 y no en P0".
**Prioridad:** P0
**Área:** Documentación
**Dependencias:** Escribir el informe final.

### [F10-8] Revisión final del repositorio y de los entregables
**Descripción:** Último repaso antes de entregar: que el repo esté
limpio, sin ramas colgadas raras, sin secretos, y que todos los
documentos pedidos estén en `docs/`.
**Criterios de cierre:**
- [ ] No queda ningún secreto o certificado commiteado.
- [ ] Todos los documentos de la consigna están presentes y linkeados desde el README.
**Prioridad:** P0
**Área:** Documentación, DevOps
**Dependencias:** Preparar la defensa oral.

---

## P1 — Funcionalidades que pueden postergarse

### [P1-1] Consultar la Central de Deudores del BCRA
**Descripción:** Traer información de riesgo crediticio de un cliente por
CUIT, como dato adicional en su ficha, no como bloqueante para nada del
flujo principal.
**Criterios de cierre:**
- [ ] Se puede consultar desde la ficha del cliente.
- [ ] La consulta queda guardada con fecha (FinancialInquiry).
- [ ] Si el servicio no responde, no afecta el resto del sistema.
**Prioridad:** P1
**Área:** Backend, BCRA
**Dependencias:** CRUD de clientes.

### [P1-2] Enviar facturas y recordatorios por WhatsApp (Kapso)
**Descripción:** Módulo de notificaciones desacoplado que, cuando esté
listo, mande la factura o un recordatorio de pago al cliente por
WhatsApp.
**Criterios de cierre:**
- [ ] Se puede mandar un mensaje de prueba a un número real.
- [ ] El módulo no bloquea el resto del sistema si Kapso no responde.
**Prioridad:** P1
**Área:** Backend
**Dependencias:** Generar un Payment y como máximo un Transaction por cada pago.

### [P1-3] Soportar otros tipos de comprobante además de Factura C
**Descripción:** Extender el modelo de facturación para Factura A y B,
para monotributistas que en algún momento necesiten emitirlas.
**Criterios de cierre:**
- [ ] El tipo de comprobante es configurable, no hardcodeado a C.
- [ ] Se prueba al menos un caso de Factura B en homologación.
**Prioridad:** P2
**Área:** ARCA, Backend
**Dependencias:** Armar el tipo de comprobante Factura C.

### [P1-4] Reportes de gestión exportables
**Descripción:** Poder exportar el resumen del período (lo que ya se ve
en el dashboard) a PDF o Excel, para que el monotributista se lo lleve a
su contador.
**Criterios de cierre:**
- [ ] Se puede exportar el período actual a PDF o Excel.
- [ ] El archivo incluye los mismos números que el dashboard.
**Prioridad:** P2
**Área:** Backend, Frontend
**Dependencias:** Agregar al dashboard la diferencia entre facturado y cobrado.

---

## Camino crítico

Esta es la cadena que no se puede atrasar sin atrasar todo lo demás:

1. **Relevamiento de usuarios → ajuste del P0** (F1-1, F1-2). Sin esto no
   hay base sólida para armar el DER.
2. **Cierre del dominio**: factura/pago/movimiento, reglas de negocio,
   pagos parciales, snapshot histórico (F1-3 a F1-6). Todo lo que sigue
   depende de que los tres estemos de acuerdo en esto.
3. **DER → diccionario de datos → schema de Prisma → migración**
   (F2-1, F2-2, F2-6, F2-7). Sin esto no se escribe una línea real de
   backend.
4. **La vertical inicial**: auth → organización → (actividades, puntos de
   venta, clientes, categorías) → movimientos → dashboard (F3-1 a F3-12).
   Cada eslabón depende literalmente del anterior.
5. **El modelo de facturación que pidió el docente**: Invoice/InvoiceItem
   → estados de factura → snapshot del receptor → Payment/Transaction sin
   duplicar ingresos (F6-1, F6-2, F6-6, F6-7). No puede esperar a que
   termine toda la Fase 6 — es lo primero que hay que mostrar en la
   próxima entrega.
6. **El spike de ARCA**: certificado → WSAA → ticket de acceso → primera
   llamada a WSFEv1 (F5-1 a F5-4). Es una cadena aparte del dominio, pero
   tiene que arrancar temprano y en paralelo, porque si ARCA da
   problemas necesitamos tiempo para reaccionar (de ahí F5-5, el plan B).
7. **Integración ARCA completa** (Fase 7) depende de haber cerrado tanto
   el spike (6) como el modelo de facturación (5).
8. **Testing, deploy y QA** (Fases 8 y 9) no arrancan en serio hasta que
   el flujo principal esté relativamente estable.

## Trabajo paralelo

Una vez cerrado el dominio (Fase 1) y lista la vertical inicial
(Fase 3), hay margen real para que los tres trabajen sin pisarse:

- **Persona A** — Multimoneda y BCRA (Fase 4), y después el arranque de
  reportes exportables (P1-4) si da el tiempo.
- **Persona B** — Facturación (Fase 6): el modelo de Invoice/Payment se
  puede construir sin esperar a que ARCA esté resuelto, porque hasta la
  Fase 7 no hace falta la integración real.
- **Persona C** — Spike de ARCA (Fase 5) de punta a punta. Conviene que
  lo lleve una sola persona sin cortes, porque es la parte más incierta
  y con más ida y vuelta con documentación externa.

Otros momentos para paralelizar:

- El **relevamiento de usuarios** (Fase 1) se puede repartir entre los
  tres desde el día uno — cada uno entrevista a los suyos.
- En **Fase 3**, actividades (F3-5), puntos de venta (F3-6), clientes
  (F3-7) y categorías (F3-9) no dependen entre sí — se pueden repartir en
  paralelo apenas existe Organization (F3-4).
- En **Fase 8** (testing), cada uno puede escribir los tests del módulo
  que programó, en vez de que uno solo escriba todos.

## Definition of Done de la Entrega 2

- [ ] Relevamiento con usuarios reales hecho, con el P0 confirmado o
      ajustado por escrito.
- [ ] Factura, pago y movimiento definidos por escrito como conceptos
      distintos, con las reglas de negocio (incluyendo pagos parciales y
      snapshot histórico) documentadas y acordadas entre los tres.
- [ ] DER inicial completo, con Invoice, InvoiceItem, Payment y
      Transaction correctamente relacionados.
- [ ] Diccionario de datos escrito.
- [ ] Schema de Prisma modelado y migrado contra una base real.
- [ ] Vertical funcionando de punta a punta: login → organización →
      cliente → movimiento → dashboard.
- [ ] Cotización para gestión definida, anotada como decisión distinta de
      la cotización fiscal.
- [ ] Modelo de Invoice/Payment/Transaction implementado, con pagos
      parciales probados y sin duplicar ingresos.
- [ ] Spike de ARCA avanzado: certificado + WSAA + ticket de acceso,
      idealmente con una llamada válida a WSFEv1 lograda.
- [ ] Plan B de ARCA documentado, con lo que pasaría a P1 si se atrasa.
- [ ] Backlog completo cargado en GitHub Projects.
