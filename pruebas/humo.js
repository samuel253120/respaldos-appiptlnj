/**
 * Prueba de humo: abre todas las pantallas del sistema y avisa si alguna se
 * rompe.
 *
 * Recorre cada módulo tres veces —su listado, el formulario de uno nuevo y el
 * de editar el primer registro— y además el panel, asistencia, informes, el
 * perfil y configuración. De cada pantalla revisa tres cosas:
 *
 *   · que el formulario no se quede pegado en «Cargando…»
 *   · que la pantalla no se salga de lado (hay que desplazarse en horizontal)
 *   · que el navegador no tire ningún error
 *
 * Todo eso en computador (1366) y en teléfono (390).
 *
 * Existe porque una vez se publicó una versión donde «Editar usuario» quedaba
 * pegado en «Cargando…»: la prueba de entonces solo abría el formulario de
 * Miembros y no lo vio. Cualquier módulo que se agregue queda cubierto solo.
 *
 * Cómo se corre, con el sistema andando en el puerto que se le indique:
 *
 *   npm run humo
 *   URL=http://localhost:3000 RUT=11.111.111-1 CLAVE=... npm run humo
 *
 * Necesita Playwright con su navegador (npm install && npx playwright install
 * chromium). No viaja en la imagen de producción: es una dependencia de
 * desarrollo.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4314';
const RUT = process.env.RUT || '11.111.111-1';

/**
 * La contraseña con la que se entra, que puede cambiar durante la corrida.
 *
 * En un sistema recién instalado la cuenta trae la contraseña que entrega el
 * administrador y el sistema OBLIGA a cambiarla antes de dejar hacer nada: sin
 * pasar por ahí no hay ninguna pantalla que revisar. Así que la primera vez
 * esta suite la cambia, se queda con la nueva y sigue. En un sistema que ya
 * está en uso esa pantalla no aparece y esto no hace nada.
 *
 * Es un dato de la corrida y no una constante justamente por eso: la segunda
 * entrada —la que revisa el teléfono— ya no sirve con la de fábrica.
 */
let clave = process.env.CLAVE || 'admin123';
const CLAVE_NUEVA = process.env.CLAVE_NUEVA || 'Humo.2026.Prueba';

// «#/config» no está acá: se revisa aparte, pestaña por pestaña, más abajo
const PANTALLAS_SUELTAS = ['#/', '#/asistencia', '#/asistencia/informes', '#/perfil'];

