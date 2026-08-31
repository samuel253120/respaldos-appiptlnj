/**
 * Lo que está en la iglesia y no es de la iglesia.
 *
 * En el templo hay cosas que no son de la organización y que igual tienen que
 * estar inventariadas, porque están ahí y alguien responde por ellas —o
 * expresamente no responde—. Son de dos clases, y la diferencia no es un
 * matiz:
 *
 *   PRESTADO      un hermano se lo prestó a la iglesia para algo, y hay que
 *                 devolvérselo. La iglesia lo tiene, lo usa y responde por él.
 *
 *   EN DEPÓSITO   un hermano lo dejó guardado porque no tiene dónde. La
 *                 iglesia lo cuida como cuida lo suyo, pero NO responde por
 *                 daño, deterioro ni pérdida, y el dueño tiene que estar en
 *                 conocimiento de eso y haberlo aceptado.
 *
 * Antes de esto no había dónde anotarlo. Medido sobre el módulo: doce campos,
 * y ninguno decía de quién es la cosa —«Responsable» apunta a un miembro, pero
 * es quien la tiene a cargo, no su dueño—. Se sembraron cinco artículos de una
 * misma iglesia escribiendo la explicación en «Notas», que es como habría que
 * hacerlo, y en el listado los cinco se veían exactamente iguales: el
 * amplificador prestado por un hermano y la batería dejada bajo su propia
 * responsabilidad tenían la misma cara que las bancas compradas por la
 * iglesia. Nada en pantalla decía que dos de esos cinco hay que devolverlos.
 *
 * Y buscar tampoco resolvía: se buscó «prestado» y salieron CERO resultados,
 * porque en la nota decía «lo prestó». El texto libre encuentra lo que uno se
 * acordó de escribir, con las palabras con que lo escribió.
 *
 * Las consecuencias eran tres, y ninguna de pantalla: se devuelve tarde o no
 * se devuelve, porque nadie sabe que hay algo pendiente; se cuenta como
 * patrimonio de la iglesia lo que no lo es —en esos cinco artículos,
 * $ 1.300.000 de $ 3.310.000 eran ajenos—; y la responsabilidad queda de
 * palabra, en una nota sin fecha, sin firma y que el dueño nunca vio.
 *
 * LA CLÁUSULA LA ESCRIBE LA CORPORACIÓN, NO ESTE ARCHIVO. Es un texto que se
 * imprime y se firma, así que su redacción es de quien la firma: vive en
 * Configuración → Organización y acá solo está el texto con que llega el
 * sistema. Cambiarlo no toca código.
 *
 * ---------------------------------------------------------------------------
 * DOS COSAS QUE NO DECIDE ESTE ARCHIVO, Y YA ESTÁN DECIDIDAS
 *
 * El informe de Inventarios dejó dos preguntas abiertas porque no eran de
 * programación sino de la corporación. Las dos quedaron contestadas el
 * 31-08-2026, y las dos confirman cómo ya estaba construido. Se anotan acá
 * para que nadie las vuelva a abrir creyendo que fue un descuido:
 *
 *   UN BIEN AJENO PUEDE ESTAR EN CUALQUIERA DE LOS TRES NIVELES, la
 *   corporación incluida. Un hermano puede prestarle algo a la corporación
 *   para una asamblea igual que se lo presta a su congregación, así que
 *   «Prestado» y «En depósito» no se acotan al nivel de iglesia ni al de
 *   cuerpo.
 *
 *   ANOTAR UN DEPÓSITO LO HACE QUIEN TENGA EL PERMISO DE INVENTARIOS, como
 *   todo lo demás del módulo. Se evaluó pedirle un permiso propio —aceptar
 *   algo bajo la cláusula de no responsabilidad es un compromiso de la
 *   iglesia con un hermano— y se resolvió que no: un permiso más que casi
 *   nadie sabría a quién darle protege menos que la hoja firmada, que es lo
 *   que de verdad deja constancia.
 */

/** Los tres regímenes. El primero es el corriente y es el valor de fábrica. */
const REGIMENES = ['Propio', 'Prestado', 'En depósito'];

/** ¿Este régimen dice que la cosa NO es de la organización? */
const esAjeno = (regimen) => regimen === 'Prestado' || regimen === 'En depósito';

