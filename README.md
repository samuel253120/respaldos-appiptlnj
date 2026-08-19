# Sistema de Gestión — Iglesia Pentecostal Triunfante «La Nueva Jerusalén»

<img src="public/img/logo-128.png" alt="Emblema de la iglesia" width="110" align="right" />

Sistema web integral para administrar **varias iglesias** desde un solo lugar. Incluye 15 módulos completos, control de usuarios con roles y permisos, alcance multi-iglesia, carga de archivos, impresión de certificados / credenciales / actas y un panel de control con indicadores.

## Identidad institucional

El emblema de la iglesia se usa en la pantalla de acceso, el menú, el ícono de la aplicación y los documentos impresos (certificados, credenciales y actas). Los colores del sistema —azul `#16265c` y dorado `#e8b52c`— se tomaron del propio emblema.

Los archivos están en `public/img/logo.png` (con fondo transparente) y `public/icons/`. Para cambiarlos, reemplace esas imágenes; el nombre y el lema se editan en la constante `IGLESIA` al inicio de `public/app.js`.

## Módulos incluidos

| Grupo | Módulos |
|---|---|
| **Organización** | Iglesias · Pastores / Guías · Cuerpos / Grupos · Directivas de Cuerpos |
| **Servicios** | Registro de Servicios (cultos: salmo, mensaje, asistencia y ofrenda) |
| **Personas** | Miembros · Asistencias (actividades y pasar lista) · Toma de Asistencia · Bitácora de Miembros · Documentos de Miembros |
| **Informes** | Informes de Asistencia (general, por cuerpo y por persona) |
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

**Miembros y Pastores** también se identifican por RUT, con la misma validación y sin repetidos (evita registrar dos veces a la misma persona). Para quienes no tengan RUT —extranjeros recién llegados, por ejemplo— existe el campo *Otro documento (pasaporte / extranjero)*.

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

## Usuarios, roles y alcance por iglesia

Roles disponibles (editables en `server/permissions.js`):

- **Administrador** — acceso total, incluido el módulo Usuarios.
- **Pastor / Guía** — acceso total excepto Usuarios.
- **Secretario** — gestiona membresía, asistencias, servicios, actas, documentos, certificados, etc.; sin acceso a Tesorería.
- **Tesorero** — gestiona Cuentas de Tesorería, Tesorería, Traspasos entre Cuentas, Ayudas Sociales e Inventarios; consulta el resto.
- **Solo consulta** — lectura, sin Tesorería.

**Iglesia local a la vista**: la barra superior y el panel de control muestran siempre en qué congregación se está trabajando — la asignada al usuario o, si administra varias, "Todas las iglesias". Cuando el sistema administra una sola iglesia, se muestra su nombre aunque el usuario no tenga ninguna asignada.

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

## Panel de control 📊

La pantalla de inicio muestra los totales del sistema, el resumen financiero del mes (a quien tenga acceso a Tesorería), las últimas asistencias y las solicitudes recientes.

### Próximos cumpleaños 🎂

Una tarjeta lista **los miembros que cumplen años más pronto**, con su foto, la fecha, los años que cumplen y cuánto falta (*hoy*, *mañana*, *en 7 días*). El que cumple hoy queda destacado arriba, y al pinchar cualquiera se abre su ficha.

- Se ordena por lo que falta, mirando solo el día y el mes: cuando el cumpleaños de este año ya pasó, cuenta el del año siguiente.
- No aparecen los miembros **fallecidos ni trasladados**, ni los que aún no tienen fecha de nacimiento registrada.
- Quien nació un **29 de febrero** aparece el 28 en los años que no son bisiestos.
- Cuántos se muestran se cambia en **Configuración → Preferencias → Cumpleaños que muestra el panel** (4 por defecto, hasta 20).

## Ficha del miembro 🧍

### Cómo se le trata a cada persona

En la iglesia a cada miembro se le dice de una manera, y el sistema la calcula sola:

