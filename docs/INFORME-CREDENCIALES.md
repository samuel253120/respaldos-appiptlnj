# La credencial pastoral, de la especificación al papel

**Informe final** — punto 16 de `especificacion-credenciales.txt`
Versiones 1.73.0 → 1.78.0 · 24 de agosto de 2026

Este informe describe el estado en la versión **1.78.0** y no se actualiza: es
la constancia de lo que se entregó. Lo que sí se mantiene al día está en el
README (cómo funciona el módulo) y en LEEME.md (cómo publicarlo y cómo volver
atrás).

---

## 16.1 · Las seis fases

Las seis quedaron implementadas. Cada una se entregó, se comprobó y se publicó
por separado.

| Fase | Qué trae | Estado |
|---|---|---|
| 1 | Tabla de credenciales con su instantánea de datos impresos, índices, correlativo único y la limpieza del punto 13.1 | Hecha · 1.73.0 |
| 2 | Logo, sello y firma en Configuración; modo del código QR; clave del código de autenticidad como variable del servidor | Hecha · 1.74.0 |
| 3 | Crear, emitir y revocar; número de serie y dígito verificador; validación de datos obligatorios; corrección del punto 13.2 | Hecha · 1.75.0 |
| 4 | El diseño aprobado trasladado tal cual, el código QR, la pieza plegable y el encuadre de la fotografía | Hecha · 1.76.0 |
| 5 | Página pública de verificación, estados, vencimientos, aviso en el panel, revocación, reemplazo e historial | Hecha · 1.77.0 |
| 6 | Permisos, auditoría completa, revisión en teléfono, historial de versiones y este informe | Hecha · 1.78.0 |

---

## 16.2 · Las diecinueve pruebas de aceptación

**Pasan 18 de 19.** Ninguna se dio por aprobada sin haberla ejecutado. Las que
corren solas quedaron escritas como programas que se pueden volver a correr:

- `npm run aceptacion` — 38 comprobaciones sobre una base descartable
- `npm run credencial` — mide sobre el PDF rasterizado a 300 puntos por pulgada

| N.º | Qué comprueba | Resultado | Lo medido |
|---|---|---|---|
| 15.1 | Los datos impresos coinciden con el registro | Pasa | Nueve campos comparados uno a uno. Ninguna discrepancia |
| 15.2 | Cada cara mide 54 × 86 mm y todo cabe en una página | Pasa | `54.00 × 86.00 mm` por cara. Una página Carta `215.9 × 279.4 mm` |
| 15.3 | Al doblar, el reverso queda derecho y calzado | Pasa | Pieza `172.53 mm`, pliegue a `86.27 mm`, reverso girado 180° |
| 15.4 | Nombres largos y con tildes: nada se sale, corta ni pisa | Pasa | Tres casos, hasta 67 caracteres. Con 100 sí detecta el desborde |
| 15.5 | El Cargo vacío no imprime su fila | Pasa | La fila mide `0.0 px`; el bloque conserva su alto (`147 px`) |
| **15.6** | **Escanear con un teléfono una credencial impresa en papel** | **No hecha** | Necesita papel, impresora y teléfono |
| 15.7 | Todo queda en auditoría, con usuario, fecha, hora y valores | Pasa | Los seis hechos, con valor anterior y nuevo |
| 15.8 | Un pastor no alcanza las credenciales de otra iglesia | Pasa | Ve `0`; por dirección a mano `403`; al emitir `403` |
| 15.9 | Alterar un carácter del QR y que la verificación lo rechace | Pasa | Correcto `200`; un carácter cambiado `404`; un dígito de la serie `404` |
| 15.10 | Revocar y que la verificación lo muestre de inmediato | Pasa | `VIGENTE` → se revoca → `REVOCADA` con su motivo |
| 15.11 | Las pantallas nuevas se ven y se usan bien en el teléfono | Pasa | Seis pantallas en 360 y 390 px |
| 15.12 | El número de serie no se escribe ni se edita a mano | Pasa | Campo de solo lectura; por la API tampoco cambia |
| 15.13 | Dos emisiones a la vez: números distintos y correlativos | Pasa | Seis simultáneas: `0042026 … 0092026`, correlativos 4–9 |
| 15.14 | La base rechaza un número de serie repetido | Pasa | `UNIQUE constraint failed: index 'ux_credenciales_serie'` |
| 15.15 | Una credencial nueva no reutiliza el número de la revocada | Pasa | Revocada `0032026`, la siguiente `0102026` |
| 15.16 | El dígito verificador coincide con el del archivo de diseño | Pasa | 3.996 números comparados contra la función del propio HTML |
| 15.17 | El correlativo no se reinicia al cambiar de año | Pasa | `0112024 → 0122025`, correlativo `11 → 12` |
| 15.18 | Al pasar de 999 sigue con cuatro dígitos y no da error | Pasa | `9992026 → 10002026 → 10012026` |
| 15.19 | Ningún dato existente se perdió ni se alteró | Pasa | Solo cambian las dos tablas que deben |

