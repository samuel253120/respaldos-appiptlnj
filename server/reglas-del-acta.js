/**
 * Las reglas que los dos libros de actas comparten.
 *
 * Un acta de asamblea y una de reunión son el mismo documento con distinto
 * dueño: una la levanta un cuerpo y la otra la congregación entera. Casi todo lo
 * que hay que cuidar en una hay que cuidarlo igual en la otra —que una firmada
 * no se cambie sin decirlo, que borrarla no se lleve en silencio lo que decía,
 * que un acta vacía se note, que las horas no vayan al revés— y eso es lo que
 * vive acá.
 *
 * Nació llamándose «reglas-del-acta» con una sola de esas reglas adentro. Cuando
 * fueron cuatro, el nombre ya mentía.
 *
 * Todo esto vivía dentro del módulo de Actas de Reuniones, escrito para él.
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

/*
 * Varias advertencias de un mismo guardado, en un solo aviso y numeradas.
 *
 * Vivía acá, que es donde hizo falta primero. Desde la v1.289.0 vive en
 * server/una-sola-pregunta.js, porque la oficina de partes la necesitó igual y
 * no tenía por qué pedírsela al libro de actas. Se sigue ofreciendo desde acá
 * para que los dos libros no cambien la línea con que la piden.
 */
const { enUnSoloAviso } = require('./una-sola-pregunta');

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

/** Lo que un acta puede tener adentro: lo escrito, o el papel escaneado. */
const LO_QUE_DICE = ['agenda', 'desarrollo', 'acuerdos'];

/** Cómo queda un campo después de este guardado: lo que llega, o lo que ya estaba. */
const comoQueda = (campo, data, existing) => (
  data[campo] !== undefined ? data[campo] : existing && existing[campo]);

/** ¿Hay algo escrito ahí? */
const conAlgo = (campo, data, existing) => String(comoQueda(campo, data, existing) || '').trim() !== '';

/**
 * Un acta que no dice nada.
 *
 * Lo obligatorio de un acta es su cabecera: número, fecha y de quién es. Todo lo
 * que el acta DICE es opcional. Está bien pensado a medias, y a propósito: un
 * acta puede ir solo adjunta —«Se puede dejar en blanco si el acta va adjunta»,
 * dice la ayuda del campo— y también escribirse acá sin adjuntar nada. Las dos
 * maneras valen.
 *
 * Lo que faltaba es la esquina que queda: NINGUNA DE LAS DOS. Un acta sin
 * adjunto y sin una palabra escrita no es un acta a medio llenar, es una ficha
 * que no contiene nada, y se imprime con el membrete de la institución y dos
 * líneas de firma al pie.
 *
 * Se pregunta y no se rechaza porque hay un caso legítimo y corriente: crear la
 * ficha ahora para adjuntarle el escaneo al rato. Que pregunte una vez y siga.
 *
 * El texto con formato llega acá YA LIMPIO: un editor de texto rico deja
 * «<p></p>» o «<p><br></p>» cuando se borra todo, y eso es tan vacío como el
 * blanco aunque no lo parezca, pero de eso se encarga server/textorico.js antes
 * del guardado —por las dos puertas, la pantalla y la importación de planillas—.
 * Mirarlo otra vez acá sería repetir una regla que ya tiene dueño.
 */
function loDelActaVacia(data, existing) {
  if (LO_QUE_DICE.some((c) => conAlgo(c, data, existing)) || comoQueda('documento', data, existing)) {
    return null;
  }

  // No es lo mismo una ficha que nace en blanco que un acta que decía algo y se
  // está quedando sin nada: la segunda es una pérdida, no un trámite pendiente.
  const teniaAlgo = existing
    && (LO_QUE_DICE.some((c) => String(existing[c] || '').trim() !== '') || existing.documento);
  if (teniaAlgo) {
    return 'Este acta decía algo y va a quedar sin nada: sin agenda, sin desarrollo, sin acuerdos y '
      + 'sin documento adjunto. Lo que decía se puede recuperar del Registro de Cambios, pero el acta '
      + 'queda en blanco.';
  }
  return 'Este acta no dice nada: no tiene agenda, ni desarrollo, ni acuerdos, ni documento adjunto. '
    + 'Se puede guardar así —para adjuntarle el escaneo más tarde—, pero mientras tanto se imprime '
    + 'con el membrete de la institución y dos líneas de firma, y nada en medio.';
}

/**
 * Las horas de la sesión, una contra la otra.
 *
 * `cual` es cómo se llama la sesión en el aviso —«la reunión», «la asamblea»—,
 * que es lo único que cambia entre los dos libros.
 */
function loDeLasHoras(data, existing, cual = 'la reunión') {
  /*
   * En minutos desde la medianoche, y no comparando el texto: la pantalla manda
   * siempre «09:30» y la API no siempre, y comparadas como texto «9:30» sale
   * MAYOR que «21:00» —el 9 va después del 2— así que una sesión de las 21:00 a
   * las 9:30 pasaría sin que nadie la mirara.
   */
  const enMinutos = (h) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(h || '').trim());
    if (!m) return null;
    const hora = Number(m[1]);
    const minuto = Number(m[2]);
    if (hora > 23 || minuto > 59) return null;
    return hora * 60 + minuto;
  };
  /** Para decirla en el aviso como se lee en la ficha. */
  const enReloj = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  const inicio = enMinutos(comoQueda('hora_inicio', data, existing));
  const fin = enMinutos(comoQueda('hora_fin', data, existing));
  /*
   * Con una sola hora anotada no hay nada que comparar, y está bien que así sea:
   * muchas actas dicen a qué hora empezó y no a qué hora terminó. Se comprueba
   * contra `null` a propósito y no con `!inicio`: las 00:00 son cero minutos, y
   * una sesión que empieza a medianoche existe.
   */
  if (inicio === null || fin === null) return null;

  if (inicio === fin) {
    return `El acta dice que ${cual} empezó y terminó a las ${enReloj(inicio)}, o sea que no `
      + 'duró nada. Revise las horas.';
  }
  if (fin < inicio) {
    return `El acta dice que ${cual} empezó a las ${enReloj(inicio)} y terminó a las `
      + `${enReloj(fin)}. Si de verdad terminó pasada la medianoche, confirme; si no, corrija las horas.`;
  }
  return null;
}

module.exports = {
  FIRMADA,
  LO_QUE_DICE,
  comoQueda,
  loDelActaVacia,
  loDeLasHoras,
  camposDeLaFirma,
  loQueCambia,
  avisoDeActaFirmada,
  anotarLaFirma,
  enUnSoloAviso,
  avisoDeActaQueSeBorra,
};