| Trato | A quién |
|---|---|
| **Hermano** / **Hermana** | A los miembros en general, según su género |
| **Oficial** | A los **varones** que pertenecen al cuerpo de oficiales |
| **Pastor** / **Pastora** | A quienes tienen ficha en *Pastores / Guías* —que son también miembros de su iglesia— y, si así se usa, a su cónyuge |

El trato aparece como columna en el listado y junto al nombre al abrir la ficha. **No se guarda**: se calcula al leer, así que cuando alguien entra al cuerpo de oficiales o queda registrado como pastor, cambia solo.

Cuando a alguien le corresponda otro trato (diácono, diaconisa, anciano…), se fija a mano en su ficha, en **Trato (fijado a mano)**, y ese manda sobre el cálculo.

> El cuerpo de oficiales es el que se nombre en **Configuración → Organización → Cuerpo de oficiales** («Oficiales» por defecto), y el trato de *Pastor(a)* para el cónyuge se puede desactivar allí mismo.

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

Lo mismo en **Pastores / Guías**: el pastor y la pastora se vinculan entre sí, y si el cónyuge está registrado solo como miembro, se indica en el campo *Cónyuge (miembro)*.


### Edad al día

Basta con la **fecha de nacimiento**: la edad aparece al lado mientras se escribe y se muestra en el listado. No se guarda —se calcula cada vez que se lee la ficha—, así que nunca queda desactualizada. A los menores de un año se les muestra la edad en meses.

### Estado civil y matrimonio

Al elegir **Casado(a)** aparecen dos campos más: **fecha de matrimonio civil** y **fecha de matrimonio por la iglesia**. Con cualquier otro estado civil no se muestran. Si más adelante cambia el estado, las fechas no se pierden: quedan guardadas, solo dejan de mostrarse.

### Fotos y documentos que suben rápido

Al subir una **imagen** —la foto del miembro, la foto de un carnet— el sistema la **ajusta de tamaño antes de enviarla**: la deja con su lado mayor en 1600 píxeles conservando el detalle a simple vista. Una foto de teléfono de varios MB queda en unos cientos de KB y sube en un instante, aun con señal mala. Debajo del archivo se indica lo que pasó: *«imagen ajustada a 1600×1200 — de 4,2 MB a 180 KB»*.

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
                       + Fondo para la corporación  ← lo que aparta de las ofrendas
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
- **Un solo Fondo para la corporación por iglesia**, y solo en iglesias locales: es la cuenta donde cada congregación aparta lo que le corresponde a la corporación (el 10% de las ofrendas) hasta traspasarlo. Se crea solo para cada iglesia.
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

El dinero se mueve de una cuenta a otra **dejando constancia**. El caso corriente: cada iglesia aparta el 10% de las ofrendas en su *Fondo para la corporación* y, cuando llega el momento, lo traspasa a la tesorería general de la corporación.

Cada traspaso registra **fecha, cuenta de origen, cuenta de destino, monto, forma** (efectivo, transferencia, depósito, cheque, vale vista u otra), **n.º de operación**, concepto, comprobante adjunto y notas. Al elegir la cuenta de origen se muestra **cuánto hay en ella** en ese momento.

Cada traspaso genera **sus dos movimientos en Tesorería** —un egreso en el origen y un ingreso en el destino—, y los mantiene cuadrados:

- Si se corrige el traspaso (monto, fecha, forma), los dos lados se corrigen juntos.
- Si se elimina el traspaso, se van los dos movimientos y los saldos vuelven a como estaban.
- Esos dos movimientos **no se editan ni se borran por separado** desde Tesorería: el sistema remite al traspaso, para que nunca quede un lado sin el otro.

**De dónde sale el dinero del fondo**: cada servicio con ofrenda deja el porcentaje apartado en el *Fondo para la corporación* de su iglesia (ver *Registro de Servicios*). El traspaso es el paso siguiente: vaciar ese fondo hacia la corporación cuando corresponda.

