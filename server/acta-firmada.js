/**
 * Lo que le pasa a un acta cuando está firmada, y lo que se pierde al borrarla.
 *
 * Esto vivía entero dentro del módulo de Actas de Reuniones, escrito para él.
 * Cuando le llegó el turno al de Actas de Asambleas hizo falta lo mismo, palabra
 * por palabra, y ahí había que elegir entre copiarlo o sacarlo afuera.
 *
 * Se saca afuera, y no es preferencia de estilo: este sistema ya tropezó dos
 * veces con lo mismo. La regla de la directiva se copió y hubo que arreglarla
 * dos veces (v1.263.0 y v1.271.0), y el propio módulo de actas lo dejó escrito
 * en un comentario —«lo que se copió hay que volver a arreglarlo»—. Un acta de
 * asamblea y una de reunión son el mismo documento con distinto dueño: si
 * mañana el aviso de la firma tiene que decir una cosa más, tiene que decirla en
 * los dos libros o no sirve en ninguno.
 *
 * Lo que NO está acá es lo que cada libro tiene de suyo: de quién es el acta
 * —de un cuerpo o de una congregación—, qué campos lleva y qué otras reglas se
 * le miran al guardar. Eso queda en su módulo, que es donde se lee.
 */
const { enLista } = require('./formato');
const { hoy, comoSeLee } = require('./fechas');

/** El único estado que significa algo fuera del sistema: hay un papel firmado. */
const FIRMADA = 'Firmada';

/**
 * Los dos campos que dejan constancia de la firma, para que los dos libros los
 * declaren iguales y no se vayan separando con el tiempo.
 *
 * Van de SOLO LECTURA porque los escribe el sistema y no la persona: firmar es
 * cambiar el estado del acta, y la constancia sale de ahí. Y NO llevan
 * `seccion`: un campo continúa la última sección declarada, así que nombrarla
 * otra vez abre una segunda con el mismo título —pasó, y se vio en la pantalla,
 * no en una prueba—.
 */
const camposDeLaFirma = () => ([
  { name: 'firmada_por', label: 'Firmada por', type: 'text', readonly: true },
  { name: 'fecha_firma', label: 'Fecha de la firma', type: 'date', readonly: true },
]);

/**
 * Qué está cambiando este guardado, con los nombres que se ven en la pantalla.
 *
 * Los campos salen del propio módulo y no de una lista escrita a mano, para que
 * uno que se agregue mañana entre solo: una lista aparte se olvida, y el olvido
 * acá no se nota —se nota como un acta firmada que un día se dejó cambiar sin
 * preguntar—.
 *
 * Quedan fuera dos clases. Los de SOLO LECTURA, porque los escribe el sistema y
 * no la persona: preguntar por ellos sería preguntar por uno mismo. Y los
 * OCULTOS, entre los que está «Asistentes (escritos a mano)» del libro de
 * reuniones, el campo retirado que la pantalla sigue mandando como lista vacía
 * aunque en la base esté en blanco: contarlo habría hecho que TODO guardado de
 * un acta firmada preguntara, incluso uno que no cambia absolutamente nada.
 */
function loQueCambia(modulo, data, existing) {
  const def = require('./registry').getModule(modulo); // tardío: evita ciclo con el registro
  const cambia = [];
  for (const f of def.fields) {
    if (f.readonly || f.oculto) continue;
    if (!(f.name in data)) continue;
    if (String(existing[f.name] ?? '') === String(data[f.name] ?? '')) continue;
    cambia.push(f.label);
  }
  return cambia;
}

/**
 * El aviso, que tiene que decir tres cosas: que está firmada, quién y cuándo la
 * firmó, y qué es exactamente lo que este guardado va a cambiar. Sin la tercera
 * la pregunta no se puede contestar: «¿está seguro?» a secas no es información.
 */
function avisoDeActaFirmada(existing, data, cambia) {
  const quien = existing.firmada_por ? ` por ${existing.firmada_por}` : '';
  const cuando = existing.fecha_firma ? ` el ${comoSeLee(existing.fecha_firma)}` : '';
  const cual = existing.numero_acta ? ` n.º ${existing.numero_acta}` : '';
  const firmada = `El acta${cual} está firmada${quien}${cuando}.`;

  // Dejar de estar firmada es lo más grave que puede pasarle, así que va
  // adelante y el resto de los cambios queda como añadidura.
  const nuevoEstado = data.estado !== undefined ? data.estado : existing.estado;
  if (nuevoEstado !== FIRMADA) {
    const otros = cambia.filter((c) => c !== 'Estado');
    return `${firmada} Va a dejar de estarlo: pasa a «${nuevoEstado}», y con eso se borra la constancia `
      + `de quién la firmó y cuándo.${otros.length ? ` Además cambia ${enLista(otros)}.` : ''} `
      + 'Si lo que quiere es corregirla, hágalo sin sacarle la firma.';
  }
  return `${firmada} Va a cambiar ${enLista(cambia)}. Desde ahora el papel que se firmó dirá una cosa `
    + 'y el sistema otra, y quien tenga una copia impresa no va a saberlo. El cambio queda anotado en el '
    + 'Registro de Cambios.';
}

