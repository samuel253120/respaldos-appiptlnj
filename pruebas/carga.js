/**
 * Prueba de carga: varios usuarios trabajando al mismo tiempo.
 *
 * Simula a un grupo de personas usando el sistema a la vez —el panel, los
 * listados, abrir fichas, llenar selectores y guardar— y mide cuánto demora
 * cada cosa. Sirve para saber si el sistema responde con soltura cuando la
 * iglesia entera está adentro, no solo cuando entra uno.
 *
 * De cada tipo de petición informa:
 *
 *   · la mediana (la mitad de las veces demora menos que eso)
 *   · el percentil 95 (casi siempre demora menos que eso)
 *   · lo peor que se vio
 *   · cuántas fallaron
 *
 * Cómo se corre, con el sistema andando:
 *
 *   npm run carga
 *   USUARIOS=25 SEGUNDOS=20 npm run carga
 *   PREPARAR=1 npm run carga      (primero llena la base con datos de prueba)
 *   PREPARAR=solo npm run carga   (solo llena la base y termina)
 *   LIMPIAR=1 npm run carga       (dice qué datos de prueba hay, sin borrar)
 *   LIMPIAR=borrar npm run carga  (los borra)
 *
 * PREPARAR escribe 600 fichas de miembro, 12 cuerpos, 150 actividades y 3.000
 * movimientos de tesorería DIRECTO en la base, sin pasar por el sistema. Eso
 * antes solo estaba advertido acá, en un comentario que nadie tiene por qué
 * leer antes de escribir un comando; ahora está impedido: si la base tiene
 * fichas que esta prueba no generó, se niega a tocarla y explica qué hacer.
 *
 * Los datos que genera se reconocen: los RUT van del 30.000.000 en adelante
 * —un tramo que no está en uso—, los cuerpos se llaman «Cuerpo de prueba N» y
 * los movimientos «Movimiento de prueba N». Por ahí los encuentra LIMPIAR.
 */
const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';
const CLAVE = process.env.CLAVE || 'admin123';
const USUARIOS = Number(process.env.USUARIOS) || 12;
const SEGUNDOS = Number(process.env.SEGUNDOS) || 15;

/* ------------------------------------------------------------------ */
/* Datos de prueba                                                     */
/* ------------------------------------------------------------------ */

/**
 * Llena la base con un tamaño parecido al de una iglesia grande, para que la
 * medición diga algo. Solo agrega lo que falte para llegar a esos números.
 */
/**
 * Cómo se reconoce lo que generó esta prueba.
 *
 * Los RUT del tramo 30.000.000 en adelante no están en uso, así que ninguna
 * persona de verdad cae ahí. Los cuerpos y los movimientos llevan su nombre
 * escrito. Con esto se sabe qué es de la prueba y qué es de la iglesia.
 */
const SENAS = {
  miembros: "rut GLOB '3[0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*'",
  cuerpos: "nombre LIKE 'Cuerpo de prueba %'",
  tesoreria: "concepto LIKE 'Movimiento de prueba %'",
};