**Quién puede traspasar qué**: el dinero sale siempre de una cuenta propia (el servidor rechaza sacarlo de una ajena, aunque se intente por fuera de la pantalla) y puede entrar en una cuenta de la corporación o en otra de la misma iglesia. A un tesorero local no se le ofrecen —ni se le muestran— las cuentas de otras congregaciones.

### Al actualizar el sistema

Al crear una iglesia nueva se le crean solas su **tesorería general** y su **fondo para la corporación**. A cada iglesia que no lo tenga se le crea su **Fondo para la corporación**, y los movimientos que ya estaban registrados **no se pierden ni cambian de nivel**: cada uno pasa a la cuenta general que le corresponde según su iglesia (o a la de la corporación si no tenía), creándola si hacía falta. Queda anotado en el arranque: *«🔁 tesorería: 4 movimiento(s) asignados a su cuenta general»*.

## Asistencia por cuerpo 📋

La asistencia se toma **por cuerpo y en cada actividad**: la reunión del cuerpo, un ensayo, una salida. Cada actividad guarda su fecha, la hora, el lugar, **los cuerpos convocados** y la **lista nominal** de quién estuvo.

### Una actividad puede convocar a varios cuerpos

En **Cuerpos convocados** se elige uno o varios: a una actividad conjunta pueden asistir Damas y Caballeros a la vez. Al pasar lista aparecen los integrantes de todos ellos, **agrupados por cuerpo** y con su encabezado, y quien pertenece a dos cuerpos aparece una sola vez. En los informes cada persona sigue contando en **su** cuerpo, así que un encuentro conjunto no mezcla los promedios.

### Pasar lista 🖐️

Al pie de cada actividad está **Pasar lista**: aparecen los integrantes de ese cuerpo, cada uno con tres botones —**Presente**, **Ausente**, **Justificado**— y se guardan todos de una vez. Hay un botón **Todos presentes** para marcar de golpe y corregir solo las excepciones, y abajo se ve el recuento en vivo. Volver a pulsar el mismo botón desmarca a la persona.

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

Así, a alguien se le puede dejar tomar la asistencia sin dejarlo crear actividades: en su ficha de usuario se marca *Asistencias → solo Ver* y *Toma de Asistencia → Ver, Crear y Editar* (ver **Permisos personalizados**). Esa persona entra a la actividad, marca a todos y guarda la lista, pero no ve el botón de crear actividades ni el de guardar la actividad, y si lo intentara por fuera de la pantalla, el servidor lo rechaza.

El rol **Secretario** trae los dos permisos.

En el listado de actividades se ve de un vistazo cuántos hubo de cada tipo y el **porcentaje de asistencia**, con su color: verde desde 80%, amarillo desde 60%, rojo bajo eso.

## Informes de asistencia 📈

En **Informes → Informes de Asistencia** se sacan tres informes, acotados por el período que se elija:

- **General** — todo lo registrado.
- **Por cuerpo** — se elige el cuerpo.
- **Por persona** — se busca a la persona por nombre o RUT.

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

## El pastor y la pastora son también miembros 🧍

El pastor y la pastora de una iglesia local **están en los dos registros**: su ficha en *Pastores / Guías* (su cargo, su ordenación, su ministerio) y su ficha de **miembro** de esa iglesia, como cualquier hermano.

El sistema lo cuida solo:

- Cada ficha de pastor se **enlaza con su ficha de miembro**. Si ya existe una con el mismo RUT, la reconoce y la enlaza sin que haya que hacer nada.
- Si todavía no existe, el listado de Pastores / Guías lo muestra en una columna —**Registrado** o **Falta registrarlo**— y al pie de su ficha aparece el botón **➕ Crear su ficha de miembro**, que la crea con sus mismos datos (nombres, RUT, iglesia, fecha de nacimiento, contacto y foto) y las deja enlazadas.
- De ese enlace depende el **trato**: quien tiene ficha en Pastores / Guías es *Pastor* o *Pastora* en todo el sistema, y su cónyuge también.

