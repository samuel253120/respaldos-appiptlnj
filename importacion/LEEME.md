# Datos del sistema anterior

`origen-v10.json` es lo que se va a importar: sale del volcado completo
(`database_export_20260820_223504.zip`, 36 tablas) y contiene **solo las filas
vigentes** de las tablas que tienen destino en este sistema, más las
colecciones que el sistema anterior guardaba dentro de su estado (usuarios,
roles, fondos, configuración, pastor).

Las **19 filas borradas** del origen no se importan (eran pruebas del propio
sistema anterior) pero quedan guardadas en `descartadas`, para poder
informarlas.

## Cómo se corre

    node server/importacion/correr.js --datos importacion/origen-v10.json --prueba
    node server/importacion/correr.js --datos importacion/origen-v10.json

Opciones: `--modulo <nombre>`, `--hasta <nombre>`, `--ruts detener|conservar|vaciar`.

El ensayo (`--prueba`) hace todo el trabajo y lo deshace al final: sirve para
ver los conteos y los problemas sin tocar nada.

## Lo que falta

Los **archivos** (92 fotos de miembros, 145 documentos, 2 fotos de usuario y
1 comprobante) no venían en ninguno de los dos envíos. Sus rutas quedan
anotadas en la tabla `importacion_archivos`; cuando llegue la carpeta
`attachments/`, se copian y se conectan sin volver a importar nada.