### La que no se pudo hacer

**15.6 — escanear con un teléfono una credencial realmente impresa en papel.**
No la puede hacer un programa. Queda pendiente, y conviene hacerla dos veces:
con impresora láser y con una de inyección de tinta.

Lo más cerca que se llega sin papel, y que sí se hizo: rasterizar el PDF a
**300 puntos por pulgada** y decodificar el QR con un lector de verdad. Se lee.
Repetido con un desenfoque de **0,12 mm** —el sangrado de una impresora de
inyección sobre papel común— se sigue leyendo lo mismo.

### Las que se midieron sobre la imagen y no sobre el papel

Las pruebas 15.2 a 15.5 dicen «imprimir y medir con regla». Lo que se hizo fue
pedirle el PDF al navegador —el mismo que produce la impresión— y medir sobre
él: exacto y repetible, pero no atrapa un problema de la impresora en sí (que
no imprima al 100 %, que corte los bordes). **Al imprimir la primera de verdad,
midan una cara con regla: tiene que dar 54 × 86 mm.**

---

## 16.3 · Los conteos, antes y después

La única migración que borra algo es la del punto 13.1. Comprobado en un
experimento controlado sobre una base con datos en todas las tablas:

| | Antes | Después |
|---|---|---|
| `credenciales` | 15 | **0** (borradas a propósito) |
| `registro_cambios` | 40 | 41 (la línea que deja constancia) |
| Las otras 35 tablas | — | **sin cambios** |

La comprobación quedó dentro de `npm run aceptacion`: se le quita a la migración
la marca de «ya se hizo», se reinicia el servidor para que corra otra vez y se
comparan las 37 tablas.

**Los conteos de la base de la iglesia hay que tomarlos ustedes**, antes de
publicar la 1.73.0:

```bash
node pruebas/conteos.js > antes.txt      # antes de publicar
node pruebas/conteos.js > despues.txt    # después
diff antes.txt despues.txt               # solo tiene que aparecer credenciales
```

Y antes de todo eso: **bájense el respaldo completo** desde Configuración
(punto 1.1). La limpieza se hace sola al arrancar, una sola vez, y no se deshace.

---

## 16.4 · Cómo volver atrás

El procedimiento completo está en `LEEME.md`. En resumen:

1. **Publicar la versión anterior** del programa.
2. **Restaurar el respaldo** que bajaron antes de la 1.73.0, si quieren
   recuperar las credenciales que había.

Las tablas y columnas que agregó la credencial no estorban a una versión
anterior: sobran, y una versión que no las conoce no las mira. Si solo quieren
volver el programa atrás sin perder lo cargado desde entonces, basta con el
paso 1.

**Lo único que no vuelve solo** son las credenciales anteriores a la 1.73.0. Por
eso el respaldo va primero.

**La clave `CREDENCIAL_SECRETO` no se toca nunca después de publicar.** Si
cambia, los códigos de todas las credenciales ya impresas dejan de validar.

---

## 16.5 · Lo que se decidió sin preguntar

1. **La página de verificación funciona siempre**, no solo con el QR en modo «en
   línea» (punto 9.1). Una credencial impresa dura años; si mañana se cambia el
   modo, las tarjetas ya impresas seguirían apuntando a una página apagada.