Así el pastor y la pastora aparecen en la membresía, cuentan en los totales de su iglesia, pueden integrar cuerpos, se les toma asistencia y tienen su bitácora, como corresponde a un miembro más.

## Registro de Servicios 🕊️

Deja constancia de cada servicio (culto) realizado: cuándo empezó y terminó, quién coordinó, quién leyó el salmo y cuál fue, quién predicó y sobre qué pasaje, cuánta gente asistió y cuánto se ofrendó.

### Personas que pueden o no estar registradas

**Coordinador(a)**, **salmista** y **predicador(a)** se escriben en un campo que sugiere a los miembros registrados mientras se escribe:

- Si la persona **está registrada**, se elige de la lista y el registro queda enlazado a su ficha (aparece marcada con ✓ *registrado*). Si más adelante cambia su nombre en Miembros, el servicio muestra el nombre actualizado.
- Si **no está registrada** (una visita, un predicador invitado), se escribe el nombre y queda guardado igual, sin enlace.
- Si se escribe a mano un nombre que coincide exactamente con un miembro —y con uno solo—, el enlace se hace igual, sin tener que elegirlo de la lista. Esto vale también al importar desde CSV.

Esto usa otra capacidad general del motor: el tipo de campo **`persona`**, disponible para cualquier módulo. Guarda el nombre en su columna y el enlace en `<campo>_id`, que el sistema agrega solo.

### Salmo y mensaje

Ambos se citan igual: **libro** (los 66 de la Reina-Valera 1960, en orden del canon), **capítulo**, **versículo inicial** y **versículo final**. En el listado y al imprimir se muestran armados: *Salmos 23:1-6*, *Juan 10:11-18*.

### Asistencia y ofrenda

| Campo | Cómo se obtiene |
|---|---|
| Asistencia de adultos / de niños | Se escriben |
| **Total general de asistencia** | Se suma solo |
| Ofrenda recibida (total) | Se escribe |
| **Aparte para el fondo** | El porcentaje configurado (10% por defecto), calculado solo — es lo que va al otro fondo de tesorería |
| **Queda para la iglesia** | El total menos lo apartado |

Los tres campos calculados se actualizan **mientras se escribe** y no se pueden editar a mano: el servidor los vuelve a calcular al guardar, así que nunca quedan descuadrados. El porcentaje se cambia en **Configuración → Organización → Porcentaje de la ofrenda que se aparta**.

### La ofrenda queda registrada sola en tesorería

Al guardar un servicio con ofrenda, el sistema anota **dos ingresos en Tesorería**, en las cuentas de **esa misma iglesia**:

| Ingreso | En qué cuenta | Concepto |
|---|---|---|
| El porcentaje apartado (10%) | **Fondo para la corporación** de la iglesia | *Aparte para la corporación — ofrenda de culto general del 5 de agosto de 2026* |
| El resto | **Tesorería general** de la iglesia | *Ofrenda de culto general del 5 de agosto de 2026* |

El concepto se arma solo con el tipo de servicio y su fecha, así se reconoce sin abrir nada. Ese porcentaje queda guardado en la iglesia hasta que se **traspasa a la corporación** (ver *Traspasos entre cuentas*).

Los dos movimientos se mantienen al día con el servicio: si se corrige la ofrenda, la fecha o el tipo, se corrigen; si la ofrenda queda en cero, desaparecen; y si se elimina el servicio, se van con él. Tampoco se editan ni se borran por separado desde Tesorería —el sistema remite al servicio—, y en esas filas ni siquiera se ofrece el botón de eliminar.

> Se puede apagar en **Configuración → Organización → Registrar la ofrenda en tesorería**, si prefieren seguir ingresando las ofrendas a mano.

