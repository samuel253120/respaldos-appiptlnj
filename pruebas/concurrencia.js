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
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run concurrencia
 *   URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=… npm run concurrencia
 */
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
  console.log(`🤝 Prueba de convivencia contra ${URL}\n`);
  const ana = await entrar(); // dos sesiones distintas, como dos personas
  const luis = await entrar();

  // Una ficha cualquiera con la que trabajar
  const listado = await ana('GET', '/api/miembros?page=1&limit=1');
  const id = listado.datos.rows && listado.datos.rows[0] && listado.datos.rows[0].id;
  if (!id) {
    console.log('❌ No hay ningún miembro con el que probar. Cargue datos antes (PREPARAR=solo npm run carga).');
    process.exit(1);
  }
  const iglesias = (await ana('GET', '/api/iglesias?page=1&limit=1')).datos;
  const iglesiaId = iglesias.rows && iglesias.rows[0] && iglesias.rows[0].id;

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

  console.log(
    fallas
      ? `\n❌ ${fallas} comprobación(es) fallaron.`
      : '\n✅ Varias personas pueden trabajar sobre lo mismo sin pisarse.'
  );
  process.exit(fallas ? 1 : 0);
})();
