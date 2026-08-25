/**
 * Prueba de convivencia: varias personas trabajando sobre lo mismo.
 *
 * La prueba de carga mide si el sistema responde rápido con mucha gente
 * adentro. Esta mira lo otro, que importa igual: que cuando dos trabajan sobre
 * la misma ficha, ninguno pierda lo que hizo.
 *
 * Comprueba cuatro cosas:
 *
 *   1. Dos personas editando la misma ficha: la segunda recibe un aviso y lo
 *      guardado por la primera sigue ahí. No se pisa en silencio.
 *   2. Quien decide insistir, guarda: se le respeta su versión.
 *   3. Un guardado que el sistema rechaza no deja nada a medias.
 *   4. Veinte fichas creadas en el mismo instante quedan las veinte, cada una
 *      con su número, sin repetirse ni perderse.
 *   5. Dos secretarios pasando la misma lista: las marcas de los dos quedan.
 *      Cada uno manda solo lo que él marcó, y el guardado le devuelve cómo
 *      quedó la lista para que vea lo del otro.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run concurrencia
 *   URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=… npm run concurrencia
 */
const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';
const { hoy, alinearConElServidor } = require('./hoy');

let fallas = 0;

function revisar(loQueSeEspera, condicion, detalle) {
  if (condicion) {
    console.log(`   ✅ ${loQueSeEspera}`);
  } else {
    fallas++;
    console.log(`   ❌ ${loQueSeEspera}${detalle ? `\n      ${detalle}` : ''}`);
  }
}