Esta es también una capacidad general del motor: cualquier campo puede declarar `calcula` —`suma`, `resta` o `porcentaje` (fijo o tomado de una opción de configuración)— y el sistema lo resuelve en el servidor y en pantalla.

### Al imprimir

Cada servicio tiene su hoja con el membrete de la iglesia, los datos agrupados (salmo, mensaje, asistencia, ofrenda) y espacio para las firmas del coordinador y del predicador.

## Configuración del sistema ⚙️

Los administradores tienen en el menú la entrada **Configuración**, con opciones agrupadas:

- **Mantenimiento** — deja el sistema en mantenimiento y define el aviso que verán los usuarios.
- **Identidad** — nombre y lema de la institución.
- **Organización** — nombre del cuerpo de oficiales (de donde salen los oficiales supervisores y quienes reciben el trato de *Oficial*), si el cónyuge del pastor recibe el trato de *Pastor(a)*, porcentaje de la ofrenda que se aparta y si ese reparto se registra solo en tesorería.
- **Preferencias** — símbolo de moneda, registros por página, duración de la sesión, tamaño y calidad de las imágenes al subirlas, cuántos cumpleaños muestra el panel y si la bitácora registra automáticamente.

### Modo mantenimiento

Al activarlo, **solo los administradores pueden ingresar**. A los demás:

- Se les impide iniciar sesión, mostrando el aviso configurado.
- Si estaban trabajando, la siguiente acción los devuelve a la pantalla de acceso con ese mismo aviso (la restricción se aplica en el servidor, no solo en la interfaz).

Para agregar más opciones, añadirlas al arreglo `OPCIONES` de `server/ajustes.js`: aparecen solas en la pantalla, con su tipo de campo y valor por defecto.

## Permisos personalizados por usuario 🔑

Además del rol, cada usuario puede tener permisos propios. En su ficha hay una tabla de **módulos × acciones** (ver, crear, editar, eliminar):

- Los módulos sin marcar siguen lo que otorga el rol.
- Al marcar **Personalizar** en un módulo, ese usuario pasa a regirse por lo que se marque ahí — sirve tanto para **dar** permisos que el rol no da (ej. un secretario que sí puede ver Tesorería) como para **quitar** los que sí da.
- Todo se verifica en el servidor en cada petición.

## Bitácora de miembros 🗒️

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
GET    /api/tesoreria/resumen       ingresos, egresos, balance y por categoría
POST   /api/importar/<modulo>       { filas: [...], prueba: true|false } importación masiva
```

## Seguridad

- Contraseñas cifradas con bcrypt; sesiones JWT de 12 h.
- Permisos verificados **en el servidor** en cada petición (la interfaz solo refleja lo permitido).
- Alcance por iglesia aplicado en el servidor (lectura y escritura).
- Protecciones: no eliminar el propio usuario ni el último administrador; correo de usuario único.

## Uso en teléfonos móviles 📱

La interfaz es totalmente adaptable (menú lateral táctil, formularios de una columna, tablas con desplazamiento) y puede **instalarse como aplicación** en el teléfono: en Android (Chrome) menú ⋮ → *Agregar a la pantalla principal*; en iPhone (Safari) Compartir → *Agregar a pantalla de inicio*.

## Publicar en internet 🌐

Para que el equipo acceda desde cualquier lugar (computador o celular), vea la guía paso a paso en **[DESPLIEGUE.md](DESPLIEGUE.md)** — incluye Railway, Render y servidor propio con Docker (`Dockerfile` y `docker-compose.yml` ya incluidos).

## Producción (resumen)

1. Definir `JWT_SECRET` con un valor largo y aleatorio.
2. Cambiar la contraseña del administrador (entra con RUT `11.111.111-1`).
3. Servir detrás de HTTPS (Railway/Render lo dan automático; en VPS usar Caddy o Nginx).
4. Respaldar la carpeta de datos (`data/` local o el volumen `/data`) periódicamente.
