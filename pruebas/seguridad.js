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
 *   5. El alcance por cuerpo se respeta aunque se escriba la dirección a mano:
 *      quien tiene un cuerpo asignado no alcanza lo de otro —ni su gente, ni
 *      sus cuotas, ni su cobro—.
 *   6. Elegir con qué iglesia trabajar nunca amplía lo asignado.
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

  /** Sube un archivo y devuelve lo que respondió el servidor. */
  const subir = async (nombre, contenido) => {
    const sobre = new FormData();
    sobre.append('archivo', new Blob([contenido]), nombre);
    const r = await fetch(`${URL}/api/upload`, { method: 'POST', headers: { Authorization: cabecera }, body: sobre });
    return { status: r.status, cuerpo: await r.json() };
  };

  // Una foto de verdad: los primeros bytes son los que tiene un JPEG. El
  // sistema los mira, así que un archivo con cualquier contenido no pasa.
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const subido = (await subir('prueba-seguridad.jpg', JPEG)).cuerpo;

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

    // Una foto se entrega como foto, dicho por el sistema y no adivinado por
    // el navegador: así, aunque algún día entrara un archivo que no
    // corresponde, no se abriría como página.
    revisar(
      'la foto se entrega como foto y sin dejar adivinar',
      conSesion.headers.get('content-type') === 'image/jpeg' &&
        conSesion.headers.get('x-content-type-options') === 'nosniff',
      `tipo ${conSesion.headers.get('content-type')} · nosniff ${conSesion.headers.get('x-content-type-options')}`
    );

    // La ficha queda como estaba
    if (miembro) {
      const alDia = (await api('GET', `/api/miembros/${miembro.id}`)).datos;
      await api('PUT', `/api/miembros/${miembro.id}`, { ...alDia, foto: fotoDeAntes });
    }
  }

  /* 1b · No entra cualquier archivo ---------------------------------------- */
  console.log('\n1b · Lo que se puede subir');
  // Un archivo que el navegador abra como página, subido por cualquiera que
  // pueda adjuntar un documento, correría con la sesión del que lo abra. Se
  // cierra por el nombre y por el contenido, porque cada uno solo tapa la
  // mitad.
  const paginaWeb = await subir('trampa.html', '<script>alert(1)</script>');
  revisar('una página web no se puede subir', paginaWeb.status === 400, `respondió ${paginaWeb.status}`);

  const dibujo = await subir('trampa.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  revisar('un SVG tampoco, que también lleva instrucciones', dibujo.status === 400, `respondió ${dibujo.status}`);

  const disfrazada = await subir('trampa.jpg', '<script>alert(1)</script>');
  revisar(
    'ni disfrazada de foto: se le miran los bytes',
    disfrazada.status === 400,
    `respondió ${disfrazada.status}`
  );

  const documento = await subir('reglamento.docx', 'PK\u0003\u0004 contenido');
  revisar('un documento de Word sí, que es lo que la iglesia usa', documento.status === 200,
    `respondió ${documento.status}`);
  if (documento.cuerpo.filename) {
    const comoLlega = await fetch(`${URL}/uploads/${documento.cuerpo.filename}`, { headers: { Authorization: cabecera } });
    revisar(
      'y se baja en vez de abrirse',
      comoLlega.headers.get('content-disposition') === 'attachment',
      `llegó como ${comoLlega.headers.get('content-disposition')}`
    );
  }

  /* 1c · El pase no viaja escrito en la dirección --------------------------- */
  console.log('\n1c · El pase de sesión');
  // Escrito en la dirección quedaría anotado en los registros del servidor y
  // en el historial del navegador, y se iría en cualquier enlace que se
  // comparta. Solo se acepta por cabecera o en la galleta.
  const pelado = cabecera.replace('Bearer ', '');
  const porLaDireccion = await fetch(`${URL}/api/miembros?page=1&limit=1&token=${encodeURIComponent(pelado)}`);
  revisar('escrito en la dirección no sirve', porLaDireccion.status === 401, `respondió ${porLaDireccion.status}`);

  const porGalleta = await fetch(`${URL}/api/miembros?page=1&limit=1`, { headers: { Cookie: `sesion=${pelado}` } });
  revisar('y la galleta sigue sirviendo, que es de lo que dependen las descargas',
    porGalleta.status === 200, `respondió ${porGalleta.status}`);

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
      // Lo que ve quien corre la prueba puede estar acotado a sus iglesias; el
      // respaldo, en cambio, lleva la base entera. Así que no tienen por qué
      // coincidir: lo que no puede pasar es que el respaldo traiga de menos.
      const aqui = (await api('GET', '/api/miembros?page=1&limit=1')).datos.total;
      copia.close();
      revisar('la base del respaldo está sana', sana);
      revisar(
        'y trae la base entera, no un pedazo',
        cuantos > 0 && cuantos >= aqui,
        `el respaldo trae ${cuantos} miembro(s) y quien lo pidió alcanza a ver ${aqui}`
      );
    } catch (e) {
      revisar('la base del respaldo se puede abrir', false, e.message);
    }
    fs.rmSync(carpeta, { recursive: true, force: true });
  }

  /* 4 · El registro de cambios no se maquilla ------------------------------ */
  /* 3b · El respaldo que se hace solo -------------------------------------- */
  console.log('\n3b · El respaldo que se hace solo');
  // De nada sirve una copia automática si nadie puede comprobar que se está
  // haciendo, ni volver a ella.
  const auto = await api('POST', '/api/respaldo/automatico');
  revisar('se puede hacer una copia en el momento', !!(auto.datos && auto.datos.hecho),
    JSON.stringify(auto.datos).slice(0, 140));

  if (auto.datos && auto.datos.hecho) {
    const como = await api('GET', '/api/respaldo/automatico');
    revisar('queda a la vista cuándo fue la última', como.datos.dias === 0, `dice ${como.datos.dias} día(s)`);
    revisar('y no se guardan más de las que se pidió',
      como.datos.copias.length <= como.datos.conservar,
      `${como.datos.copias.length} guardadas y se pidieron ${como.datos.conservar}`);

    // La copia tiene que ser una base entera y sana, no un archivo cualquiera
    const bajada = await fetch(`${URL}/api/respaldo/automatico/${auto.datos.nombre}`, {
      headers: { Authorization: cabecera },
    });
    revisar('la copia se puede bajar', bajada.status === 200, `respondió ${bajada.status}`);
    if (bajada.status === 200) {
      const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'copia-'));
      const comprimida = path.join(carpeta, 'copia.db.gz');
      fs.writeFileSync(comprimida, Buffer.from(await bajada.arrayBuffer()));
      try {
        execFileSync('gunzip', ['-f', comprimida]);
        const Base = require('better-sqlite3');
        const copia = new Base(path.join(carpeta, 'copia.db'), { readonly: true });
        const sana = copia.pragma('integrity_check')[0].integrity_check === 'ok';
        const cuantos = copia.prepare('SELECT COUNT(*) AS c FROM miembros').get().c;
        copia.close();
        revisar('y es una base sana', sana);
        revisar('con los datos adentro', cuantos > 0, `trae ${cuantos} miembro(s)`);
      } catch (e) {
        revisar('la copia se puede abrir', false, e.message);
      }
      fs.rmSync(carpeta, { recursive: true, force: true });
    }

    // Y no la baja cualquiera
    const ajeno = await fetch(`${URL}/api/respaldo/automatico/${auto.datos.nombre}`);
    revisar('sin sesión no se baja', ajeno.status === 401, `respondió ${ajeno.status}`);

    const inventada = await fetch(`${URL}/api/respaldo/automatico/..%2f..%2figlesias.db`, {
      headers: { Authorization: cabecera },
    });
    revisar('ni se puede pedir otra cosa por el nombre', inventada.status === 404, `respondió ${inventada.status}`);
  }

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

  /* 5 · El alcance por cuerpo no se salta escribiendo la dirección ---------- */
  console.log('\n5 · Los paneles de un cuerpo ajeno');
  const cuerpos = (await api('GET', '/api/cuerpos?page=1&limit=2')).datos.rows || [];
  if (cuerpos.length < 2) {
    console.log('   ⚠️  hace falta más de un cuerpo para probar esta parte');
  } else {
    // Un usuario acotado al primero, creado para la prueba y borrado al final
    const n = '19222334';
    const rutSuyo = `${n}-${require('../server/rut').digitoVerificador(n)}`;
    const creado = await api('POST', '/api/usuarios', {
      rut: rutSuyo, nombre: 'Prueba De Alcance', rol: 'secretario',
      password: 'prueba1234', cuerpos: [cuerpos[0].id],
      // También una iglesia: sin ella alcanzaría todas y no habría ajena con
      // la que probar que elegir no amplía nada.
      iglesias: cuerpos[0].iglesia_id ? [cuerpos[0].iglesia_id] : [],
    });
    const suyoId = creado.datos && creado.datos.id;
    if (!suyoId) {
      revisar('se pudo crear el usuario de prueba', false, JSON.stringify(creado.datos).slice(0, 160));
    } else {
      // Se le quita la obligación de cambiar la clave, que es de su primer ingreso
      await api('PUT', `/api/usuarios/${suyoId}`, { ...creado.datos, debe_cambiar_password: 0 });
      const suyo = await entrar(rutSuyo, 'prueba1234');
      const propio = await suyo('GET', `/api/cuerpos/${cuerpos[0].id}/integrantes`);
      const ajeno = await suyo('GET', `/api/cuerpos/${cuerpos[1].id}/integrantes`);
      revisar('alcanza los integrantes de su cuerpo', propio.estado === 200, `respondió ${propio.estado}`);
      revisar('y no los de otro', ajeno.estado === 403, `respondió ${ajeno.estado}`);
      const cuotasAjenas = await suyo('GET', `/api/cuerpos/${cuerpos[1].id}/cuotas`);
      revisar('ni sus cuotas', cuotasAjenas.estado === 403, `respondió ${cuotasAjenas.estado}`);

      // Cobrar y listar gente son las dos puertas por las que se colaba
      const genteAjena = await suyo('GET', `/api/directivas/integrantes?cuerpo_id=${cuerpos[1].id}`);
      revisar('ni su gente desde el selector de directivas', genteAjena.estado === 403, `respondió ${genteAjena.estado}`);

      const deEllos = (await api('GET', `/api/cuerpos/${cuerpos[1].id}/integrantes`)).datos.integrantes || [];
      if (deEllos.length) {
        const cobrar = await suyo('POST', `/api/cuerpos/${cuerpos[1].id}/cuotas`, {
          integrante_id: deEllos[0].id, anio: 2026, mes: 12,
        });
        revisar('ni cobrarles una cuota', cobrar.estado === 403, `respondió ${cobrar.estado}`);

        const colar = await suyo('POST', `/api/cuerpos/${cuerpos[0].id}/cuotas`, {
          integrante_id: deEllos[0].id, anio: 2026, mes: 12,
        });
        // Da lo mismo si lo frena el permiso o el alcance: lo que importa es
        // que no entre en el libro de un cuerpo que no es el suyo.
        revisar('ni colar a uno de ellos en el libro del suyo', [403, 404].includes(colar.estado), `respondió ${colar.estado}`);
      }

      /* 6 · Elegir iglesia no amplía lo asignado --------------------------- */
      console.log('\n6 · Elegir con qué iglesia trabajar');
      const todas = (await api('GET', '/api/iglesias?page=1&limit=50')).datos.rows || [];
      const suyaId = (await suyo('GET', '/api/meta')).datos.user.iglesias_disponibles.map((i) => i.id);
      const ajenaIglesia = todas.find((i) => !suyaId.includes(i.id));
      if (ajenaIglesia) {
        const intento = await suyo('PUT', '/api/auth/iglesias-de-trabajo', { iglesias: [ajenaIglesia.id] });
        revisar(
          'elegir una iglesia que no le tocó no le sirve de nada',
          intento.estado === 200 && (intento.datos.iglesias || []).length === 0,
          JSON.stringify(intento.datos.iglesias)
        );
      } else {
        console.log('   ℹ️  ese usuario alcanza todas las iglesias: no hay ajena con la que probar');
      }

      await api('DELETE', `/api/usuarios/${suyoId}`);
    }
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
