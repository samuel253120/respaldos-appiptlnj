/**
 * Que el sistema se pueda usar sin ver la pantalla.
 *
 * Un formulario se ve así: la etiqueta a la izquierda, la caja a la derecha.
 * Quien mira lee «Nombre de la institución» y entiende qué va ahí. Quien
 * escucha, no: si la etiqueta no está UNIDA al campo, el lector de pantalla
 * anuncia «cuadro de texto, en blanco» y hay que adivinar.
 *
 * La versión 1.64 se propuso que el sistema se pudiera usar así, y la
 * auditoría encontró que no se cumplía: 64 campos sin nombre —39 en
 * Configuración, 18 en Mi perfil y el resto repartidos—. Se arregló en la
 * 1.97.1 y esta suite existe para que no vuelva.
 *
 * SE MIRA LA PÁGINA YA PINTADA, no el código. Los campos salen de tres
 * generadores y de una veintena de formularios escritos a mano, y algunos
 * aparecen recién al elegir una opción. Lo único que dice la verdad es lo que
 * quedó en la página, y por eso se abre cada pantalla de verdad: los listados,
 * el formulario de cada módulo, la configuración pestaña por pestaña, el
 * perfil y los informes. Son 53.
 *
 * Cómo se corre, con el sistema andando:
 *
 *   URL=http://localhost:4314 npm run acceso
 */
const { chromium } = require('playwright');
const B = process.env.URL || 'http://127.0.0.1:4344';

const SIN_NOMBRE = `(() => {
  const sueltos = [...document.querySelectorAll('input:not([type=hidden]),select,textarea,[contenteditable="true"]')].filter((c) => {
    if (c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')) return false;
    if (c.id && document.querySelector('label[for="' + CSS.escape(c.id) + '"]')) return false;
    if (c.closest('label')) return false;
    return true;
  });
  return sueltos.map((c) => c.tagName.toLowerCase() + (c.type ? ':' + c.type : '') + (c.id ? '#' + c.id : '') + (c.name ? '[' + c.name + ']' : ''));
})()`;

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  await pg.goto(B + '/');
  await pg.fill('#loginRut', process.env.RUT || '11.111.111-1');
  await pg.fill('#loginPass', process.env.CLAVE || 'admin123');
  await pg.click('button[type=submit]');
  await pg.waitForTimeout(1500);
  if (await pg.$('#psLuego')) { await pg.click('#psLuego'); await pg.waitForTimeout(600); }
  await pg.waitForSelector('.topbar', { timeout: 15000 });

  const modulos = await pg.evaluate(() => MODULES.filter((m) => m.menu !== false).map((m) => m.name));

  const pantallas = ['#/', '#/asistencia', '#/asistencia/informes', '#/perfil', '#/config'];
  for (const m of modulos) {
    pantallas.push(`#/m/${m}`);
    pantallas.push(`#/m/${m}/new`); // el formulario, que es donde están los campos
  }

  let total = 0;
  const conProblemas = [];
  for (const ruta of pantallas) {
    await pg.goto(B + '/' + ruta);
    await pg.waitForTimeout(1100);
    const sueltos = await pg.evaluate(SIN_NOMBRE);
    if (sueltos.length) {
      total += sueltos.length;
      conProblemas.push(`${ruta.padEnd(30)} ${sueltos.length}  ${sueltos.slice(0, 6).join(' ')}`);
    }
  }

  // La configuración, pestaña por pestaña
  await pg.goto(B + '/#/config');
  await pg.waitForTimeout(1500);
  const pestanas = await pg.$$eval('#cfgTabs button, .tabs button', (bs) => bs.map((b) => b.textContent.trim()));
  for (let i = 0; i < pestanas.length; i++) {
    const botones = await pg.$$('#cfgTabs button, .tabs button');
    if (!botones[i]) continue;
    await botones[i].click();
    await pg.waitForTimeout(700);
    const sueltos = await pg.evaluate(SIN_NOMBRE);
    if (sueltos.length) {
      total += sueltos.length;
      conProblemas.push(`config › ${pestanas[i].padEnd(21)} ${sueltos.length}  ${sueltos.slice(0, 6).join(' ')}`);
    }
  }

  await nav.close();
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`   ${pantallas.length + pestanas.length} pantallas revisadas`);
  if (total) {
    console.log(`   ❌ ${total} campo(s) sin nombre:\n`);
    conProblemas.forEach((p) => console.log('   ·', p));
    console.log('\n   Un campo se nombra uniéndole su etiqueta (for/id) o, cuando no');
    console.log('   hay etiqueta que unir —un filtro de la barra, una casilla dentro');
    console.log('   de una tabla—, con aria-label.');
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ Todos los campos dicen cómo se llaman: el sistema se puede usar sin ver la pantalla.');
})().catch((e) => { console.error('💥', e.message); process.exit(1); });
