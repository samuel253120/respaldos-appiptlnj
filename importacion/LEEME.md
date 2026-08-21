# Traspaso desde el sistema anterior

Los datos del sistema antiguo **no viven en este repositorio**: se suben desde
la propia aplicación —*Configuración → 🚚 Traspaso*— y quedan junto a la base
de datos, en `DATA_DIR/importacion/origen.json`. Una versión publicada no
lleva adentro los datos de nadie.

El volcado que se sube es un JSON con las filas vigentes de cada tabla del
sistema anterior. Puede venir como `{ "data": { ... }, "descartadas": { ... } }`
o directamente como el objeto de datos; lo único que se exige es que traiga la
lista `members`.

## Desde la aplicación

*Configuración → Traspaso*, solo para el administrador, en cinco pasos:

1. **Descargar respaldo** de la base completa.
2. **Ver qué hay hoy** y, si es todo de prueba, dejar la base como nueva.
3. **Ensayo**: hace todo el trabajo y lo deshace al final.
4. **Importar**.
5. **Ver el informe** y guardarlo.

Importar de verdad exige el **modo mantenimiento activo** y haber corrido
antes el **ensayo**. Al terminar, el informe queda guardado en el servidor
(`DATA_DIR/informe-importacion.txt`), así que se puede volver a leer aunque
después se saque el archivo de origen.

## Desde la consola

    node server/importacion/correr.js --datos <archivo.json> --prueba
    node server/importacion/correr.js --datos <archivo.json>
    node server/importacion/informe.js --datos <archivo.json>

Opciones: `--modulo <nombre>`, `--hasta <nombre>`, `--ruts detener|conservar|vaciar`.
Sin `--datos`, se usa el archivo subido desde la aplicación.

## Cómo está hecho

Doce módulos, en el orden en que se pueden escribir sin romper vínculos
(`server/importacion/m01…m12`), más una segunda pasada para lo que solo se
puede enlazar al final —los matrimonios y el autor de cada registro—.

Cuatro reglas gobiernan todo:

- **Todo o nada por módulo.** Cada uno se importa dentro de una transacción.
- **Idempotente.** Cada fila del origen queda anotada en
  `importacion_equivalencias` con su id de allá y su id de acá.
- **Nada se inventa.** Un RUT con el dígito cambiado se conserva y se anota en
  el historial de esa persona; un archivo que no llegó espera en
  `importacion_archivos` en vez de dejar la ficha apuntando al vacío.
- **Se informa lo que no se pudo traer.** El informe final cuenta las dos
  bases, revisa las relaciones y deja por escrito qué quedó fuera y por qué.

## Lo que quedó pendiente del traspaso de 2026

Los **238 archivos** del sistema anterior (92 fotos de miembros, 145 fichas de
registro en PDF y 1 comprobante de un egreso) no venían en la exportación. Sus
rutas están anotadas en `importacion_archivos`; cuando llegue la carpeta
`attachments/`, se copian y se conectan sin volver a importar nada.
