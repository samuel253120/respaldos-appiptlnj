/**
 * El perfil de cada persona: sus propios datos, que puede mantener al día
 * ella misma sin depender de la oficina.
 *
 * Lo que edita aquí es **lo suyo**: cómo se llama, cómo contactarla, sus
 * estudios, a quién avisar en una emergencia y su información médica. Lo que
 * decide la iglesia —su iglesia, su estado, su tipo de miembro, sus fechas de
 * bautismo e ingreso, su trato, su rol en el sistema— no se toca desde acá.
 *
 * Si la persona está enlazada a su ficha de miembro, sus datos se guardan
 * ALLÁ, que es donde viven, y el usuario del sistema queda al día solo (RUT,
 * nombre, correo y teléfono se mantienen iguales en los dos, como siempre).
 * Si no lo está, se guardan en su cuenta de usuario.
 */
const { db } = require('./db');
const { getModule } = require('./registry');
const { coerce, revisarYEscribir, ErrorDeDatos } = require('./crud');

/**
 * Los datos que cada persona puede cambiar de sí misma, en el orden en que
 * se le muestran. Salen del propio módulo de Miembros: mismos campos, mismas
 * etiquetas, mismas listas y mismas condiciones que en su ficha.
 */
const MIOS_EN_MIEMBROS = [
  'foto', 'nombres', 'apellidos', 'fecha_nacimiento', 'genero',
  'nivel_educacional', 'titulo_estudios', 'ocupacion', 'lugar_trabajo',
  'estado_civil', 'fecha_matrimonio_civil', 'fecha_matrimonio_religioso', 'conyuge_nombre',
  'telefono', 'email', 'direccion',
  'emergencia_nombre', 'emergencia_parentesco', 'emergencia_telefono',
  'enfermedades', 'alergias', 'indicaciones_medicas',
];

/** Y estos, cuando la cuenta todavía no está enlazada a una ficha de miembro. */
const MIOS_EN_USUARIOS = ['foto', 'nombre', 'email', 'telefono'];

/** Los campos pedidos, tal como los declara su módulo. */
function camposDe(modulo, nombres) {
  const def = getModule(modulo);
  if (!def) return [];
  return nombres
    .map((n) => def.fields.find((f) => f.name === n))
    .filter(Boolean)
    .map(({ name, label, type, options, sugerencias, help, accept, showIf, seccion, mostrarEdad,
            buscador, sensible, ancho, recorte, required }) => ({
      name, label, type, options: options || null, sugerencias: sugerencias || null,
      help: help || null, accept: accept || null,
      showIf: showIf || null, seccion: seccion || null, mostrarEdad: !!mostrarEdad,
      buscador: buscador === undefined ? null : !!buscador, sensible: !!sensible,
      ancho: ancho || null, recorte: recorte || null,
      /*
       * OBLIGATORIO SE DICE, no se descubre al guardar.
       *
       * Acá iba `required: false` para todos, y con eso la pantalla no marcaba
       * ninguna casilla. Mientras el servidor tampoco lo exigía daba lo mismo;
       * desde que lo exige —que es el arreglo de MP-01— callarlo sería lo que
       * este sistema ya se prohibió en el hallazgo SA-01: dos líneas diciendo
       * cosas contrarias sobre la misma casilla, y ganando la que no se ve.
       *
       * Entre los campos que son suyos solo hay dos así, su nombre y su
       * apellido —o el nombre de su cuenta, si todavía no tiene ficha—, y
       * ninguno puede estar vacío hoy: son los que el sistema usa para nombrar
       * a una persona.
       */
      required: !!required,
      default: null, ref: null, optionsRoute: null, readonly: false,
      calcula: null, destacado: false, computed: false,
    }));
}

/** Todo lo que la pantalla de perfil necesita saber de quien la abre. */
function leer(usuarioId) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!usuario) return null;
  const miembro = usuario.miembro_id
    ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(usuario.miembro_id)
    : null;

  const iglesia = (miembro && miembro.iglesia_id) || usuario.iglesia_id;
  const nombreIglesia = iglesia
    ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(iglesia) || {}).nombre
    : null;

  const datos = {};
  const campos = miembro ? camposDe('miembros', MIOS_EN_MIEMBROS) : camposDe('usuarios', MIOS_EN_USUARIOS);
  for (const f of campos) datos[f.name] = (miembro || usuario)[f.name] ?? null;

  return {
    enlazado: !!miembro,
    campos,
    datos,
    // Lo que decide la iglesia, para verlo sin poder cambiarlo
    ficha: {
      rut: usuario.rut,
      rol: usuario.rol,
      iglesia: nombreIglesia,
      tratamiento: miembro ? require('./tratamiento').tratamientoDe(miembro, db) : null,
      tipo_miembro: miembro ? miembro.tipo_miembro : null,
      estado: miembro ? miembro.estado : null,
      fecha_ingreso: miembro ? miembro.fecha_ingreso : null,
      fecha_bautismo: miembro ? miembro.fecha_bautismo : null,
      miembro_id: miembro ? miembro.id : null,
    },
  };
}