/** Cuántas fichas hay que esta prueba NO generó: son de alguien. */
function fichasDeVerdad(db) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM miembros WHERE NOT (${SENAS.miembros})`).get().c;
  } catch (e) {
    return 0; // si la tabla aún no existe, no hay nada de nadie
  }
}

/**
 * El seguro: esta prueba escribe cientos de fichas inventadas directo en la
 * base, y eso no puede pasarle a la base de una iglesia.
 *
 * Pasó: se llenó una base de trabajo con 600 fichas de mentira y durante
 * varios días se estuvo mirando esos números creyendo que eran los de la
 * iglesia. Un comentario en la cabecera no alcanzó, así que ahora se
 * comprueba de verdad.
 */
function exigirBaseDePruebas(db) {
  const reales = fichasDeVerdad(db);
  if (!reales) return;
  console.error(
    `\n⛔ Esta base tiene ${reales.toLocaleString('es-CL')} ficha(s) de miembro que esta prueba no generó.\n` +
      '   PREPARAR escribe 600 fichas inventadas, 12 cuerpos, 150 actividades y 3.000 movimientos\n' +
      '   directo en la base, así que no se toca una base con datos de alguien.\n\n' +
      '   Para medir con una base vacía:\n' +
      '     DATA_DIR=/tmp/carga node server/index.js     (en otra terminal)\n' +
      '     DATA_DIR=/tmp/carga PREPARAR=1 npm run carga\n\n' +
      '   Para medir sin preparar nada, sobre lo que ya haya:\n' +
      '     npm run carga\n'
  );
  process.exit(1);
}

/**
 * Dice qué datos de prueba hay en la base y, si se le pide, los borra.
 *
 * Por omisión solo mira y cuenta: borrar cientos de filas no es algo que
 * deba pasar porque alguien se equivocó de comando. Con LIMPIAR=borrar sí
 * borra, y solo lo que lleva las señas de arriba.
 */
function limpiarDatosDePrueba(deVerdad) {
  const { db } = require('../server/db');
  const cuenta = (sql, ...p) => {
    try {
      return db.prepare(sql).get(...p).c;
    } catch (e) {
      return 0;
    }
  };

  const hallazgos = {
    miembros: cuenta(`SELECT COUNT(*) AS c FROM miembros WHERE ${SENAS.miembros}`),
    cuerpos: cuenta(`SELECT COUNT(*) AS c FROM cuerpos WHERE ${SENAS.cuerpos}`),
    tesoreria: cuenta(`SELECT COUNT(*) AS c FROM tesoreria WHERE ${SENAS.tesoreria}`),
    integrantes_cuerpo: cuenta(
      `SELECT COUNT(*) AS c FROM integrantes_cuerpo WHERE miembro_id IN (SELECT id FROM miembros WHERE ${SENAS.miembros})`
    ),
    asistencia_detalle: cuenta(
      `SELECT COUNT(*) AS c FROM asistencia_detalle WHERE miembro_id IN (SELECT id FROM miembros WHERE ${SENAS.miembros})`
    ),
  };

  const total = Object.values(hallazgos).reduce((a, b) => a + b, 0);
  console.log('\n🔎 Datos de prueba encontrados en esta base:\n');
  for (const [tabla, cuantos] of Object.entries(hallazgos)) {
    console.log(`   ${tabla.padEnd(20)} ${cuantos.toLocaleString('es-CL').padStart(8)}`);
  }
  console.log(`   ${'─'.repeat(29)}`);
  console.log(`   ${'total'.padEnd(20)} ${total.toLocaleString('es-CL').padStart(8)}`);
  console.log(`\n   Fichas que NO son de la prueba (las de la iglesia): ${fichasDeVerdad(db).toLocaleString('es-CL')}\n`);

  if (!total) return;
  if (!deVerdad) {
    console.log('   No se borró nada. Para borrarlo:  LIMPIAR=borrar npm run carga');
    console.log('   Baje el respaldo antes, desde Configuración.\n');
    return;
  }

  const borrar = db.transaction(() => {
    db.prepare(
      `DELETE FROM asistencia_detalle WHERE miembro_id IN (SELECT id FROM miembros WHERE ${SENAS.miembros})`
    ).run();
    db.prepare(
      `DELETE FROM integrantes_cuerpo WHERE miembro_id IN (SELECT id FROM miembros WHERE ${SENAS.miembros})`
    ).run();
    db.prepare(`DELETE FROM tesoreria WHERE ${SENAS.tesoreria}`).run();
    db.prepare(`DELETE FROM miembros WHERE ${SENAS.miembros}`).run();
    // Los cuerpos al final: primero hay que sacarles la gente
    db.prepare(`DELETE FROM cuerpos WHERE ${SENAS.cuerpos}`).run();
  });
  borrar();
  console.log('   ✅ Borrado. Las actividades quedaron: no llevan seña propia y pueden ser suyas.');
  console.log('      Si las 150 «Servicio General» tampoco son suyas, bórrelas desde Asistencia.\n');
}

function prepararDatos() {
  const { db } = require('../server/db');
  const rut = require('../server/rut');
  const META = { miembros: 600, cuerpos: 12, actividades: 150, movimientos: 3000 };

  exigirBaseDePruebas(db); // nunca sobre la base de una iglesia

  const cuantos = (t) => db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  let iglesia = db.prepare('SELECT id FROM iglesias').get();
  if (!iglesia) {
    db.prepare("INSERT INTO iglesias (nombre, codigo) VALUES ('Iglesia de Prueba','IG-999')").run();
    iglesia = db.prepare('SELECT id FROM iglesias').get();
  }
  const ig = iglesia.id;

  const nombres = ['Ana', 'Luis', 'María', 'Pedro', 'Rosa', 'Juan', 'Elena', 'Carlos', 'Sofía', 'Miguel'];
  const apellidos = ['Soto', 'Pérez', 'González', 'Muñoz', 'Rojas', 'Díaz', 'Silva', 'Torres', 'Vargas', 'Fuentes'];
  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

  const llenar = db.transaction(() => {
    for (let i = cuantos('cuerpos'); i < META.cuerpos; i++) {
      db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id) VALUES (?, 'Cuerpo', ?)").run(`Cuerpo de prueba ${i + 1}`, ig);
    }
    const cuerpos = db.prepare('SELECT id FROM cuerpos').all().map((c) => c.id);

    let n = 30000000 + cuantos('miembros');
    for (let i = cuantos('miembros'); i < META.miembros; i++) {
      const num = n++;
      const info = db
        .prepare(
          `INSERT INTO miembros (nombres, apellidos, rut, genero, fecha_nacimiento, telefono, iglesia_id, estado)
           VALUES (?,?,?,?,?,?,?, 'Activo')`
        )
        .run(
          azar(nombres),
          `${azar(apellidos)} ${azar(apellidos)}`,
          `${num}-${rut.digitoVerificador(String(num))}`,
          Math.random() < 0.5 ? 'Femenino' : 'Masculino',
          `19${60 + (i % 40)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
          `+569${String(10000000 + i).slice(0, 8)}`,
          ig
        );
      db.prepare(
        `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado, fecha_ingreso, iglesia_id)
         VALUES (?,?, 'Activo', date('now','localtime'), ?)`
      ).run(azar(cuerpos), info.lastInsertRowid, ig);
    }
    const miembros = db.prepare('SELECT id FROM miembros').all().map((m) => m.id);

    for (let i = cuantos('asistencias'); i < META.actividades; i++) {
      const fecha = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const info = db
        .prepare(
          `INSERT INTO asistencias (fecha, tipo_reunion, cuerpos, iglesia_id) VALUES (?, 'Servicio General', ?, ?)`
        )
        .run(fecha, JSON.stringify([azar(cuerpos), azar(cuerpos)]), ig);
      const marca = db.prepare(
        `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, fecha, iglesia_id) VALUES (?,?,?,?,?)`
      );
      for (const m of miembros.slice(0, 200)) {
        marca.run(info.lastInsertRowid, m, Math.random() < 0.8 ? 'Presente' : 'Ausente', fecha, ig);
      }
    }

    const cuenta = db.prepare('SELECT id FROM cuentas_tesoreria').get();
    if (cuenta) {
      for (let i = cuantos('tesoreria'); i < META.movimientos; i++) {
        db.prepare(
          `INSERT INTO tesoreria (fecha, tipo, categoria, monto, concepto, cuenta_id, iglesia_id)
           VALUES (?,?,?,?,?,?,?)`
        ).run(
          new Date(Date.now() - (i % 700) * 86400000).toISOString().slice(0, 10),
          Math.random() < 0.6 ? 'Ingreso' : 'Egreso',
          'Ofrenda',
          Math.round(Math.random() * 200000),
          `Movimiento de prueba ${i + 1}`,
          cuenta.id,
          ig
        );
      }
    }
  });

  llenar();
  const resumen = ['miembros', 'cuerpos', 'integrantes_cuerpo', 'asistencias', 'asistencia_detalle', 'tesoreria']
    .map((t) => `${t}: ${cuantos(t).toLocaleString('es-CL')}`)
    .join(' · ');
  console.log(`📦 Datos de prueba listos — ${resumen}\n`);
}