/**
 * Deja anotado quién firmó y cuándo, o lo borra si el acta deja de estar firmada.
 *
 * Solo cuando el estado CAMBIA. Guardar otra vez un acta que ya estaba firmada
 * no vuelve a estampar la fecha: la firma ocurrió el día que ocurrió, y
 * re-escribirla en cada guardado convertiría el dato en «la última vez que
 * alguien tocó esta ficha», que es otra cosa y ya la lleva el Registro.
 */
function anotarLaFirma(data, existing, user) {
  const antes = existing ? existing.estado : null;
  const despues = data.estado !== undefined ? data.estado : antes;
  if (despues === antes) return;
  if (despues === FIRMADA) {
    data.firmada_por = (user && user.nombre) || null;
    data.fecha_firma = hoy();
  } else if (antes === FIRMADA) {
    data.firmada_por = null;
    data.fecha_firma = null;
  }
}

/**
 * Varias advertencias de un mismo guardado, en un solo aviso y numeradas.
 *
 * La marca de «guardar igual» es UNA para toda la petición, así que preguntando
 * de a una, quien confirma la primera pasaría las demás sin haberlas leído.
 */
function enUnSoloAviso(avisos) {
  if (avisos.length === 1) return avisos[0].texto;
  const cuantas = avisos.length === 2 ? 'dos' : String(avisos.length);
  return `Hay ${cuantas} cosas que revisar antes de guardar. `
    + avisos.map((a, i) => `(${i + 1}) ${a.texto}`).join(' ');
}

/**
 * El aviso de que un acta se va a borrar, con lo que se lleva puesto.
 *
 * `deQuien` y `elLibro` los pone cada módulo, porque es lo único que cambia
 * entre los dos libros: una es de un cuerpo y la otra de una congregación.
 */
function avisoDeActaQueSeBorra(fila, { deQuien = '', elLibro }) {
  const cual = fila.numero_acta ? `el acta n.º ${fila.numero_acta}` : 'un acta sin número';
  const cuando = fila.fecha ? ` del ${comoSeLee(fila.fecha)}` : '';

  // En qué estado se va. Una firmada dice además quién la firmó y cuándo,
  // que es el dato que hace pensar dos veces antes de confirmar.
  const firmada = fila.estado === FIRMADA;
  const porQuien = fila.firmada_por ? ` por ${fila.firmada_por}` : '';
  const elDia = fila.fecha_firma ? ` el ${comoSeLee(fila.fecha_firma)}` : '';
  const enQueEstado = firmada
    ? `, que está FIRMADA${porQuien}${elDia}`
    : `, en estado ${fila.estado || 'Borrador'}`;

  // Y qué trae adentro: no es lo mismo una ficha recién creada en blanco
  // que un acta escrita entera con su escaneo.
  const trae = [];
  if (fila.agenda) trae.push('su agenda');
  if (fila.desarrollo) trae.push('el desarrollo escrito');
  if (fila.acuerdos) trae.push('los acuerdos');
  if (fila.documento) trae.push('el documento escaneado');
  const conQue = trae.length
    ? ` Trae ${enLista(trae)}.`
    : ' No tiene nada escrito ni adjunto.';

  const elArchivo = fila.documento
    ? ' El escaneo se borra del servidor junto con ella.'
    : '';

  /*
   * Lo que se dice al final es DÓNDE cae cada mitad de la pérdida, y no «esto
   * no se puede deshacer»: eso ya lo dijo el navegador en su primer
   * «¿Eliminar este registro?», y repetirlo gasta la única frase que esta
   * pregunta tiene para decir algo que la otra no sabe.
   */
  return `Va a eliminar ${cual}${cuando}${deQuien}${enQueEstado}.${conQue}${elArchivo}`
    + ` Lo que decía queda copiado en el Registro de Cambios; ${elLibro}, en cambio, queda sin ella.`;
}

module.exports = {
  FIRMADA,
  camposDeLaFirma,
  loQueCambia,
  avisoDeActaFirmada,
  anotarLaFirma,
  enUnSoloAviso,
  avisoDeActaQueSeBorra,
};
