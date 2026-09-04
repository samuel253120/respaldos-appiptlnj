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
 *   7. La página pública de verificación de credenciales no entrega nada sin
 *      el código de autenticidad, y probando números la puerta se cierra.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run seguridad
 *   URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=… npm run seguridad
 */
const fs = require('fs');
const { hoy, alinearConElServidor } = require('./hoy');
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
  // La fecha de hoy la decide el servidor, no esta máquina: ver pruebas/hoy.js
  await alinearConElServidor(URL);
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

    /*
     * Se acepta 404 o 403, y las dos son un «no».
     *
     * Hasta la 1.191.0 contestaba 404: el nombre se recortaba a su última
     * parte, no había ningún archivo así, y el disco decía que no existe.
     * Ahora contesta 403 antes de tocar el disco, porque un archivo que no
     * pertenece a ninguna ficha solo lo ve quien lo subió, y a este no lo
     * subió nadie. Es un «no» más temprano, y además deja de decir qué
     * nombres existen y cuáles no.
     */
    const escapar = await fetch(`${URL}/uploads/..%2f..%2fpackage.json`, { headers: { Authorization: cabecera } });
    revisar('no se puede salir de la carpeta de archivos',
      escapar.status === 404 || escapar.status === 403, `respondió ${escapar.status}`);

    const inventado = await fetch(`${URL}/uploads/no-existe-jamas-esto.txt`, { headers: { Authorization: cabecera } });
    revisar('y un nombre inventado tampoco entrega nada',
      inventado.status === 404 || inventado.status === 403, `respondió ${inventado.status}`);

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
    fecha: hoy(),
    tipo: 'Ingreso', categoria: 'Ofrendas', monto: 12345, concepto,
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
  /* 4b · La planilla no baja más de lo que la pantalla muestra ------------- */
  console.log('\n4b · La planilla del listado');
  // Una planilla que trajera filas que la pantalla no muestra sería una
  // filtración con forma de comodidad.
  const planillaAdmin = await fetch(`${URL}/api/miembros/planilla`, { headers: { Authorization: cabecera } });
  revisar('se baja', planillaAdmin.status === 200, `respondió ${planillaAdmin.status}`);
  revisar(
    'viene como archivo para guardar y no como página',
    (planillaAdmin.headers.get('content-disposition') || '').startsWith('attachment') &&
      planillaAdmin.headers.get('x-content-type-options') === 'nosniff',
    `${planillaAdmin.headers.get('content-disposition')} · ${planillaAdmin.headers.get('x-content-type-options')}`
  );

  // Se leen los bytes y no el texto: al decodificar, fetch se come la marca
  // del principio, que es justo lo que hay que comprobar.
  const bytes = Buffer.from(await planillaAdmin.arrayBuffer());
  const csv = bytes.toString('utf8');
  const filasCsv = csv.replace(/^\ufeff/, '').trim().split(/\r?\n/).length - 1; // menos el encabezado
  const enPantalla = (await api('GET', '/api/miembros?page=1&limit=1')).datos.total;
  revisar('trae todo lo que la pantalla dice tener', filasCsv === enPantalla,
    `la planilla trae ${filasCsv} y la pantalla dice ${enPantalla}`);
  revisar(
    'parte con la marca que hace que Excel lea las tildes',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    `empieza con ${bytes.slice(0, 3).toString('hex')}`
  );
  revisar('no lleva contraseñas', !/contrase|password/i.test(csv.split(/\r?\n/)[0]));

  // Y obedece los filtros, que es de lo que depende que sirva
  const conFiltro = await fetch(`${URL}/api/miembros/planilla?sin=telefono`, { headers: { Authorization: cabecera } })
    .then((r) => r.text());
  const filasFiltradas = conFiltro.replace(/^\ufeff/, '').trim().split(/\r?\n/).length - 1;
  const sinTelefono = (await api('GET', '/api/miembros?page=1&limit=1&sin=telefono')).datos.total;
  revisar('y obedece los filtros que estén puestos', filasFiltradas === sinTelefono,
    `la planilla filtrada trae ${filasFiltradas} y la lista dice ${sinTelefono}`);

  const sinPase = await fetch(`${URL}/api/miembros/planilla`);
  revisar('sin sesión no se baja', sinPase.status === 401, `respondió ${sinPase.status}`);

  /* 4c · Lo que falta por completar ---------------------------------------- */
  console.log('\n4c · Los datos por completar');
  const faltan = await api('GET', '/api/pendientes');
  revisar('se puede preguntar qué falta', faltan.estado === 200, `respondió ${faltan.estado}`);
  if (faltan.estado === 200) {
    const p = faltan.datos;
    revisar('dice cuántas fichas hay', typeof p.total === 'number' && p.total >= 0, `dice ${p.total}`);
    // Cada conteo tiene que poder abrirse: si no cuadra con la lista, el
    // número no sirve para nada.
    let cuadran = true;
    let detalle = '';
    for (const f of (p.faltas || []).slice(0, 3)) {
      const lista = (await api('GET', `/api/miembros?page=1&limit=1&sin=${f.campo}`)).datos.total;
      if (lista !== f.cuantos) {
        cuadran = false;
        detalle += `${f.campo}: dice ${f.cuantos} y la lista trae ${lista}. `;
      }
    }
    revisar('y cada conteo se puede abrir como lista', cuadran, detalle);
  }

  /* 4d · Lo que se borra queda anotado ------------------------------------- */
  console.log('\n4d · Lo que se borra, en cualquier módulo');
  // Borrar es lo único que no se deshace, y con la ficha se va su historial:
  // si no queda acá, no queda en ninguna parte.
  const cat = await api('POST', '/api/categorias_tesoreria', {
    nombre: `Prueba borrado ${Date.now()}`, tipo: 'Ingreso', activo: 1,
  });
  if (cat.estado === 201 || cat.estado === 200) {
    const comoSeLlamaba = cat.datos.nombre;
    await api('DELETE', `/api/categorias_tesoreria/${cat.datos.id}`);
    const registro = (await api('GET', '/api/registro_cambios?page=1&limit=10')).datos.rows;
    const anotado = registro.find((r) => r.accion === 'Eliminación' && (r.detalle || '').includes(comoSeLlamaba));
    revisar('un módulo que no es del dinero también deja rastro al borrarse', !!anotado,
      'no apareció la eliminación en el Registro de Cambios');
    revisar('y se sabe quién fue', !!(anotado && anotado.usuario), anotado ? 'sin usuario' : '');
  } else {
    revisar('se pudo crear una categoría de prueba', false, `respondió ${cat.estado}: ` + JSON.stringify(cat.datos).slice(0, 120));
  }

  /* 4d-bis · Lo que entra por planilla ------------------------------------- */
  console.log('\n4d-bis · La importación por planilla');
  /**
   * La planilla escribe en las mismas tablas que el formulario, y durante un
   * tiempo se saltaba lo que el formulario sí hacía: los topes de los montos
   * —entraba un movimiento de 1e308 y el saldo de la iglesia pasaba a decir
   * «1e+308»—, el rastro en el Registro de Cambios y lo que cada módulo hace
   * después de guardar. Un cuerpo importado nacía sin sus cuentas de tesorería
   * y un servicio con cien mil pesos de ofrenda no ponía un peso en los libros.
   */
  const cuentaParaImportar = (await api('GET', '/api/cuentas_tesoreria?page=1&limit=1')).datos.rows[0];
  if (cuentaParaImportar) {
    const marca = Date.now();
    const revision = await api('POST', '/api/importar/tesoreria', {
      prueba: true,
      filas: [
        { fecha: '2026-01-05', tipo: 'Ingreso', categoria: 'Diezmos', concepto: `enorme ${marca}`, monto: '1e308', cuenta_id: cuentaParaImportar.id },
        { fecha: '2026-01-05', tipo: 'Ingreso', categoria: 'Diezmos', concepto: `negativo ${marca}`, monto: '-999999', cuenta_id: cuentaParaImportar.id },
        { fecha: '2026-01-05', tipo: 'Ingreso', categoria: 'Diezmos', concepto: `normal ${marca}`, monto: '50000', cuenta_id: cuentaParaImportar.id },
      ],
    });
    revisar('un monto imposible no entra por planilla', revision.datos.conError >= 2,
      `quedaron ${revision.datos.correctas} correctas de 3`);
    revisar('y el que sí sirve pasa igual', revision.datos.correctas === 1,
      `quedaron ${revision.datos.correctas}`);

    const deVerdad = await api('POST', '/api/importar/tesoreria', {
      prueba: false,
      filas: [{ fecha: '2026-01-05', tipo: 'Ingreso', categoria: 'Diezmos', concepto: `rastro ${marca}`, monto: '1000', cuenta_id: cuentaParaImportar.id }],
    });
    const anotadoImport = (await api('GET', '/api/registro_cambios?page=1&limit=10')).datos.rows
      .find((r) => (r.registro || '').includes(`rastro ${marca}`) || (r.detalle || '').includes(`rastro ${marca}`));
    revisar('lo que entra por planilla deja rastro en el Registro de Cambios', !!anotadoImport,
      `se importaron ${deVerdad.datos.correctas}, pero no apareció en el registro`);
    revisar('y se sabe quién lo importó', !!(anotadoImport && anotadoImport.usuario));
  } else {
    revisar('había una cuenta de tesorería con la que probar', false);
  }

  const iglesiaParaCuerpo = (await api('GET', '/api/iglesias?page=1&limit=1')).datos.rows[0];
  if (iglesiaParaCuerpo) {
    const cuentasAntes = (await api('GET', '/api/cuentas_tesoreria?page=1&limit=1')).datos.total;
    const cuerpoImportado = await api('POST', '/api/importar/cuerpos', {
      prueba: false,
      filas: [{ nombre: `Cuerpo importado ${Date.now()}`, iglesia_id: iglesiaParaCuerpo.id, tipo: 'Cuerpo', estado: 'Activo' }],
    });
    const cuentasDespues = (await api('GET', '/api/cuentas_tesoreria?page=1&limit=1')).datos.total;
    revisar('un cuerpo importado trae sus cuentas de tesorería, como el que se crea a mano',
      cuerpoImportado.datos.correctas === 1 && cuentasDespues > cuentasAntes,
      `cuentas: ${cuentasAntes} → ${cuentasDespues}`);
  }

  /* 4e · Las reglas que hace cumplir el navegador -------------------------- */
  console.log('\n4e · Las reglas del navegador');
  const portada = await fetch(`${URL}/`);
  const regla = portada.headers.get('content-security-policy') || '';
  revisar('la página trae su regla de seguridad', !!regla, 'no viene ninguna');
  revisar(
    'y no deja ejecutar instrucciones escritas dentro de la página',
    /script-src 'self'/.test(regla) && !/script-src[^;]*unsafe-inline/.test(regla),
    regla.slice(0, 120)
  );
  revisar('no se puede meter el sistema dentro de otro sitio',
    portada.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(regla),
    `${portada.headers.get('x-frame-options')} · ${regla.includes('frame-ancestors') ? 'con' : 'sin'} frame-ancestors`);
  revisar('el navegador no adivina el tipo de los archivos',
    portada.headers.get('x-content-type-options') === 'nosniff',
    `dice ${portada.headers.get('x-content-type-options')}`);
  revisar('al salir a otro sitio no se cuenta de dónde se venía',
    !!portada.headers.get('referrer-policy'), 'no viene');

  /* 4f · Cambiar la contraseña cierra las sesiones ------------------------- */
  console.log('\n4f · Cambiar la contraseña cierra lo que estaba abierto');
  // A quien le roban la clave, cambiarla tiene que sacar al que entró con
  // ella. Antes seguía adentro hasta que su pase caducara solo.
  const rutDePrueba = '15555555-6';
  await api('DELETE', `/api/usuarios/${(await api('GET', `/api/usuarios?page=1&limit=1&f_rut=${rutDePrueba}`)).datos.rows.map((u) => u.id)[0] || 0}`);
  const cuentaDePrueba = await api('POST', '/api/usuarios', {
    rut: rutDePrueba, nombre: 'Prueba de sesiones', password: 'Cordillera47', rol: 'consulta', activo: 1,
  });
  if (cuentaDePrueba.estado === 201 || cuentaDePrueba.estado === 200) {
    const entrarComo = async (clave) => {
      const d = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: rutDePrueba, password: clave }),
      }).then((r) => r.json());
      return d.token || null;
    };
    const mirar = (pase) => fetch(`${URL}/api/auth/me`, { headers: { Authorization: `Bearer ${pase}` } }).then((r) => r.status);

    // La cuenta nace obligada a cambiar la contraseña: se hace y queda usable
    const primero = await entrarComo('Cordillera47');
    await fetch(`${URL}/api/auth/cambiar-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${primero}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual: 'Cordillera47', nueva: 'Primera2026' }),
    });

    const enElTelefono = await entrarComo('Primera2026');
    await new Promise((r) => setTimeout(r, 1100)); // que el pase nuevo no nazca el mismo segundo
    const enElComputador = await entrarComo('Primera2026');
    revisar('las dos sesiones entran', (await mirar(enElTelefono)) === 200 && (await mirar(enElComputador)) === 200);

    const cambio = await fetch(`${URL}/api/auth/cambiar-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${enElComputador}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual: 'Primera2026', nueva: 'Segunda2026' }),
    }).then((r) => r.json());

    revisar('la sesión del otro aparato se cierra', (await mirar(enElTelefono)) === 401,
      `respondió ${await mirar(enElTelefono)}`);
    revisar('y quien la cambió no queda afuera', !!cambio.token && (await mirar(cambio.token)) === 200,
      cambio.token ? `respondió ${await mirar(cambio.token)}` : 'no le dieron pase nuevo');

    // Y que el administrador la restablezca también saca al que esté adentro
    const otraVez = await entrarComo('Segunda2026');
    await new Promise((r) => setTimeout(r, 1100));
    await api('POST', `/api/usuarios/${cuentaDePrueba.datos.id}/restablecer-clave`);
    revisar('que el administrador la restablezca también cierra la sesión', (await mirar(otraVez)) === 401,
      `respondió ${await mirar(otraVez)}`);

    await api('DELETE', `/api/usuarios/${cuentaDePrueba.datos.id}`);
  } else {
    revisar('se pudo crear la cuenta de prueba', false, `respondió ${cuentaDePrueba.estado}`);
  }

  /* 4g · Los archivos no quedan sueltos ------------------------------------ */
  console.log('\n4g · Los archivos de una ficha que se borra');
  const foto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const subidaPropia = (await subir('para-borrar.jpg', foto)).cuerpo;
  if (subidaPropia.filename) {
    const suIglesia = (await api('GET', '/api/iglesias?page=1&limit=1')).datos.rows[0];
    const ficha = await api('POST', '/api/miembros', {
      iglesia_id: suIglesia && suIglesia.id, rut: '20111222-2', nombres: 'Prueba', apellidos: 'De Archivos',
      genero: 'Masculino', estado: 'Activo', foto: subidaPropia.filename,
    });
    if (ficha.estado === 201 || ficha.estado === 200) {
      const sigueAhi = async () =>
        (await fetch(`${URL}/uploads/${subidaPropia.filename}`, { headers: { Authorization: cabecera } })).status === 200;
      revisar('mientras la ficha existe, el archivo está', await sigueAhi());
      await api('DELETE', `/api/miembros/${ficha.datos.id}`);
      revisar('al borrar la ficha, su archivo se va con ella', !(await sigueAhi()),
        'el archivo quedó en el disco sin ficha desde donde llegar a él');
    } else {
      revisar('se pudo crear la ficha de prueba', false, `respondió ${ficha.estado}`);
    }
  }

  /* 4h · Los datos de salud no los ve cualquiera --------------------------- */
  console.log('\n4h · Los datos de salud de una ficha');
  // Están en la ficha para que en una actividad se sepa si alguien es alérgico
  // a la penicilina, no para que circulen. Antes los leía cualquiera que
  // pudiera abrir la ficha, y eso incluye a todo secretario.
  const iglesiaParaSalud = (await api('GET', '/api/iglesias?page=1&limit=1')).datos.rows[0];
  const rutSano = (() => {
    const c = String(15000000 + (Date.now() % 900000));
    return `${c}-${require('../server/rut').digitoVerificador(c)}`;
  })();
  const conSalud = await api('POST', '/api/miembros', {
    iglesia_id: iglesiaParaSalud && iglesiaParaSalud.id, rut: rutSano,
    nombres: 'Prueba', apellidos: 'De Salud', genero: 'Masculino', estado: 'Activo',
    alergias: 'Penicilina', enfermedades: 'Diabetes tipo 2',
  });

  if (conSalud.estado === 201 || conSalud.estado === 200) {
    const suId = conSalud.datos.id;
    revisar('el administrador los ve', conSalud.datos.alergias === 'Penicilina',
      `recibió ${JSON.stringify(conSalud.datos.alergias)}`);

    // Una cuenta que no debería alcanzarlos
    const rutSec = (() => {
      const c = String(14000000 + (Date.now() % 900000));
      return `${c}-${require('../server/rut').digitoVerificador(c)}`;
    })();
    const secre = await api('POST', '/api/usuarios', {
      rut: rutSec, nombre: 'Secretario de prueba', password: 'Salud2026', rol: 'secretario', activo: 1,
    });
    if (secre.estado === 201 || secre.estado === 200) {
      const suPase = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: rutSec, password: 'Salud2026' }),
      }).then((r) => r.json());
      // Nace obligado a cambiar la contraseña; se cambia y queda usable
      await fetch(`${URL}/api/auth/cambiar-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${suPase.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: 'Salud2026', nueva: 'Salud2026Nueva' }),
      });
      const entrada = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: rutSec, password: 'Salud2026Nueva' }),
      }).then((r) => r.json());
      const comoSecretario = (m, r, b) => fetch(URL + r, {
        method: m, headers: { Authorization: `Bearer ${entrada.token}`, 'Content-Type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      }).then(async (x) => ({ estado: x.status, datos: await x.json().catch(() => ({})) }));

      const suVista = await comoSecretario('GET', `/api/miembros/${suId}`);
      revisar('el secretario no', suVista.datos.alergias === undefined,
        `recibió ${JSON.stringify(suVista.datos.alergias)}`);
      revisar('y se le dice que hay algo que no está viendo', suVista.datos.salud_oculta === true,
        'sin eso, la ficha se lee como si la persona no tuviera ninguna alergia');

      const suListado = await comoSecretario('GET', '/api/miembros?page=1&limit=50');
      revisar('tampoco en el listado', !JSON.stringify(suListado.datos).includes('Penicilina'));

      const suPlanilla = await fetch(`${URL}/api/miembros/planilla`, {
        headers: { Authorization: `Bearer ${entrada.token}` },
      }).then((r) => r.text());
      revisar('ni en la planilla que se baja', !suPlanilla.includes('Penicilina'));

      // Y lo que más importa: no puede borrarlos guardando a ciegas
      await comoSecretario('PUT', `/api/miembros/${suId}`, {
        ...suVista.datos, telefono: '+56933334444', alergias: '', enfermedades: null,
      });
      const despues = (await api('GET', `/api/miembros/${suId}`)).datos;
      revisar('ni borrarlos guardando la ficha a ciegas', despues.alergias === 'Penicilina',
        `quedaron en ${JSON.stringify(despues.alergias)}`);
      revisar('y su cambio legítimo sí se guarda', despues.telefono === '+56933334444',
        `el teléfono quedó en ${JSON.stringify(despues.telefono)}`);

      await api('DELETE', `/api/usuarios/${secre.datos.id}`);
    } else {
      revisar('se pudo crear el secretario de prueba', false, `respondió ${secre.estado}`);
    }
    await api('DELETE', `/api/miembros/${suId}`);
  } else {
    revisar('se pudo crear la ficha con datos de salud', false, JSON.stringify(conSalud.datos).slice(0, 140));
  }

  /* 4i · El contacto reservado y la planilla ------------------------------- */
  console.log('\n4i · Lo que se le quitó a una cuenta, se le quitó por todas partes');
  // Un permiso que se puede rodear no es un permiso. Acá se le quitan a una
  // misma cuenta los datos de contacto y la planilla, y se prueban las cuatro
  // puertas por las que el dato podría salir igual: la ficha, el listado, el
  // buscador y el archivo que se baja. Durante el desarrollo el teléfono se
  // escondía en la ficha y seguía encontrándose escribiéndolo en el buscador,
  // que es la puerta que se olvida.
  const numeroDePrueba = `+5699${String(Date.now()).slice(-7)}`;
  const rutConTelefono = (() => {
    const c = String(16000000 + (Date.now() % 900000));
    return `${c}-${require('../server/rut').digitoVerificador(c)}`;
  })();
  const conTelefono = await api('POST', '/api/miembros', {
    iglesia_id: iglesiaParaSalud && iglesiaParaSalud.id, rut: rutConTelefono,
    nombres: 'Prueba', apellidos: 'De Contacto', estado: 'Activo',
    telefono: numeroDePrueba, email: 'reservado@example.cl', direccion: 'Calle Reservada 1',
  });

  if (conTelefono.estado === 201 || conTelefono.estado === 200) {
    const fichaId = conTelefono.datos.id;
    const rutSinNada = (() => {
      const c = String(13000000 + (Date.now() % 900000));
      return `${c}-${require('../server/rut').digitoVerificador(c)}`;
    })();
    const acotada = await api('POST', '/api/usuarios', {
      rut: rutSinNada, nombre: 'Prueba Sin Contacto', password: 'Manzanares82',
      rol: 'secretario', activo: 1,
      permisos: { miembros_contacto: [], datos_planilla: [] },
    });

    if (acotada.estado === 201 || acotada.estado === 200) {
      const primera = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: rutSinNada, password: 'Manzanares82' }),
      }).then((r) => r.json());
      await fetch(`${URL}/api/auth/cambiar-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${primera.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: 'Manzanares82', nueva: 'Manzanares82Otra' }),
      });
      const suya = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: rutSinNada, password: 'Manzanares82Otra' }),
      }).then((r) => r.json());
      const comoElla = (m, r, b) => fetch(URL + r, {
        method: m, headers: { Authorization: `Bearer ${suya.token}`, 'Content-Type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      }).then(async (x) => ({ estado: x.status, datos: await x.json().catch(() => ({})) }));

      const suFicha = await comoElla('GET', `/api/miembros/${fichaId}`);
      revisar('el teléfono no le llega en la ficha', suFicha.datos.telefono === undefined,
        `recibió ${JSON.stringify(suFicha.datos.telefono)}`);
      revisar('ni el correo ni la dirección', suFicha.datos.email === undefined && suFicha.datos.direccion === undefined);
      revisar('y se le dice que hay algo que no está viendo',
        (suFicha.datos.reservado_oculto || []).includes('miembros_contacto'),
        'sin eso, la ficha se lee como si la persona no tuviera teléfono');
      revisar('lo demás de la ficha sí le llega', suFicha.datos.nombres === 'Prueba');

      const suListado = await comoElla('GET', '/api/miembros?page=1&limit=50');
      revisar('tampoco en el listado', !JSON.stringify(suListado.datos).includes(numeroDePrueba));

      /**
       * Se buscan NUEVE dígitos del teléfono, y no siete, por una razón.
       *
       * Un RUT guarda ocho dígitos y después el guion, así que una tirada de
       * nueve seguidos no puede aparecer en esa columna. Con siete sí podía:
       * el RUT y el teléfono de esta prueba se arman los dos del mismo reloj,
       * y una de cada cien veces el RUT contenía el fragmento buscado. La
       * comprobación fallaba sin que nada estuviera mal, que es la peor clase
       * de prueba: la que enseña a no creerle.
       */
      const nueveDigitos = numeroDePrueba.replace(/\D/g, '').slice(-9);
      const buscando = await comoElla('GET', `/api/miembros?q=${encodeURIComponent(nueveDigitos)}`);
      revisar('ni puede dar con la persona buscando por su número',
        (buscando.datos.total || 0) === 0,
        `el buscador devolvió ${buscando.datos.total} resultado(s): el dato queda igual de expuesto`);
      // Y la premisa de la comprobación: quien sí lo alcanza lo encuentra
      const laEncuentra = await api('GET', `/api/miembros?q=${encodeURIComponent(nueveDigitos)}`);
      revisar('y quien sí lo alcanza sí da con ella', (laEncuentra.datos.total || 0) === 1,
        `el administrador encontró ${laEncuentra.datos.total}: la prueba no está midiendo lo que cree`);
      const porNombre = await comoElla('GET', '/api/miembros?q=Contacto');
      revisar('pero busca por lo que sí ve, como siempre', (porNombre.datos.total || 0) > 0);

      const elSelector = await comoElla('GET', '/api/miembros/options');
      revisar('ni viaja escondido en el selector de personas',
        !JSON.stringify(elSelector.datos).includes(numeroDePrueba),
        'el selector manda «por qué se puede buscar» a la vista, en el navegador');

      const suPlanilla = await fetch(`${URL}/api/miembros/planilla`, {
        headers: { Authorization: `Bearer ${suya.token}` },
      });
      revisar('y la planilla no se le entrega', suPlanilla.status === 403,
        `respondió ${suPlanilla.status}`);

      // Con la planilla devuelta, sigue sin traer la columna reservada
      await api('PUT', `/api/usuarios/${acotada.datos.id}`, {
        version: (await api('GET', `/api/usuarios/${acotada.datos.id}`)).datos.version,
        permisos: { miembros_contacto: [] },
      });
      const conPlanilla = await fetch(`${URL}/api/miembros/planilla`, {
        headers: { Authorization: `Bearer ${suya.token}` },
      }).then((r) => r.text());
      revisar('y si se le devuelve, baja sin la columna reservada',
        !conPlanilla.includes(numeroDePrueba) && !conPlanilla.includes('"Teléfono"'),
        'la columna se quita entera: una casilla vacía se lee como «no tiene teléfono»');
      revisar('pero con todo lo demás', conPlanilla.includes('Nombres'));

      // Y no puede borrar a ciegas lo que no ve
      await comoElla('PUT', `/api/miembros/${fichaId}`, {
        ...suFicha.datos, apellidos: 'De Contacto Dos', telefono: '', email: '', direccion: '',
      });
      const despuesDelCiego = (await api('GET', `/api/miembros/${fichaId}`)).datos;
      revisar('ni borrarlo guardando la ficha a ciegas', despuesDelCiego.telefono === numeroDePrueba,
        `quedó en ${JSON.stringify(despuesDelCiego.telefono)}`);
      revisar('y su cambio legítimo sí se guarda', despuesDelCiego.apellidos === 'De Contacto Dos');

      await api('DELETE', `/api/usuarios/${acotada.datos.id}`);
    } else {
      revisar('se pudo crear la cuenta acotada', false, `respondió ${acotada.estado}`);
    }
    await api('DELETE', `/api/miembros/${fichaId}`);
  } else {
    revisar('se pudo crear la ficha con contacto', false, JSON.stringify(conTelefono.datos).slice(0, 140));
  }

  /* 4j · Las dos tesorerías --------------------------------------------- */
  console.log('\n4j · La plata de la iglesia y la plata de los cuerpos');
  // Eran el mismo permiso: dar «Tesorería» daba las dos. Ahora son dos llaves,
  // y lo que hay que comprobar es que quitar una cierre TODAS las puertas del
  // otro libro —el listado, la ficha, la planilla, el resumen del panel y el
  // guardado—, porque cerrar solo el listado no sirve de nada.
  const cuerpoConPlata = (await api('GET', '/api/cuerpos?page=1&limit=1')).datos.rows || [];
  const cuentas = (await api('GET', '/api/cuentas_tesoreria?page=1&limit=50')).datos.rows || [];
  const deCuerpo = cuentas.find((c) => c.cuerpo_id);
  const deIglesia = cuentas.find((c) => !c.cuerpo_id && c.estado === 'Activa');

  if (!deCuerpo || !deIglesia) {
    console.log('   ⚠️  hacen falta una cuenta de cuerpo y una de iglesia para probar esta parte');
  } else {
    const marca = `Prueba ${Date.now()}`;
    const movCuerpo = await api('POST', '/api/tesoreria', {
      fecha: hoy(), tipo: 'Ingreso', categoria: 'Donaciones',
      concepto: `${marca} cuerpo`, monto: 12345, cuenta_id: deCuerpo.id,
    });
    const movIglesia = await api('POST', '/api/tesoreria', {
      fecha: hoy(), tipo: 'Ingreso', categoria: 'Donaciones',
      concepto: `${marca} iglesia`, monto: 54321, cuenta_id: deIglesia.id,
    });

    revisar('el cuerpo de un movimiento sale de su cuenta, no de lo que se escriba',
      movCuerpo.datos.cuerpo_id && Number(movCuerpo.datos.cuerpo_id) === Number(deCuerpo.cuerpo_id),
      `quedó en ${JSON.stringify(movCuerpo.datos.cuerpo_id)} y la cuenta es del cuerpo ${deCuerpo.cuerpo_id}`);

    // Y no se puede mentir: decir que un movimiento de la iglesia es del cuerpo
    const mentira = await api('POST', '/api/tesoreria', {
      fecha: hoy(), tipo: 'Ingreso', categoria: 'Donaciones',
      concepto: `${marca} mentira`, monto: 100, cuenta_id: deIglesia.id, cuerpo_id: deCuerpo.cuerpo_id,
    });
    revisar('y no se le puede poner a mano el de otro', !mentira.datos.cuerpo_id,
      `quedó en ${JSON.stringify(mentira.datos.cuerpo_id)}`);

    const conNivel = async (quita, nombre) => {
      const c = String(12000000 + (Date.now() % 900000));
      const suRut = `${c}-${require('../server/rut').digitoVerificador(c)}`;
      const creado = await api('POST', '/api/usuarios', {
        rut: suRut, nombre, password: 'Manzanares82', rol: 'tesorero', activo: 1,
        permisos: { [quita]: [] },
      });
      if (creado.estado !== 201 && creado.estado !== 200) return null;
      const primera = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82' }),
      }).then((r) => r.json());
      await fetch(`${URL}/api/auth/cambiar-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${primera.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: 'Manzanares82', nueva: 'Manzanares82Otra' }),
      });
      const suya = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82Otra' }),
      }).then((r) => r.json());
      return {
        id: creado.datos.id,
        token: suya.token,
        api: (m, r, b) => fetch(URL + r, {
          method: m, headers: { Authorization: `Bearer ${suya.token}`, 'Content-Type': 'application/json' },
          body: b === undefined ? undefined : JSON.stringify(b),
        }).then(async (x) => ({ estado: x.status, datos: await x.json().catch(() => ({})) })),
      };
    };

    const soloIglesia = await conNivel('tesoreria_cuerpo', 'Prueba Solo Iglesia');
    const soloCuerpo = await conNivel('tesoreria_general', 'Prueba Solo Cuerpo');

    if (soloIglesia && soloCuerpo) {
      const suListado = await soloIglesia.api('GET', '/api/tesoreria?page=1&limit=100');
      revisar('quien no lleva la plata de los cuerpos no ve sus movimientos',
        !JSON.stringify(suListado.datos).includes(`${marca} cuerpo`));
      revisar('pero sí los de la iglesia, como siempre',
        JSON.stringify(suListado.datos).includes(`${marca} iglesia`));

      const alReves = await soloCuerpo.api('GET', '/api/tesoreria?page=1&limit=100');
      revisar('y quien solo lleva la de los cuerpos no ve la de la iglesia',
        !JSON.stringify(alReves.datos).includes(`${marca} iglesia`));
      revisar('pero sí la de su cuerpo', JSON.stringify(alReves.datos).includes(`${marca} cuerpo`));

      const laFicha = await soloIglesia.api('GET', `/api/tesoreria/${movCuerpo.datos.id}`);
      revisar('ni la abre escribiendo la dirección a mano', laFicha.estado === 403,
        `respondió ${laFicha.estado}`);
      const suCuenta = await soloIglesia.api('GET', `/api/cuentas_tesoreria/${deCuerpo.id}`);
      revisar('ni la cuenta del cuerpo', suCuenta.estado === 403, `respondió ${suCuenta.estado}`);

      const suPlanilla = await fetch(`${URL}/api/tesoreria/planilla`, {
        headers: { Authorization: `Bearer ${soloIglesia.token}` },
      }).then((r) => r.text());
      revisar('ni la baja en la planilla', !suPlanilla.includes(`${marca} cuerpo`));

      // El resumen del panel es un total suelto: si sumara plata que la persona
      // no puede abrir, vería un número que ningún movimiento suyo explica.
      const suPanel = await soloIglesia.api('GET', '/api/dashboard');
      const elDeTodos = (await api('GET', '/api/dashboard')).datos.finanzas;
      const elSuyo = suPanel.datos.finanzas;
      revisar('y el resumen del panel no suma plata que no puede abrir',
        elSuyo && elDeTodos && elDeTodos.ingresos_total - elSuyo.ingresos_total >= 12345,
        `el administrador suma ${elDeTodos && elDeTodos.ingresos_total} y ella ${elSuyo && elSuyo.ingresos_total}: ` +
        'la diferencia tendría que llevarse al menos los 12.345 del cuerpo');

      const alGuardar = await soloIglesia.api('POST', '/api/tesoreria', {
        fecha: hoy(), tipo: 'Ingreso', categoria: 'Donaciones',
        concepto: `${marca} a escondidas`, monto: 999, cuenta_id: deCuerpo.id,
      });
      revisar('ni le registra plata al cuerpo escribiendo la cuenta a mano',
        alGuardar.estado === 403, `respondió ${alGuardar.estado}`);

      // Las cuotas son plata del cuerpo: sin esa llave, tampoco
      if (cuerpoConPlata.length) {
        const susCuotas = await soloIglesia.api('GET', `/api/cuerpos/${cuerpoConPlata[0].id}/cuotas`);
        revisar('ni la planilla de cuotas del cuerpo', susCuotas.estado === 403,
          `respondió ${susCuotas.estado}`);
      }

      await api('DELETE', `/api/usuarios/${soloIglesia.id}`);
      await api('DELETE', `/api/usuarios/${soloCuerpo.id}`);
    } else {
      revisar('se pudieron crear las dos tesoreras de prueba', false);
    }

    for (const m of [movCuerpo, movIglesia, mentira]) {
      if (m.datos && m.datos.id) await api('DELETE', `/api/tesoreria/${m.datos.id}`);
    }
  }

  /* 4j-bis · La configuración, sin sesión ------------------------------- */
  console.log('\n4j-bis · Lo que la configuración entrega sin sesión iniciada');
  // La pantalla de acceso necesita tres cosas antes de que haya nadie
  // identificado: el aviso de mantenimiento, la identidad y el logo. Todo lo
  // demás —la contraseña inicial, las horas de sesión, los topes— tiene que
  // quedarse adentro. Es la clase de cosa que se rompe agregando una opción
  // nueva y marcándola «publica» sin pensarlo.
  const sinSesion = await fetch(`${URL}/api/configuracion/publica`).then((r) => r.json());
  revisar('lo público es solo lo que la pantalla de acceso necesita',
    Object.keys(sinSesion).sort().join(',') ===
      'iglesia_lema,iglesia_logo,iglesia_nombre,mantenimiento_activo,mantenimiento_mensaje,recuperacion_activa',
    `entrega ${Object.keys(sinSesion).join(', ')}`);
  revisar('la contraseña inicial no sale sin sesión', !('password_inicial' in sinSesion));

  const laConfigEntera = await fetch(`${URL}/api/configuracion`).then((r) => r.status);
  revisar('y la configuración completa pide sesión', laConfigEntera === 401 || laConfigEntera === 403,
    `respondió ${laConfigEntera}`);

  const elLogo = await fetch(`${URL}/api/configuracion/logo`);
  revisar('el logo sí se entrega sin sesión, que para eso está',
    elLogo.status === 200 && String(elLogo.headers.get('content-type')).startsWith('image/'),
    `respondió ${elLogo.status} ${elLogo.headers.get('content-type')}`);

  // Y no puede servir de puerta para leer cualquier archivo del disco
  const conTrampa = await fetch(`${URL}/api/configuracion/logo?v=../../iglesias.db`).then((r) => r.headers.get('content-type'));
  revisar('y no sirve para pedir otro archivo del disco', String(conTrampa).startsWith('image/'),
    `devolvió ${conTrampa}`);

  /* 4j-ter · El buscador general ---------------------------------------- */
  console.log('\n4j-ter · El buscador general no entrega lo que no corresponde');
  // Una caja que pregunta en los treinta y dos módulos a la vez es, si se hace
  // mal, la puerta de atrás más grande del sistema: se salta de un tirón los
  // permisos, el alcance y los datos reservados. Se comprueba con una cuenta
  // acotada de verdad, no con la del administrador.
  const sinSesionBusca = await fetch(`${URL}/api/buscar?q=Prueba`).then((r) => r.status);
  revisar('el buscador pide sesión', sinSesionBusca === 401 || sinSesionBusca === 403,
    `respondió ${sinSesionBusca}`);

  const cortito = await api('GET', '/api/buscar?q=a');
  revisar('con una sola letra no busca', cortito.datos.corto === true && cortito.datos.total === 0);

  {
    const c = String(19000000 + (Date.now() % 900000));
    const suRut = `${c}-${require('../server/rut').digitoVerificador(c)}`;
    const acotada = await api('POST', '/api/usuarios', {
      rut: suRut, nombre: 'Prueba Del Buscador', password: 'Manzanares82', rol: 'consulta', activo: 1,
      permisos: { miembros_contacto: [] },
    });
    if (acotada.estado !== 201 && acotada.estado !== 200) {
      revisar('se pudo crear la cuenta acotada del buscador', false, `respondió ${acotada.estado}`);
    } else {
      const primera = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82' }),
      }).then((r) => r.json());
      await fetch(`${URL}/api/auth/cambiar-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${primera.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: 'Manzanares82', nueva: 'Manzanares82Otra' }),
      });
      const suya = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82Otra' }),
      }).then((r) => r.json());
      const busca = (q) => fetch(`${URL}/api/buscar?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${suya.token}` },
      }).then((r) => r.json());

      /*
       * Un miembro con teléfono, para probar el dato reservado.
       *
       * EL NOMBRE Y EL TELÉFONO NO PUEDEN SALIR DEL MISMO RELOJ. Salían los
       * dos de `Date.now()` —el nombre era «Buscable<ahora>» y el teléfono
       * «+5698<últimos siete de ahora>»—, así que los nueve dígitos que se
       * buscan aparecían DENTRO del nombre cada vez que a esa hora le tocaban
       * un 9 y un 8 en el lugar justo. Cuando pasaba, la comprobación se caía
       * durante horas seguidas acusando una filtración que no existía: la
       * ficha salía por su NOMBRE, que esa cuenta sí puede ver.
       *
       * Una prueba de seguridad que grita en falso es peor que no tenerla:
       * enseña a mirar para otro lado el día que grita de verdad. El teléfono
       * sale ahora de dígitos al azar, y más abajo se comprueba que lo buscado
       * no esté en el nombre, para que esto no pueda volver en silencio.
       */
      const c2 = String(14500000 + (Date.now() % 400000));
      const rutBuscado = `${c2}-${require('../server/rut').digitoVerificador(c2)}`;
      const alAzar = String(require('crypto').randomInt(1000000, 9999999));
      const numero = `+5698${alAzar}`;
      const marca = `Buscable${Date.now()}`;
      const ficha = await api('POST', '/api/miembros', {
        iglesia_id: iglesiaParaSalud && iglesiaParaSalud.id, rut: rutBuscado,
        nombres: marca, apellidos: 'De Prueba', estado: 'Activo', telefono: numero,
      });

      const porNombre = await busca(marca);
      revisar('encuentra por lo que sí puede ver', (porNombre.total || 0) >= 1,
        `no la encontró buscando «${marca}»`);

      const suNumero = numero.replace(/\D/g, '').slice(-9);
      revisar('lo que se busca no está en lo que la cuenta sí puede ver',
        !`${marca} De Prueba ${rutBuscado}`.includes(suNumero),
        'el teléfono no puede aparecer dentro del nombre ni del RUT: si no, encontrarla '
        + 'no probaría nada sobre el dato reservado');

      const porTelefono = await busca(suNumero);
      revisar('pero no da con ella por un teléfono que no alcanza',
        (porTelefono.total || 0) === 0, `devolvió ${porTelefono.total} resultado(s)`);

      revisar('y el teléfono no viaja escondido en la respuesta',
        !JSON.stringify(porNombre).includes(suNumero));

      const conTesoreria = await busca('Diezmo');
      revisar('no le aparece un módulo que no puede ver',
        !(conTesoreria.grupos || []).some((g) => g.modulo === 'tesoreria'),
        'una cuenta de solo consulta no tiene Tesorería y no puede encontrar un movimiento');

      if (ficha.datos && ficha.datos.id) await api('DELETE', `/api/miembros/${ficha.datos.id}`);
      await api('DELETE', `/api/usuarios/${acotada.datos.id}`);
    }
  }

  /* 4j-qua · Los recursos de la credencial ------------------------------ */
  console.log('\n4j-qua · El sello y la firma de la credencial');
  // El logo se entrega sin sesión porque tiene que verse en la pantalla de
  // acceso. El sello y la firma, no: con ellos se arma un documento de
  // identidad ministerial, y quien los tenga puede imitar uno.
  const selloSinSesion = await fetch(`${URL}/api/configuracion/recurso/sello`).then((r) => r.status);
  revisar('el sello no se entrega sin sesión', selloSinSesion === 401 || selloSinSesion === 403,
    `respondió ${selloSinSesion}`);
  const firmaSinSesion = await fetch(`${URL}/api/configuracion/recurso/firma`).then((r) => r.status);
  revisar('la firma tampoco', firmaSinSesion === 401 || firmaSinSesion === 403,
    `respondió ${firmaSinSesion}`);

  const recursoInventado = await fetch(`${URL}/api/configuracion/recurso/inventado`, {
    headers: { Authorization: token },
  }).then((r) => r.status);
  revisar('y esa puerta solo entrega el sello y la firma, no cualquier archivo',
    recursoInventado === 404, `respondió ${recursoInventado}`);

  const conRuta = await fetch(`${URL}/api/configuracion/recurso/${encodeURIComponent('../../iglesias.db')}`, {
    headers: { Authorization: token },
  }).then((r) => r.status);
  revisar('ni escribiendo una ruta a mano', conRuta === 404, `respondió ${conRuta}`);

  const modoRaro = await api('PUT', '/api/configuracion', { credencial_qr_modo: 'inventado' });
  revisar('el modo del código QR no acepta un valor que no existe',
    modoRaro.datos.valores.credencial_qr_modo !== 'inventado',
    `quedó en ${modoRaro.datos.valores.credencial_qr_modo}`);

  /* 4j-qui · La página pública de verificación --------------------------- */
  console.log('\n4j-qui · La página pública de verificación de credenciales');
  /**
   * Es la única puerta del sistema que muestra datos de una persona SIN pedir
   * sesión. Todo lo que se comprueba acá apunta a lo mismo: que por esa puerta
   * no salga nada que no venga sellado con el código de autenticidad.
   */
  const unaEmitida = (await api('GET', '/api/credenciales?limit=50')).datos.rows
    .find((c) => c.serie_completa && c.estado !== 'Borrador');

  if (!unaEmitida) {
    console.log('   ℹ️  no hay ninguna credencial emitida con la que probar');
  } else {
    const laSerie = encodeURIComponent(unaEmitida.serie_completa);
    const comoLlega = (ruta) => fetch(`${URL}${ruta}`).then(async (r) => ({ estado: r.status, texto: await r.text() }));

    /**
     * Antes de nada, esperar a que se abra la puerta.
     *
     * Esta misma prueba termina gastando el tope de intentos errados a
     * propósito, así que si se corre dos veces seguidas la segunda arranca
     * frenada y todo lo demás respondería 429. El tope se cuenta por minuto:
     * se pregunta cuánto falta y se espera. No hay forma de soltarlo desde
     * fuera, y así tiene que ser —una puerta trasera para reiniciarlo sería
     * justo lo que un atacante necesita—.
     */
    const frenada = await fetch(`${URL}/v/0-0?c=X`);
    if (frenada.status === 429) {
      const faltan = Math.min(65, Number(frenada.headers.get('Retry-After')) || 60);
      console.log(`   ⏳ la corrida anterior dejó la puerta cerrada; esperando ${faltan} s a que se abra…`);
      await new Promise((sigue) => setTimeout(sigue, (faltan + 1) * 1000));
    }

    // Sin código no sale nada, y con uno inventado tampoco
    const sinCodigo = await comoLlega(`/v/${laSerie}`);
    revisar('sin el código no se muestra ningún dato',
      sinCodigo.estado === 404 && !sinCodigo.texto.includes(unaEmitida.snap_apellidos || '\u0000'),
      `respondió ${sinCodigo.estado}`);

    const codigoInventado = await comoLlega(`/v/${laSerie}?c=AAAAAAA`);
    revisar('con un código inventado tampoco',
      codigoInventado.estado === 404 && codigoInventado.texto.includes('NO VÁLIDA'),
      `respondió ${codigoInventado.estado}`);

    /**
     * Y la respuesta es LA MISMA para un número que no existe.
     *
     * Si se diferenciaran, probar números serviría para armar la lista de
     * credenciales emitidas sin acertarle nunca a un código.
     */
    const inexistente = await comoLlega('/v/9999999-9?c=AAAAAAA');
    revisar('un número que no existe da exactamente la misma respuesta',
      inexistente.texto === codigoInventado.texto && inexistente.estado === codigoInventado.estado,
      `${inexistente.estado} vs ${codigoInventado.estado}, ${inexistente.texto.length} vs ${codigoInventado.texto.length} caracteres`);

    // La fotografía tampoco se entrega sin el código
    const fotoSinCodigo = await fetch(`${URL}/v/${laSerie}/foto`).then((r) => r.status);
    revisar('la fotografía no se entrega sin el código', fotoSinCodigo === 404,
      `respondió ${fotoSinCodigo}`);

    // Y por esa puerta no se puede pedir ningún otro archivo del sistema
    const conRutaEscrita = await fetch(`${URL}/v/${encodeURIComponent('../../iglesias.db')}/foto?c=AAAAAAA`)
      .then((r) => r.status).catch(() => 0);
    revisar('ni escribiendo una ruta a mano en el número de serie',
      conRutaEscrita === 404, `respondió ${conRutaEscrita}`);

    /**
     * El tope de intentos errados (punto 9.6).
     *
     * Se cobran solo los que fallan: quien escanea credenciales de verdad no
     * gasta nada. Se prueba desde una serie inventada para no ensuciar la
     * cuenta de nada más.
     */
    let frenoLlego = 0;
    for (let i = 0; i < 60 && !frenoLlego; i++) {
      const r = await fetch(`${URL}/v/1234567-8?c=BBBBBBB`).then((x) => x.status);
      if (r === 429) frenoLlego = i + 1;
    }
    revisar('probando números al azar, la puerta se cierra', frenoLlego > 0,
      'se hicieron 60 intentos errados y ninguno fue rechazado');
  }

  /* 4j-sex · Quién puede emitir y revocar credenciales -------------------- */
  console.log('\n4j-sex · Emitir y revocar credenciales (sección 12)');
  /**
   * La credencial la firma el Pastor Presidente, no el sistema. Por eso
   * emitirla y revocarla no van con «editar credenciales»: son dos llaves
   * aparte que de fábrica solo tiene el administrador (punto 12.2).
   *
   * Lo que se comprueba acá es que el servidor lo haga cumplir, no que el
   * botón no se dibuje: quien sabe la dirección puede llamarla igual.
   */
  const cuerpoDelPastor = `31${String(Date.now()).slice(-6)}`;
  const rutDelPastor = `${cuerpoDelPastor}-${require('../server/rut').digitoVerificador(cuerpoDelPastor)}`;
  const elPastor = await api('POST', '/api/usuarios', {
    rut: rutDelPastor, nombre: 'Pastor De Prueba', rol: 'pastor', activo: 1, password: 'Cordillera47',
  });
  if (!(elPastor.datos && elPastor.datos.id)) {
    revisar('se pudo crear el usuario con rol de pastor', false, JSON.stringify(elPastor.datos).slice(0, 140));
  } else {
    await api('PUT', `/api/usuarios/${elPastor.datos.id}`, { ...elPastor.datos, debe_cambiar_password: 0 });
    const comoPastor = await entrar(rutDelPastor, 'Cordillera47');

    // Ve las credenciales: es lo que le toca de fábrica
    const lasVe = await comoPastor('GET', '/api/credenciales');
    revisar('un pastor ve las credenciales', lasVe.estado === 200, `respondió ${lasVe.estado}`);

    // Pero no puede emitir ni revocar aunque llame la dirección a mano
    const algunaSuya = (lasVe.datos.rows || [])[0];
    if (!algunaSuya) {
      console.log('   ℹ️  no hay ninguna credencial con la que probar emitir y revocar');
    } else {
      const emitir = await comoPastor('POST', `/api/credenciales/${algunaSuya.id}/emitir`);
      revisar('pero no puede emitir', emitir.estado === 403, `respondió ${emitir.estado}`);
      const revocar = await comoPastor('POST', `/api/credenciales/${algunaSuya.id}/revocar`, { motivo: 'probando' });
      revisar('ni revocar', revocar.estado === 403, `respondió ${revocar.estado}`);
    }

    // Y una credencial ya emitida no se borra ni siendo administrador (punto 10.2)
    const emitida = (await api('GET', '/api/credenciales?limit=50')).datos.rows
      .find((c) => c.estado && c.estado !== 'Borrador');
    if (emitida) {
      const borrar = await api('DELETE', `/api/credenciales/${emitida.id}`);
      revisar('una credencial emitida no se puede eliminar', borrar.estado === 400,
        `respondió ${borrar.estado}: ${JSON.stringify(borrar.datos).slice(0, 120)}`);
      const sigueAhi = await api('GET', `/api/credenciales/${emitida.id}`);
      revisar('y sigue estando', sigueAhi.estado === 200, `respondió ${sigueAhi.estado}`);
    }

    await api('DELETE', `/api/usuarios/${elPastor.datos.id}`);
  }

  const cuerpoDelSecre = `32${String(Date.now()).slice(-6)}`;
  const rutDelSecre = `${cuerpoDelSecre}-${require('../server/rut').digitoVerificador(cuerpoDelSecre)}`;
  const elSecre = await api('POST', '/api/usuarios', {
    rut: rutDelSecre, nombre: 'Secretario De Prueba', rol: 'secretario', activo: 1, password: 'Cordillera47',
  });
  if (elSecre.datos && elSecre.datos.id) {
    await api('PUT', `/api/usuarios/${elSecre.datos.id}`, { ...elSecre.datos, debe_cambiar_password: 0 });
    const comoSecre = await entrar(rutDelSecre, 'Cordillera47');
    const nada = await comoSecre('GET', '/api/credenciales');
    // El punto 12.3: fuera del administrador y del pastor, nadie entra al módulo
    revisar('un secretario no entra al módulo de credenciales', nada.estado === 403,
      `respondió ${nada.estado}`);
    await api('DELETE', `/api/usuarios/${elSecre.datos.id}`);
  } else {
    revisar('se pudo crear el usuario con rol de secretario', false, JSON.stringify(elSecre.datos).slice(0, 140));
  }

  /* 4k · Los paneles de la ficha de un cuerpo ---------------------------- */
  console.log('\n4k · Cada panel de la ficha de un cuerpo pide SU permiso');
  // Los paneles se pintan dentro de la ficha del cuerpo y por eso pedían solo
  // «Cuerpos → ver». Con eso, a quien se le quitaba Integrantes de Cuerpos los
  // seguía viendo completos: el permiso estaba en el editor y no servía de nada.
  if (!cuerpoConPlata.length) {
    console.log('   ⚠️  hace falta un cuerpo para probar esta parte');
  } else {
    const c = String(11000000 + (Date.now() % 900000));
    const suRut = `${c}-${require('../server/rut').digitoVerificador(c)}`;
    const recortado = await api('POST', '/api/usuarios', {
      rut: suRut, nombre: 'Prueba Sin Paneles', password: 'Manzanares82', rol: 'secretario', activo: 1,
      permisos: { integrantes_cuerpo: [], cuotas_cuerpo: [] },
    });
    if (recortado.estado === 201 || recortado.estado === 200) {
      const primera = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82' }),
      }).then((r) => r.json());
      await fetch(`${URL}/api/auth/cambiar-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${primera.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: 'Manzanares82', nueva: 'Manzanares82Otra' }),
      });
      const suya = await fetch(`${URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: suRut, password: 'Manzanares82Otra' }),
      }).then((r) => r.json());
      const comoEl = (r) => fetch(URL + r, { headers: { Authorization: `Bearer ${suya.token}` } })
        .then(async (x) => ({ estado: x.status, datos: await x.json().catch(() => ({})) }));

      const cid = cuerpoConPlata[0].id;
      const susIntegrantes = await comoEl(`/api/cuerpos/${cid}/integrantes`);
      revisar('sin Integrantes de Cuerpos, el panel de la gente no se entrega',
        susIntegrantes.estado === 403, `respondió ${susIntegrantes.estado}`);
      const susCuotas = await comoEl(`/api/cuerpos/${cid}/cuotas`);
      revisar('sin Cuotas de Cuerpos, la planilla de cuotas tampoco',
        susCuotas.estado === 403, `respondió ${susCuotas.estado}`);
      const elCumplimiento = await comoEl(`/api/cuerpos/${cid}/cumplimiento`);
      revisar('pero el cuerpo en sí lo sigue viendo, que es lo suyo',
        elCumplimiento.estado === 200, `respondió ${elCumplimiento.estado}`);

      await api('DELETE', `/api/usuarios/${recortado.datos.id}`);
    } else {
      revisar('se pudo crear la cuenta recortada', false, `respondió ${recortado.estado}`);
    }
  }

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
      password: 'Cordillera47', cuerpos: [cuerpos[0].id],
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
      const suyo = await entrar(rutSuyo, 'Cordillera47');
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

  /* 7 · Pasar lista: solo a los convocados ---------------------------------- */
  console.log('\n7 · Pasar lista');
  /**
   * La comprobación de «solo los suyos» existía, pero corría dentro de un
   * `if (tiene cuerpos asignados)`: a la cuenta de administrador —que no tiene
   * ninguno, a propósito— no se le comprobaba nada. Se podía marcar presente a
   * alguien de otra iglesia, y hasta al miembro número 999999, que no existe:
   * la fila quedaba guardada y sumaba en el porcentaje de asistencia.
   */
  const actividades = (await api('GET', '/api/asistencias?page=1&limit=1')).datos.rows || [];
  if (actividades.length) {
    const actividad = actividades[0];
    const antesDeTodo = (await api('GET', '/api/asistencia_detalle?page=1&limit=1')).datos.total;

    const fantasma = await api('POST', `/api/asistencias/${actividad.id}/lista`, {
      marcas: [{ miembro_id: 999999, estado: 'Presente' }],
    });
    revisar('no se puede marcar presente a alguien que no existe', fantasma.estado >= 400,
      `respondió ${fantasma.estado}`);

    // Alguien real, pero de ningún cuerpo convocado a esta actividad
    const todosLosMiembros = (await api('GET', '/api/miembros?page=1&limit=200')).datos.rows || [];
    const dentro = new Set(((await api('GET', `/api/asistencias/${actividad.id}/lista`)).datos.personas || []).map((p) => p.miembro_id || p.id));
    const fuera = todosLosMiembros.find((m) => !dentro.has(m.id));
    if (fuera) {
      const colado = await api('POST', `/api/asistencias/${actividad.id}/lista`, {
        marcas: [{ miembro_id: fuera.id, estado: 'Presente' }],
      });
      revisar('ni a quien no está en ninguno de los cuerpos convocados', colado.estado >= 400,
        `respondió ${colado.estado}`);
      revisar('y el aviso dice de quién se trata',
        colado.estado >= 400 && /[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}/.test(String(colado.datos.error || '')),
        String(colado.datos.error || '').slice(0, 80));
    }

    const despues = (await api('GET', '/api/asistencia_detalle?page=1&limit=1')).datos.total;
    revisar('y ninguna de esas marcas quedó guardada', despues === antesDeTodo,
      `marcas: ${antesDeTodo} → ${despues}`);
  } else {
    console.log('   ℹ️  no hay ninguna actividad con la que probar');
  }

  /* 8 · Los números que no se repiten -------------------------------------- */
  console.log('\n8 · Los números de los documentos que se emiten');
  // Un certificado y una credencial son documentos numerados que salen de la
  // iglesia con firma: su número debería identificarlos. A ninguno de los dos
  // se le había puesto la marca de único, así que se podían emitir dos con el
  // mismo número, para dos personas distintas, y nada lo decía.
  const iglesiaDelNumero = (await api('GET', '/api/iglesias?page=1&limit=1')).datos.rows[0];
  if (iglesiaDelNumero) {
    const numero = `PRUEBA-${Date.now()}`;
    const base = {
      numero, tipo: 'Bautismo', iglesia_id: iglesiaDelNumero.id,
      nombre_titular: 'Titular de prueba', fecha_emision: '2026-01-10',
      // Con la fecha del evento: desde la v1.297.0, un certificado cuyo texto
      // nombra el día no se emite sin él (CE-06), y el de bautismo lo nombra
      fecha_evento: '2026-01-05',
    };
    const primero = await api('POST', '/api/certificados', base);
    if (primero.estado === 201 || primero.estado === 200) {
      const repetido = await api('POST', '/api/certificados', { ...base, nombre_titular: 'Otra persona' });
      revisar('no se pueden emitir dos certificados con el mismo número', repetido.estado === 400,
        `respondió ${repetido.estado}`);

      const enMinusculas = await api('POST', '/api/certificados', { ...base, numero: numero.toLowerCase(), nombre_titular: 'Otra' });
      revisar('ni cambiándole las mayúsculas', enMinusculas.estado === 400, `respondió ${enMinusculas.estado}`);

      // Y corregirle algo al primero, sin tocar su número, tiene que poder hacerse
      const guardado = (await api('GET', `/api/certificados/${primero.datos.id}`)).datos;
      const corregir = await api('PUT', `/api/certificados/${primero.datos.id}`, {
        ...guardado, nombre_titular: 'Titular corregido',
      });
      revisar('pero corregir el que ya está no choca consigo mismo', corregir.estado === 200,
        `respondió ${corregir.estado}: ` + JSON.stringify(corregir.datos).slice(0, 100));

      await api('DELETE', `/api/certificados/${primero.datos.id}`);
    } else {
      revisar('se pudo emitir un certificado de prueba', false, `respondió ${primero.estado}`);
    }
  }

  /* 9 · Quien solo mira, no escribe en el disco ----------------------------- */
  console.log('\n9 · Subir archivos');
  // La subida pedía sesión y nada más, así que un usuario de «solo consulta»
  // —que no puede crear ni un registro— podía escribir en el volumen. Se
  // comprobó y respondía 200. Ahora se le pregunta si tiene dónde adjuntarlo.
  const nMirón = String(19000000 + Math.floor(Math.random() * 900000));
  const rutMirón = `${nMirón}-${require('../server/rut').digitoVerificador(nMirón)}`;
  const mirón = await api('POST', '/api/usuarios', {
    rut: rutMirón, nombre: 'Solo Mira', rol: 'consulta', activo: 1, password: 'Cordillera47',
  });
  if (mirón.datos && mirón.datos.id) {
    await api('PUT', `/api/usuarios/${mirón.datos.id}`, { ...mirón.datos, debe_cambiar_password: 0 });
    const pase = await fetch(`${URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: rutMirón, password: 'Cordillera47' }),
    }).then((r) => r.json());

    // Una foto de verdad: lo que se prueba es el permiso, no el formato
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048)]);
    const subir = async (token) => {
      const fd = new FormData();
      fd.append('archivo', new Blob([bytes], { type: 'image/jpeg' }), 'prueba.jpg');
      return fetch(`${URL}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    };

    const delMirón = await subir(pase.token);
    revisar('quien solo puede mirar no puede subir archivos', delMirón.status === 403,
      `respondió ${delMirón.status}`);

    const paseAdmin = await fetch(`${URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: RUT, password: CLAVE }),
    }).then((r) => r.json());
    const delQuePuede = await subir(paseAdmin.token);
    revisar('y quien sí tiene dónde adjuntarlos, sí', delQuePuede.status === 200,
      `respondió ${delQuePuede.status}`);

    await api('DELETE', `/api/usuarios/${mirón.datos.id}`);
  } else {
    revisar('se pudo crear el usuario de solo consulta', false, JSON.stringify(mirón.datos).slice(0, 140));
  }

  /* 10 · Una dirección rara no tumba el sistema ---------------------------- */
  console.log('\n10 · Direcciones raras');
  /*
   * Lo que va después del «?» lo escribe cualquiera. Hasta la 1.96.3, dos
   * formas de escribirlo mal daban error 500 en TODOS los listados:
   *
   *   ?q=a&q=b                      la misma clave repetida llegaba como lista
   *   ?page=9999999999999999999     el desplazamiento dejaba de ser un entero
   *                                 exacto y la base lo rechazaba
   *
   * No filtraban nada, pero cualquiera con sesión dejaba a los demás sin
   * listados escribiendo una dirección a mano. Acá se comprueba que ahora
   * responden como corresponde, y que la repetida vale la PRIMERA: si valiera
   * la última, la pantalla y el servidor entenderían distinto la misma
   * dirección.
   */
  const RAREZAS = [
    ['la misma clave repetida', '/api/miembros?q=a&q=b'],
    ['un filtro repetido', '/api/miembros?f_estado=Activo&f_estado=X'],
    ['corchetes en la clave', '/api/miembros?f_estado%5Bx%5D=1'],
    ['fechas repetidas', '/api/miembros?desde=2020-01-01&desde=2021-01-01'],
    ['un número de página imposible', '/api/miembros?page=9999999999999999999'],
    ['una página negativa', '/api/miembros?page=-5'],
    ['un límite imposible', '/api/miembros?limit=9999999999999999999'],
    ['orden y sentido repetidos', '/api/miembros?sort=nombres&sort=x&dir=asc&dir=x'],
    ['una clave llamada __proto__', '/api/miembros?__proto__=roto'],
    ['la planilla con la clave repetida', '/api/miembros/planilla?q=a&q=b'],
    ['el buscador con la clave repetida', '/api/buscar?q=a&q=b'],
    ['el resumen de tesorería repetido', '/api/tesoreria/resumen?desde=a&desde=b'],
  ];
  let seCayo = 0;
  for (const [queEs, ruta] of RAREZAS) {
    // `token` ya viene con el «Bearer» puesto (ver tokenDe): agregárselo otra
    // vez daba un 401, y la comprobación pasaba sin haber probado nada.
    const r = await fetch(`${URL}${ruta}`, { headers: { Authorization: token } });
    if (r.status >= 500) { seCayo++; console.log(`      ${queEs}: respondió ${r.status}`); }
  }
  revisar('ninguna dirección rara deja al sistema con avería', seCayo === 0,
    `${seCayo} de ${RAREZAS.length} respondieron con error del servidor`);

  // Y que la repetida signifique lo mismo que la simple, no otra cosa
  const conUna = await api('GET', '/api/miembros?q=Muñoz');
  const conDos = await api('GET', '/api/miembros?q=Muñoz&q=Zúñiga');
  revisar('una clave repetida vale la primera, como en el navegador',
    conUna.datos && conDos.datos && conUna.datos.total === conDos.datos.total,
    `sola dio ${conUna.datos && conUna.datos.total} y repetida ${conDos.datos && conDos.datos.total}`);

  /* 11 · El archivo del sistema anterior ---------------------------------- */
  /*
   * El volcado del sistema anterior es una copia entera de los datos de todos
   * —nombres, RUT, teléfonos, direcciones— guardada como un archivo suelto
   * junto a la base. Terminado el traspaso no sirve para nada, y desde la
   * 1.97.5 la pantalla ofrece sacarlo. Acá se comprueba lo que importa de esa
   * puerta: que la abra solo quien tiene la llave del traspaso.
   */
  console.log('\n11 · El archivo del sistema anterior');
  const nCurioso = String(19000000 + Math.floor(Math.random() * 900000));
  const rutCurioso = `${nCurioso}-${require('../server/rut').digitoVerificador(nCurioso)}`;
  const curioso = await api('POST', '/api/usuarios', {
    rut: rutCurioso, nombre: 'Sin Traspaso', rol: 'consulta', activo: 1, password: 'Cordillera47',
  });
  if (curioso.datos && curioso.datos.id) {
    await api('PUT', `/api/usuarios/${curioso.datos.id}`, { ...curioso.datos, debe_cambiar_password: 0 });
    const pase = await fetch(`${URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: rutCurioso, password: 'Cordillera47' }),
    }).then((r) => r.json());
    const conElPase = (metodo, token) => fetch(`${URL}/api/importacion/origen`, {
      method: metodo, headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const suyo = await conElPase('DELETE', pase.token);
    revisar('quien no tiene la llave del traspaso no puede sacar el archivo',
      suyo.status === 403, `respondió ${suyo.status}`);

    const mirar = await fetch(`${URL}/api/importacion/estado`, {
      headers: { Authorization: `Bearer ${pase.token}` },
    });
    revisar('ni puede siquiera preguntar si el archivo está', mirar.status === 403,
      `respondió ${mirar.status}`);

    await api('DELETE', `/api/usuarios/${curioso.datos.id}`);
  } else {
    revisar('se pudo crear el usuario sin llave de traspaso', false,
      JSON.stringify(curioso.datos).slice(0, 140));
  }

  const sinSesión = await fetch(`${URL}/api/importacion/origen`, { method: 'DELETE' });
  revisar('y sin sesión, menos', sinSesión.status === 401, `respondió ${sinSesión.status}`);

  /*
   * Que sacarlo no se lleve por delante nada más. Esta comprobación BORRA, así
   * que primero se mira si hay archivo: si lo hay, no se toca —esta prueba
   * corre contra un servidor andando y ese archivo puede ser el de verdad, que
   * no se recupera—. Cuando no lo hay, la ruta contesta «ya no estaba» sin
   * borrar nada y sirve igual para lo que se quiere probar: que la respuesta
   * sea 200 y que los datos del sistema queden donde estaban.
   */
  const estadoDelTraspaso = await api('GET', '/api/importacion/estado');
  if (estadoDelTraspaso.datos && estadoDelTraspaso.datos.origen) {
    console.log('   ⏭️  hay un volcado en el servidor: no se toca (podría ser el de verdad)');
  } else {
    const antesDeSacar = await api('GET', '/api/miembros?page=1&pageSize=1');
    const sacar = await api('DELETE', '/api/importacion/origen');
    const despuesDeSacar = await api('GET', '/api/miembros?page=1&pageSize=1');
    revisar('sacar el archivo no toca los datos del sistema',
      sacar.estado === 200
        && antesDeSacar.datos && despuesDeSacar.datos
        && antesDeSacar.datos.total === despuesDeSacar.datos.total,
      `respondió ${sacar.estado}; había ${antesDeSacar.datos && antesDeSacar.datos.total} `
      + `y quedaron ${despuesDeSacar.datos && despuesDeSacar.datos.total} miembros`);
  }

  /* 12 · Mandar mensajes a máquina ------------------------------------- */
  console.log('\n12 · El ritmo de los mensajes');
  /*
   * El aviso de un mensaje escrito a mano no se puede apagar en la campanita
   * —a propósito, porque quien lo manda no tiene acuse de recibo—, así que una
   * cuenta descuidada o robada puede llenar una campanita que nadie puede
   * silenciar. Medido antes del tope: veinticinco mensajes urgentes seguidos a
   * la misma persona salieron todos en 85 ms.
   *
   * Va al final de esta prueba a propósito: gasta el tope de la cuenta con que
   * se corre, y lo que viene después ya no manda mensajes.
   */
  const rafaga = `Ráfaga ${Date.now()}`;
  const aQuien = await api('GET', '/api/avisos/mensajes/destinatarios');
  if (aQuien.estado !== 200 || !(aQuien.datos.personas || []).length) {
    revisar('el tope de mensajes por hora frena la ráfaga', false,
      `no se pudo preguntar a quién escribirle: ${aQuien.estado}`);
  } else {
    const aUno = [aQuien.datos.personas[0].id];
    let salieron = 0;
    let frenados = 0;
    for (let i = 0; i < 25; i++) {
      const r = await api('POST', '/api/avisos/mensajes', {
        titulo: `${rafaga} ${i}`, cuerpo: 'x', destino: 'personas', valor: aUno, urgente: true,
      });
      if (r.estado === 201) salieron++;
      if (r.estado === 429) frenados++;
    }
    revisar('el tope de mensajes por hora frena la ráfaga',
      frenados > 0 && salieron < 25, `salieron ${salieron} de 25 y se frenaron ${frenados}`);

    const ultimo = await api('POST', '/api/avisos/mensajes', {
      titulo: `${rafaga} uno más`, cuerpo: 'x', destino: 'personas', valor: aUno,
    });
    revisar('y se dice cuánto falta, en vez de un «no» a secas',
      ultimo.estado === 429 && /Puede mandar otro en/.test((ultimo.datos || {}).error || ''),
      `respondió ${ultimo.estado}: ${JSON.stringify(ultimo.datos).slice(0, 140)}`);
  }

  /* 13 · La dirección del aparato y el aviso de prueba ------------------ */
  console.log('\n13 · Los aparatos enganchados');
  /*
   * La dirección de un aparato la manda el navegador y el servidor le escribe
   * ahí. Se guardaba sin mirarla, y con eso cualquier cuenta convertía al
   * servidor en su sonda. MEDIDO en la v1.335.0, desde una cuenta de rol
   * consulta: puerto abierto y puerto cerrado se distinguían en 6 ms, con la
   * respuesta escrita en el error. Y no había tope: 500 aparatos en 1,4 s y 40
   * avisos de prueba en 0,2 s.
   *
   * Va al final, como el de los mensajes y por lo mismo: gasta el tope de
   * pruebas por hora de la cuenta con que se corre.
   */
  const llavesDeMentira = {
    p256dh: require('crypto').randomBytes(65).toString('base64url'),
    auth: require('crypto').randomBytes(16).toString('base64url'),
  };
  const enganchar = (endpoint) => api('POST', '/api/avisos/aparato', { suscripcion: { endpoint, keys: llavesDeMentira } });

  const aDentro = await enganchar('https://127.0.0.1:4399/interno/panel');
  revisar('no se puede enganchar un aparato que apunta al propio servidor',
    aDentro.estado === 400 && /https|red interna/.test((aDentro.datos || {}).error || ''),
    `respondió ${aDentro.estado}: ${JSON.stringify(aDentro.datos).slice(0, 160)}`);

  const aLaRedInterna = await enganchar('https://192.168.1.1/x');
  revisar('ni uno que apunta a la red de la oficina',
    aLaRedInterna.estado === 400,
    `respondió ${aLaRedInterna.estado}: ${JSON.stringify(aLaRedInterna.datos).slice(0, 160)}`);

  const sinCifrar = await enganchar('http://push.example.com/x');
  revisar('ni uno sin cifrar',
    sinCifrar.estado === 400,
    `respondió ${sinCifrar.estado}: ${JSON.stringify(sinCifrar.datos).slice(0, 160)}`);

  const cuantosQuedaron = await api('GET', '/api/avisos/preferencias');
  revisar('y ninguno de los tres quedó guardado',
    cuantosQuedaron.estado === 200 && cuantosQuedaron.datos.aparatos === 0,
    `el sistema dice que hay ${(cuantosQuedaron.datos || {}).aparatos} aparato(s)`);

  /*
   * Sin ningún aparato enganchado, el aviso de prueba contesta 400 —«no hay
   * ningún aparato»— sin salir a hablar con nadie. Sirve igual para contar: lo
   * que se mira es cuándo aparece el 429.
   */
  let atendidas = 0;
  let frenadas = 0;
  let elFreno = null;
  for (let i = 0; i < 12; i++) {
    const r = await api('POST', '/api/avisos/probar', {});
    if (r.estado === 429) { frenadas++; elFreno = elFreno || r.datos; } else { atendidas++; }
  }
  revisar('el aviso de prueba tiene tope por hora',
    frenadas > 0 && atendidas < 12, `se atendieron ${atendidas} de 12 y se frenaron ${frenadas}`);
  revisar('y también dice cuánto falta',
    !!elFreno && /Puede pedir otro en/.test(elFreno.error || ''),
    `el freno decía: ${JSON.stringify(elFreno).slice(0, 160)}`);

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