async function revisarUnMedio(navegador, medio, ancho) {
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: 900 } });
  const errores = [];
  /*
   * Mientras se está entrando, que el servidor diga que no es lo esperado.
   *
   * Pasan dos cosas antes de ver la primera pantalla, y las dos dejan una
   * línea roja en la consola del navegador:
   *
   *   401  el intento con la contraseña de fábrica, cuando esta suite ya la
   *        cambió en una corrida anterior. Se prueba una y después la otra.
   *   403  la cuenta que todavía tiene la contraseña que le entregaron: el
   *        servidor le niega /api/meta, y la pantalla usa justamente esa
   *        negativa para llevarla a cambiarla. El 403 no es una falla: es
   *        cómo está hecho.
   *
   * Sin esto, una instalación recién hecha «falla» siempre por lo único que
   * tiene que pasar. La excepción dura hasta que se entra y ni un segundo más:
   * de ahí en adelante, si una pantalla pide algo que no le corresponde, se ve.
   */
  let todaviaEntrando = true;
  const esDeLaEntrada = (t) => todaviaEntrando && /\b(401|403)\b/.test(t);
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => {
    if (m.type() !== 'error') return;
    const texto = m.text().slice(0, 120);
    if (!esDeLaEntrada(texto)) errores.push(texto);
  });

  const entrar = async (conQue) => {
    await pagina.goto(URL + '/');
    await pagina.fill('#loginRut', RUT);
    await pagina.fill('#loginPass', conQue);
    await pagina.click('button[type=submit]');
    await pagina.waitForTimeout(1500);
    return !(await pagina.$('#loginRut')); // si el formulario ya no está, entró
  };

  /*
   * Se prueba con la de fábrica y, si no, con la que esta suite deja puesta.
   *
   * La primera corrida sobre una instalación nueva TIENE que cambiar la
   * contraseña —el sistema no deja pasar de ahí—, así que de la segunda en
   * adelante la de fábrica ya no sirve. Sin esto, «npm run humo» andaba una
   * vez y a la siguiente se quedaba esperando una pantalla que no iba a
   * llegar. Es un intento fallido como mucho, y solo la primera vez: `clave`
   * queda corregida para el resto de la corrida.
   */
  if (!(await entrar(clave)) && clave !== CLAVE_NUEVA) {
    if (await entrar(CLAVE_NUEVA)) clave = CLAVE_NUEVA;
  }

  // Primer ingreso: hay que elegir una contraseña propia antes de seguir
  if (await pagina.$('#cambioForm')) {
    await pagina.fill('#cambioNueva', CLAVE_NUEVA);
    await pagina.fill('#cambioRepetir', CLAVE_NUEVA);
    await pagina.click('#cambioForm button[type=submit]');
    await pagina.waitForTimeout(1800);
    clave = CLAVE_NUEVA;
    console.log('   🔑 era el primer ingreso: la contraseña quedó cambiada para el resto de la revisión');
  }
  // Enseguida se ofrece la pregunta secreta, que acá se deja para después
  if (await pagina.$('#psLuego')) { await pagina.click('#psLuego'); await pagina.waitForTimeout(700); }
  await pagina.waitForSelector('.topbar', { timeout: 15000 });
  todaviaEntrando = false; // de acá en adelante, un 401 o un 403 sí es una falla

  const modulos = await pagina.evaluate(() => MODULES.map((m) => m.name));
  const pegados = [];
  const anchos = {};

  const revisar = async (ruta) => {
    await pagina.goto(URL + '/' + ruta);
    await pagina.waitForTimeout(750);
    const w = await pagina.evaluate(() => document.documentElement.scrollWidth);
    if (w > ancho) anchos[ruta] = w;
    const cargando = await pagina.evaluate(() => {
      const g = document.getElementById('formGrid');
      return g ? /Cargando…/.test(g.innerText) : false;
    });
    if (cargando) pegados.push(ruta);
  };

  /**
   * Y la ficha, pestaña por pestaña.
   *
   * Lo que cuelga de una ficha —la gente de un cuerpo, su plata, sus actas,
   * los documentos de un miembro— vive en pestañas, y cada una se pinta recién
   * al abrirla. Una que reviente al abrirse no se nota mirando la ficha: hay
   * que tocarlas todas, que es lo que hace esto.
   */
  const revisarLaFicha = async (nombre, id) => {
    await revisar(`#/m/${nombre}/ficha/${id}`);
    const pestanas = await pagina.evaluate(() =>
      [...document.querySelectorAll('.pestanas [data-pestana]')].map((b) => b.dataset.pestana)
    );
    for (const cual of pestanas) {
      await pagina.click(`.pestanas [data-pestana="${cual}"]`);
      await pagina.waitForTimeout(600);
      const w = await pagina.evaluate(() => document.documentElement.scrollWidth);
      if (w > ancho) anchos[`#/m/${nombre}/ficha/${id}/${cual}`] = w;
      const vacia = await pagina.evaluate(() => {
        const panel = document.querySelector('.panel-pestana:not([hidden])');
        return !panel || !panel.textContent.trim();
      });
      if (vacia) pegados.push(`#/m/${nombre}/ficha/${id}/${cual} (pestaña en blanco)`);
    }
    return pestanas.length;
  };

  let conPestanas = 0;
  for (const nombre of modulos) {
    await revisar(`#/m/${nombre}`);
    const id = await pagina.evaluate(() => {
      const fila = document.querySelector('table.grid tbody tr');
      return fila ? fila.dataset.id : null;
    });
    await revisar(`#/m/${nombre}/new`);
    if (id) await revisar(`#/m/${nombre}/edit/${id}`);
    if (id) conPestanas += await revisarLaFicha(nombre, id);
  }
  for (const ruta of PANTALLAS_SUELTAS) await revisar(ruta);

  /**
   * Y la configuración, pestaña por pestaña.
   *
   * Por la misma razón que las de una ficha: sus paneles más pesados —el
   * respaldo, el traspaso, el historial de versiones— se piden recién al abrir
   * su pestaña, y uno que reviente al abrirse no se nota entrando a la
   * pantalla.
   */
  await revisar('#/config');
  const pestanasDeConfig = await pagina.evaluate(() =>
    [...document.querySelectorAll('.pestanas [data-pestana]')].map((b) => b.dataset.pestana)
  );
  for (const cual of pestanasDeConfig) {
    await pagina.click(`.pestanas [data-pestana="${cual}"]`);
    await pagina.waitForTimeout(700);
    const w = await pagina.evaluate(() => document.documentElement.scrollWidth);
    if (w > ancho) anchos[`#/config/${cual}`] = w;
    const vacia = await pagina.evaluate(() => {
      const panel = document.querySelector('.panel-pestana:not([hidden])');
      return !panel || !panel.textContent.trim();
    });
    if (vacia) pegados.push(`#/config/${cual} (pestaña en blanco)`);
  }
  conPestanas += pestanasDeConfig.length;

  /**
   * Y el buscador general, que vive en la barra de arriba y no tiene dirección
   * propia. Pregunta en los treinta y dos módulos de una vez: si uno de ellos
   * revienta, no se nota mirando ninguna pantalla.
   */
  await pagina.goto(URL + '/#/');
  await pagina.waitForTimeout(500);
  const conLupa = await pagina.$('#bgAbrir');
  if (conLupa && await conLupa.isVisible()) await conLupa.click();
  await pagina.fill('#bgTexto', 'a' + 'e');
  await pagina.waitForTimeout(1200);
  const panel = await pagina.evaluate(() => {
    const p = document.getElementById('bgPanel');
    return { abierto: p && !p.hidden, texto: p ? p.textContent.trim().slice(0, 40) : '' };
  });
  if (!panel.abierto) pegados.push('el buscador general no abrió su panel');
  const anchoTrasBuscar = await pagina.evaluate(() => document.documentElement.scrollWidth);
  if (anchoTrasBuscar > ancho) anchos['buscador general'] = anchoTrasBuscar;

  const distintos = [...new Set(errores)];
  console.log(
    `${medio.padEnd(6)} · módulos: ${modulos.length}` +
      ` · pestañas abiertas: ${conPestanas}` +
      ` · pegados en "Cargando…": ${pegados.length ? pegados.join(', ') : 'ninguno'}` +
      ` · se salen de lado: ${Object.keys(anchos).length ? JSON.stringify(anchos) : 'ninguna'}` +
      ` · errores: ${distintos.length ? distintos.slice(0, 4).join(' | ') : 'ninguno'}`
  );
  await pagina.close();
  return pegados.length + Object.keys(anchos).length + distintos.length;
}

(async () => {
  // CHROMIUM sirve para apuntar a un navegador ya instalado en el equipo
  const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let problemas = 0;
  for (const [medio, ancho] of [['pc', 1366], ['móvil', 390]]) {
    problemas += await revisarUnMedio(navegador, medio, ancho);
  }
  await navegador.close();
  if (problemas) {
    console.error(`\n❌ ${problemas} problema(s). Revise lo que quedó listado arriba.`);
    process.exit(1);
  }
  console.log('\n✅ Todas las pantallas abren bien, en computador y en teléfono.');
})();
