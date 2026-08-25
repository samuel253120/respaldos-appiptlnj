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

  const norte = await buscarOCrear('iglesias', (f) => f.codigo === `${MARCA}-N`,
    { nombre: 'Iglesia Norte de Prueba', codigo: `${MARCA}-N`, estado: 'Activa' });
  const sur = await buscarOCrear('iglesias', (f) => f.codigo === `${MARCA}-S`,
    { nombre: 'Iglesia Sur de Prueba', codigo: `${MARCA}-S`, estado: 'Activa' });

  const damas = await buscarOCrear('cuerpos', (f) => f.nombre === `Damas ${MARCA} Norte`,
    { nombre: `Damas ${MARCA} Norte`, tipo: 'Dorcas', iglesia_id: norte.id, estado: 'Activo' });
  const jovenes = await buscarOCrear('cuerpos', (f) => f.nombre === `Jovenes ${MARCA} Norte`,
    { nombre: `Jovenes ${MARCA} Norte`, tipo: 'Juventud', iglesia_id: norte.id, estado: 'Activo' });
  const cuerpoSur = await buscarOCrear('cuerpos', (f) => f.nombre === `Damas ${MARCA} Sur`,
    { nombre: `Damas ${MARCA} Sur`, tipo: 'Dorcas', iglesia_id: sur.id, estado: 'Activo' });

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
      iglesia_id: sur.id, cargo: 'Pastor', estado: 'Activo' });

  const cuentaSur = await buscarOCrear('cuentas_tesoreria', (f) => f.nombre === `Caja ${MARCA} Sur`,
    { nombre: `Caja ${MARCA} Sur`, ambito: 'Iglesia', iglesia_id: sur.id, estado: 'Activa', saldo_inicial: 100000 });
  const cuentaJovenes = await buscarOCrear('cuentas_tesoreria', (f) => f.nombre === `Caja ${MARCA} Jovenes`,
    { nombre: `Caja ${MARCA} Jovenes`, ambito: 'Cuerpo', iglesia_id: norte.id, cuerpo_id: jovenes.id,
      estado: 'Activa', saldo_inicial: 50000 });

  const actividadSur = await buscarOCrear('asistencias', (f) => f.nombre === `Culto ${MARCA} Sur`,
    { nombre: `Culto ${MARCA} Sur`, fecha: '2026-08-02', iglesia_id: sur.id, cuerpos: [cuerpoSur.id], tipo: 'Culto' });

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
  // Una cuenta de la propia iglesia del administrador del Norte, para que las
  // pruebas que RESTABLECEN contraseñas no le rompan la sesión a la secretaria.
  const ayudante = await cuenta(`Ayudante ${MARCA}`, 'secretario', [norte.id], []);

  return {
    norte, sur, damas, jovenes, cuerpoSur,
    deDamas, deJovenes, delSur, pastorSur,
    cuentaSur, cuentaJovenes, actividadSur, perfil,
    secretaria, adminNorte, delOtroLado, ayudante,
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
    ['Iglesia Sur de Prueba', 'el nombre de la otra iglesia'],
    [E.delSur.apellidos, 'una miembro de la otra iglesia'],
    [E.pastorSur.apellidos, 'el pastor de la otra iglesia'],
    [E.cuerpoSur.nombre, 'un cuerpo de la otra iglesia'],
    [E.cuentaSur.nombre, 'una cuenta de la otra iglesia'],
    [E.actividadSur.nombre, 'una actividad de la otra iglesia'],
    [E.delSur.rut, 'el RUT de una miembro de la otra iglesia'],
    [E.pastorSur.rut, 'el RUT del pastor de la otra iglesia'],
  ];
  const deOtroCuerpo = [
    [E.deJovenes.apellidos, 'un miembro de otro cuerpo de su misma iglesia'],
    [E.jovenes.nombre, 'otro cuerpo de su misma iglesia'],
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

  const delPerfil = await norte('GET', `/api/perfiles_permisos/${E.perfil.id}/usuarios`);
  revisar('ni verla en la lista del perfil, con su RUT y su iglesia',
    !delPerfil.texto.includes(ajena.nombre));

  const responsables = await norte('GET', '/api/solicitudes/responsables');
  revisar('ni ofrecerla como responsable de una solicitud',
    !responsables.texto.includes(ajena.nombre));

  await cerrado('ni escribir en la ficha del pastor de la otra iglesia',
    await norte('POST', `/api/pastores/${E.pastorSur.id}/copiar-rut`, {}));
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
  await loPropioSigueAbierto(E, admin);

  console.log(fallas
    ? `\n❌ ${fallas} comprobación(es) fallaron: hay datos al alcance de quien no corresponde.`
    : '\n✅ Cada persona alcanza lo suyo, y nada más.');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
