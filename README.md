# Sistema de Gestión — Iglesia Pentecostal Triunfante La Nueva Jerusalén

<img src="public/img/logo-128.png" alt="Emblema de la iglesia" width="110" align="right" />

Sistema web integral para administrar **varias iglesias** desde un solo lugar. Incluye 15 módulos completos, control de usuarios con roles y permisos, alcance multi-iglesia, carga de archivos, impresión de certificados / credenciales / actas y un panel de control con indicadores.

## Identidad institucional

El emblema de la iglesia se usa en la pantalla de acceso, el menú, el ícono de la aplicación y los documentos impresos (certificados, credenciales y actas). Los colores del sistema —azul `#16265c` y dorado `#e8b52c`— se tomaron del propio emblema.

Los archivos están en `public/img/logo.png` (con fondo transparente) y `public/icons/`. Para cambiarlos, reemplace esas imágenes; el nombre y el lema se editan en la constante `IGLESIA` al inicio de `public/app.js`.

## Módulos incluidos

| Grupo | Módulos |
|---|---|
| **Organización** | Iglesias (matriz, sedes, locales y anexos, con su foto, su historial y sus documentos) · Pastores / Guías (con su historial ministerial y sus documentos) · Cuerpos / Grupos (con su foto, sus integrantes por estado, sus cuotas, su tesorería y sus actas) · Directivas de Cuerpos |
| **Servicios** | Registro de Servicios (cultos: salmo, mensaje, asistencia y ofrenda) |
| **Personas** | Miembros · Bitácora de Miembros · Documentos de Miembros |
| **Asistencia** | Asistencia: calendario, actividades, toma de lista e informes en una sola pantalla, pensada para el teléfono |
| **Finanzas** | Cuentas de Tesorería (corporación e iglesias) · Tesorería (ingresos/egresos con resumen y balance) · Traspasos entre Cuentas · Ayudas Sociales · Inventarios (de iglesia y de cuerpos) |
| **Documentación** | Actas de Reuniones de Cuerpos · Actas de Asambleas · Documentos · Certificados · Credenciales · Solicitudes |
| **Administración** | Usuarios (roles y permisos) |

Todos los módulos tienen: listado con búsqueda, filtros, ordenamiento y paginación; formularios generados automáticamente; y (donde aplica) filtro por rango de fechas, adjuntos y vista de impresión.

## Requisitos

- Node.js 18 o superior

## Instalación y arranque

```bash
npm install
npm start          # inicia en http://localhost:3000
# o en desarrollo (reinicio automático al editar):
npm run dev
```

Al primer arranque se crean automáticamente:

