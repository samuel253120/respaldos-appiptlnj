/**
 * Prueba de seguridad: lo que no debe poder hacerse, no se puede.
 *
 * Las otras pruebas miran que el sistema funcione. Esta mira lo contrario:
 * que lo que tiene que estar cerrado, esté cerrado. Son cuatro cosas que, si
 * un día se rompen sin que nadie lo note, no se rompen a la vista —todo
 * seguiría pareciendo normal— y por eso conviene preguntarlas cada vez.
 *
 *   1. Los archivos subidos —carnets, certificados, fotos— no se entregan sin
 *      sesión, y solo a quien le corresponde ver esa ficha.
 *   2. Probando contraseñas a la mala, la puerta se cierra; y el error de uno
 *      no deja afuera a los demás de la misma iglesia.
 *   3. El respaldo se baja completo y la base que trae adentro está sana.
 *   4. El registro de cambios anota el dinero y no se puede maquillar.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run seguridad
 *   URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=… npm run seguridad
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';

let fallas = 0;
function revisar(loQueSeEspera, condicion, detalle) {
  if (condicion) {
    console.log(`   ✅ ${loQueSeEspera}`);
  } else {
    fallas++;
    console.log(`   ❌ ${loQueSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

async function entrar(rut = RUT, clave = CLAVE) {
  const d = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, password: clave }),
  }).then((r) => r.json());
  if (!d.token) throw new Error(`No se pudo entrar con ${rut}: ${d.error || 'sin token'}`);
  return (metodo, ruta, cuerpo) =>
    fetch(URL + ruta, {
      method: metodo,
      headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    }).then(async (res) => ({ estado: res.status, datos: await res.json().catch(() => ({})) }));
}

(async () => {
  console.log(`🔐 Prueba de seguridad contra ${URL}\n`);
  const api = await entrar();

  /* 1 · Los archivos no se entregan a cualquiera --------------------------- */
  console.log('1 · Los archivos subidos');
  // Se sube uno propio de la prueba y se enlaza a una ficha, para no depender
  // de que ya haya alguno ni tocar los que están en uso.
  const cabecera = await tokenDe();
  const sobre = new FormData();
  sobre.append('archivo', new Blob(['prueba de seguridad'], { type: 'image/jpeg' }), 'prueba-seguridad.jpg');
  const subido = await fetch(`${URL}/api/upload`, { method: 'POST', headers: { Authorization: cabecera }, body: sobre })
    .then((r) => r.json());

  const miembro = (await api('GET', '/api/miembros?page=1&limit=1')).datos.rows[0];
  const fotoDeAntes = miembro ? miembro.foto || null : null;
  if (miembro && subido.filename) {
    await api('PUT', `/api/miembros/${miembro.id}`, { ...miembro, foto: subido.filename });
  }

  if (!subido.filename) {
    revisar('se pudo subir un archivo de prueba', false, JSON.stringify(subido).slice(0, 160));
  } else {
    const sinSesion = await fetch(`${URL}/uploads/${subido.filename}`);
    revisar('sin sesión, no se entrega', sinSesion.status === 401, `respondió ${sinSesion.status}`);

    const conSesion = await fetch(`${URL}/uploads/${subido.filename}`, { headers: { Authorization: cabecera } });
    revisar('con sesión, sí', conSesion.status === 200, `respondió ${conSesion.status}`);

    const galleta = await fetch(`${URL}/uploads/${subido.filename}`, {
      headers: { Cookie: `sesion=${cabecera.replace('Bearer ', '')}` },
    });
    revisar('y con la galleta también, que es como las pide el navegador', galleta.status === 200, `respondió ${galleta.status}`);

    const escapar = await fetch(`${URL}/uploads/..%2f..%2fpackage.json`, { headers: { Authorization: cabecera } });
    revisar('no se puede salir de la carpeta de archivos', escapar.status === 404, `respondió ${escapar.status}`);

    // La ficha queda como estaba
    if (miembro) {
      const alDia = (await api('GET', `/api/miembros/${miembro.id}`)).datos;
      await api('PUT', `/api/miembros/${miembro.id}`, { ...alDia, foto: fotoDeAntes });
    }
  }

  /* 2 · La puerta se cierra al que insiste --------------------------------- */
  console.log('\n2 · Probando contraseñas a la mala');
  const inventado = '5.555.555-5'; // no existe: se prueba sin tocar a nadie real
  let cerro = 0;
  for (let i = 0; i < 6 && !cerro; i++) {
    const r = await fetch(`${URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: inventado, password: `mala-${i}` }),
    });
    if (r.status === 429) cerro = i + 1;
  }
  revisar('a los pocos intentos la entrada se cierra', cerro > 0 && cerro <= 6, `hicieron falta ${cerro || 'más de 6'}`);

  const otro = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut: RUT, password: CLAVE }),
  });
  revisar(
    'y el error de uno no deja afuera a los demás de la misma iglesia',
    otro.status === 200,
    `al otro le respondió ${otro.status}`
  );

  /* 3 · El respaldo se baja entero y sano ---------------------------------- */
  console.log('\n3 · El respaldo');
  const token = await tokenDe();
  const paquete = await fetch(`${URL}/api/respaldo`, { headers: { Authorization: token } });
  revisar('se baja', paquete.status === 200, `respondió ${paquete.status}`);
  revisar(
    'viene como archivo para guardar',
    (paquete.headers.get('content-disposition') || '').includes('attachment'),
    paquete.headers.get('content-disposition') || '(sin cabecera)'
  );

  if (paquete.status === 200) {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'revisar-respaldo-'));
    const archivo = path.join(carpeta, 'respaldo.tar.gz');
    fs.writeFileSync(archivo, Buffer.from(await paquete.arrayBuffer()));
    let dentro = '';
    try {
      dentro = execFileSync('tar', ['tzf', archivo], { encoding: 'utf8' });
    } catch (e) {
      dentro = '';
    }
    revisar('trae la base de datos', dentro.split('\n').includes('iglesias.db'));
    revisar('y los documentos y fotos', dentro.includes('uploads/'));

    try {
      execFileSync('tar', ['xzf', archivo, '-C', carpeta]);
      const Base = require('better-sqlite3');
      const copia = new Base(path.join(carpeta, 'iglesias.db'), { readonly: true });
      const sana = copia.pragma('integrity_check')[0].integrity_check === 'ok';
      const cuantos = copia.prepare('SELECT COUNT(*) AS c FROM miembros').get().c;
      const aqui = (await api('GET', '/api/miembros?page=1&limit=1')).datos.total;
      copia.close();
      revisar('la base del respaldo está sana', sana);
      revisar('y trae todos los miembros', cuantos === aqui, `el respaldo trae ${cuantos} y el sistema tiene ${aqui}`);
    } catch (e) {
      revisar('la base del respaldo se puede abrir', false, e.message);
    }
    fs.rmSync(carpeta, { recursive: true, force: true });
  }

  /* 4 · El registro de cambios no se maquilla ------------------------------ */
  console.log('\n4 · El registro de cambios');
  const cuenta = (await api('GET', '/api/cuentas_tesoreria?page=1&limit=1')).datos.rows[0];
  const iglesia = (await api('GET', '/api/iglesias?page=1&limit=1')).datos.rows[0];
  const concepto = `Prueba de seguridad ${Date.now()}`;
  const mov = await api('POST', '/api/tesoreria', {
    fecha: new Date().toISOString().slice(0, 10),
    tipo: 'Ingreso', categoria: 'Ofrenda', monto: 12345, concepto,
    cuenta_id: cuenta && cuenta.id, iglesia_id: iglesia && iglesia.id,
  });
  const movId = mov.datos && mov.datos.id;
  if (!movId) {
    revisar('se pudo registrar un movimiento de prueba', false, JSON.stringify(mov.datos).slice(0, 160));
  } else {
    await api('PUT', `/api/tesoreria/${movId}`, { ...mov.datos, monto: 99999 });
    await api('DELETE', `/api/tesoreria/${movId}`);

    const lineas = (await api('GET', `/api/registro_cambios?q=${encodeURIComponent(concepto)}&limit=20`)).datos.rows || [];
    const de = (accion) => lineas.find((l) => l.accion === accion);
    revisar('queda anotada la creación', !!de('Creación'));
    revisar('queda anotado el cambio, con el antes y el después',
      !!(de('Cambio') && /12\.345.*99\.999/.test(de('Cambio').detalle || '')),
      de('Cambio') ? de('Cambio').detalle : '(no se anotó)');
    revisar('queda anotada la eliminación, con lo que se borró', !!(de('Eliminación') && de('Eliminación').detalle));
    revisar('y se sabe quién fue', !!(de('Creación') && de('Creación').usuario));

    const aMano = await api('POST', '/api/registro_cambios', { modulo: 'Inventado', accion: 'Creación' });
    revisar('no se puede escribir a mano', aMano.estado === 400, `respondió ${aMano.estado}`);
    const borrar = await api('DELETE', `/api/registro_cambios/${de('Creación') ? de('Creación').id : 0}`);
    revisar('ni borrar, ni siquiera el administrador', borrar.estado === 400, `respondió ${borrar.estado}`);
  }

  console.log(fallas ? `\n❌ ${fallas} comprobación(es) fallaron.` : '\n✅ Lo que tiene que estar cerrado, está cerrado.');
  process.exit(fallas ? 1 : 0);
})();

/** El pase, en la forma en que se manda en una cabecera. */
async function tokenDe() {
  if (!tokenDe.guardado) {
    const d = await fetch(`${URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: RUT, password: CLAVE }),
    }).then((r) => r.json());
    tokenDe.guardado = `Bearer ${d.token}`;
  }
  return tokenDe.guardado;
}