/** Los campos que solo tienen sentido cuando el bien es de otro. */
const LO_DEL_DUENO = [
  'dueno', 'dueno_id', 'dueno_contacto', 'fecha_recepcion', 'fecha_devolucion',
  'deslinde_aceptado', 'deslinde_fecha', 'documento_tenencia', 'fecha_devuelto',
];

/**
 * Deja el régimen y sus campos de acuerdo, o devuelve lo que falta.
 *
 * Devuelve `null` si está todo bien, un texto si hay que frenar, o
 * `{ error, confirmar }` si hay que preguntar y dejar seguir a quien confirme.
 *
 * SE PREGUNTA POR EL DESLINDE Y NO SE BLOQUEA. Un depósito sin la firma del
 * dueño es una situación real —la cosa ya está en el templo y la firma se
 * consigue el domingo—, y prohibir anotarlo obligaría a mentir en el régimen o
 * a no anotarlo. Preguntar deja escribir la verdad y a la vez pone el hueco a
 * la vista, que es de lo que se trata: hasta que firme, la iglesia no tiene
 * nada por escrito.
 */
function acomodarElRegimen(data, dato) {
  const regimen = dato('regimen');
  if (!REGIMENES.includes(regimen)) {
    return `El régimen del bien tiene que ser uno de estos tres: ${REGIMENES.join(', ')}`;
  }

  /*
   * Lo propio se limpia entero. Un artículo que pasa de «Prestado» a «Propio»
   * —el hermano lo terminó donando— con el nombre del dueño y la fecha de
   * devolución pegados es un registro que dice dos cosas a la vez, y la que se
   * ve en el papel es la vieja.
   */
  if (!esAjeno(regimen)) {
    for (const campo of LO_DEL_DUENO) data[campo] = null;
    return null;
  }

  if (!String(dato('dueno') || '').trim()) {
    return 'Indique de quién es el artículo: un bien prestado o en depósito tiene dueño, y hay que '
      + 'poder ubicarlo para devolvérselo';
  }

  /*
   * Que las fechas se lleven bien entre ellas NO se comprueba acá.
   *
   * El motor ya tiene esa regla: un campo de fecha declara `noAntesDe` y
   * `revisarCoherencia` (server/fechas.js) la aplica en los treinta y nueve
   * módulos, con la misma redacción para todos. Acá estuvo escrita a mano un
   * rato —«la devolución quedaría el 01-05-2026 y el artículo llegó el
   * 10-05-2026»— y era una regla copiada en dos archivos, que es una regla que
   * un día va a decir dos cosas distintas. La declaración está en los campos
   * `fecha_devolucion` y `fecha_devuelto` del módulo.
   *
   * Lo mismo con la fecha de devolución, que es FUTURA por definición: el
   * motor rechaza lo que todavía no llega salvo que el campo declare
   * `futuro: true`. Se descubrió probando en el sistema andando: anotar un
   * préstamo a devolver el 15-09-2026 contestaba «dice 15-09-2026, que todavía
   * no llega. Revise el año: acá se anota lo que ya ocurrió».
   */

  /*
   * Un préstamo no lleva cláusula: la iglesia sí responde por lo que le
   * prestaron. El deslinde es de lo que está en depósito y de nada más.
   */
  if (regimen !== 'En depósito') {
    data.deslinde_aceptado = 0;
    data.deslinde_fecha = null;
    return null;
  }

  if (!Number(dato('deslinde_aceptado'))) {
    return {
      error:
        `Este artículo queda anotado como depósito de ${String(dato('dueno')).trim()}, y todavía no `
        + 'está marcado que su dueño aceptara la cláusula de responsabilidad. Mientras no la acepte, '
        + 'la iglesia no tiene nada por escrito: si el artículo se daña o se pierde, lo único que hay '
        + 'es lo que cada uno recuerde haber conversado. Imprima la hoja de depósito, hágala firmar y '
        + 'márquelo acá. Si prefiere anotarlo ahora y conseguir la firma después, confirme.',
      confirmar: 'deposito_sin_deslinde',
    };
  }
  return null;
}

module.exports = { REGIMENES, esAjeno, LO_DEL_DUENO, acomodarElRegimen };