- **Usuario administrador**: RUT `11.111.111-1` / contraseña `admin123` → **cambiar la contraseña de inmediato** (módulo Usuarios).
- Una iglesia de ejemplo ("Iglesia Central").

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DATA_DIR` | `./data` | Carpeta de la base de datos SQLite y archivos subidos |
| `JWT_SECRET` | (insegura) | **Definir en producción**: clave para firmar sesiones |

La base de datos es un único archivo SQLite (`data/iglesias.db`); para respaldar el sistema basta copiar la carpeta `data/`.

## Acceso por RUT

El identificador de acceso es el **RUT**, no el correo: no cambia y es único por persona (el correo es solo un dato de contacto opcional). Se puede escribir con o sin puntos —`12.345.678-5`, `12345678-5` o `123456785` son equivalentes— y el sistema valida el **dígito verificador** e impide RUT repetidos.

> Cuentas creadas antes de este cambio que aún no tengan RUT pueden seguir entrando con su correo hasta que se les asigne uno desde el módulo Usuarios (el servidor lo avisa al iniciar).

**Miembros y Pastores** también se identifican por RUT, con la misma validación y sin repetidos (evita registrar dos veces a la misma persona). En la ficha del pastor, para quien todavía no tenga RUT —un extranjero recién llegado, por ejemplo— existe además el campo *Otro documento (pasaporte / extranjero)*.

Al actualizar un sistema que ya tenía datos, los valores del antiguo campo "Documento de identidad" se convierten solos: los que son RUT válidos pasan al campo RUT y el resto se conserva en *Otro documento*. La conversión se informa al iniciar y no repite trabajo.

## Importar datos desde otro sistema o desde Excel 📥

Cada módulo tiene el botón **⬆️ Importar** (junto a "Nuevo"), que carga datos masivamente desde un archivo **CSV**:

1. **Descargar plantilla** — genera un CSV con las columnas correctas del módulo.
2. **Elegir el archivo** — se aceptan separadores `,` `;` o tabulador, con o sin comillas, en UTF-8.
3. **Indicar a qué campo corresponde cada columna** — el sistema propone la correspondencia comparando los encabezados; se puede corregir a mano y descartar columnas que no interesen.
4. **Revisar** — valida todo *sin guardar nada* e informa fila por fila qué está mal.
5. **Importar** — guarda solo las filas correctas; las que tienen problemas se omiten y quedan listadas para corregirlas y reintentar.

Facilidades pensadas para archivos venidos de otros sistemas:

| Dato | Cómo se acepta |
|---|---|
| Relaciones (iglesia, cuerpo, miembro…) | Por **nombre** ("Iglesia Central") o por número interno |
| Varias relaciones (integrantes, asistentes) | Separados por `\|` o `;` — "Juan Pérez\|Ana Soto" |
| Fechas | `dd/mm/aaaa` o `aaaa-mm-dd` |
| Montos | `1.250.500`, `45.990,50`, `$ 25.000` o `1234.56` |
| Sí/No | sí, si, no, 1, 0, true, false, x |
| RUT | Con o sin puntos; se valida el dígito verificador |

Límite: 5.000 filas por archivo (divida el archivo si tiene más). La importación se hace dentro de una transacción: si algo falla a mitad de camino, no queda información a medias.

**Si el sistema de origen no exporta CSV**, casi siempre se puede: copiar la tabla en pantalla y pegarla en Excel o Google Sheets, y desde ahí *Guardar como CSV*.

### Traer los datos completos del sistema anterior 🚚

Para el traspaso desde el sistema que la iglesia usaba antes hay una importación aparte, en `server/importacion/`, que no pasa por CSV: lee la exportación completa y la traduce módulo por módulo, en el orden en que se pueden escribir sin romper vínculos.

Se maneja desde la propia aplicación, sin consola: **Configuración → 🚚 Traspaso desde el sistema anterior**, al pie de la pantalla y solo para el administrador. Ahí se **sube el volcado** del sistema antiguo —que queda junto a la base de datos, no dentro del programa: una versión publicada no lleva adentro los datos de nadie—, se ve qué trae el archivo comparado con lo que hay hoy, y se hacen los cinco pasos en orden:

1. **Descargar respaldo** de la base completa.
2. **Ver qué hay hoy** y, si es todo de prueba, dejar la base como nueva.
3. **Ensayo**: hace todo el trabajo y lo deshace al final.
4. **Importar**.
5. **Ver el informe** y guardarlo.

Tres resguardos van puestos ahí: importar de verdad exige el **modo mantenimiento activo** y haber corrido antes el **ensayo**, y vaciar la base pide escribir la palabra completa. Terminado el traspaso, el informe queda guardado en el servidor y el archivo de origen se puede sacar: la pantalla sigue mostrando lo que se trajo y el informe de aquel día.

También se puede correr desde la consola, con el volcado a mano:

```bash
node server/importacion/correr.js --datos <archivo.json> --prueba   # ensayo
node server/importacion/correr.js --datos <archivo.json>            # de verdad
node server/importacion/informe.js --datos <archivo.json>           # la verificación
```

Reglas que valen para todos los módulos:

- **Todo o nada.** Cada módulo se importa dentro de una transacción: si algo no cuadra —un dato obligatorio vacío, una referencia que no resuelve, un código que no se sabe traducir—, se detiene y no deja nada a medias. Prefiere parar y preguntar antes que guardar un valor que no corresponde.
- **Idempotente.** Cada fila del origen queda anotada en una tabla de equivalencias con su id de allá y su id de acá. Correr la importación dos veces no duplica nada: la segunda vez actualiza.
- **Nada se inventa.** Un RUT con el dígito cambiado no se «corrige» —se conserva y queda anotado en el historial de esa persona—, y un archivo que no llegó no deja la ficha apuntando al vacío: su ruta espera en la lista de pendientes.
- **Se informa lo que no se pudo traer.** El informe final cuenta las dos bases módulo por módulo, revisa las relaciones y deja por escrito qué quedó fuera y por qué.

## Bajar cualquier listado a una planilla 📤

Todo listado tiene, en su barra, **⬇️ Excel**. Baja **lo que se está viendo, pero entero**: respeta la búsqueda, los filtros, el rango de fechas y el orden que estén puestos, y trae todas las filas, no la página que se muestra en pantalla. Quien pide una nómina la quiere completa.

Van **todos los datos de la ficha**, no solo las columnas que caben en pantalla: en una planilla no hay ancho que cuidar. Se dejan fuera los archivos —un nombre de archivo no dice nada en una planilla— y las contraseñas.

Y respeta el alcance de quien la pide: el secretario de un cuerpo baja su gente, no la de toda la organización. Es la **misma consulta** que dibuja la pantalla, así que no puede traer una fila que esa persona no vería.

> Tres detalles pensados para que se abra bien en un computador de acá: el separador es **punto y coma** (en la configuración chilena, la coma es el decimal), los números van con **coma decimal**, y el archivo lleva la marca por la que Excel reconoce las tildes y las eñes. Además, una celda que empiece con `=` o `@` se marca como texto: un dato que alguien escribió no tiene por qué ejecutarse como fórmula al abrir la planilla en otro computador. Los teléfonos con `+` y los montos negativos bajan limpios.

## Usuarios, roles y alcance por iglesia

Roles disponibles (editables en `server/permissions.js`):

- **Administrador** — acceso total, incluido el módulo Usuarios.
- **Pastor / Guía** — acceso total excepto Usuarios.
- **Secretario** — gestiona membresía, asistencias, servicios, actas, documentos, certificados, etc.; sin acceso a Tesorería.
- **Tesorero** — gestiona Cuentas de Tesorería, Tesorería, Traspasos entre Cuentas, Ayudas Sociales e Inventarios; consulta el resto.
- **Solo consulta** — lectura, sin Tesorería.

**Iglesia local a la vista**: la barra superior y el panel de control muestran siempre en qué congregación se está trabajando — la asignada al usuario o, si administra varias, "Todas las iglesias". Cuando el sistema administra una sola iglesia, se muestra su nombre aunque el usuario no tenga ninguna asignada.

### El administrador general 👑

Hay una cuenta que responde por todo el sistema y a la que **no la acota nada**: alcanza todas las iglesias, todos los cuerpos y todas las acciones. En esta organización ese lugar lo ocupa el **RUT 3.231.140-7**.

Al actualizar, el sistema deja esa cuenta lista sin que haya que tocar nada:

- Si **no existía**, la crea con la contraseña inicial del sistema y con la obligación de cambiarla al entrar, igual que cualquier cuenta nueva. El RUT y esa contraseña se avisan por consola al iniciar.
- Si **ya existía**, no se le toca la contraseña: solo se le quita lo que la estuviera acotando —las iglesias y los cuerpos asignados, la iglesia principal, el perfil de permisos y sus excepciones— y se le deja el rol de *Administrador*.
- El **nombre** se toma de su ficha de miembro o de su ficha de Pastores / Guías, si la tiene, y la cuenta queda enlazada a ella.

Esto se hace **una sola vez**. De ahí en adelante la cuenta se administra desde el propio sistema, como cualquier otra: si algún día se le asigna una iglesia, el sistema respeta esa decisión y no vuelve a intervenir.

> La cuenta de fábrica (`11.111.111-1`) **queda como estaba, a propósito**: así nadie se queda sin puerta de entrada antes de comprobar que la nueva funciona. Desactívela usted, desde Usuarios, una vez que haya entrado con el administrador general.

### Qué cuentas ve cada administrador 🔐

El módulo Usuarios no se acota como los demás, y la diferencia importa. En una ficha cualquiera, *iglesia_id* dice de qué iglesia es ese registro; en una **cuenta de usuario** dice cuál es su *iglesia principal* —la que se le propone al crear cosas— y muchas cuentas la tienen en blanco.

Quien tiene iglesias asignadas ve:

- **su propia cuenta, siempre**;
- las de quienes administran alguna de sus iglesias;
- y las de quienes tienen alguna de sus iglesias como principal, que es el caso de las cuentas creadas desde la ficha de un miembro.

Lo que **no** ve, a propósito, son las cuentas **sin ninguna iglesia asignada**: esas alcanzan toda la organización, y quien administra una sola iglesia no tiene por qué poder abrirlas ni cambiarles la contraseña. El administrador general, que no tiene iglesias asignadas, las ve todas.

> Antes esto se acotaba por la iglesia principal, y pasaban dos cosas: las cuentas sin iglesia principal desaparecían de la lista —incluida la del administrador general y la de fábrica— y quien tenía iglesias asignadas **no se veía ni a sí mismo**, así que la lista salía vacía sin explicación.

### Designar a un miembro como usuario 🔐

Al pie de la ficha de cualquier miembro está **🔐 Acceso al sistema**. Si todavía no tiene cuenta, el administrador la crea con un botón: el sistema toma sus mismos datos —RUT, nombre, correo, teléfono e iglesia— y entrega una **contraseña provisoria que se muestra una sola vez**, para pasársela a la persona. Queda con rol *Solo consulta*, y desde ahí se le ajusta lo que corresponda.

Para tener acceso hace falta el **RUT**, porque es el usuario de entrada: si a la ficha le falta, el panel lo dice y no deja continuar. Si ya existía una cuenta con ese mismo RUT, no se crea otra: **se enlaza** con la ficha.

### Los dos módulos quedan sincronizados

Mientras el usuario esté enlazado a su ficha de miembro, lo que comparten se mantiene igual **se cambie donde se cambie**:

| Dato | Se sincroniza |
|---|---|
| RUT | En los dos sentidos |
| Correo electrónico | En los dos sentidos |
| Teléfono | En los dos sentidos |
| Nombre | De **Miembros** hacia Usuarios (allá va separado en nombres y apellidos) |

Y una salvaguarda: si el miembro pasa a **Fallecido** o **Trasladado**, su acceso al sistema **se desactiva solo**.

Lo que **no** se sincroniza, a propósito, es la **iglesia**: en Miembros dice a qué congregación pertenece la persona, y en Usuarios qué iglesias administra — son cosas distintas.

> Al enlazar dos fichas que ya tienen RUT, tienen que ser el mismo, o no son la misma persona. Una vez enlazadas, corregir el RUT en cualquiera de las dos lo corrige también en la otra.

### Qué ve cada usuario: iglesias y cuerpos asignados 🔒

En la ficha de cada usuario, el administrador decide **hasta dónde llega**:

| Campo | Qué hace |
|---|---|
| **Iglesias que administra** | Una o varias. Solo ve los datos de esas congregaciones. Sin ninguna marcada, ve todas. |
| **Iglesia principal** | Con cuál trabaja por omisión (la que se propone al crear registros). Tiene que estar entre las de arriba; con una sola asignada, queda esa. |
| **Cuerpos que administra** | Uno o varios. Marcando alguno, dentro de sus iglesias **solo ve lo de esos cuerpos**. Sin ninguno, ve todos los de sus iglesias. |

**Con cuerpos asignados**, el usuario ve únicamente: esos cuerpos, **sus integrantes** (y de ellos su bitácora, documentos, certificados, solicitudes…), sus **actividades y asistencias**, sus **directivas**, sus **actas** y su **inventario**. Lo demás de la iglesia —los otros cuerpos, los miembros que no son de los suyos, la tesorería general— no le aparece.

Todo esto **lo verifica el servidor en cada consulta y en cada guardado**, no solo la pantalla: quien tiene dos iglesias asignadas no puede crear un registro en una tercera («Esa iglesia no está entre las que tiene asignadas»), y quien tiene un cuerpo asignado no puede abrir la ficha de un miembro de otro («Ese registro está fuera de lo que tiene asignado»).

La barra superior muestra siempre lo que la persona tiene asignado: *⛪ Iglesia Central 👥 Coro*.

> Los usuarios creados antes de esto siguen funcionando igual: la iglesia que tenían asignada se toma como su única iglesia.

## Cuerpos y Grupos: dos realidades distintas 👥

La organización distingue:

- **Cuerpo** — entidad **formal**: tiene reglamento, deberes y derechos, y su propia directiva (ej. Damas, Caballeros, Jóvenes).
- **Grupo** — agrupación de **servicio o ayuda**, sin reglamento ni obligaciones formales (ej. equipo de aseo, apoyo social).

El campo **Nombre** guarda el nombre propio (Damas, Coro, Escuela Dominical…) y **Tipo** solo distingue entre esas dos realidades.

Al elegir **Cuerpo** aparecen los campos que solo tienen sentido en una entidad formal, y al elegir **Grupo** desaparecen:

| Campo | Para qué |
|---|---|
| Fecha de constitución formal | Cuándo se constituyó |
| Reglamento (documento) + fecha de aprobación | El reglamento vigente, adjunto |

La directiva no se guarda en el cuerpo, sino en su propio módulo, para conservar también las anteriores (ver más abajo).

### Histórico de directivas 🏅

Cada cuerpo elige su directiva por períodos, y el módulo **Directivas de Cuerpos** guarda todas: la vigente y las anteriores, con su período, sus fechas, sus integrantes y el acta de elección adjunta.

Una directiva se compone de:

| Cargo | Se elige entre | Obligatorio |
|---|---|---|
| Oficial supervisor(a) | Integrantes del **cuerpo de oficiales** | No |
| Primer jefe / Primera jefa | Integrantes **del propio cuerpo** | No |
| Segundo jefe / Segunda jefa | Integrantes **del propio cuerpo** | No |
| Secretario(a) | Integrantes **del propio cuerpo** | No |
| Tesorero(a) | Integrantes **del propio cuerpo** | No |
| Consejero(a) | Integrantes **del propio cuerpo** | No — cargo adicional, no siempre se designa |

Además hay un campo **Otros cargos** en texto libre, por si el cuerpo designa alguno más.

**Los cargos salen del propio cuerpo.** Mientras no se elija el cuerpo, esos selectores dicen *«elija primero el cuerpo»*; al elegirlo ofrecen **solo a sus integrantes** (los de su lista más su líder). Si después se cambia el cuerpo, las designaciones hechas se sueltan solas, para que nadie quede como jefe de un cuerpo al que no pertenece. El servidor lo verifica igual al guardar, y dice a quién se refiere: *«Hector Gallegos no es integrante de "Damas", así que no puede ser Secretario(a) de su directiva. Agréguelo primero al cuerpo.»*

> Esa comprobación se aplica solo al cargo que se está cambiando: si alguien salió del cuerpo después de haber sido electo, su directiva anterior se puede seguir corrigiendo sin tropiezos.
>
> El **oficial supervisor(a)** es la excepción, porque supervisa al cuerpo desde fuera: sale del cuerpo de oficiales.

**El oficial supervisor(a)** no es un cargo interno del cuerpo: es un integrante del **cuerpo de oficiales** designado para supervisar a los demás cuerpos. Por eso su selector no ofrece a todos los miembros, sino solo a los de ese cuerpo (sus integrantes y su líder).

- El cuerpo de oficiales es un cuerpo más, que se crea en *Cuerpos / Grupos* como cualquier otro; sus integrantes son los oficiales.
- Su nombre se define en **Configuración → Organización → Cuerpo de oficiales** (por defecto «Oficiales»), y se reconoce sin distinguir mayúsculas ni tildes.
- Mientras ese cuerpo no exista o no tenga integrantes, el selector ofrece a todos los miembros, para no dejar el campo bloqueado.
- Si quien figuraba como supervisor deja el cuerpo de oficiales, **su nombre se conserva** en las directivas ya registradas.

- Al marcar una directiva como **Vigente**, las demás de ese cuerpo pasan solas a *Finalizada*: nunca hay dos vigentes a la vez.
- El histórico se ve al pie de la ficha del cuerpo, con la vigente destacada, y desde ahí se registra una nueva con el cuerpo ya seleccionado.
- Cada persona que asume un cargo queda anotada en su **bitácora** ("Asume como Primer jefe / Primera jefa de «Damas» — período 2026 – 2027").

### Estado de cumplimiento ✅

Los cuerpos, por ser entidades formales, muestran un indicador calculado —en el listado y detallado en su ficha— que revisa:

| Requisito | Se cumple cuando |
|---|---|
| Reglamento adjunto | El cuerpo tiene cargado su reglamento |
| Directiva vigente registrada | Existe una directiva en estado Vigente |
| Directiva dentro de su período | No pasó su fecha de término |
| Cuerpo activo | Su estado es Activo |

El resultado es **Al día**, **Observado** (falta un requisito) o **Pendiente** (faltan dos o más). Los grupos muestran *No aplica*, porque no tienen exigencias formales.

Este indicador usa otra capacidad general del motor: un módulo puede declarar `computed` —campos que no se guardan, sino que se calculan al leer cada registro— y usarlos en sus listados como cualquier otro campo.

Esto usa una capacidad general del motor: cualquier campo puede declarar `showIf: { field: 'otro_campo', equals: 'valor' }` (o `in: [...]`) para mostrarse solo cuando corresponda. El servidor tampoco exige los campos obligatorios que no apliquen.

## Tipos de iglesia 🏛️

La organización distingue cuatro, de mayor a menor:

| Tipo | Cuántas |
|---|---|
| **Iglesia Matriz** | **Una sola en toda la organización** |
| Iglesia Sede | Varias |
| Iglesia Local | Varias |
| Iglesia Anexo | Varias |

El sistema hace cumplir lo primero: al designar una segunda matriz avisa cuál lo es y no lo guarda —*«Ya hay una Iglesia Matriz: Iglesia Central. Cámbiele el tipo a esa antes de designar otra.»*—. Para traspasar la condición de matriz, primero se le cambia el tipo a la que la tiene y después se designa la nueva.

El tipo aparece como columna y como filtro en el listado de iglesias. Las iglesias registradas antes de esta distinción quedan **sin tipo**, a la espera de que se les asigne: el sistema no lo adivina. Una iglesia nueva se crea como *Iglesia Local*, que es lo más habitual.

> **Para más adelante: de cuál depende cada una.** Los tipos forman una jerarquía —el anexo depende de una local o de una sede, la local depende de una sede, y todas dependen de la matriz—, pero **todavía no se registra ese vínculo**: por ahora el tipo se guarda solo, sin decir de quién depende cada iglesia. Se implementará cuando haya más iglesias que ordenar; entonces la organización podrá verse como árbol y sumar, por ejemplo, la membresía de una sede con todos sus anexos.

## El cuerpo por dentro: su gente, su plata y sus actas 👥

La ficha de cada cuerpo o grupo reúne todo lo suyo en una sola pantalla: su cumplimiento, sus integrantes, sus cuotas, su tesorería, sus directivas y sus actas.

### Los integrantes, uno por uno

La pertenencia a un cuerpo dejó de ser una lista de nombres: cada persona tiene su **ficha de integrante**, con tres estados posibles:

| Estado | Qué significa |
|---|---|
| **En prueba** | Recién ingresado. Al cumplirse su plazo se evalúa su informe |
| **Activo** | Integrante oficial del cuerpo, con todos sus deberes |
| **Retirado** | Ya no pertenece. Queda su ficha, con la fecha y el motivo |

El panel los muestra agrupados —*En el cuerpo*, *En prueba*, *Retirados*, *Todos*— y avisa arriba, en amarillo, **a quiénes se les venció el período de prueba** y falta evaluarlos.

Para el resto del sistema —pasar lista, elegir una directiva, saber quién es oficial, qué ve cada usuario— cuentan los que están hoy: los activos y los que están en prueba. Esa regla vive en un solo archivo, así que todo el sistema responde lo mismo.

### El período de prueba y su evaluación

Quien entra a un cuerpo lo hace en período de prueba. Los meses los define **cada cuerpo en su ficha**; si no dice nada, se usan los de *Configuración → Organización* (3 por defecto). La fecha de término se calcula sola.

Antes de que se cumpla el plazo se evalúa su informe, y la evaluación es la que **mueve el estado sola**:

| Resultado | Qué pasa |
|---|---|
| **Aprobado** | Pasa a integrante oficial, con la fecha en que se aprobó |
| **No aprobado** | Sigue en prueba, con un plazo nuevo contado desde la evaluación |
| **Retirado del cuerpo** | Sale, con el motivo anotado |

Cada evaluación queda con su fecha, quién decidió y **el informe** —adjunto como documento o escrito ahí mismo con formato—, así que el recorrido de cada integrante se puede leer completo años después. Todo queda además en la bitácora de la persona.

### La tesorería de cada cuerpo

Cada cuerpo estrena **dos cuentas**, que se crean solas, porque son bolsillos que se manejan por separado:

| Cuenta | Qué lleva |
|---|---|
| **Tesorería — <cuerpo>** | Lo que el cuerpo recauda y gasta en su trabajo |
| **Cuotas — <cuerpo>** | Las cuotas mensuales de sus integrantes |

Además puede abrir **las cuentas que necesite** para trabajos específicos. Todas se ven en su ficha con el saldo de cada una y los últimos movimientos.

Las cuentas de tesorería tienen ahora tres niveles: **Corporación**, **Iglesia local** y **Cuerpo / Grupo**.

### Las cuotas mensuales

Cada cuerpo define **su cuota mensual** en su ficha. El panel muestra una planilla del año: una fila por integrante y una columna por mes. **Un toque en la casilla marca el mes como pagado**, y ese pago entra como ingreso a la cuenta **Cuotas** del propio cuerpo —no a su tesorería general, porque es plata que se maneja aparte—.

Hay dos maneras de no deber cuota, y las dos se respetan solas:

- **El cuerpo entero no cobra** — se apaga en su ficha (los grupos vienen así por defecto, los cuerpos formales sí cobran).
- **Un integrante está exento** — se marca en su ficha, con el motivo. Sale marcado en la planilla y el sistema no deja cobrarle.

> El paso a tesorería se puede apagar en **Configuración → Organización → Registrar las cuotas en tesorería**. Una pertenencia con cuotas pagadas **no se puede eliminar**: se marca como *Retirado*, y su historial queda intacto.

### Las actas de las reuniones

Las actas administrativas del cuerpo se ven y se crean **desde su ficha**, y se pueden registrar de dos maneras, las dos válidas: **adjuntando el documento** firmado, o **escribiéndola en el sistema** con un campo de texto con formato —negrita, cursiva, listas y títulos—.

Lo que se escribe se guarda dejando **solo el formato**: la lista de etiquetas permitidas es corta y no se guarda ningún atributo, así que nadie puede colar código en un acta que después leen los demás. Al pegar desde Word entra solo el texto.

## Cada iglesia y cada cuerpo con su fotografía 📸

Tanto la **iglesia** como cada **cuerpo o grupo** llevan su propia fotografía —el templo, el cuerpo reunido—, que se ve como miniatura en el listado y en su ficha. Se saca con el teléfono y al subirla se ajusta sola de tamaño, igual que la foto de un miembro.

## Historial y documentos de la iglesia y del pastor 🗒️🗂️

Lo que ya tenía cada miembro lo tienen ahora también **cada iglesia** y **cada pastor o guía**: su historial y sus documentos, al pie de su ficha.

### Documentos

Todos los que hagan falta, cada uno con **su archivo y su nombre**, más su tipo, su fecha y observaciones:

| De la iglesia | Del pastor / guía |
|---|---|
| Personería jurídica · Estatutos · Acta de fundación · Escritura / Propiedad · Contrato de arriendo · Permiso municipal · Plano del templo · Certificado · Reglamento interno · Otro | Carnet de Identidad · Certificado de Antecedentes · Certificado de Inhabilidades · Certificado de Matrimonio Civil · Certificado de Matrimonio Iglesia · Certificado de Nombramiento (Ordenacion) · Carta de Renuncia · Otro Documento |

Al agregar uno desde la ficha, la iglesia o el pastor vienen puestos. Los documentos del pastor heredan **su** iglesia, que es lo que decide quién puede verlos.

### El pastor principal, con su cónyuge

De una iglesia responden los dos, así que se nombran los dos. Al elegir al **pastor principal** en la ficha de la iglesia, el buscador ofrece a cada uno junto a su cónyuge —*«Pastor Juan Pérez Soto y Pastora Ana Díaz Soto»*—, y la ficha muestra **A cargo de la iglesia** con la pareja completa. El cónyuge sale de la ficha del pastor, así que basta con tenerlo registrado ahí una vez.

### Historial

Un registro fechado de lo que va ocurriendo, con anotaciones escritas a mano y otras que el sistema hace solo:

| Se anota solo | Cuándo |
|---|---|
| *«Se registra la iglesia … en el sistema»* | Al crearla |
| *«Ciudad: (vacío) → Puerto Montt · Teléfono: …»* | Al cambiar sus datos |
| *«Se registra a Samuel Rodríguez en Pastores / Guías como Pastor Probando»* | Al crear su ficha |
| *«Pasa de Pastor Probando a Pastor Diácono»* | Al cambiarle el cargo |
| *«De Iglesia Central a Iglesia Alerce»* | Al trasladarlo |
| *«Se adjuntó "Credencial 2026"»* | Al subir un documento |

A mano se puede anotar cualquier otra cosa: la fundación, una inauguración, un cambio de pastor, una obra en el templo, un aniversario, una campaña, una visita, un reconocimiento; y en el ministerio, una ordenación, un nombramiento, una licencia, una capacitación. Cada registro se puede **editar o eliminar**, como en la bitácora del miembro.

> Estos cuatro módulos —documentos e historial de iglesias y de pastores— **no ocupan lugar en el menú**: se manejan desde la ficha a la que pertenecen, que es donde se buscan. El motor los publica igual en la API y respeta sus permisos.

## Panel de control 📊

La pantalla de inicio muestra los totales del sistema, el resumen financiero del mes (a quien tenga acceso a Tesorería), las últimas asistencias y las solicitudes recientes.

### Datos por completar 📝

Una base traída de otro sistema llega siempre con huecos: gente sin teléfono, sin fecha de nacimiento, sin correo. No es un error del programa —esos datos nunca se cargaron— pero mientras nadie los vea, nadie los llena, y el día que hay que avisarle a alguien no hay por dónde.

El panel los pone a la vista: cuántas fichas hay, cuántas tienen todo puesto, y a cuántas les falta cada dato —teléfono, fecha de nacimiento, dirección, correo, sexo, fecha de ingreso, contacto de emergencia y estado—, con una línea que dice para qué sirve cada uno.

Lo importante es que **cada número se abre**: al tocarlo, lleva al listado de Miembros filtrado justo por los que no lo tienen, con un aviso arriba que explica por qué la lista viene recortada y un botón para volver a verlas todas. De ahí se baja la planilla y se sale a pedir los datos, que es como se llenan de verdad.

Aparte va un aviso en rojo si hay **menores de edad sin adulto responsable** en su ficha: eso no es un dato que falte por completar, es una obligación de la propia iglesia.

Se cuenta sobre todas las fichas, sin distinguir por estado. Contar solo las activas era tentador —a quien se trasladó no hay que perseguirlo por su correo— pero entonces el número no calzaría con la lista que se abre al tocarlo, y un conteo que no se puede abrir es justo lo que se quería evitar.

Respeta el alcance: el secretario de un cuerpo ve lo que falta en su cuerpo, no en toda la organización.

### Próximos cumpleaños 🎂

Una tarjeta lista **los miembros que cumplen años más pronto**, con su foto, la fecha, los años que cumplen y cuánto falta (*hoy*, *mañana*, *en 7 días*). El que cumple hoy queda destacado arriba, y al pinchar cualquiera se abre su ficha.

- Se ordena por lo que falta, mirando solo el día y el mes: cuando el cumpleaños de este año ya pasó, cuenta el del año siguiente.
- No aparecen los miembros **fallecidos ni trasladados**, ni los que aún no tienen fecha de nacimiento registrada.
- Quien nació un **29 de febrero** aparece el 28 en los años que no son bisiestos.
- Cuántos se muestran se cambia en **Configuración → Preferencias → Cumpleaños que muestra el panel** (4 por defecto, hasta 20).

## Con qué iglesia se trabaja ⛪

Quien alcanza más de una iglesia no siempre las quiere ver todas juntas: el domingo está en una y el lunes revisa otra, y un listado con los miembros de las cinco mezclados no le sirve. Arriba a la izquierda, junto al nombre de la iglesia, hay un botón para **elegir con cuál o cuáles trabajar**, y se cambia cuando se quiera.

Lo que elija **acota todo el sistema** —los listados, los informes, el panel y lo que registre—, no solo la pantalla que tiene delante. **«Todas las que tengo»** está siempre a un toque, así que nadie queda encerrado en una iglesia sin darse cuenta.

La elección nunca amplía lo asignado: si eligiera una que no le corresponde, se descarta y vuelve a ver las suyas. Y queda guardada en su cuenta, no en el navegador, así que la encuentra igual desde el teléfono.

El mismo elector está en **Mi perfil**, con lo que hace falta para entenderlo: con cuál está trabajando, cuántas alcanza y —cuando alcanza una sola— que el botón no aparece porque no hay entre qué elegir, no porque falte.

> **Quién ve qué lo decide «Iglesias que administra»**, y solo eso. La **«Iglesia principal»** dice con cuál se trabaja por omisión —la que se propone al crear un registro—, no a cuáles se alcanza. Hasta la versión 1.50 el sistema sumaba la principal a lo asignado, así que a quien solo tenía puesta esa lo encerraba en esa iglesia sin decirlo, y de paso le escondía este botón. Al actualizar, a esas cuentas se les copia esa iglesia en «Iglesias que administra»: **ven exactamente lo mismo que antes**, pero ahora queda escrito donde se administra y se puede cambiar.

## Cómo se nombra a cada persona 🧍

En la ficha se guarda **todo** lo que la persona tiene: «Juan Carlos Alberto» y «Pérez Soto». Pero en un listado, en un selector o al pasar lista, ese nombre entero ocupa una línea completa y no ayuda a reconocer a nadie más rápido. Por eso, en pantalla se la nombra como se la nombra en el día a día:

> **el primer nombre y los dos apellidos** → *Juan Pérez Soto*

Vale para **miembros, pastores y usuarios**, y se aplica en todas partes: los listados, los selectores, las referencias de otras fichas, la toma de asistencia, los informes, el panel y el encabezado de cada ficha. En la cuenta de usuario, donde el nombre viene en un solo campo, se toma el primero y los dos últimos.

**El nombre completo no se pierde ni se toca.** Sigue guardado tal cual y se ve entero al abrir la ficha: tanto en sus datos —*Nombres: Juan Carlos Alberto*— como en el formulario al editarla, que es donde importa.

## Ficha del miembro 🧍

### La ficha completa, en una sola pantalla 👁️

Al tocar a una persona en el listado se abre su **ficha**: **todos** sus datos, ordenados por las mismas secciones con las que se registran, y debajo sus **cuerpos y grupos**, sus **documentos**, su **historial** y su **acceso al sistema**. Es de solo lectura —para cambiar algo está el botón **✏️ Editar**, que lleva al formulario de siempre— y está pensada para leerla desde el teléfono: una columna, letra grande y lo importante arriba.

En el encabezado van la foto, el **trato con el nombre completo**, la iglesia, la edad, el tipo de miembro y el estado, y tres botones que evitan copiar números a mano: **📞 Llamar**, **💬 WhatsApp** y **✉️ Correo**.

Los campos **en blanco no se muestran**, para que la lectura no sea una lista de casillas vacías. Un interruptor —*«Ver los N campos en blanco»*— los muestra todos cuando lo que se quiere es justamente ver **qué falta por completar**. Los datos que no le aplican a esa persona (los del adulto responsable de quien ya es mayor de edad, por ejemplo) no aparecen ni siquiera así, salvo que traigan algo escrito.

Con **🖨️ Imprimir** la misma ficha sale en papel con el membrete de la iglesia.

> Lo mismo vale para las **iglesias**, los **pastores / guías** y los **cuerpos y grupos**: se abren para leerlos, y desde ahí se pasa a editarlos.

> Un dato guardado que **no figura en la lista de opciones** —un parentesco escrito a mano, algo que venga de otro sistema— se muestra **tal cual**: el dato está, y esconderlo por no reconocerlo sería peor que mostrarlo.

### El listado en el teléfono 📱

En pantalla chica, una tabla de nueve columnas obliga a desplazarse de lado y deja la mitad de los datos fuera de la vista. Por eso, **en el teléfono cada fila se dibuja como una tarjeta**: el trato y el nombre arriba, y debajo el RUT, la edad, el tipo de miembro y el estado, cada dato con su nombre al lado. Los campos en blanco no ocupan lugar, y no hay que desplazarse hacia los costados.

Mientras haya **una sola iglesia registrada**, la columna de la iglesia no se muestra —repetir el mismo nombre en cada fila solo quita espacio—; aparece sola en cuanto haya más de una.

### Cómo se le trata a cada persona

En la iglesia a cada miembro se le dice de una manera, y el sistema la calcula sola:

| Trato | A quién |
|---|---|
| **Hermano** / **Hermana** | A los miembros en general, según su género |
| **Oficial** | A los **varones** que pertenecen al cuerpo de oficiales |
| **Guía de Obra** | A quien tiene ese **cargo** en *Pastores / Guías*: al guía de obra se le dice guía de obra, no hermano ni pastor |
| **Pastor** / **Pastora** | A quienes tienen un **cargo pastoral** —el de *pastora* y los de *pastor probando* hacia arriba— **y a su cónyuge** |

El trato aparece como columna en el listado y junto al nombre al abrir la ficha. **No se guarda**: se calcula al leer, así que cuando alguien entra al cuerpo de oficiales, queda registrado en Pastores / Guías o **cambia de cargo**, cambia solo. El día que un guía de obra pasa a pastor probando, deja de ser *Guía de Obra* y es *Pastor* en todo el sistema, sin tocar nada más.

Los tratos son esos seis: **Hermano, Hermana, Oficial, Guía de Obra, Pastor y Pastora**. Cuando a alguien le corresponda uno distinto del que calcula el sistema, se fija a mano en su ficha, en **Trato (fijado a mano)**, y ese manda sobre el cálculo.

Hay dos que el ministerio impone y no se pueden cambiar a mano por uno de hermano:

- al **guía de obra**, el de su cargo: *«A esta persona le corresponde el trato de Guía de Obra —por su cargo en Pastores / Guías—, así que no puede quedar como "Hermano".»*
- al cónyuge de un pastor o de una pastora, el de *Pastor* o *Pastora*.

> El **guía de obra todavía no tiene cargo pastoral**, así que su cónyuge **no** pasa a ser Pastor ni Pastora: sigue siendo *Hermano* o *Hermana*, como cualquier miembro.

> El cuerpo de oficiales es el que se nombre en **Configuración → Organización → Cuerpo de oficiales** («Oficiales» por defecto).

### Buscar a una persona en vez de desplegar la lista 🔎

Cuando un campo apunta a un módulo con **muchos registros** —los miembros de una iglesia, por ejemplo— el sistema deja de mostrar una lista desplegable larguísima y ofrece un **buscador**: se escribe parte del **nombre**, de **cualquiera de los apellidos** o del **RUT** y aparecen las coincidencias.

- Basta con que **calcen todas las palabras escritas**, en cualquier orden: *«rosa salazar»*, *«salazar rosa»* y *«zapata rosalia»* funcionan igual.
- **No importan las tildes ni las mayúsculas**: *muñoz* y *munoz* encuentran lo mismo.
- El **RUT sirve con o sin puntos y guion**, y basta un pedazo: *15943*, *15943995* o *15.943.995-K*.
- También encuentra por **teléfono o correo**, porque busca en los mismos datos con que se busca en el listado del módulo.
- Cada resultado muestra el RUT y el teléfono al lado, para distinguir a dos personas del mismo nombre.
- Se maneja con el teclado (↑ ↓ para recorrer, Enter para elegir, Esc para cerrar) y con el botón **×** para soltar la selección.

Aparece solo donde hace falta: en listas de **más de 20 registros** o cuando el campo lo pide con `buscador: true`. Con pocas opciones —las iglesias, las cuentas de tesorería— se conserva la lista desplegable de siempre. El campo de **Integrantes** de un cuerpo busca igual, por nombre, RUT o teléfono.

### Matrimonios vinculados 💍

Cuando dos miembros están casados entre sí, se vinculan: basta elegir al **cónyuge** en la ficha de uno —el campo aparece con estado civil *Casado(a)*, *Unión libre* o *Viudo(a)*— y el vínculo queda **en las dos fichas**.

- Las **fechas de matrimonio** (civil y por la iglesia) se copian al cónyuge que las tenga en blanco: se escriben una sola vez.
- Si se cambia el vínculo, el anterior se suelta solo: nadie queda apuntando a quien ya no corresponde.
- Nadie puede figurar como su propio cónyuge, y si se elimina una ficha, el vínculo del otro queda limpio.

En **Pastores / Guías** hay un solo campo **Cónyuge**, que también se elige entre los miembros y deja el vínculo en las fichas de miembro de ambos.


### Qué se registra de cada persona

La ficha viene ordenada por secciones, para que no sea una lista interminable de casillas:

| Sección | Qué lleva |
|---|---|
| **Identificación** | Foto · iglesia · RUT · trato · nombres · apellidos · fecha de nacimiento (con la edad al día) · sexo |
| **Adulto responsable** | Solo para **menores de 18**: nombre y apellido, RUT, parentesco y teléfono de quien responde por él |
| **Educación y trabajo** | Nivel educacional · título o estudios cursados · profesión u oficio · lugar de trabajo o estudio |
| **Estado civil y familia** | Estado civil · fechas de matrimonio civil y por la iglesia · cónyuge |
| **Contacto** | Teléfono · correo · dirección |
| **Vida en la iglesia** | Forma de ingreso · fecha de ingreso · conversión · bautismo · estado · **tipo de miembro** |
| **Contacto de emergencia** | Nombre · parentesco · teléfono |
| **Información médica** | Enfermedades · alergias · indicaciones médicas |
| **Notas** | **Nota importante** (destacada) · notas |

**Parentesco** —el del contacto de emergencia y el del adulto responsable— se elige de una lista de sugerencias (cónyuge, madre, padre, hijo(a), abuelo(a)…) **o se escribe como corresponda**: *hija*, *esposo*, *nieta*, *madrina*. Nadie tiene que forzar un parentesco real dentro de una lista cerrada, y lo que ya estaba escrito se conserva y se ve tal cual.

**Forma de ingreso** —por dónde llegó a esta iglesia—: servicio general, redes sociales, traslado de iglesia, nacido en la iglesia, campaña evangelística, invitación de hermano(a) u otro.

**Tipo de miembro**: Miembro Nuevo · Miembro Menor de Edad · Miembro Oyente · Miembro Activo · Miembro Líder. No es lo mismo que el **estado** (activo, inactivo, trasladado…): una persona activa puede ser oyente, y un menor de edad sigue siendo miembro. Aparece como columna y como filtro en el listado.

> Al actualizar, a **quienes todavía no cumplen 18 años** se les pone solo *Miembro Menor de Edad*, porque es lo único que se puede deducir sin suponer nada; el tipo de los demás queda en blanco, a la espera de que la iglesia lo decida. Queda anotado en el arranque cuántos fueron.

### El adulto responsable de los menores 👶

Los datos del adulto responsable **aparecen solos** cuando la fecha de nacimiento indica menos de 18 años, y se ocultan en cuanto deja de ser menor —sin borrarse—. Al abrir la ficha de un menor que todavía no lo tiene registrado, un aviso lo dice arriba de todo: *«Es menor de edad y todavía no está registrado su adulto responsable»*.

No se exige para poder guardar: hay fichas antiguas que aún no lo traen, y bloquearlas impediría corregir cualquier otro dato. El aviso queda a la vista hasta que se complete.

### Lo que no se puede pasar por alto ⚠️

Al abrir una ficha, antes de los datos, se muestran los avisos que importan:

- la **nota importante**, si la tiene, en amarillo;
- la falta del **adulto responsable** en un menor;
- lo que quedó **pendiente con su cónyuge**, cuando uno de los dos figura en Pastores / Guías y al otro todavía no se le ha fijado el trato;
- la **información médica** —enfermedades, alergias, indicaciones—, para tenerla a mano sin buscarla.

Los datos de salud y la nota importante quedan marcados como **sensibles**, y eso ahora decide dos cosas: que el historial deje constancia de que cambiaron **sin copiar su contenido** («Alergias: actualizada»), y **quién puede leerlos**.

#### Quién ve los datos de salud 🔒

Están en la ficha para que en una actividad se sepa si alguien es alérgico a la penicilina, no para que circulen. Los ven:

- **la propia persona**, en su ficha y en Mi perfil, siempre — son suyos;
- el **administrador** y el **pastor o guía**, que son quienes responden por la gente de la iglesia;
- y quien tenga el permiso **dado a mano**, para cuando la iglesia quiera que también los vea alguien más —la encargada de la escuela dominical, por ejemplo— sin cambiarle el rol. Se da como cualquier otro permiso, en la ficha del usuario o en un perfil, bajo *Datos de salud de los miembros*. También se puede **quitar** a quien los tendría por su rol.

A quien no los alcanza no se le muestran **en ninguna parte**: ni en la ficha, ni en el listado, ni en la planilla que se baja. En la ficha aparece un aviso de que existen y no se están mostrando, y los campos no se dibujan: dejarlos en blanco sería peor, porque un campo vacío se lee como *«esta persona no tiene ninguna alergia»*.

Y **tampoco puede escribirlos**: si pudiera, le bastaría con abrir la ficha y guardar para dejar en blanco un dato que ni siquiera vio. Sus otros cambios en esa misma ficha —el teléfono, la dirección— se guardan con normalidad.

> Antes esto no lo decidía nadie: los veía cualquiera que pudiera abrir la ficha, y eso incluye a todo secretario y a quien solo consulta. No era una decisión, era lo que pasaba.

### Edad al día

Basta con la **fecha de nacimiento**: la edad aparece al lado mientras se escribe y se muestra en el listado. No se guarda —se calcula cada vez que se lee la ficha—, así que nunca queda desactualizada. A los menores de un año se les muestra la edad en meses.

### Estado civil y matrimonio

Al elegir **Casado(a)** aparecen dos campos más: **fecha de matrimonio civil** y **fecha de matrimonio por la iglesia**. Con cualquier otro estado civil no se muestran. Si más adelante cambia el estado, las fechas no se pierden: quedan guardadas, solo dejan de mostrarse.

### Fotos y documentos que suben rápido

Al subir una **imagen** —la foto del miembro, la del templo, la del cuerpo, la de un carnet— el sistema la **ajusta de tamaño antes de enviarla**: la deja con su lado mayor en 1600 píxeles conservando el detalle a simple vista. Una foto de teléfono de varios MB queda en unos cientos de KB y sube en un instante, aun con señal mala. Debajo del archivo se indica lo que pasó: *«imagen ajustada a 1600×1200 — de 4,2 MB a 180 KB»*.

El tamaño y la calidad se cambian en **Configuración → Preferencias**. Los archivos que no son imágenes (PDF, Word) suben tal cual.

### Ajustar la foto: recortar, girar, brillo y contraste ✂️

Las fotos de perfil —la del **miembro**, la del **pastor o guía**, la del **cuerpo o grupo**, la del **templo**, la del **usuario del sistema** y la del titular de una **credencial**— tienen al lado un botón **✂️ Ajustar** que abre un editor sin salir de la ficha:

| Control | Para qué |
|---|---|
| **Arrastrar** (dedo o ratón) | Correr la foto hasta encuadrar lo que interesa |
| **Acercar** (barra, rueda o dos dedos) | Acercar o alejar |
| **↻ Girar** | Enderezar una foto que quedó de lado |
| **Brillo** | Levantar una foto tomada a oscuras |
| **Contraste** | Darle cuerpo a una foto lavada |
| **↺ Dejar como estaba** | Volver al punto de partida |

El marco es cuadrado porque así se muestran estas fotos en todo el sistema —redondas en los cumpleaños, cuadradas en las fichas y en las credenciales—: **lo que se ve en el marco es exactamente lo que queda guardado**. El brillo y el contraste se aplican píxel a píxel, no con un filtro del navegador, así que lo que se ve al ajustar es lo que se guarda, en cualquier teléfono.

El recorte nunca se agranda más allá de lo que da la foto original: acercarse no inventa detalle que no existe. Y es **opcional** —la foto se sube igual que siempre al elegirla—; el botón está para cuando haga falta, y se puede volver a ajustar una foto guardada hace meses.

#### La foto del usuario del sistema

Cada cuenta tiene la suya, y es la cara que sale **arriba a la derecha**, junto a su nombre, y en el listado de Usuarios. Cada persona puede cambiarla ella misma desde **Mi perfil**, sin pasar por la oficina.

Cuando la cuenta está **enlazada a una ficha de miembro**, la foto es una sola: la misma en los dos lados, como ya pasa con el RUT, el nombre, el correo y el teléfono. Se cambia por donde sea más cómodo y el otro queda al día solo, así que nadie tiene que subirla dos veces. Quien todavía no tenga foto sigue apareciendo con sus iniciales, en el mismo redondel.

### Documentos del miembro 🗂️

Cada miembro puede tener **todos los documentos que hagan falta**: carnet de identidad, ficha de registro, ficha de actualización, certificados, cartas de traslado o cualquier otro. Cada documento guarda **el archivo y su nombre**, para reconocerlo sin abrirlo, más su tipo, su fecha y observaciones.

Se ven y se agregan **al pie de la ficha del miembro**, con la miniatura de cada uno; al agregar uno, el miembro viene puesto. Cada documento adjuntado queda anotado solo en el **historial del miembro**.

## Tesorería por cuentas 🏦

El dinero se lleva en **cuentas**, en dos niveles:

```
Corporación            Tesorería general de la corporación
                       + una cuenta por cada proyecto o trabajo de la corporación