/* ------------------------------------------------------------------ */
/* La medición                                                         */
/* ------------------------------------------------------------------ */

const medidas = new Map(); // nombre → { tiempos: [], fallos: n, choques: n }

function anotar(nombre, ms, fallo, choque) {
  let m = medidas.get(nombre);
  if (!m) medidas.set(nombre, (m = { tiempos: [], fallos: 0, choques: 0 }));
  m.tiempos.push(ms);
  if (fallo) m.fallos++;
  if (choque) m.choques++;
}

async function pedir(nombre, ruta, opciones = {}) {
  const partio = Date.now();
  let fallo = null;
  let choque = false;
  let cuerpo = null;
  try {
    const r = await fetch(URL + ruta, opciones);
    cuerpo = await r.json().catch(() => null);
    // Un 409 no es una falla: es el sistema impidiendo que uno le borre el
    // trabajo al otro. En esta prueba todos editan las mismas fichas a la vez,
    // así que se cuenta aparte.
    if (r.status === 409) choque = true;
    else if (!r.ok) fallo = `${r.status} ${(cuerpo && cuerpo.error) || ''}`.trim();
  } catch (e) {
    fallo = e.message;
  }
  anotar(nombre, Date.now() - partio, fallo, choque);
  if (fallo) erroresVistos.set(`${nombre}: ${fallo}`, (erroresVistos.get(`${nombre}: ${fallo}`) || 0) + 1);
  return cuerpo;
}

const erroresVistos = new Map();

async function entrar() {
  const r = await fetch(URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut: RUT, password: CLAVE }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`No se pudo entrar con ${RUT}: ${d.error || 'sin token'}`);
  return d.token;
}

