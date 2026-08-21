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
const CLAVE = process.env.CLAVE || 'admin123';

const PANTALLAS_SUELTAS = ['#/', '#/asistencia', '#/asistencia/informes', '#/perfil', '#/config'];

async function revisarUnMedio(navegador, medio, ancho) {
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: 900 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 120)); });

  await pagina.goto(URL + '/');
  await pagina.fill('#loginRut', RUT);
  await pagina.fill('#loginPass', CLAVE);
  await pagina.click('button[type=submit]');
  await pagina.waitForTimeout(1500);
  if (await pagina.$('#psLuego')) { await pagina.click('#psLuego'); await pagina.waitForTimeout(700); }
  await pagina.waitForSelector('.topbar', { timeout: 15000 });

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

  for (const nombre of modulos) {
    await revisar(`#/m/${nombre}`);
    const id = await pagina.evaluate(() => {
      const fila = document.querySelector('table.grid tbody tr');
      return fila ? fila.dataset.id : null;
    });
    await revisar(`#/m/${nombre}/new`);
    if (id) await revisar(`#/m/${nombre}/edit/${id}`);
  }
  for (const ruta of PANTALLAS_SUELTAS) await revisar(ruta);

  const distintos = [...new Set(errores)];
  console.log(
    `${medio.padEnd(6)} · módulos: ${modulos.length}` +
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