/**
 * Guarda los cambios del perfil donde corresponde, pasando por las mismas
 * comprobaciones y las mismas sincronizaciones que si los hubiera hecho la
 * oficina desde la ficha.
 *
 * ── ANTES NO ERA CIERTO, Y ESTO LO ARREGLA ──
 *
 * Esa frase estaba escrita acá desde el principio, y lo que había debajo no la
 * cumplía: este archivo armaba su propio UPDATE y lo corría, así que ninguna de
 * las comprobaciones del motor llegaba a ejecutarse. MEDIDO en la v1.435.0, la
 * misma cosa por las dos puertas: un nombre en blanco, una fecha de nacimiento
 * en 2050, en 1820 o «el martes», un sexo que no está en la lista, un estado
 * civil inventado, una foto que no existe —diez casos de once entraban por acá
 * con 200 y la oficina los rechazaba con 400 (hallazgo MP-01)—.
 *
 * Ahora se llama a `revisarYEscribir`, que es la MISMA lista que corre la ruta
 * de un módulo, y con ella vienen la marca de versión, la firma de quién guardó
 * y la transacción, que tampoco había (MP-02 y MP-04).
 *
 * TRES COSAS DE LA RUTA NO SE PIDEN ACÁ, y cada una tiene su motivo:
 *
 * EL ALCANCE no se comprueba porque esta ficha es la suya. La ruta pregunta si
 * la persona alcanza el registro que está tocando; acá el registro sale de su
 * propia cuenta y no de lo que mande, así que la pregunta ya está contestada.
 * Pedirla además dejaría sin poder corregir sus datos a quien no alcance su
 * propia ficha —alguien de una iglesia que después le quitaron de encima—.
 *
 * LOS CAMPOS TRABADOS POR EL ESTADO de la ficha no se miran porque ninguno de
 * los que son suyos lo está: se comprobó preguntándole al módulo, y Miembros
 * hoy no declara ninguno. Si mañana declarara uno que es de los suyos, la lista
 * de acá abajo es donde hay que mirarlo.
 *
 * EL AVISO DE QUE OTRA PERSONA LA GUARDÓ sí llega, pero por el otro lado: la
 * pantalla de Mi perfil no tiene el dato abierto de antes que hace falta para
 * detectarlo, y quien sí lo tiene es la oficina. Lo que faltaba —y era el
 * defecto— es que este guardado SUBA la marca, para que la oficina se entere.
 * Eso ahora lo hace `revisarYEscribir`.
 */
function guardar(usuario, cambios) {
  const enMiembro = !!usuario.miembro_id;
  const modulo = enMiembro ? 'miembros' : 'usuarios';
  const def = getModule(modulo);
  const id = enMiembro ? usuario.miembro_id : usuario.id;
  const permitidos = enMiembro ? MIOS_EN_MIEMBROS : MIOS_EN_USUARIOS;

  const existing = db.prepare(`SELECT * FROM "${modulo}" WHERE id = ?`).get(id);
  if (!existing) return { error: 'No se encontró su ficha' };

  /*
   * Solo lo que es suyo: cualquier otro campo que venga se descarta. La lista
   * está escrita arriba, en un solo lugar, y es lo que impide que por acá entre
   * el estado, el tipo de miembro o la iglesia de alguien.
   *
   * Lo de SOLO LECTURA es un candado de más, y conviene que quede dicho: hoy no
   * se alcanza, porque ninguno de los campos que son suyos lo es —se comprobó
   * preguntándole a los dos módulos—. Quitarlo no pone roja ninguna prueba. Se
   * deja porque es lo que sostiene la regla el día que uno de ellos pase a
   * escribirlo el sistema, y se dice acá para que nadie lo lea como código vivo
   * que alguien olvidó probar; es la misma situación que el `id IS NOT ?` de
   * server/carpetas.js.
   */
  const data = {};
  for (const nombre of permitidos) {
    if (cambios[nombre] === undefined) continue;
    const campo = def.fields.find((f) => f.name === nombre);
    if (!campo || campo.readonly) continue;
    data[nombre] = coerce(campo, cambios[nombre]);
  }
  /*
   * Y lo reservado que esta persona no alcanza, tampoco. Su propia ficha es la
   * excepción y está escrita en server/sensibles.js —`esSuPropiaFicha`—, así
   * que llamar a esto NO le quita sus datos de salud: se los deja, que es de lo
   * que se trata Mi perfil. Se llama igual porque la excepción vive allá, y si
   * un día cambia tiene que cambiar para las dos puertas a la vez.
   */
  require('./sensibles').protegerAlGuardar(def, data, usuario, existing);
  if (!Object.keys(data).length) return { ok: true, sinCambios: true };

  try {
    revisarYEscribir(def, {
      isNew: false, id, existing, data, comoLlego: cambios, user: usuario,
      confirmado: cambios.igual_asi === true || cambios.igual_asi === 'true',
    });
  } catch (e) {
    if (e instanceof ErrorDeDatos || e.esDeDatos) {
      // Una PREGUNTA no es un rechazo: se pasa tal cual para que la pantalla la
      // convierta en dos botones. Antes se metía entera dentro del texto del
      // aviso y la persona leía «[object Object]», sin manera de contestar.
      return { error: e.message, ...(e.confirmar ? { confirmar: e.confirmar } : {}) };
    }
    throw e;
  }
  return { ok: true };
}

module.exports = { leer, guardar, MIOS_EN_MIEMBROS, MIOS_EN_USUARIOS };