/**
 * Lo que hace una persona usando el sistema: mira el panel, recorre listados,
 * abre fichas, despliega selectores y de vez en cuando guarda algo.
 */
async function trabajar(token, hasta, escribe) {
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const opc = { headers: cab };
  await pedir('meta (al entrar)', '/api/meta', opc);

  while (Date.now() < hasta) {
    await pedir('panel de control', '/api/dashboard', opc);

    const lista = await pedir('listar miembros', '/api/miembros?page=1&limit=25', opc);
    const fila = lista && lista.rows && lista.rows[Math.floor(Math.random() * lista.rows.length)];
    if (fila) await pedir('abrir una ficha', `/api/miembros/${fila.id}`, opc);

    await pedir('buscar en miembros', '/api/miembros?q=so&page=1&limit=25', opc);
    // El buscador general pregunta en todos los módulos de una vez: es la
    // petición más cara que hace el sistema y por eso se mide aparte.
    await pedir('buscar en todo', '/api/buscar?q=so', opc);
    await pedir('listar asistencias', '/api/asistencias?page=1&limit=25', opc);
    await pedir('listar tesorería', '/api/tesoreria?page=1&limit=25', opc);
    await pedir('opciones de un selector', '/api/miembros/options', opc);

    if (escribe && fila) {
      const ficha = await pedir('abrir para editar', `/api/miembros/${fila.id}`, opc);
      if (ficha && ficha.id) {
        await pedir('guardar una ficha', `/api/miembros/${ficha.id}`, {
          method: 'PUT',
          headers: cab,
          body: JSON.stringify({ ...ficha, observaciones: `Prueba de carga ${Date.now()}` }),
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function percentil(tiempos, p) {
  const orden = [...tiempos].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((orden.length * p) / 100))];
}

function informe() {
  const filas = [...medidas.entries()].sort((a, b) => percentil(b[1].tiempos, 95) - percentil(a[1].tiempos, 95));
  const ancho = Math.max(...filas.map(([n]) => n.length));
  console.log(`\n${'petición'.padEnd(ancho)}   veces   mitad     casi todas (p95)   lo peor   fallaron`);
  console.log('─'.repeat(ancho + 56));
  let peor = 0;
  let fallos = 0;
  let choques = 0;
  for (const [nombre, m] of filas) {
    const p95 = percentil(m.tiempos, 95);
    peor = Math.max(peor, p95);
    fallos += m.fallos;
    choques += m.choques;
    console.log(
      nombre.padEnd(ancho) +
        String(m.tiempos.length).padStart(8) +
        `${percentil(m.tiempos, 50)} ms`.padStart(9) +
        `${p95} ms`.padStart(19) +
        `${Math.max(...m.tiempos)} ms`.padStart(10) +
        String(m.fallos).padStart(11)
    );
  }
  const total = [...medidas.values()].reduce((t, m) => t + m.tiempos.length, 0);
  console.log('─'.repeat(ancho + 56));
  console.log(
    `${USUARIOS} usuarios a la vez durante ${SEGUNDOS} s · ${total.toLocaleString('es-CL')} peticiones ` +
      `(${Math.round(total / SEGUNDOS)} por segundo) · la más lenta de todas: ${peor} ms`
  );
  if (choques) {
    console.log(
      `\n✋ ${choques} vez/veces dos usuarios guardaron la misma ficha a la vez y el sistema avisó en vez de\n` +
        '   dejar que uno le borrara el trabajo al otro. En esta prueba todos editan las mismas fichas,\n' +
        '   así que es lo que se espera ver.'
    );
  }
  if (erroresVistos.size) {
    console.log('\n⚠️  Fallos:');
    for (const [texto, n] of erroresVistos) console.log(`   ${n}× ${texto}`);
  }
  return fallos;
}

(async () => {
  if (process.env.LIMPIAR) {
    limpiarDatosDePrueba(process.env.LIMPIAR === 'borrar');
    return;
  }
  if (process.env.PREPARAR) prepararDatos();
  if (process.env.PREPARAR === 'solo') return; // solo llenar la base, sin medir
  console.log(`🏃 ${USUARIOS} usuarios trabajando a la vez durante ${SEGUNDOS} s contra ${URL}…`);
  const token = await entrar();
  const hasta = Date.now() + SEGUNDOS * 1000;
  // Uno de cada cuatro además guarda: así se mide leer y escribir a la vez
  await Promise.all(Array.from({ length: USUARIOS }, (_, i) => trabajar(token, hasta, i % 4 === 0)));
  const fallos = informe();
  process.exit(fallos ? 1 : 0);
})();