async function entrar() {
  const r = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut: RUT, password: CLAVE }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`No se pudo entrar con ${RUT}: ${d.error || 'sin token'}`);
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
  console.log(`🤝 Prueba de convivencia contra ${URL}\n`);
  const ana = await entrar(); // dos sesiones distintas, como dos personas
  const luis = await entrar();

  const iglesias = (await ana('GET', '/api/iglesias?page=1&limit=1')).datos;
  const iglesiaId = iglesias.rows && iglesias.rows[0] && iglesias.rows[0].id;
  if (!iglesiaId) {
    console.log('❌ No hay ninguna iglesia registrada: sin eso no hay nada sobre lo que probar.');
    process.exit(1);
  }

  /**
   * La ficha con la que se trabaja la crea la propia prueba.
   *
   * Antes tomaba «la primera que hubiera», y eso la hacía depender de con qué
   * se encontrara: una ficha con cónyuge pastor, por ejemplo, no se deja
   * guardar hasta resolver el trato de los dos, y la prueba fallaba ocho
   * veces por algo que no tenía nada que ver con lo que quería comprobar.
   * Creando la suya, comprueba lo que dice comprobar.
   */
  const sufijo = String(Date.now()).slice(-6);
  const rutDePrueba = (() => {
    const cuerpo = `19${sufijo}`;
    return `${cuerpo}-${require('../server/rut').digitoVerificador(cuerpo)}`;
  })();
  const creada = await ana('POST', '/api/miembros', {
    iglesia_id: iglesiaId, rut: rutDePrueba, nombres: 'Ficha', apellidos: 'De Concurrencia',
    genero: 'Femenino', estado: 'Activo',
  });
  const id = creada.datos && creada.datos.id;
  if (!id) {
    console.log(`❌ No se pudo crear la ficha de prueba: ${JSON.stringify(creada.datos).slice(0, 160)}`);
    process.exit(1);
  }

  /* 1 · Dos personas editando la misma ficha ------------------------------ */
  console.log('1 · Dos personas editan la misma ficha');
  // Valores distintos en cada corrida: así lo que se comprueba es lo de ahora
  // y no lo que dejó escrito la vez pasada.
  const sello = Date.now();
  const telefonoDeAna = `+569${String(sello).slice(-8)}`;
  const direccionDeLuis = `Calle de Luis ${sello}`;
  const paraAna = (await ana('GET', `/api/miembros/${id}`)).datos;
  const paraLuis = (await luis('GET', `/api/miembros/${id}`)).datos; // los dos la abren

  const guardoAna = await ana('PUT', `/api/miembros/${id}`, { ...paraAna, telefono: telefonoDeAna });
  revisar('Ana guarda su cambio', guardoAna.estado === 200, JSON.stringify(guardoAna.datos).slice(0, 200));

  const guardoLuis = await luis('PUT', `/api/miembros/${id}`, { ...paraLuis, direccion: direccionDeLuis });
  revisar('a Luis se le avisa en vez de dejarlo pisar el cambio de Ana', guardoLuis.estado === 409);
  revisar(
    'el aviso dice qué pasó y trae la ficha como quedó',
    !!(guardoLuis.datos.conflicto && guardoLuis.datos.actual && guardoLuis.datos.error),
    JSON.stringify(guardoLuis.datos).slice(0, 200)
  );

  const despues = (await ana('GET', `/api/miembros/${id}`)).datos;
  revisar('lo que guardó Ana sigue ahí', despues.telefono === telefonoDeAna, `quedó "${despues.telefono}"`);
  revisar('lo de Luis no se guardó a medias', despues.direccion !== direccionDeLuis);

  /* 1b · Y también cuando los dos guardan dentro del mismo segundo -------- */
  console.log('\n1b · Los dos guardan dentro del mismo segundo');
  // Este es el caso que de verdad ocurre: dos personas apretando Guardar casi
  // a la vez. Durante un tiempo NO se detectaba, porque la marca de versión se
  // deducía de la hora del último guardado, que se escribe con precisión de un
  // segundo: dos guardados en el mismo segundo dejaban la misma marca y el
  // segundo le borraba el trabajo al primero sin decir nada. La prueba de más
  // arriba no lo veía porque siempre trabajaba sobre una ficha vieja.
  const cuerpoRut = `17${sufijo}`.slice(0, 8);
  const otra = await ana('POST', '/api/miembros', {
    iglesia_id: iglesiaId, rut: `${cuerpoRut}-${require('../server/rut').digitoVerificador(cuerpoRut)}`,
    nombres: 'Mismo', apellidos: 'Segundo', genero: 'Masculino', estado: 'Activo',
  });
  if (otra.datos && otra.datos.id) {
    const suId = otra.datos.id;
    const abierta = (await ana('GET', `/api/miembros/${suId}`)).datos; // los dos abren lo mismo
    const primero = await ana('PUT', `/api/miembros/${suId}`, { ...abierta, telefono: '+56911112222' });
    const segundo = await luis('PUT', `/api/miembros/${suId}`, { ...abierta, direccion: 'Calle del mismo segundo' });
    revisar('el primero guarda', primero.estado === 200, JSON.stringify(primero.datos).slice(0, 120));
    revisar(
      'y al segundo se le avisa aunque haya sido en el mismo segundo',
      segundo.estado === 409,
      `respondió ${segundo.estado}: sin esto, le borra el trabajo al primero sin decir nada`
    );
    const comoQuedo = (await ana('GET', `/api/miembros/${suId}`)).datos;
    revisar('y lo del primero no se perdió', comoQuedo.telefono === '+56911112222', `quedó "${comoQuedo.telefono}"`);
    await ana('DELETE', `/api/miembros/${suId}`);
  } else {
    revisar('se pudo crear la ficha para probar el mismo segundo', false, JSON.stringify(otra.datos).slice(0, 140));
  }

  /* 2 · Luis mira cómo quedó e insiste ------------------------------------ */
  console.log('\n2 · Luis mira cómo quedó y decide guardar lo suyo igual');
  const alDia = (await luis('GET', `/api/miembros/${id}`)).datos;
  const insiste = await luis('PUT', `/api/miembros/${id}`, { ...alDia, direccion: direccionDeLuis });
  revisar('ahora sí guarda', insiste.estado === 200);
  const final = (await ana('GET', `/api/miembros/${id}`)).datos;
  revisar('queda su dirección', final.direccion === direccionDeLuis);
  revisar('y el teléfono que puso Ana no se perdió', final.telefono === telefonoDeAna);

  /* 3 · Un guardado rechazado no deja nada a medias ------------------------ */
  console.log('\n3 · Un guardado que el sistema rechaza no deja rastro');
  // El módulo de Pastores no admite dos Pastores Presidentes: se asegura que
  // haya uno para que el segundo tenga que ser rechazado.
  const presidente = (await ana('GET', '/api/pastores?f_cargo=Pastor%20Presidente&limit=1')).datos;
  let creadoParaLaPrueba = null;
  if (!presidente.total) {
    const r = await ana('POST', '/api/pastores', {
      nombres: 'Presidente', apellidos: 'De Prueba', cargo: 'Pastor Presidente', iglesia_id: iglesiaId,
    });
    creadoParaLaPrueba = r.datos && r.datos.id;
  }

  const antes = (await ana('GET', '/api/pastores?page=1&limit=1')).datos.total;
  const rechazado = await ana('POST', '/api/pastores', {
    nombres: 'Segundo', apellidos: 'Presidente', cargo: 'Pastor Presidente', iglesia_id: iglesiaId,
  });
  const ahora = (await ana('GET', '/api/pastores?page=1&limit=1')).datos.total;
  revisar(
    'se rechaza con su explicación',
    rechazado.estado === 400 && !!rechazado.datos.error,
    JSON.stringify(rechazado.datos).slice(0, 200)
  );
  revisar('y no quedó ninguna ficha a medio crear', ahora === antes, `antes ${antes}, ahora ${ahora}`);
  if (creadoParaLaPrueba) await ana('DELETE', `/api/pastores/${creadoParaLaPrueba}`);

  /* 4 · Veinte creaciones en el mismo instante ---------------------------- */
  console.log('\n4 · Veinte fichas creadas en el mismo instante');
  const marca = `Convivencia ${Date.now()}`;
  const creadas = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      ana('POST', '/api/inventarios', {
        articulo: `${marca} ${i + 1}`, cantidad: 1, estado: 'Bueno', iglesia_id: iglesiaId,
      })
    )
  );
  const buenas = creadas.filter((c) => c.estado === 201);
  const ids = new Set(buenas.map((c) => c.datos.id));
  revisar(
    'las veinte se guardaron',
    buenas.length === 20,
    `se guardaron ${buenas.length}` + (buenas.length < 20 ? ` — ${JSON.stringify(creadas.find((c) => c.estado !== 201).datos).slice(0, 160)}` : '')
  );
  revisar('cada una con su propio número', ids.size === buenas.length);

  const quedaron = (await ana('GET', `/api/inventarios?q=${encodeURIComponent(marca)}&limit=200`)).datos;
  revisar('y las veinte están en el listado', quedaron.total === 20, `el listado trae ${quedaron.total}`);

  for (const c of buenas) await ana('DELETE', `/api/inventarios/${c.datos.id}`); // se limpia lo de la prueba

  /* 5 · Dos secretarios pasando la misma lista ---------------------------- */
  console.log('\n5 · Dos personas pasan la misma lista de asistencia');
  // Se trabaja sobre una actividad propia de la prueba, que se borra al final:
  // así no se toca ninguna asistencia de verdad.
  // El cuerpo y su gente también los crea la prueba, por lo mismo de antes:
  // tomar «el primer integrante que haya» la dejaba a merced de lo que
  // hubiera en la base, y sin nada cargado no probaba nada.
  const dv = require('../server/rut').digitoVerificador;
  const cuerpoDePrueba = await ana('POST', '/api/cuerpos', {
    iglesia_id: iglesiaId, nombre: `Cuerpo de concurrencia ${sufijo}`, tipo: 'Cuerpo', activo: 1,
  });
  const cuerpoId = cuerpoDePrueba.datos && cuerpoDePrueba.datos.id;
  const suGente = [];
  if (cuerpoId) {
    // Un RUT distinto por integrante: el número base cambia en cada corrida y
    // cada uno suma su lugar. (Antes se recortaba a ocho dígitos y salían los
    // quince iguales, así que solo entraba el primero.)
    const base = 18000000 + (Date.now() % 900000);
    for (let i = 0; i < 15; i++) {
      const num = String(base + i);
      const ficha = await ana('POST', '/api/miembros', {
        iglesia_id: iglesiaId, rut: `${num}-${dv(num)}`, nombres: `Integrante ${i + 1}`,
        apellidos: 'De Concurrencia', genero: i % 2 ? 'Femenino' : 'Masculino', estado: 'Activo',
      });
      if (!ficha.datos || !ficha.datos.id) continue;
      suGente.push(ficha.datos.id);
      await ana('POST', '/api/integrantes_cuerpo', {
        iglesia_id: iglesiaId, cuerpo_id: cuerpoId, miembro_id: ficha.datos.id,
        estado: 'Activo', fecha_ingreso: hoy(),
      });
    }
  }
  revisar('se pudo armar un cuerpo con gente para la prueba', suGente.length >= 13,
    `quedaron ${suGente.length} integrante(s)`);

  const actividad = cuerpoId
    ? await ana('POST', '/api/asistencias', {
        fecha: hoy(),
        tipo_reunion: 'Servicio General',
        cuerpos: [cuerpoId],
        nombre: `Prueba de convivencia ${Date.now()}`,
        iglesia_id: iglesiaId,
      })
    : null;
  const actId = actividad && actividad.datos && actividad.datos.id;

  if (!actId) {
    revisar('se pudo crear una actividad de prueba', false, JSON.stringify(actividad && actividad.datos).slice(0, 200));
  } else {
    const gente = (await ana('GET', `/api/asistencias/${actId}/lista`)).datos.personas;
    // Los dos abren la lista al mismo tiempo, los dos la ven en blanco
    const deLuis = gente.slice(0, 10);
    const deAna = gente.slice(10, 13);

    if (deAna.length < 3) {
      revisar('el cuerpo de prueba tiene gente suficiente', false, `solo ${gente.length} integrante(s)`);
    } else {
      // Luis marca lo suyo y guarda; manda SOLO lo que él marcó
      const g1 = await luis('POST', `/api/asistencias/${actId}/lista`, {
        marcas: deLuis.map((p) => ({ miembro_id: p.miembro_id, estado: 'Presente' })),
      });
      revisar('Luis marca a diez y los guarda', g1.estado === 200 && g1.datos.guardadas === 10);

      // Ana, con su pantalla de antes (todos en blanco), marca a otros tres
      const g2 = await ana('POST', `/api/asistencias/${actId}/lista`, {
        marcas: deAna.map((p) => ({ miembro_id: p.miembro_id, estado: 'Ausente' })),
      });
      revisar('Ana marca a otros tres y los guarda', g2.estado === 200 && g2.datos.guardadas === 3);

      const quedaron = (await ana('GET', `/api/asistencias/${actId}/lista`)).datos.personas.filter((p) => p.estado);
      const presentes = quedaron.filter((p) => p.estado === 'Presente').length;
      const ausentes = quedaron.filter((p) => p.estado === 'Ausente').length;
      revisar('las diez marcas de Luis siguen ahí', presentes === 10, `quedaron ${presentes} de 10`);
      revisar('y las tres de Ana también', ausentes === 3, `quedaron ${ausentes} de 3`);
      revisar(
        'al guardar, a Ana se le devuelve la lista al día para ver lo de Luis',
        Array.isArray(g2.datos.marcas) && g2.datos.marcas.filter((m) => m.estado === 'Presente').length === 10
      );

      // Y desmarcar sigue funcionando: es una decisión, no un descuido
      const desmarca = await ana('POST', `/api/asistencias/${actId}/lista`, {
        marcas: [{ miembro_id: deAna[0].miembro_id, estado: null }],
      });
      const trasDesmarcar = (await ana('GET', `/api/asistencias/${actId}/lista`)).datos.personas.filter((p) => p.estado);
      revisar(
        'quien desmarca a alguien a propósito, lo desmarca',
        desmarca.estado === 200 && trasDesmarcar.length === 12,
        `quedaron ${trasDesmarcar.length} marcas, se esperaban 12`
      );
    }
    await ana('DELETE', `/api/asistencias/${actId}`); // se limpia la actividad de la prueba
  }

  // Se recoge todo lo que la prueba creó: nada de esto es de la iglesia
  for (const m of suGente) await ana('DELETE', `/api/miembros/${m}`);
  if (cuerpoId) await ana('DELETE', `/api/cuerpos/${cuerpoId}`);
  await ana('DELETE', `/api/miembros/${id}`);

  console.log(
    fallas
      ? `\n❌ ${fallas} comprobación(es) fallaron.`
      : '\n✅ Varias personas pueden trabajar sobre lo mismo sin pisarse.'
  );
  process.exit(fallas ? 1 : 0);
})();
