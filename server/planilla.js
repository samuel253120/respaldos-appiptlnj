/**
 * El listado, bajado como planilla para abrirlo en Excel.
 *
 * Hasta ahora solo los informes de asistencia se podían llevar a una
 * planilla. Todo lo demás —la nómina de miembros, el libro de tesorería, las
 * cuotas, el inventario— había que copiarlo a mano de la pantalla, que es
 * justo lo que un sistema debería evitar.
 *
 * Se baja en CSV y no en el formato propio de Excel, a propósito: lo abre
 * Excel, lo abre LibreOffice, lo abre Google Sheets y lo lee cualquier
 * programa, sin que el sistema tenga que arrastrar una biblioteca para
 * escribir un formato que solo entiende uno.
 *
 * Tres detalles que parecen menores y no lo son, porque de ellos depende que
 * la planilla se vea bien al abrirla en un computador de acá:
 *
 *   · El separador es **punto y coma**. En la configuración chilena de Excel,
 *     la coma es el separador decimal, así que un archivo separado por comas
 *     se abre todo apelotonado en una sola columna.
 *   · Los números van con **coma decimal**, por lo mismo.
 *   · El archivo parte con un **BOM**, que es la marca por la que Excel
 *     reconoce que el texto viene en UTF-8. Sin él, los apellidos con tilde y
 *     las eñes salen rotos.
 *
 * Y uno de seguridad: una celda que empieza con `=`, `@`, `+` o `-` la trata
 * Excel como una fórmula. Un dato que alguien escribió en el sistema no tiene
 * por qué ejecutarse al abrir la planilla en otro computador, así que a esas
 * celdas se les antepone un apóstrofo y quedan como lo que son, texto.
 *
 * El apóstrofo se pone con cuidado, porque en algunos programas se ve. Los
 * casos que de verdad pueden ejecutar algo —`=` y `@`— se marcan siempre. El
 * `+` y el `-` solo cuando lo que sigue no es un número: así un teléfono
 * `+56 9 5901 3724` y un monto `-25.000` bajan limpios, y un
 * `+HYPERLINK(...)` queda marcado, que es de lo que se trataba.
 */
const { getModule } = require('./registry');

/** Tipos de campo que no tiene sentido llevar a una planilla. */
const NO_VAN = new Set(['file', 'password', 'permisos']);

/** Lo que Excel ejecuta sí o sí: fórmulas y comandos. */
const ARRANQUE_PELIGROSO = /^[=@\t\r]/;
/** Un signo al principio solo es fórmula si lo que sigue no es un número. */
const SIGNO_Y_NUMERO = /^[+-][\d\s.,()-]*$/;

/** Una celda, escapada como manda el formato. */
function celda(valor) {
  if (valor === null || valor === undefined) return '""';
  let texto = String(valor);
  const conSigno = /^[+-]/.test(texto);
  if (ARRANQUE_PELIGROSO.test(texto) || (conSigno && !SIGNO_Y_NUMERO.test(texto))) {
    texto = `'${texto}`;
  }
  return `"${texto.replace(/"/g, '""')}"`;
}

/** Un número, con la coma decimal que se usa acá. */
function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return '""';
  const n = Number(valor);
  if (!Number.isFinite(n)) return celda(valor);
  return `"${String(n).replace('.', ',')}"`;
}

/** El texto con formato, en plano: en una celda las etiquetas solo estorban. */
function sinFormato(html) {
  return require('./textorico').enPlano(html);
}

/** Las columnas que van, en el orden en que están en la ficha. */
function columnasDe(def) {
  return def.fields.filter((f) => !NO_VAN.has(f.type) && !f.oculto);
}

/** El valor de un campo, ya listo para la celda. */
function valorDe(campo, fila) {
  const bruto = fila[campo.name];
  switch (campo.type) {
    case 'ref':
      return celda(fila[`${campo.name}_label`] || (bruto == null ? '' : bruto));
    case 'multiref':
      return celda((fila[`${campo.name}_labels`] || []).join(' · '));
    case 'boolean':
      return celda(bruto ? 'Sí' : 'No');
    case 'richtext':
      return celda(sinFormato(bruto));
    case 'money':
    case 'number':
      return numero(bruto);
    default:
      return celda(bruto);
  }
}

/** El nombre del archivo: se reconoce qué trae y de cuándo es. */
function nombreDelArchivo(def) {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  const limpio = def.name.replace(/[^a-z0-9_]/gi, '');
  return `${limpio}-${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}.csv`;
}

/** Arma la planilla y la manda. */
function enviar(res, def, filas) {
  const columnas = columnasDe(def);
  const lineas = [columnas.map((c) => celda(c.label)).join(';')];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => valorDe(c, fila)).join(';'));
  }

  // El BOM es lo que hace que Excel reconozca las tildes
  const cuerpo = '﻿' + lineas.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDelArchivo(def)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(cuerpo, 'utf8'));
}

module.exports = { enviar, columnasDe, celda, numero, nombreDelArchivo };