Cada iglesia local     Tesorería general de la iglesia
                       + Fondo para la corporación  ← lo que aporta de las ofrendas
                       + una cuenta por cada proyecto o trabajo de esa iglesia
```

Cada movimiento de Tesorería se registra **en una cuenta**, y el saldo de cada una se calcula solo: *saldo inicial + ingresos − egresos*.

### Las categorías las mantiene la iglesia 🏷️

En qué se clasifica cada movimiento —diezmos, ofrendas, servicios públicos, mantenimiento— ya no viene escrito dentro del programa: es un módulo más, **Categorías de Tesorería**, donde se **crean, editan y desactivan** sin tocar el sistema.

Cada categoría dice si se usa en **ingresos**, en **egresos** o en **ambos**, y al registrar un movimiento **solo se ofrecen las que corresponden**: al anotar un gasto no aparece «Diezmos», y al cambiar el tipo de un movimiento la lista se acomoda sola.

Una categoría que ya se usó **no se borra: se desactiva**. Si se borrara, esos movimientos quedarían clasificados con un nombre que ya no existe y los informes de años anteriores dejarían de cuadrar. El sistema lo impide y lo dice con todas sus letras: *«Ofrendas está en 3.000 movimientos, así que no se puede borrar sin dejarlos sin clasificación. Desmárquela en "En uso" y dejará de ofrecerse para los nuevos, sin tocar los que ya están.»* Las que nunca se usaron sí se borran.

Al publicar esta versión, las que venían de fábrica quedan guardadas solas —repartidas entre ingreso y egreso—, junto con cualquier otra que ya estuviera en uso, deduciendo de qué tipo es por cómo se ha usado. Ningún movimiento se toca.

### Cómo se ordena

| Campo de la cuenta | Para qué |
|---|---|
| Nivel | **Corporación** o **Iglesia local** |
| Iglesia | A cuál pertenece (solo si el nivel es Iglesia local) |
| Tipo | **General** (la tesorería del nivel), **Fondo para la corporación** o **Proyecto / Trabajo** |
| Responsable, fecha de apertura, saldo inicial, descripción | Datos de la cuenta |
| Estado | **Activa** o **Cerrada** |

Reglas que el sistema hace cumplir:

- **Una sola cuenta General por nivel**: una para la corporación y una para cada iglesia. Las demás son de proyecto o trabajo.
- **Un solo Fondo para la corporación por iglesia**, y solo en iglesias locales: es la cuenta donde cada congregación reúne lo que le aporta a la corporación (el 10% de las ofrendas) hasta traspasarlo. Se crea solo para cada iglesia.
- Una cuenta de la corporación **no pertenece a ninguna iglesia**; una cuenta local exige indicar cuál.
- La **iglesia de cada movimiento se toma de su cuenta** — no se escribe a mano —, así el alcance por iglesia siempre calza con el nivel de la cuenta.
- Una **cuenta cerrada** no recibe movimientos nuevos, pero los que ya tiene se pueden corregir.
- Una cuenta **con movimientos no se puede eliminar**: se cierra.

### Qué se ve

- **Cuentas de Tesorería** lista todas con su **saldo**, y se filtra por nivel, tipo y estado.
- Al abrir una cuenta, al pie aparece su **estado**: saldo inicial, ingresos, egresos, saldo actual y sus últimos movimientos, con botones para registrar uno nuevo o ver todos los suyos.
- El listado de **Tesorería** muestra arriba el **saldo de cada cuenta** además del resumen del período, y se filtra por cuenta, tipo y categoría.

### Alcance por iglesia

Un usuario asignado a una iglesia solo ve —y solo puede mover— las cuentas de **su** iglesia: las de la corporación no le aparecen ni en los listados ni en el selector de un movimiento, y el servidor rechaza el intento aunque se haga por fuera de la pantalla. Un usuario sin iglesia asignada (por ejemplo el tesorero de la corporación) opera sobre todas.

### Traspasos entre cuentas 🔄

El dinero se mueve de una cuenta a otra **dejando constancia**. El caso corriente: cada iglesia va reuniendo en su *Fondo para la corporación* el 10% de las ofrendas y, cuando llega el momento, lo traspasa a la tesorería general de la corporación.

Cada traspaso registra **fecha, cuenta de origen, cuenta de destino, monto, forma** (efectivo, transferencia, depósito, cheque, vale vista u otra), **n.º de operación**, concepto, comprobante adjunto y notas. Al elegir la cuenta de origen se muestra **cuánto hay en ella** en ese momento.

Cada traspaso genera **sus dos movimientos en Tesorería** —un egreso en el origen y un ingreso en el destino—, y los mantiene cuadrados:

- Si se corrige el traspaso (monto, fecha, forma), los dos lados se corrigen juntos.
- Si se elimina el traspaso, se van los dos movimientos y los saldos vuelven a como estaban.
- Esos dos movimientos **no se editan ni se borran por separado** desde Tesorería: el sistema remite al traspaso, para que nunca quede un lado sin el otro.

**De dónde sale el dinero del fondo**: cada servicio con ofrenda anota su aporte como egreso de la tesorería de la iglesia y como ingreso en su *Fondo para la corporación* (ver *Registro de Servicios*). El traspaso es el paso siguiente: vaciar ese fondo hacia la corporación cuando corresponda.

**Quién puede traspasar qué**: el dinero sale siempre de una cuenta propia (el servidor rechaza sacarlo de una ajena, aunque se intente por fuera de la pantalla) y puede entrar en una cuenta de la corporación o en otra de la misma iglesia. A un tesorero local no se le ofrecen —ni se le muestran— las cuentas de otras congregaciones.

### Al actualizar el sistema

Al crear una iglesia nueva se le crean solas su **tesorería general** y su **fondo para la corporación**. A cada iglesia que no lo tenga se le crea su **Fondo para la corporación**, y los movimientos que ya estaban registrados **no se pierden ni cambian de nivel**: cada uno pasa a la cuenta general que le corresponde según su iglesia (o a la de la corporación si no tenía), creándola si hacía falta. Queda anotado en el arranque: *«🔁 tesorería: 4 movimiento(s) asignados a su cuenta general»*.

## Asistencia: todo en un solo lugar 📋

Crear la actividad, tomar la lista y ver los informes se hacen en **una sola pantalla**: en el menú hay una única entrada, **Asistencia**. No hay que saltar entre módulos ni buscar la actividad en un listado para poder marcarla.

Está pensada para el teléfono, que es donde se toma la asistencia casi siempre.

### Registrar

Dos pestañas encabezan la pantalla: **🖐️ Registrar** y **📈 Informes**.

**1. El calendario del mes.** Cada día con actividad lleva un punto, y el color dice cómo va: **verde** si la lista está completa, **ámbar** si falta gente por marcar, **rojo** si no se ha tomado. Las flechas cambian de mes y el botón **📅 Hoy** vuelve al día de hoy. Con el botón **☰** se cambia a ver el mes como lista corrida, para quien prefiera leerlas seguidas.

Arriba, dos filtros: por **cuerpo** y por **tipo de actividad**.

**2. Las actividades del día.** Al tocar un día se abren sus actividades, cada una con su tipo, su hora, su lugar, los cuerpos convocados y **cuánto lleva**: *«12/28 — Faltan 16»*, *«Lista completa»* o *«Sin tomar»*. Se editan (✏️) y se eliminan (🗑️) ahí mismo. Si el día tiene una sola actividad, se abre sola.

**3. ➕ Actividad.** Se crea sin salir de la pantalla: fecha (viene puesta la del día elegido), hora, tipo, **cuerpos convocados** —se tocan los que van—, lugar y observaciones. Al guardar queda elegida y con su lista lista para marcar.

**4. La lista.** Al elegir una actividad, la pantalla baja sola a su lista:

- Cada persona en su fila, con **el cuerpo por el que va** y tres botones grandes —**Presente**, **Ausente**, **Justificado**— de 46 píxeles de alto, cómodos para el pulgar. Volver a pulsar el mismo botón la desmarca.
- **Buscador**: se escribe parte del nombre o del RUT y la lista se reduce a esa persona, sin desplazarse por sesenta nombres. No importan tildes ni mayúsculas.
- **Filtros**: *Todos · Presentes · Ausentes · Justificados · Sin marcar (N)*, para revisar al final quiénes faltan.
- **Elegir el cuerpo**: cuando a la actividad la convocan varios, un desplegable con cada cuerpo y cuánta gente trae —*Coro (28)*, *Dorcas (34)*— deja ver **solo a los integrantes de ese cuerpo**. Uno pasa lista cuerpo por cuerpo, no saltando entre grupos, y el progreso pasa a contar el de ese cuerpo: *«12/28»* de los suyos, no de la actividad entera. Con un solo cuerpo convocado no aparece, porque no haría falta.
- **Progreso de marcado**: *«12/28 (43%)»* con su barra, siempre a la vista.
- **✓ Todos presentes**: marca a los que están a la vista y **sin marcar**, sin pisar lo ya decidido. Con un filtro puesto, solo a esos.
- **Barra pegada abajo**: el recuento en vivo y el botón **Guardar lista**, sin tener que volver arriba.

**5. Nada se pierde.** Lo marcado queda guardado **en el propio teléfono** al instante, y **se guarda solo** unos segundos después de la última marca: la barra dice *«Guardado a las 19:42»*, y el contador de la actividad se actualiza al tiro. Si se corta la señal, se cierra la pantalla o se apaga el teléfono a media lista, al volver a abrirla aparece el aviso *«Se recuperaron 8 marcas que habían quedado sin guardar en este teléfono»* y se sigue donde se iba.

> El guardado automático **espera** si hay una justificación sin motivo o sin detalle: la barra avisa *«Falta el motivo de 1 justificación(es)»* y no manda nada a medias. En cuanto se completa, guarda.

### Una actividad puede convocar a varios cuerpos

En **Cuerpos convocados** se elige uno o varios: a una actividad conjunta pueden asistir Damas y Caballeros a la vez. Al pasar lista aparecen los integrantes de todos ellos —cada uno con la etiqueta de su cuerpo— y quien pertenece a dos cuerpos aparece una sola vez. En los informes cada persona sigue contando en **su** cuerpo, así que un encuentro conjunto no mezcla los promedios.

Cuando alguien queda **Justificado** se pide el motivo:

| Motivo | ¿Pide detalle? |
|---|---|
| Trabajo | No |
| Enfermedad | No |
| **Emergencia** | **Sí** |
| **Otra actividad de la iglesia** | **Sí** |
| **Otro motivo** | **Sí** |

El detalle es obligatorio en esos tres casos y el sistema no deja guardar la lista sin él —lo verifica el servidor, no solo la pantalla—, así ninguna justificación queda sin explicación.

### Crear actividades y pasar lista son dos permisos distintos

- **Asistencias** manda sobre **crear y modificar actividades**.
- **Toma de Asistencia** manda sobre **pasar lista**.

Así, a alguien se le puede dejar tomar la asistencia sin dejarlo crear actividades: en su ficha de usuario se marca *Asistencias → solo Ver* y *Toma de Asistencia → Ver, Crear y Editar* (ver **Permisos personalizados**). Esa persona ve el calendario y las actividades, marca a todos y guarda la lista, pero no le aparecen ➕ Actividad ni los botones de editar y eliminar, y si lo intentara por fuera de la pantalla, el servidor lo rechaza.

El rol **Secretario** trae los dos permisos.

> Los dos módulos que sostienen esto —**Asistencias** (las actividades) y **Toma de Asistencia** (la marca de cada persona)— ya no ocupan lugar propio en el menú: todo se maneja desde la pantalla de Asistencia. Siguen existiendo como módulos, con su API y sus permisos, que son los que aparecen en la ficha de usuario.

## Informes de asistencia 📈

En la misma pantalla de **Asistencia**, pestaña **📈 Informes**, se sacan tres informes, acotados por el período que se elija:

- **General** — todo lo registrado.
- **Por cuerpo** — se elige el cuerpo.
- **Por persona** — se busca a la persona por nombre o RUT.

### Llevarlos a papel o a una planilla

En la cabecera de la pestaña hay dos botones:

- **🖨️ PDF** imprime el informe tal como se ve, con el membrete de la iglesia y sin el menú ni los filtros (desde el diálogo de impresión se guarda como PDF).
- **⬇️ Excel** baja lo mismo como planilla (`.csv`, que Excel abre directo), con el resumen y las tablas por cuerpo, por día, actividad por actividad y por miembro. Los decimales van con coma y las tildes salen bien.

### Cómo se cuenta cuando alguien está en varios cuerpos

**Cada actividad cuenta por separado.** Quien pertenece a cuatro cuerpos tiene cuatro marcas el día que los cuatro se reúnen, y cada una entra donde corresponde:

> El 9 de agosto hay tres actividades. Ana pertenece a Damas, Coro y Escuela Dominical. Estuvo **presente** en la reunión de Damas, **ausente** en el ensayo del Coro y **justificada** en Escuela Dominical.
>
> | Dónde se ve | Qué muestra |
> |---|---|
> | Promedio de Damas | Ana cuenta como presente — 100% |
> | Promedio del Coro | Ana cuenta como ausente — 0% |
> | Promedio de Escuela Dominical | Ana cuenta como justificada |
> | Informe de Ana, **por cuerpo** | Damas 100% · Coro 0% (100% inasistencia) · Escuela Dominical 100% justificación |
> | Informe de Ana, **en total** | 33,3% de asistencia, 33,3% de inasistencia, 33,3% de justificación |

Ningún promedio se contamina con el de otro cuerpo: en el promedio de un cuerpo, cada persona cuenta **solo con las actividades de ese cuerpo**. El porcentaje total de una persona sí junta todo lo suyo, que es lo que corresponde para saber cómo anda en general.

Por eso el informe por persona abre **su asistencia en cada cuerpo** cuando pertenece a más de uno, y todos los informes traen la tabla **actividad por actividad**: si un día tuvo tres actividades, se ven las tres por separado, además de la fila del día que las resume (y que avisa cuántas fueron).

Cada informe muestra arriba los **promedios**: de **asistencia**, de **inasistencia** y de **justificación**, además de cuántas actividades y cuántas personas entran en el cálculo. Y abajo, los mismos tres promedios desglosados:

| Desglose | Responde |
|---|---|
| **Por día** | Cómo estuvo la asistencia en cada fecha (indica si ese día hubo varias actividades) |
| **Actividad por actividad** | Cada actividad por separado, para los días con más de una |
| **Por cuerpo** | Qué cuerpo asiste más y cuál menos |
| **Por miembro** | Cómo va cada persona |

Cada fila lleva una barra de tres colores (presentes, justificados, ausentes) para comparar de un vistazo, y desde el promedio por miembro se salta al informe personal de esa persona con un clic. El informe por persona agrega el **detalle de todas sus marcas** —fecha, actividad, estado, motivo y detalle— y el recuento de **motivos de justificación**. Todo se imprime con el membrete de la iglesia.

## Pastores y Guías 🧑‍💼

### Los cargos, de menor a mayor

| Cargo | Cuántos puede haber |
|---|---|
| Guía de Obra | Varios — **no es cargo pastoral**: se le dice *Guía de Obra* |
| Pastora | Varias — **sí es cargo pastoral**, pero no una grada de la escala: va enseguida del primero |
| Pastor Probando | Varios |
| Pastor Diácono | Varios |
| Pastor Presbítero | Varios |
| **Pastor Presidente** | **Uno solo en toda la organización** |

El sistema hace cumplir lo último: al designar a un segundo presidente avisa quién ocupa el cargo —*«Ya hay un Pastor Presidente: Samuel Rodríguez. Cámbiele el cargo o su estado antes de designar a otro.»*— y no lo guarda. De los demás cargos puede haber tantos como haga falta.

> Las fichas que traían un cargo de la lista anterior (Pastor, Anciano…) **se conservan tal cual** y quedan anotadas en el arranque; al abrir cada una, el cargo antiguo aparece marcado como *(valor anterior)* hasta que se elija el de la escala nueva. Así ninguno se cambia sin querer.

### Un solo cónyuge, y con sus reglas

Antes había dos campos —uno hacia otro pastor y otro hacia un miembro—, que era confuso: el cónyuge es uno solo. Ahora hay **un único campo, Cónyuge**, que se elige entre los **miembros**, porque toda persona de la iglesia lo es, incluida la pastora. El vínculo queda también entre las **fichas de miembro** de ambos, en los dos sentidos, que es donde vive el matrimonio.

El selector **no ofrece a todos los miembros**, sino solo a quienes pueden serlo:

- del **sexo opuesto** al del pastor (tomado de su ficha de miembro), sin incluirlo a él mismo;
- **con trato de Pastor o Pastora por su propio registro**: las que tienen su **ficha en Pastores / Guías** o ese trato **fijado a mano** en su ficha de miembro;
- dentro de las iglesias que el usuario administra.

Esto último rige **solo para los cargos pastorales**. En la ficha de un **guía de obra** el selector ofrece a todas las personas del sexo opuesto, porque su cónyuge sigue siendo hermano o hermana.

Es decir: el pastor se casa con la pastora, no con una hermana. Si la persona todavía no aparece, el sistema dice qué falta: *«Ruth Mora todavía no tiene trato de Pastora. Regístrele su ficha en Pastores / Guías, o fíjele el trato de Pastora en su ficha de miembro, y vuelva a intentarlo.»* La misma comprobación se aplica al vincular el matrimonio desde la ficha de miembro.

> Ojo con la diferencia: quien se casa con un pastor **recibe** el trato de Pastora, pero para poder ser elegida como cónyuge tiene que tenerlo **por sí misma** —su propia ficha de pastora o el trato fijado—; si no, la regla se mordería la cola.

El matrimonio del pastor o de la pastora tiene dos reglas que el sistema hace cumplir:

- **Del sexo opuesto**: la esposa del pastor es mujer y el marido de la pastora es varón. Si los dos figuran con el mismo género, no lo guarda y lo dice: *«El cónyuge tiene que ser del sexo opuesto: Pedro Rivas figura como masculino, igual que esta ficha.»* Y si a la otra ficha le falta el género, pide registrarlo antes de vincularlos.
- **Con trato de Pastor o Pastora, nunca de Hermano, Hermana u Oficial**: al vincular el matrimonio, el cónyuge pasa **solo** a *Pastora* (o a *Pastor*), y ese trato ya no se puede cambiar a mano por uno de hermano: *«A esta persona le corresponde el trato de Pastora —por su ficha en Pastores / Guías o por su cónyuge—, así que no puede quedar como "Hermana".»* (Del guía de obra no: su cónyuge no cambia de trato.)

Vale en los dos sentidos: la esposa del pastor queda como **Pastora**, y el marido de una pastora registrada queda como **Pastor** en cuanto se vinculan.

Lo que estaba registrado se traspasó solo: lo que apuntaba a otro pastor pasó a su ficha de miembro.

## El pastor y la pastora son también miembros 🧍

El pastor y la pastora de una iglesia local **están en los dos registros**: su ficha en *Pastores / Guías* (su cargo, su ordenación, su ministerio) y su ficha de **miembro** de esa iglesia, como cualquier hermano.

El sistema lo cuida solo:

- Cada ficha de pastor se **enlaza con su ficha de miembro**. Si ya existe una con el mismo RUT, la reconoce y la enlaza sin que haya que hacer nada.
- Si todavía no existe, el listado de Pastores / Guías lo muestra en una columna —**Registrado** o **Falta registrarlo**— y al pie de su ficha aparece el botón **➕ Crear su ficha de miembro**, que la crea con sus mismos datos (nombres, RUT, iglesia, fecha de nacimiento, contacto y foto) y las deja enlazadas.
- De ese enlace depende el **trato**: quien tiene cargo pastoral es *Pastor* o *Pastora* en todo el sistema, y su cónyuge también; al **guía de obra** se le dice *Guía de Obra*.

### Cuando la pareja queda a medias 💍

Vincular el matrimonio de un pastor y registrarlo en Pastores / Guías son **dos actos distintos**, y entre uno y otro pueden pasar meses. En ese rato la pareja queda a medias: él figura como pastor y ella sigue con trato de hermana.

La regla que exige que los dos tengan trato de Pastor o Pastora se aplica **cuando el guardado es el que arma o cambia el vínculo** —o el sexo, del que depende—, no en cada guardado.

> Antes se aplicaba siempre, y el resultado era que esa ficha **no se dejaba guardar más**: ni para corregirle el teléfono, ni la dirección, ni nada. Castigaba a quien venía a arreglar otra cosa por una situación que no creó y que a lo mejor ni sabía. El criterio ahora es que una comprobación frena el guardado que **empeora** las cosas, no el que simplemente no arregla algo que ya estaba.
>
> Lo que ya estaba no se calla: aparece como aviso arriba de la ficha, diciendo a quién le falta el trato y dónde arreglarlo.

Y la comprobación mira **cómo va a quedar la ficha**, no cómo está. Eso cierra dos cosas que estaban mal: al **crear** una ficha ya vinculada no se comprobaba nada —no había id que consultar, así que la pareja a medias entraba igual— y al editar se leía el trato viejo, así que fijarle el trato de Pastora en el mismo guardado que arma el vínculo no servía de nada, que es justo lo que el aviso le dice a uno que haga. Ahora se resuelve en un solo paso.

### El RUT tiene que coincidir en las dos fichas

El enlace es lo que une las dos fichas, pero **el RUT es la verificación**: si es la misma persona, tiene que ser el mismo número en Pastores / Guías y en Miembros. Al pie de la ficha del pastor se ven los dos, uno debajo del otro, con su estado:

| Estado | Qué significa |
|---|---|
| **Registrado** | Tiene su ficha de miembro y el RUT calza en las dos |
| **Falta el RUT en su ficha** | Su ficha de miembro aún no lo tiene. Un botón lo **copia** desde aquí |
| **Falta el RUT aquí** | Es la ficha de pastor la que no lo tiene |
| **RUT distinto** | Los dos números existen y no son el mismo: hay que corregir el equivocado |
| **Falta registrarlo** | Todavía no tiene ficha de miembro |

El sistema **no deja que se descuadren**: no acepta enlazar dos fichas con RUT distinto, ni cambiar el RUT en una sola de ellas —*«El RUT no coincide con el de su ficha en Pastores / Guías (Ana Vera: 24.333.444-6). Corrija el que esté equivocado.»*—, y al copiar el RUT avisa si ya lo tiene otro miembro. Cualquier otro dato se sigue editando sin estorbo.

> Mientras tanto, quien no tenga RUT en su ficha de miembro **igual recibe el trato que le da su cargo**, porque el enlace basta. El RUT queda como comprobación para cuando se corrijan.

Así el pastor y la pastora aparecen en la membresía, cuentan en los totales de su iglesia, pueden integrar cuerpos, se les toma asistencia y tienen su bitácora, como corresponde a un miembro más.

## Registro de Servicios 🕊️

Deja constancia de cada servicio (culto) realizado: cuándo empezó y terminó, quién coordinó, quién leyó el salmo y cuál fue, quién predicó y sobre qué pasaje, cuánta gente asistió y cuánto se ofrendó.

### Personas que pueden o no estar registradas

**Coordinador(a)**, **salmista** y **predicador(a)** son un **desplegable con buscador**: al tocarlo se abre la lista de miembros, y escribiendo unas letras del nombre o del RUT se reduce a quien se busca.

- Si la persona **está registrada**, se elige de la lista y el registro queda enlazado a su ficha (aparece marcada con ✓ *registrado*). Si más adelante cambia su nombre en Miembros, el servicio muestra el nombre actualizado.
- Si **no está registrada** (una visita, un predicador invitado), se escribe el nombre y queda guardado igual, sin enlace.
- Si se escribe a mano un nombre que coincide exactamente con un miembro —y con uno solo—, el enlace se hace igual, sin tener que elegirlo de la lista. Esto vale también al importar desde CSV.

Esto usa otra capacidad general del motor: el tipo de campo **`persona`**, disponible para cualquier módulo. Guarda el nombre en su columna y el enlace en `<campo>_id`, que el sistema agrega solo.

### Salmo y mensaje

Ambos se citan igual: **libro** (los 66 de la Reina-Valera 1960, en orden del canon), **capítulo**, **versículo inicial** y **versículo final**. En el listado y al imprimir se muestran armados: *Salmos 23:1-6*, *Juan 10:11-18*.

El libro también es un **desplegable con buscador**: en vez de recorrer los 66, se escriben las primeras letras —*«corin»* deja 1 y 2 Corintios— y se elige. Sirve igual con el dedo en el teléfono que con las flechas y Enter en el teclado.

> Es una capacidad general del motor: cualquier campo de lista larga se dibuja así, y cualquier campo puede pedirlo con `buscador: true`.

### Asistencia y ofrenda

| Campo | Cómo se obtiene |
|---|---|
| Asistencia de adultos / de niños | Se escriben |
| **Total general de asistencia** | Se suma solo |
| Ofrenda recibida (total) | Se escribe |
| **Aporte a la corporación** | El porcentaje configurado (10% por defecto), calculado solo |
| **Queda para la iglesia** | El total menos el aporte |

Los tres campos calculados se actualizan **mientras se escribe** y no se pueden editar a mano: el servidor los vuelve a calcular al guardar, así que nunca quedan descuadrados. El porcentaje se cambia en **Configuración → Organización → Porcentaje de la ofrenda que aporta a la corporación**.

### La ofrenda queda registrada sola en tesorería

**La ofrenda entra completa a la tesorería de la iglesia**, que es lo que efectivamente pasó por la mesa, y de ahí **sale el aporte** para la corporación. Al guardar un servicio con ofrenda de $100.000, el sistema anota **tres movimientos**:

| Movimiento | En qué cuenta | Concepto |
|---|---|---|
| **Ingreso** de $100.000 | **Tesorería general** de la iglesia | *Ofrenda de servicio general del 5 de agosto de 2026* |
| **Egreso** de $10.000 | **Tesorería general** de la iglesia | *Aporte a la corporación (10%) — ofrenda de servicio general del 5 de agosto de 2026* |
| **Ingreso** de $10.000 | **Fondo para la corporación** de la iglesia | *Aporte a la corporación (10%) — ofrenda de servicio general del 5 de agosto de 2026* |

El saldo de la iglesia queda igual que si se hubiera anotado solo la diferencia —$90.000—, pero ahora **se ve lo que entró y se ve lo que salió**, cada cosa por su nombre: nadie tiene que adivinar de dónde salió el descuento. El concepto se arma solo con el tipo de servicio y su fecha, así se reconoce sin abrir nada. Ese aporte queda en el fondo de la iglesia hasta que se **traspasa a la corporación** (ver *Traspasos entre cuentas*).

Los tres movimientos se mantienen al día con el servicio: si se corrige la ofrenda, la fecha o el tipo, se corrigen; si la ofrenda queda en cero, desaparecen; y si se elimina el servicio, se van con él. Tampoco se editan ni se borran por separado desde Tesorería —el sistema remite al servicio—, y en esas filas ni siquiera se ofrece el botón de eliminar.

> Se puede apagar en **Configuración → Organización → Registrar la ofrenda en tesorería**, si prefieren seguir ingresando las ofrendas a mano.

Esta es también una capacidad general del motor: cualquier campo puede declarar `calcula` —`suma`, `resta` o `porcentaje` (fijo o tomado de una opción de configuración)— y el sistema lo resuelve en el servidor y en pantalla.

### Al imprimir

Cada servicio tiene su hoja con el membrete de la iglesia, los datos agrupados (salmo, mensaje, asistencia, ofrenda) y espacio para las firmas del coordinador y del predicador.

## Configuración del sistema ⚙️

Los administradores tienen en el menú la entrada **Configuración**, con opciones agrupadas:

- **Mantenimiento** — deja el sistema en mantenimiento y define el aviso que verán los usuarios.
- **Identidad** — nombre y lema de la institución.
- **Organización** — nombre del cuerpo de oficiales (de donde salen los oficiales supervisores y quienes reciben el trato de *Oficial*), porcentaje de la ofrenda que se aparta y si ese reparto se registra solo en tesorería.
- **Preferencias** — símbolo de moneda, registros por página, duración de la sesión, tamaño y calidad de las imágenes al subirlas, cuántos cumpleaños muestra el panel y si la bitácora registra automáticamente.

### Modo mantenimiento

Al activarlo, **solo los administradores pueden ingresar**. A los demás:

- Se les impide iniciar sesión, mostrando el aviso configurado.
- Si estaban trabajando, la siguiente acción los devuelve a la pantalla de acceso con ese mismo aviso (la restricción se aplica en el servidor, no solo en la interfaz).

Para agregar más opciones, añadirlas al arreglo `OPCIONES` de `server/ajustes.js`: aparecen solas en la pantalla, con su tipo de campo y valor por defecto.

## Mi perfil: cada persona mantiene sus datos 🙋

Toda persona con acceso al sistema tiene, en **Sistema → Mi perfil** (o tocando su nombre arriba a la derecha), una pantalla con dos pestañas: **Mis datos** y **Seguridad**.

### Lo suyo y lo de la iglesia

Arriba se ve, **sin poder cambiarlo**, lo que resuelve la iglesia: su RUT, su trato, su iglesia, su tipo de miembro, su estado, su bautismo y su rol en el sistema. Eso se cambia en la oficina, no en el perfil.

Debajo, **lo que sí es suyo**, ordenado en las mismas secciones que su ficha:

| Sección | Qué puede mantener al día |
|---|---|
| **Identificación** | Su foto, nombres, apellidos, fecha de nacimiento y sexo |
| **Educación y trabajo** | Nivel educacional, título, profesión u oficio, lugar de trabajo |
| **Estado civil y familia** | Estado civil y las fechas de matrimonio |
| **Contacto** | Teléfono, correo y dirección |
| **Contacto de emergencia** | Nombre, parentesco y teléfono |
| **Información médica** | Enfermedades, alergias e indicaciones |

Son **los mismos campos** de la ficha de miembro —mismas etiquetas, mismas listas, mismas condiciones—, porque salen de la misma definición: lo que se agregue mañana a la ficha aparece también aquí si es un dato propio de la persona.

### Se guarda donde corresponde

- Si la cuenta está **enlazada a su ficha de miembro**, lo que la persona edita **se guarda en esa ficha** —que es donde vive el dato— y su cuenta de usuario queda al día sola: el nombre, el correo y el teléfono se mantienen iguales en los dos módulos, como siempre.
- Si **no** está enlazada, se guarda en su cuenta, y el perfil lo dice.

Todo cambio queda anotado en el **historial del miembro**, igual que si lo hubiera hecho la oficina: *«Teléfono: (vacío) → +56 9 8765 4321 · Dirección: (vacío) → Los Aromos 123»*. Los datos de salud, como siempre, se anotan sin copiar su contenido.

> El servidor solo acepta esos campos: si llegara cualquier otro —el estado, el tipo de miembro, la iglesia, el RUT—, lo descarta. Nadie puede ascenderse a sí mismo editando su perfil.

## Contraseñas: entregarlas, cambiarlas y recuperarlas 🔐

### La contraseña inicial

En **Configuración → Acceso** el administrador define la **contraseña inicial** (*Iglesia2026* por defecto). Es la que reciben todas las cuentas nuevas: al crear un usuario **se deja el campo Contraseña vacío** y el sistema le entrega esa.

Sirve para entrar **una vez**: al hacerlo, el sistema exige cambiarla por una propia antes de dejar pasar a nada más. No es un aviso que se pueda saltar —el servidor cierra el resto del sistema hasta que se cambie—, porque una contraseña que otro conoce no es de quien la usa.

Lo mismo vale si el administrador escribe una contraseña a mano al crear o editar la cuenta: quien entre con ella tendrá que cambiarla.

### Qué puede ver el administrador

En la ficha de cada usuario, al pie, está **Acceso**, que dice en qué estado está su contraseña:

| Estado | Qué muestra |
|---|---|
| **Tiene la contraseña inicial del sistema** | El RUT y **la contraseña**, para dictársela a su dueño |
| **Tiene una contraseña puesta por el administrador** | Que es la que se escribió al crear la cuenta; el sistema no puede mostrarla |
| **La cambió su dueño el …** | Solo eso: la contraseña que una persona eligió **no se puede ver** |

Esto último no es una limitación que se pueda levantar: el sistema **nunca guarda la contraseña**, guarda una huella suya (bcrypt) que sirve para comprobarla pero no para leerla. Es lo que impide que alguien que consiga una copia de la base de datos —un respaldo, el disco del servidor— se quede con las contraseñas de toda la iglesia, que además muchas personas repiten en su correo o en su banco.

Para eso está el botón **🔄 Restablecer a la contraseña inicial**: deja la cuenta con la inicial, la muestra en pantalla para entregársela, y al entrar con ella su dueño tendrá que elegir una nueva. Resuelve lo mismo —que la persona pueda volver a entrar— sin que nadie tenga que conocer contraseñas ajenas.

### Recuperarla sin molestar a nadie 🔑

Cada persona puede definir, en **Mi cuenta**, una **pregunta de recuperación** (*«¿Cómo se llamaba mi primera mascota?»*). El sistema la ofrece justo después del primer cambio de contraseña, que es cuando sirve.

Si un día la olvida, en la pantalla de acceso usa **¿Olvidó su contraseña?**: escribe su RUT, el sistema le muestra su pregunta, la responde y elige una contraseña nueva. Al responder no importan las mayúsculas, las tildes ni los espacios de más.

- Tras **5 respuestas equivocadas** la recuperación queda **bloqueada**, y solo el administrador la habilita otra vez (botón **🔓 Habilitar su recuperación** en la ficha del usuario). Así, quien conozca el RUT de otro no puede ir probando respuestas.
- La respuesta también se guarda cifrada: tampoco se puede leer.
- Quien no haya definido su pregunta, o prefiera no hacerlo, recurre al administrador para que le restablezca la contraseña. Toda la recuperación por pregunta se puede desactivar en **Configuración → Acceso**.

### Seguridad, en Mi perfil 🔐

Cualquier usuario, sea cual sea su rol, tiene en el menú **Sistema → Mi perfil → Seguridad**: ahí cambia su contraseña (pidiéndole la actual) y define, cambia o quita su pregunta de recuperación.

### El largo mínimo

Se define en **Configuración → Acceso** (6 caracteres por defecto, entre 4 y 40) y rige en todas partes: al cambiarla, al recuperarla y al escribirla el administrador.

## Permisos personalizados por usuario 🔑

El rol da el punto de partida. En la ficha de cada usuario se afina, **módulo por módulo**, lo que esa persona en particular puede hacer. Cada módulo se deja en uno de cinco escalones:

| Escalón | Qué puede |
|---|---|
| **Nada** | El módulo no le aparece |
| **Solo ver** | Mira, no toca |
| **Ver y corregir** | Corrige lo que ya está, pero no agrega ni elimina |
| **Ver, agregar y corregir** | Trabaja en el módulo, pero no elimina nada |
| **Todo** | Incluye eliminar |

Los cinco escalones cubren lo corriente; para lo que no calce con ninguno están las **casillas sueltas** (ver · crear · editar · eliminar) al lado de cada módulo. Si se quita *ver*, se van todas las demás con él: sin poder mirar no se puede hacer nada.

Los módulos van **agrupados y plegables**, con un buscador arriba, y cada grupo tiene sus propios atajos para aplicar un escalón a todo el grupo de una vez. Abajo, un **resumen en castellano** dice qué va a poder hacer esa persona, sin tener que leer una tabla de cien casillas.

### Perfiles de permisos 🎭

Un **perfil** es un juego de permisos con nombre —*«Tesorero de cuerpo»*, *«Secretaria de cuerpo»*— que se arma una vez y se le pone a las personas que hacen ese trabajo. Es un módulo como cualquier otro: se **crea, se edita y se elimina** desde el sistema.

El perfil queda **enlazado**, no copiado: si mañana se decide que los tesoreros de cuerpo también vean las actas, se cambia el perfil y **cambian todos los que lo tienen puesto**, sin abrir uno por uno.

Al pie de la ficha de cada perfil está **quiénes lo tienen**, y se le puede poner **a varios de una vez** marcándolos en una lista. También se pone desde la ficha de cada usuario, en *Perfil de permisos*.

Un perfil que alguien está usando **no se puede eliminar** —el sistema dice cuántos lo tienen—: primero hay que cambiárselo, o archivarlo. Un perfil archivado ya no se ofrece al asignar, pero sigue funcionando para quienes ya lo tienen.

El sistema trae tres para partir, y se editan como cualquier otro dato:

| Perfil | Para qué |
|---|---|
| **Tesorero(a) de cuerpo** | Lleva la plata de su cuerpo: sus cuentas, sus movimientos y sus cuotas |
| **Secretario(a) de cuerpo** | Pasa la lista y lleva las actas de su cuerpo; la tesorería la mira, no la toca |
| **Líder de cuerpo** | Maneja la gente y las actividades de su cuerpo, sin tocar la plata |

### El orden: de lo particular a lo general

Tres escalones deciden lo que puede hacer cada persona. Gana el primero que diga algo sobre ese módulo:

1. **Las excepciones de esa persona** — en su ficha, para lo que se salga de su perfil
2. **El perfil que tenga asignado**
3. **Su rol**

En la ficha del usuario el editor lo dice en la cabecera: *«Acá van solo las excepciones de esta persona. Lo que no se ajuste sigue su perfil.»*

### Pasar lista cuando la actividad convoca a varios cuerpos

A una actividad puede asistir más de un cuerpo. Quien tiene **cuerpos asignados** pasa lista **solo a los suyos**: aunque la actividad convoque a siete, ve y marca únicamente a los de su cuerpo, y la pantalla se lo dice —*«Le toca pasar lista solo a su cuerpo»*—.

No es solo lo que se muestra: si llegara una marca de alguien de otro cuerpo, el servidor la rechaza. Y el progreso de marcado que se ve es el de su parte, no el de toda la actividad.

Sin cuerpos asignados —el caso del administrador— le tocan todos los convocados.

### Los permisos y el alcance trabajan juntos

Los permisos dicen **qué acciones** puede hacer; las **iglesias** y los **cuerpos** asignados dicen **sobre qué datos**. Un tesorero de cuerpo se arma con las dos cosas: el perfil, más su cuerpo asignado.

Un usuario con el cuerpo *Dorcas* asignado y ese perfil ve, comprobado: **un** cuerpo (el suyo), **sus dos cuentas** de tesorería —ni las de la iglesia ni las de la corporación—, **34 miembros** de los 179 del sistema, y si intenta abrir otro cuerpo o crear un acta, el servidor lo rechaza.

Todo se verifica en el servidor en cada petición: no depende de lo que muestre la pantalla.

## Bitácora de miembros 🗒️

Hay **tres historiales**, uno por cada cosa que tiene vida propia en la organización: el del **miembro** (esta bitácora), el de la **iglesia** y el del **pastor o guía** (ver *Historial y documentos de la iglesia y del pastor*). Los tres funcionan igual: se ven al pie de su ficha, mezclan registros automáticos y manuales, y cada línea se puede corregir o eliminar. Si en Configuración se desactiva el registro automático, se desactiva en los tres.

Cada miembro tiene un **historial** que se ve al pie de su ficha, con dos tipos de registro:

**Automáticos** (mientras la opción esté activa en Configuración):

| Hecho | Queda registrado como |
|---|---|
| Alta del miembro | Anotación |
| Cambio de sus datos | Cambio de datos (detalla campo, valor anterior y nuevo) |
| Cambio de estado | Cambio de estado |
| Entrada o salida de un cuerpo | Ingreso / Salida de cuerpo |
| Queda como líder de un cuerpo | Anotación |
| Solicitud, ayuda social, certificado o credencial | Su tipo correspondiente (al crearse y al cambiar de estado) |
| Documento adjuntado al miembro | Documento |

Los datos marcados como **sensibles** —enfermedades, alergias, indicaciones médicas y la nota importante— se anotan sin copiar su contenido: *«Alergias: actualizada»*.

**Manuales**: el botón *Agregar anotación* permite registrar visitas, disciplinas, reconocimientos u observaciones, con su fecha y tipo.

### Corregir o eliminar un registro

Cada línea del historial tiene sus dos botones: **✏️ editar** y **🗑️ eliminar**.

- **Editar** abre la misma ventana de la anotación, con la fecha, el tipo y el texto ya cargados. Al guardar, la línea queda marcada como *✏️ editado*, para que se sepa que se corrigió.
- **Eliminar** pide confirmación mostrando el texto del registro. Si es un registro automático, la confirmación lo advierte, porque lo generó el sistema al ocurrir el hecho.

Los botones solo aparecen si el usuario tiene permiso para editar o eliminar en la bitácora —y el servidor lo verifica igual, no solo la pantalla—, así que a un usuario de *solo consulta* no se le muestran.

El módulo **Bitácora de Miembros** también aparece en el menú, con búsqueda y filtros sobre todos los registros. Desde ahí se abre la ficha completa de un registro, que además admite un documento adjunto.

## Arquitectura (expandible y modificable)

```
server/
  index.js         Servidor Express, metadatos, panel, carga de archivos
  registry.js      Carga los módulos declarados en server/modules/
  db.js            SQLite + AUTO-MIGRACIÓN (crea tablas, columnas e índices)
  crud.js          Motor CRUD genérico (API REST para todos los módulos)
  auth.js          Login con JWT y middleware de autorización
  permissions.js   Roles y matriz de permisos (editable)
  seed.js          Datos iniciales (admin + iglesia de ejemplo)
  modules/         ★ UN ARCHIVO POR MÓDULO ★
