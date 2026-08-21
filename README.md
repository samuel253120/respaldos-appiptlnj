# Sistema de Gestión — Iglesia Pentecostal Triunfante La Nueva Jerusalén

<img src="public/img/logo-128.png" alt="Emblema de la iglesia" width="110" align="right" />

Sistema web integral para administrar **varias iglesias** desde un solo lugar. Incluye 15 módulos completos, control de usuarios con roles y permisos, alcance multi-iglesia, carga de archivos, impresión de certificados / credenciales / actas y un panel de control con indicadores.

## Identidad institucional

El emblema de la iglesia se usa en la pantalla de acceso, el menú, el ícono de la aplicación y los documentos impresos (certificados, credenciales y actas). Los colores del sistema —azul `#16265c` y dorado `#e8b52c`— se tomaron del propio emblema.

Los archivos están en `public/img/logo.png` (con fondo transparente) y `public/icons/`. Para cambiarlos, reemplace esas imágenes; el nombre y el lema se editan en la constante `IGLESIA` al inicio de `public/app.js`.

## Módulos incluidos

| Grupo | Módulos |
|---|---|
| **Organización** | Iglesias (matriz, sedes, locales y anexos, con su foto, su historial y sus documentos) · Pastores / Guías (con su historial ministerial y sus documentos) · Cuerpos / Grupos (con su foto) · Directivas de Cuerpos |
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

## Usuarios, roles y alcance por iglesia

Roles disponibles (editables en `server/permissions.js`):

- **Administrador** — acceso total, incluido el módulo Usuarios.
- **Pastor / Guía** — acceso total excepto Usuarios.
- **Secretario** — gestiona membresía, asistencias, servicios, actas, documentos, certificados, etc.; sin acceso a Tesorería.
- **Tesorero** — gestiona Cuentas de Tesorería, Tesorería, Traspasos entre Cuentas, Ayudas Sociales e Inventarios; consulta el resto.
- **Solo consulta** — lectura, sin Tesorería.

**Iglesia local a la vista**: la barra superior y el panel de control muestran siempre en qué congregación se está trabajando — la asignada al usuario o, si administra varias, "Todas las iglesias". Cuando el sistema administra una sola iglesia, se muestra su nombre aunque el usuario no tenga ninguna asignada.

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

## Cada iglesia y cada cuerpo con su fotografía 📸

Tanto la **iglesia** como cada **cuerpo o grupo** llevan su propia fotografía —el templo, el cuerpo reunido—, que se ve como miniatura en el listado y en su ficha. Se saca con el teléfono y al subirla se ajusta sola de tamaño, igual que la foto de un miembro.

## Historial y documentos de la iglesia y del pastor 🗒️🗂️

Lo que ya tenía cada miembro lo tienen ahora también **cada iglesia** y **cada pastor o guía**: su historial y sus documentos, al pie de su ficha.

### Documentos

Todos los que hagan falta, cada uno con **su archivo y su nombre**, más su tipo, su fecha y observaciones:

| De la iglesia | Del pastor / guía |
|---|---|
| Personería jurídica · Estatutos · Acta de fundación · Escritura / Propiedad · Contrato de arriendo · Permiso municipal · Plano del templo · Certificado · Reglamento interno · Otro | Credencial ministerial · Certificado de ordenación · Nombramiento · Carnet de identidad · Certificado de estudios · Certificado de matrimonio · Carta de traslado · Currículum · Otro |

Al agregar uno desde la ficha, la iglesia o el pastor vienen puestos. Los documentos del pastor heredan **su** iglesia, que es lo que decide quién puede verlos.

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

### Próximos cumpleaños 🎂

Una tarjeta lista **los miembros que cumplen años más pronto**, con su foto, la fecha, los años que cumplen y cuánto falta (*hoy*, *mañana*, *en 7 días*). El que cumple hoy queda destacado arriba, y al pinchar cualquiera se abre su ficha.

