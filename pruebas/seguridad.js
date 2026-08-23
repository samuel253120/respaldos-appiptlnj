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

      const buscando = await comoElla('GET', `/api/miembros?q=${encodeURIComponent(numeroDePrueba.slice(-7))}`);
      revisar('ni puede dar con la persona buscando por su número',
        (buscando.datos.total || 0) === 0,
        `el buscador devolvió ${buscando.datos.total} resultado(s): el dato queda igual de expuesto`);
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