public/
  index.html, app.js, styles.css   Interfaz (se autogenera desde los metadatos)
```

El sistema está **dirigido por esquemas**: cada módulo es un archivo declarativo. El servidor crea su tabla, publica su API y el frontend genera su menú, listado, filtros y formulario **sin escribir más código**.

### Agregar un módulo nuevo

Crear `server/modules/mi_modulo.js`:

```js
module.exports = {
  name: 'eventos',
  label: 'Eventos',
  labelSingular: 'Evento',
  icon: '🎉',
  group: 'Organización',
  order: 15,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'lugar'],
  listFields: ['nombre', 'fecha', 'iglesia_id', 'estado'],
  fields: [
    { name: 'nombre', label: 'Nombre', type: 'text', required: true },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'estado', label: 'Estado', type: 'select', options: ['Programado', 'Realizado', 'Cancelado'], default: 'Programado' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
```

Reiniciar el servidor: la tabla se crea sola y el módulo aparece en el menú con su listado, búsqueda, formulario y permisos.

### Modificar un módulo existente

Agregar el campo al arreglo `fields` del módulo y reiniciar: la columna se crea automáticamente **sin perder datos**. (Eliminar o renombrar columnas sí requiere migración manual.)

### Límites de los números y del dinero 🔢

Un campo `number` o `money` puede declarar `min` y `max`, y el servidor los hace cumplir en cada guardado. Además, **ningún número pasa de diez mil millones**, lo declare o no: no es una limitación real —es más que el presupuesto de cualquier iglesia— sino un freno para que un valor absurdo no entre a la base y eche a perder todas las sumas que dependen de él.

Hacía falta: se comprobó que se podía guardar un ingreso de **−50.000** y otro de **1e308**, y que después de eso el balance de la iglesia respondía «1e+308». No es que quedara grande: dejaba de ser un número con el que se pueda trabajar. Un tesorero que teclee un signo menos o un dígito de más descuadraba los libros sin que nada avisara.

El límite no es el mismo para todos, porque las cosas no son iguales:

| Campo | Límite | Por qué |
|---|---|---|
| Movimiento de tesorería, traspaso | mayor que cero | Un movimiento de cero no es un movimiento, y uno negativo es un egreso mal anotado |
| Cuota, cuota mensual del cuerpo, ayuda, inventario, ofrenda | cero o más | Pueden ser cero —una cuota condonada, un cuerpo que no cobra— pero nunca negativos |
| Saldo inicial de una cuenta | sin mínimo | Hay cuentas que parten en rojo |
| Meses de período de prueba | de 0 a 60 | Más de cinco años es un error de tecleo |

El aviso dice **cuál es el límite**, no solo que está mal, y a quien escribe un monto negativo le dice qué hacer en su lugar: *«Tiene que ser mayor que cero. Si lo que quiere es restar, anótelo como egreso.»* El formulario lo marca en rojo **al salir del campo**, antes de guardar; el servidor lo vuelve a comprobar igual, que es la comprobación que manda.

### Tipos de campo disponibles

`text` · `textarea` · `number` · `money` · `date` · `time` · `select` (con `options`) · `boolean` · `ref` (relación a otro módulo, con `ref`) · `multiref` (varias relaciones, ej. integrantes/asistentes) · `file` (adjuntos con carga) · `email` · `tel` · `password` · `rut` (valida dígito verificador y guarda normalizado)

Cualquier campo acepta además:

- `unique: true` — impide valores repetidos.
- `showIf: { field, equals }` o `showIf: { field, in: [...] }` — el campo se muestra (y se exige, si es obligatorio) solo cuando otro campo tenga ese valor.
- `showIf: { field, menorDe: 18 }` — se muestra según la **edad** que da una fecha (así aparecen los datos del adulto responsable).
- `buscador: true` — el campo se dibuja como **desplegable con buscador** en vez de una lista larga (los libros de la Biblia, los miembros). Con más de 20 opciones se hace solo; `buscador: false` lo impide.
- `seccion: 'Contacto de emergencia'` — abre con ese campo un bloque de la ficha, con su encabezado. Si el campo tiene condición, el encabezado se oculta con él.
- `destacado: true` — el campo se dibuja resaltado (la nota importante).
- `sensible: true` — cuando cambia, el historial anota que se actualizó **sin copiar su contenido**.

Y un módulo acepta `menu: false`, para no ocupar lugar en el menú y manejarse desde la ficha de otro (los documentos y el historial de una iglesia o de un pastor).

### Lógica propia por módulo

- `hooks.beforeSave(data, ctx)` — validar o transformar antes de guardar (ej.: Usuarios cifra la contraseña; Asistencias calcula el total).
- `hooks.beforeDelete(row, ctx)` — vetar eliminaciones (ej.: no eliminar el último administrador).
- `extraRoutes(router, ctx)` — endpoints propios (ej.: `GET /api/tesoreria/resumen`).
- `printable: true` — habilita la vista de impresión (Certificados, Credenciales y Actas ya traen plantillas elegantes; el resto usa una ficha genérica).

### Prueba de humo: que ninguna pantalla se rompa

Como el sistema arma solas todas sus pantallas, un error en el motor las rompe todas a la vez. `pruebas/humo.js` abre **cada módulo tres veces** —su listado, el formulario de uno nuevo y el de editar el primer registro— más el panel, asistencia, informes, el perfil y configuración, en computador (1366) y en teléfono (390), y avisa si alguna:

- se queda pegada en *«Cargando…»*
- se sale de lado (hay que desplazarse en horizontal)
- tira un error en el navegador

```bash
npm install && npx playwright install chromium          # una sola vez
URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=... npm run humo
CHROMIUM=/ruta/al/chrome npm run humo                   # si ya hay un Chromium instalado
```

Cualquier módulo nuevo queda cubierto solo: la lista de pantallas sale del propio sistema, no de un listado escrito a mano. Playwright es dependencia de desarrollo y **no viaja en la imagen de producción**.

Las otras cuatro pruebas miran lo que la de humo no ve, y ninguna necesita navegador:

- `npm run concurrencia` — que nadie pierda su trabajo cuando dos trabajan sobre lo mismo, incluida la lista de asistencia que pasan dos (ver *[Varias personas trabajando a la vez](#varias-personas-trabajando-a-la-vez-)*).
- `npm run carga` — que el sistema responda rápido con mucha gente adentro. Con `PREPARAR=1` llena la base con 600 fichas inventadas, 12 cuerpos, 150 actividades y 3.000 movimientos para que la medición diga algo — y por eso **se niega a hacerlo si la base tiene fichas que no generó ella**: esos datos van directo a la base, sin pasar por el sistema, y una base con datos de una iglesia no se toca. Para medir, use una base aparte: `DATA_DIR=/tmp/carga`.

  `LIMPIAR=1 npm run carga` dice cuántos datos de prueba hay en una base y cuántas fichas son de verdad, sin borrar nada; `LIMPIAR=borrar` los borra. Se reconocen por sus señas: los RUT del 30.000.000 en adelante —un tramo que no está en uso—, los cuerpos «Cuerpo de prueba N» y los movimientos «Movimiento de prueba N».
- `npm run motor` — **las piezas de adentro, una por una**, sin servidor y sin navegador: el RUT y su dígito verificador, cómo se arma el nombre de cada persona, los permisos escalón por escalón, el alcance por iglesia y por cuerpo, la limpieza del texto de las actas, la planilla y qué archivos se aceptan. Son 75 comprobaciones y corren en menos de un segundo. Atrapan el error fino: ese que no rompe ninguna pantalla —así que la prueba de humo lo deja pasar— y que nadie ve hasta que ya pasó algo.

  Corren contra una base **recién creada y descartable**, nunca contra la del sistema; el corredor la prepara y la borra. No es una formalidad: alguna de esas pruebas escribe y borra para comprobar lo suyo, y hacerlo sobre los datos de la iglesia sería imperdonable. Por eso, además, se niegan a arrancar si se las llama a mano sobre la base de siempre.

  Varias están escritas alrededor de errores que de verdad ocurrieron: la etiqueta que mostraba solo los apellidos, la iglesia principal que acotaba sin decirlo, la excepción de permisos que tiene que poder **quitar** y no solo dar. Agregar un `algo.test.js` en `pruebas/motor/` lo incorpora solo.
- `npm run seguridad` — que los archivos no se entreguen sin sesión ni se abran como página, que no se pueda subir una página web —ni disfrazada de foto—, que el pase de sesión no sirva escrito en la dirección, que la entrada se cierre al que insiste, que el respaldo se baje entero y sano, que la copia automática se haga y se pueda volver a ella, que la planilla nunca traiga una fila que la pantalla no muestre, que lo que se borra quede anotado en cualquier módulo y sus archivos se vayan con la ficha, que cambiar la contraseña cierre las sesiones abiertas —incluso cuando la restablece el administrador— sin dejar afuera a quien la cambió, que el navegador reciba sus reglas de seguridad, que el registro de cambios no se pueda maquillar, que el alcance por cuerpo se respete aunque se escriba la dirección a mano —su gente, sus cuotas y su cobro— y que elegir con qué iglesia trabajar nunca amplíe lo asignado. Son cosas que, si un día se rompen, no se rompen a la vista: todo seguiría pareciendo normal.

## API REST

Todas las rutas bajo `/api`, autenticadas con `Authorization: Bearer <token>`:

```
POST   /api/auth/login              { rut, password } → { token, user }
GET    /api/meta                    módulos y esquemas visibles para el usuario
GET    /api/dashboard               indicadores del panel
POST   /api/upload                  carga de archivos (multipart, campo "archivo")
GET    /api/<modulo>                ?q=&page=&sort=&dir=&f_<campo>=&desde=&hasta=
GET    /api/<modulo>/options        opciones {id, label} para selectores
GET    /api/<modulo>/:id
POST   /api/<modulo>
PUT    /api/<modulo>/:id
DELETE /api/<modulo>/:id
GET    /api/asistencias/agenda      actividades de un período, con su avance
GET    /api/asistencias/:id/lista   integrantes convocados con su marca
POST   /api/asistencias/:id/lista   guarda todas las marcas de una vez
GET    /api/asistencias/informe     informes y promedios
GET    /api/tesoreria/resumen       ingresos, egresos, balance y por categoría
POST   /api/importar/<modulo>       { filas: [...], prueba: true|false } importación masiva
```

## Seguridad

- Contraseñas cifradas con bcrypt: **el sistema no puede leerlas**, ni siquiera para el administrador (ver *Contraseñas*). Sesiones JWT de 12 h.
- La contraseña que entrega el administrador **obliga a cambiarla** en el primer ingreso, y hasta entonces el servidor no deja hacer nada más.
- **Los archivos subidos piden sesión.** Los carnets, los certificados y las fotos ya no se entregan a quien tenga el enlace: hay que estar dentro del sistema y que ese archivo pertenezca a una ficha que esa persona pueda ver. El secretario de un cuerpo no abre el carnet de un miembro de otra iglesia, aunque le reenvíen la dirección.
- **Cambiar la contraseña cierra las sesiones que estuvieran abiertas.** Antes no: quien hubiera entrado con la contraseña vieja seguía adentro hasta que su pase caducara solo, que según la configuración puede ser un mes. Si a alguien le robaban la clave, cambiarla no lo sacaba. Ahora vale para los tres casos —la cambia su dueño, la define el administrador o la restablece—, y ese último es justamente el más importante: restablecerle la contraseña a alguien echa de la sesión a quien esté usando la cuenta. A quien la está cambiando no se le corta: recibe un pase nuevo en el acto.
- **Las reglas que hace cumplir el navegador.** Cuatro cabeceras que cierran de golpe toda una familia de problemas: `Content-Security-Policy` (lo que la página ejecuta y muestra sale solo de este mismo sitio, y **no se ejecuta nada escrito dentro de la propia página** — por eso los clics de las filas se escuchan desde un solo lugar y no dentro de cada etiqueta), `X-Content-Type-Options` (el navegador no adivina el tipo de un archivo), `X-Frame-Options` (otro sitio no puede meter el sistema en una ventana suya para engañar a quien lo usa) y `Referrer-Policy` (al salir a otro sitio no se le cuenta qué ficha se estaba mirando).
- **No entra cualquier archivo, y ninguno se abre como página.** Se aceptan solo los formatos que la iglesia usa —fotos, PDF, documentos de Word, Excel o PowerPoint, y texto—, y no basta con ponerle el nombre: se miran los primeros bytes, así que una página web llamada `foto.jpg` se rechaza igual. Al entregarlos, el tipo lo pone el sistema desde su propia lista (nunca el nombre del archivo), se manda `nosniff` para que el navegador no adivine otro, y **solo las fotos y los PDF se muestran en pantalla**: lo demás se baja. Sin esto, quien pudiera adjuntar un documento podía dejar un archivo que corriera en el navegador del que lo abriera, con su sesión adentro y en el dominio del propio sistema.
- **El pase de sesión no viaja escrito en la dirección.** Se aceptaba `?token=…` en todas las rutas por un solo enlace —el de bajar el respaldo—, y un pase escrito en la dirección queda anotado en los registros del servidor, en el historial del navegador y en cualquier enlace que se comparta. Ahora solo se acepta por cabecera o en la galleta de sesión, que es la que el navegador manda sola en las descargas.
- **La entrada se cierra al que insiste.** Cinco contraseñas erradas sobre un mismo RUT y hay que esperar un minuto; si insisten, cinco y después quince. Se cuenta además por dirección de internet —para frenar a quien va probando RUT tras RUT—, pero ahí el tope es mucho más alto (veinte), porque toda la iglesia sale por el mismo wifi y nadie tiene por qué quedar afuera por el despiste del de al lado.
- La recuperación por pregunta se **bloquea tras 5 intentos** fallidos.
- Permisos verificados **en el servidor** en cada petición (la interfaz solo refleja lo permitido).
- Alcance por iglesia aplicado en el servidor (lectura y escritura).
- Protecciones: no eliminar el propio usuario ni el último administrador; correo de usuario único.

> ⚠️ **`JWT_SECRET` es la llave con que se firman las sesiones.** Si falta, el sistema usa una de reserva escrita en el código, que conoce cualquiera que haya visto el repositorio: con ella se puede fabricar una sesión de administrador sin saber ninguna contraseña.
>
> Ya no hay que adivinar si está puesta. El sistema **lo dice al arrancar**, con letras grandes en el registro, y lo muestra en `/health`:
>
> | Lo que dice `/health` | Qué significa |
> |---|---|
> | `"sesiones": "firmadas con su propia llave"` | Bien |
> | `"sesiones": "SIN LLAVE PROPIA: falta la variable JWT_SECRET en el servidor"` | Hay que ponerla, y `"ok"` viene en `false` |
>
> Al ponerla **se cierran las sesiones abiertas** y todos vuelven a entrar: es lo esperado, porque las que había estaban firmadas con la otra llave.

### Respaldo: bajarse todo en un archivo 💾

Los datos viven en un solo disco, y los discos se pierden. En **Configuración**, al pie, el administrador tiene **⬇️ Descargar el respaldo**: se baja un solo archivo con **todo** —la base de datos completa y los documentos y fotos que se han subido— para guardarlo donde quiera.

La copia de la base no se hace copiando el archivo por debajo (mientras alguien guarda, esa copia saldría a medias), sino con la copia en caliente de SQLite: sale entera y coherente aunque el sistema se esté usando en ese momento. Se comprime al vuelo, así que el archivo pesa bastante menos de lo que dice el panel y no hace falta que quepa antes en el servidor.

Para restaurarlo: descomprimir el paquete y dejar `iglesias.db` y la carpeta `uploads/` en la carpeta de datos del sistema.

### La copia que se hace sola, todas las noches 🕒

El respaldo de arriba sirve mientras alguien se acuerde de bajarlo, y nadie se acuerda todas las semanas. Por eso el sistema guarda además **una copia diaria de la base**, comprimida, junto a los datos, y conserva **las últimas** (7 por omisión). Se hace a partir de la hora que se fije —las 3 de la madrugada por omisión—; si el servidor estuvo apagado a esa hora, la hace en cuanto vuelve.

**Qué protege y qué no.** La diferencia importa y conviene tenerla clara:

| | Copia automática | Respaldo que se baja |
|---|---|---|
| Algo se borró por error | ✅ se vuelve a la de anoche | ✅ |
| Un mes quedó mal cargado | ✅ | ✅ |
| Se perdió el servidor entero | ❌ vivía en el mismo disco | ✅ si está guardado en otra parte |

Por eso el panel sigue insistiendo en bajar el respaldo completo: **la copia automática no lo reemplaza**.

Se copia la base y **no** los documentos subidos, a propósito: la base cambia todos los días y es la que se puede echar a perder de golpe, mientras que un documento, una vez subido, no lo toca nadie más. Duplicar cada noche todas las fotos llenaría el disco sin proteger de nada nuevo.

En **Configuración → 🕒 La copia que se hace sola** se ve cuándo fue la última, cuántas hay guardadas y lo que pesa cada una; se puede **bajar cualquiera** y **hacer una en el momento** sin esperar a la noche. Un respaldo automático que nadie ve es un respaldo en el que nadie confía.

Se ajusta en **Configuración → Respaldos**: si se hace o no, a qué hora y cuántas se guardan (entre 2 y 60). Antes de escribir una copia nueva se borran las viejas que sobran —así el sitio que liberan queda disponible— y si el disco está apretado no se hace y se anota el motivo.

Para volver a una: descomprimirla (`gunzip iglesias-2026-08-23.db.gz`) y dejar el `iglesias.db` resultante en la carpeta de datos, con el sistema detenido.

### Los archivos no quedan sueltos 🧹

Al borrar una ficha con documentos, los archivos seguían en el disco para siempre: nadie los veía —no hay ficha desde donde llegar a ellos— pero ocupaban lugar, y lo que se acumula sin que nadie mire termina llenando el disco.

Se limpia por dos vías, porque una sola no alcanza:

- **Al borrar una ficha**, sus archivos se van con ella en el mismo momento. Antes se comprueba que ninguna otra ficha los esté usando: dos pueden apuntar al mismo archivo, y borrar el de una dejaría a la otra sin su foto.
- **Una barrida cada noche**, después del respaldo —no antes: si la barrida se equivocara, lo que borró todavía está en la copia de esa noche—, para los que quedaron sueltos de antes y para los que se suben y nunca se guardan: uno elige una foto, se arrepiente y cierra el formulario, y el archivo ya está en el disco.

A un archivo recién subido se le dan **7 días** antes de considerarlo perdido. No puede ser inmediato: entre que se sube y se guarda el formulario que lo enlaza pasan minutos, y a veces la persona deja la pantalla abierta y vuelve al otro día.

### Registro de Cambios: quién tocó el dinero 🧾

Los miembros, las iglesias y los pastores tienen su **historial**, que cuenta su vida en la iglesia. El **Registro de Cambios** es otra cosa: está para responder *«¿quién cambió este monto?»* sin que quede en la palabra de nadie.

La regla tiene dos partes, y la diferencia es a propósito:

**Todo lo que se borra, en cualquier módulo.** Borrar es raro y no se deshace, y con la ficha se va también su propio historial: si mañana falta un miembro de la lista, el Registro de Cambios es el único lugar donde puede quedar quién lo borró y qué decía. Por eso la eliminación se anota siempre, en todos los módulos.

**Las creaciones y los cambios, solo donde importan**: el dinero —tesorería, cuentas, traspasos, cuotas y ayudas sociales—, las llaves del sistema —usuarios y perfiles de permisos— y lo que no lleva historial propio —los cuerpos, sus directivas, sus actas y quiénes los integran—. Miembros, pastores e iglesias no están ahí porque cada uno tiene su **bitácora**, que cuenta lo mismo con más detalle y en el lugar donde se busca.

De cada anotación queda la fecha y la hora, quién fue, qué registro era y qué cambió exactamente:

| | |
|---|---|
| *Cambio* | Monto: $ 50.000 → $ 1.250.000 |
| *Eliminación* | Fecha: 2026-08-22 · Cuenta: Tesorería general · Tipo: Ingreso · Monto: $ 1.250.000 |

Se escribe solo y **no se puede agregar, corregir ni borrar a mano** —el sistema lo impide, incluso al administrador—: un registro que se puede maquillar no sirve para lo que existe. Lo ven el administrador, el pastor y el tesorero; no aparece para el secretario ni para quien solo consulta.

Lo único que se borra sin quedar anotado son las **marcas de asistencia**: se borran de a montones cada vez que alguien corrige una lista, y anotarlas una por una sepultaría el registro.

Al anotar una eliminación se guarda un resumen de lo que traía la ficha, pero de los campos marcados como **sensibles** —las enfermedades, las alergias, la nota importante— solo queda constancia de que traían algo, no de qué: el Registro de Cambios lo leen el pastor y el tesorero, y los datos de salud de una persona no tienen por qué quedar copiados ahí para siempre.

### Lo que se baja en cada visita 📶

El programa de la pantalla son unos 300 KB en el disco, pero **por la red viaja comprimido en 82 KB**, y con los estilos y la página, la primera visita completa son unos 100 KB. La dirección lleva la versión escrita (`/app.js?v=1.54.0`), así que al publicar una versión nueva el navegador se la baja sola, y como la dirección de una versión ya nunca cambia de contenido, se marca `immutable`: el navegador deja de preguntar si sigue vigente y se ahorra ese viaje en cada visita.

Lo que sí pesaba en cada entrada era **la definición de los módulos** —32 módulos y 380 campos, unos 180 KB de texto— que la pantalla pide al entrar y en cada recarga. Ahora esa respuesta lleva una firma de su contenido: quien ya la tiene recibe «lo mismo de antes» y no se baja nada. Son unos 17 KB menos por recarga, sin riesgo de quedarse con una versión vieja, porque si algo cambió —el sistema o los permisos de esa persona— la firma cambia.

Entrar son **5 consultas al servidor** en total, y el panel de control queda a la vista aproximadamente **1,3 segundos** después de apretar *Entrar*.

## Varias personas trabajando a la vez 👥

El sistema está hecho para que la iglesia entera esté adentro al mismo tiempo —el secretario en Miembros, el tesorero en Tesorería, tres cuerpos pasando lista— sin que nadie quede esperando ni pierda lo que hizo.

### Que nadie pierda su trabajo

Cuando dos personas abren la **misma ficha** y las dos guardan, el segundo guardado ya no pisa al primero en silencio. Se le avisa a quien llegó después, diciéndole **quién** guardó antes, y se le dan sus dos salidas —lo que escribió sigue en pantalla, no se pierde:

| | |
|---|---|
| **Ver cómo quedó** | Vuelve a abrir la ficha con lo que guardó el otro, para rehacer lo suyo sobre eso |
| **Guardar lo mío de todas formas** | Deja su versión, que es lo que corresponde cuando cada uno cambió una cosa distinta |

Cómo se da cuenta: cada ficha lleva un **número de versión** que sube con cada guardado, y quien guarda manda el que tenía al abrirla. Si no calza, es que alguien más guardó en el medio.

> Antes eso se deducía de la **hora** del último guardado, y ahí había un agujero: la hora se escribe con precisión de un segundo, así que dos personas que guardaran **dentro del mismo segundo** dejaban exactamente la misma marca, el sistema no notaba nada y la segunda le borraba el trabajo a la primera sin decir una palabra. Y ese —dos personas apretando *Guardar* casi a la vez— es justo el caso para el que existe todo esto. Se comprobó: con un segundo de diferencia avisaba; dentro del mismo segundo, no. Con el número de versión da lo mismo cuánto tiempo pase.

Cada guardado, además, entra **entero o no entra**: la ficha, lo que su módulo haga después (los movimientos de tesorería de una ofrenda, las cuotas de un integrante) y el historial quedan en un solo acto. Si algo falla a mitad de camino, no queda nada a medias.

### Dos personas pasando la misma lista

Es lo que más se da un domingo, y tiene su propia regla: **al guardar se mandan solo las marcas que esa persona cambió**, nunca la lista entera. Si se mandara completa, quien la abrió antes borraría en blanco todo lo que otro hubiera marcado mientras tanto —dos secretarios pasando la misma lista, o la misma persona con el teléfono y el computador abiertos—.

Además, cada guardado devuelve **cómo quedó la lista**, y la pantalla se pone al día con lo que marcaron los demás sin tocar lo que uno tiene a medio marcar. Abajo se avisa: *«Guardado a las 10:42 · 20 marca(s) de otra persona»*. Lo mismo vale para el respaldo que queda en el teléfono cuando se corta el internet: guarda solo el trabajo de esa persona, no una foto vieja de la lista.

Cuando dos marcan **a la misma persona**, vale la última: en asistencia esa es la corrección, no un choque.

Y cada uno marca **solo a los integrantes de los cuerpos que tiene asignados**, aunque la actividad convoque a varios.

### Que el sistema responda

Medido con `npm run carga`: personas trabajando **sin parar y a la vez** —abriendo el panel, recorriendo listados, buscando, abriendo fichas y guardando—, sobre una base del tamaño de una iglesia grande (600 miembros, 30.000 marcas de asistencia, 3.000 movimientos de tesorería). Con **12 personas**, que es lo que se medía antes:

| | Antes | Ahora |
|---|---|---|
| Peticiones atendidas por segundo | 54 | **226** |
| Lo que demora casi todo (p95) | 235–665 ms | **68–108 ms** |
| La respuesta más lenta que se vio | 1.060 ms | **140 ms** |

Y con **40 personas a la vez**, que es más de lo que la iglesia va a tener adentro al mismo tiempo: **229 peticiones por segundo**, casi todo entre **224 y 326 ms**, ninguna petición fallida. Lo único que sube es el primer `meta` de cada uno (585 ms) porque los cuarenta entran en el mismo segundo; ya adentro, todo vuelve a esos tiempos.

Lo que lo hace posible:

- **Índices que se crean solos** desde el esquema de cada módulo (las referencias, la iglesia, el cuerpo, el miembro, la fecha, los campos únicos). Un módulo nuevo o un campo nuevo quedan cubiertos sin que nadie se acuerde de agregarlos.
- **Las etiquetas de un listado, en una sola consulta.** Antes, un listado de 25 fichas con ocho referencias disparaba doscientas consultas, y mientras tanto nadie más era atendido.
- **Los selectores traen solo lo que muestran**, no la ficha entera de cada persona.
- **La comprobación de la contraseña no bloquea al resto**: un domingo con veinte personas entrando a la vez, los que ya están adentro siguen atendidos.
- **Todo viaja comprimido** (el programa pasa de 280 KB a 73 KB) y el navegador guarda los archivos que no cambian, con el número de versión detrás para que al publicar una versión nueva todos reciban la nueva.

### Comprobarlo

```bash
npm run humo            # todas las pantallas abren bien, en computador y en teléfono
npm run concurrencia    # dos personas sobre la misma ficha y sobre la misma lista
npm run seguridad       # lo que tiene que estar cerrado, está cerrado
npm run carga           # cuánto demora cada cosa con varios usuarios a la vez

USUARIOS=40 SEGUNDOS=20 npm run carga
PREPARAR=solo npm run carga   # llena una base de pruebas para medir con datos de verdad
```

## Uso en teléfonos móviles 📱

La interfaz es totalmente adaptable (menú lateral táctil, formularios de una columna, tablas con desplazamiento) y puede **instalarse como aplicación** en el teléfono: en Android (Chrome) menú ⋮ → *Agregar a la pantalla principal*; en iPhone (Safari) Compartir → *Agregar a pantalla de inicio*.

Lo que más se usa desde el teléfono está pensado para eso: **Asistencia** reúne el calendario, las actividades y la toma de lista en una sola pantalla, con botones grandes, buscador, filtros, barra de acciones fija y guardado automático con respaldo en el propio teléfono (ver **Asistencia: todo en un solo lugar**), y las **fotos** se ajustan de tamaño antes de subirse, para que carguen aun con mala señal.

## Publicar en internet 🌐

Para que el equipo acceda desde cualquier lugar (computador o celular), vea la guía paso a paso en **[DESPLIEGUE.md](DESPLIEGUE.md)** — incluye Railway, Render y servidor propio con Docker (`Dockerfile` y `docker-compose.yml` ya incluidos).

## Producción (resumen)

1. Definir `JWT_SECRET` con un valor largo y aleatorio.
2. Cambiar la contraseña del administrador (entra con RUT `11.111.111-1`).
3. Servir detrás de HTTPS (Railway/Render lo dan automático; en VPS usar Caddy o Nginx).
4. Respaldar la carpeta de datos (`data/` local o el volumen `/data`) periódicamente.