- Se ordena por lo que falta, mirando solo el día y el mes: cuando el cumpleaños de este año ya pasó, cuenta el del año siguiente.
- No aparecen los miembros **fallecidos ni trasladados**, ni los que aún no tienen fecha de nacimiento registrada.
- Quien nació un **29 de febrero** aparece el 28 en los años que no son bisiestos.
- Cuántos se muestran se cambia en **Configuración → Preferencias → Cumpleaños que muestra el panel** (4 por defecto, hasta 20).

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
| **Pastor** / **Pastora** | A quienes tienen un **cargo pastoral** —de *pastor probando* hacia arriba— **y a su cónyuge** |

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
- la **información médica** —enfermedades, alergias, indicaciones—, para tenerla a mano sin buscarla.

Los datos de salud y la nota importante quedan marcados como **sensibles**: cuando cambian, el historial deja constancia de que se actualizaron, **sin copiar su contenido** («Alergias: actualizada»).

### Edad al día

Basta con la **fecha de nacimiento**: la edad aparece al lado mientras se escribe y se muestra en el listado. No se guarda —se calcula cada vez que se lee la ficha—, así que nunca queda desactualizada. A los menores de un año se les muestra la edad en meses.

### Estado civil y matrimonio

Al elegir **Casado(a)** aparecen dos campos más: **fecha de matrimonio civil** y **fecha de matrimonio por la iglesia**. Con cualquier otro estado civil no se muestran. Si más adelante cambia el estado, las fechas no se pierden: quedan guardadas, solo dejan de mostrarse.

### Fotos y documentos que suben rápido

Al subir una **imagen** —la foto del miembro, la del templo, la del cuerpo, la de un carnet— el sistema la **ajusta de tamaño antes de enviarla**: la deja con su lado mayor en 1600 píxeles conservando el detalle a simple vista. Una foto de teléfono de varios MB queda en unos cientos de KB y sube en un instante, aun con señal mala. Debajo del archivo se indica lo que pasó: *«imagen ajustada a 1600×1200 — de 4,2 MB a 180 KB»*.

El tamaño y la calidad se cambian en **Configuración → Preferencias**. Los archivos que no son imágenes (PDF, Word) suben tal cual.

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
| Pastor Probando | Varios |
| Pastor Diácono | Varios |
| Pastor Presbítero | Varios |
| **Pastor Presidente** | **Uno solo en toda la organización** |

El sistema hace cumplir lo último: al designar a un segundo presidente avisa quién ocupa el cargo —*«Ya hay un Pastor Presidente: Samuel Rodríguez. Cámbiele el cargo o su estado antes de designar a otro.»*— y no lo guarda. De los demás cargos puede haber tantos como haga falta.

> Las fichas que traían un cargo de la lista anterior (Pastor, Pastora, Anciano…) **se conservan tal cual** y quedan anotadas en el arranque; al abrir cada una, el cargo antiguo aparece marcado como *(valor anterior)* hasta que se elija el de la escala nueva. Así ninguno se cambia sin querer.

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

Además del rol, cada usuario puede tener permisos propios. En su ficha hay una tabla de **módulos × acciones** (ver, crear, editar, eliminar):

- Los módulos sin marcar siguen lo que otorga el rol.
- Al marcar **Personalizar** en un módulo, ese usuario pasa a regirse por lo que se marque ahí — sirve tanto para **dar** permisos que el rol no da (ej. un secretario que sí puede ver Tesorería) como para **quitar** los que sí da.
- Todo se verifica en el servidor en cada petición.

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
  db.js            SQLite + AUTO-MIGRACIÓN (crea tablas y columnas nuevas)
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
- La recuperación por pregunta se **bloquea tras 5 intentos** fallidos.
- Permisos verificados **en el servidor** en cada petición (la interfaz solo refleja lo permitido).
- Alcance por iglesia aplicado en el servidor (lectura y escritura).
- Protecciones: no eliminar el propio usuario ni el último administrador; correo de usuario único.

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
