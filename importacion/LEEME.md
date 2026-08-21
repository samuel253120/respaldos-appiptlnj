# Datos del sistema anterior

`origen-v10.json` es lo que se va a importar: sale del volcado completo
(`database_export_20260820_223504.zip`, 36 tablas) y contiene **solo las filas
vigentes** de las tablas que tienen destino en este sistema, más las
colecciones que el sistema anterior guardaba dentro de su estado (usuarios,
roles, fondos, configuración, pastor).

Las **24 filas borradas** del origen no se importan pero quedan guardadas en
`descartadas`, para poder informarlas. Salvo una, todas son pruebas técnicas
del propio sistema anterior (`verif-`, `deltest-`, `diag-`); la excepción es
la actividad *Oración Domingo* del 2026-08-09, que conviene mirar.

## Cómo se corre

    node server/importacion/correr.js --datos importacion/origen-v10.json --prueba
    node server/importacion/correr.js --datos importacion/origen-v10.json

Opciones: `--modulo <nombre>`, `--hasta <nombre>`, `--ruts detener|conservar|vaciar`.

El ensayo (`--prueba`) hace todo el trabajo y lo deshace al final: sirve para
ver los conteos y los problemas sin tocar nada.

## Lo que falta

Los **238 archivos** (92 fotos de miembros, 145 fichas de registro en PDF y
1 comprobante de un egreso) no venían en ninguno de los dos envíos. Sus rutas
quedan anotadas en la tabla `importacion_archivos`; cuando llegue la carpeta
`attachments/`, se copian y se conectan sin volver a importar nada.

## El informe final

    node server/importacion/informe.js

Cuenta las dos bases módulo por módulo, revisa que las relaciones quedaran
intactas, y deja el resultado en `informe-final.txt`.