2. **El tope de verificaciones cobra solo los intentos errados** (punto 9.6).
   Cada página gasta dos peticiones —la página y la fotografía—, así que
   cobrando todas, quien verifica quince credenciales seguidas quedaba esperando.

3. **La verificación sigue atendiendo con el sistema en mantenimiento.** El
   mantenimiento frena a quien entra a trabajar, no a quien está en la puerta de
   una iglesia con una credencial en la mano.

4. **Emitir y revocar son dos llaves, no una** (punto 12.2). Hay quien tiene que
   poder emitir sin poder anular lo que ya anda circulando. De fábrica las dos
   son solo del administrador, como pide la especificación.

5. **Una credencial emitida no se puede eliminar, ni siendo administrador.** Es
   el registro de un documento que se entregó, y borrarla dejaría un hueco sin
   explicación en la cuenta de los números de serie.

6. **Se audita toda la configuración**, no solo el logo, el sello y la firma
   (punto 15.7). Hacer una excepción para tres claves obliga a acordarse de
   agregar la cuarta el día que exista. De la contraseña inicial no se anota el
   valor.

7. **Si el contenido no cabe en 41 cuadraditos, no se emite código.** No estaba
   pedido. Un QR con los módulos por debajo de 0,25 mm no se lee impreso, y un
   código que no se lee es peor que ninguno: parece verificable y no lo es.

8. **El «módulo de Historial de Versiones» no existía**, así que se hizo un panel
   al pie de Configuración que muestra qué versión está corriendo ahora en el
   servidor y qué trajo cada una.

9. **El cambio de año (15.17) se simuló hacia atrás.** El sistema no acepta una
   fecha de entrega que todavía no llegó, así que se emitieron dos ya pasadas, de
   diciembre y del enero siguiente. Lo que se comprueba es lo mismo.

10. **Las fotos no se limitan a 812 × 1084 exactos** (punto 6.2). El sistema ya
    reducía toda imagen al subirla respetando la proporción, con un tope
    configurable cuyo valor de fábrica es 1600 píxeles al lado mayor. Si quieren
    el número exacto de la especificación, pongan «Tamaño máximo de las
    imágenes» en 1084.

---

## De paso: cuatro defectos que aparecieron midiendo

No estaban en la especificación. Aparecieron porque las comprobaciones miden en
vez de mirar, y los cuatro habrían llegado al papel o a la pantalla de alguien.

**La hoja de estilos de la credencial pisaba el sistema entero.** El diseño
aprobado venía de una página suelta y nombra `.card`, `.toolbar` y `@page` a
secas. Cargada junto al resto le ganaba a la del sistema por venir después: el
listado de miembros quedaba con sus tarjetas de 54 × 86 mm y zoom 1,9.

**El tamaño del cuadradito del QR estaba inflado un 4 %.** El servidor repartía
los 12,2 mm del recuadro sin descontar los 0,25 mm de relleno de cada lado:
0,3162 mm impresos contra 0,3297 anunciados. Importa porque con ese número se
decide si un código pasa el mínimo de 0,25 mm.

**La fotografía se pintaba sin mirar su proporción.** Al 100 % del ancho del
recuadro: una foto apaisada habría dejado franjas blancas dentro del marco
dorado, y el encuadre elegido no era el que salía impreso.

**La barra de arriba se salía 5 px en un teléfono de 360 px.** No era de la
credencial: pasaba en todas las pantallas. El selector de iglesia tenía 160 px
asegurados y la barra pedía 377 en una pantalla de 360.

---

## Antes de publicar: tres cosas que quedan de su lado

1. **Bajen el respaldo completo** desde Configuración y guárdenlo fuera del
   servidor. Anoten también los conteos.
2. **Pongan `CREDENCIAL_SECRETO`** en las variables del servidor, antes de emitir
   la primera credencial. Sin ella los códigos se firman con una clave que está
   escrita en el código y es pública.
3. **Hagan la prueba 15.6**: impriman una credencial de verdad, dóblenla,
   plastifíquenla y escaneen su código con un teléfono. Repítanlo con una
   impresora de inyección de tinta.
