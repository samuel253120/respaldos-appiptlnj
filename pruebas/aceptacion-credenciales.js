/**
 * Las pruebas de aceptación de la credencial pastoral (sección 15).
 *
 * La especificación trae diecinueve pruebas que hay que pasar antes de dar el
 * trabajo por terminado, y el punto 18.3 es explícito: ninguna se da por
 * aprobada sin haberla ejecutado de verdad. Este archivo las ejecuta.
 *
 * CORRE SOBRE UNA BASE DESCARTABLE, Y TIENE QUE SER ASÍ
 *
 * Varias de estas pruebas emiten credenciales, y una credencial emitida no se
 * borra: es el registro de un documento que se entregó, y su número de serie
 * queda consumido para siempre. Correrlas sobre los datos de la iglesia
 * dejaría credenciales inventadas en el historial de gente real y saltos en la
 * numeración que nadie sabría explicar.
 *
 * Así que este archivo se arma su propio mundo: una carpeta nueva, una base
 * recién sembrada, un servidor propio en un puerto libre. Al terminar, lo
 * borra todo. Se puede correr las veces que haga falta.
 *
 *   npm run aceptacion
 *
 * Las que NO están acá son las que no se pueden hacer sin papel ni sin ojos:
 *
 *   15.2, 15.3  medir la impresión y doblar la pieza  → pruebas/credencial-impresa.js
 *               las mide sobre el PDF rasterizado a 300 ppp
 *   15.4, 15.5  nombres largos, tildes y cargo vacío  → ídem
 *   15.6        escanear con un teléfono una credencial impresa EN PAPEL
 *               → esto no lo puede hacer un programa. Lo más cerca que se
 *                 llega es decodificar el QR del PDF rasterizado, con y sin
 *                 tinta corrida, que es lo que hace la otra prueba.
 *   15.11       mirar las pantallas nuevas en un teléfono → pruebas/humo.js
 *               las abre en 390 px y avisa si alguna se sale de lado
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Base = require('better-sqlite3');

const RAIZ = path.join(__dirname, '..');
const rut = require(path.join(RAIZ, 'server', 'rut.js'));

/**
 * Un RUT válido a partir de un número, con su dígito calculado.
 *
 * Escribirlos a mano no sirve: el sistema comprueba el dígito verificador y
 * rechaza los inventados, que es exactamente lo que tiene que hacer. Se
 * calculan con la misma función que usa el sistema.
 */
const rutValido = (numero) => `${numero}-${rut.digitoVerificador(String(numero))}`;
const CLAVE_INICIAL = 'admin123';
const CLAVE_NUEVA = 'Cordillera47';
const RUT_ADMIN = '11.111.111-1';
/**
 * La clave con que se firman los códigos, fija para esta corrida.
 *
 * Fija a propósito: la prueba 15.9 altera un carácter del contenido y espera
 * que el código deje de calzar, y eso solo se puede comprobar si el servidor
 * y la prueba firman con la misma clave.
 */
const SECRETO = 'clave-de-la-prueba-de-aceptacion-no-es-de-produccion';

let fallas = 0;
let pasadas = 0;
const resultados = [];

function revisar(numero, loQueDice, condicion, detalle) {
  if (condicion) {
    pasadas++;
    resultados.push({ numero, loQueDice, paso: true, detalle });
    console.log(`   ✅ ${numero} · ${loQueDice}${detalle ? `  (${detalle})` : ''}`);
  } else {
    fallas++;
    resultados.push({ numero, loQueDice, paso: false, detalle });
    console.log(`   ❌ ${numero} · ${loQueDice}${detalle ? `\n        ${detalle}` : ''}`);
  }
}

/** Un puerto que no esté ocupado, preguntándoselo al sistema. */
function puertoLibre() {
  return new Promise((listo, mal) => {
    const s = net.createServer();
    s.on('error', mal);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => listo(port));
    });
  });
}

const esperar = (ms) => new Promise((sigue) => setTimeout(sigue, ms));

