/**
 * Aislamiento: cada persona alcanza lo suyo, y nada más.
 *
 * POR QUÉ EXISTE ESTA SUITE. El sistema acota lo que ve cada usuario por dos
 * cosas: las IGLESIAS que administra y, dentro de ellas, los CUERPOS que tiene
 * asignados (ver server/alcance.js). El motor de módulos —server/crud.js— lo
 * aplica solo, sin que nadie tenga que acordarse: listados, fichas, planillas
 * y guardados pasan todos por ahí.
 *
 * El problema son las RUTAS PROPIAS. Un módulo puede declarar las suyas —«los
 * cuerpos de este miembro», «cómo está el acceso de esta cuenta», «los
 * responsables a los que se puede pasar una solicitud»—, y esas consultan la
 * base a mano. Ahí el alcance hay que ponerlo a mano también, y donde hay que
 * acordarse, tarde o temprano se olvida.
 *
 * La auditoría de la 1.98.0 recorrió las 102 rutas del sistema con la sesión
 * de alguien acotado y encontró diez que no comprobaban nada. La peor no era
 * una fuga de datos sino de PODER: quien administraba una iglesia podía
 * restablecerle la contraseña a una cuenta de otra y entrar con ella.
 *
 * Así que esto se pregunta cada vez, y se pregunta de las tres maneras:
 *
 *   1. LO AJENO NO SE VE. Se recorren todas las rutas buscando en la respuesta
 *      cualquier rastro de la otra iglesia o del otro cuerpo. No se mira lo que
 *      muestra la pantalla: se mira lo que entrega el servidor.
 *   2. LO AJENO NO SE TOCA. Restablecer contraseñas, cambiar permisos, escribir
 *      en la ficha de otro. Leer lo ajeno es grave; cambiarlo lo es más.
 *   2b. NI SE PUEDE APUNTAR A ÉL. Un registro no es solo su iglesia: es también
 *      aquello a lo que apunta. Se podía crear una ficha de integrante que
 *      metiera a una persona de otra iglesia en un cuerpo propio —y, peor, a
 *      alguien de otro cuerpo de la misma iglesia, con lo que se pasaba a ver
 *      su ficha completa: la escritura descuidada era una llave para leer.
 *   3. LO PROPIO SIGUE ABIERTO. Un arreglo que cierra de más rompe el sistema
 *      sin que nadie lo note hasta que alguien no puede trabajar. Y el
 *      administrador general, que no tiene ninguna iglesia asignada, tiene que
 *      seguir alcanzándolo todo.
 *
 * El escenario se arma solo: dos iglesias que no tienen nada que ver, dos
 * cuerpos en la primera, gente y plata en cada una. Se reutiliza entre
 * corridas, así que no se va acumulando.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run aislamiento
 *   URL=http://localhost:3000 RUT=… CLAVE=… npm run aislamiento
 */
const { digitoVerificador } = require('../server/rut');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';
/*
 * Dos contraseñas, y no una, porque el sistema obliga a cambiar la que pone el
 * administrador: al guardar un usuario con contraseña, un hook le marca «debe
 * cambiarla» (ver server/modules/usuarios.js), y mientras esa marca esté
 * puesta CUALQUIER petición se responde con un 403 pidiendo el cambio.
 *
 * Eso no es un detalle de montaje: la primera versión de esta prueba dejaba
 * las sesiones acotadas con la marca puesta, así que las 386 peticiones del
 * punto 1 se contestaban con 403 y la prueba informaba «ninguna trae datos
 * ajenos» sin haber llegado nunca al código que comprueba el alcance. Pasaba
 * en verde contra un sistema roto. Por eso cada cuenta cambia su contraseña
 * como lo haría una persona, y por eso está el guardia de más abajo.
 */
const CLAVE_PUESTA = 'Cordillera47'; // la que le pone el administrador
const CLAVE_SUYA = 'Manquehue31';    // la que se pone la persona al entrar

