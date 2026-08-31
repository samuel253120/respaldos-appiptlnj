/**
 * Prueba de humo: abre todas las pantallas del sistema y avisa si alguna se
 * rompe.
 *
 * Recorre cada módulo tres veces —su listado, el formulario de uno nuevo y el
 * de editar el primer registro— y además el panel, asistencia, informes, el
 * perfil y configuración. De cada pantalla revisa tres cosas:
 *
 *   · que el formulario no se quede pegado en «Cargando…»
 *   · que no tenga un campo obligatorio escondido, que impide guardarlo sin
 *     decir por qué
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
  const repetidos = [];
  const tapados = [];
  const recortados = [];
  const noSePuedeGuardar = [];

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

    /*
     * UN FORMULARIO QUE NO SE PUEDE GUARDAR Y NO LO DICE.
     *
     * Un campo obligatorio que está escondido —porque depende del valor de
     * otro (`showIf`)— sigue entrando en la revisión que hace el navegador
     * antes de mandar el formulario. Si está vacío, el navegador intenta poner
     * el cursor ahí, no puede, y no manda nada: el botón Guardar deja de hacer
     * absolutamente nada y en la pantalla no aparece ningún mensaje.
     *
     * No lo veía ninguna prueba. La pantalla no se sale de lado, no queda
     * pegada en «Cargando…» y el único rastro es una línea en la consola del
     * navegador que además viene sin nombre: «An invalid form control with
     * name='' is not focusable». Se descubrió en Ayudas Sociales: registrar una
     * ayuda a nombre de un NO MIEMBRO era imposible desde el formulario, y a
     * nombre de un miembro sí se podía, así que ni siquiera fallaba siempre.
     *
     * Se mide en todos los formularios de una vez, que es donde puede pasar.
     */
    const obligatoriosEscondidos = await pagina.evaluate(() => {
      const form = document.getElementById('recForm');
      if (!form) return [];
      return [...form.querySelectorAll('[required]')]
        .filter((c) => !c.getClientRects().length)
        .map((c) => c.name || (c.closest('.refbuscar') || {}).id || '(sin nombre)');
    });
    if (obligatoriosEscondidos.length) {
      noSePuedeGuardar.push(`${ruta} → ${[...new Set(obligatoriosEscondidos)].join(', ')}`);
    }

    /*
     * Un campo que sale DOS VECES en el mismo formulario.
     *
     * Se agregó porque alguien lo vio en su teléfono —«Secretario(a)» dos
     * veces al levantar un acta— y no se pudo reproducir acá: ni abriendo el
     * formulario, ni cambiando el cuerpo, ni entrando desde la ficha, ni en
     * ninguno de los 24 formularios del sistema. Un defecto que no se
     * reproduce no se arregla a ciegas, pero sí se puede dejar vigilado: si
     * vuelve a pasar, ahora lo dice una prueba en vez de tener que verlo
     * alguien de casualidad.
     *
     * Se miran las etiquetas y también los nombres de los controles: dos
     * controles con el mismo nombre son peores que dos etiquetas iguales,
     * porque al guardar solo uno de los dos vale y no se sabe cuál.
     */
    const dobles = await pagina.evaluate(() => {
      const campos = [...document.querySelectorAll('#formGrid .fld')].map((d) => {
        const et = d.querySelector('label');
        const ctrl = d.querySelector('[name]');
        return { et: (et ? et.textContent : '').replace('*', '').trim(), n: ctrl ? ctrl.name : '' };
      });
      const dosVeces = (lista) => [...new Set(lista.filter((v, i) => v && lista.indexOf(v) !== i))];
      return {
        etiquetas: dosVeces(campos.map((c) => c.et)),
        nombres: dosVeces(campos.map((c) => c.n)),
      };
    });
    if (dobles.etiquetas.length || dobles.nombres.length) {
      repetidos.push(`${ruta} → ${[...dobles.etiquetas, ...dobles.nombres].join(', ')}`);
    }

    /*
     * Un dato TAPADO por los botones de la tarjeta.
     *
     * En el teléfono el listado se dibuja como tarjetas, e imprimir y borrar
     * van pegados a la esquina con posición absoluta: una fila entera para dos
     * botones chicos sería media pantalla desperdiciada. Eso obliga a
     * reservarles el sitio en el dato que quede debajo, y ese sitio se
     * reservaba NOMBRANDO las columnas de nombre. En Registro de Servicios
     * —y en Asistencia, Tesorería, Actas, Inventarios y todas las que parten
     * por la fecha— no hay ninguna columna de nombre, así que los botones
     * quedaban justo encima y la fecha no se podía leer.
     *
     * No lo vio ninguna prueba: la tarjeta no se sale de la pantalla, no tira
     * ningún error y ninguna pantalla queda «Cargando…». Se vio en el teléfono
     * de alguien. Así que ahora se mide: se toma el rectángulo de los botones
     * y el de cada dato, y si se pisan, se dice cuál y dónde.
     */
    if (ancho <= 700) {
      const encima = await pagina.evaluate(() => {
        const choques = [];
        for (const fila of document.querySelectorAll('table.grid-lista tbody tr')) {
          const botones = fila.querySelector('td.acciones');
          if (!botones || !botones.getClientRects().length) continue;
          const b = botones.getBoundingClientRect();
          if (!b.width) continue;
          for (const celda of fila.querySelectorAll('td:not(.acciones)')) {
            if (!celda.getClientRects().length) continue;
            const texto = celda.textContent.trim();
            if (!texto) continue;
            // Se mide el texto y no la celda: la celda ocupa todo el ancho de
            // la tarjeta aunque su dato esté a la izquierda, y eso no molesta.
            const rango = document.createRange();
            rango.selectNodeContents(celda);
            for (const r of rango.getClientRects()) {
              if (!r.width || !r.height) continue;
              const seTocan = r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
              if (seTocan) { choques.push(`«${texto.slice(0, 24)}» (${celda.dataset.col || '?'})`); break; }
            }
          }
        }
        return [...new Set(choques)];
      });
      if (encima.length) tapados.push(`${ruta} → ${encima.slice(0, 3).join(' · ')}`);

      /*
       * Contenido RECORTADO por una caja que no deja llegar a él.
       *
       * El editor de permisos tenía una tabla de 635 px metida en una caja de
       * 312: los escalones salían cortados a media palabra y las cuatro
       * columnas de acciones —ver, crear, editar, eliminar— quedaban del todo
       * fuera de la pantalla. Había un deslizamiento lateral previsto para eso,
       * pero no llegaba a funcionar: el grupo de más adentro recorta lo suyo
       * para redondear sus esquinas, así que la tabla se cortaba ahí y nunca
       * alcanzaba a la caja que sí deslizaba.
       *
       * Y no lo veía ninguna prueba, justamente porque estaba recortado: la
       * página NO se sale de lado —para eso servía el recorte—, no hay error,
       * no hay pantalla en blanco. Simplemente falta media pantalla de
       * controles y no hay manera de llegar a ellos.
       *
       * Así que acá se busca lo contrario de lo que se buscaba: una caja que
       * esconde parte de lo suyo Y que no se puede deslizar. Si se puede
       * deslizar está bien —una tabla ancha que se arrastra es una decisión—;
       * lo que no puede ser es que esté escondido y sin salida.
       */
      const escondido = await pagina.evaluate(() => {
        const presos = [];
        // Una caja de escribir esconde lo suyo por naturaleza —el texto se
        // corre solo al mover el cursor— y eso no es un defecto de nadie
        const DE_ESCRIBIR = ['INPUT', 'TEXTAREA', 'SELECT'];
        for (const el of document.querySelectorAll('#content *')) {
          if (DE_ESCRIBIR.includes(el.tagName) || el.isContentEditable) continue;
          const est = getComputedStyle(el);
          if (est.overflowX !== 'hidden' && est.overflowX !== 'clip') continue;
          // Lo que se recorta con puntos suspensivos se recorta a propósito
          if (est.textOverflow === 'ellipsis') continue;
          const sobra = el.scrollWidth - el.clientWidth;
          if (sobra <= 4 || !el.clientWidth) continue;
          presos.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} esconde ${sobra} px`);
        }
        return [...new Set(presos)];
      });
      if (escondido.length) recortados.push(`${ruta} → ${escondido.slice(0, 3).join(' · ')}`);
    }
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
   * Y que un campo de referencia AVISE cuando se elige algo.
   *
   * Cuando la lista es larga, un campo de referencia no es un desplegable sino
   * un buscador: una caja con un campo de texto a la vista y el dato en uno
   * oculto. Lo que dependa de ese campo escucha al campo, por su nombre.
   *
   * El buscador avisaba sobre la caja de texto, que es la HERMANA del campo
   * oculto, así que el aviso subía por otra rama y no llegaba nunca. Con pocas
   * opciones —cuando sí era un desplegable— funcionaba, que es lo que lo hacía
   * difícil de ver. Costó dos cosas: los selectores dependientes tuvieron que
   * escuchar el formulario entero para rodearlo, y el saldo de la cuenta de
   * origen de un traspaso —escrito, completo y con su hueco en pantalla— no
   * apareció nunca.
   *
   * Se comprueba acá y no en el motor porque solo pasa en el navegador: es un
   * aviso del DOM que sube por unos padres y no por otros.
   */
  await revisar('#/m/traspasos/new');
  const conBuscador = await pagina.$('#rb_cuenta_origen_id .rb-txt');
  if (conBuscador) {
    await conBuscador.click();
    await pagina.waitForTimeout(900);
    const hayOpcion = await pagina.$('#rb_cuenta_origen_id .rb-lista li[data-id]');
    if (hayOpcion) {
      await hayOpcion.click();
      await pagina.waitForTimeout(1200);
      const aviso = await pagina.evaluate(() => {
        const m = document.querySelector('.saldo-origen');
        const campo = document.querySelector('#rb_cuenta_origen_id .rb-txt');
        if (!m || !campo) return null;
        return {
          dice: m.innerText.trim(),
          dentro: !!document.querySelector('#rb_cuenta_origen_id .saldo-origen'),
          debajo: m.getBoundingClientRect().top >= campo.getBoundingClientRect().bottom - 2,
        };
      });
      if (!aviso || !aviso.dice) {
        pegados.push('el saldo de la cuenta de origen no aparece al elegirla');
      } else if (aviso.dentro || !aviso.debajo) {
        pegados.push('el saldo de la cuenta de origen no queda debajo de su campo');
      }
    }
  }

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
      ` · campos repetidos: ${repetidos.length ? repetidos.join(' | ') : 'ninguno'}` +
      ` · formularios que no se podrían guardar: ${noSePuedeGuardar.length ? noSePuedeGuardar.join(' | ') : 'ninguno'}` +
      (ancho <= 700 ? ` · datos tapados por los botones: ${tapados.length ? tapados.join(' | ') : 'ninguno'}` : '') +
      (ancho <= 700 ? ` · recortado sin salida: ${recortados.length ? recortados.join(' | ') : 'nada'}` : '') +
      ` · se salen de lado: ${Object.keys(anchos).length ? JSON.stringify(anchos) : 'ninguna'}` +
      ` · errores: ${distintos.length ? distintos.slice(0, 4).join(' | ') : 'ninguno'}`
  );
  await pagina.close();
  return pegados.length + Object.keys(anchos).length + distintos.length + repetidos.length
    + tapados.length + recortados.length + noSePuedeGuardar.length;
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