(async () => {
  console.log('🧪 Pruebas de aceptación de la credencial pastoral (sección 15)\n');

  /* ---- El mundo aparte ------------------------------------------------- */
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'aceptacion-'));
  const puerto = await puertoLibre();
  const URL = `http://127.0.0.1:${puerto}`;
  const entorno = { ...process.env, DATA_DIR: carpeta, PORT: String(puerto), CREDENCIAL_SECRETO: SECRETO };

  console.log(`   Base descartable en ${carpeta}`);
  spawnSync(process.execPath, [path.join(RAIZ, 'server', 'seed.js')], { env: entorno, stdio: 'ignore' });

  const servidor = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.js')], { env: entorno, stdio: 'ignore' });
  const apagar = () => { try { servidor.kill(); } catch (e) { /* ya estaba */ } };
  process.on('exit', apagar);

  // A que conteste
  let vivo = false;
  for (let i = 0; i < 40 && !vivo; i++) {
    await esperar(250);
    vivo = await fetch(`${URL}/health`).then((r) => r.ok).catch(() => false);
  }
  if (!vivo) {
    console.error('❌ El servidor de la prueba no arrancó.');
    apagar();
    fs.rmSync(carpeta, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`   Servidor de prueba en ${URL}\n`);

  /* ---- Entrar ---------------------------------------------------------- */
  const pedir = async (metodo, ruta, cuerpo, token) =>
    fetch(URL + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    }).then(async (r) => ({ estado: r.status, datos: await r.json().catch(() => ({})) }));

  const primera = await pedir('POST', '/api/auth/login', { rut: RUT_ADMIN, password: CLAVE_INICIAL });
  // La contraseña inicial obliga a cambiarla antes de trabajar
  await pedir('POST', '/api/auth/cambiar-password', { actual: CLAVE_INICIAL, nueva: CLAVE_NUEVA }, primera.datos.token);
  const sesion = await pedir('POST', '/api/auth/login', { rut: RUT_ADMIN, password: CLAVE_NUEVA });
  const TOKEN = sesion.datos.token;
  if (!TOKEN) {
    console.error('❌ No se pudo entrar en el servidor de la prueba:', JSON.stringify(sesion.datos).slice(0, 200));
    apagar();
    fs.rmSync(carpeta, { recursive: true, force: true });
    process.exit(1);
  }
  const api = (metodo, ruta, cuerpo) => pedir(metodo, ruta, cuerpo, TOKEN);

  /* ---- Los conteos de antes (punto 15.19) ------------------------------ */
  const contarTodo = () => {
    const salida = spawnSync(process.execPath, [path.join(__dirname, 'conteos.js')], { env: entorno, encoding: 'utf8' });
    return salida.stdout || '';
  };
  const conteosAntes = contarTodo();

  /* ---- Preparar el mundo: iglesia, pastor y recursos -------------------- */
  console.log('0 · Preparando: una iglesia, un pastor y los recursos de la credencial');

  const iglesias = await api('GET', '/api/iglesias');
  const laIglesia = iglesias.datos.rows[0];
  await api('PUT', `/api/iglesias/${laIglesia.id}`, {
    ...laIglesia, tipo: 'Iglesia Sede', ciudad: 'Concepción',
  });

  // Una foto de verdad para el pastor y para los recursos institucionales
  const subir = async (nombre) => {
    // Un PNG mínimo válido, para que pase la revisión de tipo de archivo
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const fd = new FormData();
    fd.append('archivo', new Blob([png], { type: 'image/png' }), nombre);
    const r = await fetch(`${URL}/api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
    }).then((x) => x.json());
    return r.filename;
  };

  const fotoDelPastor = await subir('retrato.png');
  await api('PUT', '/api/configuracion', {
    iglesia_logo: await subir('logo.png'),
    credencial_sello: await subir('sello.png'),
    credencial_firma: await subir('firma.png'),
    credencial_qr_modo: 'linea',
  });

  const elPastor = await api('POST', '/api/pastores', {
    nombres: 'Juan Carlos', apellidos: 'Soto Martínez', rut: rutValido(12345678),
    cargo: 'Pastor Presbítero', funcion: 'Secretario de la Corporación',
    iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
  });
  if (!(elPastor.datos && elPastor.datos.id)) {
    console.error('❌ No se pudo preparar el pastor de la prueba:', JSON.stringify(elPastor.datos).slice(0, 300));
    apagar();
    fs.rmSync(carpeta, { recursive: true, force: true });
    process.exit(1);
  }
  const PASTOR = elPastor.datos;
  console.log(`   Pastor #${PASTOR.id} en la iglesia «${laIglesia.nombre}»\n`);

  /* ===================================================================== */
  console.log('15.1 · Los datos impresos coinciden con el registro');
  /* ===================================================================== */
  const nueva = await api('POST', '/api/credenciales', {
    pastor_id: PASTOR.id,
    fecha_emision: '2026-03-15',
    fecha_vencimiento: '2028-03-15',
  });
  revisar('15.1', 'se creó el borrador', nueva.estado === 200 || nueva.estado === 201,
    `respondió ${nueva.estado}: ${JSON.stringify(nueva.datos).slice(0, 160)}`);
  const CRED = nueva.datos;

  if (CRED && CRED.id) {
    const emitida = await api('POST', `/api/credenciales/${CRED.id}/emitir`);
    revisar('15.1', 'se emitió', emitida.estado === 200,
      `respondió ${emitida.estado}: ${JSON.stringify(emitida.datos).slice(0, 200)}`);

    const c = emitida.datos.credencial || {};
    const ig = (await api('GET', `/api/iglesias/${laIglesia.id}`)).datos;
    const p = (await api('GET', `/api/pastores/${PASTOR.id}`)).datos;
    const CATEGORIAS = { 'Iglesia Matriz': 'CENTRAL', 'Iglesia Sede': 'SEDE', 'Iglesia Local': 'FILIAL', 'Iglesia Anexo': 'ANEXO' };
    const discrepan = [];
    const igual = (que, enLaCredencial, enElRegistro) => {
      if (String(enLaCredencial || '').trim() !== String(enElRegistro || '').trim()) {
        discrepan.push(`${que}: «${enLaCredencial}» ≠ «${enElRegistro}»`);
      }
    };
    igual('nombres', c.snap_nombres, p.nombres);
    igual('apellidos', c.snap_apellidos, p.apellidos);
    igual('RUT', c.snap_rut, p.rut);
    igual('grado', c.snap_grado, p.cargo);
    igual('cargo', c.snap_funcion, p.funcion);
    igual('iglesia', c.snap_iglesia, ig.nombre);
    igual('categoría', c.snap_categoria, CATEGORIAS[ig.tipo]);
    igual('comuna', c.snap_comuna, ig.ciudad);
    igual('fotografía', c.snap_foto, p.foto);
    revisar('15.1', 'cada dato impreso es el del registro', discrepan.length === 0, discrepan.join(' · '));
  }

  /* ===================================================================== */
  console.log('\n15.7 · Todo queda anotado en el registro de cambios');
  /* ===================================================================== */
  // Se provocan los seis hechos que el punto 15.7 exige que queden anotados
  await api('POST', `/api/credenciales/${CRED.id}/impresa`);           // reimpresión
  const segunda = await api('POST', '/api/credenciales', {             // creación
    pastor_id: PASTOR.id, fecha_emision: '2026-06-01', fecha_vencimiento: '2028-06-01',
  });
  const emitidaSegunda = await api('POST', `/api/credenciales/${segunda.datos.id}/emitir`); // emisión + reemplazo
  await api('POST', `/api/credenciales/${segunda.datos.id}/revocar`, { motivo: 'Extravío informado por el titular' });
  await api('PUT', '/api/configuracion', { credencial_sello: await subir('sello-nuevo.png') }); // recurso

  const registro = (await api('GET', '/api/registro_cambios?limit=100&sort=id&dir=desc')).datos.rows || [];
  const hay = (accion, quePalabra) =>
    registro.some((r) => r.accion === accion && (!quePalabra || (r.detalle || '').includes(quePalabra)));

  revisar('15.7', 'queda anotada la creación', hay('Creación'));
  revisar('15.7', 'queda anotada la emisión', hay('Emisión'));
  revisar('15.7', 'queda anotada la reimpresión', hay('Impresión'));
  revisar('15.7', 'queda anotada la revocación CON su motivo', hay('Revocación', 'Extravío informado'));
  revisar('15.7', 'queda anotado el reemplazo', hay('Reemplazo'));
  revisar('15.7', 'queda anotado el cambio de los recursos institucionales', hay('Cambio', 'Sello oficial'));

  const unaLinea = registro.find((r) => r.accion === 'Emisión') || {};
  revisar('15.7', 'con usuario, fecha y hora',
    !!(unaLinea.usuario && unaLinea.fecha && /^\d{2}:\d{2}$/.test(unaLinea.hora || '')),
    `${unaLinea.fecha} ${unaLinea.hora} · ${unaLinea.usuario}`);
  const conAntesYDespues = registro.find((r) => (r.detalle || '').includes('→')) || {};
  revisar('15.7', 'y con el valor anterior y el nuevo', !!conAntesYDespues.detalle,
    (conAntesYDespues.detalle || '').slice(0, 100));

  /* ===================================================================== */
  console.log('\n15.8 · Un pastor no alcanza las credenciales de otra iglesia');
  /* ===================================================================== */
  const otraIglesia = await api('POST', '/api/iglesias', {
    nombre: 'Iglesia De La Otra Punta', codigo: `OTRA${Date.now() % 10000}`,
    tipo: 'Iglesia Local', ciudad: 'Arica', estado: 'Activa',
  });
  const rutOtro = rutValido(17777777);
  const otroUsuario = await api('POST', '/api/usuarios', {
    rut: rutOtro, nombre: 'Pastor De Otra', rol: 'pastor', activo: 1,
    password: CLAVE_NUEVA,
    iglesia_id: otraIglesia.datos.id,
    iglesias: [otraIglesia.datos.id],
  });
  if (otroUsuario.datos && otroUsuario.datos.id) {
    await api('PUT', `/api/usuarios/${otroUsuario.datos.id}`, {
      ...otroUsuario.datos, debe_cambiar_password: 0, iglesias: [otraIglesia.datos.id],
    });
    /**
     * Que de verdad quedó acotado a su iglesia y a ninguna más.
     *
     * Sin esto, la prueba se puede aprobar sola: un usuario SIN iglesias
     * asignadas alcanza todas —así es como se administra el sistema entero—,
     * y entonces «no ve las de la otra» pasaría por no haber acotado nada.
     */
    const comoQuedo = (await api('GET', `/api/usuarios/${otroUsuario.datos.id}`)).datos;
    // Una lista de referencias puede llegar como arreglo o como texto; se
    // normaliza igual que lo hace el sistema
    const comoLista = (v) => {
      if (Array.isArray(v)) return v.map(Number).filter(Boolean);
      if (v === null || v === undefined || v === '') return [];
      try {
        const x = JSON.parse(v);
        return Array.isArray(x) ? x.map(Number).filter(Boolean) : [Number(x)].filter(Boolean);
      } catch (e) {
        return String(v).split(',').map(Number).filter(Boolean);
      }
    };
    const susIglesias = comoLista(comoQuedo.iglesias);
    revisar('15.8', 'el pastor quedó acotado a UNA sola iglesia, la suya',
      susIglesias.length === 1 && susIglesias[0] === otraIglesia.datos.id,
      `quedó con ${JSON.stringify(susIglesias)}, y la suya es la ${otraIglesia.datos.id}`);
    const suSesion = await pedir('POST', '/api/auth/login', { rut: rutOtro, password: CLAVE_NUEVA });
    const suToken = suSesion.datos.token;
    const suyas = await pedir('GET', '/api/credenciales', undefined, suToken);
    const ajenas = (suyas.datos.rows || []).filter((c) => c.iglesia_id === laIglesia.id);
    revisar('15.8', 'no ve las credenciales de la otra iglesia', ajenas.length === 0,
      `vio ${ajenas.length}`);
    const alDedo = await pedir('GET', `/api/credenciales/${CRED.id}`, undefined, suToken);
    revisar('15.8', 'ni escribiendo la dirección a mano', alDedo.estado === 403 || alDedo.estado === 404,
      `respondió ${alDedo.estado}`);
    const emitirAjena = await pedir('POST', `/api/credenciales/${CRED.id}/emitir`, {}, suToken);
    revisar('15.8', 'ni puede emitirlas', emitirAjena.estado === 403,
      `respondió ${emitirAjena.estado}`);
  } else {
    revisar('15.8', 'se pudo crear el pastor de la otra iglesia', false,
      JSON.stringify(otroUsuario.datos).slice(0, 160));
  }

  /* ===================================================================== */
  console.log('\n15.1 bis · Si cambia de iglesia entre el borrador y la emisión');
  /* ===================================================================== */
  /**
   * Los datos se congelan al emitir, tomados de la ficha de ese día. Si la
   * persona cambió de iglesia mientras tanto, la tarjeta sale con la iglesia
   * nueva —eso está bien— y la fila tiene que quedar archivada en esa misma.
   *
   * Antes no: la columna con que el sistema decide de qué iglesia es la
   * credencial se escribía al crear el borrador y no se volvía a tocar. La
   * tarjeta decía una iglesia y el sistema la contaba en otra, y de esa
   * columna dependen quién la ve, el listado y el aviso del panel.
   */
  const queSeCambia = await api('POST', '/api/pastores', {
    nombres: 'Cambia De', apellidos: 'Iglesia', rut: rutValido(18181818),
    cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
  });
  const suBorrador = await api('POST', '/api/credenciales', {
    pastor_id: queSeCambia.datos.id, fecha_emision: '2026-02-10', fecha_vencimiento: '2028-02-10',
  });
  // Se lo pasa a la otra iglesia, con el borrador ya creado
  await api('PUT', `/api/pastores/${queSeCambia.datos.id}`, {
    ...(await api('GET', `/api/pastores/${queSeCambia.datos.id}`)).datos,
    iglesia_id: otraIglesia.datos.id,
  });
  const emitidaDespuesDelCambio = await api('POST', `/api/credenciales/${suBorrador.datos.id}/emitir`);
  const quedo = (emitidaDespuesDelCambio.datos || {}).credencial || {};
  revisar('15.1', 'la tarjeta sale con la iglesia nueva',
    quedo.snap_iglesia === 'Iglesia De La Otra Punta',
    `salió «${quedo.snap_iglesia}»`);
  revisar('15.1', 'y la credencial queda archivada en esa misma iglesia',
    Number(quedo.iglesia_id) === Number(otraIglesia.datos.id),
    `quedó en la iglesia ${quedo.iglesia_id}, y la de la tarjeta es la ${otraIglesia.datos.id}`);

  /* ===================================================================== */
  console.log('\n15.9 · Alterar un carácter del QR y que la verificación lo rechace');
  /* ===================================================================== */
  const impresion = (await api('GET', `/api/credenciales/${CRED.id}/impresion`)).datos;
  const direccionDelQr = impresion.qr.texto;
  const buena = await fetch(direccionDelQr.replace(/^https?:\/\/[^/]+/, URL)).then((r) => r.status);
  revisar('15.9', 'el código correcto verifica', buena === 200, `respondió ${buena}`);

  const laSerie = impresion.credencial.serie_completa;
  const codigoBueno = impresion.qr.codigo;
  const alterado = (codigoBueno[0] === 'A' ? 'B' : 'A') + codigoBueno.slice(1);
  const conUnCaracterCambiado = await fetch(`${URL}/v/${encodeURIComponent(laSerie)}?c=${alterado}`)
    .then((r) => r.status);
  revisar('15.9', 'cambiando UN carácter del código, la rechaza', conUnCaracterCambiado === 404,
    `respondió ${conUnCaracterCambiado}`);

  const serieCambiada = laSerie.replace(/^(\d)(\d)/, (m, a, b) => a + ((Number(b) + 1) % 10));
  const conLaSerieCambiada = await fetch(`${URL}/v/${encodeURIComponent(serieCambiada)}?c=${codigoBueno}`)
    .then((r) => r.status);
  revisar('15.9', 'y cambiando un dígito de la serie, también', conLaSerieCambiada === 404,
    `respondió ${conLaSerieCambiada}`);

  /* ===================================================================== */
  console.log('\n15.10 · Revocar y que la verificación lo muestre de inmediato');
  /* ===================================================================== */
  /**
   * Con una credencial propia y recién emitida: la primera quedó REEMPLAZADA
   * al emitirse la segunda, y lo que se quiere ver acá es el salto de vigente
   * a revocada.
   */
  const paraRevocar = await (async () => {
    const suyo = await api('POST', '/api/pastores', {
      nombres: 'Para', apellidos: 'Revocar', rut: rutValido(19191919),
      cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
    });
    const cr = await api('POST', '/api/credenciales', {
      pastor_id: suyo.datos.id, fecha_emision: '2026-03-20', fecha_vencimiento: '2028-03-20',
    });
    const em = await api('POST', `/api/credenciales/${cr.datos.id}/emitir`);
    return em.datos.credencial;
  })();
  const suImpresion = (await api('GET', `/api/credenciales/${paraRevocar.id}/impresion`)).datos;
  const suSerie = suImpresion.credencial.serie_completa;
  const suCodigo = suImpresion.qr.codigo;

  const antesDeRevocar = await fetch(`${URL}/v/${encodeURIComponent(suSerie)}?c=${suCodigo}`).then((r) => r.text());
  revisar('15.10', 'antes de revocar se ve vigente', /VIGENTE|POR VENCER/.test(antesDeRevocar),
    (/class="cual">([^<]*)/.exec(antesDeRevocar) || [])[1]);

  await api('POST', `/api/credenciales/${paraRevocar.id}/revocar`, { motivo: 'Cese del cargo' });
  const despues = await fetch(`${URL}/v/${encodeURIComponent(suSerie)}?c=${suCodigo}`).then((r) => r.text());
  revisar('15.10', 'y al revocarla, revocada en el momento',
    /REVOCADA/.test(despues) && despues.includes('Cese del cargo'),
    (/class="cual">([^<]*)/.exec(despues) || [])[1]);

  /* ===================================================================== */
  console.log('\n15.12 · El número de serie no se puede escribir a mano');
  /* ===================================================================== */
  const definicion = (await api('GET', '/api/meta')).datos.modules.find((m) => m.name === 'credenciales');
  const campoSerie = (definicion.fields || []).find((f) => f.name === 'serie') || {};
  revisar('15.12', 'el campo de la serie es de solo lectura', campoSerie.readonly === true,
    JSON.stringify({ readonly: campoSerie.readonly, oculto: campoSerie.oculto }));

  const intentoDeEscribirla = await api('PUT', `/api/credenciales/${CRED.id}`, {
    serie: '9999999', serie_dv: '9', version: (await api('GET', `/api/credenciales/${CRED.id}`)).datos.version,
  });
  const comoQuedo = (await api('GET', `/api/credenciales/${CRED.id}`)).datos;
  revisar('15.12', 'y escribirla por la API no la cambia', comoQuedo.serie !== '9999999',
    `quedó en ${comoQuedo.serie} (la llamada respondió ${intentoDeEscribirla.estado})`);

  /* ===================================================================== */
  console.log('\n15.13 · Dos emisiones a la vez reciben números distintos');
  /* ===================================================================== */
  const paraLaVez = [];
  for (let i = 0; i < 6; i++) {
    const otro = await api('POST', '/api/pastores', {
      nombres: `Simultáneo ${i}`, apellidos: 'De Prueba', rut: rutValido(20000000 + i),
      cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
    });
    const suCred = await api('POST', '/api/credenciales', {
      pastor_id: otro.datos.id, fecha_emision: '2026-04-01', fecha_vencimiento: '2028-04-01',
    });
    paraLaVez.push(suCred.datos.id);
  }
  const alMismoTiempo = await Promise.all(paraLaVez.map((id) => api('POST', `/api/credenciales/${id}/emitir`)));
  const series = alMismoTiempo.map((r) => (r.datos.credencial || {}).serie).filter(Boolean);
  revisar('15.13', 'las seis se emitieron', series.length === 6, `salieron ${series.length}`);
  revisar('15.13', 'y ninguna repite número', new Set(series).size === series.length,
    series.join(', '));
  const correlativos = alMismoTiempo.map((r) => (r.datos.credencial || {}).correlativo).filter((x) => x != null).sort((a, b) => a - b);
  const corridos = correlativos.every((n, i) => i === 0 || n === correlativos[i - 1] + 1);
  revisar('15.13', 'y son correlativos', corridos, correlativos.join(', '));

  /* ===================================================================== */
  console.log('\n15.14 · La base rechaza un número de serie repetido');
  /* ===================================================================== */
  const baseDirecta = new Base(path.join(carpeta, 'iglesias.db'));
  const yaExiste = baseDirecta.prepare('SELECT serie FROM credenciales WHERE serie IS NOT NULL LIMIT 1').get();
  let laRechazo = false;
  let comoSeQuejo = '';
  try {
    baseDirecta.prepare('INSERT INTO credenciales (serie, estado) VALUES (?, ?)').run(yaExiste.serie, 'Vigente');
  } catch (e) {
    laRechazo = /UNIQUE|unique/.test(e.message);
    comoSeQuejo = e.message;
  }
  baseDirecta.close();
  revisar('15.14', 'insertando el mismo número a mano, la base lo rechaza', laRechazo, comoSeQuejo);

  /* ===================================================================== */
  console.log('\n15.15 · Una credencial nueva no reutiliza el número de la revocada');
  /* ===================================================================== */
  const revocadaSerie = (await api('GET', `/api/credenciales/${paraRevocar.id}`)).datos.serie;
  const otroMas = await api('POST', '/api/pastores', {
    nombres: 'Después De', apellidos: 'La Revocada', rut: rutValido(21111111),
    cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
  });
  const credDespues = await api('POST', '/api/credenciales', {
    pastor_id: otroMas.datos.id, fecha_emision: '2026-05-01', fecha_vencimiento: '2028-05-01',
  });
  const emitidaDespues = await api('POST', `/api/credenciales/${credDespues.datos.id}/emitir`);
  const serieNueva = (emitidaDespues.datos.credencial || {}).serie;
  revisar('15.15', 'la nueva no lleva el número de la revocada', serieNueva !== revocadaSerie,
    `revocada ${revocadaSerie} · nueva ${serieNueva}`);

  /* ===================================================================== */
  console.log('\n15.16 · El dígito verificador coincide con el del archivo de diseño');
  /* ===================================================================== */
  /**
   * El archivo docs/credencial-pastor.html —el original aprobado, que no se
   * toca— calcula el dígito con su propia función. Acá se saca esa función DEL
   * PROPIO ARCHIVO y se comparan los dos cálculos sobre miles de números. Si
   * alguien «mejorara» el del sistema, esto lo caza.
   */
  const original = fs.readFileSync(path.join(RAIZ, 'docs', 'credencial-pastor.html'), 'utf8');
  // La función entera, desde su «function luhnDV(» hasta la llave que la cierra
  const trozo = /(function\s+luhnDV\s*\(num\)\s*\{[\s\S]*?\n\s*\})/.exec(original);
  if (!trozo) {
    revisar('15.16', 'se pudo sacar el cálculo del archivo de diseño', false,
      'no se encontró la función luhnDV en docs/credencial-pastor.html');
  } else {
    const luhnDelDiseno = new Function(`${trozo[1]}\n return luhnDV;`)();
    const delSistema = require(path.join(RAIZ, 'server', 'credenciales', 'serie.js')).digitoVerificador;
    const distintos = [];
    for (let n = 1; n <= 999 && distintos.length < 5; n++) {
      for (const anio of [2026, 2027, 2030, 2099]) {
        const numero = `${String(n).padStart(3, '0')}${anio}`;
        if (luhnDelDiseno(numero) !== delSistema(numero)) distintos.push(numero);
      }
    }
    revisar('15.16', 'los dos cálculos dan lo mismo en 3.996 números', distintos.length === 0,
      distintos.length ? `no coinciden en ${distintos.join(', ')}` : 'comprobados 3.996');
  }

  /* ===================================================================== */
  console.log('\n15.17 · El correlativo NO se reinicia al cambiar de año');
  /* ===================================================================== */
  /**
   * Emitir una credencial a alguien nuevo, de una sola vez.
   *
   * Devuelve la credencial emitida, o lo que se quejó el sistema. Se usa en
   * varias de las pruebas que siguen y evita que un fallo intermedio se lea
   * como «se cayó la prueba» en vez de como lo que es.
   */
  const emitirleAAlguien = async (quien, cuando, hasta) => {
    const suyo = await api('POST', '/api/pastores', {
      nombres: quien.nombres, apellidos: quien.apellidos, rut: quien.rut,
      cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
    });
    if (!(suyo.datos && suyo.datos.id)) return { error: `no se creó el pastor: ${JSON.stringify(suyo.datos).slice(0, 140)}` };
    const cr = await api('POST', '/api/credenciales', {
      pastor_id: suyo.datos.id, fecha_emision: cuando, fecha_vencimiento: hasta,
    });
    if (!(cr.datos && cr.datos.id)) return { error: `no se creó la credencial: ${JSON.stringify(cr.datos).slice(0, 140)}` };
    const em = await api('POST', `/api/credenciales/${cr.datos.id}/emitir`);
    if (!(em.datos && em.datos.credencial)) return { error: `no se emitió: ${JSON.stringify(em.datos).slice(0, 140)}` };
    return em.datos.credencial;
  };

  /**
   * El cambio de año se simula hacia atrás, no hacia adelante.
   *
   * El sistema no acepta una fecha de entrega que todavía no llegó —«acá se
   * anota lo que ya ocurrió»—, así que no se puede emitir una credencial
   * fechada el año que viene. Se emiten dos ya pasadas, una de diciembre y
   * otra de enero siguiente: el año de la serie cambia, y lo que se comprueba
   * —que el correlativo NO vuelva a 001 al cruzar el año— es exactamente lo
   * mismo.
   */
  const antesDelAnio = await emitirleAAlguien(
    { nombres: 'Antes Del', apellidos: 'Año Nuevo', rut: rutValido(22222222) }, '2024-12-31', '2026-12-31');
  const despuesDelAnio = await emitirleAAlguien(
    { nombres: 'Después Del', apellidos: 'Año Nuevo', rut: rutValido(23333333) }, '2025-01-02', '2027-01-02');

  if (antesDelAnio.error || despuesDelAnio.error) {
    revisar('15.17', 'se pudieron emitir las dos credenciales del cambio de año', false,
      antesDelAnio.error || despuesDelAnio.error);
  } else {
    revisar('15.17', 'el año cambia en la serie',
      String(antesDelAnio.serie).endsWith('2024') && String(despuesDelAnio.serie).endsWith('2025'),
      `${antesDelAnio.serie} → ${despuesDelAnio.serie}`);
    revisar('15.17', 'pero el correlativo sigue la cuenta, no vuelve a 001',
      despuesDelAnio.correlativo === antesDelAnio.correlativo + 1,
      `${antesDelAnio.correlativo} → ${despuesDelAnio.correlativo}`);
  }

  /* ===================================================================== */
  console.log('\n15.18 · Al pasar de 999 el correlativo sigue con cuatro dígitos');
  /* ===================================================================== */
  const serie = require(path.join(RAIZ, 'server', 'credenciales', 'serie.js'));
  revisar('15.18', 'el 999 se escribe con tres dígitos', serie.serieDe(999, 2026) === '9992026',
    serie.serieDe(999, 2026));
  revisar('15.18', 'el 1000 sigue con cuatro y no da error', serie.serieDe(1000, 2026) === '10002026',
    serie.serieDe(1000, 2026));
  revisar('15.18', 'y el 12345 con cinco', serie.serieDe(12345, 2027) === '123452027',
    serie.serieDe(12345, 2027));
  // Y que el sistema los siga aceptando de punta a punta: se adelanta el contador
  const baseParaEmpujar = new Base(path.join(carpeta, 'iglesias.db'));
  baseParaEmpujar.prepare('UPDATE credencial_contador SET ultimo = 998 WHERE id = 1').run();
  baseParaEmpujar.close();
  const pasandoEl999 = [];
  for (let i = 0; i < 3; i++) {
    const p4 = await api('POST', '/api/pastores', {
      nombres: `Pasando El ${i}`, apellidos: 'Mil', rut: rutValido(24444440 + i),
      cargo: 'Pastor Diácono', iglesia_id: laIglesia.id, foto: fotoDelPastor, estado: 'Activo',
    });
    const cr = await api('POST', '/api/credenciales', {
      pastor_id: p4.datos.id, fecha_emision: '2026-07-01', fecha_vencimiento: '2028-07-01',
    });
    const em = await api('POST', `/api/credenciales/${cr.datos.id}/emitir`);
    pasandoEl999.push((em.datos.credencial || {}).serie);
  }
  revisar('15.18', 'y el sistema emite el 999, el 1000 y el 1001 sin quejarse',
    pasandoEl999[0] === '9992026' && pasandoEl999[1] === '10002026' && pasandoEl999[2] === '10012026',
    pasandoEl999.join(' → '));

  /* ===================================================================== */
  console.log('\n15.19 · Ningún dato existente se perdió ni se alteró');
  /* ===================================================================== */
  const leer = (texto) => Object.fromEntries(
    texto.split('\n')
      .map((l) => /^\s*(\w+)\s+([\d.,]+)\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], Number(m[2].replace(/[.,]/g, ''))])
  );

  const alEmpezar = leer(conteosAntes);
  const alTerminar = leer(contarTodo());
  const perdidos = Object.entries(alEmpezar).filter(([tabla, n]) => (alTerminar[tabla] || 0) < n);
  revisar('15.19', 'trabajar con credenciales no le quita registros a ninguna otra tabla',
    perdidos.length === 0,
    perdidos.map(([t, n]) => `${t}: ${n} → ${alTerminar[t] || 0}`).join(' · '));

  /**
   * Y ahora lo que el punto 15.19 pregunta de verdad: la limpieza del 13.1.
   *
   * Esa migración BORRA todas las credenciales a propósito —es lo que se
   * pidió— y no puede tocar nada más. Acá se le quita la marca de «ya se
   * hizo», se apaga el servidor y se vuelve a levantar para que corra otra
   * vez, y se comparan los conteos de todas las tablas antes y después.
   *
   * Lo único que puede haber cambiado es la tabla de credenciales, que queda
   * en cero, y el registro de cambios, que gana la línea que deja constancia.
   */
  const antesDeLaLimpieza = leer(contarTodo());
  apagar();
  await esperar(400);

  const baseParaLimpiar = new Base(path.join(carpeta, 'iglesias.db'));
  baseParaLimpiar.prepare("DELETE FROM configuracion WHERE clave = 'credenciales_desde_cero'").run();
  baseParaLimpiar.close();

  const otraVez = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.js')], { env: entorno, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await esperar(250);
    if (await fetch(`${URL}/health`).then((r) => r.ok).catch(() => false)) break;
  }
  const despuesDeLaLimpieza = leer(contarTodo());
  try { otraVez.kill(); } catch (e) { /* ya estaba */ }

  // «TOTAL» no es una tabla: es la línea con que el conteo se resume
  const PUEDEN_CAMBIAR = ['credenciales', 'registro_cambios', 'configuracion', 'sqlite_sequence', 'TOTAL'];
  const tocadas = Object.keys(antesDeLaLimpieza)
    .filter((t) => !PUEDEN_CAMBIAR.includes(t))
    .filter((t) => (despuesDeLaLimpieza[t] || 0) !== antesDeLaLimpieza[t])
    .map((t) => `${t}: ${antesDeLaLimpieza[t]} → ${despuesDeLaLimpieza[t] || 0}`);

  revisar('15.19', 'la limpieza del punto 13.1 no toca ninguna otra tabla', tocadas.length === 0,
    tocadas.join(' · '));
  revisar('15.19', 'y las credenciales sí quedan en cero, que es lo que se pidió',
    despuesDeLaLimpieza.credenciales === 0,
    `${antesDeLaLimpieza.credenciales} → ${despuesDeLaLimpieza.credenciales}`);
  revisar('15.19', 'dejando constancia en el registro de cambios',
    (despuesDeLaLimpieza.registro_cambios || 0) > (antesDeLaLimpieza.registro_cambios || 0),
    `${antesDeLaLimpieza.registro_cambios} → ${despuesDeLaLimpieza.registro_cambios}`);

  console.log(`\n   Conteos antes de la limpieza:  ${JSON.stringify(antesDeLaLimpieza)}`);
  console.log(`   Conteos después:               ${JSON.stringify(despuesDeLaLimpieza)}`);

  /* ---- Cerrar ---------------------------------------------------------- */
  await esperar(300);
  fs.rmSync(carpeta, { recursive: true, force: true });

  console.log('\n──────────────────────────────────────────────────────');
  console.log(`   ${pasadas} comprobaciones pasaron · ${fallas} fallaron`);
  if (fallas) {
    console.error('\n❌ Hay pruebas de aceptación que no pasan.');
    process.exit(1);
  }
  console.log('\n✅ Las pruebas de aceptación de la sección 15 pasan.');
})().catch((e) => {
  console.error('\n❌ La prueba se cayó:', e && e.stack ? e.stack : e);
  process.exit(1);
});