let fallas = 0;
function revisar(loQueSeEspera, condicion, detalle) {
  if (condicion) {
    console.log(`   ✅ ${loQueSeEspera}`);
  } else {
    fallas++;
    console.log(`   ❌ ${loQueSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

/** Una sesión, en forma de función que pide cosas. */
const sesion = (token) => async (metodo, ruta, cuerpo) => {
  const res = await fetch(URL + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
  return { estado: res.status, texto, json };
};

async function entrar(rut, clave) {
  const d = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, password: clave }),
  }).then((r) => r.json());
  return d.token || null;
}

const rutDe = (n) => `${n}-${digitoVerificador(String(n))}`;

/* ------------------------------------------------------------------ *
 * El escenario
 * ------------------------------------------------------------------ */

/**
 * Dos iglesias ajenas entre sí, con dos cuerpos en la primera.
 *
 * Se busca antes de crear: la prueba corre muchas veces contra el mismo
 * servidor y no tiene por qué ir dejando iglesias nuevas cada vez. Los nombres
 * llevan una marca para reconocerlos y no confundirlos con datos de verdad.
 */
const MARCA = 'ZZ-PRUEBA-AISLAMIENTO';

async function montarEscenario(admin) {
  const buscarOCrear = async (modulo, comoSeReconoce, cuerpo) => {
    const ya = await admin('GET', `/api/${modulo}?page=1&pageSize=500`);
    const filas = (ya.json && ya.json.rows) || [];
    const encontrada = filas.find(comoSeReconoce);
    if (encontrada) return encontrada;
    const r = await admin('POST', `/api/${modulo}`, cuerpo);
    if (!r.json || !r.json.id) {
      throw new Error(`no se pudo preparar ${modulo}: ${r.estado} ${r.texto.slice(0, 200)}`);
    }
    return r.json;
  };

  /*
   * El código de una iglesia es corto por regla —va dentro del número de cada
   * solicitud, que se dicta por teléfono—, así que las dos de la prueba llevan
   * una marca propia y corta. Se reconocen igual por el nombre, que sí lleva la
   * marca larga.
   */
  const norte = await buscarOCrear('iglesias', (f) => f.codigo === 'ZZPRUEBA-N',
    { nombre: `Iglesia Norte ${MARCA}`, codigo: 'ZZPRUEBA-N', estado: 'Activa' });
  const sur = await buscarOCrear('iglesias', (f) => f.codigo === 'ZZPRUEBA-S',
    { nombre: `Iglesia Sur ${MARCA}`, codigo: 'ZZPRUEBA-S', estado: 'Activa' });

  const damas = await buscarOCrear('cuerpos', (f) => f.nombre === `Damas ${MARCA} Norte`,
    { nombre: `Damas ${MARCA} Norte`, tipo: 'Cuerpo', iglesia_id: norte.id, estado: 'Activo' });
  const jovenes = await buscarOCrear('cuerpos', (f) => f.nombre === `Jovenes ${MARCA} Norte`,
    { nombre: `Jovenes ${MARCA} Norte`, tipo: 'Cuerpo', iglesia_id: norte.id, estado: 'Activo' });
  const cuerpoSur = await buscarOCrear('cuerpos', (f) => f.nombre === `Damas ${MARCA} Sur`,
    { nombre: `Damas ${MARCA} Sur`, tipo: 'Cuerpo', iglesia_id: sur.id, estado: 'Activo' });

  // La gente. Los apellidos son la aguja con que después se busca la fuga.
  let siguiente = 21000000;
  const nuevoRut = async () => {
    for (let i = 0; i < 60000; i++) {
      const r = rutDe(siguiente++);
      const hay = await admin('GET', `/api/miembros?q=${encodeURIComponent(r)}`);
      const usuarios = await admin('GET', `/api/usuarios?q=${encodeURIComponent(r)}`);
      const libre = (hay.json && hay.json.total === 0) && (!usuarios.json || usuarios.json.total === 0);
      if (libre) return r;
    }
    throw new Error('no quedan RUT libres para la prueba');
  };

  const persona = async (apellidos, iglesiaId, cuerpoId) => {
    const ya = await admin('GET', `/api/miembros?q=${encodeURIComponent(apellidos)}`);
    const encontrada = ((ya.json && ya.json.rows) || []).find((f) => f.apellidos === apellidos);
    if (encontrada) return encontrada;
    const m = await admin('POST', '/api/miembros', {
      nombres: 'Persona', apellidos, rut: await nuevoRut(),
      iglesia_id: iglesiaId, estado: 'Activo',
    });
    if (!m.json || !m.json.id) throw new Error(`no se pudo crear ${apellidos}: ${m.texto.slice(0, 200)}`);
    await admin('POST', '/api/integrantes_cuerpo', {
      cuerpo_id: cuerpoId, miembro_id: m.json.id, iglesia_id: iglesiaId,
      estado: 'Activo', fecha_ingreso: '2026-01-01',
    });
    return m.json;
  };

  const deDamas = await persona(`Damasnorte${MARCA}`, norte.id, damas.id);
  const deJovenes = await persona(`Jovenesnorte${MARCA}`, norte.id, jovenes.id);
  const delSur = await persona(`Delsur${MARCA}`, sur.id, cuerpoSur.id);

  const pastorSur = await buscarOCrear('pastores', (f) => f.apellidos === `Pastorsur${MARCA}`,
    { nombres: 'Pastor', apellidos: `Pastorsur${MARCA}`, rut: await nuevoRut(),
      iglesia_id: sur.id, cargo: 'Pastor Probando', estado: 'Activo' });

  const cuentaSur = await buscarOCrear('cuentas_tesoreria', (f) => f.nombre === `Caja ${MARCA} Sur`,
    { nombre: `Caja ${MARCA} Sur`, ambito: 'Iglesia local', iglesia_id: sur.id, estado: 'Activa', saldo_inicial: 100000 });
  const cuentaJovenes = await buscarOCrear('cuentas_tesoreria', (f) => f.nombre === `Caja ${MARCA} Jovenes`,
    { nombre: `Caja ${MARCA} Jovenes`, ambito: 'Cuerpo / Grupo', iglesia_id: norte.id, cuerpo_id: jovenes.id,
      estado: 'Activa', saldo_inicial: 50000 });

  const actividadSur = await buscarOCrear('asistencias', (f) => f.nombre === `Culto ${MARCA} Sur`,
    { nombre: `Culto ${MARCA} Sur`, fecha: '2026-08-02', iglesia_id: sur.id, cuerpos: [cuerpoSur.id], tipo: 'Culto' });

  /*
   * Y una actividad COMPARTIDA por los dos cuerpos del Norte: el caso del coro
   * cantando en un aniversario junto a otros. Existe para probar el recorte del
   * enlace acta–asistencia (1.99.0), que es donde se ve si el alcance por
   * cuerpo aguanta cuando la actividad no es de un cuerpo solo.
   */
  const actividadCompartida = await buscarOCrear('asistencias',
    (f) => f.nombre === `Aniversario ${MARCA}`,
    { nombre: `Aniversario ${MARCA}`, fecha: '2026-08-21', iglesia_id: norte.id,
      cuerpos: [damas.id, jovenes.id], tipo: 'Culto' });

  // Un acta de la otra iglesia, para probar que su PDF no se baja desde acá
  const actaSur = await buscarOCrear('actas_reuniones', (f) => f.numero_acta === `ACTA-${MARCA}-SUR`,
    { numero_acta: `ACTA-${MARCA}-SUR`, fecha: '2026-08-02', iglesia_id: sur.id,
      cuerpo_id: cuerpoSur.id, tipo: 'Ordinaria', estado: 'Borrador',
      presidida_por: `Preside ${MARCA}`,
      // Con algo escrito: desde la 1.276.0 un acta que no dice nada pregunta
      // antes de guardarse, y acá el acta es el señuelo, no lo que se prueba.
      acuerdos: `<p>Acuerdo del Sur ${MARCA}.</p>` });

  /*
   * Un servicio del Sur con una ofrenda imposible de confundir: los totales del
   * listado y del informe de servicios son una suma, y una suma no se delata
   * con el nombre de nadie. Si el alcance no se respetara, la cifra del Norte
   * traería estos $7.654.321 adentro sin que ningún dato ajeno se viera.
   */
  const servicioSur = await buscarOCrear('servicios',
    (f) => f.fecha === '2028-09-03' && String(f.iglesia_id) === String(sur.id),
    { fecha: '2028-09-03', tipo: 'Servicio Especial', iglesia_id: sur.id,
      ofrenda_total: 7654321, asistencia_adultos: 4321,
      // Y con una miembro del Sur predicando: así se puede comprobar que a nadie
      // del Norte se le abre en qué sirvió una persona de allá
      predicador: `${delSur.nombres} ${delSur.apellidos}`, predicador_id: delSur.id });

  const perfil = await buscarOCrear('perfiles_permisos', (f) => f.nombre === `Perfil ${MARCA}`,
    { nombre: `Perfil ${MARCA}`, estado: 'Activo', permisos: JSON.stringify({ miembros: ['view'] }) });

  /** Una cuenta acotada, con la sesión ya abierta y utilizable. */
  const cuenta = async (nombre, rol, iglesias, cuerpos) => {
    const ya = await admin('GET', `/api/usuarios?q=${encodeURIComponent(nombre)}`);
    let fila = ((ya.json && ya.json.rows) || []).find((f) => f.nombre === nombre);
    if (!fila) {
      const r = await admin('POST', '/api/usuarios', {
        rut: await nuevoRut(), nombre, rol, activo: 1, password: CLAVE_PUESTA,
        iglesias, cuerpos, iglesia_id: iglesias[0],
      });
      if (!r.json || !r.json.id) throw new Error(`no se pudo crear ${nombre}: ${r.texto.slice(0, 200)}`);
      fila = r.json;
    }
    // La asignación se reafirma SIN tocar la contraseña: mandarla otra vez
    // volvería a marcar «debe cambiarla» y dejaría la sesión inservible.
    await admin('PUT', `/api/usuarios/${fila.id}`, { iglesias, cuerpos, activo: 1 });

    // De corridas anteriores ya puede tener puesta la suya
    let token = await entrar(fila.rut, CLAVE_SUYA);
    if (!token) {
      await admin('PUT', `/api/usuarios/${fila.id}`, { password: CLAVE_PUESTA });
      const provisorio = await entrar(fila.rut, CLAVE_PUESTA);
      if (!provisorio) throw new Error(`no se pudo entrar como ${nombre} (${fila.rut}) con la clave puesta`);
      // Se la cambia por la suya, como haría cualquiera al entrar la primera vez
      const cambio = await sesion(provisorio)('POST', '/api/auth/cambiar-password', {
        actual: CLAVE_PUESTA, nueva: CLAVE_SUYA, repetir: CLAVE_SUYA,
      });
      if (cambio.estado !== 200) {
        throw new Error(`${nombre} no pudo cambiar su contraseña: ${cambio.estado} ${cambio.texto.slice(0, 160)}`);
      }
      token = await entrar(fila.rut, CLAVE_SUYA);
      if (!token) throw new Error(`no se pudo entrar como ${nombre} tras cambiar la contraseña`);
    }
    return { ...fila, token };
  };

  const secretaria = await cuenta(`Secretaria ${MARCA}`, 'secretario', [norte.id], [damas.id]);
  const adminNorte = await cuenta(`Admin Norte ${MARCA}`, 'admin', [norte.id], []);
  const delOtroLado = await cuenta(`Secretaria Sur ${MARCA}`, 'secretario', [sur.id], []);
  // Una administradora de la OTRA iglesia: hace falta una cuenta que tenga la
  // llave de enviar mensajes para poder comprobar qué le muestra el historial.
  // Sin ella, pedirlo daba 403 por falta de permiso y el agujero quedaba tapado
  // por el motivo equivocado.
  const adminSur = await cuenta(`Admin Sur ${MARCA}`, 'admin', [sur.id], []);
  // Una cuenta de la propia iglesia del administrador del Norte, para que las
  // pruebas que RESTABLECEN contraseñas no le rompan la sesión a la secretaria.
  const ayudante = await cuenta(`Ayudante ${MARCA}`, 'secretario', [norte.id], []);

  return {
    norte, sur, damas, jovenes, cuerpoSur,
    deDamas, deJovenes, delSur, pastorSur,
    cuentaSur, cuentaJovenes, actividadSur, actividadCompartida, actaSur, perfil, servicioSur,
    secretaria, adminNorte, delOtroLado, adminSur, ayudante,
  };
}

/**
 * Que las sesiones acotadas SIRVAN, antes de concluir nada con ellas.
 *
 * Es el guardia contra la peor manera de fallar que tiene esta prueba: que las
 * peticiones se rechacen por un motivo ajeno al alcance —una contraseña sin
 * cambiar, una cuenta desactivada, un pase vencido— y que el punto 1 informe
 * «no se escapó nada» porque no llegó a preguntar nada. Si una sesión no
 * alcanza ni lo suyo, la prueba se detiene en vez de aprobar.
 */
async function lasSesionesSirven(E) {
  for (const [quien, usuario] of [['la secretaria', E.secretaria], ['el administrador del Norte', E.adminNorte]]) {
    const r = await sesion(usuario.token)('GET', '/api/miembros?page=1&pageSize=1');
    if (r.estado !== 200) {
      throw new Error(
        `la sesión de ${quien} no sirve para pedir nada (respondió ${r.estado}: ` +
        `${r.texto.slice(0, 140).replace(/\s+/g, ' ')}). Sin sesiones que funcionen, esta prueba ` +
        'no comprueba el alcance: aprobaría sin haber preguntado.'
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * 1 · Lo ajeno no se ve
 * ------------------------------------------------------------------ */

/**
 * Busca en la respuesta rastros de lo que esa persona no tendría que alcanzar.
 *
 * El buscador y los listados DEVUELVEN LA PREGUNTA dentro de la respuesta
 * —«{"q":"Delsur","total":0}»—, así que buscar la aguja en el texto crudo la
 * encuentra siempre: se encuentra a sí misma. Eso no es una fuga, es el eco, y
 * se quita antes de mirar. Sin esto la prueba denuncia siete fugas que no
 * existen, y una prueba que grita de mentira se termina ignorando.
 */
function fugasDe(respuesta, agujas) {
  if ([401, 403, 404].includes(respuesta.estado)) return []; // cerrado: bien
  let texto = respuesta.texto;
  if (respuesta.json && typeof respuesta.json.q === 'string') {
    texto = texto.replace(JSON.stringify(respuesta.json.q), '""');
  }
  return agujas.filter(([aguja]) => texto.includes(aguja));
}

async function loAjenoNoSeVe(E, modulos) {
  console.log('\n1 · Lo ajeno no se ve');

  const deOtraIglesia = [
    [E.sur.nombre, 'el nombre de la otra iglesia'],
    [E.delSur.apellidos, 'una miembro de la otra iglesia'],
    [E.pastorSur.apellidos, 'el pastor de la otra iglesia'],
    [E.cuerpoSur.nombre, 'un cuerpo de la otra iglesia'],
    [E.cuentaSur.nombre, 'una cuenta de la otra iglesia'],
    [E.actividadSur.nombre, 'una actividad de la otra iglesia'],
    [E.delSur.rut, 'el RUT de una miembro de la otra iglesia'],
    [E.pastorSur.rut, 'el RUT del pastor de la otra iglesia'],
    [`Preside ${MARCA}`, 'quien preside un acta de la otra iglesia'],
  ];
  /*
   * Lo que NO puede ver de otro cuerpo es su GENTE y su plata.
   *
   * El NOMBRE del otro cuerpo no está en esta lista, y es a propósito: una
   * actividad puede convocar a varios —el coro cantando en un aniversario junto
   * a otros cinco— y quien participó en ella la ve entera, con los nombres de
   * los cuerpos que la compartieron. Ocultarlos dejaría la actividad
   * incomprensible («convocó a 6 cuerpos, no se dice cuáles») sin proteger nada
   * que valga: el nombre de un cuerpo de la propia iglesia no es un dato de
   * nadie. Lo que sí se protege —y se comprueba abajo— es que de esos cuerpos
   * no salga NI UNA PERSONA.
   */
  const deOtroCuerpo = [
    [E.deJovenes.apellidos, 'un miembro de otro cuerpo de su misma iglesia'],
    [E.cuentaJovenes.nombre, 'la caja de otro cuerpo'],
    [E.deJovenes.rut, 'el RUT de alguien de otro cuerpo'],
  ];

  const quienes = [
    { quien: 'a la secretaria de un cuerpo', usuario: E.secretaria, agujas: [...deOtraIglesia, ...deOtroCuerpo] },
    { quien: 'al administrador de una iglesia', usuario: E.adminNorte, agujas: deOtraIglesia },
  ];

  let revisadas = 0;
  const encontradas = [];

  for (const caso of quienes) {
    const pedir = sesion(caso.usuario.token);
    const rutas = [];

    // Todos los módulos: su listado, sus opciones, su planilla y su búsqueda
    for (const m of modulos) {
      rutas.push(`/api/${m}?page=1&pageSize=500`, `/api/${m}/options`, `/api/${m}/planilla`,
        `/api/${m}?q=${encodeURIComponent(MARCA)}`);
    }

    // Y las fichas y rutas propias de lo ajeno, pedidas por su número
    rutas.push(
      `/api/iglesias/${E.sur.id}`,
      `/api/cuerpos/${E.cuerpoSur.id}`, `/api/cuerpos/${E.jovenes.id}`,
      `/api/miembros/${E.delSur.id}`, `/api/miembros/${E.deJovenes.id}`,
      `/api/pastores/${E.pastorSur.id}`,
      `/api/cuentas_tesoreria/${E.cuentaSur.id}`, `/api/cuentas_tesoreria/${E.cuentaJovenes.id}`,
      `/api/asistencias/${E.actividadSur.id}`,
      `/api/cuerpos/${E.cuerpoSur.id}/integrantes`, `/api/cuerpos/${E.jovenes.id}/integrantes`,
      `/api/cuerpos/${E.cuerpoSur.id}/cuotas`, `/api/cuerpos/${E.jovenes.id}/cuotas`,
      `/api/cuerpos/${E.cuerpoSur.id}/cumplimiento`, `/api/cuerpos/${E.jovenes.id}/cumplimiento`,
      `/api/miembros/${E.delSur.id}/cuerpos`, `/api/miembros/${E.deJovenes.id}/cuerpos`,
      `/api/miembros/${E.delSur.id}/usuario`,
      `/api/pastores/${E.pastorSur.id}/ficha-miembro`,
      '/api/pastores/con-conyuge', '/api/pastores/conyuges',
      `/api/cuentas_tesoreria/${E.cuentaSur.id}/estado`, `/api/cuentas_tesoreria/${E.cuentaJovenes.id}/estado`,
      '/api/cuentas_tesoreria/activas', '/api/cuentas_tesoreria/destinos', '/api/tesoreria/resumen',
      `/api/asistencias/${E.actividadSur.id}/lista`, '/api/asistencias/agenda',
      '/api/asistencias/informe?desde=2020-01-01&hasta=2030-12-31',
      `/api/asistencias/hoja-mensual?cuerpo_id=${E.cuerpoSur.id}&anio=2026&mes=8`,
      `/api/asistencias/hoja-mensual?cuerpo_id=${E.jovenes.id}&anio=2026&mes=8`,
      '/api/solicitudes/responsables',
      `/api/perfiles_permisos/${E.perfil.id}/usuarios`, '/api/perfiles_permisos/activos',
      `/api/usuarios/${E.delOtroLado.id}/clave`,
      '/api/directivas/oficiales',
      `/api/directivas/integrantes?cuerpo_id=${E.cuerpoSur.id}`,
      `/api/directivas/integrantes?cuerpo_id=${E.jovenes.id}`,
      // Las que enlazan un acta con su asistencia (1.99.0): dicen qué
      // actividades tuvo un cuerpo y quiénes de él estuvieron
      `/api/asistencias/de-cuerpo?cuerpo_id=${E.cuerpoSur.id}`,
      `/api/asistencias/de-cuerpo?cuerpo_id=${E.jovenes.id}`,
      `/api/asistencias/${E.actividadSur.id}/por-cuerpo?cuerpo_id=${E.cuerpoSur.id}`,
      `/api/asistencias/${E.actividadSur.id}/por-cuerpo?cuerpo_id=${E.jovenes.id}`,
      // El PDF de un acta ajena (1.100.0): es el acta entera en un archivo
      `/api/actas_reuniones/${E.actaSur.id}/pdf`,
      `/api/actas_reuniones/${E.actaSur.id}`,
      '/api/dashboard', '/api/pendientes', '/api/huerfanos', '/api/avisos', '/api/meta',
      `/api/buscar?q=${encodeURIComponent(E.delSur.apellidos)}`,
      `/api/buscar?q=${encodeURIComponent(E.deJovenes.apellidos)}`,
      `/api/buscar?q=${encodeURIComponent(E.delSur.rut)}`,
      '/api/credenciales/resumen', '/api/credenciales/por-vencer',
      `/api/credenciales/nueva/${E.pastorSur.id}`
    );

    for (const ruta of rutas) {
      const r = await pedir('GET', ruta);
      revisadas++;
      for (const [aguja, queEs] of fugasDe(r, caso.agujas)) {
        encontradas.push({ quien: caso.quien, ruta, estado: r.estado, queEs, aguja });
        break; // una por ruta basta para denunciarla
      }
    }
  }

  revisar(`ninguna de las ${revisadas} respuestas trae datos ajenos`, encontradas.length === 0);
  for (const f of encontradas) {
    console.log(`      · GET ${f.ruta}`);
    console.log(`        a ${f.quien} se le escapó ${f.queEs} («${f.aguja}»), con ${f.estado}`);
  }

  /*
   * Y las SUMAS, que no se pillan buscando palabras.
   *
   * El barrido de arriba busca datos ajenos por su texto —un apellido, el
   * nombre de una cuenta—, y un total no tiene texto: son $7.654.321 metidos
   * dentro de una cifra que se ve perfectamente razonable. Por eso los totales
   * de servicios se comprueban aparte, con una ofrenda del Sur que no se puede
   * confundir con nada.
   */
  const norte = sesion(E.adminNorte.token);
  const suTotal = await norte('GET', '/api/servicios/resumen');
  const suInforme = await norte('GET', '/api/servicios/informe');
  const laDelSur = 7654321;
  const suma = (r) => Number(((r.json || {}).resumen || r.json || {}).ofrenda || 0);
  revisar('los totales de servicios no le suman la ofrenda de la otra iglesia',
    suTotal.estado === 200 && suma(suTotal) < laDelSur,
    `respondió ${suTotal.estado} con una ofrenda de ${suma(suTotal)}, y la del Sur sola es ${laDelSur}`);
  revisar('ni el informe por mes y por tipo',
    suInforme.estado === 200 && suma(suInforme) < laDelSur
      && !JSON.stringify((suInforme.json || {}).porTipo || []).includes('7654321'),
    `respondió ${suInforme.estado} con una ofrenda de ${suma(suInforme)}`);

  /*
   * Y en qué servicios sirvió una persona de la otra iglesia. La ficha de esa
   * persona ya está cerrada —eso se comprueba arriba—, pero esta ruta se pide
   * por el número de la ficha, así que hay que ver qué contesta cuando el
   * número es de alguien de allá.
   */
  const suPapel = await norte('GET', `/api/servicios/de-persona?id=${E.delSur.id}`);
  const nada = suPapel.json && suPapel.json.veces && !suPapel.json.veces.servicios
    && !(suPapel.json.servicios || []).length;
  revisar('ni en qué servicios sirvió alguien de la otra iglesia',
    suPapel.estado === 200 && nada,
    `respondió ${suPapel.estado}: ${suPapel.texto.slice(0, 160).replace(/\s+/g, ' ')}`);
}

/* ------------------------------------------------------------------ *
 * 2 · Lo ajeno no se toca
 * ------------------------------------------------------------------ */

async function loAjenoNoSeToca(E) {
  console.log('\n2 · Lo ajeno no se toca');
  const norte = sesion(E.adminNorte.token);
  const ajena = E.delOtroLado; // una cuenta que vive en la otra iglesia

  const cerrado = async (que, respuesta) => {
    const ok = respuesta.estado === 403 || respuesta.estado === 404;
    revisar(que, ok, ok ? null : `respondió ${respuesta.estado}: ${respuesta.texto.slice(0, 160).replace(/\s+/g, ' ')}`);
    return ok;
  };

  const listado = await norte('GET', '/api/usuarios?page=1&pageSize=500');
  revisar('una cuenta de otra iglesia no sale en su listado de usuarios',
    !listado.texto.includes(ajena.nombre));

  await cerrado('ni se puede abrir su ficha por su número', await norte('GET', `/api/usuarios/${ajena.id}`));
  await cerrado('ni mirarle el nombre y el RUT', await norte('GET', `/api/usuarios/${ajena.id}/clave`));

  /*
   * La que de verdad importa. Esto no era una fuga de datos sino de PODER: la
   * respuesta traía la contraseña nueva, así que quien la pedía entraba en la
   * cuenta ajena. Se comprobó en vivo entre dos iglesias antes de arreglarlo.
   */
  const reset = await norte('POST', `/api/usuarios/${ajena.id}/restablecer-clave`, {});
  const seNego = await cerrado('NI RESTABLECERLE LA CONTRASEÑA', reset);
  if (!seNego && reset.json && reset.json.clave) {
    const entro = await entrar(ajena.rut, reset.json.clave);
    revisar('y desde luego no se entra a la cuenta ajena con esa contraseña', !entro,
      entro ? 'se entró: la cuenta quedó en manos de otra iglesia' : null);
  }

  await cerrado('ni desbloquearle la recuperación',
    await norte('POST', `/api/usuarios/${ajena.id}/desbloquear-recuperacion`, {}));

  const puesto = await norte('POST', `/api/perfiles_permisos/${E.perfil.id}/usuarios`, { usuarios: [ajena.id] });
  revisar('ni cambiarle el perfil de permisos',
    !(puesto.json && puesto.json.puestos > 0),
    puesto.json && puesto.json.puestos > 0 ? `se le puso el perfil: ${puesto.texto.slice(0, 120)}` : null);

  /*
   * Esta comprobación estaba escrita solo como una negación —«que no aparezca
   * su nombre»— y una negación la cumple cualquier respuesta que no lo traiga,
   * incluida una avería. Se midió en la v1.327.0: rota a propósito la línea
   * que acota esa lista, la ruta contestaba 500 y esto seguía en verde.
   *
   * Así que ahora se exige que la ruta FUNCIONE y traiga lo que le toca: la
   * cuenta de su propia iglesia sí, la de la otra no. Una comprobación que no
   * distingue «bien acotado» de «reventado» no comprueba el acotado.
   */
  const delPerfil = await norte('GET', `/api/perfiles_permisos/${E.perfil.id}/usuarios`);
  revisar('la lista del perfil le responde, y con lo suyo',
    delPerfil.estado === 200 && delPerfil.json && Array.isArray(delPerfil.json.disponibles)
      && delPerfil.json.disponibles.some((u) => u.id === E.ayudante.id),
    `respondió ${delPerfil.estado}: ${delPerfil.texto.slice(0, 160).replace(/\s+/g, ' ')}`);
  revisar('y no le muestra la cuenta ajena, con su RUT y su iglesia',
    !delPerfil.texto.includes(ajena.nombre));

  const responsables = await norte('GET', '/api/solicitudes/responsables');
  revisar('ni ofrecerla como responsable de una solicitud',
    !responsables.texto.includes(ajena.nombre));

  await cerrado('ni escribir en la ficha del pastor de la otra iglesia',
    await norte('POST', `/api/pastores/${E.pastorSur.id}/copiar-rut`, {}));
}

/* ------------------------------------------------------------------ *
 * 2b · Ni se puede apuntar a lo ajeno
 * ------------------------------------------------------------------ */

/**
 * Las escrituras que cruzan el alcance, que el punto 1 no puede ver.
 *
 * El punto 1 recorre lo que se LEE. Esto recorre lo que se ESCRIBE: crear en
 * otra iglesia, editar y borrar lo ajeno, mudar lo propio hacia allá, y —lo
 * que se descubrió al final de la auditoría— nombrar por su número un cuerpo o
 * una persona que no se alcanzan.
 */
async function niSePuedeApuntarALoAjeno(E, admin) {
  console.log('\n2b · Ni se puede apuntar a lo ajeno');
  const norte = sesion(E.adminNorte.token);
  const secre = sesion(E.secretaria.token);

  // Algunas se frenan con 400 y su explicación en vez de 403; las dos sirven,
  // lo que no puede pasar es que el registro quede guardado.
  const noSeGuarda = (que, r) => {
    const ok = [400, 403, 404].includes(r.estado);
    revisar(que, ok, ok ? null : `respondió ${r.estado}: ${r.texto.slice(0, 160).replace(/\s+/g, ' ')}`);
    return ok;
  };

  noSeGuarda('no se crea un miembro en la iglesia ajena',
    await norte('POST', '/api/miembros', {
      nombres: 'Intruso', apellidos: `Metido${MARCA}`, iglesia_id: E.sur.id, estado: 'Activo',
    }));
  noSeGuarda('ni se edita la ficha de una miembro de allá',
    await norte('PUT', `/api/miembros/${E.delSur.id}`, { telefono: '+56900000000' }));
  noSeGuarda('ni se borra',
    await norte('DELETE', `/api/miembros/${E.delSur.id}`));
  noSeGuarda('ni se le carga un movimiento a una cuenta de allá',
    await norte('POST', '/api/tesoreria', {
      fecha: '2026-08-20', tipo: 'Egreso', monto: 50000, concepto: 'Metido',
      cuenta_id: E.cuentaSur.id, iglesia_id: E.sur.id, categoria: 'Otros',
    }));

  // La puerta de atrás: llevarse lo propio hacia la iglesia del otro
  const mudanza = await norte('PUT', `/api/miembros/${E.deDamas.id}`, { iglesia_id: E.sur.id });
  revisar('ni se muda una ficha propia a la iglesia ajena', mudanza.estado !== 200,
    mudanza.estado === 200 ? 'la ficha se fue a la otra iglesia' : null);

  /*
   * Y las dos que cierran la escalada. Se comprueba la CONSECUENCIA, no solo
   * la respuesta: que después de intentarlo, la ficha ajena siga sin verse.
   */
  const metida = await norte('POST', '/api/integrantes_cuerpo', {
    cuerpo_id: E.damas.id, miembro_id: E.delSur.id, iglesia_id: E.norte.id,
    estado: 'Activo', fecha_ingreso: '2026-01-01',
  });
  noSeGuarda('no se mete a una persona de otra iglesia en un cuerpo propio', metida);
  if (metida.json && metida.json.id) await admin('DELETE', `/api/integrantes_cuerpo/${metida.json.id}`);

  const laOtra = await secre('POST', '/api/integrantes_cuerpo', {
    cuerpo_id: E.damas.id, miembro_id: E.deJovenes.id, iglesia_id: E.norte.id,
    estado: 'Activo', fecha_ingreso: '2026-01-01',
  });
  noSeGuarda('ni a alguien de otro cuerpo, que era la manera de ampliarse el alcance', laOtra);
  /*
   * La consecuencia se mira ANTES de limpiar. Puesto al revés —limpiando y
   * después preguntando— este control pasaba aunque la escritura se hubiera
   * guardado, porque la fila ya no estaba: comprobaba la limpieza, no el
   * alcance. Se vio al desactivar a propósito la comprobación del motor.
   */
  const sigueCerrada = await secre('GET', `/api/miembros/${E.deJovenes.id}`);
  revisar('y su ficha sigue cerrada después de intentarlo', sigueCerrada.estado === 403,
    sigueCerrada.estado === 200 ? 'la escalada funcionó: pasó a ver a alguien de otro cuerpo' : null);
  if (laOtra.json && laOtra.json.id) await admin('DELETE', `/api/integrantes_cuerpo/${laOtra.json.id}`);

  /*
   * El recorte del enlace acta–asistencia, que es lo que sostiene la 1.99.0.
   * De una actividad COMPARTIDA, la secretaria de un cuerpo tiene que ver a los
   * suyos y a nadie más, aunque la actividad haya convocado a los dos.
   */
  const compartida = await secre(
    'GET', `/api/asistencias/${E.actividadCompartida.id}/por-cuerpo?cuerpo_id=${E.damas.id}`);
  revisar('de una actividad compartida ve la lista de SU cuerpo', compartida.estado === 200,
    `respondió ${compartida.estado}: ${compartida.texto.slice(0, 140)}`);
  revisar('y en ella no aparece nadie del otro cuerpo',
    !compartida.texto.includes(E.deJovenes.apellidos));
  const delOtro = await secre(
    'GET', `/api/asistencias/${E.actividadCompartida.id}/por-cuerpo?cuerpo_id=${E.jovenes.id}`);
  revisar('y pedir derecho la lista del otro cuerpo se cierra', delOtro.estado === 403,
    `respondió ${delOtro.estado}`);
  const actividadesAjenas = await secre('GET', `/api/asistencias/de-cuerpo?cuerpo_id=${E.jovenes.id}`);
  revisar('como se cierra preguntar qué actividades tuvo el otro cuerpo',
    actividadesAjenas.estado === 403, `respondió ${actividadesAjenas.estado}`);

  noSeGuarda('no se escribe en un cuerpo que no se tiene asignado',
    await secre('POST', '/api/actas_reuniones', {
      cuerpo_id: E.jovenes.id, iglesia_id: E.norte.id, fecha: '2026-08-20',
      numero_acta: `X-${MARCA}`, tipo: 'Ordinaria', desarrollo: 'Metida',
    }));

  /*
   * Los mensajes escritos a mano.
   *
   * La llave de enviarlos no puede convertirse en una manera de escribirle a
   * cuentas de otra iglesia, ni de averiguar cuáles existen: quien manda ve
   * exactamente a los mismos que ve en Usuarios, ni uno más.
   */
  const alcanzables = await norte('GET', '/api/avisos/mensajes/destinatarios');
  const enUsuarios = await norte('GET', '/api/usuarios?limit=200');
  if (alcanzables.estado === 200 && enUsuarios.estado === 200) {
    const puedeEscribir = (alcanzables.json.personas || []).map((u) => u.id);
    const ve = new Set((enUsuarios.json.rows || []).map((u) => u.id));
    const colados = puedeEscribir.filter((id) => !ve.has(id));
    revisar('a quién puede escribirle es exactamente a quién ve en Usuarios',
      colados.length === 0, `se colaron ${colados.length}: ${colados.join(', ')}`);
    revisar('y él mismo no está entre sus destinatarios',
      !puedeEscribir.includes(E.adminNorte.id), 'se puede mandar mensajes a sí mismo');
    const iglesiasQueOfrece = (alcanzables.json.iglesias || []).map((i) => i.id);
    revisar('ni se le ofrece la iglesia ajena para escribirle entera',
      !iglesiasQueOfrece.includes(E.sur.id), `ofrece ${iglesiasQueOfrece.join(', ')}`);
  } else {
    revisar('a quién puede escribirle es exactamente a quién ve en Usuarios', false,
      `no pude preguntarlo: ${alcanzables.estado} / ${enUsuarios.estado}`);
  }

  const aLaAjena = await norte('POST', '/api/avisos/mensajes', {
    titulo: `Colado ${MARCA}`, cuerpo: 'A ver si llega', destino: 'personas', valor: [E.delOtroLado.id],
  });
  revisar('escribirle derecho a una cuenta de la otra iglesia no llega a nadie',
    aLaAjena.estado === 400 || (aLaAjena.json && aLaAjena.json.cuantos === 0),
    `respondió ${aLaAjena.estado} y llegó a ${(aLaAjena.json || {}).cuantos}`);

  const aLaIglesiaAjena = await norte('POST', '/api/avisos/mensajes', {
    titulo: `Colado entero ${MARCA}`, cuerpo: 'A ver si llega', destino: 'iglesia', valor: E.sur.id,
  });
  revisar('ni mandándole un mensaje a la iglesia ajena entera',
    aLaIglesiaAjena.estado === 400 || (aLaIglesiaAjena.json && aLaIglesiaAjena.json.cuantos === 0),
    `respondió ${aLaIglesiaAjena.estado} y llegó a ${(aLaIglesiaAjena.json || {}).cuantos}`);

  /*
   * Y lo que se ha MANDADO se lee como se lee todo lo demás: lo de la gente que
   * uno ve.
   *
   * Esta es la puerta que quedó abierta en la 1.140.0. El historial traía los
   * últimos treinta envíos del sistema entero, con su texto completo, a
   * cualquiera que tuviera la llave: la administradora de una iglesia leía lo
   * que la de la otra le había escrito a su gente. Lo encontró la revisión del
   * módulo y no esta prueba, porque esta prueba miraba a quién se le puede
   * ESCRIBIR y no lo que se puede LEER. Ahora mira las dos.
   */
  /*
   * El texto lleva la hora de esta corrida y no solo la marca: la prueba se
   * corre muchas veces sobre la misma base, y con un texto repetido «el aviso
   * sigue en su campanita» lo daba por bueno encontrando el de la corrida
   * anterior —o sea, pasaba aunque el de ahora se hubiera borrado—.
   */
  const reservado = `Texto reservado ${MARCA} ${Date.now()}`;
  const propio = await norte('POST', '/api/avisos/mensajes', {
    titulo: `Asunto interno del Norte ${MARCA}`, cuerpo: reservado,
    destino: 'personas', valor: [E.ayudante.id],
  });
  const deAlla = sesion(E.adminSur.token);
  const historialAjeno = await deAlla('GET', '/api/avisos/mensajes?limit=200');
  const suPropioHistorial = await norte('GET', '/api/avisos/mensajes?limit=200');

  revisar('el historial de mensajes no le abre los de la otra iglesia',
    historialAjeno.estado === 200 && !historialAjeno.texto.includes(MARCA),
    `respondió ${historialAjeno.estado} y ${(historialAjeno.json && historialAjeno.json.mensajes || []).length} mensaje(s), `
    + `de los cuales con la marca: ${((historialAjeno.json && historialAjeno.json.mensajes) || []).filter((m) => String(m.titulo).includes(MARCA)).length}`);

  revisar('ni el texto de esos mensajes por ningún otro lado',
    !historialAjeno.texto.includes(reservado), 'el cuerpo del mensaje ajeno viajó igual');

  revisar('pero lo suyo lo sigue viendo',
    propio.estado === 201 && suPropioHistorial.estado === 200
      && suPropioHistorial.texto.includes(reservado),
    `mandó ${propio.estado} y su propio historial ${suPropioHistorial.estado}`);

  /*
   * Retirar es más que mirar: le borra el aviso a gente. Va por el mismo
   * alcance —lo que no se ve, no se toca— y por eso se comprueba acá y no solo
   * en las pruebas del motor: un 200 de más en esta ruta le saca de la
   * campanita un mensaje a una iglesia entera que no es la suya.
   */
  const retiroAjeno = await deAlla('POST', `/api/avisos/mensajes/${(propio.json || {}).id}/retirar`);
  const delQueLoRecibio = sesion(E.ayudante.token);
  const suCampanita = await delQueLoRecibio('GET', '/api/avisos?limit=50');
  revisar('ni le retira un mensaje a la otra iglesia',
    [400, 403, 404].includes(retiroAjeno.estado),
    `respondió ${retiroAjeno.estado}: ${retiroAjeno.texto.slice(0, 120).replace(/\s+/g, ' ')}`);
  revisar('y el aviso sigue en la campanita de quien lo recibió',
    suCampanita.estado === 200 && suCampanita.texto.includes(reservado),
    `respondió ${suCampanita.estado}`);

  const sinLlave = await secre('GET', '/api/avisos/mensajes/destinatarios');
  revisar('y sin la llave de enviar, la puerta está cerrada',
    sinLlave.estado === 403, `respondió ${sinLlave.estado}`);
}

/* ------------------------------------------------------------------ *
 * 3 · Lo propio sigue abierto
 * ------------------------------------------------------------------ */

async function loPropioSigueAbierto(E, admin) {
  console.log('\n3 · Lo propio sigue abierto');
  const norte = sesion(E.adminNorte.token);
  const secre = sesion(E.secretaria.token);

  const abre = (que, r, queDiga) => {
    const ok = r.estado === 200 && (!queDiga || r.texto.includes(queDiga));
    revisar(que, ok, ok ? null : `respondió ${r.estado}: ${r.texto.slice(0, 160).replace(/\s+/g, ' ')}`);
  };

  abre('el administrador de una iglesia abre la ficha de un miembro suyo',
    await norte('GET', `/api/miembros/${E.deDamas.id}`), E.deDamas.apellidos);
  abre('y ve en qué cuerpos participa',
    await norte('GET', `/api/miembros/${E.deDamas.id}/cuerpos`), E.damas.nombre);
  abre('y los de un cuerpo distinto de SU misma iglesia',
    await norte('GET', `/api/miembros/${E.deJovenes.id}/cuerpos`), E.jovenes.nombre);
  abre('y la cuenta enlazada a esa ficha',
    await norte('GET', `/api/miembros/${E.deDamas.id}/usuario`));
  abre('y su propia cuenta', await norte('GET', `/api/usuarios/${E.adminNorte.id}`));
  abre('y el estado de su propia contraseña',
    await norte('GET', `/api/usuarios/${E.adminNorte.id}/clave`), E.adminNorte.nombre);
  // Sobre el ayudante y no sobre la secretaria: restablecer una contraseña le
  // deja la sesión inservible a su dueño, y la secretaria todavía tiene que
  // hacer sus propias comprobaciones más abajo.
  abre('y administra una cuenta de SU iglesia: le restablece la contraseña',
    await norte('POST', `/api/usuarios/${E.ayudante.id}/restablecer-clave`, {}));
  abre('y le desbloquea la recuperación',
    await norte('POST', `/api/usuarios/${E.ayudante.id}/desbloquear-recuperacion`, {}));
  const puesto = await norte('POST', `/api/perfiles_permisos/${E.perfil.id}/usuarios`, { usuarios: [E.ayudante.id] });
  revisar('y le pone el perfil de permisos', puesto.json && puesto.json.puestos === 1,
    `respondió ${puesto.estado}: ${puesto.texto.slice(0, 140)}`);
  abre('y se lo saca', await norte('DELETE', `/api/perfiles_permisos/${E.perfil.id}/usuarios/${E.ayudante.id}`));

  abre('la secretaria abre la ficha de alguien de SU cuerpo',
    await secre('GET', `/api/miembros/${E.deDamas.id}`), E.deDamas.apellidos);
  abre('y la ficha de SU cuerpo', await secre('GET', `/api/cuerpos/${E.damas.id}`), E.damas.nombre);
  abre('y sus integrantes', await secre('GET', `/api/cuerpos/${E.damas.id}/integrantes`), E.deDamas.apellidos);
  abre('y los oficiales que puede elegir para una directiva',
    await secre('GET', '/api/directivas/oficiales'), E.deDamas.apellidos);
  abre('y encuentra lo suyo en el buscador',
    await secre('GET', `/api/buscar?q=${encodeURIComponent(E.deDamas.apellidos)}`), E.deDamas.apellidos);
  abre('y ve su panel', await secre('GET', '/api/dashboard'));

  // Escribir lo propio, que es la otra mitad de la mitad que se olvida
  abre('y edita la ficha de alguien de SU cuerpo',
    await secre('PUT', `/api/miembros/${E.deDamas.id}`, { telefono: '+56911112233' }));
  const actaPropia = await secre('POST', '/api/actas_reuniones', {
    cuerpo_id: E.damas.id, iglesia_id: E.norte.id, fecha: '2026-08-20',
    numero_acta: `P-${Date.now()}`, tipo: 'Ordinaria', desarrollo: 'La propia',
  });
  revisar('y levanta un acta en SU cuerpo', [200, 201].includes(actaPropia.estado),
    `respondió ${actaPropia.estado}: ${actaPropia.texto.slice(0, 150)}`);
  if (actaPropia.json && actaPropia.json.id) await admin('DELETE', `/api/actas_reuniones/${actaPropia.json.id}`);

  /*
   * Y la plata que se entrega HACIA ARRIBA, que es la excepción del sistema:
   * el destino de un traspaso puede ser una cuenta que quien lo anota no
   * administra —así una iglesia le entrega a la corporación y un cuerpo a su
   * iglesia—. Es la única excepción al «no se referencia lo que no se ve», y
   * por eso se comprueba acá y por sus dos lados: que sirva, y que no se haya
   * abierto de más.
   *
   * Se comprueba contra el servidor y no solo en el motor porque el defecto que
   * la trajo era justamente ese: el desplegable ofrecía una cosa y el guardado
   * aceptaba otra. Medido antes de arreglarlo, al administrador de una iglesia
   * el desplegable «Hacia» le ofrecía 38 cuentas y le servían 36; a una
   * tesorera de cuerpo le ofrecía 26 y le servía 1.
   */
  const suyas = (await norte('GET', '/api/cuentas_tesoreria?limit=200')).json.rows || [];
  const propia = suyas.find((c) => String(c.iglesia_id) === String(E.norte.id) && !c.cuerpo_id);
  const destinos = (await norte('GET', '/api/cuentas_tesoreria/destinos')).json || [];
  const deLaCorporacion = destinos.find((d) => / · Corporación$/.test(d.label));
  revisar('el desplegable «Hacia» le ofrece la cuenta de la corporación',
    !!deLaCorporacion, `ofreció ${destinos.length}: ${destinos.slice(0, 4).map((d) => d.label).join(' | ')}`);

  if (propia && deLaCorporacion) {
    const entrega = await norte('POST', '/api/traspasos', {
      fecha: '2026-02-02', cuenta_origen_id: propia.id, cuenta_destino_id: deLaCorporacion.id,
      monto: 1000, forma: 'Transferencia', concepto: `Entrega hacia arriba ${MARCA}`, igual_asi: true,
    });
    revisar('y le entrega de verdad: el caso que el módulo se pone de ejemplo',
      [200, 201].includes(entrega.estado),
      `respondió ${entrega.estado}: ${entrega.texto.slice(0, 170).replace(/\s+/g, ' ')}`);
    if (entrega.json && entrega.json.id) {
      const suyo = (await norte('GET', `/api/traspasos/${entrega.json.id}`)).estado;
      revisar('y después lo ve: anotar una entrega que no se puede ver no sirve de nada', suyo === 200,
        `la ficha respondió ${suyo}`);
      await admin('DELETE', `/api/traspasos/${entrega.json.id}`);
    }

    // Y no se abrió de más: entregar no es administrar
    const abrirla = await norte('GET', `/api/cuentas_tesoreria/${deLaCorporacion.id}`);
    revisar('pero no puede abrir esa cuenta: entregar no es administrar', abrirla.estado === 403,
      `la ficha respondió ${abrirla.estado}`);
    const alReves = await norte('POST', '/api/traspasos', {
      fecha: '2026-02-03', cuenta_origen_id: deLaCorporacion.id, cuenta_destino_id: propia.id,
      monto: 1000, forma: 'Efectivo', concepto: `Al revés ${MARCA}`, igual_asi: true,
    });
    revisar('ni sacar plata DE ella', ![200, 201].includes(alReves.estado),
      `respondió ${alReves.estado}`);
    const alLado = await norte('POST', '/api/traspasos', {
      fecha: '2026-02-04', cuenta_origen_id: propia.id, cuenta_destino_id: E.cuentaSur.id,
      monto: 1000, forma: 'Efectivo', concepto: `Al lado ${MARCA}`, igual_asi: true,
    });
    revisar('ni entregarle a otra congregación, que es hacia el lado',
      ![200, 201].includes(alLado.estado), `respondió ${alLado.estado}`);
    revisar('y la cuenta de la otra iglesia no figura entre los destinos que se le ofrecen',
      !destinos.some((d) => d.id === E.cuentaSur.id), 'estaba en la lista');
  }

  /*
   * El control que más importa de los tres. El administrador general no tiene
   * ninguna iglesia asignada, y eso significa «todas». Si el aislamiento lo
   * acotara sin querer, el sistema se quedaría sin quien lo administre entero
   * —y nadie lo notaría hasta que hiciera falta.
   */
  abre('el administrador general sigue viendo las cuentas de las dos iglesias',
    await admin('GET', '/api/usuarios?page=1&pageSize=500'), E.delOtroLado.nombre);
  abre('y la ficha del pastor de la otra iglesia',
    await admin('GET', `/api/pastores/${E.pastorSur.id}`), E.pastorSur.apellidos);
  abre('y los cuerpos de una miembro de la otra iglesia',
    await admin('GET', `/api/miembros/${E.delSur.id}/cuerpos`), E.cuerpoSur.nombre);
  abre('y la lista completa del perfil de permisos',
    await admin('GET', `/api/perfiles_permisos/${E.perfil.id}/usuarios`), E.delOtroLado.nombre);
}

/* ------------------------------------------------------------------ */

(async () => {
  console.log(`🔒 Prueba de aislamiento contra ${URL}\n`);
  const token = await entrar(RUT, CLAVE);
  if (!token) {
    console.log(`   💥 No se pudo entrar con ${RUT}. Con RUT=… CLAVE=… se le dice cuál usar.`);
    process.exit(1);
  }
  const admin = sesion(token);

  const meta = await admin('GET', '/api/meta');
  if (!meta.json || !meta.json.modules) {
    console.log('   💥 No se pudo leer la lista de módulos: ¿es una sesión de administrador general?');
    process.exit(1);
  }
  const modulos = meta.json.modules.map((m) => m.name);

  const E = await montarEscenario(admin);
  await lasSesionesSirven(E);
  console.log(`   escenario: «${E.norte.nombre}» (cuerpos ${E.damas.nombre} y ${E.jovenes.nombre})`);
  console.log(`              «${E.sur.nombre}» (cuerpo ${E.cuerpoSur.nombre})`);
  console.log(`   ${modulos.length} módulos que recorrer`);

  await loAjenoNoSeVe(E, modulos);
  await loAjenoNoSeToca(E);
  await niSePuedeApuntarALoAjeno(E, admin);
  await loPropioSigueAbierto(E, admin);

  console.log(fallas
    ? `\n❌ ${fallas} comprobación(es) fallaron: hay datos al alcance de quien no corresponde.`
    : '\n✅ Cada persona alcanza lo suyo, y nada más.');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
