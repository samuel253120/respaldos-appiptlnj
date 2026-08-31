/* =====================================================================
 * Sistema de Gestión de Iglesias — Aplicación de una sola página (SPA)
 *
 * La interfaz se AUTOGENERA a partir de /api/meta: por cada módulo
 * registrado en el servidor se crean automáticamente su entrada de menú,
 * listado (búsqueda, filtros, orden, paginación), formulario y, si el
 * módulo lo declara, su vista de impresión. Agregar un módulo en
 * server/modules/ lo hace aparecer aquí sin tocar este archivo.
 * ===================================================================== */
'use strict';

let TOKEN = localStorage.getItem('token') || null;
let USER = null;
let MODULES = []; // metadatos de módulos visibles para el usuario
let MOD = {}; // por nombre
const optionsCache = {}; // opciones {id,label} por módulo referenciado
const listState = {}; // estado de cada listado (página, búsqueda, filtros…)
let PERMISOS_CATALOGO = null; // módulos y acciones para el editor de permisos
let ROLES = []; // roles disponibles, para mostrarlos por su nombre
let AJUSTES = { imagen_lado_maximo: 1600, imagen_calidad: 88 }; // preferencias de la interfaz

/**
 * ¿Tiene esta llave del sistema?
 *
 * Las llaves son lo que se puede permitir y no es un módulo: la configuración,
 * los respaldos, el traspaso desde el sistema anterior, los datos de salud de
 * las fichas (ver LLAVES en server/permissions.js). El servidor manda en cada
 * llamada las que tiene esta persona; acá se usan solo para decidir qué
 * mostrarle. Preguntar por el rol —«¿es administrador?»— era lo que hacía que
 * conceder los respaldos a alguien funcionara en el servidor pero no le
 * apareciera en el menú.
 */
function tieneLlave(nombre, accion = 'view') {
  return !!(USER && USER.llaves && (USER.llaves[nombre] || []).includes(accion));
}

/**
 * ¿Este campo está reservado y el servidor no se lo mandó a esta persona?
 *
 * Los datos reservados —la salud, el contacto— no vienen en blanco: no vienen.
 * La fila trae en `reservado_oculto` los grupos que faltan, y acá se pregunta
 * campo por campo. Un campo vacío se leería como «no tiene ninguna alergia» o
 * «no tiene teléfono», y eso es peor que decir que hay algo que no se está
 * mostrando (ver server/sensibles.js).
 */
function estaReservado(f, row) {
  if (!f || !f.reservado) return false;
  // En una ficha que ya existe manda lo que dijo el servidor: él sabe si esta
  // persona la alcanza —la suya propia la ve siempre, tenga la llave o no—.
  if (row && row.id) {
    const fuera = row.reservado_oculto || (row.salud_oculta ? ['miembros_salud'] : []);
    return fuera.includes(f.reservado);
  }
  // En una ficha nueva no hay nada que preguntar todavía: decide su llave. Si
  // no se hiciera, se le ofrecería escribir un dato que al guardar se
  // descartaría en silencio.
  return !tieneLlave(f.reservado);
}

/**
 * Una pantalla de plata a la que el servidor le quitó las cifras.
 *
 * Las pantallas de Tesorería no se arman con los campos de un módulo: el
 * estado de una cuenta, su cartola y el balance del período arman su propia
 * respuesta, y el servidor les quita los pesos a quien no alcanza la llave
 * «Montos del dinero» (ver `sinLasCifras` en server/sensibles.js). Sin esto la
 * pantalla dibujaba las tarjetas con el rótulo y el número en blanco, que se
 * lee como «no hay nada», y el balance salía a imprimir vacío.
 */
const sinCifras = (d) => !!(d && d.cifras_ocultas);

const AVISO_SIN_CIFRAS =
  '<div class="aviso"><b>🔒 Cifras reservadas</b><span>Su cuenta ve qué se movió y cuándo '
  + '—la fecha, el concepto, la categoría— pero no los montos ni los saldos. Los ve quien tenga '
  + 'el permiso «Montos del dinero».</span></div>';

const $app = document.getElementById('app');

/**
 * Cómo se llama este sistema. Va en la pantalla de ingreso, bajo el logo:
 * quien entra ahí todavía no está en ninguna iglesia en particular, está
 * entrando a administrarlas. El nombre de la institución sigue yendo donde
 * corresponde —los certificados, las credenciales, lo que se imprime—.
 */
const SISTEMA = 'Gestión de Iglesias';

/* Identidad institucional: lo que va en el acceso, en el menú y en lo impreso */
const IGLESIA = {
  nombre: 'Iglesia Pentecostal Triunfante La Nueva Jerusalén',
  lema: '',
  // El logo lo entrega el servidor: el que se haya subido, o el de fábrica
  // mientras no haya ninguno. La versión al final es para que un logo nuevo se
  // vea en el momento y no quede el viejo guardado en el navegador.
  logo: '/api/configuracion/logo',
  rut: '', direccion: '', telefono: '', email: '', web: '',
};

/** Lo de la institución que se imprime al pie: contacto y personalidad jurídica. */
function pieDeLaInstitucion() {
  const contacto = [IGLESIA.rut, IGLESIA.direccion, IGLESIA.telefono, IGLESIA.email, IGLESIA.web]
    .map((x) => (x || '').trim())
    .filter(Boolean)
    .join(' · ');
  return contacto;
}

/**
 * El membrete: lo mismo en TODO lo que se imprime.
 *
 * Estaba escrito tres veces a mano —una por cada clase de hoja— y por eso
 * había divergido: las fichas y las actas llevaban el RUT, la dirección y el
 * teléfono de la institución, y los informes no. Justamente los informes, que
 * son los que salen de la iglesia y llegan a manos de otros; una hoja con
 * cifras de asistencia y solo un nombre arriba no identifica a nadie.
 *
 * La leyenda legal va en su propia línea y no pegada al contacto: no es un
 * dato de contacto, y con un punto en el medio se leía como si lo fuera.
 */
function membreteDelDocumento() {
  const contacto = pieDeLaInstitucion();
  const legal = (IGLESIA.pie_texto || '').trim();
  return `
    <div class="membrete">
      <img src="${IGLESIA.logo}" alt="" />
      <div>
        <b>${esc(IGLESIA.nombre)}</b>
        ${IGLESIA.lema ? `<i>${esc(IGLESIA.lema)}</i>` : ''}
        ${contacto ? `<span class="datos">${esc(contacto)}</span>` : ''}
        ${legal ? `<span class="datos legal">${esc(legal)}</span>` : ''}
      </div>
    </div>`;
}

/**
 * Baja un archivo del servidor con la sesión puesta.
 *
 * Un enlace normal no sirve: el sistema no usa galletas sino un pase que viaja
 * en la cabecera, así que el navegador pediría el archivo sin identificarse y
 * se toparía con un 401. Hay que pedirlo a mano, quedarse con el contenido y
 * entregárselo al navegador ya bajado.
 *
 * El nombre sale de lo que diga el servidor, que es quien sabe cómo se llama
 * el documento; `comoSeLlamaSiNoDice` es el respaldo por si no lo dijera.
 */
async function bajarArchivoConSesion(ruta, comoSeLlamaSiNoDice) {
  const r = await fetch(ruta, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) {
    const dijo = await r.json().catch(() => ({}));
    throw new Error(dijo.error || 'No se pudo preparar el archivo');
  }
  const cabecera = r.headers.get('Content-Disposition') || '';
  // El nombre con tildes viaja en «filename*=UTF-8''…», que hay que descifrar
  const conTildes = cabecera.match(/filename\*=UTF-8''([^;]+)/i);
  const simple = cabecera.match(/filename="([^"]+)"/i);
  let nombre = comoSeLlamaSiNoDice;
  if (conTildes) { try { nombre = decodeURIComponent(conTildes[1]); } catch (e) { /* se queda el de respaldo */ } }
  else if (simple) nombre = simple[1];

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se suelta después, o en algunos navegadores la descarga queda a medias
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return nombre;
}

/**
 * El pie: cuándo se emitió y quién lo emitió.
 *
 * Lo segundo faltaba en todo. Un informe de asistencia o una ficha que se
 * entrega y no dice quién la sacó no se puede preguntar después: si alguien
 * discute una cifra, no hay a quién volver. Y la redacción es una sola —antes
 * las fichas decían «impreso el» y los informes «Emitido el», para lo mismo—.
 */
function pieDelDocumento(extra) {
  const quien = (USER && USER.nombre) ? ` por ${esc(USER.nombre)}` : '';
  return `Emitido el ${fechaLarga(new Date().toISOString())}${quien}${extra ? ` · ${extra}` : ''}`;
}

/**
 * El mismo pie, para los archivos que no son HTML.
 *
 * En una planilla no hay nada que escapar —la celda no interpreta etiquetas—,
 * así que un nombre con «&» tiene que salir con su «&» y no como «&amp;».
 */
function pieDelDocumentoEnPlano() {
  const quien = (USER && USER.nombre) ? ` por ${USER.nombre}` : '';
  return `Emitido el ${fechaLarga(new Date().toISOString())}${quien}`;
}

/**
 * El nombre oficial de la institución va donde importa —la pantalla de
 * ingreso y todo lo que se imprime—; en el resto del sistema basta con saber
 * con qué iglesia se está trabajando.
 *
 * Las iglesias locales suelen llamarse repitiendo el de la institución
 * («Iglesia Pentecostal Triunfante "La Nueva Jerusalén" / Iglesia Central
 * Concepción»). Acá se le quita esa parte, sin tocar el dato guardado. Si el
 * nombre no empieza por el de la institución, se deja tal cual.
 */
function iglesiaDeTrabajo(nombre) {
  const completo = String(nombre || '').trim();
  if (!completo) return '';
  const parejo = (t) => String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sin tildes
    .replace(/["'«»“”]/g, '')             // sin comillas de ningún tipo
    .replace(/\s+/g, ' ')
    .trim();
  const institucion = parejo(IGLESIA.nombre);
  if (!institucion) return completo;
  const partes = completo.split(/\s*[/|—–]\s*/);        // «Institución / Local»
  if (partes.length > 1 && parejo(partes[0]) === institucion) {
    return partes.slice(1).join(' / ').trim() || completo;
  }
  return completo;
}

/** Cómo se muestra el destino de una referencia: la iglesia, acortada. */
function etiquetaDeRef(f, texto) {
  return f && f.name === 'iglesia_id' ? iglesiaDeTrabajo(texto) : String(texto || '');
}

/* ---------------- utilidades ---------------- */
/**
 * Deja marcado el enlace del menú donde uno está.
 *
 * La clase lo pinta; `aria-current` lo dice. Sin lo segundo, quien no ve la
 * pantalla recorre nueve enlaces iguales sin saber en cuál está parado.
 */
function marcarActivo(link) {
  link.classList.add('active');
  link.setAttribute('aria-current', 'page');

  /*
   * Y si su grupo estaba plegado, se abre.
   *
   * Va acá y no al armar el menú porque esta marca se pone al enrutar, que
   * pasa mucho después y muchas veces más. Sin esto, alguien que cerró
   * «Documentación» y llega a Certificados por un enlace o por el buscador se
   * queda sin ninguna señal de dónde está parado: el menú no le muestra nada
   * marcado.
   */
  const grupo = link.closest('.side-group.cerrado');
  if (grupo) {
    const titulo = grupo.querySelector('.group-title');
    if (titulo) titulo.click(); // así también se guarda que quedó abierto
  }
}

/** El día de hoy como lo escribe un campo de fecha: 2026-08-23. */
function hoyISO() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/**
 * Un número como se lee acá: los miles separados con punto y los decimales
 * con coma. 1869969 → "1.869.969".
 */
function fmtNumero(n) {
  if (n == null || n === '') return '';
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Lo mismo, pero es plata: lleva el signo adelante. 4954295 → "$ 4.954.295".
 * El espacio es de los que no se cortan: el signo nunca queda en otra línea.
 */
function fmtMoney(n) {
  if (n == null || n === '') return '';
  /*
   * Al peso, sin centavos: en pesos no existen. Desde la 1.168.0 el sistema los
   * redondea al guardar (ver `coerce` en server/crud.js), pero lo que quedó
   * anotado antes los sigue teniendo, y «$ 765.432,1» en un libro de caja se
   * lee como un error de otra cosa.
   */
  const x = Number(n);
  return '$ ' + (Number.isFinite(x) ? fmtNumero(Math.round(x)) : fmtNumero(n));
}

/**
 * Que la cifra quepa en su tarjeta.
 *
 * Las tarjetas de arriba del libro —ingresos, egresos, balance— llevan la
 * primera cifra que se mira al entrar, y con las de una organización de verdad
 * se cortaban a media cifra: medido en un computador de 1.280 px, a «Ingresos»
 * y a «Egresos» les faltaban 11 px cada una y se leía «$ 182.552.72…».
 *
 * La columna ya se ensanchó para la cifra de nueve dígitos que es el caso
 * corriente (ver styles.css). Esto es para lo que venga después: una cifra de
 * diez u once dígitos, o una pantalla más angosta de lo previsto. En vez de
 * cortarla, se le baja el cuerpo a la letra hasta que entre. Un número más
 * chico se lee; uno cortado, no.
 *
 * No hay manera de preguntarle a CSS cuánto mide un texto, así que se mide
 * después de pintar y solo se toca lo que de verdad se desborda: si todo cabe
 * —el caso de siempre— no cambia nada.
 */
function ajustarCifras(contenedor) {
  const donde = contenedor || document;
  for (const num of donde.querySelectorAll('.fin .num')) {
    num.style.fontSize = '';
    // Del cuerpo de siempre hacia abajo, de dos en dos, hasta 13 px: más chico
    // que eso ya no es una cifra destacada sino letra menuda
    const original = parseFloat(getComputedStyle(num).fontSize) || 21;
    for (let px = original; px >= 13 && num.scrollWidth > num.clientWidth; px -= 2) {
      num.style.fontSize = `${px - 2}px`;
    }
  }
}

/**
 * El número que hay escrito en un campo de los que separan los miles.
 * "1.869.969" → 1869969. Devuelve null cuando no hay nada que leer.
 */
function numeroEscrito(texto) {
  const limpio = String(texto == null ? '' : texto).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (limpio === '' || limpio === '-' || limpio === '.') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * El texto de un campo numérico con los miles ya separados, respetando lo que
 * se está escribiendo: el signo menos solo, la coma decimal recién puesta.
 */
function conMiles(texto) {
  const s = String(texto == null ? '' : texto);
  const negativo = s.trim().startsWith('-');
  const soloNumero = s.replace(/[^\d,]/g, '');
  const coma = soloNumero.indexOf(',');
  const entera = (coma < 0 ? soloNumero : soloNumero.slice(0, coma)).replace(/^0+(?=\d)/, '');
  const decimal = coma < 0 ? '' : ',' + soloNumero.slice(coma + 1).replace(/,/g, '').slice(0, 2);
  const conPuntos = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (!conPuntos && !decimal) return negativo ? '-' : '';
  return (negativo ? '-' : '') + conPuntos + decimal;
}
/** La fecha como la guarda el computador: aaaa-mm-dd, para un campo de fecha. */
function fechaISO(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}
function fechaLarga(s) {
  if (!s) return '____________________';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if (!y || !m || !d) return s;
  return `${d} de ${meses[m - 1]} de ${y}`;
}
/** Día y mes en palabras: "20 de agosto". */
/** "miércoles 20 de agosto", como se dice una fecha en voz alta. */
function diaSemanaYMes(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const cual = new Date(y, m - 1, d);
  const texto = `${dias[cual.getDay()]} ${d} de ${meses[m - 1]}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "hoy", "ayer" o la fecha, para acompañar al día. */
function cuandoFue(iso) {
  const hoy = new Date();
  const dia = (f) => new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const diferencia = Math.round((dia(new Date(y, m - 1, d)) - dia(hoy)) / 864e5);
  if (diferencia === 0) return 'hoy';
  if (diferencia === -1) return 'ayer';
  if (diferencia === 1) return 'mañana';
  if (diferencia < 0) return `hace ${Math.abs(diferencia)} días`;
  return `en ${diferencia} días`;
}

function diaMes(dia, mes) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${dia} de ${meses[mes - 1] || ''}`;
}

function toast(msg, isErr) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    // Un aviso que aparece y se va solo no lo lee nadie si no se anuncia:
    // `status` hace que un lector de pantalla lo diga sin interrumpir lo que
    // la persona esté haciendo.
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = (isErr ? 'err ' : '') + 'show';
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = t.className.replace('show', '')), 3200);
}
/** Deja el RUT solo con dígitos y K. */
function rutLimpiar(v) {
  return String(v == null ? '' : v).replace(/[^0-9kK]/g, '').toUpperCase();
}
/** Muestra el RUT con puntos y guion: 12.345.678-5 */
function rutFormatear(v) {
  const c = rutLimpiar(v);
  if (c.length < 2) return c;
  return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + c.slice(-1);
}

/** Color del distintivo según el nivel informado por un campo calculado. */
function nivelClase(nivel) {
  const n = String(nivel || '').toLowerCase();
  if (/al d[ií]a|cumple|vigente|ok/.test(n)) return 'green';
  if (/observ|parcial|por vencer/.test(n)) return 'yellow';
  if (/pendiente|vencid|incumpl/.test(n)) return 'red';
  return '';
}

function badgeClass(value) {
  const v = String(value || '').toLowerCase();
  if (/(activ|vigente|aprobad|firmad|emitido|entregad|bueno|completad|ingreso|sí)/.test(v)) return 'green';
  if (/(inactiv|anulad|vencid|rechazad|fallecid|malo|de baja|suspendid|egreso|disciplina)/.test(v)) return 'red';
  if (/(pendiente|borrador|revisi|solicitad|regular|reparaci)/.test(v)) return 'yellow';
  return 'blue';
}

/**
 * La cara de una persona donde se la nombra: su foto si la tiene y, si no,
 * sus iniciales. Siempre en el mismo redondel, para que la fila no se mueva
 * según quién tenga foto y quién no.
 */
function retratoDe(quien, iniciales) {
  return quien && quien.foto
    ? `<img class="avatar" src="/uploads/${esc(quien.foto)}" alt="" />`
    : `<span class="avatar">${esc(iniciales || '?')}</span>`;
}

/* ---------------- API ---------------- */
/* ---------------- lo que se pide adelantado ---------------- */
/**
 * Al entrar, la pantalla necesita cuatro cosas del servidor: la descripción del
 * sistema, el panel de control, lo que falta por completar en las fichas y
 * cuántos avisos hay sin leer. Ninguna depende de las otras, pero se pedían en
 * fila: primero la descripción, y recién cuando llegaba se pedía el panel, y
 * recién cuando llegaba el panel se pedía lo que falta.
 *
 * En la oficina no se nota. Con la señal de un teléfono en un templo alejado,
 * cada ida y vuelta son varios cientos de milisegundos, y eran tres esperas
 * puestas una detrás de otra sin ninguna razón.
 *
 * Así que ahora se piden todas juntas, apenas se sabe que hay sesión. Cuando la
 * pantalla llega a necesitar cada una, la respuesta ya viene en camino o ya
 * llegó. Si alguna falla, no pasa nada: se pide de nuevo por el camino de
 * siempre.
 */
const ADELANTADOS = new Map();

/** Empieza a pedir algo antes de que haga falta. */
function adelantar(ruta) {
  if (!TOKEN || ADELANTADOS.has(ruta)) return;
  const pedido = fetch('/api' + ruta, { headers: { Authorization: 'Bearer ' + TOKEN } });
  // Si falla, se atiende cuando alguien lo venga a buscar; que no quede como
  // un error suelto en la consola del navegador.
  pedido.catch(() => {});
  // Si nadie lo vino a buscar —porque se entró directo a otra pantalla—, se
  // suelta: una respuesta sin leer deja la conexión tomada.
  const olvido = setTimeout(() => {
    ADELANTADOS.delete(ruta);
    pedido.then((r) => (r.body && r.body.cancel ? r.body.cancel() : null)).catch(() => {});
  }, 20000);
  ADELANTADOS.set(ruta, { pedido, olvido });
}

/** Lo pedido adelantado, si estaba; se entrega una sola vez. */
function tomarAdelantado(ruta) {
  const guardado = ADELANTADOS.get(ruta);
  if (!guardado) return null;
  ADELANTADOS.delete(ruta);
  clearTimeout(guardado.olvido);
  return guardado.pedido;
}

/** Suelta lo que se haya pedido adelantado y no se vaya a usar. */
function soltarAdelantados() {
  for (const ruta of [...ADELANTADOS.keys()]) {
    const guardado = tomarAdelantado(ruta);
    if (guardado) guardado.then((r) => (r.body && r.body.cancel ? r.body.cancel() : null)).catch(() => {});
  }
}

async function api(method, path, body, isForm) {
  const opts = { method, headers: {} };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  // Si esto ya se había pedido adelantado, se aprovecha ese pedido en vez de
  // hacer otro igual: ver ADELANTADOS, más arriba.
  const adelantado = method === 'GET' && !body ? tomarAdelantado(path) : null;
  let res;
  if (adelantado) {
    try {
      res = await adelantado;
    } catch (e) {
      res = await fetch('/api' + path, opts); // no llegó: se pide de nuevo
    }
  } else {
    res = await fetch('/api' + path, opts);
  }
  if (res.status === 401 && path !== '/auth/login') {
    logout();
    throw new Error('Sesión expirada');
  }
  if (res.status === 503) {
    const info = await res.json().catch(() => ({}));
    if (info.mantenimiento) {
      TOKEN = null;
      USER = null;
      localStorage.removeItem('token');
      renderLogin();
      setTimeout(() => {
        const errEl = document.getElementById('loginError');
        if (errEl) errEl.innerHTML = `<div class="aviso-mantenimiento">🛠️ ${esc(info.error)}</div>`;
      }, 200);
      throw new Error(info.error);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Mientras la contraseña siga siendo la que entregó el administrador, el
    // servidor cierra el resto del sistema: se lleva a cambiarla.
    if (res.status === 403 && data.cambiar_password) {
      renderCambioObligatorio(data.error);
      const err = new Error(data.error);
      err.cambiarPassword = true;
      throw err;
    }
    const err = new Error(data.error || 'Error del servidor');
    err.estado = res.status;
    err.datos = data; // el detalle que mande el servidor (p. ej. una edición simultánea)
    throw err;
  }
  return data;
}

/**
 * Por qué falló algo, dicho en castellano.
 *
 * Cuando `fetch` no consigue hablar con el servidor —sin señal, la red del
 * teléfono cortando la petición, un proxy que no deja pasar el método, el
 * servidor reiniciándose— lanza un error cuyo texto lo escribe el navegador:
 * «Failed to fetch», «Load failed», «NetworkError when attempting to fetch
 * resource». Está en inglés, no dice qué pasó y no sugiere qué hacer. Enseñarle
 * eso a alguien es peor que no decirle nada, porque parece una falla del
 * sistema cuando casi siempre es la conexión.
 *
 * Lo que manda el servidor, en cambio, ya viene escrito para leerse: eso pasa
 * tal cual.
 */
function porQueFalloLaRed(e) {
  const texto = String((e && e.message) || e);
  const deLaRed =
    e instanceof TypeError ||
    /failed to fetch|load failed|networkerror|network request failed/i.test(texto);
  return deLaRed ? 'no se pudo hablar con el servidor. Revise su conexión e intente de nuevo.' : texto;
}
/**
 * Ruta de la que salen las opciones de un campo de referencia. Normalmente es
 * la lista completa del módulo referenciado, salvo que el campo declare su
 * propia ruta (`optionsRoute`) para acotar la lista.
 */
function rutaOpciones(f, valores, { filtrando = false } = {}) {
  /*
   * El módulo apuntado puede decir qué ofrece cuando lo referencian: una
   * iglesia inactiva no sale en los desplegables donde se elige a qué iglesia
   * va algo nuevo, porque el guardado la va a rechazar. Lo declara el módulo
   * apuntado y no los treinta campos que lo apuntan (ver `opcionesPorDefecto`
   * en server/index.js).
   *
   * DOS SALVEDADES, y las dos son la misma idea: eso vale para ELEGIR dónde va
   * algo nuevo, no para mirar lo que ya hay.
   *
   *   · Un FILTRO del listado tiene que seguir ofreciéndolas todas: acotar por
   *     una iglesia retirada es justamente cómo se consulta lo suyo.
   *   · Un campo de VARIAS —«Iglesias que administra», de una cuenta de
   *     usuario— también: alguien tiene que poder quedar a cargo de los
   *     registros de una congregación que se cerró.
   */
  const suyas = !filtrando && f.type === 'ref' && f.ref
    && MOD[f.ref] && MOD[f.ref].opcionesPorDefecto;
  const ruta = f.optionsRoute || suyas || f.ref || 'miembros';
  if (!ruta.includes('{')) return ruta;
  // Una ruta puede depender de otro campo del formulario, como los cargos de
  // una directiva, que salen de los integrantes del cuerpo elegido:
  //   '/directivas/integrantes?cuerpo_id={cuerpo_id}'
  return ruta.replace(/\{(\w+)\}/g, (_, campo) => {
    const v = valores && valores[campo] != null ? valores[campo] : '';
    return encodeURIComponent(String(v));
  });
}

/**
 * Las opciones de un desplegable.
 *
 * Normalmente son las que declara el módulo. Pero un campo puede sacarlas de
 * una ruta (`optionsRoute`) y entonces las mantiene la iglesia como datos: es
 * el caso de las categorías de tesorería, que además se acotan según el
 * movimiento sea un ingreso o un gasto.
 */
function opcionesDe(f, valores) {
  if (!f.optionsRoute) return f.options || [];
  return (optionsCache[rutaOpciones(f, valores)] || []).map((o) => o.label);
}

/**
 * Las opciones de un campo de OTRO módulo, listas para usar.
 *
 * Un campo puede traer su lista de dos maneras: escrita en el módulo
 * (`options`) o pedida a una ruta (`optionsRoute`), que es como vienen todas
 * las que mantiene la iglesia —los tipos de actividad, los motivos de
 * ausencia, las categorías de tesorería—.
 *
 * Los formularios del sistema ya resuelven las dos por su cuenta. Las
 * pantallas hechas a mano —la de Asistencia— leían `f.options` a secas, así
 * que con un campo del segundo tipo recibían una lista VACÍA y no lo decían:
 * el desplegable salía sin nada. Se midió lo que eso costaba: con doce tipos
 * de actividad configurados, el filtro del calendario no ofrecía ninguno, una
 * actividad nueva quedaba siempre con el tipo de fábrica, y editar una ya
 * creada era imposible —el diálogo mandaba el tipo en blanco y el servidor,
 * con razón, lo rechazaba—.
 *
 * Esto lo resuelve una vez: pide la ruta si hace falta y devuelve las
 * etiquetas. Hay que esperarlo, porque puede tener que preguntar.
 */
async function opcionesDelCampo(modulo, campo) {
  const f = MOD[modulo] && (MOD[modulo].fields || []).find((x) => x.name === campo);
  if (!f) return [];
  if (!f.optionsRoute) return f.options || [];
  const ruta = rutaOpciones(f, {});
  await getOptions(ruta).catch(() => []);
  return opcionesDe(f, {});
}

/** Campos de los que depende el selector de otro campo. */
function camposDeLaRuta(f) {
  const ruta = f.optionsRoute || '';
  return [...ruta.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** Lo que el formulario tiene escrito ahora mismo, para resolver esas rutas. */
function valoresDelFormulario() {
  const form = document.getElementById('recForm');
  if (!form) return {};
  const valores = {};
  form.querySelectorAll('[name]').forEach((el) => {
    const valor = el.classList.contains('numero') ? numeroEscrito(el.value) : el.value;
    if (valores[el.name] === undefined || el.value) valores[el.name] = valor == null ? '' : valor;
  });
  return valores;
}
async function getOptions(clave, force) {
  if (!force && optionsCache[clave]) return optionsCache[clave];
  const ruta = clave.startsWith('/') ? clave : `/${clave}/options`;
  let rows = await api('GET', ruta);
  // Para elegir una iglesia basta con su nombre: el de la institución ya está
  // en el menú y en todo lo que se imprime. Vale para CUALQUIER lista de
  // iglesias, no solo para la de siempre: desde la 1.232.0 los formularios
  // piden «/iglesias/activas», y con la comprobación pegada a una sola ruta
  // esos nombres salían largos otra vez.
  if (ruta.startsWith('/iglesias/')) {
    rows = rows.map((o) => ({ ...o, label: iglesiaDeTrabajo(o.label) || o.label }));
  }
  optionsCache[clave] = rows;
  return rows;
}
/**
 * Descarta las opciones guardadas de un módulo. Las listas a medida se
 * descartan siempre, porque pueden depender de varios módulos a la vez.
 */
function invalidarOpciones(modName) {
  optionsCache[modName] = null;
  Object.keys(optionsCache).forEach((k) => {
    if (k.startsWith('/')) optionsCache[k] = null;
  });
}

/* ---------------- arranque y enrutador ---------------- */
/* ===================================================================
 * QUE CADA CAMPO DIGA CÓMO SE LLAMA
 * ===================================================================
 *
 * Un formulario del sistema se ve así:
 *
 *     <div class="fld"><label>Nombre de la institución</label><input ...></div>
 *
 * Quien mira la pantalla lee «Nombre de la institución» y entiende qué va en
 * esa caja. Un lector de pantalla, no: la etiqueta está escrita al lado, pero
 * no está UNIDA al campo, así que anuncia «cuadro de texto, en blanco» y la
 * persona tiene que adivinar. La auditoría contó 64 campos así: 39 en
 * Configuración, 18 en Mi perfil y el resto repartidos.
 *
 * La unión se hace con `for` en la etiqueta e `id` en el campo. Escribirla a
 * mano en cada sitio serían treinta y un lugares en esta pantalla y todos los
 * que se agreguen después, y basta que a uno se le olvide para que vuelva el
 * problema sin que nada falle a la vista. Así que se hace en un solo lugar y
 * sobre lo que de verdad quedó en la página.
 *
 * SE MIRA EL RESULTADO, NO EL CÓDIGO QUE LO ESCRIBIÓ. Los campos salen de tres
 * generadores distintos y de una veintena de formularios escritos a mano, y
 * algunos aparecen después —los que se muestran al elegir una opción, la lista
 * de un campo de varios—. Un observador del navegador ve todo eso igual, venga
 * de donde venga y aparezca cuando aparezca.
 *
 * No toca lo que ya está bien: una etiqueta que ya tiene su `for`, o que
 * envuelve a su propio campo, se deja como está.
 */

/** Cuántos identificadores se han repartido, para que no se repita ninguno. */
let cuantosNombresPuestos = 0;

/**
 * Une cada etiqueta suelta con el campo al que acompaña.
 *
 * Se busca dentro de la misma casilla —el `.fld` que los envuelve— y se toma
 * el primer control con el que se pueda trabajar. Los campos ocultos no
 * cuentan: son los que llevan el valor por debajo y nadie los enfoca.
 */
function unirEtiquetasASusCampos(raiz = document) {
  const SE_PUEDE_ENFOCAR = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"]';
  for (const etiqueta of raiz.querySelectorAll('label:not([for])')) {
    // La que ya envuelve a su campo no necesita nada: la unión es implícita
    if (etiqueta.querySelector('input, select, textarea')) continue;

    const casilla = etiqueta.closest('.fld, .ajuste, .range, .campo') || etiqueta.parentElement;
    if (!casilla) continue;
    const campo = casilla.querySelector(SE_PUEDE_ENFOCAR);
    if (!campo) continue; // una etiqueta que no acompaña a nada: se deja

    // Si el campo ya se explica solo, no se le agrega una segunda voz
    if (campo.getAttribute('aria-label') || campo.getAttribute('aria-labelledby')) continue;

    if (!campo.id) campo.id = `campo${++cuantosNombresPuestos}`;
    etiqueta.htmlFor = campo.id;
  }
}

/**
 * Deja el sistema mirando: cada vez que aparece un formulario, sus etiquetas
 * quedan unidas.
 *
 * Se junta el trabajo de cada cuadro de imagen —un formulario grande cambia el
 * árbol muchas veces seguidas mientras se pinta— para no rehacerlo por cada
 * elemento que entra.
 */
function vigilarQueLosCamposTenganNombre() {
  unirEtiquetasASusCampos();
  let pedido = null;
  const observador = new MutationObserver(() => {
    if (pedido) return;
    pedido = requestAnimationFrame(() => {
      pedido = null;
      unirEtiquetasASusCampos();
    });
  });
  observador.observe(document.body, { childList: true, subtree: true });
}

async function boot() {
  if (!TOKEN) return renderLogin();
  // Todo esto se va a necesitar igual: se pide desde ya, junto con la
  // descripción del sistema, en vez de uno detrás de otro (ver ADELANTADOS).
  adelantar('/avisos/cuantos');
  // El panel es lo que se abre cuando no se pidió otra pantalla. Si se entró
  // derecho a una dirección concreta, no se adelanta nada suyo: sería pedir
  // algo que nadie va a mirar.
  const alPanel = ['', '#', '#/'].includes(location.hash);
  if (alPanel) {
    adelantar('/dashboard');
    adelantar('/pendientes');
  }
  try {
    const meta = await api('GET', '/meta');
    // El nombre y el lema salen de Configuración, no del programa
    if (meta.institucion) {
      if (meta.institucion.nombre) IGLESIA.nombre = meta.institucion.nombre;
      IGLESIA.lema = meta.institucion.lema || '';
      if (meta.institucion.logo) IGLESIA.logo = `/api/configuracion/logo?v=${encodeURIComponent(meta.institucion.logo)}`;
      for (const dato of ['rut', 'direccion', 'telefono', 'email', 'web', 'pie_texto']) {
        IGLESIA[dato] = meta.institucion[dato] || '';
      }
    }
    MODULES = meta.modules;
    MOD = {};
    MODULES.forEach((m) => (MOD[m.name] = m));
    USER = meta.user;
    PERMISOS_CATALOGO = meta.permisosCatalogo || null;
    ROLES = meta.roles || [];
    if (meta.ajustes) AJUSTES = { ...AJUSTES, ...meta.ajustes };
    window.GRUPOS_DEL_MENU = meta.gruposDelMenu || [];
    renderShell();
    vigilarLasCifras();
    route();
  } catch (e) {
    // Lo que se había pedido adelantado ya no se va a usar
    soltarAdelantados();
    if (e && e.cambiarPassword) return; // ya se está mostrando esa pantalla
    renderLogin();
  }
}
function logout() {
  soltarAdelantados();
  // La galleta de sesión —la que deja que el navegador pida las fotos— vive
  // en el servidor: se le avisa que la retire. Si no se alcanza a avisar, la
  // sesión caduca sola igual.
  fetch('/api/auth/salir', { method: 'POST' }).catch(() => {});
  TOKEN = null;
  USER = null;
  localStorage.removeItem('token');
  location.hash = '';
  renderLogin();
}
/**
 * Los clics que antes iban escritos dentro del propio HTML.
 *
 * Una fila que lleva a una ficha se escribía como `onclick="location.hash=…"`,
 * metido en la etiqueta. Funcionaba, pero obliga a permitirle al navegador
 * ejecutar instrucciones escritas dentro de la página, y eso es justo lo que
 * la regla de seguridad del sistema prohíbe ahora (ver server/index.js): sin
 * esa puerta abierta, un texto que alguien lograra colar en una ficha no
 * puede ejecutarse.
 *
 * Así que ahora la etiqueta solo dice a dónde va —`data-ir`— y quien
 * escucha es este único manejador. `data-parar` es para lo que va dentro de
 * una fila y no debe disparar el clic de la fila, como un botón propio.
 */

// `data-parar` se atiende en la ida y no en la vuelta, y ahí mismo se corta el
// viaje del clic. Tiene que ser así: lo que lleva esa marca —el adjunto de una
// fila— está dentro de una fila que sí tiene su propio manejador, puesto
// aparte. Si solo se ignorara acá, la fila igual se abriría y quien quería
// bajar el archivo terminaría en otra pantalla.
document.addEventListener(
  'click',
  (e) => {
    if (e.target.closest && e.target.closest('[data-parar]')) e.stopPropagation();
  },
  true
);

document.addEventListener('click', (e) => {
  for (let el = e.target; el && el !== document; el = el.parentElement) {
    if (el.dataset && el.dataset.parar !== undefined) return; // lo suyo, no lo de la fila
    if (el.dataset && el.dataset.imprimir !== undefined) {
      if (!tieneLlave('datos_impresion')) return toast('Su cuenta no tiene permiso para imprimir', true);
      window.print();
      return;
    }
    if (el.dataset && el.dataset.ir) { location.hash = el.dataset.ir; return; }
  }
});

window.addEventListener('hashchange', () => {
  if (TOKEN && USER) route();
});

/**
 * Lo que hay que soltar al cambiar de pantalla.
 *
 * Una pantalla puede colgar oyentes de la ventana entera —el cambio de tamaño,
 * sobre todo—, y esos NO se los lleva el barrido: la pantalla siguiente
 * reemplaza el contenido, pero el oyente se queda mirando algo que ya no
 * existe. Cada visita dejaba uno más.
 *
 * Acá se lleva una señal por pantalla: al cambiar de una a otra se corta, y
 * todo lo que se colgó con `{ signal: alCambiarDePantalla() }` se suelta solo.
 */
let mandoDeLaPantalla = null;
function alCambiarDePantalla() {
  if (!mandoDeLaPantalla) mandoDeLaPantalla = new AbortController();
  return mandoDeLaPantalla.signal;
}
function barridoDePantalla() {
  if (mandoDeLaPantalla) mandoDeLaPantalla.abort();
  mandoDeLaPantalla = new AbortController();
}

function route() {
  barridoDePantalla();
  const [ruta, consulta] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = ruta.split('/').filter(Boolean);
  /**
   * El diseño de la credencial solo vale en las dos pantallas donde se dibuja
   * —la de impresión y la ficha, que lleva el encuadre de la foto—. Fuera de
   * ellas se suelta: si se queda puesta, le gana a la hoja del sistema y deja
   * todas las tarjetas del tamaño de una credencial.
   */
  const seDibujaLaCredencial = parts[1] === 'credenciales'
    && (parts[0] === 'print' || (parts[0] === 'm' && parts[2] === 'ficha'));
  if (!seDibujaLaCredencial) soltarEstiloDeCredencial();

  /*
   * Y lo mismo con la hoja del certificado, que es de UNA página por
   * definición: se aprieta al alto del papel y lo que sobre se recorta. Esa
   * regla estaba escrita para todo lo que el sistema imprime —al final de la
   * hoja de estilos, donde le gana a las demás—, así que recortaba también la
   * ficha larga de una persona: de 60 anotaciones se imprimían 7 y la hoja no
   * decía nada. Acá se enciende solo donde corresponde.
   */
  document.documentElement.classList.toggle(
    'hoja-de-una-pagina', parts[0] === 'print' && parts[1] === 'certificados'
  );

  // Valores para precargar un formulario nuevo: #/m/modulo/new?campo=valor
  const precarga = {};
  if (consulta) new URLSearchParams(consulta).forEach((v, k) => (precarga[k] = v));
  document.querySelectorAll('.side-link').forEach((el) => {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  });
  const sb = document.querySelector('.sidebar');
  if (sb) sb.classList.remove('open');
  const bd = document.getElementById('backdrop');
  if (bd) bd.classList.remove('show');

  if (parts[0] === 'm' && MOD[parts[1]]) {
    const name = parts[1];
    const link = document.querySelector(`.side-link[data-mod="${name}"]`);
    if (link) marcarActivo(link);
    if (parts[2] === 'new') return viewForm(name, null, precarga);
    if (parts[2] === 'ficha' && parts[3]) return viewFicha(name, parts[3], parts[4]);
    if (parts[2] === 'edit' && parts[3]) return viewForm(name, parts[3]);
    return viewList(name, precarga);
  }
  if (parts[0] === 'asistencia' && MOD['asistencias']) {
    const al = document.querySelector('.side-link[data-mod="_asistencia"]');
    if (al) marcarActivo(al);
    return viewAsistencia({ ...precarga, tab: parts[1] === 'informes' ? 'informes' : precarga.tab });
  }
  // Direcciones antiguas: llevan a la misma pantalla, que ahora reúne todo
  if (parts[0] === 'pasar-lista' && MOD['asistencias']) {
    return (location.hash = parts[1] ? `#/asistencia?actividad=${parts[1]}` : '#/asistencia');
  }
  if (parts[0] === 'informes' && parts[1] === 'asistencia' && MOD['asistencias']) {
    return (location.hash = '#/asistencia/informes');
  }
  if (parts[0] === 'servicios' && parts[1] === 'informe' && MOD['servicios']) {
    const sl = document.querySelector('.side-link[data-mod="servicios"]');
    if (sl) marcarActivo(sl);
    return viewInformeServicios(precarga);
  }
  if (parts[0] === 'ayudas_sociales' && parts[1] === 'informe' && MOD['ayudas_sociales']) {
    const sl = document.querySelector('.side-link[data-mod="ayudas_sociales"]');
    if (sl) marcarActivo(sl);
    return viewInformeAyudas(precarga);
  }
  if (parts[0] === 'tesoreria' && parts[1] === 'balance' && MOD['tesoreria']) {
    const sl = document.querySelector('.side-link[data-mod="tesoreria"]');
    if (sl) marcarActivo(sl);
    return viewBalanceTesoreria(precarga);
  }
  if (parts[0] === 'inventarios' && parts[1] === 'hoja' && parts[2] && MOD['inventarios']) {
    const sl = document.querySelector('.side-link[data-mod="inventarios"]');
    if (sl) marcarActivo(sl);
    return viewHojaDeInventario(parts[2], parts[3]);
  }
  if (parts[0] === 'cuentas_tesoreria' && parts[1] === 'cartola' && parts[2] && MOD['cuentas_tesoreria']) {
    const sl = document.querySelector('.side-link[data-mod="cuentas_tesoreria"]');
    if (sl) marcarActivo(sl);
    return viewCartolaCuenta(parts[2], precarga);
  }
  if (parts[0] === 'solicitudes' && parts[1] === 'bandeja' && MOD['solicitudes']) {
    const sl = document.querySelector('.side-link[data-mod="solicitudes"]');
    if (sl) marcarActivo(sl);
    return viewBandejaSolicitudes(precarga);
  }
  if (parts[0] === 'documentos' && parts[1] === 'libro' && MOD['documentos']) {
    const dl = document.querySelector('.side-link[data-mod="documentos"]');
    if (dl) marcarActivo(dl);
    return viewLibroDePartes(precarga);
  }
  if (parts[0] === 'cuenta' || parts[0] === 'perfil') {
    const cl = document.querySelector('.side-link[data-mod="_cuenta"]');
    if (cl) marcarActivo(cl);
    return viewMiPerfil(precarga);
  }
  if (parts[0] === 'mis-mensajes') {
    // Sin llave: son los mensajes que le escribieron a uno, no los que uno manda
    return viewMisMensajes();
  }
  if (parts[0] === 'mensajes' && tieneLlave('avisos_enviar')) {
    const ml = document.querySelector('.side-link[data-mod="_mensajes"]');
    if (ml) marcarActivo(ml);
    return viewMensajes();
  }
  if (parts[0] === 'config' && tieneLlave('sistema_configuracion')) {
    const cl = document.querySelector('.side-link[data-mod="_config"]');
    if (cl) marcarActivo(cl);
    return viewConfiguracion();
  }
  if (parts[0] === 'print' && MOD[parts[1]] && parts[2]) {
    // También acá, no solo escondiendo el botón: una dirección de impresión
    // guardada o pasada a alguien no puede saltarse la llave.
    if (!tieneLlave('datos_impresion')) {
      return (content().innerHTML =
        '<div class="page-head"><h2>🖨️ Imprimir</h2></div>' +
        '<p>Su cuenta no tiene permiso para imprimir. Puede seguir viendo y buscando en pantalla.</p>');
    }
    return viewPrint(parts[1], parts[2]);
  }
  const dl = document.querySelector('.side-link[data-mod="_dash"]');
  if (dl) marcarActivo(dl);
  return viewDashboard();
}

/**
 * En «Mi perfil», con qué iglesias está trabajando.
 *
 * El botón de la barra de arriba solo aparece cuando hay entre qué elegir, y
 * cuando no aparece uno se queda sin saber por qué. Acá se dice siempre: con
 * cuáles trabaja, cuántas alcanza y, si alcanza una sola, que es por eso y no
 * porque falte el botón.
 */
function pintarIglesiasDelPerfil() {
  const caja = document.getElementById('perfilIglesias');
  if (!caja) return;
  const disponibles = USER.iglesias_disponibles || [];
  const elegidas = USER.iglesias_trabajando || [];
  const nombreDe = (id) => {
    const i = disponibles.find((x) => x.id === id);
    return i ? iglesiaDeTrabajo(i.nombre) : `#${id}`;
  };

  if (!disponibles.length) {
    caja.remove();
    return;
  }

  const conQue = elegidas.length
    ? elegidas.map(nombreDe).join(' · ')
    : disponibles.length === 1
      ? iglesiaDeTrabajo(disponibles[0].nombre)
      : `Todas las suyas (${fmtNumero(disponibles.length)})`;

  caja.innerHTML = `
    <div class="toolbar">
      <b>⛪ Con qué iglesia trabaja</b>
      <span class="spacer"></span>
      ${disponibles.length > 1 ? '<button class="btn secondary sm" id="perfilCambiarIglesia">Cambiar</button>' : ''}
    </div>
    <div class="perfil-fijos">
      <div><span class="mut">Ahora mismo</span><b>${esc(conQue)}</b></div>
      <div><span class="mut">Alcanza</span><b>${fmtNumero(disponibles.length)} iglesia(s)</b></div>
    </div>
    <div class="help" style="padding:0 20px 16px">
      ${disponibles.length > 1
        ? 'Lo que elija acota todo el sistema: los listados, los informes y lo que registre. También se cambia desde el botón de arriba, junto al nombre de la iglesia.'
        : 'Administra una sola iglesia, así que no hay entre qué elegir. Para alcanzar más, la oficina tiene que agregárselas en «Iglesias que administra», en su usuario.'}
    </div>`;

  const btn = document.getElementById('perfilCambiarIglesia');
  if (btn) btn.addEventListener('click', elegirIglesiaDeTrabajo);
}

/**
 * Elegir con qué iglesia o iglesias trabajar.
 *
 * Quien alcanza varias no siempre las quiere ver todas juntas: el domingo está
 * en una y el lunes revisa otra, y una lista con los miembros de las cinco
 * mezclados no le sirve de nada. Acá elige, y lo que elija acota **todo** el
 * sistema —lo que ve y lo que guarda—, no solo la pantalla que tiene delante.
 *
 * Se puede cambiar cuando quiera, y «Todas las que tengo» siempre está a un
 * toque: nadie queda encerrado en una iglesia sin darse cuenta.
 */
async function elegirIglesiaDeTrabajo() {
  const disponibles = USER.iglesias_disponibles || [];
  if (disponibles.length < 2) return;
  const elegidas = new Set(USER.iglesias_trabajando || []);

  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-head"><h3>⛪ ¿Con qué iglesia trabaja?</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body">
        <p class="mut" style="margin:0 0 12px;font-size:13.5px;line-height:1.5">
          Lo que elija acota todo el sistema: los listados, los informes y lo que registre.
          Puede cambiarlo cuando quiera.
        </p>
        <button type="button" class="ig-todas ${elegidas.size ? '' : 'on'}" id="igTodas">
          <b>Todas las que tengo</b>
          <span class="mut">${fmtNumero(disponibles.length)} iglesias</span>
        </button>
        <div class="ig-lista">
          ${disponibles.map((i) => `
            <button type="button" class="ig-una ${elegidas.has(i.id) ? 'on' : ''}" data-id="${i.id}">
              <span class="tic">${elegidas.has(i.id) ? '✓' : ''}</span>
              <span class="nm">${esc(iglesiaDeTrabajo(i.nombre))}</span>
            </button>`).join('')}
        </div>
        <div class="form-error" id="igError" style="padding:8px 0 0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="igCancelar">Cancelar</button>
        <button class="btn" id="igGuardar">Trabajar con esto</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);

  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#igCancelar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });

  const pintar = () => {
    fondo.querySelector('#igTodas').classList.toggle('on', elegidas.size === 0);
    fondo.querySelectorAll('.ig-una').forEach((b) => {
      const puesta = elegidas.has(Number(b.dataset.id));
      b.classList.toggle('on', puesta);
      b.querySelector('.tic').textContent = puesta ? '✓' : '';
    });
  };

  fondo.querySelector('#igTodas').addEventListener('click', () => { elegidas.clear(); pintar(); });
  fondo.querySelectorAll('.ig-una').forEach((b) => {
    b.addEventListener('click', () => {
      const id = Number(b.dataset.id);
      if (elegidas.has(id)) elegidas.delete(id);
      else elegidas.add(id);
      pintar();
    });
  });

  fondo.querySelector('#igGuardar').addEventListener('click', async () => {
    try {
      await api('PUT', '/auth/iglesias-de-trabajo', { iglesias: [...elegidas] });
      cerrar();
      // Todo lo que está en pantalla se pidió con el alcance anterior: se
      // vuelve a armar entero, que es más honesto que refrescar a medias.
      location.reload();
    } catch (e) {
      fondo.querySelector('#igError').textContent = e.message;
    }
  });
}

/* ---------------- login ---------------- */
function renderLogin() {
  $app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <img class="logo" src="${IGLESIA.logo}" alt="${esc(IGLESIA.nombre)}" />
        <h1>${esc(SISTEMA)}</h1>
        ${IGLESIA.lema ? `<p class="lema">${esc(IGLESIA.lema)}</p>` : ''}
        <p class="sub">Ingrese con su RUT para continuar</p>
        <div class="login-error" id="loginError"></div>
        <input type="text" id="loginRut" placeholder="RUT (ej: 12.345.678-5)" required autocomplete="username" inputmode="text" />
        <input type="password" id="loginPass" placeholder="Contraseña" required autocomplete="current-password" />
        <button class="btn" type="submit">Iniciar sesión</button>
        <button type="button" class="enlace-suave" id="olvide">¿Olvidó su contraseña?</button>
        <div class="login-version" id="loginVersion"></div>
      </form>
    </div>`;
  // Aviso de mantenimiento (si está activo) e identidad configurada
  fetch('/api/configuracion/publica')
    .then((r) => r.json())
    .then((c) => {
      // La identidad configurada manda sobre la que trae el programa. El
      // título de la tarjeta no se toca: ese es el nombre del sistema.
      if (c.iglesia_nombre) {
        IGLESIA.nombre = c.iglesia_nombre;
        const logo = document.querySelector('.login-card .logo');
        if (logo) logo.alt = c.iglesia_nombre;
      }
      if (c.iglesia_logo) {
        IGLESIA.logo = `/api/configuracion/logo?v=${encodeURIComponent(c.iglesia_logo)}`;
        const logo = document.querySelector('.login-card .logo');
        if (logo) logo.src = IGLESIA.logo;
      }
      IGLESIA.lema = c.iglesia_lema || '';
      const lema = document.querySelector('.login-card p.lema');
      if (lema) lema.remove();
      if (IGLESIA.lema) {
        const titulo = document.querySelector('.login-card h1');
        if (titulo) titulo.insertAdjacentHTML('afterend', `<p class="lema">${esc(IGLESIA.lema)}</p>`);
      }

      if (String(c.mantenimiento_activo) === '1') {
        const errEl = document.getElementById('loginError');
        if (errEl) {
          errEl.innerHTML = `<div class="aviso-mantenimiento">🛠️ ${esc(c.mantenimiento_mensaje || 'Sistema en mantenimiento.')}
            <span>Solo puede ingresar quien administre la configuración del sistema.</span></div>`;
        }
      }
    })
    .catch(() => {});

  // Mostrar la versión en ejecución (ayuda a confirmar que el sistema ya se actualizó)
  fetch('/health')
    .then((r) => r.json())
    .then((d) => {
      const el = document.getElementById('loginVersion');
      if (el && d.version) el.textContent = 'versión ' + d.version;
    })
    .catch(() => {});

  const rutInput = document.getElementById('loginRut');
  rutInput.addEventListener('blur', () => {
    if (rutInput.value && !rutInput.value.includes('@')) rutInput.value = rutFormatear(rutInput.value);
  });
  document.getElementById('olvide').addEventListener('click', () => abrirRecuperacion(rutInput.value));
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      const data = await api('POST', '/auth/login', {
        rut: document.getElementById('loginRut').value,
        password: document.getElementById('loginPass').value,
      });
      TOKEN = data.token;
      localStorage.setItem('token', TOKEN);
      await boot();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* ---------------- estructura principal ---------------- */
/* =====================================================================
 * Contraseñas: cambiarla, recuperarla y la pregunta secreta
 *
 * La contraseña que entrega el administrador —la inicial del sistema o una
 * que él escriba— sirve para entrar una vez: el sistema obliga a cambiarla
 * por una propia. Después, quien la olvide la recupera respondiendo su
 * pregunta secreta, y si no la tiene, el administrador se la restablece.
 * ===================================================================== */

/** Pantalla que aparece en el primer ingreso: no se puede hacer nada más. */
async function renderCambioObligatorio(aviso) {
  if (document.getElementById('cambioForm')) return; // ya está en pantalla
  $app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="cambioForm">
        <img class="logo" src="${IGLESIA.logo}" alt="" />
        <h1>Cambie su contraseña</h1>
        <p class="sub">${esc(aviso || 'Está entrando con la contraseña que le entregaron. Elija una suya, que solo usted conozca.')}</p>
        <div class="login-error" id="cambioError"></div>
        <input type="password" id="cambioNueva" placeholder="Contraseña nueva" required autocomplete="new-password" />
        <input type="password" id="cambioRepetir" placeholder="Repítala" required autocomplete="new-password" />
        <button class="btn" type="submit">Guardar y entrar</button>
        <button type="button" class="enlace-suave" id="cambioSalir">Salir</button>
      </form>
    </div>`;
  document.getElementById('cambioSalir').addEventListener('click', logout);
  document.getElementById('cambioForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('cambioError');
    const nueva = document.getElementById('cambioNueva').value;
    if (nueva !== document.getElementById('cambioRepetir').value) {
      err.textContent = 'Las dos contraseñas no coinciden.';
      return;
    }
    err.textContent = '';
    try {
      const r = await api('POST', '/auth/cambiar-password', { nueva });
      // Cambiar la contraseña cierra las sesiones de la cuenta, y esta también
      // quedaría afuera: el servidor entrega un pase nuevo y hay que guardarlo.
      if (r && r.token) { TOKEN = r.token; localStorage.setItem('token', TOKEN); }
      toast('Contraseña cambiada');
      await pedirPreguntaSecreta();
      await boot();
    } catch (e2) {
      err.textContent = e2.message;
    }
  });
}

/**
 * Justo después de elegir su contraseña se ofrece definir la pregunta con la
 * que podrá recuperarla. Se puede dejar para después, pero es el momento en
 * que sirve.
 */
function pedirPreguntaSecreta() {
  return new Promise((resolve) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-head"><h3>🔑 Para no quedarse afuera</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
        <div class="modal-body">
          <p class="modal-nota" style="margin-top:0">
            Si algún día olvida su contraseña, respondiendo esta pregunta podrá elegir una nueva usted mismo,
            sin depender de nadie. Elija algo que solo usted sepa y que no cambie con el tiempo.
          </p>
          <div class="fld"><label>Pregunta</label>
            <input type="text" id="psPregunta" list="psSugerencias" placeholder="Ej: ¿Cómo se llamaba mi primera mascota?" />
            <datalist id="psSugerencias">
              <option value="¿Cómo se llamaba mi primera mascota?"></option>
              <option value="¿En qué ciudad nació mi madre?"></option>
              <option value="¿Cuál es el nombre de mi abuelo materno?"></option>
              <option value="¿Cuál fue mi primer trabajo?"></option>
              <option value="¿En qué año me bauticé?"></option>
            </datalist>
          </div>
          <div class="fld" style="margin-top:12px"><label>Respuesta</label>
            <input type="text" id="psRespuesta" placeholder="Su respuesta" autocomplete="off" />
            <div class="help">No importan las mayúsculas ni las tildes al responderla.</div>
          </div>
          <div class="form-error" id="psError" style="padding:0"></div>
        </div>
        <div class="modal-foot">
          <button class="btn secondary" id="psLuego">Ahora no</button>
          <button class="btn" id="psGuardar">💾 Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(fondo);
    const cerrar = () => { fondo.remove(); resolve(); };
    fondo.querySelector('.cerrar').addEventListener('click', cerrar);
    fondo.querySelector('#psLuego').addEventListener('click', cerrar);
    fondo.querySelector('#psGuardar').addEventListener('click', async () => {
      try {
        await api('POST', '/auth/pregunta-secreta', {
          pregunta: fondo.querySelector('#psPregunta').value,
          respuesta: fondo.querySelector('#psRespuesta').value,
        });
        toast('Pregunta guardada');
        cerrar();
      } catch (e) {
        fondo.querySelector('#psError').textContent = e.message;
      }
    });
  });
}

/** Recuperar la contraseña desde la pantalla de acceso, sin haber entrado. */
function abrirRecuperacion(rutInicial) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-head"><h3>🔑 Recuperar la contraseña</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body" id="recBody">
        <div class="fld"><label>Su RUT</label>
          <input type="text" id="recRut" value="${esc(rutFormatear(rutInicial || ''))}" placeholder="12.345.678-5" /></div>
        <div class="form-error" id="recError" style="padding:0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="recCancelar">Cancelar</button>
        <button class="btn" id="recSeguir">Continuar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#recCancelar').addEventListener('click', cerrar);
  const error = (t) => (fondo.querySelector('#recError').textContent = t);

  fondo.querySelector('#recSeguir').addEventListener('click', async () => {
    const rut = fondo.querySelector('#recRut').value;
    error('');
    let datos;
    try {
      datos = await api('POST', '/auth/recuperar/pregunta', { rut });
    } catch (e) {
      return error(e.message);
    }
    // Segundo paso: responder y elegir la contraseña nueva
    fondo.querySelector('#recBody').innerHTML = `
      <p class="modal-nota" style="margin-top:0">Responda su pregunta y elija una contraseña nueva.</p>
      <div class="fld"><label>${esc(datos.pregunta)}</label>
        <input type="text" id="recRespuesta" autocomplete="off" placeholder="Su respuesta" /></div>
      <div class="fld" style="margin-top:12px"><label>Contraseña nueva</label>
        <input type="password" id="recNueva" autocomplete="new-password" /></div>
      <div class="fld" style="margin-top:12px"><label>Repítala</label>
        <input type="password" id="recRepetir" autocomplete="new-password" /></div>
      <div class="help">Le quedan ${datos.intentos_restantes} intento(s).</div>
      <div class="form-error" id="recError" style="padding:0"></div>`;
    const boton = fondo.querySelector('#recSeguir');
    boton.textContent = '💾 Cambiar la contraseña';
    const nuevoBoton = boton.cloneNode(true); // se reemplazan los escuchas del paso anterior
    boton.parentNode.replaceChild(nuevoBoton, boton);
    nuevoBoton.addEventListener('click', async () => {
      const nueva = fondo.querySelector('#recNueva').value;
      if (nueva !== fondo.querySelector('#recRepetir').value) {
        return (fondo.querySelector('#recError').textContent = 'Las dos contraseñas no coinciden.');
      }
      try {
        await api('POST', '/auth/recuperar', {
          rut, respuesta: fondo.querySelector('#recRespuesta').value, nueva,
        });
        cerrar();
        toast('Contraseña cambiada: ya puede entrar');
        const pass = document.getElementById('loginPass');
        if (pass) pass.focus();
      } catch (e) {
        fondo.querySelector('#recError').textContent = e.message;
      }
    });
  });
}

/**
 * Mi perfil: los datos propios de cada persona y su seguridad.
 *
 * Los campos se dibujan con la misma maquinaria que cualquier ficha del
 * sistema —mismas etiquetas, mismas listas, mismas condiciones—, pero el
 * servidor decide cuáles son suyos: lo que resuelve la iglesia no aparece
 * aquí para cambiarlo, sino al lado, para verlo.
 *
 * Si la persona está enlazada a su ficha de miembro, lo que guarda va allá y
 * su cuenta de usuario queda al día sola.
 */
async function viewMiPerfil(precarga) {
  const pedida = precarga && precarga.tab;
  const pestana = pedida === 'seguridad' || pedida === 'avisos' ? pedida : 'datos';
  content().innerHTML = `
    <div class="page-head">
      <div>
        <h2>🙋 Mi perfil</h2>
        <p class="sub-iglesia">${esc(USER.nombre)} · ${esc(rutFormatear(USER.rut || ''))}</p>
      </div>
    </div>
    <div class="tabs" id="perfilTabs">
      <button data-tab="datos" class="${pestana === 'datos' ? 'on' : ''}">📝 Mis datos</button>
      <button data-tab="avisos" class="${pestana === 'avisos' ? 'on' : ''}">🔔 Mis avisos</button>
      <button data-tab="seguridad" class="${pestana === 'seguridad' ? 'on' : ''}">🔐 Seguridad</button>
    </div>
    <div id="tabDatos" ${pestana === 'datos' ? '' : 'hidden'}></div>
    <div id="tabAvisos" ${pestana === 'avisos' ? '' : 'hidden'}></div>
    <div id="tabSeguridad" ${pestana === 'seguridad' ? '' : 'hidden'}></div>`;

  content().querySelectorAll('#perfilTabs button').forEach((b) => {
    b.addEventListener('click', () => {
      content().querySelectorAll('#perfilTabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('tabDatos').hidden = b.dataset.tab !== 'datos';
      document.getElementById('tabAvisos').hidden = b.dataset.tab !== 'avisos';
      document.getElementById('tabSeguridad').hidden = b.dataset.tab !== 'seguridad';
    });
  });

  renderSeguridad(document.getElementById('tabSeguridad'));
  renderMisDatos(document.getElementById('tabDatos'));
  renderMisAvisos(document.getElementById('tabAvisos'));
}

/** Los datos propios, con el mismo formulario que usa el resto del sistema. */
async function renderMisDatos(zona) {
  let d;
  try {
    d = await api('GET', '/auth/perfil');
  } catch (e) {
    zona.innerHTML = `<div class="card"><div class="empty-state" style="padding:26px">${esc(e.message)}</div></div>`;
    return;
  }

  const f = d.ficha;
  zona.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <b>Lo que decide la iglesia</b>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12.5px">esto se cambia en la oficina</span>
      </div>
      <div class="perfil-fijos">
        <div><span class="mut">RUT</span><b>${esc(rutFormatear(f.rut || ''))}</b></div>
        ${f.tratamiento ? `<div><span class="mut">Trato</span><b>${esc(f.tratamiento)}</b></div>` : ''}
        <div><span class="mut">Iglesia</span><b>${esc(f.iglesia || '—')}</b></div>
        ${f.tipo_miembro ? `<div><span class="mut">Tipo de miembro</span><b>${esc(f.tipo_miembro)}</b></div>` : ''}
        ${f.estado ? `<div><span class="mut">Estado</span><b>${esc(f.estado)}</b></div>` : ''}
        ${f.fecha_bautismo ? `<div><span class="mut">Bautismo</span><b>${esc(fechaCorta(f.fecha_bautismo))}</b></div>` : ''}
        <div><span class="mut">Rol en el sistema</span><b>${esc(f.rol || '')}</b></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px" id="perfilIglesias"></div>

    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>📝 Mis datos</b>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:12.5px">${d.enlazado
          ? 'se guardan en su ficha de miembro'
          : 'su cuenta todavía no está enlazada a una ficha de miembro'}</span>
      </div>
      <form id="recForm">
        <div class="form-grid" id="formGrid">
          ${d.campos.map((campo) => fieldHtml(campo, d.datos, false)).join('')}
        </div>
        <div class="form-error" id="perfilError"></div>
        <div class="form-foot"><button class="btn" type="submit">💾 Guardar mis datos</button></div>
      </form>
    </div>`;

  pintarIglesiasDelPerfil();

  // Los mismos comportamientos que en cualquier ficha: foto que se ajusta al
  // subirla, edad al lado de la fecha, listas con buscador y campos que solo
  // aplican según otro (las fechas de matrimonio).
  d.campos.forEach((campo) => {
    if (campo.type === 'file') initFileField(campo);
    if (campo.type === 'select') initSelectBuscable(campo);
    if (campo.mostrarEdad) initEdad(campo);
  });
  aplicarCondiciones();

  document.getElementById('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('perfilError');
    err.textContent = '';
    try {
      const r = await api('PUT', '/auth/perfil', collectForm({ fields: d.campos }));
      toast('Sus datos quedaron guardados');
      // El nombre y la foto pueden haber cambiado: la barra superior tiene
      // que reflejarlo sin obligar a recargar la página
      const me = await api('GET', '/auth/me');
      USER = { ...USER, ...me.user };
      const quien = document.querySelector('.who b');
      if (quien) quien.textContent = USER.nombre;
      const cara = document.querySelector('.who .avatar');
      if (cara) {
        const iniciales = (USER.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
        cara.outerHTML = retratoDe(USER, iniciales);
      }
      d.datos = r.perfil ? r.perfil.datos : d.datos;
    } catch (e2) {
      err.textContent = e2.message;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/** Seguridad: la propia contraseña y la pregunta con que se recupera. */
function renderSeguridad(zona) {
  zona.innerHTML = `
    <div class="card">
      <div class="toolbar"><b>Contraseña</b></div>
      <form class="form-grid" id="mcForm">
        <div class="fld"><label>Contraseña actual</label><input type="password" id="mcActual" autocomplete="current-password" /></div>
        <div class="fld"></div>
        <div class="fld"><label>Contraseña nueva</label><input type="password" id="mcNueva" autocomplete="new-password" /></div>
        <div class="fld"><label>Repítala</label><input type="password" id="mcRepetir" autocomplete="new-password" /></div>
        <div class="form-error full" id="mcError"></div>
        <div class="full" style="text-align:right"><button class="btn" type="submit">💾 Cambiar la contraseña</button></div>
      </form>
    </div>
    <div id="mcPregunta"></div>`;

  document.getElementById('mcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('mcError');
    const nueva = document.getElementById('mcNueva').value;
    if (nueva !== document.getElementById('mcRepetir').value) {
      err.textContent = 'Las dos contraseñas no coinciden.';
      return;
    }
    err.textContent = '';
    try {
      const r = await api('POST', '/auth/cambiar-password', {
        actual: document.getElementById('mcActual').value, nueva,
      });
      if (r && r.token) { TOKEN = r.token; localStorage.setItem('token', TOKEN); }
      toast('Contraseña cambiada. Si había entrado desde otro aparato, ahí se cerró la sesión.');
      document.getElementById('mcForm').reset();
      pintarPregunta();
    } catch (e2) {
      err.textContent = e2.message;
    }
  });

  async function pintarPregunta() {
    const zona = document.getElementById('mcPregunta');
    let estado;
    try {
      estado = await api('GET', '/auth/pregunta-secreta');
    } catch (e) {
      zona.innerHTML = '';
      return;
    }
    if (!estado.activa) {
      zona.innerHTML = `<div class="card" style="margin-top:18px"><div class="empty-state" style="padding:24px">
        La recuperación por pregunta está desactivada. Si olvida su contraseña, pídale al administrador que se la restablezca.
      </div></div>`;
      return;
    }
    zona.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🔑 Pregunta de recuperación</b>
          <span class="spacer"></span>
          <span class="badge ${estado.tiene_pregunta ? 'green' : 'amber'}">${estado.tiene_pregunta ? 'Definida' : 'Sin definir'}</span>
        </div>
        <div style="padding:16px 18px">
          <p style="margin-top:0;font-size:13.5px;color:var(--muted)">
            Con ella puede elegir una contraseña nueva usted mismo si olvida la suya, desde la pantalla de acceso.
            ${estado.bloqueada ? '<b style="color:var(--danger)">Quedó bloqueada por intentos fallidos: pida al administrador que la habilite.</b>' : ''}
          </p>
          ${estado.tiene_pregunta ? `<p style="font-size:14px"><b>${esc(estado.pregunta)}</b></p>` : ''}
          <button class="btn secondary sm" id="mcDefinir">${estado.tiene_pregunta ? '✏️ Cambiarla' : '➕ Definirla'}</button>
          ${estado.tiene_pregunta ? '<button class="btn secondary sm" id="mcQuitar">Quitarla</button>' : ''}
        </div>
      </div>`;
    document.getElementById('mcDefinir').addEventListener('click', async () => {
      await pedirPreguntaSecreta();
      pintarPregunta();
    });
    const quitar = document.getElementById('mcQuitar');
    if (quitar) {
      quitar.addEventListener('click', async () => {
        if (!confirm('¿Quitar su pregunta de recuperación?\n\nSi olvida su contraseña tendrá que pedirle al administrador que se la restablezca.')) return;
        await api('POST', '/auth/pregunta-secreta', { quitar: true });
        toast('Pregunta quitada');
        pintarPregunta();
      });
    }
  }
  pintarPregunta();
}

/**
 * Cómo está el acceso de una cuenta, al pie de su ficha: qué contraseña
 * tiene, cómo restablecerla y cómo está su recuperación.
 */
async function renderClaveUsuario(usuarioId, contenedor) {
  let d;
  try {
    d = await api('GET', `/usuarios/${usuarioId}/clave`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }
  const c = d.clave || {};
  const r = d.recuperacion || {};
  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🔐 Acceso de ${esc(d.nombre || '')}</b>
        <span class="spacer"></span>
        <span class="badge ${nivelClase(c.nivel)}">${esc(c.texto || '')}</span>
      </div>
      <div style="padding:16px 18px">
        ${c.clave ? `
          <div class="clave-provisoria">
            <div><span class="mut">Entra con el RUT</span><b>${esc(rutFormatear(d.rut || ''))}</b></div>
            <div><span class="mut">y la contraseña</span><b>${esc(c.clave)}</b></div>
          </div>` : ''}
        <p style="font-size:13px;color:var(--muted);margin:12px 0 0">${esc(c.detalle || '')}</p>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          ${d.puede_restablecer ? '<button class="btn secondary sm" id="clRestablecer">🔄 Restablecer a la contraseña inicial</button>' : ''}
          ${r.bloqueada && d.puede_restablecer ? '<button class="btn secondary sm" id="clDesbloquear">🔓 Habilitar su recuperación</button>' : ''}
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:14px 0 0">
          Pregunta de recuperación: <b>${r.tiene_pregunta ? esc(r.pregunta) : 'sin definir'}</b>${
            r.bloqueada ? ' — <b style="color:var(--danger)">bloqueada por intentos fallidos</b>' : ''}
        </p>
      </div>
    </div>`;

  const restablecer = document.getElementById('clRestablecer');
  if (restablecer) {
    restablecer.addEventListener('click', async () => {
      if (!confirm(`¿Restablecer la contraseña de ${d.nombre} a la inicial del sistema?\n\n` +
        'La que tenga ahora dejará de servir, y al entrar tendrá que elegir una nueva.')) return;
      try {
        const res = await api('POST', `/usuarios/${usuarioId}/restablecer-clave`);
        toast('Contraseña restablecida');
        renderClaveUsuario(usuarioId, contenedor);
        alert(`Contraseña restablecida.\n\nEntréguele estos datos a ${res.nombre}:\n\n` +
          `RUT: ${rutFormatear(res.rut || '')}\nContraseña: ${res.clave}\n\n` +
          'Al entrar, el sistema le pedirá cambiarla por una suya.');
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
  const desbloquear = document.getElementById('clDesbloquear');
  if (desbloquear) {
    desbloquear.addEventListener('click', async () => {
      await api('POST', `/usuarios/${usuarioId}/desbloquear-recuperacion`);
      toast('Recuperación habilitada');
      renderClaveUsuario(usuarioId, contenedor);
    });
  }
}

/**
 * Los enlaces del menú que NO son un módulo.
 *
 * Pasar lista, el perfil y la configuración son pantallas propias, no listados
 * genéricos, así que no salen de MODULES. Antes se pegaban al final del menú,
 * cada uno con su propio título de grupo: «Asistencia» era un grupo de un solo
 * elemento, y quedaba debajo de todo, cuando es lo que más se usa. Acá se
 * declaran con el grupo y el número que les toca, y se mezclan con los módulos
 * como uno más.
 */
const ENLACES_PROPIOS = [
  { name: '_asistencia', grupo: 'Reuniones', order: 10, icon: '📋', label: 'Asistencia',
    href: '#/asistencia', si: () => !!MOD['asistencias'] },
  { name: '_mensajes', grupo: 'Sistema', order: 69, icon: '📣', label: 'Mensajes',
    href: '#/mensajes', si: () => tieneLlave('avisos_enviar') },
  { name: '_cuenta', grupo: 'Sistema', order: 70, icon: '🙋', label: 'Mi perfil', href: '#/perfil' },
  { name: '_config', grupo: 'Sistema', order: 71, icon: '⚙️', label: 'Configuración',
    href: '#/config', si: () => tieneLlave('sistema_configuracion') },
];

/** Qué grupos deja cerrados esta persona. Se recuerda en este navegador. */
const GRUPOS_CERRADOS = 'menu.gruposCerrados';
function gruposCerrados() {
  try {
    return new Set(JSON.parse(localStorage.getItem(GRUPOS_CERRADOS) || '[]'));
  } catch (e) {
    return new Set();
  }
}

function renderShell() {
  const groups = {};
  // Los módulos que se manejan dentro de la ficha de otro (los documentos y
  // el historial de cada iglesia o pastor) no ocupan lugar en el menú.
  for (const m of MODULES.filter((x) => x.menu !== false)) {
    (groups[m.group] = groups[m.group] || []).push({
      name: m.name, icon: m.icon, label: m.label, order: m.order, href: `#/m/${m.name}`,
    });
  }
  for (const e of ENLACES_PROPIOS) {
    if (e.si && !e.si()) continue;
    (groups[e.grupo] = groups[e.grupo] || []).push(e);
  }

  /*
   * El orden lo manda el servidor (server/grupos-del-menu.js). Un grupo que no
   * venga en esa lista se muestra igual, al final: es preferible que un módulo
   * nuevo salga en un lugar poco feliz a que desaparezca porque alguien olvidó
   * anotarlo.
   */
  const declarados = (window.GRUPOS_DEL_MENU || []).filter((g) => groups[g]);
  const elResto = Object.keys(groups).filter((g) => !declarados.includes(g)).sort();
  const cerrados = gruposCerrados();

  const groupsHtml = [...declarados, ...elResto]
    .map((g) => {
      const items = groups[g].slice().sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
      const cerrado = cerrados.has(g);
      return `
      <div class="side-group${cerrado ? ' cerrado' : ''}" data-grupo="${esc(g)}">
        <button type="button" class="group-title" aria-expanded="${cerrado ? 'false' : 'true'}">
          <span>${esc(g)}</span><span class="flecha" aria-hidden="true">▾</span>
        </button>
        <div class="group-items">
          ${items.map((m) => `<a class="side-link" data-mod="${m.name}" href="${m.href}"><span class="ic">${m.icon}</span> ${esc(m.label)}</a>`).join('')}
        </div>
      </div>`;
    })
    .join('');

  const initials = (USER.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const dondeTrabaja = iglesiaDeTrabajo(USER.iglesia_nombre) || 'Todas las iglesias';
  const conCuerpos = (USER.cuerpos_asignados || []).length > 0;
  // Quien alcanza más de una iglesia puede elegir con cuál trabajar
  const puedeElegirIglesia = (USER.iglesias_disponibles || []).length > 1;
  $app.innerHTML = `
    <a class="saltar" href="#content">Saltar al contenido</a>
    <div class="layout">
      <nav class="sidebar" id="sidebar" aria-label="Secciones del sistema">
        <div class="brand" title="${esc(IGLESIA.nombre)}">
          <img class="logo" src="${IGLESIA.logo}" alt="" />
          <span class="txt"><b>${esc(dondeTrabaja)}</b><i>Sistema de Gestión</i></span>
        </div>
        <div class="side-buscar">
          <span class="lupa" aria-hidden="true">🔎</span>
          <input type="search" id="menuBuscar" placeholder="Buscar una sección…"
                 aria-label="Buscar una sección del menú" autocomplete="off" spellcheck="false" />
          <button type="button" class="limpiar" id="menuBuscarLimpiar" aria-label="Limpiar la búsqueda del menú" hidden>✕</button>
        </div>
        <p class="side-sin-nada" id="menuSinNada" hidden>No hay ninguna sección con ese nombre.</p>
        <div class="side-group">
          <a class="side-link" data-mod="_dash" href="#/"><span class="ic">📊</span> Panel de control</a>
        </div>
        ${groupsHtml}
        <div class="side-footer">Conectado como <b>${esc(USER.nombre)}</b><br>Rol: ${esc(USER.rol)}</div>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle" aria-label="Abrir el menú" aria-expanded="false" aria-controls="sidebar">☰</button>
          <${puedeElegirIglesia ? 'button type="button" id="btnIglesia"' : 'div'} class="iglesia-local${conCuerpos ? '' : ' ya-esta-en-el-menu'}${puedeElegirIglesia ? ' elegible' : ''}"
               title="${puedeElegirIglesia ? 'Elegir con qué iglesia o iglesias trabajar' : 'Lo que tiene asignado para ver y administrar'}">
            <span class="ic">⛪</span>
            <span class="nm">${esc(dondeTrabaja)}</span>
            ${conCuerpos
              ? `<span class="cuerpos-chip" title="Solo ve lo de estos cuerpos">👥 ${esc(USER.cuerpos_asignados.join(' · '))}</span>`
              : ''}
            ${puedeElegirIglesia ? '<span class="cambiar">▾</span>' : ''}
          </${puedeElegirIglesia ? 'button' : 'div'}>
          <div class="buscador-global" id="buscadorGlobal">
            <button type="button" class="lupa" id="bgAbrir" aria-label="Buscar en todo el sistema" aria-expanded="false">🔍</button>
            <div class="bg-caja">
              <span class="ic" aria-hidden="true">🔍</span>
              <input type="search" id="bgTexto" placeholder="Buscar en todo…" autocomplete="off" spellcheck="false"
                     role="combobox" aria-expanded="false" aria-controls="bgPanel" aria-autocomplete="list"
                     aria-label="Buscar en todo el sistema" />
              <button type="button" class="bg-cerrar" id="bgCerrar" aria-label="Cerrar el buscador">✕</button>
            </div>
            <div class="bg-panel" id="bgPanel" role="listbox" aria-label="Resultados de la búsqueda" hidden></div>
          </div>
          <div class="tb-espacio"></div>
          <div class="campanita" id="campanita">
            <button type="button" class="cam-boton" id="camAbrir" aria-label="Mis avisos" aria-expanded="false">
              🔔<span class="cam-cuenta" id="camCuenta" hidden>0</span>
            </button>
            <div class="cam-panel" id="camPanel" role="dialog" aria-label="Mis avisos" hidden></div>
          </div>
          <a class="who" href="#/perfil" title="Mi perfil">${retratoDe(USER, initials)} <span><b>${esc(USER.nombre)}</b><br>${esc(USER.rut ? rutFormatear(USER.rut) : USER.email || '')}</span></a>
          <button class="btn secondary sm" id="logoutBtn">Cerrar sesión</button>
        </header>
        <main class="content" id="content" tabindex="-1"></main>
      </div>
      <div class="backdrop" id="backdrop" hidden></div>
    </div>`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  iniciarBuscadorGlobal();
  iniciarCampanita();
  iniciarGruposDelMenu();
  const btnIglesia = document.getElementById('btnIglesia');
  if (btnIglesia) btnIglesia.addEventListener('click', elegirIglesiaDeTrabajo);
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');
  const menuToggle = document.getElementById('menuToggle');
  menuToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    const abierto = sidebar.classList.contains('open');
    backdrop.classList.toggle('show', abierto);
    backdrop.hidden = !abierto;
    // Quien no ve la pantalla necesita que el botón diga si está abierto o no
    menuToggle.setAttribute('aria-expanded', String(abierto));
    menuToggle.setAttribute('aria-label', abierto ? 'Cerrar el menú' : 'Abrir el menú');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });
}
/**
 * ¿Se está mirando en un teléfono?
 *
 * Los 700 px son los mismos con que la hoja de estilos cambia de diseño (ver
 * styles.css): así lo que se decide acá y lo que se decide allá no pueden
 * quedar diciendo cosas distintas.
 */
function enPantallaChica() {
  return window.matchMedia('(max-width: 700px)').matches;
}

function content() {
  return document.getElementById('content');
}

/**
 * Deja a `ajustarCifras` mirando lo que se pinta, sin tener que llamarla desde
 * cada pantalla.
 *
 * Las tarjetas de cifras las dibujan cuarenta y dos sitios distintos —el panel,
 * cada listado con resumen, los informes, la ficha de una cuenta— y encima
 * algunas se rellenan después, cuando llega la respuesta del servidor. Ir a
 * llamarla a cada uno es la clase de lista que un día queda incompleta, y el
 * síntoma sería justo el que se está arreglando: una cifra cortada en la
 * pantalla que nadie se acordó de incluir.
 *
 * Así que se mira el contenido y punto. La comprobación es barata —solo toca lo
 * que de verdad se desborda— y se agrupa en el siguiente cuadro para no correr
 * una vez por cada nodo que aparece.
 */
function vigilarLasCifras() {
  const caja = content();
  if (!caja || typeof MutationObserver === 'undefined') return;
  let pedido = null;
  const alDia = () => {
    pedido = null;
    try { ajustarCifras(caja); } catch (e) { /* una cifra ancha no puede tumbar la pantalla */ }
  };
  const pedir = () => {
    if (pedido) return;
    pedido = requestAnimationFrame(alDia);
  };
  new MutationObserver(pedir).observe(caja, { childList: true, subtree: true });
  window.addEventListener('resize', pedir);
  pedir();
}

/* ---------------- panel de control ---------------- */
async function viewDashboard() {
  content().innerHTML = `<div class="page-head"><h2>📊 Panel de control</h2></div><p>Cargando…</p>`;
  let d;
  try {
    d = await api('GET', '/dashboard');
  } catch (e) {
    content().innerHTML = `<p>${esc(e.message)}</p>`;
    return;
  }
  const statDefs = [
    ['iglesias', '⛪', 'Iglesias', d.counts.iglesias],
    ['miembros', '🧍', 'Miembros', d.counts.miembros],
    ['cuerpos', '👥', 'Cuerpos / Grupos', d.counts.cuerpos],
    ['pastores', '🧑‍💼', 'Pastores / Guías', d.counts.pastores],
    // «En trámite» y no «pendientes»: son las tres de trámite juntas, incluida
    // la que espera antecedentes, que antes no se contaba
    ['solicitudes', '📨', 'Solicitudes en trámite', d.counts.solicitudes_pendientes,
      d.counts.solicitudes_vencidas ? `${fmtNumero(d.counts.solicitudes_vencidas)} pasada(s) de plazo` : '',
      '#/solicitudes/bandeja'],
    ['certificados', '📜', 'Certificados', d.counts.certificados],
    /*
     * Lo entregado este mes, y a cuánta gente.
     *
     * El panel no decía una palabra de las ayudas, que es lo único del sistema
     * que entrega plata y mercadería a gente de fuera. La cifra que va arriba
     * es PERSONAS y no entregas: es la que se pregunta desde afuera, y la que
     * no se podía contestar en ninguna parte. Las entregas van debajo, porque
     * sin ellas «6 personas» no dice si fueron seis cajas o dieciocho.
     */
    ['ayudas_sociales', '🤝', 'Personas ayudadas este mes', d.counts.ayudas_personas_mes || 0,
      '', '#/ayudas_sociales/informe',
      d.counts.ayudas_mes
        ? `${fmtNumero(d.counts.ayudas_mes)} entrega(s) · ${fmtMoney(d.counts.ayudas_entregado_mes)}`
        : ''],
  ].filter(([name]) => MOD[name]);

  let finHtml = '';
  if (d.finanzas) {
    finHtml = `
      <div class="fin-cards">
        <div class="fin green"><div class="lbl">Ingresos de ${esc(mesLegible(d.finanzas.mes))}</div><div class="num">${fmtMoney(d.finanzas.ingresos_mes)}</div></div>
        <div class="fin red"><div class="lbl">Egresos de ${esc(mesLegible(d.finanzas.mes))}</div><div class="num">${fmtMoney(d.finanzas.egresos_mes)}</div></div>
        <div class="fin blue"><div class="lbl">Balance histórico</div><div class="num">${fmtMoney(d.finanzas.balance_total)}</div></div>
        <div class="fin slate"><div class="lbl">Ingresos históricos</div><div class="num">${fmtMoney(d.finanzas.ingresos_total)}</div></div>
      </div>`;
  }

  // Próximos cumpleaños
  const cuando = (dias) => (dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`);
  const cumpleHtml = (d.cumpleanos || []).length
    ? `
      <div class="card cumples">
        <h3>🎂 Próximos cumpleaños</h3>
        <ul class="cumple-list">
          ${d.cumpleanos.map((c) => `
            <li class="${c.dias === 0 ? 'hoy' : ''}" data-ir="#/m/miembros/ficha/${c.id}">
              <div class="av">${c.foto
                ? `<img src="/uploads/${esc(c.foto)}" alt="" />`
                : `<span>${esc((c.nombre || '?').trim().charAt(0).toUpperCase())}</span>`}</div>
              <div class="dt">
                <b>${esc(c.nombre)}</b>
                <span class="mut">${diaMes(c.dia, c.mes)} · cumple ${c.cumple} año${c.cumple === 1 ? '' : 's'}</span>
              </div>
              <span class="badge ${c.dias === 0 ? 'green' : c.dias <= 7 ? 'blue' : ''}">${cuando(c.dias)}</span>
            </li>`).join('')}
        </ul>
      </div>`
    : `
      <div class="card cumples">
        <h3>🎂 Próximos cumpleaños</h3>
        <ul class="mini-list"><li class="mut">Todavía no hay miembros con fecha de nacimiento registrada</li></ul>
      </div>`;

  /**
   * Las credenciales que hay que renovar (punto 10.4).
   *
   * Va arriba de todo, antes que los números, porque es lo único del panel que
   * pide hacer algo. Una credencial vencida no se nota: el papel sigue en el
   * bolsillo y se ve igual de bien el día antes y el día después. Si esto no
   * estuviera acá, nadie se enteraría hasta que a alguien se la rechazaran.
   */
  const porRenovar = d.credencialesPorVencer || [];
  const yaVencidas = porRenovar.filter((c) => c.situacion === 'Vencida').length;
  const CUANTAS_SE_MUESTRAN = 6;
  const avisoCredenciales = porRenovar.length
    ? `
      <div class="card aviso-credenciales">
        <h3>🪪 ${yaVencidas ? 'Credenciales vencidas y por vencer' : 'Credenciales por vencer'}</h3>
        <p class="mut">
          ${yaVencidas
            ? `Hay <b>${yaVencidas}</b> credencial${yaVencidas === 1 ? '' : 'es'} <b>vencida${yaVencidas === 1 ? '' : 's'}</b>`
            : `Hay <b>${porRenovar.length}</b> credencial${porRenovar.length === 1 ? '' : 'es'} próxima${porRenovar.length === 1 ? '' : 's'} a vencer`}${yaVencidas && yaVencidas < porRenovar.length ? ` y ${porRenovar.length - yaVencidas} por vencer` : ''}.
          La nueva se emite desde la ficha de la persona; la anterior queda como reemplazada, no se borra.
        </p>
        <ul class="mini-list">
          ${porRenovar.slice(0, CUANTAS_SE_MUESTRAN).map((c) => `
            <li data-ir="#/m/credenciales/ficha/${c.id}">
              <span>${esc(c.titular)} <span class="mut mono">— N.º ${esc(c.serie)}</span></span>
              <span class="badge ${c.situacion === 'Vencida' ? 'gray' : 'amber'}">
                ${esc(c.situacion)}${c.vence ? ` · ${fechaCorta(c.vence)}` : ''}
              </span>
            </li>`).join('')}
          ${porRenovar.length > CUANTAS_SE_MUESTRAN
            ? `<li class="mut" data-ir="#/m/credenciales">y ${porRenovar.length - CUANTAS_SE_MUESTRAN} más — ver todas</li>`
            : ''}
        </ul>
      </div>`
    : '';

  content().innerHTML = `
    <div class="page-head">
      <h2>📊 Panel de control</h2>
    </div>
    ${avisoCredenciales}
    <div class="stats">
      ${statDefs.map(([name, ic, lbl, num, alerta, adonde, nota]) => `
        <div class="stat${alerta ? ' urge' : ''}" data-ir="${esc(adonde || `#/m/${name}`)}">
          <div class="num">${esc(fmtNumero(num))}</div><div class="lbl">${lbl}</div><div class="ic">${ic}</div>
          ${alerta ? `<div class="alerta">⏰ ${esc(alerta)}</div>` : ''}
          ${nota ? `<div class="apunte">${esc(nota)}</div>` : ''}
        </div>`).join('')}
    </div>
    ${finHtml}
    <div class="dash-cols">
      ${MOD['miembros'] ? cumpleHtml : ''}
      <div class="card">
        <h3>📨 Solicitudes recientes</h3>
        <ul class="mini-list">
          ${d.solicitudesRecientes.length ? d.solicitudesRecientes.map((s) => `
            <li data-ir="#/m/solicitudes/edit/${s.id}">
              <span>${esc(s.asunto)} <span class="mut">— ${esc(s.solicitante)}</span></span>
              <span class="badge ${badgeClass(s.estado)}">${esc(s.estado)}</span>
            </li>`).join('') : '<li class="mut">Sin registros aún</li>'}
        </ul>
      </div>
    </div>
    <div id="dashPendientes"></div>`;

  if (MOD['miembros']) renderPendientes(document.getElementById('dashPendientes'));
}

/**
 * Lo que falta por llenar en las fichas.
 *
 * Una base traída de otro sistema llega siempre con huecos, y mientras nadie
 * los vea, nadie los llena. Acá se ven, y sobre todo se pueden **abrir**:
 * cada línea lleva al listado de Miembros filtrado por los que a quienes les
 * falta ese dato, para ir completándolos de a uno o bajarlos a una planilla y
 * salir a pedirlos.
 */
async function renderPendientes(zona) {
  if (!zona) return;
  let p;
  try {
    p = await api('GET', '/pendientes');
  } catch (e) {
    return; // sin permiso sobre Miembros, o servidor antiguo
  }
  if (!p.total) return;

  if (p.alDia) {
    zona.innerHTML = `
      <div class="card pendientes">
        <h3>✅ Las fichas están completas</h3>
        <p class="mut">Las ${fmtNumero(p.total)} fichas tienen puestos los datos que hacen falta para ubicar y atender a cada persona.</p>
      </div>`;
    return;
  }

  const linea = (f) => `
    <li data-ir="#/m/miembros?sin=${encodeURIComponent(f.campo)}" title="Abrir los que no lo tienen">
      <span><b>${esc(f.label)}</b><br><span class="mut">${esc(f.para)}</span></span>
      <span class="badge ${f.porcentaje >= 90 ? 'red' : f.porcentaje >= 40 ? 'yellow' : ''}">
        faltan ${fmtNumero(f.cuantos)}
      </span>
    </li>`;

  zona.innerHTML = `
    <div class="card pendientes">
      <h3>📝 Datos por completar</h3>
      <p class="mut">
        De las <b>${fmtNumero(p.total)}</b> fichas, <b>${fmtNumero(p.conTodo)}</b> tienen todos estos datos
        puestos. Toque una línea para abrir a quiénes les falta; desde ahí puede bajar la planilla y salir a pedirlos.
      </p>
      ${p.menoresSinResponsable ? `
        <div class="aviso-fuerte">
          ⚠️ Hay <b>${fmtNumero(p.menoresSinResponsable)}</b> menor(es) de edad sin adulto responsable en su ficha.
          Eso no es un dato que falte: es una obligación de la iglesia.
          <a href="#/m/miembros?sin=responsable_nombre,responsable_id">Ver quiénes son</a>
        </div>` : ''}
      <ul class="mini-list">${p.faltas.map(linea).join('')}</ul>
    </div>`;
}

/* ---------------- listado genérico ---------------- */
function stateOf(name) {
  if (!listState[name]) {
    const m = MOD[name];
    listState[name] = { q: '', page: 1, sort: m.defaultSort.field, dir: m.defaultSort.dir,
      filters: {}, propios: {}, desde: '', hasta: '', edadDesde: '', edadHasta: '', sin: '' };
  }
  return listState[name];
}

async function viewList(name, filtrosIniciales) {
  const m = MOD[name];
  const st = stateOf(name);
  const fieldsBy = {};
  m.fields.forEach((f) => (fieldsBy[f.name] = f));

  // Filtros que vienen en la dirección: #/m/tesoreria?f_cuenta_id=3
  for (const [clave, valor] of Object.entries(filtrosIniciales || {})) {
    if (!clave.startsWith('f_')) continue;
    const campo = clave.slice(2);
    if (fieldsBy[campo]) {
      st.filters[campo] = String(valor);
      st.page = 1;
    }
  }
  // Lo que se venía buscando: #/m/miembros?q=perez. Lo usa el buscador general
  // para pasar de sus primeros resultados al listado completo del módulo.
  if ((filtrosIniciales || {}).q !== undefined) {
    st.q = String(filtrosIniciales.q || '');
    st.page = 1;
  }
  // «Lo que falta»: #/m/miembros?sin=telefono trae a los que no lo tienen. Se
  // reescribe siempre, incluso vacío, para que al volver al listado por el
  // menú no quede colgado el filtro de la vez anterior.
  const sinPedido = (filtrosIniciales || {}).sin;
  if (sinPedido !== undefined || st.sin) {
    /*
     * Acepta VARIOS campos separados por coma, que es lo que el servidor
     * entiende: «sin=responsable_nombre,responsable_id» son los menores que no
     * tienen ninguno de los dos. Leyendo un solo nombre, esa dirección no
     * calzaba con ningún campo y el filtro se caía entero, así que el enlace
     * del panel abría el listado completo como si nada faltara.
     */
    st.sin = String(sinPedido || '')
      .split(',').map((c) => c.trim()).filter((c) => fieldsBy[c]).join(',');
    st.page = 1;
  }

  /*
   * El rango de edad y los filtros propios del módulo, también desde la
   * dirección: es como el aviso de «ya cumplieron 18» lleva a quiénes son.
   */
  const rango = filtrosIniciales || {};
  if (rango.edad_desde !== undefined || st.edadDesde) {
    st.edadDesde = String(rango.edad_desde || '');
    st.page = 1;
  }
  if (rango.edad_hasta !== undefined || st.edadHasta) {
    st.edadHasta = String(rango.edad_hasta || '');
    st.page = 1;
  }
  if (rango.monto_desde !== undefined || st.montoDesde) {
    st.montoDesde = String(rango.monto_desde || '');
    st.page = 1;
  }
  if (rango.monto_hasta !== undefined || st.montoHasta) {
    st.montoHasta = String(rango.monto_hasta || '');
    st.page = 1;
  }
  st.propios = st.propios || {};
  for (const f of m.filtrosPropios || []) {
    if (rango[f.nombre] === undefined && !st.propios[f.nombre]) continue;
    st.propios[f.nombre] = String(rango[f.nombre] || '');
    st.page = 1;
  }

  content().innerHTML = `
    <div class="page-head">
      <h2>${m.icon} ${esc(m.label)}</h2>
      <div class="actions">
        ${name === 'servicios' ? '<button class="btn secondary" id="btnInformeServicios">📊 Informe</button>' : ''}
        ${name === 'tesoreria' ? '<button class="btn secondary" id="btnBalance">📊 Balance</button>' : ''}
        ${name === 'ayudas_sociales' ? '<button class="btn secondary" id="btnInformeAyudas">📊 Informe</button>' : ''}
        ${m.perms.create ? `<button class="btn secondary" id="btnImportar">⬆️ Importar</button>` : ''}
        ${m.perms.create ? `<button class="btn" id="btnNew">➕ ${nuevoDe(m)} ${esc(m.labelSingular.toLowerCase())}</button>` : ''}
      </div>
    </div>
    ${name === 'tesoreria' ? '<div class="treasury-summary" id="treasurySummary"></div>' : ''}
    ${name === 'servicios' ? '<div class="resumen-cifras" id="serviciosResumen"></div><div class="resumen-nota" id="serviciosResumenNota"></div>' : ''}
    <div class="card">
      <div class="toolbar" id="toolbar"></div>
      <div class="table-scroll"><div id="tableWrap"><p style="padding:20px">Cargando…</p></div></div>
      <div class="pager" id="pager"></div>
    </div>`;

  if (m.perms.create) {
    document.getElementById('btnNew').addEventListener('click', () => (location.hash = `#/m/${name}/new`));
    document.getElementById('btnImportar').addEventListener('click', () => abrirImportador(m, () => load()));
  }
  const alInforme = document.getElementById('btnInformeServicios');
  // El informe se abre con lo que se está mirando: el período y el tipo puestos
  if (alInforme) {
    alInforme.addEventListener('click', () => {
      const suyos = new URLSearchParams();
      if (st.desde) suyos.set('desde', st.desde);
      if (st.hasta) suyos.set('hasta', st.hasta);
      if (st.filters && st.filters.tipo) suyos.set('tipo', st.filters.tipo);
      if (st.filters && st.filters.iglesia_id) suyos.set('iglesia_id', st.filters.iglesia_id);
      const cola = suyos.toString();
      location.hash = `#/servicios/informe${cola ? '?' + cola : ''}`;
    });
  }

  // El informe de ayudas, con el período y los filtros que ya están puestos
  const alInformeAyudas = document.getElementById('btnInformeAyudas');
  if (alInformeAyudas) {
    alInformeAyudas.addEventListener('click', () => {
      const suyos = new URLSearchParams();
      if (st.desde) suyos.set('desde', st.desde);
      if (st.hasta) suyos.set('hasta', st.hasta);
      for (const campo of ['iglesia_id', 'tipo_ayuda', 'beneficiario_tipo', 'estado']) {
        if (st.filters && st.filters[campo]) suyos.set(campo, st.filters[campo]);
      }
      const cola = suyos.toString();
      location.hash = `#/ayudas_sociales/informe${cola ? '?' + cola : ''}`;
    });
  }

  // El balance se abre con lo que se está mirando: el período y los filtros puestos
  const alBalance = document.getElementById('btnBalance');
  if (alBalance) {
    alBalance.addEventListener('click', () => {
      const suyos = new URLSearchParams();
      if (st.desde) suyos.set('desde', st.desde);
      if (st.hasta) suyos.set('hasta', st.hasta);
      for (const campo of ['iglesia_id', 'cuenta_id', 'categoria', 'tipo', 'cuerpo_id']) {
        if (st.filters && st.filters[campo]) suyos.set(campo, st.filters[campo]);
      }
      const cola = suyos.toString();
      location.hash = `#/tesoreria/balance${cola ? '?' + cola : ''}`;
    });
  }

  // ------- barra de herramientas: búsqueda + filtros -------
  const tb = document.getElementById('toolbar');
  // El filtro por iglesia lo pone la propia barra, así que no se repite aunque
  // el módulo lo declare entre sus filtros
  const filterFields = (m.filterFields || [])
    .filter((n) => n !== 'iglesia_id')
    .map((n) => fieldsBy[n])
    .filter((f) => f && (f.type === 'select' || f.type === 'ref'));
  // El filtro por iglesia se ofrece cuando el usuario administra más de una
  const iglesiaField = fieldsBy['iglesia_id'] && (USER.iglesias_asignadas || 0) !== 1
    ? fieldsBy['iglesia_id']
    : null;

  /**
   * Los filtros van plegados en el teléfono.
   *
   * En el computador esta barra es una línea y no estorba. En un teléfono son
   * el buscador, cuatro selectores, dos fechas y dos botones: casi cuatrocientos
   * píxeles —más de media pantalla— antes del primer registro. Quien abre
   * Servicios en el teléfono quiere ver los servicios, no la caja de filtros.
   *
   * Así que en pantalla chica se queda a la vista lo que se usa siempre —el
   * buscador— y lo demás se despliega con un botón que dice cuántos filtros
   * hay puestos. Si viene alguno puesto, se despliega solo: una lista recortada
   * sin que se vea por qué es peor que un botón de más.
   *
   * En el computador el envoltorio es `display: contents` (ver styles.css), o
   * sea que no existe para el diseño: la barra queda exactamente igual que
   * antes. El botón tampoco se ve ahí.
   */
  // Los filtros que el módulo resuelve por su cuenta —hoy, «de qué cuerpo
  // es»— y el rango de edad, que no es una columna sino un cálculo
  const filtrosPropios = m.filtrosPropios || [];
  const hayRangoDeEdad = !!m.rangoDeEdad;
  const hayRangoDeMonto = !!m.rangoDeMonto;

  const hayQuePlegar = !!(iglesiaField || filterFields.length || filtrosPropios.length
    || hayRangoDeEdad || hayRangoDeMonto || m.dateField);

  tb.innerHTML = `
    <input type="search" id="q" placeholder="Buscar…" value="${esc(st.q)}"
           aria-label="Buscar en ${esc(m.label)}" />
    ${hayQuePlegar
      ? `<button type="button" class="btn secondary sm tb-desplegar" id="tbFiltros" aria-expanded="false"
                 aria-controls="tbPlegable">Filtros</button>`
      : ''}
    <div class="tb-plegable" id="tbPlegable">
      ${iglesiaField ? `<select id="f_iglesia_id" aria-label="Filtrar por iglesia"><option value="">— Todas las iglesias —</option></select>` : ''}
      ${filterFields.map((f) => `
        <select id="f_${f.name}" aria-label="Filtrar por ${esc(f.label)}">
          <option value="">— ${esc(f.label)} —</option>
          ${(f.options || []).map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : o;
            return `<option value="${esc(v)}" ${st.filters[f.name] === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
          }).join('')}
        </select>`).join('')}
      ${filtrosPropios.map((f) => `
        <select id="fp_${esc(f.nombre)}" aria-label="Filtrar por ${esc(f.label)}">
          <option value="">— ${esc(f.label)} —</option>
        </select>`).join('')}
      ${hayRangoDeEdad ? `
        <label class="range">Edad <input type="number" id="fEdadDesde" min="0" max="130" inputmode="numeric"
               placeholder="desde" value="${esc(st.edadDesde || '')}" aria-label="Edad desde" /></label>
        <label class="range">a <input type="number" id="fEdadHasta" min="0" max="130" inputmode="numeric"
               placeholder="hasta" value="${esc(st.edadHasta || '')}" aria-label="Edad hasta" /></label>` : ''}
      ${hayRangoDeMonto ? `
        <label class="range">Monto <input type="number" id="fMontoDesde" min="0" step="1" inputmode="numeric"
               placeholder="desde" value="${esc(st.montoDesde || '')}" aria-label="Monto desde" /></label>
        <label class="range">a <input type="number" id="fMontoHasta" min="0" step="1" inputmode="numeric"
               placeholder="hasta" value="${esc(st.montoHasta || '')}" aria-label="Monto hasta" /></label>` : ''}
      ${m.dateField ? `
        <label class="range">Desde <input type="date" id="fDesde" value="${esc(st.desde)}" /></label>
        <label class="range">Hasta <input type="date" id="fHasta" value="${esc(st.hasta)}" /></label>` : ''}
    </div>
    <span class="spacer"></span>
    ${m.pantallaExtra
      ? `<a class="btn secondary sm" href="${esc(m.pantallaExtra.ruta)}">${esc(m.pantallaExtra.label)}</a>`
      : ''}
    ${tieneLlave('datos_planilla')
      ? '<a class="btn secondary sm" id="btnPlanilla" download>⬇️ Excel</a>'
      : ''}
    <button class="btn secondary sm" id="btnReload">⟳ Actualizar</button>`;

  /**
   * El botón de los filtros: los despliega y dice cuántos hay puestos.
   *
   * El número importa. Plegados, un filtro puesto no se ve, y una lista
   * recortada sin motivo visible parece una lista a la que le faltan fichas.
   */
  const cuantosFiltros = () =>
    Object.values(st.filters).filter(Boolean).length
    + Object.values(st.propios || {}).filter(Boolean).length
    + (st.edadDesde ? 1 : 0) + (st.edadHasta ? 1 : 0)
    + (st.montoDesde ? 1 : 0) + (st.montoHasta ? 1 : 0)
    + (st.desde ? 1 : 0) + (st.hasta ? 1 : 0);

  const botonDeFiltros = document.getElementById('tbFiltros');
  const ponerElBotonAlDia = () => {
    if (!botonDeFiltros) return;
    const n = cuantosFiltros();
    botonDeFiltros.textContent = n ? `Filtros (${n})` : 'Filtros';
    botonDeFiltros.classList.toggle('con-filtros', !!n);
    const abiertos = tb.classList.contains('filtros-abiertos');
    botonDeFiltros.setAttribute('aria-expanded', String(abiertos));
    botonDeFiltros.setAttribute(
      'aria-label',
      `${abiertos ? 'Ocultar' : 'Mostrar'} los filtros${n ? `. Hay ${n} puesto${n > 1 ? 's' : ''}` : ''}`
    );
  };
  if (botonDeFiltros) {
    // Si se llega con un filtro puesto —desde «Datos por completar», o
    // volviendo a la lista— se abre solo, para que se vea por qué está así
    if (cuantosFiltros()) tb.classList.add('filtros-abiertos');
    botonDeFiltros.addEventListener('click', () => {
      tb.classList.toggle('filtros-abiertos');
      ponerElBotonAlDia();
    });
    ponerElBotonAlDia();
  }

  // Cuando se llega desde «Datos por completar», se dice por qué la lista está
  // recortada y cómo salir del filtro: si no, parece que se perdieron fichas.
  const pintarAvisoSin = () => {
    const previo = document.getElementById('avisoSin');
    if (previo) previo.remove();
    if (!st.sin) return;
    const campo = fieldsBy[st.sin];
    const aviso = document.createElement('div');
    aviso.id = 'avisoSin';
    aviso.className = 'aviso-filtro';
    aviso.innerHTML = `📝 Mostrando solo los que <b>no tienen ${esc((campo && campo.label ? campo.label : st.sin).toLowerCase())}</b>.
      <button class="btn secondary sm" id="btnQuitarSin">Ver todos</button>`;
    tb.insertAdjacentElement('afterend', aviso);
    document.getElementById('btnQuitarSin').addEventListener('click', () => {
      st.sin = '';
      st.page = 1;
      pintarAvisoSin();
      load();
    });
  };
  pintarAvisoSin();

  if (iglesiaField) {
    getOptions('iglesias').then((opts) => {
      const sel = document.getElementById('f_iglesia_id');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Todas las iglesias —</option>' +
        opts.map((o) => `<option value="${o.id}" ${st.filters.iglesia_id === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    });
  }

  let qTimer;
  document.getElementById('q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      st.q = e.target.value;
      st.page = 1;
      load();
    }, 300);
  });
  const bindFilter = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      st.filters[key] = el.value;
      st.page = 1;
      ponerElBotonAlDia(); // el botón dice cuántos filtros hay puestos
      load();
    });
  };
  // Los filtros que apuntan a otro módulo se llenan con sus registros
  filterFields.filter((f) => f.type === 'ref').forEach((f) => {
    getOptions(rutaOpciones(f, null, { filtrando: true })).then((opts) => {
      const sel = document.getElementById('f_' + f.name);
      if (!sel) return;
      sel.innerHTML = `<option value="">— ${esc(f.label)} —</option>` +
        opts.map((o) => `<option value="${o.id}" ${st.filters[f.name] === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    });
  });

  if (iglesiaField) bindFilter('f_iglesia_id', 'iglesia_id');
  filterFields.forEach((f) => bindFilter('f_' + f.name, f.name));

  // Los filtros propios del módulo: se llenan con los registros de a dónde
  // apuntan, igual que cualquier otro filtro de relación
  st.propios = st.propios || {};
  filtrosPropios.forEach((f) => {
    const sel = document.getElementById('fp_' + f.nombre);
    if (!sel) return;
    const pintar = (opts) => {
      sel.innerHTML = `<option value="">— ${esc(f.label)} —</option>` +
        opts.map((o) => `<option value="${esc(o.id)}" ${st.propios[f.nombre] === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    };
    if (f.tipo === 'ref' && f.ref) {
      getOptions(f.ref).then(pintar);
    } else if (f.opciones && f.opciones.length) {
      // Una lista fija, que no sale de ninguna tabla: el valor es el texto mismo
      pintar(f.opciones.map((o) => ({ id: o, label: o })));
    }
    sel.addEventListener('change', () => {
      st.propios[f.nombre] = sel.value;
      st.page = 1;
      ponerElBotonAlDia();
      load();
    });
  });

  /*
   * La edad se escribe, no se elige: se espera a que la persona termine de
   * teclear, como en el buscador. Preguntando en cada tecla, escribir «18»
   * pediría primero todos los de 1 año.
   */
  if (hayRangoDeEdad) {
    let relojEdad;
    const acotarPorEdad = (donde, cual) => {
      const el = document.getElementById(donde);
      if (!el) return;
      el.addEventListener('input', () => {
        clearTimeout(relojEdad);
        relojEdad = setTimeout(() => {
          st[cual] = el.value;
          st.page = 1;
          ponerElBotonAlDia();
          load();
        }, 400);
      });
    };
    acotarPorEdad('fEdadDesde', 'edadDesde');
    acotarPorEdad('fEdadHasta', 'edadHasta');
  }
  /*
   * El monto también se escribe, no se elige: se espera a que la persona
   * termine de teclear, igual que la edad. Preguntando en cada tecla, escribir
   * «500000» pediría primero todo lo que vale cinco pesos o más.
   */
  if (hayRangoDeMonto) {
    let relojMonto;
    const acotarPorMonto = (donde, cual) => {
      const el = document.getElementById(donde);
      if (!el) return;
      el.addEventListener('input', () => {
        clearTimeout(relojMonto);
        relojMonto = setTimeout(() => {
          st[cual] = el.value;
          st.page = 1;
          ponerElBotonAlDia();
          load();
        }, 400);
      });
    };
    acotarPorMonto('fMontoDesde', 'montoDesde');
    acotarPorMonto('fMontoHasta', 'montoHasta');
  }
  if (m.dateField) {
    document.getElementById('fDesde').addEventListener('change', (e) => {
      st.desde = e.target.value; st.page = 1; ponerElBotonAlDia(); load();
    });
    document.getElementById('fHasta').addEventListener('change', (e) => {
      st.hasta = e.target.value; st.page = 1; ponerElBotonAlDia(); load();
    });
  }
  document.getElementById('btnReload').addEventListener('click', load);

  // ------- carga y render de la tabla -------
  async function load() {
    const params = new URLSearchParams({ page: st.page, sort: st.sort, dir: st.dir });
    if (st.q) params.set('q', st.q);
    for (const [k, v] of Object.entries(st.filters)) if (v) params.set('f_' + k, v);
    for (const [k, v] of Object.entries(st.propios || {})) if (v) params.set(k, v);
    if (st.edadDesde) params.set('edad_desde', st.edadDesde);
    if (st.edadHasta) params.set('edad_hasta', st.edadHasta);
    if (st.montoDesde) params.set('monto_desde', st.montoDesde);
    if (st.montoHasta) params.set('monto_hasta', st.montoHasta);
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    if (st.sin) params.set('sin', st.sin);

    let data;
    try {
      data = await api('GET', `/${name}?` + params.toString());
    } catch (e) {
      document.getElementById('tableWrap').innerHTML = `<p style="padding:20px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }

    if (name === 'tesoreria') loadTreasurySummary(params);
    if (name === 'servicios') cargarResumenDeServicios(params);

    // La planilla baja lo mismo que se está viendo —búsqueda, filtros, fechas
    // y orden—, pero entero y no solo la página. El enlace se rehace en cada
    // carga para que nunca quede apuntando a un filtro anterior.
    const planilla = document.getElementById('btnPlanilla');
    if (planilla) {
      const suyos = new URLSearchParams(params);
      suyos.delete('page');
      planilla.href = `/api/${name}/planilla?${suyos.toString()}`;
      planilla.title = data.total
        ? `Baja ${fmtNumero(data.total)} registro(s) a una planilla, con lo que esté filtrado`
        : 'No hay registros que bajar';
      planilla.classList.toggle('deshabilitado', !data.total);
    }

    // Mientras haya una sola iglesia registrada, su nombre en cada fila solo
    // quita espacio: la columna aparece cuando haya más de una.
    let variasIglesias = true;
    try {
      variasIglesias = (await getOptions('iglesias')).length > 1;
    } catch (e) {
      variasIglesias = true;
    }
    const cols = m.listFields
      .filter((c) => fieldsBy[c] || c === 'id')
      .filter((c) => c !== 'iglesia_id' || variasIglesias)
      // Una columna de fotos donde nadie tiene foto es una columna vacía
      .filter((c) => {
        const f = fieldsBy[c];
        return !f || f.type !== 'file' || data.rows.some((r) => r[c]);
      });
    const wrap = document.getElementById('tableWrap');
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">${m.icon}</div>No hay registros${st.q || Object.values(st.filters).some(Boolean) ? ' con los filtros aplicados' : ''}.</div>`;
    } else {
      // En el teléfono esta tabla se dibuja como tarjetas (ver styles.css):
      // cada fila con sus datos uno bajo otro, sin desplazarse de lado.
      const etiquetaCol = (c) => (c === 'id' ? 'ID' : (fieldsBy[c] || {}).label || c);

      /**
       * Cuál dato va arriba de todo en la tarjeta del teléfono.
       *
       * Importa por dos razones. La primera es que imprimir y borrar van
       * pegados a la esquina de la tarjeta —una fila entera para dos botones
       * chicos es media pantalla desperdiciada—, y el dato que quede debajo
       * tiene que dejarles el sitio. Antes ese sitio se reservaba nombrando
       * las columnas de nombre, así que en Servicios, Asistencia, Tesorería,
       * Actas y todas las que parten por la fecha los botones quedaban
       * ENCIMA del dato y la fecha no se podía leer.
       *
       * La segunda es que ese primer dato es el que identifica el registro
       * —la fecha del servicio, el número del acta, el artículo del
       * inventario—, así que encabeza la tarjeta en vez de ir como una línea
       * más. Salvo cuando el listado ya lleva un nombre: ahí manda el nombre,
       * que para eso está, y el primer dato se queda como estaba.
       *
       * La foto no cuenta: va arriba de todo por su cuenta y no llega al
       * borde derecho. El trato tampoco: ya se dibuja aparte, sobre el
       * nombre y con su propio sitio reservado.
       */
      const COLUMNAS_DE_NOMBRE = ['nombres', 'nombre', 'apellidos'];
      const llevaNombre = cols.some((c) => COLUMNAS_DE_NOMBRE.includes(c));

      /**
       * Cuál dato encabeza la tarjeta, EN ESTA FILA.
       *
       * Se decide fila por fila y no una vez para todo el módulo, porque un
       * dato en blanco no ocupa lugar en la tarjeta: si el primero viene vacío,
       * el que queda arriba —y por lo tanto el que tiene que dejarle sitio a
       * imprimir y borrar— es el siguiente.
       *
       * Pasaba en Credenciales: la primera columna es el número de serie, y un
       * borrador todavía no tiene número. Su celda quedaba escondida, el sitio
       * reservado se iba con ella, y los botones se sentaban encima de los
       * apellidos Y del nombre.
       *
       * La foto no cuenta: va arriba de todo por su cuenta y no llega al borde
       * derecho. El trato tampoco: ya se dibuja aparte, con su propio sitio.
       */
      const primeraConDato = (fila, valores) =>
        cols.find((c) => {
          if (fieldsBy[c] && fieldsBy[c].type === 'file') return false;
          if (c === 'tratamiento') return false;
          return String(valores[c] || '').trim() !== '';
        });
      wrap.innerHTML = `
        <table class="grid grid-lista">
          <thead><tr>
            ${cols.map((c) => {
              const f = fieldsBy[c];
              const lbl = c === 'id' ? 'ID' : f.label;
              // La columna de una foto se queda con lo justo: su título
              // ("Fotografía del cuerpo / grupo") desplazaría al resto fuera
              // de la pantalla, y la miniatura ya se explica sola.
              if (f && f.type === 'file') {
                return `<th class="no-sort col-mini" style="cursor:default" title="${esc(lbl)}">${
                  (f.accept || '').startsWith('image') ? '📷' : '📎'
                }</th>`;
              }
              const alineado = f && ['money', 'number'].includes(f.type) ? ' num' : '';
              // Un calculado no se ordena, salvo que sepa por qué columna
              // hacerlo: la edad, por la fecha de nacimiento (ver
              // `ordenarPor` en server/modules/miembros.js). Sin esto, la
              // cabecera «Edad» seguía siendo un rótulo muerto aunque el
              // servidor ya supiera ordenarla.
              if (f && f.computed && !f.ordenable) {
                return `<th class="no-sort${alineado}" style="cursor:default">${esc(lbl)}</th>`;
              }
              // La flecha va pegada a la última palabra con un espacio duro: los
              // títulos se parten en dos cuando la columna aprieta (ver
              // `table.grid th` en public/styles.css), y con un espacio normal
              // la flecha se bajaba sola a la línea de abajo.
              const arrow = st.sort === c ? `&#160;<span class="arrow">${st.dir === 'asc' ? '▲' : '▼'}</span>` : '';
              return `<th data-col="${c}"${alineado ? ` class="${alineado.trim()}"` : ''}>${esc(lbl)}${arrow}</th>`;
            }).join('')}
            <th class="no-sort"></th>
          </tr></thead>
          <tbody>
            ${data.rows.map((r) => {
              // Se dibuja cada celda primero, para saber cuáles quedan vacías:
              // la que encabeza la tarjeta es la primera que traiga algo
              const dibujadas = {};
              for (const c of cols) dibujadas[c] = cellValue(fieldsBy[c], r, c);
              const encabeza = primeraConDato(r, dibujadas);
              return `
              <tr data-id="${r.id}">
                ${cols.map((c) => {
                  const f = fieldsBy[c];
                  const clases = [];
                  if (f && f.type === 'file') clases.push('col-mini');
                  else if (f && ['money', 'number'].includes(f.type)) clases.push('num');
                  else if (f && ['rut', 'date', 'time'].includes(f.type)) clases.push('cifra');
                  if (c === encabeza) {
                    clases.push('col-primera');
                    if (!llevaNombre) clases.push('col-titular');
                  }
                  return `<td data-col="${esc(c)}" data-label="${esc(etiquetaCol(c))}"${
                    clases.length ? ` class="${clases.join(' ')}"` : ''}>${dibujadas[c]}</td>`;
                }).join('')}
                <td class="acciones" style="white-space:nowrap;text-align:right">
                  ${m.printable && tieneLlave('datos_impresion') ? `<button class="btn secondary sm act-print" data-id="${r.id}" title="Imprimir">🖨️</button>` : ''}
                  ${m.perms.delete && tieneLlave('datos_borrar') && !generadoPorOtroModulo(r)
                    ? `<button class="btn danger sm act-del" data-id="${r.id}" title="Eliminar">🗑️</button>`
                    : ''}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;

      wrap.querySelectorAll('th[data-col]').forEach((th) => {
        th.addEventListener('click', () => {
          const c = th.dataset.col;
          if (st.sort === c) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
          else { st.sort = c; st.dir = 'asc'; }
          load();
        });
      });
      wrap.querySelectorAll('tbody tr').forEach((tr) => {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          // Las personas, los cuerpos y las iglesias se abren en su ficha: casi
          // siempre se entra a mirar un dato, no a cambiarlo. Desde la ficha,
          // un botón lleva a editar.
          const destino = CON_FICHA.includes(name) ? 'ficha' : 'edit';
          location.hash = `#/m/${name}/${destino}/${tr.dataset.id}`;
        });
      });
      wrap.querySelectorAll('.act-del').forEach((b) => {
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
          try {
            await borrarPreguntando(`/${name}/${b.dataset.id}`);
            toast('Registro eliminado');
            invalidarOpciones(name);
            load();
          } catch (err) {
            if (err !== SE_ARREPINTIO) toast(err.message, true);
          }
        });
      });
      wrap.querySelectorAll('.act-print').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          location.hash = `#/print/${name}/${b.dataset.id}`;
        });
      });
    }

    // paginación
    const pager = document.getElementById('pager');
    const btns = [];
    for (let p = Math.max(1, data.page - 3); p <= Math.min(data.pages, data.page + 3); p++) {
      // El número dice a qué página lleva; en la que uno está, además se dice.
      btns.push(
        `<button class="${p === data.page ? 'cur' : ''}" data-p="${p}"` +
        `${p === data.page ? ' aria-current="page"' : ''} aria-label="Página ${p}">${p}</button>`
      );
    }
    pager.innerHTML = `
      <span>${esc(fmtNumero(data.total))} registro${data.total === 1 ? '' : 's'}</span>
      <span class="pages">
        <button data-p="${data.page - 1}" aria-label="Página anterior" ${data.page <= 1 ? 'disabled' : ''}>‹</button>
        ${btns.join('')}
        <button data-p="${data.page + 1}" aria-label="Página siguiente" ${data.page >= data.pages ? 'disabled' : ''}>›</button>
      </span>`;
    pager.querySelectorAll('button[data-p]').forEach((b) => {
      b.addEventListener('click', () => {
        st.page = Number(b.dataset.p);
        load();
      });
    });
  }

  /**
   * Los totales de los servicios que se están viendo.
   *
   * Suma lo mismo que muestra el listado —la búsqueda, los filtros y el rango
   * de fechas van tal cual—, así que acotar a agosto y mirar el total es una
   * sola cosa. Antes había que ir fila por fila con una calculadora.
   *
   * ── QUÉ VA ACÁ Y QUÉ NO ──
   *
   * Dos cifras, y las dos de servicios: cuántos hubo y cuánta gente fue en
   * promedio a cada uno. Arriba del listado había otras tres y salieron:
   *
   *   · la ofrenda recibida y el aporte a la corporación, porque esta pantalla
   *     es el registro de lo que pasó en los servicios y no la tesorería. El
   *     dinero de cada servicio sigue en su propia ficha, y las sumas siguen
   *     enteras en el informe —que se abre a propósito, apretando «Informe»— y
   *     en Tesorería, que es donde se va a buscarlas.
   *
   *   · el total de asistencia, porque es una suma de sumas y se lee como si
   *     fuera gente. «2.338» en una iglesia que nunca ha juntado tanto en un
   *     servicio no informa: confunde. El promedio, en cambio, es una cifra
   *     que se puede reconocer.
   *
   * Y por eso el promedio dice de qué es. Cuando estaba debajo de «Asistencia»
   * se entendía solo; suelto al lado de «Servicios», «156» podía leerse como
   * plata.
   */
  async function cargarResumenDeServicios(params) {
    const el = document.getElementById('serviciosResumen');
    const nota = document.getElementById('serviciosResumenNota');
    if (!el) return;
    try {
      const r = await api('GET', '/servicios/resumen?' + params.toString());
      el.innerHTML = `
        <div class="fin blue"><div class="lbl">Servicios</div><div class="num">${esc(fmtNumero(r.servicios))}</div></div>
        <div class="fin blue"><div class="lbl">Promedio de asistencia</div><div class="num">${esc(fmtNumero(r.promedio_asistencia))}</div></div>`;
      /*
       * De cuántos servicios salió el promedio, cuando no salió de todos: un
       * servicio al que nadie le anotó la asistencia no es un servicio al que
       * no fue nadie, así que no entra en el promedio. Sin decirlo, la cifra se
       * lee como si fuera de todos.
       */
      nota.textContent = r.servicios && r.con_asistencia !== r.servicios
        ? `El promedio sale de ${fmtNumero(r.con_asistencia)} de los ${fmtNumero(r.servicios)} servicios: `
          + 'los demás no tienen la asistencia anotada.'
        : '';
    } catch (e) {
      el.innerHTML = '';
      if (nota) nota.textContent = '';
    }
  }

  async function loadTreasurySummary(params) {
    const el = document.getElementById('treasurySummary');
    if (!el) return;
    try {
      const r = await api('GET', '/tesoreria/resumen?' + params.toString());
      /*
       * Sin las cifras no hay tira que pintar: son todas cifras. Se dice, y no
       * se dibujan cuatro tarjetas con el rótulo puesto y el número en blanco,
       * que es lo que salía antes de la 1.212.0 y se lee como «no hay nada».
       */
      if (sinCifras(r)) { el.innerHTML = AVISO_SIN_CIFRAS; return; }
      const cuentas = (r.porCuenta || []);
      /*
       * Las que tienen algo que mostrar, y las demás detrás de un botón.
       *
       * El listado traía TODAS las cuentas, abierto de entrada en el computador.
       * Con doce cuerpos —cada uno con su tesorería y su cuenta de cuotas— son
       * cuarenta y una filas antes de ver un solo movimiento: medido, la primera
       * fila del libro empezaba a los 1.950 px en una pantalla de 950. Y de esas
       * cuarenta y una, CUATRO tenían plata; las otras treinta y siete decían
       * «$ 0» una tras otra.
       *
       * Una cuenta en cero y sin nada agendado no dice nada que no diga el
       * silencio, así que se pliegan aparte. No se esconden: siguen a un clic, y
       * se dice cuántas son.
       */
      const tieneAlgo = (c) => Number(c.saldo) !== 0 || Number(c.agendado) !== 0;
      const conAlgo = cuentas.filter(tieneAlgo);
      const enCero = cuentas.filter((c) => !tieneAlgo(c));

      /*
       * El clic lleva a la CARTOLA de la cuenta, no a su formulario.
       *
       * La fila se ve como un enlace y lo era, pero llevaba a editar la cuenta:
       * su nombre, su responsable, su saldo inicial. Quien hace clic en «$
       * 65.696.114» no va a cambiarle el nombre a la cuenta —va a ver de dónde
       * salió esa cifra—. Desde la 1.165.0 eso tiene dónde: la cartola, con el
       * saldo corriendo fila a fila. Editarla sigue a un clic desde ahí, con el
       * botón «Volver a la cuenta».
       */
      const filaDeCuenta = (c) => `
        <li data-ir="#/cuentas_tesoreria/cartola/${c.id}" title="Ver la cartola de esta cuenta">
          <span class="sc-n">${esc(c.nombre)}
            <span class="badge ${c.tipo === 'General' ? 'blue' : ''}">${esc(c.ambito)}</span>
            ${Number(c.agendado) ? `
              <span class="badge agendado" title="Ya anotado con fecha de más adelante: todavía no está en la caja">
                agendado ${fmtMoney(c.agendado)}</span>` : ''}
          </span>
          <b class="${Number(c.saldo) < 0 ? 'saldo-negativo' : ''}">${fmtMoney(c.saldo)}</b>
        </li>`;
      el.innerHTML = `
        <div class="fin green"><div class="lbl">Ingresos (período filtrado)</div><div class="num">${fmtMoney(r.ingresos)}</div></div>
        <div class="fin red"><div class="lbl">Egresos</div><div class="num">${fmtMoney(r.egresos)}</div></div>
        <div class="fin blue"><div class="lbl">Balance</div><div class="num">${fmtMoney(r.balance)}</div></div>
        <!-- La plata que no entró ni salió, solo cambió de cuenta: el aporte que una
             ofrenda pasa al fondo y los traspasos. Antes se sumaba a los ingresos y
             el mes decía que había entrado más de lo que entró. Solo se muestra
             cuando hubo alguno: una tarjeta en cero no dice nada. -->
        ${Number(r.movido) > 0 ? `
          <div class="fin slate">
            <div class="lbl">Movido entre cuentas</div>
            <div class="num">${fmtMoney(r.movido)}</div>
          </div>` : ''}
        <div class="fin slate"><div class="lbl">Movimientos</div><div class="num">${esc(fmtNumero(r.movimientos))}</div></div>
        ${cuentas.length ? `
          <details class="saldos-cuentas" ${enPantallaChica() ? '' : 'open'}>
            <summary class="sc-tit">Saldo de cada cuenta
              <span class="mut">(${enCero.length
                ? `${fmtNumero(conAlgo.length)} de ${fmtNumero(cuentas.length)} cuentas`
                : `${fmtNumero(cuentas.length)} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'}`}
                · lo que hay hoy, no depende del período filtrado)</span>
            </summary>
            ${conAlgo.length
              ? `<ul>${conAlgo.map(filaDeCuenta).join('')}</ul>`
              : '<p class="mut" style="padding:4px 16px 10px;margin:0">Todas las cuentas están en cero.</p>'}
            ${enCero.length ? `
              <details class="saldos-en-cero">
                <summary class="mut">Ver las ${fmtNumero(enCero.length)}
                  ${enCero.length === 1 ? 'cuenta que está' : 'cuentas que están'} en cero</summary>
                <ul>${enCero.map(filaDeCuenta).join('')}</ul>
              </details>` : ''}
          </details>` : ''}`;
    } catch (e) {
      el.innerHTML = '';
    }
  }

  load();
}

/**
 * ¿Este registro lo generó otro módulo? (los movimientos de un traspaso o de
 * la ofrenda de un servicio). Se manejan desde allá, así que no se ofrece
 * eliminarlos por separado.
 */
function generadoPorOtroModulo(row) {
  return !!(row.traspaso_id || row.servicio_id);
}

/* =====================================================================
 * El balance de Tesorería
 *
 * El módulo guardaba bien y devolvía poco: había totales en pantalla y una
 * planilla Excel, y el balance del mes —lo que entró, lo que salió, por
 * categoría, cuenta por cuenta— se terminaba armando a mano en otra planilla a
 * partir de ese Excel. Es justamente el papel que se lleva a la reunión de la
 * directiva y se archiva.
 *
 * Las cifras son las mismas del resumen de arriba del listado, sacadas del
 * mismo recorte en el servidor, para que la hoja impresa y la pantalla no
 * puedan discrepar.
 * ===================================================================== */
async function viewBalanceTesoreria(precarga) {
  const m = MOD['tesoreria'];
  if (!m) return (location.hash = '#/');
  const st = {
    desde: (precarga && precarga.desde) || '',
    hasta: (precarga && precarga.hasta) || '',
    iglesia_id: (precarga && precarga.iglesia_id) || '',
    cuenta_id: (precarga && precarga.cuenta_id) || '',
  };

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>📊 Balance de Tesorería</h2>
      <div class="actions">
        <button class="btn secondary" id="balVolver">← Volver al listado</button>
        <button class="btn secondary" data-imprimir>🖨️ PDF</button>
      </div>
    </div>
    <div class="card no-print">
      <div class="toolbar">
        <select id="balIglesia" aria-label="Iglesia"><option value="">Todas las iglesias</option></select>
        <select id="balCuenta" aria-label="Cuenta"><option value="">Todas las cuentas</option></select>
        <label class="range">Desde <input type="date" id="balDesde" value="${esc(st.desde)}" /></label>
        <label class="range">Hasta <input type="date" id="balHasta" value="${esc(st.hasta)}" /></label>
        <button class="btn secondary" id="balAnio">Este año</button>
        <button class="btn secondary" id="balMes">Este mes</button>
      </div>
    </div>
    <div id="balCuerpo"><p style="padding:18px">Calculando…</p></div>`;

  document.getElementById('balVolver').addEventListener('click', () => (location.hash = '#/m/tesoreria'));

  const [iglesias, cuentas] = await Promise.all([
    getOptions('iglesias').catch(() => []),
    api('GET', '/cuentas_tesoreria/activas').then((d) => d || []).catch(() => []),
  ]);
  const llenar = (id, filas, elegido, todos) => {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">${todos}</option>`
      + (filas || []).map((f) => `<option value="${f.id}" ${String(elegido) === String(f.id) ? 'selected' : ''}>${esc(f.label || f.nombre)}</option>`).join('');
  };
  llenar('balIglesia', iglesias, st.iglesia_id, 'Todas las iglesias');
  llenar('balCuenta', cuentas, st.cuenta_id, 'Todas las cuentas');

  const cambia = (id, campo) =>
    document.getElementById(id).addEventListener('change', (e) => { st[campo] = e.target.value; cargar(); });
  cambia('balIglesia', 'iglesia_id');
  cambia('balCuenta', 'cuenta_id');
  cambia('balDesde', 'desde');
  cambia('balHasta', 'hasta');

  const ponerRango = (desde, hasta) => {
    st.desde = desde; st.hasta = hasta;
    document.getElementById('balDesde').value = desde;
    document.getElementById('balHasta').value = hasta;
    cargar();
  };
  document.getElementById('balAnio').addEventListener('click', () => {
    const a = new Date().getFullYear();
    ponerRango(`${a}-01-01`, `${a}-12-31`);
  });
  document.getElementById('balMes').addEventListener('click', () => {
    const h = new Date();
    const mes = String(h.getMonth() + 1).padStart(2, '0');
    const ultimo = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    ponerRango(`${h.getFullYear()}-${mes}-01`, `${h.getFullYear()}-${mes}-${ultimo}`);
  });

  async function cargar() {
    const caja = document.getElementById('balCuerpo');
    caja.innerHTML = '<p style="padding:18px">Calculando…</p>';
    const params = new URLSearchParams();
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    if (st.iglesia_id) params.set('f_iglesia_id', st.iglesia_id);
    if (st.cuenta_id) params.set('f_cuenta_id', st.cuenta_id);

    let d;
    try {
      d = await api('GET', '/tesoreria/informe?' + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }
    /*
     * El balance del período es, entero, «los totales de los informes» que la
     * llave «Montos del dinero» dice esconder: sin ella no queda papel que
     * imprimir, y eso es lo correcto. Se dice acá en vez de sacar una hoja con
     * el membrete, los títulos y todas las cifras en blanco.
     */
    if (sinCifras(d)) { caja.innerHTML = `<div class="card" style="padding:18px">${AVISO_SIN_CIFRAS}</div>`; return; }
    const r = d.resumen;
    // Un balance acotado que no lo dice se lee como si fuera el de todo, y se
    // imprime igual: el período va en el título, que es donde el ojo busca de
    // qué es esta hoja.
    const periodo = d.desde || d.hasta
      ? `del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : 'de todo lo registrado';
    const deQuien = [
      st.iglesia_id ? (iglesias.find((i) => String(i.id) === String(st.iglesia_id)) || {}).label : null,
      st.cuenta_id ? (cuentas.find((c) => String(c.id) === String(st.cuenta_id)) || {}).label : null,
    ].filter(Boolean).join(' · ');

    const tabla = (titulo, filas, columna, comoSeLlama, nota) => `
      <div class="card" style="margin-bottom:18px">
        <h3>${esc(titulo)}</h3>
        ${filas.length ? `
        <div style="overflow-x:auto">
        <table class="grid informe grid-lista">
          <thead><tr>
            <th>${esc(columna)}</th><th>Movimientos</th><th>Entró</th><th>Salió</th><th>Diferencia</th>
          </tr></thead>
          <tbody>
            ${filas.map((f) => {
              const dif = Number(f.ingresos) - Number(f.egresos);
              return `
              <tr>
                <td class="col-primera col-titular" data-label="${esc(columna)}">${esc(comoSeLlama(f))}</td>
                <td class="num" data-label="Movimientos">${esc(fmtNumero(f.movimientos))}</td>
                <td class="num" data-label="Entró">${fmtMoney(f.ingresos)}</td>
                <td class="num" data-label="Salió">${fmtMoney(f.egresos)}</td>
                <td class="num" data-label="Diferencia"><span class="${dif < 0 ? 'saldo-negativo' : ''}">${fmtMoney(dif)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr class="tot">
            <td class="col-primera col-titular" data-label="${esc(columna)}"><b>Total</b></td>
            <td class="num" data-label="Movimientos"><b>${esc(fmtNumero(r.movimientos))}</b></td>
            <td class="num" data-label="Entró"><b>${fmtMoney(r.ingresos)}</b></td>
            <td class="num" data-label="Salió"><b>${fmtMoney(r.egresos)}</b></td>
            <td class="num" data-label="Diferencia"><b><span class="${r.balance < 0 ? 'saldo-negativo' : ''}">${fmtMoney(r.balance)}</span></b></td>
          </tr></tfoot>
        </table></div>
        ${nota ? `<p class="mut" style="padding:0 18px 14px;margin:0">${nota}</p>` : ''}`
        : '<div class="empty-state" style="padding:22px">Sin movimientos en este período.</div>'}
      </div>`;

    // El desglose por categoría llega en una sola lista con los dos tipos: se
    // parte en dos tablas, que es como se lee un balance
    const entradas = d.porCategoria.filter((c) => c.tipo === 'Ingreso');
    const salidas = d.porCategoria.filter((c) => c.tipo === 'Egreso');
    const porCategoria = (titulo, filas, total) => `
      <div class="card" style="margin-bottom:18px">
        <h3>${esc(titulo)}</h3>
        ${filas.length ? `
        <div style="overflow-x:auto">
        <table class="grid informe grid-lista">
          <thead><tr><th>Categoría</th><th>Monto</th><th>Parte del total</th></tr></thead>
          <tbody>
            ${filas.map((f) => `
              <tr>
                <td class="col-primera col-titular" data-label="Categoría">${esc(f.categoria || 'Sin categoría')}</td>
                <td class="num" data-label="Monto">${fmtMoney(f.total)}</td>
                <td class="num" data-label="Parte del total">${total ? Math.round((Number(f.total) / total) * 100) : 0}%</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr class="tot">
            <td class="col-primera col-titular" data-label="Categoría"><b>Total</b></td>
            <td class="num" data-label="Monto"><b>${fmtMoney(total)}</b></td>
            <td class="num" data-label="Parte del total"><b>100%</b></td>
          </tr></tfoot>
        </table></div>` : '<div class="empty-state" style="padding:22px">Nada en este período.</div>'}
      </div>`;

    caja.innerHTML = `
      <div class="informe-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit">
          Balance de tesorería <span class="mut">${esc(periodo)}${deQuien ? ` · ${esc(deQuien)}` : ''}</span>
        </h3>
        <div class="resumen-cifras">
          <div class="fin green"><div class="lbl">Entró</div><div class="num">${fmtMoney(r.ingresos)}</div></div>
          <div class="fin red"><div class="lbl">Salió</div><div class="num">${fmtMoney(r.egresos)}</div></div>
          <div class="fin blue"><div class="lbl">Diferencia</div><div class="num ${r.balance < 0 ? 'saldo-negativo' : ''}">${fmtMoney(r.balance)}</div></div>
          <div class="fin slate"><div class="lbl">Movimientos</div><div class="num">${esc(fmtNumero(r.movimientos))}</div></div>
          ${Number(r.movido) > 0 ? `
            <div class="fin slate"><div class="lbl">Movido entre cuentas</div><div class="num">${fmtMoney(r.movido)}</div></div>` : ''}
        </div>
        ${tabla('Mes por mes', d.porMes, 'Mes', (f) => mesLargo(f.mes))}
        ${porCategoria('En qué entró', entradas, r.ingresos)}
        ${porCategoria('En qué se gastó', salidas, r.egresos)}
        ${tabla('Cuenta por cuenta', d.porCuenta, 'Cuenta', (f) => `${f.nombre} · ${f.ambito}`)}
        <div class="informe-pie mut">
          ${pieDelDocumento()}<br>
          Las cifras no cuentan la plata que solo cambió de cuenta —el aporte que una ofrenda pasa al
          fondo, y los traspasos— cuando los dos lados del traslado caen dentro de este período y de
          estos filtros. ${Number(r.movido) > 0
            ? `Acá son ${fmtMoney(r.movido)}, que van aparte.`
            : 'Acá no hubo ninguno.'}
        </div>
      </div>`;
  }

  cargar();
}

/* =====================================================================
 * LA HOJA DEL INVENTARIO DE UN NIVEL
 *
 * Lo que se lleva a una revisión y lo que se firma al entregar un cargo:
 * artículo por artículo, con lo propio y lo ajeno separados y sus totales.
 * Antes no existía —el módulo no se podía imprimir— y el inventario de un
 * cuerpo había que copiarlo a mano del listado general.
 *
 * Es su propia pantalla y no una pestaña, por la misma razón que la cartola:
 * imprimir una pestaña de la ficha imprimiría la ficha entera. Acá se llega
 * desde esa pestaña, y de vuelta también.
 * ===================================================================== */
async function viewHojaDeInventario(tipo, id) {
  if (!MOD['inventarios']) return (location.hash = '#/');
  const DE = {
    cuerpo: { ambito: 'Cuerpo / Grupo', modulo: 'cuerpos', param: 'cuerpo_id' },
    iglesia: { ambito: 'Iglesia local', modulo: 'iglesias', param: 'iglesia_id' },
    corporacion: { ambito: 'Corporación', modulo: null, param: null },
  };
  const cual = DE[tipo];
  if (!cual || (cual.param && !id)) return (location.hash = '#/m/inventarios');

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>📦 Hoja del inventario</h2>
      <div class="actions">
        ${cual.modulo ? `<button class="btn secondary" id="invVolver">↩ Volver a la ficha</button>` : ''}
        <button class="btn secondary" data-imprimir>🖨️ PDF</button>
      </div>
    </div>
    <div id="invCuerpo"><p style="padding:18px">Cargando…</p></div>`;
  const volver = document.getElementById('invVolver');
  if (volver) {
    volver.addEventListener('click', () => (location.hash = `#/m/${cual.modulo}/ficha/${id}/inventario`));
  }

  const q = new URLSearchParams({ ambito: cual.ambito });
  if (cual.param) q.set(cual.param, id);
  const caja = document.getElementById('invCuerpo');
  const [d, duenio] = await Promise.all([
    api('GET', '/inventarios/de-nivel?' + q.toString()).catch((e) => ({ error: e.message })),
    cual.modulo ? api('GET', `/${cual.modulo}/${id}`).catch(() => null) : Promise.resolve(null),
  ]);
  if (!d || d.error) {
    caja.innerHTML = `<div class="card"><p style="padding:18px">${esc((d && d.error) || 'No se pudo traer el inventario.')}</p></div>`;
    return;
  }

  const nombre = duenio ? (duenio.nombre || `#${id}`) : 'la corporación';
  // Los títulos nombran el nivel, igual que los totales: una hoja de la
  // corporación encabezada «De la iglesia» hace dudar de lo que está contando
  const suyoEs = DUENO_DEL_NIVEL[d.ambito] || 'de la organización';
  const enPie = d.filas.filter((f) => !f.fecha_devuelto);
  const devueltos = d.filas.filter((f) => f.fecha_devuelto);

  const tabla = (filas, titulo) => (!filas.length ? '' : `
    <h4 class="informe-sub">${esc(titulo)}</h4>
    <div style="overflow-x:auto">
    <table class="grid informe grid-lista">
      <thead><tr>
        <th>Artículo</th><th>Categoría</th><th>Cantidad</th><th>Estado</th>
        <th>Ubicación</th><th>De quién es</th><th>Valor</th>
      </tr></thead>
      <tbody>
        ${filas.map((f) => `
          <tr data-ir="#/m/inventarios/ficha/${f.id}">
            <td class="col-primera col-titular" data-label="Artículo">${esc(f.articulo)}</td>
            <td data-label="Categoría">${esc(f.categoria || '')}</td>
            <td class="num" data-label="Cantidad">${fmtNumero(f.cantidad)}</td>
            <td data-label="Estado">${esc(f.estado || '')}</td>
            <td data-label="Ubicación">${esc(f.ubicacion || '')}</td>
            <td data-label="De quién es">${f.regimen === 'Propio'
              ? `<span class="mut">Propio, ${esc(suyoEs)}</span>`
              : `${esc(f.regimen)}${f.dueno ? ` · ${esc(f.dueno)}` : ''}${f.fecha_devolucion
                  // Sin <br>: en el teléfono cada celda es «rótulo … valor» en una
                  // línea, y el salto le comía el rótulo hasta dejarlo en una letra
                  ? ` <span class="mut">· devolver el ${esc(fechaCorta(f.fecha_devolucion))}</span>` : ''}`}</td>
            <td class="num" data-label="Valor">${f.valor_estimado ? fmtMoney(f.cantidad * f.valor_estimado) : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>`);

  caja.innerHTML = `
    <div class="informe-hoja">
      <div class="print-only">${membreteDelDocumento()}</div>
      <h3 class="informe-tit">
        Inventario de ${esc(nombre)}
        <span class="mut">${esc(d.ambito)} · ${fmtNumero(enPie.length)} artículo(s) al ${fechaLarga(new Date().toISOString())}</span>
      </h3>
      ${totalesDelInventario(d.totales, d.ambito)}
      ${enPie.length
        ? tabla(enPie.filter((f) => f.regimen === 'Propio'), `Lo propio, ${suyoEs}`)
          + tabla(enPie.filter((f) => f.regimen !== 'Propio'), `Lo que no es ${suyoEs}`)
        : '<div class="empty-state" style="padding:26px">Todavía no hay nada inventariado acá.</div>'}
      ${tabla(devueltos, 'Ya devuelto a su dueño')}
      <div class="doc-pie print-only">${pieDelDocumento()}</div>
    </div>`;

  caja.querySelectorAll('tr[data-ir]').forEach((tr) => {
    tr.addEventListener('click', () => (location.hash = tr.dataset.ir));
  });
}

/* =====================================================================
 * La cartola de una cuenta
 *
 * Movimiento a movimiento, con el saldo corriendo fila a fila: es lo que se
 * compara con la cartola del banco. Y de paso contesta «cuánto había en la
 * cuenta del proyecto al 30 de junio», que antes no se podía preguntar de
 * ninguna forma —había que bajar todo a una planilla y sumar—: es el saldo
 * anterior de una cartola que empiece el 1 de julio.
 * ===================================================================== */
async function viewCartolaCuenta(cuentaId, precarga) {
  const m = MOD['cuentas_tesoreria'];
  if (!m) return (location.hash = '#/');
  /*
   * Sin período, el año corriente.
   *
   * La cartola nació pudiendo mostrar todo, y está bien que pueda: el botón
   * «Todo» sigue ahí. Lo que no sirve es que sea lo primero que aparece. Desde
   * la 1.170.0 acá se llega haciendo clic en el saldo de una cuenta, y medido en
   * la cuenta general de la corporación eso eran 3.001 filas: 683 KB, 852 ms y
   * una página de 96.495 px. Una cartola se lee por período, como la del banco.
   */
  const anio = new Date().getFullYear();
  const st = {
    desde: (precarga && precarga.desde) || `${anio}-01-01`,
    hasta: (precarga && precarga.hasta) || `${anio}-12-31`,
  };

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>🧾 Cartola de la cuenta</h2>
      <div class="actions">
        <!-- Dice a dónde va, no de dónde se viene: desde la 1.170.0 a la cartola se
             llega desde el saldo de la cuenta en Tesorería, así que «volver» sería
             mentira. Es también el botón de editarla, como en cualquier ficha. -->
        <button class="btn secondary" id="carVolver">🏦 Ficha de la cuenta</button>
        <button class="btn secondary" data-imprimir>🖨️ PDF</button>
      </div>
    </div>
    <div class="card no-print">
      <div class="toolbar">
        <label class="range">Desde <input type="date" id="carDesde" value="${esc(st.desde)}" /></label>
        <label class="range">Hasta <input type="date" id="carHasta" value="${esc(st.hasta)}" /></label>
        <button class="btn secondary" id="carMes">Este mes</button>
        <button class="btn secondary" id="carAnio">Este año</button>
        <button class="btn secondary" id="carTodo">Todo</button>
      </div>
    </div>
    <div id="carCuerpo"><p style="padding:18px">Cargando…</p></div>`;

  document.getElementById('carVolver')
    .addEventListener('click', () => (location.hash = `#/m/cuentas_tesoreria/edit/${cuentaId}`));

  const cambia = (id, campo) =>
    document.getElementById(id).addEventListener('change', (e) => { st[campo] = e.target.value; cargar(); });
  cambia('carDesde', 'desde');
  cambia('carHasta', 'hasta');
  const ponerRango = (desde, hasta) => {
    st.desde = desde; st.hasta = hasta;
    document.getElementById('carDesde').value = desde;
    document.getElementById('carHasta').value = hasta;
    cargar();
  };
  document.getElementById('carMes').addEventListener('click', () => {
    const h = new Date();
    const mes = String(h.getMonth() + 1).padStart(2, '0');
    const ultimo = new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate();
    ponerRango(`${h.getFullYear()}-${mes}-01`, `${h.getFullYear()}-${mes}-${ultimo}`);
  });
  document.getElementById('carAnio').addEventListener('click', () => {
    const a = new Date().getFullYear();
    ponerRango(`${a}-01-01`, `${a}-12-31`);
  });
  document.getElementById('carTodo').addEventListener('click', () => ponerRango('', ''));

  async function cargar() {
    const caja = document.getElementById('carCuerpo');
    caja.innerHTML = '<p style="padding:18px">Cargando…</p>';
    const params = new URLSearchParams();
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);

    let d;
    try {
      d = await api('GET', `/cuentas_tesoreria/${cuentaId}/cartola?` + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }
    const periodo = d.desde || d.hasta
      ? `del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : 'de todo lo registrado';

    caja.innerHTML = `
      <div class="informe-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit">
          Cartola de ${esc(d.cuenta.nombre)}
          <span class="mut">${esc(d.cuenta.ambito)} · ${esc(periodo)}</span>
        </h3>
        ${sinCifras(d) ? AVISO_SIN_CIFRAS : `
        <div class="resumen-cifras">
          <div class="fin slate">
            <div class="lbl">Saldo anterior${d.desde ? ` · al ${fechaCorta(d.desde)}` : ''}</div>
            <div class="num ${d.saldo_anterior < 0 ? 'saldo-negativo' : ''}">${fmtMoney(d.saldo_anterior)}</div>
          </div>
          <div class="fin green"><div class="lbl">Entró</div><div class="num">${fmtMoney(d.ingresos)}</div></div>
          <div class="fin red"><div class="lbl">Salió</div><div class="num">${fmtMoney(d.egresos)}</div></div>
          <div class="fin blue">
            <div class="lbl">Saldo final</div>
            <div class="num ${d.saldo_final < 0 ? 'saldo-negativo' : ''}">${fmtMoney(d.saldo_final)}</div>
          </div>
          <!-- Lo anotado con fecha de más adelante, dentro de este período: está
               en la hoja porque quien lo programó quiere verlo, pero no suma al
               saldo, que es lo que hay hoy (ver server/saldos.js). Solo aparece
               cuando lo hay, igual que en la ficha de la cuenta. -->
          ${Number(d.agendado) ? `
            <div class="fin slate">
              <div class="lbl">Agendado${d.agendado_desde ? ` · desde el ${fechaCorta(d.agendado_desde)}` : ''}</div>
              <div class="num">${fmtMoney(d.agendado)}</div>
            </div>` : ''}
        </div>`}
        <div class="card">
          ${d.movimientos.length ? `
          <div style="overflow-x:auto">
          <table class="grid informe grid-lista cartola">
            <thead><tr>
              <th>Fecha</th><th>Concepto</th><th>Categoría</th>${sinCifras(d) ? '<th>Tipo</th>'
                : '<th>Entró</th><th>Salió</th><th>Saldo</th>'}
            </tr></thead>
            <tbody>
              ${sinCifras(d) ? '' : `
              <tr class="tot">
                <td class="col-primera col-titular" data-label="Fecha">${d.desde ? esc(fechaCorta(d.desde)) : ''}</td>
                <td data-label="Concepto"><b>Saldo anterior</b></td>
                <td data-label="Categoría"></td>
                <td class="num" data-label="Entró"></td>
                <td class="num" data-label="Salió"></td>
                <td class="num" data-label="Saldo"><b><span class="${d.saldo_anterior < 0 ? 'saldo-negativo' : ''}">${fmtMoney(d.saldo_anterior)}</span></b></td>
              </tr>`}
              ${d.movimientos.map((mv) => `
                <tr data-ir="#/m/tesoreria/edit/${mv.id}"${Number(mv.agendado) ? ' class="por-venir"' : ''}>
                  <td class="col-primera col-titular" data-label="Fecha">${esc(fechaCorta(mv.fecha))}</td>
                  <td data-label="Concepto">${esc(mv.concepto)}${Number(mv.entre_cuentas)
                    ? ' <span class="badge">entre cuentas</span>' : ''}${Number(mv.agendado)
                    ? ' <span class="badge agendado" title="Todavía no ocurre: no suma al saldo">agendado</span>' : ''}</td>
                  <td data-label="Categoría">${esc(mv.categoria || '')}</td>
                  ${sinCifras(d) ? `<td data-label="Tipo">${esc(mv.tipo)}</td>` : `
                  <td class="num" data-label="Entró">${mv.tipo === 'Ingreso' ? fmtMoney(mv.monto) : ''}</td>
                  <td class="num" data-label="Salió">${mv.tipo === 'Egreso' ? fmtMoney(mv.monto) : ''}</td>
                  <!-- A lo que todavía no ocurre no se le pone saldo: ese saldo no
                       existió nunca, y escribirlo era lo que hacía que la hoja
                       terminara en una cifra que no está en el banco. -->
                  <td class="num" data-label="Saldo">${Number(mv.agendado)
                    ? '<span class="mut">—</span>'
                    : `<span class="${mv.saldo < 0 ? 'saldo-negativo' : ''}">${fmtMoney(mv.saldo)}</span>`}</td>`}
                </tr>`).join('')}
            </tbody>
            ${sinCifras(d) ? '' : `
            <tfoot><tr class="tot">
              <td class="col-primera col-titular" data-label="Fecha">${d.hasta ? esc(fechaCorta(d.hasta)) : ''}</td>
              <td data-label="Concepto"><b>Saldo final</b></td>
              <td data-label="Categoría"></td>
              <td class="num" data-label="Entró"><b>${fmtMoney(d.ingresos)}</b></td>
              <td class="num" data-label="Salió"><b>${fmtMoney(d.egresos)}</b></td>
              <td class="num" data-label="Saldo"><b><span class="${d.saldo_final < 0 ? 'saldo-negativo' : ''}">${fmtMoney(d.saldo_final)}</span></b></td>
            </tr></tfoot>`}
          </table></div>` : '<div class="empty-state" style="padding:26px">Esta cuenta no tiene movimientos en este período.</div>'}
        </div>
        <div class="informe-pie mut">
          ${pieDelDocumento()}<br>
          El saldo corre por fecha y, dentro de un mismo día, por el orden en que se anotaron los
          movimientos. El saldo anterior incluye el saldo inicial de la cuenta y todo lo anterior al
          período.${Number(d.agendado) ? `
          El saldo es lo que hay hoy: ${fmtNumero(d.movimientos_agendados)}
          ${d.movimientos_agendados === 1 ? 'movimiento de esta hoja está anotado' : 'movimientos de esta hoja están anotados'}
          con fecha de más adelante —van marcados «agendado»— y ${d.movimientos_agendados === 1 ? 'no suma' : 'no suman'}
          al saldo hasta el día que les corresponda.` : ''}
        </div>
      </div>`;
  }

  cargar();
}

/* =====================================================================
 * Informe de servicios
 *
 * El módulo guardaba un año de servicios con su asistencia y su ofrenda, y no
 * devolvía una sola suma: para llevar a la reunión cuánto se ofrendó y cómo
 * viene la asistencia había que sacarlo con lápiz del listado.
 *
 * Acá está abierto por mes y por tipo de servicio, con el período a la vista,
 * y sale impreso con el membrete de la institución.
 * ===================================================================== */

/** «2026-08» → «Agosto de 2026». */
function mesLargo(mes) {
  const [anio, m] = String(mes || '').split('-');
  const n = Number(m);
  return n >= 1 && n <= 12 ? `${MESES[n - 1]} de ${anio}` : String(mes || '');
}

/**
 * EL INFORME DE AYUDAS: a cuántas personas distintas se ha ayudado.
 *
 * Es la pregunta que llega desde afuera —la directiva, una fundación, la
 * cuenta anual— y la que el registro de No Miembros dijo venir a contestar.
 * Se podía contar cuántas ENTREGAS hubo, porque el listado las trae todas; no
 * cuántas PERSONAS, que no es lo mismo cuando a una se le entregó tres veces.
 *
 * Dos cosas que la pantalla dice con todas sus letras porque, calladas,
 * confunden:
 *
 *   · las personas de cada fila NO suman el total, porque la misma señora que
 *     recibió mercadería y medicamentos es una persona en cada fila y una sola
 *     en el total;
 *   · y las ayudas de antes del registro, que llevan el nombre escrito a mano
 *     y no apuntan a ninguna ficha, no se cuentan entre las personas: dos
 *     veces el mismo nombre puede ser el mismo señor o dos distintos, y no hay
 *     cómo saberlo.
 */
async function viewInformeAyudas(precarga) {
  const m = MOD['ayudas_sociales'];
  if (!m) return (location.hash = '#/');
  const st = {
    desde: (precarga && precarga.desde) || '',
    hasta: (precarga && precarga.hasta) || '',
    tipo_ayuda: (precarga && precarga.tipo_ayuda) || '',
    iglesia_id: (precarga && precarga.iglesia_id) || '',
  };
  const tipos = (m.fields.find((f) => f.name === 'tipo_ayuda') || {}).options || [];

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>📊 Informe de Ayudas Sociales</h2>
      <div class="actions">
        <button class="btn secondary" id="ayVolver">← Volver al listado</button>
        <button class="btn secondary" data-imprimir>🖨️ PDF</button>
      </div>
    </div>
    <div class="card no-print">
      <div class="toolbar">
        <select id="ayTipo" aria-label="Tipo de ayuda">
          <option value="">Todos los tipos de ayuda</option>
          ${tipos.map((t) => `<option value="${esc(t)}" ${st.tipo_ayuda === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select id="ayIglesia" aria-label="Iglesia"><option value="">Todas las iglesias</option></select>
        <label class="range">Desde <input type="date" id="ayDesde" value="${esc(st.desde)}" /></label>
        <label class="range">Hasta <input type="date" id="ayHasta" value="${esc(st.hasta)}" /></label>
        <button class="btn secondary" id="ayAnio">Este año</button>
      </div>
    </div>
    <div id="infAyudas"><p style="padding:18px">Calculando…</p></div>`;

  document.getElementById('ayVolver').addEventListener('click', () => (location.hash = '#/m/ayudas_sociales'));
  const iglesias = await getOptions('iglesias').catch(() => []);
  const selIglesia = document.getElementById('ayIglesia');
  selIglesia.innerHTML = '<option value="">Todas las iglesias</option>'
    + (iglesias || []).map((i) => `<option value="${i.id}" ${String(st.iglesia_id) === String(i.id) ? 'selected' : ''}>${esc(i.label)}</option>`).join('');

  const cambia = (id, campo) =>
    document.getElementById(id).addEventListener('change', (e) => {
      st[campo] = e.target.value;
      cargar();
    });
  cambia('ayTipo', 'tipo_ayuda');
  cambia('ayIglesia', 'iglesia_id');
  cambia('ayDesde', 'desde');
  cambia('ayHasta', 'hasta');
  document.getElementById('ayAnio').addEventListener('click', () => {
    const anio = new Date().getFullYear();
    st.desde = `${anio}-01-01`;
    st.hasta = `${anio}-12-31`;
    document.getElementById('ayDesde').value = st.desde;
    document.getElementById('ayHasta').value = st.hasta;
    cargar();
  });

  async function cargar() {
    const caja = document.getElementById('infAyudas');
    caja.innerHTML = '<p style="padding:18px">Calculando…</p>';
    const params = new URLSearchParams();
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    if (st.tipo_ayuda) params.set('f_tipo_ayuda', st.tipo_ayuda);
    if (st.iglesia_id) params.set('f_iglesia_id', st.iglesia_id);

    let d;
    try {
      d = await api('GET', '/ayudas_sociales/informe?' + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }
    const r = d.resumen;
    const soloDe = st.tipo_ayuda ? `solo «${st.tipo_ayuda}», ` : '';
    const periodo = d.desde || d.hasta
      ? `${soloDe}del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : `${soloDe}de todo lo registrado`;

    /*
     * Una cifra de plata a la que le faltan datos lo dice al lado.
     *
     * Sin esto, la ayuda que nadie valorizó se suma como cero y la fila queda
     * en «entregas 1 · valor estimado $ 0», que se lee como que se entregó
     * algo que no valía nada. Lo que pasa es otra cosa: que el total es un
     * piso. Va pegado a la cifra y no al pie, porque quien mira una tabla mira
     * la columna, no las notas.
     */
    const sinMonto = (cuantas) => (cuantas
      ? `<span class="mut" style="font-weight:400;font-size:11.5px;white-space:nowrap"> +${esc(fmtNumero(cuantas))} sin monto</span>`
      : '');

    /*
     * La aclaración se escribe entera para cada tabla y no se arma pegando el
     * nombre de la columna: salían frases como «de dos tipo de ayuda
     * distintas» y «de dos mes distintas». Una nota mal escrita al pie de una
     * cifra hace dudar de la cifra.
     */
    const tabla = (titulo, filas, columna, comoSeLlama, vacio, aclara) => `
      <div class="card" style="margin-bottom:18px">
        <h3>${esc(titulo)}</h3>
        ${filas.length ? `
        <div style="overflow-x:auto">
        <table class="grid informe grid-lista">
          <thead><tr>
            <th>${esc(columna)}</th><th>Entregas</th><th>Personas</th><th>Valor estimado</th>
          </tr></thead>
          <tbody>
            ${filas.map((f) => `
              <tr>
                <td class="col-primera col-titular" data-label="${esc(columna)}">${esc(comoSeLlama(f))}</td>
                <td class="num" data-label="Entregas">${esc(fmtNumero(f.entregas))}</td>
                <td class="num" data-label="Personas">${esc(fmtNumero(f.personas))}</td>
                <td class="num" data-label="Valor estimado">${fmtMoney(f.entregado)}${sinMonto(f.sin_monto)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr class="tot">
            <td class="col-primera col-titular" data-label="${esc(columna)}"><b>Total</b></td>
            <td class="num" data-label="Entregas"><b>${esc(fmtNumero(r.entregas))}</b></td>
            <td class="num" data-label="Personas"><b>${esc(fmtNumero(r.personas))}</b></td>
            <td class="num" data-label="Valor estimado"><b>${fmtMoney(r.entregado)}</b>${sinMonto(r.sin_monto)}</td>
          </tr></tfoot>
        </table></div>
        <p class="mut" style="padding:0 14px 12px;font-size:12.5px">Las personas de cada fila no suman
          el total: ${esc(aclara)}</p>` : `<div class="empty-state" style="padding:22px">${esc(vacio)}</div>`}
      </div>`;

    // Lo que el informe no puede contestar, dicho donde se lee la cifra
    const aclaraciones = [
      r.sin_ficha
        ? `${fmtNumero(r.sin_ficha)} ayuda(s) de este período llevan el nombre del beneficiario escrito
           a mano, de antes de que existiera el registro de personas: cuentan en las entregas y en la
           plata, pero no entre las personas, porque no hay cómo saber si dos nombres iguales son la
           misma.`
        : '',
      r.en_camino ? `${fmtNumero(r.en_camino)} ayuda(s) están solicitadas o aprobadas y todavía no entregadas.` : '',
      r.rechazadas ? `${fmtNumero(r.rechazadas)} fueron rechazadas.` : '',
      /*
       * De lo entregado, qué parte salió de una cuenta.
       *
       * Sin esta línea el informe decía «$123.000 entregados» y el balance de
       * Tesorería decía que no había salido nada: dos verdades sobre la misma
       * plata, en dos pantallas del mismo sistema. Lo que salió de cuentas es
       * exactamente lo que el libro tiene anotado como «Ayuda social», así que
       * las dos cifras ya se pueden cuadrar. Lo demás no es un error: una caja
       * de mercadería donada vale lo que vale y no salió de ninguna cuenta.
       */
      r.en_especie
        ? `De lo entregado, ${fmtMoney(r.de_cuentas)} salió de cuentas de tesorería —donde queda
           anotado como egreso— y ${fmtMoney(r.en_especie)} se entregó en especie, que no descuenta
           de ninguna cuenta.`
        : '',
      r.sin_monto
        ? `${fmtNumero(r.sin_monto)} de las ${fmtNumero(r.entregas)} entrega(s) no dicen cuánto valían,
           así que en las cifras de plata cuentan como $ 0: lo entregado es al menos lo que dice el
           total, no exactamente eso. Se completa abriendo cada una y anotando el valor.`
        : '',
      r.sin_decidir
        ? `${fmtNumero(r.sin_decidir)} entrega(s) de este período son anteriores a que se preguntara
           de dónde salía lo entregado, así que no están en el libro de la tesorería. Se pueden poner
           al día abriendo cada una e indicándolo.`
        : '',
    ].filter(Boolean);

    caja.innerHTML = `
      <div class="informe-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit">
          Informe de ayudas sociales <span class="mut">${esc(periodo)}</span>
        </h3>
        <div class="resumen-cifras">
          <div class="fin blue"><div class="lbl">Personas distintas</div><div class="num">${esc(fmtNumero(r.personas))}</div></div>
          <div class="fin slate"><div class="lbl">Recibieron más de una vez</div><div class="num">${esc(fmtNumero(r.repitieron))}</div></div>
          <div class="fin blue"><div class="lbl">Entregas</div><div class="num">${esc(fmtNumero(r.entregas))}</div></div>
          <div class="fin green"><div class="lbl">Valor estimado entregado</div><div class="num">${fmtMoney(r.entregado)}</div></div>
          <div class="fin slate"><div class="lbl">Salió de cuentas</div><div class="num">${fmtMoney(r.de_cuentas)}</div></div>
        </div>
        ${aclaraciones.length
          ? `<div class="resumen-nota">${aclaraciones.map((a) => `<p>${esc(a.replace(/\s+/g, ' '))}</p>`).join('')}</div>`
          : ''}
        ${tabla('Por tipo de ayuda', d.porTipo, 'Tipo de ayuda', (f) => f.clave || '(sin tipo)',
          'Sin entregas en este período.',
          'a quien recibió dos tipos de ayuda distintos se le cuenta en los dos y una sola vez abajo.')}
        ${d.porIglesia.length > 1
          ? tabla('Por iglesia', d.porIglesia, 'Iglesia', (f) => f.nombre, 'Sin entregas en este período.',
            'a quien recibió en dos iglesias distintas se le cuenta en las dos y una sola vez abajo.')
          : ''}
        ${tabla('Mes a mes', d.porMes, 'Mes', (f) => mesLargo(f.clave), 'Sin entregas en este período.',
          'a quien recibió en dos meses distintos se le cuenta en los dos y una sola vez abajo.')}
        <div class="card">
          <h3>A quiénes se les entregó más de una vez</h3>
          ${d.masAyudadas.length ? `
          <div style="overflow-x:auto">
          <table class="grid informe grid-lista">
            <thead><tr>
              <th>Persona</th><th>Registro</th><th>Entregas</th><th>Valor estimado</th><th>Última</th>
            </tr></thead>
            <tbody>
              ${d.masAyudadas.map((f) => `
                <tr data-ir="#/m/${f.tipo === 'Miembro' ? 'miembros' : 'no_miembros'}/ficha/${f.id}" tabindex="0">
                  <td class="col-primera col-titular" data-label="Persona">${esc(f.nombre)}</td>
                  <td data-label="Registro">${esc(f.tipo)}</td>
                  <td class="num" data-label="Entregas">${esc(fmtNumero(f.veces))}</td>
                  <td class="num" data-label="Valor estimado">${fmtMoney(f.entregado)}</td>
                  <td data-label="Última">${esc(f.ultima ? fechaCorta(f.ultima) : '')}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>`
            : '<div class="empty-state" style="padding:22px">A nadie se le entregó más de una vez en este período.</div>'}
        </div>
      </div>`;
    caja.querySelectorAll('tr[data-ir]').forEach((tr) => {
      tr.addEventListener('click', () => (location.hash = tr.dataset.ir));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') location.hash = tr.dataset.ir;
      });
    });
  }
  cargar();
}

async function viewInformeServicios(precarga) {
  const m = MOD['servicios'];
  if (!m) return (location.hash = '#/');
  const st = {
    desde: (precarga && precarga.desde) || '',
    hasta: (precarga && precarga.hasta) || '',
    tipo: (precarga && precarga.tipo) || '',
    iglesia_id: (precarga && precarga.iglesia_id) || '',
  };
  const tipos = (m.fields.find((f) => f.name === 'tipo') || {}).options || [];

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>📊 Informe de Servicios</h2>
      <div class="actions">
        <button class="btn secondary" id="infVolver">← Volver al listado</button>
        <button class="btn secondary" data-imprimir>🖨️ PDF</button>
      </div>
    </div>
    <div class="card no-print">
      <div class="toolbar">
        <select id="infTipo" aria-label="Tipo de servicio">
          <option value="">Todos los tipos de servicio</option>
          ${tipos.map((t) => `<option value="${esc(t)}" ${st.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select id="infIglesia" aria-label="Iglesia"><option value="">Todas las iglesias</option></select>
        <label class="range">Desde <input type="date" id="infDesde" value="${esc(st.desde)}" /></label>
        <label class="range">Hasta <input type="date" id="infHasta" value="${esc(st.hasta)}" /></label>
        <button class="btn secondary" id="infAnio">Este año</button>
      </div>
    </div>
    <div id="infServicios"><p style="padding:18px">Calculando…</p></div>`;

  document.getElementById('infVolver').addEventListener('click', () => (location.hash = '#/m/servicios'));
  const iglesias = await getOptions('iglesias').catch(() => []);
  const selIglesia = document.getElementById('infIglesia');
  selIglesia.innerHTML = '<option value="">Todas las iglesias</option>'
    + (iglesias || []).map((i) => `<option value="${i.id}" ${String(st.iglesia_id) === String(i.id) ? 'selected' : ''}>${esc(i.label)}</option>`).join('');

  const cambia = (id, campo) =>
    document.getElementById(id).addEventListener('change', (e) => {
      st[campo] = e.target.value;
      cargar();
    });
  cambia('infTipo', 'tipo');
  cambia('infIglesia', 'iglesia_id');
  cambia('infDesde', 'desde');
  cambia('infHasta', 'hasta');
  document.getElementById('infAnio').addEventListener('click', () => {
    const anio = new Date().getFullYear();
    st.desde = `${anio}-01-01`;
    st.hasta = `${anio}-12-31`;
    document.getElementById('infDesde').value = st.desde;
    document.getElementById('infHasta').value = st.hasta;
    cargar();
  });

  async function cargar() {
    const caja = document.getElementById('infServicios');
    caja.innerHTML = '<p style="padding:18px">Calculando…</p>';
    const params = new URLSearchParams();
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    // Los filtros exactos viajan como los del listado: es la misma consulta
    if (st.tipo) params.set('f_tipo', st.tipo);
    if (st.iglesia_id) params.set('f_iglesia_id', st.iglesia_id);

    let d;
    try {
      d = await api('GET', '/servicios/informe?' + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }

    /*
     * Un informe acotado que no lo dice se lee como si fuera el de todo, y se
     * imprime igual: el período y el tipo van en el título, que es donde el ojo
     * busca de qué es esta hoja.
     */
    const soloDe = st.tipo ? `solo «${st.tipo}», ` : '';
    const periodo = d.desde || d.hasta
      ? `${soloDe}del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : `${soloDe}de todo lo registrado`;
    const r = d.resumen;

    const tabla = (titulo, filas, columna, comoSeLlama) => `
      <div class="card" style="margin-bottom:18px">
        <h3>${esc(titulo)}</h3>
        ${filas.length ? `
        <div style="overflow-x:auto">
        <table class="grid informe grid-lista">
          <thead><tr>
            <th>${esc(columna)}</th><th>Servicios</th><th>Asistencia</th><th>Promedio</th>
            <th>Ofrenda</th><th>Aporte</th><th>Queda para la iglesia</th>
          </tr></thead>
          <tbody>
            ${filas.map((f) => `
              <tr>
                <td class="col-primera col-titular" data-label="${esc(columna)}">${esc(comoSeLlama(f))}</td>
                <td class="num" data-label="Servicios">${esc(fmtNumero(f.servicios))}</td>
                <td class="num" data-label="Asistencia">${esc(fmtNumero(f.asistencia))}</td>
                <td class="num" data-label="Promedio">${esc(fmtNumero(f.promedio_asistencia))}</td>
                <td class="num" data-label="Ofrenda">${fmtMoney(f.ofrenda)}</td>
                <td class="num" data-label="Aporte">${fmtMoney(f.aporte)}</td>
                <td class="num" data-label="Queda para la iglesia">${fmtMoney(f.queda)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr class="tot">
            <td class="col-primera col-titular" data-label="${esc(columna)}"><b>Total</b></td>
            <td class="num" data-label="Servicios"><b>${esc(fmtNumero(r.servicios))}</b></td>
            <td class="num" data-label="Asistencia"><b>${esc(fmtNumero(r.asistencia))}</b></td>
            <td class="num" data-label="Promedio"><b>${esc(fmtNumero(r.promedio_asistencia))}</b></td>
            <td class="num" data-label="Ofrenda"><b>${fmtMoney(r.ofrenda)}</b></td>
            <td class="num" data-label="Aporte"><b>${fmtMoney(r.aporte)}</b></td>
            <td class="num" data-label="Queda para la iglesia"><b>${fmtMoney(r.queda)}</b></td>
          </tr></tfoot>
        </table></div>` : '<div class="empty-state" style="padding:22px">Sin servicios en este período.</div>'}
      </div>`;

    // De cuántos servicios salió el promedio, cuando no salió de todos
    const deCuantos = r.servicios && r.con_asistencia !== r.servicios
      ? `El promedio sale de ${fmtNumero(r.con_asistencia)} de los ${fmtNumero(r.servicios)} servicios: `
        + 'los demás no tienen la asistencia anotada.'
      : '';

    caja.innerHTML = `
      <div class="informe-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit">
          Informe de servicios <span class="mut">${esc(periodo)}</span>
        </h3>
        <!-- Las mismas cifras que van arriba del listado, con el mismo formato:
             las de dinero no caben en las tarjetas chicas del informe de
             asistencia —se probó y «$ 8.005.000» se sale de la tarjeta y se
             come su rótulo—, y estas son justamente las que el sistema ya usa
             para el dinero en Tesorería. -->
        <div class="resumen-cifras">
          <div class="fin blue"><div class="lbl">Servicios</div><div class="num">${esc(fmtNumero(r.servicios))}</div></div>
          <div class="fin slate"><div class="lbl">Asistencia</div><div class="num">${esc(fmtNumero(r.asistencia))}</div></div>
          <div class="fin blue"><div class="lbl">Promedio por servicio</div><div class="num">${esc(fmtNumero(r.promedio_asistencia))}</div></div>
          <div class="fin green"><div class="lbl">Ofrenda recibida</div><div class="num">${fmtMoney(r.ofrenda)}</div></div>
          <div class="fin slate"><div class="lbl">Aporte a la corporación</div><div class="num">${fmtMoney(r.aporte)}</div></div>
          <div class="fin green"><div class="lbl">Queda para la iglesia</div><div class="num">${fmtMoney(r.queda)}</div></div>
        </div>
        ${tabla('Mes por mes', d.porMes, 'Mes', (f) => mesLargo(f.mes))}
        ${tabla('Por tipo de servicio', d.porTipo, 'Tipo de servicio', (f) => f.tipo)}
        <div class="informe-pie mut">
          ${pieDelDocumento()}<br>
          La asistencia es la de adultos más niños, y el aporte a la corporación es el que cada servicio
          guardó con su propio porcentaje.${deCuantos ? ` ${esc(deCuantos)}` : ''}
        </div>
      </div>`;
  }

  cargar();
}

function cellValue(f, row, col) {
  if (col === 'id') return row.id;
  // En el listado, a las personas se las nombra como se las nombra: el primer
  // nombre y los dos apellidos. El nombre completo está en su ficha.
  // Lo reservado que el servidor no mandó se dice, no se deja en blanco: una
  // celda vacía en una columna de plata se lee como «esta cuenta está en cero»
  // (ver estaReservado, y server/sensibles.js).
  if (estaReservado(f, row)) return '<span class="mut" title="Reservado: su cuenta no ve esta cifra">—</span>';
  const v = f.recorta ? recortar(f.recorta, row[f.name]) : row[f.name];
  if (f.computed) {
    if (v == null || v === '') return '';
    if (f.type === 'texto') return esc(v);
    if (f.type === 'money') return `<span class="${Number(v) < 0 ? 'saldo-negativo' : ''}">${fmtMoney(v)}</span>`;
    const texto = typeof v === 'object' ? v.texto : v;
    const nivel = typeof v === 'object' ? v.nivel : v;
    return `<span class="badge ${nivelClase(nivel)}">${esc(texto)}</span>`;
  }
  switch (f.type) {
    case 'ref':
      return esc(etiquetaDeRef(f, row[f.name + '_label']));
    case 'multiref':
      return esc((row[f.name + '_labels'] || []).slice(0, 3).join(', ')) + ((row[f.name + '_labels'] || []).length > 3 ? '…' : '');
    case 'richtext':
      return esc(textoPlano(v).slice(0, 90)) + (textoPlano(v).length > 90 ? '…' : '');
    case 'money':
      return fmtMoney(v);
    case 'number':
      return esc(fmtNumero(v));
    case 'boolean':
      return v ? '<span class="badge green">Sí</span>' : '<span class="badge red">No</span>';
    case 'date':
      return esc(fechaCorta(v));
    case 'rut':
      return esc(rutFormatear(v));
    case 'persona':
      return row[f.name + '_id']
        ? `<span class="persona-chip">${esc(v || '')}</span>`
        : esc(v || '');
    case 'file':
      if (!v) return '';
      if (/\.(jpe?g|png|gif|webp)$/i.test(v)) return `<img class="thumb" src="/uploads/${esc(v)}" alt="" />`;
      return `<a href="/uploads/${esc(v)}" target="_blank" data-parar="1">📎 archivo</a>`;
    case 'select': {
      if (v == null || v === '') return '';
      // Lo normal se lee como texto; lo que se sale de lo normal, con
      // distintivo. Ciento setenta y nueve veces "Activo" en verde no informa
      // nada: lo que hay que ver es el que no lo está.
      const esLoHabitual = f.default != null && String(v) === String(f.default);
      return esLoHabitual
        ? `<span class="valor-normal">${esc(selectLabel(f, v))}</span>`
        : `<span class="badge ${badgeClass(v)}">${esc(selectLabel(f, v))}</span>`;
    }
    default:
      return acortarEnLista(v);
  }
}

/**
 * Un texto en un listado no puede ser infinito.
 *
 * El listado es un resumen para encontrar la ficha; lo entero se lee en la
 * ficha. Iba tal cual venía, y bastaba UN valor largo para arruinar la
 * pantalla entera: en Bitácora, un dato con cien mil letras seguidas estiraba
 * la fila casi un millón de píxeles. La tabla se podía correr de lado —así que
 * la página no se salía y ninguna prueba se quejaba— pero había que arrastrar
 * un millón de píxeles para llegar al final de una sola fila.
 *
 * No es un caso rebuscado: basta que alguien pegue una dirección de internet
 * larga en una nota, o el contenido de un correo en una descripción.
 *
 * El tope es holgado a propósito —ciento veinte letras son más de lo que mide
 * cualquier concepto, motivo o descripción normal— para que en el uso de todos
 * los días no se note, y solo se recorte lo que de verdad se fue de las manos.
 * Los textos con formato ya se recortaban así desde antes.
 */
const TOPE_DE_TEXTO_EN_LISTA = 120;
function acortarEnLista(v) {
  const texto = String(v == null ? '' : v);
  return texto.length > TOPE_DE_TEXTO_EN_LISTA
    ? `<span class="texto-largo" title="${esc(texto.slice(0, 400))}">${esc(texto.slice(0, TOPE_DE_TEXTO_EN_LISTA))}…</span>`
    : esc(texto);
}

function selectLabel(f, v) {
  for (const o of f.options || []) {
    if (typeof o === 'object' && String(o.value) === String(v)) return o.label;
  }
  return v;
}

/* =====================================================================
 * La ficha: todo lo que el sistema sabe de alguien, en una sola pantalla
 *
 * El listado alcanza a mostrar lo justo para encontrar a la persona —y en el
 * teléfono, menos todavía—. La ficha muestra el resto: todos sus datos,
 * ordenados por las mismas secciones con las que se registran, junto con sus
 * documentos, su historial y los grupos en los que participa.
 *
 * Es de solo lectura: para cambiar algo está el botón de editar, que lleva al
 * formulario de siempre. Los campos en blanco se esconden para no estorbar la
 * lectura, y un interruptor los muestra cuando se quiere ver qué falta.
 * ===================================================================== */

/** Los módulos que se abren primero para leerlos, no para editarlos. */
/*
 * Las que se abren en su ficha al tocarlas en el listado, en vez de en el
 * formulario: casi siempre se entra a mirar un dato, no a cambiarlo.
 *
 * No Miembros se sumó cuando su ficha pasó a tener algo que mirar —lo que esa
 * persona ha pedido—. Antes no tenía nada que la ficha dijera y el formulario
 * no dijera igual.
 */
const CON_FICHA = ['miembros', 'pastores', 'cuerpos', 'iglesias', 'no_miembros'];

/** "07-11-1973": la fecha como se lee y se dice acá. */
/**
 * Si un documento ya venció, a la fecha de hoy.
 *
 * En la hoja impresa la fecha sola no basta: quien la lee está buscando qué
 * hay que renovar, y comparar diez fechas contra el día de hoy a ojo es
 * justamente lo que la hoja tendría que ahorrarle.
 */
function estaVencido(iso) {
  const cuando = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cuando)) return false;
  return cuando < new Date().toISOString().slice(0, 10);
}

function fechaCorta(iso) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}-${m}-${y}` : s;
}

/**
 * QUIÉN PASÓ ESTA LISTA Y CUÁNDO, en una frase.
 *
 * Guardar una lista borra y vuelve a escribir la marca de cada persona —es lo
 * que permite que dos personas marquen a la vez—, así que del día en que se
 * tomó no quedaba nada: la fecha de la marca pasaba a ser la de la última
 * corrección. Ahora la primera vez queda guardada aparte, y la lista lo dice.
 */
function quienPasoLaLista(t) {
  if (!t || !t.en) return '';
  const cuando = (iso) => {
    const s = String(iso || '');
    const hora = s.slice(11, 16);
    return `${fechaCorta(s)}${hora ? ` a las ${hora}` : ''}`;
  };
  const tomo = t.por ? `Lista tomada por ${t.por}` : 'Lista tomada';
  if (!t.corregida_en) return `${tomo} el ${cuando(t.en)}`;
  const corrigio = t.corregida_por ? `corregida por ${t.corregida_por}` : 'corregida';
  return `${tomo} el ${cuando(t.en)} · ${corrigio} el ${cuando(t.corregida_en)}`;
}

/** "2026-08": el mes como se nombra, no como lo guarda el computador. */
function mesLegible(aaaaMm) {
  const [y, m] = String(aaaaMm || '').split('-');
  const nombre = MESES[Number(m) - 1];
  return nombre ? `${nombre.toLowerCase()} de ${y}` : String(aaaaMm || '');
}

/** El teléfono en formato internacional, para llamar o escribir por WhatsApp. */
function telefonoInternacional(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('56') ? d : '56' + d;
}

/**
 * Cómo se nombra a una persona en pantalla.
 *
 * En la ficha se guarda todo lo que tiene —«Juan Carlos Alberto Pérez Soto»—,
 * pero en un listado o en un selector ese nombre entero ocupa una línea y no
 * ayuda a reconocer a nadie más rápido. Acá se arma la forma corta con la que
 * se la nombra: el primer nombre y los dos apellidos.
 *
 *   primero   se queda con el primer nombre de pila
 *   persona   para un nombre que viene todo junto en un solo campo: el
 *             primero y los dos últimos, que en Chile son los apellidos
 *
 * El nombre completo no se pierde: se ve entero al abrir la ficha para
 * editarla, que es donde importa.
 */
const RECORTES = {
  primero: (v) => String(v || '').trim().split(/\s+/).filter(Boolean)[0] || '',
  persona: (v) => {
    const partes = String(v || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length <= 3) return partes.join(' ');
    return [partes[0], partes[partes.length - 2], partes[partes.length - 1]].join(' ');
  },
};
const recortar = (recorte, valor) => (RECORTES[recorte] ? RECORTES[recorte](valor) : valor);

/** «Juan Carlos Alberto» + «Pérez Soto» → «Juan Pérez Soto». */
const nombreCorto = (fila) => `${RECORTES.primero(fila.nombres)} ${String(fila.apellidos || '').trim()}`.trim();

/**
 * ¿«Nuevo miembro» o «Nueva iglesia»?
 *
 * El género lo manda el sustantivo que encabeza el nombre del módulo, no la
 * última palabra: un «documento de la iglesia» es nuevo, y un «acta de
 * reunión» es nueva. Por eso se mira solo la primera palabra.
 *
 * La terminación acierta en casi todos; el módulo que no —«credencial»— lo
 * dice él mismo con `genero`.
 */
function nuevoDe(m) {
  if (m.genero) return m.genero === 'f' ? 'Nueva' : 'Nuevo';
  const cabeza = String(m.labelSingular || '').toLowerCase().split(/[\s/]+/)[0];
  return /(a|ción|sión|dad|tad|ud|umbre|triz)$/.test(cabeza) ? 'Nueva' : 'Nuevo';
}

/**
 * El nombre con el que se presenta un registro, según la plantilla del módulo.
 *
 * Una fecha se lee como fecha: la plantilla pegaba el valor guardado, y el
 * título de la ficha quedaba diciendo «2026-06-10 — Aporte de junio» encima de
 * un campo «Fecha del traspaso» que decía «10-06-2026». Misma regla que en el
 * servidor (ver `displayOf` en server/registry.js), que arma este mismo texto
 * para las etiquetas de las referencias.
 */
function nombreDelRegistro(m, row) {
  const tipoDe = {};
  for (const f of m.fields || []) tipoDe[f.name] = f.type;
  const texto = String(m.display || '')
    .replace(/\{(\w+)(?::(\w+))?\}/g, (_, campo, recorte) => {
      const valor = row[campo] == null ? '' : String(row[campo]);
      if (recorte) return recortar(recorte, valor);
      if (tipoDe[campo] === 'date' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return fechaCorta(valor);
      return valor;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return texto || `${m.labelSingular} N.º ${row.id}`;
}

/**
 * Cómo se lee cada dato en la ficha. Devuelve HTML, o '' cuando no hay nada
 * registrado (así la ficha sabe qué campos están en blanco).
 *
 * Un valor guardado que no figura en la lista de opciones —un parentesco
 * escrito a mano, algo que venga de otro sistema— se muestra tal cual: el
 * dato está, y esconderlo sería peor que mostrarlo.
 */
function valorFicha(f, row) {
  const v = row[f.name];
  const vacio = v == null || v === '' || (Array.isArray(v) && !v.length);
  if (f.computed) {
    if (vacio) return '';
    if (typeof v === 'object') return `<span class="badge ${nivelClase(v.nivel)}">${esc(v.texto)}</span>`;
    return f.type === 'money' ? fmtMoney(v) : esc(v);
  }
  switch (f.type) {
    case 'ref':
      return v ? esc(etiquetaDeRef(f, row[f.name + '_label']) || `#${v}`) : '';
    case 'multiref': {
      const nombres = row[f.name + '_labels'] || [];
      return nombres.length ? nombres.map((n) => `<span class="chip">${esc(n)}</span>`).join(' ') : '';
    }
    case 'boolean':
      return v ? '<span class="badge green">Sí</span>' : '<span class="badge">No</span>';
    case 'money':
      return vacio ? '' : fmtMoney(v);
    case 'number':
      return vacio ? '' : esc(fmtNumero(v));
    case 'date': {
      if (vacio) return '';
      const edad = f.mostrarEdad ? edadDeFecha(v) : '';
      return `${esc(fechaCorta(v))}${edad ? ` <span class="dato-nota">${esc(edad)}</span>` : ''}`;
    }
    case 'time':
      return vacio ? '' : esc(String(v).slice(0, 5));
    case 'color': {
      // Un código hexadecimal no se lee: se muestra la muestra del color,
      // y el código al lado para quien lo necesite copiar
      if (vacio || !/^#[0-9a-f]{6}$/i.test(String(v))) return '';
      return `<span class="dato-color"><i style="background:${esc(v)}"></i>${esc(String(v).toLowerCase())}</span>`;
    }
    case 'rut':
      return vacio ? '' : esc(rutFormatear(v));
    case 'tel': {
      if (vacio) return '';
      const num = telefonoInternacional(v);
      const wasap = /^569\d{8}$/.test(num)
        ? ` <a class="dato-wa" href="https://wa.me/${num}" target="_blank" rel="noopener" title="Escribir por WhatsApp">💬</a>`
        : '';
      return `<a href="tel:+${esc(num)}">${esc(v)}</a>${wasap}`;
    }
    case 'email':
      return vacio ? '' : `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    case 'file': {
      if (vacio) return '';
      if (/\.(jpe?g|png|gif|webp)$/i.test(v)) {
        return `<a href="/uploads/${esc(v)}" target="_blank"><img class="dato-imagen" src="/uploads/${esc(v)}" alt="" /></a>`;
      }
      return `<a href="/uploads/${esc(v)}" target="_blank">📎 ${esc(nombreArchivo(v))}</a>`;
    }
    case 'textarea':
      return vacio ? '' : `<div class="dato-texto">${esc(v)}</div>`;
    case 'richtext':
      // Ya viene limpio del servidor (server/textorico.js): solo formato
      return vacio ? '' : `<div class="dato-rico">${v}</div>`;
    case 'select':
      return vacio ? '' : `<span class="badge ${badgeClass(v)}">${esc(selectLabel(f, v))}</span>`;
    case 'persona':
      return vacio ? '' : row[f.name + '_id'] ? `<span class="persona-chip">${esc(v)}</span>` : esc(v);
    case 'permisos':
    case 'password':
      return '';
    default:
      return vacio ? '' : esc(v);
  }
}

/**
 * ¿Este campo le aplica a este registro? Los que dependen de otro —los datos
 * del adulto responsable, que solo son de los menores de 18— no se muestran
 * cuando la condición no se cumple, salvo que traigan algo escrito: si el
 * dato está, se muestra igual.
 */
function aplicaEnLaFicha(f, row) {
  if (!f.showIf) return true;
  const actual = row[f.showIf.field];
  if (f.showIf.menorDe !== undefined) {
    const anios = aniosDeFecha(actual);
    return anios != null && anios < Number(f.showIf.menorDe);
  }
  if (f.showIf.equals !== undefined) return String(actual == null ? '' : actual) === String(f.showIf.equals);
  if (Array.isArray(f.showIf.in)) return f.showIf.in.map(String).includes(String(actual == null ? '' : actual));
  return true;
}

async function viewFicha(name, id, pestana) {
  const m = MOD[name];
  content().innerHTML = `<div class="card"><div class="card-body">Cargando…</div></div>`;

  let row;
  try {
    row = await api('GET', `/${name}/${id}`);
  } catch (e) {
    content().innerHTML = `
      <div class="page-head"><h2>${m.icon} ${esc(m.labelSingular)}</h2>
        <div class="actions"><button class="btn secondary" id="btnBack">← Volver</button></div></div>
      <div class="card"><div class="card-body" style="color:var(--danger)">${esc(e.message)}</div></div>`;
    document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));
    return;
  }

  const campos = m.fields.filter((f) => f.type !== 'password' && f.type !== 'permisos');
  const campoFoto = campos.find((f) => f.type === 'file' && String(f.accept || '').startsWith('image'));

  // Lo que va en el encabezado no se repite abajo
  const enCabecera = new Set([campoFoto ? campoFoto.name : '', 'tratamiento'].filter(Boolean));

  // Insignias y subtítulo: lo mismo que distingue a la persona en el listado
  const insignias = [];
  const subtitulo = [];
  for (const c of m.listFields || []) {
    if (enCabecera.has(c)) continue;
    const f = campos.find((x) => x.name === c);
    if (!f) continue;
    const v = row[f.name];
    if (v == null || v === '') continue;
    if (f.type === 'select') insignias.push(`<span class="badge ${badgeClass(v)}">${esc(selectLabel(f, v))}</span>`);
    else if (f.computed && typeof v !== 'object') insignias.push(`<span class="badge">${esc(v)}</span>`);
    else if (f.type === 'ref') subtitulo.push(etiquetaDeRef(f, row[f.name + '_label']));
  }

  const titulo = nombreDelRegistro(m, row);
  const conTrato = row.tratamiento ? `${row.tratamiento} ${titulo}` : titulo;

  // Para llamar o escribir de inmediato, sin copiar el número a mano
  const campoTel = campos.find((f) => f.type === 'tel' && row[f.name]);
  const campoMail = campos.find((f) => f.type === 'email' && row[f.name]);
  const numero = campoTel ? telefonoInternacional(row[campoTel.name]) : '';
  const acciones = [
    numero ? `<a class="btn secondary sm" href="tel:+${esc(numero)}">📞 Llamar</a>` : '',
    /^569\d{8}$/.test(numero)
      ? `<a class="btn secondary sm" href="https://wa.me/${esc(numero)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : '',
    campoMail ? `<a class="btn secondary sm" href="mailto:${esc(row[campoMail.name])}">✉️ Correo</a>` : '',
  ].filter(Boolean).join('');

  // Los datos, agrupados por las secciones de la ficha
  const grupos = [];
  let grupo = null;
  // Si el campo que abre una sección va en el encabezado —la foto—, el título
  // de esa sección pasa al primer campo que sí se muestre.
  let seccionPendiente = '';
  for (const f of campos) {
    if (enCabecera.has(f.name)) {
      if (f.seccion) seccionPendiente = f.seccion;
      continue;
    }
    if (f.computed) {
      if ((m.listFields || []).includes(f.name)) continue; // ya va como insignia
      if (!grupo || grupo.titulo !== 'Según el sistema') {
        grupo = { titulo: 'Según el sistema', datos: [] };
        grupos.push(grupo);
      }
    } else {
      // Lo reservado que el servidor no mandó no se dibuja: un campo vacío se
      // lee como «no tiene ninguna alergia» o «no tiene teléfono», que es peor
      // que nada. Arriba de la ficha se avisa que existe y no se está mostrando.
      if (estaReservado(f, row)) continue;
      const seccion = f.seccion || seccionPendiente;
      if (seccion || !grupo) {
        grupo = { titulo: seccion || 'Datos generales', datos: [] };
        grupos.push(grupo);
      }
      seccionPendiente = '';
    }
    const html = valorFicha(f, row);
    if (!html && !aplicaEnLaFicha(f, row)) continue; // no le aplica y nada que mostrar
    grupo.datos.push({ f, html });
  }

  // Una sección puede quedar sin ningún campo que mostrar
  for (let i = grupos.length - 1; i >= 0; i--) if (!grupos[i].datos.length) grupos.splice(i, 1);

  const enBlanco = grupos.reduce((n, g) => n + g.datos.filter((d) => !d.html).length, 0);
  const cuerpo = grupos.map((g) => {
    const todoEnBlanco = g.datos.every((d) => !d.html);
    return `
      <div class="ficha-seccion${todoEnBlanco ? ' vacio' : ''}"><span>${esc(g.titulo)}</span></div>
      ${g.datos.map((d) => `
        <div class="ficha-dato${d.html ? '' : ' vacio'}${d.f.destacado && d.html ? ' destacado' : ''}">
          <span class="dl">${esc(d.f.label)}</span>
          <span class="dv">${d.html || '<span class="sin">Sin registrar</span>'}</span>
        </div>`).join('')}`;
  }).join('');

  const foto = campoFoto && row[campoFoto.name]
    ? `<img class="fc-foto" src="/uploads/${esc(row[campoFoto.name])}" alt="" />`
    : `<div class="fc-foto sin">${m.icon}</div>`;

  content().innerHTML = `
    <div class="page-head">
      <h2>${m.icon} ${esc(m.labelSingular)}</h2>
      <div class="actions">
        <button class="btn secondary" id="btnBack">← Volver</button>
        ${m.printable && tieneLlave('datos_impresion') ? `<button class="btn secondary" id="btnPrint">🖨️ Imprimir</button>` : ''}
        ${m.perms.edit ? `<button class="btn" id="btnEdit">✏️ Editar</button>` : ''}
      </div>
    </div>

    <div class="card ficha-cabecera">
      ${foto}
      <div class="fc-datos">
        <h3>${esc(conTrato)}</h3>
        ${subtitulo.filter(Boolean).length ? `<div class="fc-sub">${esc(subtitulo.filter(Boolean).join(' · '))}</div>` : ''}
        <div class="fc-badges" id="fcInsignias"${insignias.length ? '' : ' hidden'}>${insignias.join('')}</div>
        ${acciones ? `<div class="fc-acciones">${acciones}</div>` : ''}
      </div>
    </div>

    <div id="fichaResumen"></div>
    <div id="fichaPestanas"></div>
    <div id="fichaPaneles"></div>`;

  document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const be = document.getElementById('btnEdit');
  if (be) be.addEventListener('click', () => (location.hash = `#/m/${name}/edit/${id}`));
  const bp = document.getElementById('btnPrint');
  if (bp) bp.addEventListener('click', () => (location.hash = `#/print/${name}/${id}`));

  /*
   * Cuántas veces se le ha entregado algo, arriba y sin abrir nada.
   *
   * Va en la cabecera y no solo en su pestaña porque es lo que hay que saber
   * ANTES de decidir: quien abre la ficha en el mostrador no va a ir a
   * buscarlo. Se pide aparte y llega después —la ficha no se queda esperando
   * por esto—, y si no llega, la ficha se ve igual que siempre.
   */
  /*
   * «Esta persona ya se inscribió», donde se ve antes de hacer nada.
   *
   * La ficha lo decía —al pie de la pestaña de Datos, después de todos sus
   * campos—, así que había que llegar hasta abajo para enterarse. Quien abre
   * esta ficha a registrarle algo no llega hasta abajo: se lo registra a una
   * ficha que ya nadie mira, y esa entrega desaparece de la vista de la
   * persona. Va arriba, junto al nombre, con el enlace a la ficha que sí vive.
   */
  /*
   * Lo que la iglesia ES, arriba de todo y sin abrir ninguna pestaña: cuánta
   * gente, cuántos cuerpos, cuánto en caja, cuándo fue la última actividad. Se
   * pide aparte y llega después; si no llega, la ficha se ve igual que siempre.
   */
  if (name === 'iglesias') renderResumenDeIglesia(id, document.getElementById('fichaResumen'));

  if (name === 'no_miembros' && row.miembro_id && MOD['miembros']) {
    const caja = document.getElementById('fcInsignias');
    if (caja) {
      caja.insertAdjacentHTML('beforeend',
        `<a class="badge blue" href="#/m/miembros/ficha/${row.miembro_id}"
            title="Su ficha viva es la del registro oficial">📇 Ya se inscribió · ver su ficha de miembro</a>`);
      caja.hidden = false;
    }
  }

  if (COMO_RECIBE_AYUDA[name] && MOD['ayudas_sociales']) {
    // Se guarda ESTA caja, no se busca de nuevo al volver: si en el intertanto
    // se abrió la ficha de otra persona, la respuesta que llega tarde es de la
    // anterior y escribiría su cuenta en la cabecera equivocada.
    const suCaja = document.getElementById('fcInsignias');
    api('GET', `/ayudas_sociales/de-persona?tipo=${encodeURIComponent(COMO_RECIBE_AYUDA[name])}&id=${id}`)
      .then((d) => {
        const dice = resumenDeAyudas(d);
        if (!dice || !suCaja || !suCaja.isConnected) return;
        suCaja.insertAdjacentHTML('beforeend', `<span class="badge">🤝 ${esc(dice)}</span>`);
        suCaja.hidden = false;
      })
      .catch(() => {});
  }

  // Lo que no se puede pasar por alto de esta persona, antes de sus datos
  if (name === 'miembros') avisosDelMiembro(row);
  avisoDeLoReservado(row, name === 'miembros' ? ['miembros_salud'] : []);

  /** La primera pestaña: los datos de la ficha, más lo chico que va con ellos. */
  const pintarLosDatos = (caja) => {
    caja.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <b style="font-size:14px">Datos registrados</b>
          <label class="ver-blancos"${enBlanco ? '' : ' hidden'}>
            <input type="checkbox" id="verBlancos" /> Ver los ${enBlanco} campo${enBlanco === 1 ? '' : 's'} en blanco
          </label>
        </div>
        <div class="ficha-datos" id="fichaDatos">${cuerpo}</div>
      </div>`;

    const vb = document.getElementById('verBlancos');
    if (vb) {
      vb.addEventListener('change', () => {
        document.getElementById('fichaDatos').classList.toggle('con-vacios', vb.checked);
      });
    }

    // Lo chico que habla del propio registro va con sus datos y no en una
    // pestaña aparte: son tres líneas que además pueden no aparecer, y una
    // pestaña que a veces está vacía es peor que no tenerla.
    const alPie = (fn, ...args) => {
      const suya = document.createElement('div');
      caja.appendChild(suya);
      fn(...args, suya);
    };
    if (name === 'cuerpos') alPie(renderCumplimientoCuerpo, Number(id));
    if (name === 'credenciales') alPie(renderEmisionCredencial, Number(id));
    if (name === 'pastores') alPie(renderFichaMiembroPastor, Number(id), row);
    if (name === 'miembros') alPie(renderMenoresACargo, Number(id));
    if (name === 'miembros') alPie(renderAccesoMiembro, Number(id));
    if (name === 'no_miembros') alPie(renderInscribirNoMiembro, Number(id), row);
  };

  pintarPestanasDeLaFicha(name, Number(id), row, pintarLosDatos, pestana);
}

/**
 * Las pestañas de una ficha.
 *
 * Todo lo que cuelga de una ficha —la gente del cuerpo, su plata, sus actas,
 * los documentos de un miembro, su historial— se pintaba una tarjeta debajo de
 * la otra. En un computador se notaba poco; en el teléfono la ficha de un
 * cuerpo con veintiocho integrantes obligaba a bajar la pantalla entera para
 * llegar a las actas, y no había manera de volver arriba sin subir todo de
 * nuevo. Ahora cada sección es una pestaña, en una barra que se corre de lado.
 *
 * Tres cosas que hacen que valga la pena y no sea solo un cambio de aspecto:
 *
 *   · **cada una se pide cuando se abre**. Antes se cargaban las seis de una,
 *     aunque nadie mirara ninguna;
 *   · **lo que se pintó se queda**. Volver a una pestaña no la vuelve a pedir
 *     ni pierde lo que uno dejó puesto —el año de las cuotas, el filtro de los
 *     integrantes—;
 *   · **la dirección la lleva**. `#/m/cuerpos/ficha/12/tesoreria` abre esa
 *     pestaña, así que se puede guardar y mandar. Cambiar de pestaña reemplaza
 *     la dirección en vez de apilarla: el botón de atrás vuelve de donde se
 *     venía y no obliga a deshacer una por una las pestañas que se miraron.
 *
 * Las que esa persona no puede ver no aparecen: la lista se arma con los
 * mismos permisos que ya decidían si el panel se pintaba (ver LLAVES en
 * server/permissions.js).
 */
/**
 * «Ahora sí se inscribió»: de No Miembro a miembro de la iglesia.
 *
 * Es el paso que evita el problema que trae dejar entrar gente de fuera a los
 * grupos. Alguien empieza sirviendo en el equipo de sonido sin estar inscrito,
 * se convierte, se bautiza y se inscribe. Sin este botón termina con dos
 * fichas —una en cada registro— y su historial de grupo colgando de la que ya
 * no se usa; con él, la ficha nueva hereda sus grupos y su asistencia.
 *
 * La ficha de acá NO se borra: queda apuntando a la nueva, porque las ayudas
 * que se le entregaron cuando no era miembro cuelgan de ella y siguen siendo
 * ciertas.
 */
async function renderInscribirNoMiembro(id, row, caja) {
  const yaEsMiembro = !!row.miembro_id;
  // Inscribir a alguien es entrar al registro oficial: hace falta poder crear
  // miembros, no basta con administrar este registro
  const puede = !yaEsMiembro && MOD['miembros'] && MOD['miembros'].perms.create && MOD['no_miembros'].perms.edit;
  if (!puede && !yaEsMiembro) return;

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar"><b>📇 Registro oficial de miembros</b></div>
      <div class="card-body">
        ${yaEsMiembro
          ? `<p>Esta persona <b>ya se inscribió</b> como miembro de la iglesia. Su ficha viva es la del
               registro oficial; esta queda como constancia de lo que se le entregó antes.</p>
             <a class="btn" href="#/m/miembros/ficha/${row.miembro_id}">👤 Ver su ficha de miembro</a>`
          : `<p>Si esta persona se inscribió como miembro de la iglesia, acá se le crea su ficha en el
               registro oficial con lo que ya se sabe de ella. <b>Se lleva sus grupos y su asistencia</b>,
               con las fechas de siempre, y esta ficha queda apuntando a la nueva sin borrarse.</p>
             <button class="btn" id="btnInscribir">📇 Inscribir como miembro</button>
             <div id="inscribirDice" class="mut" style="margin-top:8px"></div>`}
      </div>
    </div>`;

  const boton = document.getElementById('btnInscribir');
  if (!boton) return;
  boton.addEventListener('click', async () => {
    const nombre = `${row.nombres || ''} ${row.apellidos || ''}`.trim();
    if (!confirm(
      `¿Inscribir a ${nombre} en el registro oficial de miembros?\n\n`
      + 'Se le crea su ficha de miembro y se le llevan sus grupos y su asistencia, '
      + 'con las fechas de siempre. Esta ficha no se borra: queda apuntando a la nueva.'
    )) return;
    boton.disabled = true;
    const dice = document.getElementById('inscribirDice');
    try {
      const r = await api('POST', `/no_miembros/${id}/inscribir`, {});
      toast(`Quedó inscrita. Se le pasaron ${r.grupos} grupo(s) y ${r.marcas} marca(s) de asistencia.`);
      location.hash = `#/m/miembros/ficha/${r.miembroId}`;
    } catch (e) {
      boton.disabled = false;
      if (dice) dice.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    }
  });
}

function pestanasDeLaFicha(name, id, row, pintarLosDatos) {
  const suyas = [{ clave: 'datos', titulo: 'Datos', icono: '📋', pinta: pintarLosDatos }];
  const sumar = (clave, titulo, icono, pinta) => suyas.push({ clave, titulo, icono, pinta });

  if (name === 'cuerpos') {
    if (MOD['integrantes_cuerpo']) sumar('integrantes', 'Integrantes', '🧑‍🤝‍🧑', (c) => renderIntegrantesCuerpo(id, c));
    if (MOD['cuotas_cuerpo'] && tieneLlave('tesoreria_cuerpo')) sumar('cuotas', 'Cuotas', '🎟️', (c) => renderCuotasCuerpo(id, c));
    if (MOD['cuentas_tesoreria'] && tieneLlave('tesoreria_cuerpo')) sumar('tesoreria', 'Tesorería', '💰', (c) => renderTesoreriaCuerpo(id, c));
    if (MOD['directivas']) sumar('directivas', 'Directivas', '🏅', (c) => renderDirectivasCuerpo(id, c));
    if (MOD['actas_reuniones']) sumar('actas', 'Actas', '📝', (c) => renderActasCuerpo(id, c));
    /*
     * El inventario del cuerpo era lo único suyo que no se veía desde su ficha:
     * tenía integrantes, cuotas, tesorería, directivas y actas, y sus cosas
     * había que ir a buscarlas al listado general, que además no se dejaba
     * filtrar por cuerpo.
     */
    if (MOD['inventarios']) {
      sumar('inventario', 'Inventario', '📦', (c) => renderInventarioDeNivel(
        { ambito: 'Cuerpo / Grupo', cuerpoId: id, titulo: 'Inventario del cuerpo' }, c));
    }
  }
  /*
   * Lo que cuelga de una iglesia, en su propia ficha.
   *
   * Tenía cuatro pestañas —Datos, Inventario, Documentos, Historial— contra las
   * siete del cuerpo más chico de la organización, así que la ficha de la
   * congregación entera decía menos de sí misma que la de cualquiera de sus
   * grupos. Para saber cuánta gente tiene había que ir a Miembros y filtrar.
   *
   * El orden es el de las preguntas que se hacen: primero la gente, después
   * cómo está organizada, después quién la pastorea, después la plata.
   */
  if (name === 'iglesias') {
    if (MOD['miembros']) {
      sumar('miembros', 'Miembros', '🧍', (c) => renderLoDeLaIglesia({
        modulo: 'miembros', id, icono: '🧍', titulo: 'Miembros de la iglesia', sort: 'apellidos',
        comoSeLee: (f) => ({
          texto: nombreDelRegistro(MOD['miembros'], f),
          apunte: f.cargo || '',
          estado: f.estado && f.estado !== 'Activo' ? f.estado : '',
        }),
        vacio: 'Esta iglesia todavía no tiene miembros inscritos.',
      }, c));
    }
    if (MOD['cuerpos']) {
      sumar('cuerpos', 'Cuerpos', '👥', (c) => renderLoDeLaIglesia({
        modulo: 'cuerpos', id, icono: '👥', titulo: 'Cuerpos y grupos', cuantos: 50, sort: 'nombre',
        comoSeLee: (f) => ({
          texto: f.nombre,
          apunte: f.tipo || '',
          estado: f.estado && f.estado !== 'Activo' ? f.estado : '',
        }),
        vacio: 'Esta iglesia todavía no tiene cuerpos ni grupos.',
      }, c));
    }
    if (MOD['pastores']) {
      sumar('pastores', 'Pastores', '🧑‍💼', (c) => renderLoDeLaIglesia({
        modulo: 'pastores', id, icono: '🧑‍💼', titulo: 'Pastores y guías', cuantos: 30, sort: 'apellidos',
        comoSeLee: (f) => ({
          texto: nombreDelRegistro(MOD['pastores'], f),
          apunte: f.cargo || '',
          estado: f.estado && f.estado !== 'Activo' ? f.estado : '',
        }),
        vacio: 'Esta iglesia todavía no tiene pastores ni guías anotados.',
      }, c));
    }
    if (MOD['cuentas_tesoreria']) {
      sumar('tesoreria', 'Tesorería', '💰', (c) => renderTesoreriaDeLaIglesia(id, c));
    }
    if (MOD['inventarios']) {
      // Lo de la iglesia, sin lo de sus cuerpos: cada cuerpo tiene lo suyo en su
      // propia ficha, y mezclarlos haría que un mismo artículo se contara dos veces
      sumar('inventario', 'Inventario', '📦', (c) => renderInventarioDeNivel(
        { ambito: 'Iglesia local', iglesiaId: id, titulo: 'Inventario de la iglesia' }, c));
    }
  }
  if (name === 'miembros' && MOD['cuerpos']) sumar('cuerpos', 'Cuerpos', '👥', (c) => renderCuerposDelMiembro(id, c));
  /*
   * Cómo ha asistido, donde uno la está mirando.
   *
   * El informe por persona ya existía, pero había que ir a la pestaña de
   * Informes y escribir su nombre. Es lo que se mira antes de una entrevista o
   * de evaluar un período de prueba, así que va en la ficha.
   */
  if (name === 'miembros' && MOD['asistencias']) {
    sumar('asistencia', 'Asistencia', '✅', (c) => renderAsistenciaDeLaPersona('Miembro', id, c));
  }
  if (name === 'no_miembros' && MOD['asistencias']) {
    sumar('asistencia', 'Asistencia', '✅', (c) => renderAsistenciaDeLaPersona('No miembro', id, c));
  }
  /*
   * Cuándo predicó, coordinó o leyó el salmo.
   *
   * El servicio deja enlazadas a su ficha las tres personas que lo sirvieron, y
   * la ficha no mostraba nada de eso: «¿cuándo predicó el hermano?» no se podía
   * contestar desde donde uno la hace.
   */
  if (name === 'miembros' && MOD['servicios']) {
    sumar('servicios', 'Servicios', '🕊️', (c) => renderServiciosDeLaPersona(id, c));
  }
  // «Para poder ver todo lo que pidió una persona» era el motivo del módulo, y
  // hasta acá había que ir al listado a buscarla por nombre
  if (name === 'miembros' && MOD['solicitudes']) {
    sumar('solicitudes', 'Solicitudes', '📨', (c) => renderSolicitudesDeLaPersona('Miembro', id, c));
  }
  if (name === 'no_miembros' && MOD['solicitudes']) {
    sumar('solicitudes', 'Solicitudes', '📨', (c) => renderSolicitudesDeLaPersona('No miembro', id, c));
  }
  /*
   * Lo que se le ha entregado, en su ficha.
   *
   * El registro de No Miembros existe por las ayudas sociales, y su ficha no
   * decía ni una palabra de ellas: tenía pestaña para lo que la persona pidió
   * y para si vino, pero no para lo que se le entregó. Va en los dos
   * registros porque la misma persona puede recibir antes y después de
   * inscribirse.
   */
  if (COMO_RECIBE_AYUDA[name] && MOD['ayudas_sociales']) {
    sumar('ayudas', 'Ayudas', '🤝', (c) =>
      renderAyudasDeLaPersona(COMO_RECIBE_AYUDA[name], id, c, name === 'no_miembros' ? row.miembro_id : null));
  }
  if (name === 'pastores' && MOD['credenciales']) sumar('credenciales', 'Credenciales', '🪪', (c) => renderCredencialesDelPastor(id, c));
  if (name === 'solicitudes') {
    sumar('tramitacion', 'Tramitación', '🔁', (c) => renderTramitacionSolicitud(id, row, c));
    if (MOD['personas_solicitud']) sumar('personas', 'Personas', '🧑‍🤝‍🧑', (c) => renderPersonasSolicitud(id, c));
  }

  const docs = PANEL_DOCUMENTOS[name];
  if (docs && MOD[docs.modulo]) sumar('documentos', 'Documentos', '🗂️', (c) => renderDocumentos(docs, id, c));
  const hist = PANEL_HISTORIAL[name];
  if (hist && MOD[hist.modulo]) sumar('historial', 'Historial', '🗒️', (c) => renderHistorial(hist, id, c));

  return suyas;
}

/**
 * Una barra de pestañas: la misma para la ficha y para la configuración.
 *
 * Estaba escrita adentro de la ficha, y cuando la configuración pidió lo mismo
 * había dos caminos: copiarla o sacarla afuera. Copiada, el día que se
 * arreglara algo del teclado o del desplazamiento habría que acordarse de
 * arreglarlo dos veces, y no se acuerda nadie.
 *
 * Cada pestaña puede traer su contenido de dos maneras:
 *
 *   html   ya escrito, y se pone al armar la barra. Es lo que necesitan los
 *          grupos de la configuración: sus campos tienen que estar TODOS en la
 *          pantalla aunque su pestaña no se haya abierto, porque el botón de
 *          guardar los junta de una sola pasada y lo que no está no se guarda.
 *   pinta  una función que se llama la PRIMERA vez que se abre esa pestaña.
 *          Es para lo que cuesta —una consulta al servidor, una lista larga—:
 *          así abrir la pantalla no pide diez cosas que quizá nadie mire.
 *
 * `direccionDe(clave)` dice qué dirección dejar en la barra del navegador al
 * cambiar de pestaña, o null si esa pantalla no lo necesita. Se cambia sin
 * recargar: volver a pintarla entera para mover una pestaña sería pedir de
 * nuevo todo lo que ya está en pantalla.
 */
function montarPestanas({ barra, zona, pestanas, elegida, etiqueta, direccionDe }) {
  if (!barra || !zona || !pestanas.length) return;

  barra.innerHTML = `
    <div class="pestanas" role="tablist" aria-label="${esc(etiqueta || 'Secciones')}">
      ${pestanas.map((p) => `
        <button type="button" role="tab" id="pes_${p.clave}" data-pestana="${p.clave}"
          aria-controls="pan_${p.clave}" aria-selected="false" tabindex="-1">
          <span class="ic" aria-hidden="true">${p.icono}</span>${esc(p.titulo)}</button>`).join('')}
    </div>`;
  zona.innerHTML = pestanas.map((p) => `
    <section class="panel-pestana" id="pan_${p.clave}" role="tabpanel" aria-labelledby="pes_${p.clave}" hidden>
      ${p.html || ''}
    </section>`).join('');

  const pintadas = new Set();
  const abrir = (clave, mover) => {
    const cual = pestanas.find((p) => p.clave === clave) || pestanas[0];
    for (const p of pestanas) {
      const boton = barra.querySelector(`[data-pestana="${p.clave}"]`);
      const panel = document.getElementById(`pan_${p.clave}`);
      const activa = p.clave === cual.clave;
      boton.classList.toggle('on', activa);
      boton.setAttribute('aria-selected', activa ? 'true' : 'false');
      boton.tabIndex = activa ? 0 : -1;
      panel.hidden = !activa;
    }
    // Lo que cuesta se pide al abrir, y una sola vez: volver no lo vuelve a
    // cargar ni pierde lo que uno dejó puesto adentro
    if (cual.pinta && !pintadas.has(cual.clave)) {
      pintadas.add(cual.clave);
      cual.pinta(document.getElementById(`pan_${cual.clave}`));
    }
    // La barra se corre para dejar la elegida al centro: si no, la que se
    // acaba de tocar podía quedar debajo del desvanecido del borde y parecer
    // que no estaba activa.
    const suBoton = barra.querySelector(`[data-pestana="${cual.clave}"]`);
    suBoton.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    if (mover) suBoton.focus();
    // El desplazamiento es suave: se mira cuándo terminó
    setTimeout(() => barra.mirarLosBordes && barra.mirarLosBordes(), 400);

    const nueva = direccionDe && direccionDe(cual.clave);
    if (nueva && location.hash !== nueva) history.replaceState(null, '', nueva);
  };

  barra.querySelectorAll('[data-pestana]').forEach((b) =>
    b.addEventListener('click', () => abrir(b.dataset.pestana)));

  /**
   * Y se avisa por qué lado queda barra sin ver.
   *
   * Se mide el contenido en vez de suponerlo por el ancho de la pantalla: la
   * barra de Configuración tiene diez pestañas y no cabe ni en un computador,
   * así que la última quedaba cortada por el borde como si ahí se acabara.
   */
  const tira = barra.querySelector('.pestanas');
  const mirarLosBordes = () => {
    const sobra = tira.scrollWidth - tira.clientWidth;
    tira.classList.toggle('mas-izquierda', tira.scrollLeft > 4);
    tira.classList.toggle('mas-derecha', sobra > 4 && tira.scrollLeft < sobra - 4);
  };
  barra.mirarLosBordes = mirarLosBordes;
  tira.addEventListener('scroll', mirarLosBordes, { passive: true });
  /**
   * El oyente de «resize» va colgado de la pantalla entera, no de la barra,
   * así que no se lo lleva el barrido de la pantalla siguiente: se queda
   * mirando una barra que ya no existe, y cada visita deja uno más. Con
   * `signal` se va solo cuando esta barra se va (ver `barridoDePantalla`).
   */
  window.addEventListener('resize', mirarLosBordes, { signal: alCambiarDePantalla() });
  mirarLosBordes();

  // Con el teclado, las flechas mueven entre pestañas: es lo que se espera de
  // una barra así, y sin esto solo se llega a ellas tabulando una por una.
  barra.addEventListener('keydown', (e) => {
    const orden = pestanas.map((p) => p.clave);
    const actual = orden.indexOf(barra.querySelector('.on').dataset.pestana);
    let destino = null;
    if (e.key === 'ArrowRight') destino = orden[(actual + 1) % orden.length];
    if (e.key === 'ArrowLeft') destino = orden[(actual - 1 + orden.length) % orden.length];
    if (e.key === 'Home') destino = orden[0];
    if (e.key === 'End') destino = orden[orden.length - 1];
    if (!destino) return;
    e.preventDefault();
    abrir(destino, true);
  });

  abrir(pestanas.some((p) => p.clave === elegida) ? elegida : pestanas[0].clave);
}

/** Pinta la barra de pestañas de la ficha y deja abierta la que corresponde. */
function pintarPestanasDeLaFicha(name, id, row, pintarLosDatos, elegida) {
  const barra = document.getElementById('fichaPestanas');
  const zona = document.getElementById('fichaPaneles');
  if (!barra || !zona) return;

  const suyas = pestanasDeLaFicha(name, id, row, pintarLosDatos);

  // Con una sola no hay nada que elegir: la ficha queda como siempre
  if (suyas.length === 1) {
    pintarLosDatos(zona);
    return;
  }

  const base = `#/m/${name}/ficha/${id}`;
  montarPestanas({
    barra, zona, pestanas: suyas, elegida,
    etiqueta: 'Secciones de la ficha',
    direccionDe: (clave) => (clave === 'datos' ? base : `${base}/${clave}`),
  });
}

/* =====================================================================
 * Credenciales pastorales
 *
 * La credencial es el documento de identidad ministerial: la firma el Pastor
 * Presidente, se imprime, se plastifica y se lleva encima. De ahí que la
 * pantalla se parezca poco a la de cualquier otro módulo:
 *
 *   · NO SE ESCRIBE NADA. Los datos salen de la ficha del titular y de la de
 *     su iglesia. Lo único que se elige son las dos fechas.
 *   · SE CREA A MANO. Registrar un pastor no le crea la credencial: se pincha
 *     «Crear credencial» cuando corresponde (punto 13.2).
 *   · NACE COMO BORRADOR y se emite en un segundo acto. Emitir es lo que le
 *     pone el número de serie y congela lo impreso.
 *   · Y NO SE BORRA. Una credencial emitida se revoca, con motivo escrito; la
 *     anterior de esa persona queda «reemplazada», nunca eliminada.
 * ===================================================================== */

/** Las credenciales de un pastor, en su ficha (punto 10.9). */
async function renderCredencialesDelPastor(pastorId, caja) {
  const suyas = await api('GET', `/credenciales?f_pastor_id=${pastorId}&limit=50`).catch(() => null);
  if (!suyas) { caja.innerHTML = ''; return; }

  const puedeCrear = MOD['credenciales'] && MOD['credenciales'].perms.create;
  const filas = suyas.rows.map((c) => `
    <li data-ir="#/m/credenciales/ficha/${c.id}">
      <span>
        <b class="mono">${esc(c.serie_completa || '(sin número)')}</b>
        ${insigniaDeCredencial(c.situacion)}
        ${c.motivo_revocacion ? `<span class="mut nota">${esc(c.motivo_revocacion)}</span>` : ''}
      </span>
      <span class="mut">${c.fecha_emision ? fechaCorta(c.fecha_emision) : ''}${c.fecha_vencimiento ? ' → ' + fechaCorta(c.fecha_vencimiento) : ''}</span>
    </li>`).join('');

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🪪 Credenciales</b>
        <span class="mut">${fmtNumero(suyas.total)} en total</span>
        <span class="spacer"></span>
        ${puedeCrear ? '<button class="btn sm" id="credNueva">➕ Crear credencial</button>' : ''}
      </div>
      ${suyas.rows.length
        ? `<ul class="mini-list">${filas}</ul>`
        : `<div class="empty-state" style="padding:26px">
             Todavía no tiene ninguna credencial.<br>
             <span class="mut">Se crea a mano, cuando corresponde emitirla.</span>
           </div>`}
    </div>`;

  const boton = document.getElementById('credNueva');
  if (boton) boton.addEventListener('click', () => crearCredencial(pastorId));
}

/**
 * Al escribir la fecha de entrega de una credencial, propone el vencimiento.
 *
 * PROPONE, no lo pone. La fecha queda escrita en el campo, a la vista y
 * editable antes de guardar. El servidor no la rellena por su cuenta a
 * propósito: el punto 17.5 prohíbe emitir con datos incompletos, y una fecha
 * que aparece sola en un documento que alguien firma es exactamente eso —nadie
 * la decidió—. Así se ahorra escribirla sin que el sistema decida por nadie.
 *
 * Solo se propone si el vencimiento está vacío: corregir la entrega de una
 * credencial ya fechada no puede pisarle el vencimiento que le pusieron.
 */
function proponerElVencimiento() {
  const entrega = document.querySelector('#recForm [name="fecha_emision"]');
  const vence = document.querySelector('#recForm [name="fecha_vencimiento"]');
  if (!entrega || !vence) return;

  const anios = Number((AJUSTES || {}).credencial_vigencia_anios) || 2;
  entrega.addEventListener('change', () => {
    if (!entrega.value || vence.value) return;
    // Se suma con el calendario, no con días: así un 29 de febrero cae en el
    // 28 del año que corresponda y no se corre solo.
    const d = new Date(`${entrega.value}T12:00:00`);
    if (Number.isNaN(d.getTime())) return;
    d.setFullYear(d.getFullYear() + anios);
    vence.value = d.toISOString().slice(0, 10);
    vence.dispatchEvent(new Event('change', { bubbles: true }));
    toast(`Vencimiento propuesto a ${anios} año(s). Puede cambiarlo.`);
  });
}

/**
 * El panel de emisión, al pie de la ficha de una credencial.
 *
 * Es donde se decide el paso que no se puede deshacer: emitirla. Por eso antes
 * de ofrecerlo se dice qué falta —en la ficha de la persona, en la de su
 * iglesia o en Configuración— y qué va a pasar con la credencial anterior.
 */
async function renderEmisionCredencial(id, caja) {
  const c = await api('GET', `/credenciales/${id}`).catch(() => null);
  if (!c) { caja.innerHTML = ''; return; }
  const puedeEmitir = MOD['credenciales'] && MOD['credenciales'].perms.edit;
  // El encuadre se ajusta contra el recuadro de verdad, y ese recuadro lo
  // define la hoja del diseño: hay que tenerla antes de dibujarlo
  const hayEncuadre = !!c.snap_foto && puedeEmitir;
  if (hayEncuadre) await estiloDeCredencial();

  // Lo que falta, preguntado al servidor con los datos de hoy
  let previo = { falta: [], recursos_que_faltan: [] };
  if (c.estado === 'Borrador' && c.pastor_id) {
    previo = await api('GET', `/credenciales/nueva/${c.pastor_id}`).catch(() => previo);
  }
  const trabas = [
    ...previo.falta.map((x) => `falta ${x}`),
    ...previo.recursos_que_faltan.map((x) => `falta cargar ${x} en Configuración`),
  ];

  /**
   * Emitir y revocar piden su propia llave (punto 12.2).
   *
   * Quien no la tenga deja el borrador preparado y ahí se detiene: el botón no
   * aparece, y en su lugar se dice quién sigue. Es mejor eso que ofrecer un
   * botón que el servidor va a rechazar.
   */
  const puedeEmitirDeVerdad = puedeEmitir && tieneLlave('credencial_emitir');
  const puedeRevocar = puedeEmitir && tieneLlave('credencial_revocar');

  const acciones = [];
  if (puedeEmitirDeVerdad && c.estado === 'Borrador') {
    acciones.push(`<button class="btn" id="credEmitir" ${trabas.length ? 'disabled' : ''}>✅ Emitir la credencial</button>`);
  }
  if (puedeRevocar && (c.estado === 'Vigente' || c.estado === 'Reemplazada')) {
    acciones.push('<button class="btn secondary" id="credRevocar">🚫 Revocar</button>');
  }

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🪪 Emisión</b>
        ${insigniaDeCredencial(c.situacion)}
        <span class="spacer"></span>
        ${acciones.join(' ')}
      </div>
      <div class="respaldo">
        ${c.estado === 'Borrador' ? `
          <p>
            Todavía es un <b>borrador</b>: no tiene número de serie y no sirve como documento.
            Al emitirla, el sistema le asigna su número y <b>congela</b> los datos que salen impresos:
            desde ese momento, aunque la ficha de la persona cambie, esta credencial seguirá diciendo lo mismo.
          </p>
          ${trabas.length ? `<div class="resultado warn">
            ⚠️ No se puede emitir todavía: ${esc(trabas.join(' · '))}.
            <span class="mut">Complételo donde corresponda y vuelva a abrir esta pantalla.</span>
          </div>` : ''}
          ${puedeEmitir && !puedeEmitirDeVerdad ? `<div class="resultado">
            🖊️ El borrador queda preparado. <b>La emisión la hace quien administre el sistema</b>,
            porque la credencial la firma el Pastor Presidente.
          </div>` : ''}`
        : `
          <div class="respaldo-datos">
            <div><span class="mut">N.º de serie</span><b class="mono">${esc(c.serie_completa || '')}</b></div>
            <div><span class="mut">Entregada</span><b>${c.fecha_emision ? fechaCorta(c.fecha_emision) : ''}</b></div>
            <div><span class="mut">Vence</span><b>${c.fecha_vencimiento ? fechaCorta(c.fecha_vencimiento) : ''}</b></div>
          </div>
          ${c.motivo_revocacion ? `<div class="resultado warn"><b>🚫 Revocada.</b> ${esc(c.motivo_revocacion)}</div>` : ''}
          ${c.situacion === 'Por vencer' ? '<div class="resultado warn">⏳ Está por vencer. Conviene emitir la de reemplazo con tiempo.</div>' : ''}
          ${c.situacion === 'Vencida' ? '<div class="resultado warn">📅 Está vencida. Emita una nueva desde la ficha de su titular.</div>' : ''}
          ${c.situacion === 'Reemplazada' ? '<div class="resultado">↩️ Fue reemplazada por otra credencial más nueva. Se conserva como parte del historial.</div>' : ''}
          <p class="mut" style="font-size:12.5px">
            Lo que dice el papel quedó congelado al emitirla. Para reflejar un cambio —otro grado, otra
            iglesia— se emite una credencial nueva desde la ficha de la persona; esta no se corrige ni se borra.
          </p>`}
      </div>
    </div>
    ${hayEncuadre ? tarjetaDeEncuadre(c) : ''}`;

  if (hayEncuadre) montarEncuadreDeLaFoto(c);

  const emitir = document.getElementById('credEmitir');
  if (emitir) {
    emitir.addEventListener('click', async () => {
      const seguro = await preguntarEnDialogo({
        titulo: '¿Emitir esta credencial?',
        cuerpo: `
          <p>Se le va a asignar el número de serie <b>que sigue</b>, y ese número no se reutiliza nunca:
          aunque después se anule, queda consumido.</p>
          <p>Los datos que salen impresos quedan <b>congelados</b> tal como están hoy.</p>
          ${c.pastor_id ? '<p class="mut">Si esta persona ya tenía una credencial vigente, aquella quedará reemplazada. No se borra.</p>' : ''}`,
        aceptar: 'Sí, emitirla',
      });
      if (!seguro) return;
      try {
        await api('POST', `/credenciales/${id}/emitir`);
        toast('Credencial emitida');
        route();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }

  const revocar = document.getElementById('credRevocar');
  if (revocar) {
    revocar.addEventListener('click', async () => {
      const seguro = await preguntarEnDialogo({
        titulo: '🚫 Revocar la credencial',
        cuerpo: `
          <p>Una credencial revocada deja de valer <b>en el momento</b>: quien escanee su código QR verá
          que no es válida.</p>
          <p>El motivo es obligatorio y queda en el registro de cambios.</p>
          <div class="fld full">
            <label for="credMotivo">Motivo</label>
            <textarea id="credMotivo" rows="3" placeholder="Pérdida, robo, cese del cargo…"></textarea>
          </div>`,
        aceptar: 'Revocarla',
        peligro: true,
      });
      if (!seguro) return;
      try {
        await api('POST', `/credenciales/${id}/revocar`, { motivo: (seguro.credMotivo || '').trim() });
        toast('Credencial revocada');
        route();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
}

/* ===================================================================
 * El encuadre de la fotografía (punto 6.4)
 *
 * La foto no se sube acá: es la de la ficha de la persona (punto 6.1). Lo que
 * se ajusta es cómo se ve dentro del recuadro de 18,5 × 24,5 mm de la tarjeta:
 * se arrastra para moverla, se acerca con la rueda o con dos dedos, y se le
 * corrige el brillo y el contraste. El resultado son cinco números que se
 * guardan CON la credencial, para que una reimpresión de aquí a tres años
 * salga idéntica a la primera.
 *
 * La lógica es la del archivo de diseño, trasladada. Se dejó fuera lo que allá
 * servía para cargar y quitar la foto, que en el sistema no corresponde.
 * =================================================================== */

/** La dirección de la foto del titular, congelada en la credencial. */
function urlDeLaFoto(c) {
  return `/uploads/${encodeURIComponent(c.snap_foto)}`;
}

/** Los cinco números del encuadre, ya acotados a lo que se puede pintar. */
function encuadreGuardado(c) {
  const entre = (v, min, max, porDefecto) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : porDefecto;
  };
  return {
    zoom: entre(c.foto_zoom, 1, 6, 1),
    x: entre(c.foto_x, 0, 100, 50),
    y: entre(c.foto_y, 0, 100, 50),
    brillo: entre(c.foto_brillo, 40, 160, 100),
    contraste: entre(c.foto_contraste, 40, 160, 100),
  };
}

/**
 * Cuánto hay que agrandar la imagen para que cubra el recuadro sin dejar borde.
 *
 * Una foto vertical dentro de un recuadro vertical más angosto sobra por
 * arriba; una horizontal sobra por los lados. Este número es el ancho —en
 * porcentaje del recuadro— con el que en ningún caso queda blanco a la vista,
 * y es el punto de partida sobre el que después actúa el acercamiento.
 *
 * Sin esto la foto se pinta al 100 % del ancho y una foto apaisada deja dos
 * franjas blancas arriba y abajo del recuadro dorado.
 */
function cuantoCubre(caja, natural) {
  const r = caja.getBoundingClientRect();
  if (!r.width || !r.height || !natural.ancho || !natural.alto) return 100;
  const proporcionDelRecuadro = r.width / r.height;
  const proporcionDeLaImagen = natural.ancho / natural.alto;
  return Math.max(100, 100 * proporcionDeLaImagen / proporcionDelRecuadro);
}

/** Pintar la foto en su recuadro con el encuadre que se le indique. */
function pintarLaFoto(capa, encuadre, cubre) {
  capa.style.backgroundSize = `${cubre * encuadre.zoom}% auto`;
  capa.style.backgroundPosition = `${encuadre.x}% ${encuadre.y}%`;
  capa.style.filter = `brightness(${encuadre.brillo}%) contrast(${encuadre.contraste}%)`;
}

/** El tamaño real de una imagen, para saber cuánto sobra por cada lado. */
function medirLaImagen(url) {
  return new Promise((listo) => {
    const im = new Image();
    im.onload = () => listo({ ancho: im.naturalWidth, alto: im.naturalHeight });
    im.onerror = () => listo({ ancho: 0, alto: 0 });
    im.src = url;
  });
}

/** La tarjeta con el recuadro de la foto y sus mandos. */
function tarjetaDeEncuadre(c) {
  const e = encuadreGuardado(c);
  return `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🖼️ Encuadre de la fotografía</b>
        <span class="spacer"></span>
        <button class="btn secondary" id="encRestablecer">Restablecer</button>
        <button class="btn" id="encGuardar" disabled>Guardar el encuadre</button>
      </div>
      <div class="cred-encuadre">
        <div class="enc-marco cred-disenio">
          <figure class="foto con-foto" id="encFoto">
            <div class="foto-capa" id="encCapa"></div>
          </figure>
        </div>
        <div class="enc-mandos">
          <p class="mut" style="margin:0 0 4px">
            Así va a salir impresa, al tamaño que va a tener en la tarjeta.
            <b>Arrastre</b> la foto para moverla y use la <b>rueda</b> —o dos dedos— para acercarla.
          </p>
          <label>Acercar <input type="range" id="encZoom" min="100" max="600" step="1" value="${Math.round(e.zoom * 100)}">
            <span class="badge" id="encZoomVal">${Math.round(e.zoom * 100)} %</span></label>
          <label>Brillo <input type="range" id="encBrillo" min="40" max="160" step="1" value="${e.brillo}">
            <span class="badge" id="encBrilloVal">${e.brillo} %</span></label>
          <label>Contraste <input type="range" id="encContraste" min="40" max="160" step="1" value="${e.contraste}">
            <span class="badge" id="encContrasteVal">${e.contraste} %</span></label>
          <p class="mut" style="margin:6px 0 0; font-size:12px">
            El encuadre se guarda con la credencial: al reimprimirla dentro de unos años sale igual.
          </p>
        </div>
      </div>
    </div>`;
}

/**
 * Los mandos del encuadre, conectados al recuadro.
 *
 * Arrastrar, acercar y los tres deslizadores. Lo que se ve acá es exactamente
 * lo que se va a imprimir, porque el recuadro es el mismo elemento con la
 * misma hoja de estilos que la tarjeta.
 */
async function montarEncuadreDeLaFoto(c) {
  const caja = document.getElementById('encFoto');
  const capa = document.getElementById('encCapa');
  if (!caja || !capa) return;

  const url = urlDeLaFoto(c);
  const encuadre = encuadreGuardado(c);
  const comoEstaba = JSON.stringify(encuadre);
  capa.style.backgroundImage = `url("${url}")`;

  const natural = await medirLaImagen(url);
  let cubre = cuantoCubre(caja, natural);
  const guardar = document.getElementById('encGuardar');

  const mandos = {
    zoom: document.getElementById('encZoom'),
    brillo: document.getElementById('encBrillo'),
    contraste: document.getElementById('encContraste'),
  };
  const letreros = {
    zoom: document.getElementById('encZoomVal'),
    brillo: document.getElementById('encBrilloVal'),
    contraste: document.getElementById('encContrasteVal'),
  };

  function aplicar() {
    encuadre.zoom = Math.min(6, Math.max(1, encuadre.zoom));
    encuadre.x = Math.min(100, Math.max(0, encuadre.x));
    encuadre.y = Math.min(100, Math.max(0, encuadre.y));
    pintarLaFoto(capa, encuadre, cubre);
    mandos.zoom.value = Math.round(encuadre.zoom * 100);
    letreros.zoom.textContent = `${Math.round(encuadre.zoom * 100)} %`;
    letreros.brillo.textContent = `${encuadre.brillo} %`;
    letreros.contraste.textContent = `${encuadre.contraste} %`;
    if (guardar) guardar.disabled = JSON.stringify(encuadre) === comoEstaba;
  }
  aplicar();

  mandos.zoom.addEventListener('input', () => { encuadre.zoom = mandos.zoom.value / 100; aplicar(); });
  mandos.brillo.addEventListener('input', () => { encuadre.brillo = +mandos.brillo.value; aplicar(); });
  mandos.contraste.addEventListener('input', () => { encuadre.contraste = +mandos.contraste.value; aplicar(); });

  // Acercar con la rueda del ratón
  caja.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    encuadre.zoom *= ev.deltaY < 0 ? 1.08 : 0.92;
    aplicar();
  }, { passive: false });

  /**
   * Arrastrar para mover, y dos dedos para acercar.
   *
   * El arrastre se traduce a porcentajes de lo que SOBRA de la imagen fuera
   * del recuadro: si no sobra nada por un lado, por ese lado no hay nada que
   * mover y el dedo no la corre. Es la cuenta del archivo de diseño.
   */
  const dedos = new Map();
  let pellizco = 0;
  let alEmpezarElPellizco = 1;
  let arrastre = null;

  caja.addEventListener('pointerdown', (ev) => {
    caja.setPointerCapture(ev.pointerId);
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (dedos.size === 1) {
      arrastre = { x: ev.clientX, y: ev.clientY, desdeX: encuadre.x, desdeY: encuadre.y };
      caja.classList.add('arrastrando');
    } else if (dedos.size === 2) {
      const p = [...dedos.values()];
      pellizco = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      alEmpezarElPellizco = encuadre.zoom;
    }
  });

  caja.addEventListener('pointermove', (ev) => {
    if (!dedos.has(ev.pointerId)) return;
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (dedos.size === 2) {
      const p = [...dedos.values()];
      const ahora = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pellizco > 0) { encuadre.zoom = alEmpezarElPellizco * ahora / pellizco; aplicar(); }
      return;
    }
    if (!arrastre) return;
    const r = caja.getBoundingClientRect();
    const anchoDeLaFoto = (cubre * encuadre.zoom / 100) * r.width;
    const altoDeLaFoto = natural.ancho ? anchoDeLaFoto * (natural.alto / natural.ancho) : r.height;
    const sobraAlAncho = anchoDeLaFoto - r.width;
    const sobraAlAlto = altoDeLaFoto - r.height;
    const dx = ev.clientX - arrastre.x;
    const dy = ev.clientY - arrastre.y;
    encuadre.x = arrastre.desdeX - (sobraAlAncho > 1 ? (dx / sobraAlAncho) * 100 : 0);
    encuadre.y = arrastre.desdeY - (sobraAlAlto > 1 ? (dy / sobraAlAlto) * 100 : 0);
    aplicar();
  });

  const soltar = (ev) => {
    dedos.delete(ev.pointerId);
    if (dedos.size < 2) pellizco = 0;
    if (dedos.size === 0) { arrastre = null; caja.classList.remove('arrastrando'); }
  };
  caja.addEventListener('pointerup', soltar);
  caja.addEventListener('pointercancel', soltar);
  caja.addEventListener('lostpointercapture', soltar);

  // Si la ventana cambia de tamaño, el recuadro también: hay que recalcular
  // cuánto tiene que cubrir la imagen o aparecen bordes blancos
  const alCambiarDeTamano = () => { cubre = cuantoCubre(caja, natural); aplicar(); };
  window.addEventListener('resize', alCambiarDeTamano, { signal: alCambiarDePantalla() });

  document.getElementById('encRestablecer').addEventListener('click', () => {
    Object.assign(encuadre, { zoom: 1, x: 50, y: 50, brillo: 100, contraste: 100 });
    mandos.brillo.value = 100;
    mandos.contraste.value = 100;
    aplicar();
  });

  if (guardar) {
    guardar.addEventListener('click', async () => {
      guardar.disabled = true;
      try {
        await api('PUT', `/credenciales/${c.id}`, {
          foto_zoom: Number(encuadre.zoom.toFixed(3)),
          foto_x: Number(encuadre.x.toFixed(2)),
          foto_y: Number(encuadre.y.toFixed(2)),
          foto_brillo: encuadre.brillo,
          foto_contraste: encuadre.contraste,
          version: c.version,
        });
        toast('Encuadre guardado');
        route();
      } catch (e) {
        guardar.disabled = false;
        toast(e.message, true);
      }
    });
  }
}

/** El estado de una credencial, con su color. */
function insigniaDeCredencial(situacion) {
  const colores = {
    Vigente: 'green', 'Por vencer': 'amber', Vencida: 'gray',
    Revocada: 'red', Reemplazada: 'gray', Borrador: 'blue',
  };
  return `<span class="badge ${colores[situacion] || ''}">${esc(situacion || '')}</span>`;
}

/**
 * Crear la credencial de una persona.
 *
 * Antes de abrir nada se pregunta al servidor qué datos tiene esa persona y
 * qué falta: es mejor decirlo acá —«complete la comuna en la ficha de la
 * iglesia»— que dejar llenar un formulario que después no se va a poder
 * emitir.
 */
async function crearCredencial(pastorId) {
  let previo;
  try {
    previo = await api('GET', `/credenciales/nueva/${pastorId}`);
  } catch (e) {
    return toast(e.message, true);
  }

  const problemas = [];
  if (previo.falta.length) {
    problemas.push(`En la ficha de la persona o de su iglesia falta: <b>${previo.falta.map(esc).join(', ')}</b>.`);
  }
  if (previo.recursos_que_faltan.length) {
    problemas.push(`En Configuración del Sistema falta cargar <b>${previo.recursos_que_faltan.map(esc).join(', ')}</b>.`);
  }

  const d = previo.datos;
  const hoy = HOY();
  // Lo corriente es que valga unos años; se propone y se puede cambiar
  const enTresAnios = new Date();
  enTresAnios.setFullYear(enTresAnios.getFullYear() + 3);

  const cuerpo = `
    <p class="mut" style="margin-bottom:12px">
      Los datos salen de la ficha de la persona y de la de su iglesia. Acá solo se eligen las fechas;
      el número de serie lo pone el sistema al emitirla.
    </p>
    ${previo.ya_tiene_vigente ? `
      <div class="resultado warn" style="margin-bottom:12px">
        Ya tiene una credencial vigente, la <b class="mono">${esc(previo.ya_tiene_vigente.serie)}-${esc(previo.ya_tiene_vigente.serie_dv)}</b>.
        Al emitir esta, aquella quedará <b>reemplazada</b> —no se borra— y esta pasará a ser la que vale.
      </div>` : ''}
    ${problemas.length ? `<div class="resultado warn" style="margin-bottom:12px">⚠️ ${problemas.join('<br>')}<br>
      <span class="mut">Se puede crear el borrador igual, pero no se podrá emitir hasta completarlo.</span></div>` : ''}
    <div class="ficha-datos" style="padding:0 0 12px">
      ${[['Nombres', d.snap_nombres], ['Apellidos', d.snap_apellidos], ['RUT', d.snap_rut],
         ['Grado ministerial', d.snap_grado], ['Cargo o función', d.snap_funcion],
         ['Iglesia', `${d.snap_categoria || '—'} · ${d.snap_iglesia || ''}`], ['Comuna', d.snap_comuna]]
        .map(([k, v]) => `<div class="ficha-dato"><span class="dl">${esc(k)}</span><span class="dv">${v ? esc(v) : '<span class="sin">Sin registrar</span>'}</span></div>`).join('')}
    </div>
    <div class="form-grid">
      <div class="fld">
        <label for="credDesde">Fecha de entrega</label>
        <input type="date" id="credDesde" value="${hoy}" min="1900-01-01" />
      </div>
      <div class="fld">
        <label for="credHasta">Fecha de vencimiento</label>
        <input type="date" id="credHasta" value="${enTresAnios.toISOString().slice(0, 10)}" min="1900-01-01" />
      </div>
    </div>`;

  const puesto = await preguntarEnDialogo({
    titulo: `🪪 Crear credencial de ${d.snap_nombres} ${d.snap_apellidos}`.trim(),
    cuerpo,
    aceptar: 'Crear el borrador',
  });
  if (!puesto) return;

  try {
    const creada = await api('POST', '/credenciales', {
      pastor_id: pastorId,
      fecha_emision: puesto.credDesde || hoy,
      fecha_vencimiento: puesto.credHasta || '',
    });
    toast('Borrador creado. Revise los datos y emítala.');
    location.hash = `#/m/credenciales/ficha/${creada.id}`;
  } catch (e) {
    toast(e.message, true);
  }
}

/* =====================================================================
 * El buscador general
 *
 * Una sola caja arriba, para encontrar cualquier cosa sin saber de antemano
 * en qué módulo está. Quien atiende el teléfono no razona por módulos: le
 * dicen un nombre, un RUT o el número de un certificado.
 *
 * Lo que se ve acá es exactamente lo que esa persona podría abrir por su
 * cuenta: el servidor pregunta solo en los módulos que puede ver, dentro de su
 * alcance y sin los datos reservados que no alcanza (ver server/buscador.js).
 *
 * Tres detalles de uso que importan más de lo que parecen:
 *
 *   · **no se pregunta en cada tecla**. Se espera a que la persona deje de
 *     escribir; si no, escribir «Rodríguez» dispararía nueve búsquedas y la
 *     última en llegar no tiene por qué ser la última que se pidió —por eso
 *     además se descarta toda respuesta que ya venga atrasada—;
 *   · **se maneja con el teclado**. Las flechas recorren, Enter abre, Esc
 *     cierra. Quien pasa el día escribiendo no quiere soltar el teclado para
 *     tocar un resultado;
 *   · **en el teléfono la caja se abre sobre la barra**. Ahí no cabe junto al
 *     nombre de la iglesia, así que se muestra la lupa y al tocarla se ocupa
 *     la fila entera.
 * ===================================================================== */

/* ---------------- los avisos: qué recibo y por dónde ---------------- */
/**
 * Encender los avisos del navegador tiene cuatro pasos que pueden fallar por
 * separado, y esta pantalla los va diciendo uno por uno:
 *
 *   1. que el navegador sepa hacerlo (los muy viejos, no)
 *   2. que la persona dé permiso —lo pide el navegador, no nosotros—
 *   3. que se registre el ayudante que recibe los avisos con el sistema cerrado
 *   4. que el servidor pueda mandarle uno de verdad
 *
 * El permiso NO se pide al entrar al sistema. Un sistema que apenas se abre ya
 * está pidiendo permiso para molestar es un sistema al que se le dice que no
 * para siempre, y en algunos navegadores el «no» no se puede deshacer sin ir a
 * buscarlo en la configuración. Se pide cuando la persona toca el botón.
 */

/** Pasa la llave del servidor al formato que pide el navegador. */
function llaveParaElNavegador(base64) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const limpia = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(limpia);
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)));
}

/** ¿Este navegador puede, y qué le falta? */
function comoEstaEsteNavegador() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    const esIPhone = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return {
      puede: false,
      porque: esIPhone && !instalada
        ? 'En iPhone y iPad los avisos funcionan solo si agrega el sistema a la pantalla de inicio: toque «Compartir» y luego «Agregar a inicio». Después vuelva acá.'
        : 'Este navegador no sabe recibir avisos. Pruebe con Chrome, Edge, Firefox o Safari al día.',
    };
  }
  if (Notification.permission === 'denied') {
    return {
      puede: false,
      porque: 'Este navegador tiene los avisos bloqueados para el sistema. Hay que permitirlos en la configuración del sitio (el candado junto a la dirección) y volver acá.',
    };
  }
  return { puede: true };
}

async function renderMisAvisos(caja) {
  if (!caja) return;
  caja.innerHTML = '<div class="card"><p style="padding:18px">Cargando…</p></div>';

  let d;
  try {
    d = await api('GET', '/avisos/preferencias');
  } catch (e) {
    caja.innerHTML = `<div class="card"><p style="padding:18px;color:var(--danger)">${esc(e.message)}</p></div>`;
    return;
  }

  const estado = comoEstaEsteNavegador();
  const yaDioPermiso = estado.puede && typeof Notification !== 'undefined' && Notification.permission === 'granted';

  caja.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="toolbar"><b>🔔 Avisos en este aparato</b></div>
      <div class="respaldo">
        ${!estado.puede
          ? `<div class="aviso importante"><b>Acá no se puede</b><span>${esc(estado.porque)}</span></div>`
          : `
            <p>Los avisos llegan como los de cualquier aplicación, aunque tenga el sistema cerrado.
            Se activan aparato por aparato: si usa el teléfono y el computador, hay que activarlos en los dos.</p>
            <p class="mut">${d.aparatos
              ? `Tiene ${d.aparatos} aparato(s) enganchado(s) a su cuenta.`
              : 'Todavía no tiene ningún aparato enganchado.'}</p>
            <div class="acciones" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              <button class="btn" id="avActivar">${yaDioPermiso ? '🔄 Volver a activarlos acá' : '🔔 Activar los avisos en este aparato'}</button>
              ${d.aparatos ? '<button class="btn secondary" id="avProbar">✉️ Mandarme uno de prueba</button>' : ''}
              ${d.aparatos ? '<button class="btn secondary" id="avApagar">🔕 Apagarlos en este aparato</button>' : ''}
            </div>
            <div id="avEstado" class="mut" style="margin-top:10px"></div>`}
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <b>Qué avisos quiero recibir</b>
        <span class="spacer"></span>
        <button class="btn sm" id="avGuardar">💾 Guardar</button>
      </div>
      <table class="grid informe">
        <thead><tr><th>Aviso</th><th style="width:120px">En el sistema</th><th style="width:150px">En este aparato</th></tr></thead>
        <tbody>
          ${d.tipos.map((t) => `
            <tr>
              <td>
                <b>${esc(t.label)}</b>
                ${t.urgente ? '<span class="badge orange" style="margin-left:6px">al momento</span>' : '<span class="badge" style="margin-left:6px">en el resumen</span>'}
                <div class="mut" style="font-size:12.5px">${esc(t.ayuda)}</div>
              </td>
              <td style="text-align:center">
                <!-- De qué es cada casilla lo dicen su fila y su columna, y eso
                     solo lo junta quien ve la tabla entera: a quien la escucha
                     hay que decírselo en la casilla misma.

                     Los que no se pueden apagar salen dichos y no como una
                     casilla trancada: una casilla que no obedece es peor que no
                     tenerla, porque parece que uno eligió algo. -->
                ${t.siempre
                  ? '<span class="mut" style="font-size:12.5px" title="Los mensajes escritos por una persona no se pueden apagar acá: es donde queda la constancia de que llegaron">Siempre</span>'
                  : `<input type="checkbox" data-tipo="${t.clave}" data-canal="sistema"
                       aria-label="${esc(t.label)}: recibirlo en el sistema"
                       ${d.preferencias[t.clave] && d.preferencias[t.clave].sistema ? 'checked' : ''} />`}
              </td>
              <td style="text-align:center">
                <input type="checkbox" data-tipo="${t.clave}" data-canal="navegador"
                  aria-label="${esc(t.label)}: recibirlo en este aparato"
                  ${d.preferencias[t.clave] && d.preferencias[t.clave].navegador ? 'checked' : ''} />
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="mut" style="padding:12px 16px;margin:0">
        Lo marcado como <b>al momento</b> avisa apenas ocurre. Lo demás se junta y llega una vez al día,
        a la hora que se fije en Configuración.
      </p>
    </div>`;

  const decir = (texto, malo) => {
    const donde = document.getElementById('avEstado');
    if (donde) donde.innerHTML = `<span style="color:${malo ? 'var(--danger)' : 'var(--exito, #15803d)'}">${esc(texto)}</span>`;
  };

  const activar = document.getElementById('avActivar');
  if (activar) {
    activar.addEventListener('click', async () => {
      activar.disabled = true;
      try {
        decir('Pidiendo permiso…');
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
          decir('No se dio el permiso. Sin él, el navegador no puede mostrar avisos.', true);
          return;
        }
        decir('Registrando el ayudante…');
        const reg = await navigator.serviceWorker.register('/avisos-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        decir('Enganchando este aparato…');
        // Si ya había una suscripción de otra llave, se suelta: una llave
        // distinta hace que el servidor no pueda mandarle nada a esta.
        const previa = await reg.pushManager.getSubscription();
        if (previa) await previa.unsubscribe();
        const sus = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: llaveParaElNavegador(d.llavePublica),
        });
        await api('POST', '/avisos/aparato', { suscripcion: sus.toJSON() });
        toast('Avisos activados en este aparato');
        renderMisAvisos(caja);
      } catch (e) {
        decir(`No se pudo activar: ${porQueFalloLaRed(e)}`, true);
      } finally {
        activar.disabled = false;
      }
    });
  }

  const probar = document.getElementById('avProbar');
  if (probar) {
    probar.addEventListener('click', async () => {
      try {
        await api('POST', '/avisos/probar');
        decir('Mandado. Si no lo ve en unos segundos, revise que el aparato no esté en «no molestar».');
      } catch (e) {
        decir(porQueFalloLaRed(e), true);
      }
    });
  }

  const apagar = document.getElementById('avApagar');
  if (apagar) {
    apagar.addEventListener('click', async () => {
      apagar.disabled = true;
      try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sus = reg && (await reg.pushManager.getSubscription());

        if (sus) {
          // Primero se le pide la baja al servidor y después se suelta acá: al
          // revés, si el servidor no contestara, seguiría mandando avisos a un
          // aparato que ya no los espera y nadie podría darlo de baja, porque
          // su dirección solo la sabía este navegador.
          await api('POST', '/avisos/aparato/apagar', { endpoint: sus.endpoint });
          await sus.unsubscribe();
          toast('Avisos apagados en este aparato');
          renderMisAvisos(caja);
          return;
        }

        // No hay suscripción acá, pero el servidor puede tener aparatos
        // enganchados: otro teléfono, un computador que ya no se usa, o una
        // dirección anterior del sistema. Esos no se pueden apagar uno por uno
        // desde acá —su dirección la sabía aquel navegador, no este—, así que
        // la única salida es apagarlos todos.
        if (!d.aparatos) {
          decir('En este aparato los avisos ya estaban apagados.');
          return;
        }
        const igual = await preguntarEnDialogo({
          titulo: 'En este aparato ya estaban apagados',
          cuerpo:
            `Su cuenta tiene ${d.aparatos} aparato(s) enganchado(s), pero ninguno es este. ` +
            'Pueden ser otro teléfono, un computador que ya no usa, o una dirección anterior del sistema. ' +
            'Desde acá no se pueden apagar de a uno. ¿Los apago todos? ' +
            'Después tendrá que volver a activarlos en cada aparato donde los quiera.',
          aceptar: 'Apagarlos todos',
          peligro: true,
        });
        if (!igual) return;
        const r = await api('POST', '/avisos/aparato/apagar', { todos: true });
        toast(`${r.apagados} aparato(s) apagado(s)`);
        renderMisAvisos(caja);
      } catch (e) {
        decir(`No se pudo apagar: ${porQueFalloLaRed(e)}`, true);
      } finally {
        apagar.disabled = false;
      }
    });
  }

  document.getElementById('avGuardar').addEventListener('click', async () => {
    const preferencias = {};
    caja.querySelectorAll('input[data-tipo]').forEach((c) => {
      preferencias[c.dataset.tipo] = preferencias[c.dataset.tipo] || {};
      preferencias[c.dataset.tipo][c.dataset.canal] = c.checked;
    });
    try {
      await api('PUT', '/avisos/preferencias', { preferencias });
      toast('Guardado');
    } catch (e) {
      toast(e.message, true);
    }
  });
}


/**
 * Los grupos del menú se pliegan, y se quedan como uno los dejó.
 *
 * Con veintiocho enlaces el menú mide casi dos pantallas en un teléfono, y
 * nadie usa los veintiocho: quien pasa lista los domingos no abre Credenciales
 * nunca. Cerrando lo que no usa, el menú le cabe entero y deja de desplazar.
 *
 * Lo cerrado se guarda en este navegador y no en la cuenta, a propósito: la
 * misma persona puede querer el teléfono con casi todo cerrado —donde el
 * espacio es poco— y el computador de la oficina con todo abierto.
 */
function iniciarGruposDelMenu() {
  const barra = document.querySelector('.sidebar');
  if (!barra) return;

  barra.querySelectorAll('.side-group[data-grupo] .group-title').forEach((titulo) => {
    titulo.addEventListener('click', () => {
      const grupo = titulo.closest('.side-group');
      const cerrado = grupo.classList.toggle('cerrado');
      titulo.setAttribute('aria-expanded', cerrado ? 'false' : 'true');

      const guardados = gruposCerrados();
      cerrado ? guardados.add(grupo.dataset.grupo) : guardados.delete(grupo.dataset.grupo);
      try {
        localStorage.setItem(GRUPOS_CERRADOS, JSON.stringify([...guardados]));
      } catch (e) {
        // Sin dónde guardarlo, el plegado igual funciona hasta recargar.
      }
    });
  });

  iniciarBuscadorDelMenu(barra);
}

/**
 * El buscador del menú: escribir dos letras en vez de recorrer los grupos.
 *
 * El menú tiene más de treinta secciones repartidas en grupos plegables, y
 * llegar a una que está en un grupo cerrado son dos gestos: abrir el grupo y
 * después buscar con la vista. Escribiendo «cuo» se llega a Cuotas de una.
 *
 * Es SOLO para el menú, y por eso está adentro del menú y no arriba: el
 * buscador de la barra superior busca en los DATOS —una persona, un
 * movimiento, un acta— y son dos cosas distintas que conviene no confundir.
 *
 * Tres detalles que hacen la diferencia entre que se use y que estorbe:
 *
 *   · **los grupos cerrados se abren solos** mientras se busca. Si no, uno
 *     escribe «cuo», no ve nada y concluye que no existe;
 *   · **al limpiar, todo vuelve como estaba**, con los grupos que uno tenía
 *     cerrados otra vez cerrados: BUSCAR no puede deshacerle a nadie cómo dejó
 *     ordenado su menú. (ENTRAR sí: quien llega a una sección que estaba en un
 *     grupo cerrado lo deja abierto, y eso es de antes y a propósito —ver
 *     marcarActivo—: es la única señal de dónde quedó parado);
 *   · **Enter entra a la primera**, que es lo que uno quiere después de
 *     escribir tres letras, y Escape limpia.
 */
function iniciarBuscadorDelMenu(barra) {
  const caja = barra.querySelector('#menuBuscar');
  if (!caja) return;
  const limpiar = barra.querySelector('#menuBuscarLimpiar');
  const sinNada = barra.querySelector('#menuSinNada');
  const grupos = [...barra.querySelectorAll('.side-group[data-grupo]')];
  const enlaces = [...barra.querySelectorAll('.side-link')];

  const filtrar = () => {
    const busca = textoBuscable(caja.value.trim());
    const buscando = busca.length > 0;
    barra.classList.toggle('buscando', buscando);
    if (limpiar) limpiar.hidden = !buscando;

    let cuantas = 0;
    for (const enlace of enlaces) {
      // El Panel de control no está en ningún grupo y se busca igual
      const calza = !buscando || textoBuscable(enlace.textContent).includes(busca);
      enlace.hidden = !calza;
      if (calza) cuantas++;
    }

    for (const grupo of grupos) {
      const suyos = [...grupo.querySelectorAll('.side-link')];
      const algunoCalza = suyos.some((e) => !e.hidden);
      grupo.hidden = buscando && !algunoCalza;
      // Mientras se busca, los grupos se abren para que se vea lo encontrado;
      // al limpiar, cada uno vuelve a como lo dejó su dueño.
      if (buscando) grupo.classList.remove('cerrado');
      else if (gruposCerrados().has(grupo.dataset.grupo)) grupo.classList.add('cerrado');
    }

    if (sinNada) sinNada.hidden = !buscando || cuantas > 0;
  };

  const primeraQueCalza = () => enlaces.find((e) => !e.hidden && !e.closest('[hidden]'));

  caja.addEventListener('input', filtrar);
  caja.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      caja.value = '';
      filtrar();
      return;
    }
    if (e.key === 'Enter') {
      const primera = primeraQueCalza();
      if (primera) {
        e.preventDefault();
        primera.click();
        caja.value = '';
        filtrar();
      }
    }
  });
  if (limpiar) {
    limpiar.addEventListener('click', () => {
      caja.value = '';
      filtrar();
      caja.focus();
    });
  }
  // Al tocar una sección encontrada, el buscador se limpia: quien vuelve al
  // menú lo quiere entero, no con el filtro de hace media hora puesto.
  enlaces.forEach((e) => e.addEventListener('click', () => {
    if (!caja.value) return;
    caja.value = '';
    filtrar();
  }));
}

/* ---------------- mensajes escritos a mano ---------------- */
/**
 * Escribirle a la gente que usa el sistema.
 *
 * Todo lo demás que avisa el sistema lo escribe el sistema mirando los datos.
 * Esto es una persona escribiéndole a otras: «la reunión se cambió a las 8»,
 * «desde el lunes las solicitudes se ingresan por acá». Antes eso salía por
 * fuera —un grupo de mensajería, un papel en la pared— donde no queda
 * constancia de quién dijo qué ni de si llegó.
 *
 * La pantalla tiene dos mitades: escribir uno, y lo que ya se ha mandado con
 * cuántos lo leyeron. Lo segundo importa tanto como lo primero: es lo que hace
 * que mandar un mensaje no sea tirar una moneda al aire.
 */
/** «1 persona» / «46 personas», que es como se dice en castellano. */
const cuantasPersonas = (n) => (n === 1 ? '1 persona' : `${n} personas`);

async function viewMensajes() {
  content().innerHTML = `
    <div class="page-head"><h2>📣 Mensajes</h2></div>
    <div class="card"><div class="card-body">Cargando…</div></div>`;

  let d;
  try {
    d = await api('GET', '/avisos/mensajes/destinatarios');
  } catch (e) {
    content().innerHTML = `
      <div class="page-head"><h2>📣 Mensajes</h2></div>
      <div class="card"><div class="card-body">${esc(e.message)}</div></div>`;
    return;
  }

  content().innerHTML = `
    <div class="page-head"><h2>📣 Mensajes</h2></div>
    <div class="card">
      <div class="toolbar"><b>✍️ Escribir un mensaje</b></div>
      <div class="card-body">
        <p class="mut" style="margin-top:0">
          Llega a la campanita de cada persona y, si lo tiene encendido, también a su teléfono.
          Alcanza solo a quienes usted ve en Usuarios.
        </p>
        <div id="msgError"></div>
        <form id="msgForm" class="form-grid">
          <div class="fld full">
            <label for="msgTitulo">Título <span class="req">*</span></label>
            <input type="text" id="msgTitulo" maxlength="${d.largo.titulo}" required
                   placeholder="Lo que se lee en la campanita" />
            <div class="help" id="msgCuentaTitulo"></div>
          </div>
          <div class="fld full">
            <label for="msgCuerpo">Mensaje <span class="req">*</span></label>
            <textarea id="msgCuerpo" rows="4" maxlength="${d.largo.cuerpo}" required
                      placeholder="Lo que hay que decir"></textarea>
            <div class="help" id="msgCuentaCuerpo"></div>
          </div>
          <div class="fld">
            <label for="msgDestino">¿A quién?</label>
            <select id="msgDestino">
              ${d.destinos.map((x) => `<option value="${esc(x.clave)}">${esc(x.label)}</option>`).join('')}
            </select>
          </div>
          <div class="fld" id="msgCampoIglesia" hidden>
            <label for="msgIglesia">Iglesia</label>
            <select id="msgIglesia">
              ${d.iglesias.map((i) => `<option value="${i.id}" data-cuantos="${i.cuantos}">${esc(i.nombre)} · ${cuantasPersonas(i.cuantos)}</option>`).join('')}
            </select>
          </div>
          <div class="fld" id="msgCampoPerfil" hidden>
            <label for="msgPerfil">Perfil de permisos</label>
            <select id="msgPerfil">
              ${d.perfiles.map((x) => `<option value="${x.id}" data-cuantos="${x.cuantos}">${esc(x.nombre)} · ${cuantasPersonas(x.cuantos)}</option>`).join('')}
            </select>
            ${d.perfiles.length ? '' : '<div class="help">Ninguno de los perfiles lo usa gente que usted alcance.</div>'}
          </div>
          <div class="fld full" id="msgCampoPersonas" hidden>
            <label for="msgPersonas">Personas</label>
            <select id="msgPersonas" multiple size="6">
              ${d.personas.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}
            </select>
            <div class="help">Se eligen varias manteniendo apretado Ctrl, o tocándolas en el teléfono.</div>
          </div>
          <div class="fld full">
            <label for="msgEnlace">Enlace (opcional)</label>
            <input type="text" id="msgEnlace" placeholder="#/m/solicitudes" />
            <div class="help">Una pantalla de este sistema, para que el mensaje lleve a algún lado.</div>
          </div>
          <div class="fld full">
            <label class="con-casilla" for="msgUrgente">
              <input type="checkbox" id="msgUrgente" />
              Es urgente: que suene en el teléfono ahora, no en el resumen del día
            </label>
          </div>
          <div class="full msg-pie">
            <button type="submit" class="btn" id="msgEnviar">📣 Enviar</button>
            <span class="mut" id="msgACuantos"></span>
          </div>
        </form>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="toolbar"><b>🗂️ Lo que se ha mandado</b></div>
      <div id="msgHistorial"><div class="card-body mut">Cargando…</div></div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const destino = $('msgDestino');

  /**
   * Cuántas personas recibirían lo que está elegido ahora mismo.
   *
   * Los cuatro destinos lo saben. Con la iglesia y el perfil no se sabía —«no
   * vale la pena una ida y vuelta por cada clic»— y son justamente los dos que
   * pueden alcanzar a mucha gente; ahora el número viene con la lista, contado
   * sobre la misma gente que se va a alcanzar al mandar.
   */
  const aCuantos = () => {
    const cual = destino.value;
    if (cual === 'todos') return d.cuantosEnTotal;
    if (cual === 'personas') return $('msgPersonas').selectedOptions.length;
    const elegido = (cual === 'iglesia' ? $('msgIglesia') : $('msgPerfil')).selectedOptions[0];
    return elegido ? Number(elegido.dataset.cuantos) || 0 : 0;
  };
  const ponerElNumeroAlDia = () => {
    $('msgACuantos').textContent = `Le llega a ${cuantasPersonas(aCuantos())}`;
  };

  const mostrarLoQuePide = () => {
    const cual = destino.value;
    $('msgCampoIglesia').hidden = cual !== 'iglesia';
    $('msgCampoPerfil').hidden = cual !== 'perfil';
    $('msgCampoPersonas').hidden = cual !== 'personas';
    ponerElNumeroAlDia();
  };
  destino.addEventListener('change', mostrarLoQuePide);
  for (const cual of ['msgPersonas', 'msgIglesia', 'msgPerfil']) {
    $(cual).addEventListener('change', ponerElNumeroAlDia);
  }
  mostrarLoQuePide();

  // Lo que va quedando, para no toparse con el tope al final de escribir
  const contar = (campo, cuenta, tope) => {
    const poner = () => {
      const largo = $(campo).value.length;
      $(cuenta).textContent = largo > tope * 0.8 ? `${largo} de ${tope} caracteres` : '';
    };
    $(campo).addEventListener('input', poner);
    poner();
    return poner;
  };
  const cuentas = [
    contar('msgTitulo', 'msgCuentaTitulo', d.largo.titulo),
    contar('msgCuerpo', 'msgCuentaCuerpo', d.largo.cuerpo),
  ];

  /** Lo que se le va a decir a quien aprieta «Retirar», antes de hacerlo. */
  const loQueSeVaARetirar = (m) => {
    const aCuantos = m.sin_leer === 1
      ? 'a la persona que todavía no lo abre'
      : `a las ${m.sin_leer} personas que todavía no lo abren`;
    const yaLoVieron = m.leidos === 0
      ? 'Nadie alcanzó a abrirlo.'
      : m.leidos === 1
        ? 'Una persona ya lo abrió, y a esa no se le puede quitar.'
        : `${m.leidos} personas ya lo abrieron, y a esas no se les puede quitar.`;
    return `¿Retirar «${m.titulo}»?\n\nSe le va a quitar de la campanita ${aCuantos}.\n${yaLoVieron}`;
  };

  async function pintarElHistorial() {
    const caja = $('msgHistorial');
    let h;
    try {
      h = await api('GET', '/avisos/mensajes?limit=30');
    } catch (e) {
      caja.innerHTML = `<div class="card-body mut">${esc(e.message)}</div>`;
      return;
    }
    if (!h.mensajes.length) {
      caja.innerHTML = '<div class="card-body mut">Todavía no se ha mandado ninguno.</div>';
      return;
    }
    caja.innerHTML = `<ul class="mini-list">${h.mensajes.map((m) => `
      <li class="${m.retirado_en ? 'retirado' : ''}">
        <span>
          <span class="msg-t">${esc(m.titulo)}</span>${m.urgente ? ' <span class="badge red">Urgente</span>' : ''}${m.retirado_en ? ' <span class="badge yellow">Retirado</span>' : ''}
          <div class="mut" style="font-size:12.5px">${esc(m.destino_dice)} · ${esc(m.quien || '')} · ${esc(cuandoFue(m.created_at))}${
            m.retirado_en ? ` · lo retiró ${esc(m.quien_retiro || 'alguien')} ${esc(cuandoFue(m.retirado_en))}` : ''}</div>
          <div class="msg-acciones">
            <button type="button" class="btn sm" data-abrir="${m.id}">Ver</button>
            <button type="button" class="btn sm" data-repetir="${m.id}">↻ Volver a mandar</button>
            ${!m.retirado_en && m.sin_leer
              ? `<button type="button" class="btn sm danger" data-retirar="${m.id}">Retirar</button>` : ''}
          </div>
          <div class="msg-abierto" id="msgAbierto${m.id}" hidden></div>
        </span>
        <span class="mut" style="white-space:nowrap">${m.leidos} de ${m.cuantos} leído${m.leidos === 1 ? '' : 's'}</span>
      </li>`).join('')}</ul>`;

    /*
     * Retirar le saca el aviso a quien todavía no lo abrió. Se pregunta antes y
     * se dice el número, porque es lo que decide: retirar algo que ya leyeron
     * treinta personas no arregla nada, y saberlo es lo que hace elegir entre
     * retirarlo o mandar otro diciendo que hubo un error.
     */
    caja.querySelectorAll('[data-retirar]').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const m = h.mensajes.find((x) => x.id === Number(boton.dataset.retirar));
        if (!m || !confirm(loQueSeVaARetirar(m))) return;
        boton.disabled = true;
        try {
          const r = await api('POST', `/avisos/mensajes/${m.id}/retirar`);
          toast(r.borrados === 1
            ? 'Retirado: se le quitó a 1 persona'
            : `Retirado: se le quitó a ${r.borrados} personas`);
          pintarElHistorial();
        } catch (e) {
          toast(e.message, true);
          boton.disabled = false;
        }
      });
    });

    /*
     * Abrir un envío: lo que decía y a quiénes fue.
     *
     * La lista mostraba el título, el destino y cuántos lo leyeron, y no el
     * texto ni a quiénes fue. Las dos cosas son lo que uno va a buscar después.
     */
    caja.querySelectorAll('[data-abrir]').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const caja2 = document.getElementById(`msgAbierto${boton.dataset.abrir}`);
        if (!caja2.hidden) { caja2.hidden = true; boton.textContent = 'Ver'; return; }
        caja2.innerHTML = '<div class="mut">Cargando…</div>';
        caja2.hidden = false;
        boton.textContent = 'Ocultar';
        try {
          const e = await api('GET', `/avisos/mensajes/${boton.dataset.abrir}`);
          caja2.innerHTML = `
            <p class="msg-texto">${esc(e.cuerpo || '')}</p>
            ${e.enlace ? `<div class="mut">Llevaba a <code>${esc(e.enlace)}</code></div>` : ''}
            <div class="msg-aquienes">
              <b>A quiénes fue</b>
              ${e.destinatarios.length
                ? `<ul>${e.destinatarios.map((x) => `<li>${esc(x.nombre || `Cuenta n.º ${x.usuario_id}`)}</li>`).join('')}</ul>`
                : '<div class="mut">No quedó anotado: es de antes de que se guardara.</div>'}
            </div>`;
        } catch (err) {
          caja2.innerHTML = `<div class="mut">${esc(err.message)}</div>`;
        }
      });
    });

    /*
     * Volver a mandar copia el texto y NO el destino. Restaurarlo a medias sería
     * peor: de un mensaje a personas elegidas no queda escrito a quiénes fue, y
     * dejar puesto «a toda la iglesia» es justo el clic que uno no quiere dar
     * sin pensarlo.
     */
    caja.querySelectorAll('[data-repetir]').forEach((boton) => {
      boton.addEventListener('click', () => {
        const m = h.mensajes.find((x) => x.id === Number(boton.dataset.repetir));
        if (!m) return;
        $('msgTitulo').value = m.titulo;
        $('msgCuerpo').value = m.cuerpo || '';
        $('msgEnlace').value = m.enlace || '';
        $('msgUrgente').checked = !!m.urgente;
        cuentas.forEach((poner) => poner());
        $('msgTitulo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('msgTitulo').focus();
        toast('Copiado arriba. Revise a quién va antes de mandarlo.');
      });
    });
  }
  pintarElHistorial();

  /**
   * Mandarlo.
   *
   * Cuando el servidor contesta con una pregunta en vez de un error —le va a
   * llegar a mucha gente— se muestra con sus dos botones y, si la respuesta es
   * que sí, se manda de nuevo con `igual_asi`. Es el mismo mecanismo de todo el
   * sistema, y el número que dice la pregunta lo calcula el servidor en el
   * momento: el de la pantalla es el de cuando se cargó.
   */
  async function mandar(igualAsi) {
    const cual = destino.value;
    const valor = cual === 'iglesia' ? $('msgIglesia').value
      : cual === 'perfil' ? $('msgPerfil').value
        : cual === 'personas' ? [...$('msgPersonas').selectedOptions].map((o) => Number(o.value))
          : null;

    const boton = $('msgEnviar');
    boton.disabled = true;
    $('msgError').innerHTML = '';
    try {
      const r = await api('POST', '/avisos/mensajes', {
        titulo: $('msgTitulo').value,
        cuerpo: $('msgCuerpo').value,
        urgente: $('msgUrgente').checked,
        enlace: $('msgEnlace').value,
        destino: cual,
        valor,
        igual_asi: !!igualAsi,
      });
      toast(`El mensaje le llegó a ${cuantasPersonas(r.cuantos)}`);
      $('msgTitulo').value = '';
      $('msgCuerpo').value = '';
      $('msgEnlace').value = '';
      $('msgUrgente').checked = false;
      cuentas.forEach((poner) => poner()); // si no, queda diciendo «118 de 120» sobre un campo vacío
      ponerElNumeroAlDia();
      pintarElHistorial();
      refrescarCampanita();
    } catch (err) {
      if (err.datos && err.datos.confirmar) {
        preguntarSiIgualVa(err, () => mandar(true), 'msgError');
        return;
      }
      $('msgError').innerHTML = `<div class="aviso importante"><b>No se pudo enviar</b><span>${esc(err.message)}</span></div>`;
    } finally {
      boton.disabled = false;
    }
  }

  $('msgForm').addEventListener('submit', (e) => {
    e.preventDefault();
    mandar(false);
  });
}

/**
 * Los mensajes que le escribieron a uno.
 *
 * La contraparte de la pantalla de quien manda. Hacía falta porque la campanita
 * no sirve para volver a un mensaje: muestra un puñado, mezcla los avisos que
 * hace el sistema y, en cuanto llegan otros, el de la semana pasada deja de
 * estar en ninguna parte. Y lo que se pierde así no es un aviso de cumpleaños,
 * es lo que alguien escribió a mano para que se hiciera algo.
 *
 * Abrirla NO marca nada como leído. Quien la abre puede estar releyendo lo de
 * hace un mes, y dar por leído de una pasada todo lo que aparece le mentiría a
 * quien lo mandó, que cuenta los leídos para saber si hace falta insistir.
 */
async function viewMisMensajes() {
  content().innerHTML = `
    <div class="page-head"><h2>📬 Mis mensajes</h2></div>
    <div class="card"><div class="card-body">Cargando…</div></div>`;

  let traidos = 30;

  async function pintar() {
    let d;
    try {
      d = await api('GET', `/avisos/recibidos?limit=${traidos}`);
    } catch (e) {
      content().innerHTML = `
        <div class="page-head"><h2>📬 Mis mensajes</h2></div>
        <div class="card"><div class="card-body">${esc(e.message)}</div></div>`;
      return;
    }

    content().innerHTML = `
      <div class="page-head"><h2>📬 Mis mensajes</h2></div>
      ${d.total === 0 ? `
        <div class="card"><div class="card-body mut">
          Todavía no le han escrito ninguno. Acá van a quedar los mensajes que le manden,
          para poder volver a leerlos.
        </div></div>` : `
        <p class="mut" style="margin:0 0 14px">
          ${d.total === 1 ? 'Un mensaje' : `${d.total} mensajes`} que le han escrito.
          Los avisos que genera el sistema no salen acá: están en la campanita.
        </p>
        <div class="mis-msg">
          ${d.mensajes.map((m) => `
            <article class="card msg-recibido ${m.leida ? '' : 'sin-leer'}">
              <div class="card-body">
                <h3>${esc(m.titulo)}${m.leida ? '' : ' <span class="badge blue">Sin leer</span>'}</h3>
                <div class="mut msg-quien">${m.de ? `de ${esc(m.de)} · ` : ''}${esc(cuandoFue(m.created_at))}</div>
                ${m.cuerpo ? `<p class="msg-texto">${esc(m.cuerpo)}</p>` : ''}
                <div class="msg-acciones">
                  ${m.enlace ? `<a class="btn sm" href="${esc(m.enlace)}">Ir a lo que dice</a>` : ''}
                  ${m.leida ? '' : `<button type="button" class="btn sm" data-leido="${m.id}">Marcar como leído</button>`}
                </div>
              </div>
            </article>`).join('')}
        </div>
        ${d.hayMas ? '<div style="margin-top:14px"><button type="button" class="btn" id="misMas">Ver más</button></div>' : ''}
      `}`;

    content().querySelectorAll('[data-leido]').forEach((boton) => {
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        await api('POST', `/avisos/${boton.dataset.leido}/leido`).catch(() => {});
        refrescarCampanita();
        pintar();
      });
    });
    const mas = document.getElementById('misMas');
    if (mas) mas.addEventListener('click', () => { traidos += 30; pintar(); });
  }

  pintar();
}

/* ---------------- los avisos: la campanita ---------------- */
/**
 * La campanita de arriba: cuántos avisos hay sin leer, y cuáles.
 *
 * El número se refresca solo cada dos minutos, y además cada vez que se vuelve
 * a la pestaña: alguien que deja el sistema abierto toda la mañana tiene que
 * enterarse de que le trasladaron una solicitud sin recargar la página. Se
 * pregunta solo el número —no la lista— porque es lo único que se ve hasta que
 * alguien abre el panel.
 *
 * Con la pestaña de fondo no se pregunta nada: el sistema abierto en seis
 * computadores de la oficina no tiene por qué estar golpeando al servidor toda
 * la tarde para mirar un número que nadie está viendo.
 */
let AVISOS_RELOJ = null;

async function refrescarCampanita() {
  const cuenta = document.getElementById('camCuenta');
  if (!cuenta || !TOKEN) return;
  try {
    const { sinLeer } = await api('GET', '/avisos/cuantos');
    cuenta.textContent = sinLeer > 99 ? '99+' : String(sinLeer);
    cuenta.hidden = !sinLeer;
    const caja = document.getElementById('campanita');
    if (caja) caja.classList.toggle('con-avisos', !!sinLeer);
  } catch (e) {
    /* si no se puede preguntar, la campanita se queda como estaba */
  }
}

/*
 * Cuántos avisos pide el panel. Sube con «ver más» y vuelve a lo mínimo cada
 * vez que se cierra: quien lo abre mañana no quiere la lista larga de hoy.
 */
let CAM_CUANTOS = 20;

async function abrirElPanelDeAvisos() {
  const panel = document.getElementById('camPanel');
  const boton = document.getElementById('camAbrir');
  panel.innerHTML = '<div class="cam-vacio">Cargando…</div>';
  panel.hidden = false;
  boton.setAttribute('aria-expanded', 'true');

  let d = { sinLeer: 0, ultimos: [], hayMas: false };
  try {
    d = await api('GET', `/avisos?limit=${CAM_CUANTOS}`);
  } catch (e) {
    panel.innerHTML = `<div class="cam-vacio">${esc(e.message)}</div>`;
    return;
  }

  /*
   * Los sin leer van primero —los ordena el servidor— y acá se dice dónde
   * empiezan los ya leídos. Sin esa línea, ver un aviso de la semana pasada
   * encima de uno de hoy parece que la lista está desordenada.
   */
  const primerLeido = d.ultimos.findIndex((a) => a.leida);
  const hayDeLosDos = primerLeido > 0;

  panel.innerHTML = `
    <div class="cam-cabecera">
      <b>Mis avisos</b>
      ${d.sinLeer ? '<button type="button" class="enlace-suave" id="camTodos">Marcar todos como leídos</button>' : ''}
    </div>
    ${d.ultimos.length ? `<ul class="cam-lista">
      ${d.ultimos.map((a, i) => `
        ${hayDeLosDos && i === primerLeido ? '<li class="cam-corte">Ya leídos</li>' : ''}
        <li class="${a.leida ? 'leido' : 'sin-leer'}" data-id="${a.id}" data-tipo="${esc(a.tipo || '')}" data-enlace="${esc(a.enlace || '')}">
          <div class="cam-t">${esc(a.titulo)}</div>
          ${a.de ? `<div class="cam-de">de ${esc(a.de)}</div>` : ''}
          ${a.cuerpo ? `<div class="cam-c">${esc(a.cuerpo)}</div>` : ''}
          <div class="cam-f">${esc(cuandoFue(a.created_at))}</div>
        </li>`).join('')}
    </ul>` : '<div class="cam-vacio">No tiene avisos. Acá van a llegar.</div>'}
    ${d.hayMas ? '<div class="cam-mas"><button type="button" class="enlace-suave" id="camMas">Ver más avisos</button></div>' : ''}
    <div class="cam-pie">
      <a href="#/mis-mensajes">📬 Mis mensajes</a>
      <a href="#/perfil?tab=avisos">⚙️ Elegir qué avisos recibir</a>
    </div>`;

  const mas = document.getElementById('camMas');
  if (mas) {
    mas.addEventListener('click', () => {
      CAM_CUANTOS += 20;
      abrirElPanelDeAvisos();
    });
  }

  const todos = document.getElementById('camTodos');
  if (todos) {
    todos.addEventListener('click', async () => {
      await api('POST', '/avisos/leidos').catch(() => {});
      refrescarCampanita();
      abrirElPanelDeAvisos();
    });
  }
  // La línea que separa los ya leídos no es un aviso: no se marca ni se abre
  panel.querySelectorAll('.cam-lista li[data-id]').forEach((li) => {
    li.addEventListener('click', async () => {
      await api('POST', `/avisos/${li.dataset.id}/leido`).catch(() => {});
      refrescarCampanita();
      cerrarElPanelDeAvisos();
      /*
       * En el panel el texto va recortado a tres líneas, así que tocarlo tiene
       * que llevar a alguna parte. Si el aviso trae enlace, ahí; y si es un
       * mensaje escrito a mano, a «Mis mensajes», que es donde está entero.
       */
      if (li.dataset.enlace) location.hash = li.dataset.enlace.replace(/^#/, '');
      else if (li.dataset.tipo === 'mensaje') location.hash = '/mis-mensajes';
    });
  });
}

function cerrarElPanelDeAvisos() {
  const panel = document.getElementById('camPanel');
  if (!panel) return;
  CAM_CUANTOS = 20; // quien lo abra mañana no quiere la lista larga de hoy
  panel.hidden = true;
  const boton = document.getElementById('camAbrir');
  if (boton) boton.setAttribute('aria-expanded', 'false');
}

/** «recién», «hace 5 min», «ayer»: el reloj exacto no le importa a nadie acá. */
function cuandoFue(cuando) {
  if (!cuando) return '';
  const t = new Date(String(cuando).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return String(cuando);
  const minutos = Math.round((Date.now() - t.getTime()) / 60000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  return fechaCorta(String(cuando).slice(0, 10));
}

function iniciarCampanita() {
  const boton = document.getElementById('camAbrir');
  const caja = document.getElementById('campanita');
  if (!boton || !caja) return;

  boton.addEventListener('click', () => {
    const panel = document.getElementById('camPanel');
    if (panel.hidden) abrirElPanelDeAvisos();
    else cerrarElPanelDeAvisos();
  });
  document.addEventListener('click', (e) => { if (!caja.contains(e.target)) cerrarElPanelDeAvisos(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarElPanelDeAvisos(); });

  refrescarCampanita();
  if (AVISOS_RELOJ) clearInterval(AVISOS_RELOJ);
  AVISOS_RELOJ = setInterval(() => {
    if (document.visibilityState === 'visible') refrescarCampanita();
  }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refrescarCampanita();
  });
}


/** Lo que se está mostrando, para poder recorrerlo con el teclado. */
let BG = { abierto: false, pedido: 0, filas: [], marcada: -1 };

function iniciarBuscadorGlobal() {
  const caja = document.getElementById('buscadorGlobal');
  const texto = document.getElementById('bgTexto');
  const panel = document.getElementById('bgPanel');
  if (!caja || !texto || !panel) return;

  const cerrar = () => {
    panel.hidden = true;
    panel.innerHTML = '';
    texto.setAttribute('aria-expanded', 'false');
    texto.removeAttribute('aria-activedescendant');
    BG.filas = [];
    BG.marcada = -1;
  };

  /** Cierra y además saca la caja de encima de la barra, en el teléfono. */
  const guardar = () => {
    cerrar();
    caja.classList.remove('abierto');
    document.getElementById('bgAbrir').setAttribute('aria-expanded', 'false');
  };

  const marcar = (i) => {
    BG.marcada = i;
    panel.querySelectorAll('[data-ir-a]').forEach((el, n) => {
      const suya = n === i;
      el.classList.toggle('marcada', suya);
      el.setAttribute('aria-selected', suya ? 'true' : 'false');
      if (suya) {
        texto.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const pintar = (d) => {
    if (d.corto) {
      panel.innerHTML = `<div class="bg-vacio">Escriba al menos ${d.minimo || 2} letras.</div>`;
      panel.hidden = false;
      BG.filas = [];
      return;
    }
    if (!d.total) {
      panel.innerHTML = `<div class="bg-vacio">No se encontró nada con «${esc(d.q)}».
        <span>Se busca en todo lo que usted puede ver.</span></div>`;
      panel.hidden = false;
      texto.setAttribute('aria-expanded', 'true');
      BG.filas = [];
      return;
    }

    let n = 0;
    const partes = d.grupos.map((g) => {
      const filas = g.resultados.map((r) => {
        const id = `bgr_${n}`;
        BG.filas[n] = `#/m/${g.modulo}/ficha/${r.id}`;
        n++;
        const pistas = [...r.pistas];
        // Por qué salió: cuando lo que coincidió no está a la vista, se dice
        if (r.porque) pistas.push(`${r.porque.campo}: ${r.porque.valor}`);
        return `<div class="bg-item" role="option" aria-selected="false" id="${id}" data-ir-a="${esc(BG.filas[n - 1])}">
          <span class="t">${esc(r.titulo)}</span>
          ${pistas.length ? `<span class="p">${esc(pistas.join(' · '))}</span>` : ''}
        </div>`;
      }).join('');
      const verTodos = g.hay_mas
        ? `<a class="bg-mas" href="#/m/${g.modulo}?q=${encodeURIComponent(d.q)}">Ver todos en ${esc(g.label)} →</a>`
        : '';
      return `<div class="bg-grupo">
        <div class="bg-cab"><span class="ic" aria-hidden="true">${g.icon}</span>${esc(g.label)}</div>
        ${filas}${verTodos}
      </div>`;
    });

    panel.innerHTML = partes.join('');
    panel.hidden = false;
    texto.setAttribute('aria-expanded', 'true');
    BG.marcada = -1;

    panel.querySelectorAll('[data-ir-a]').forEach((el) =>
      el.addEventListener('click', () => {
        location.hash = el.dataset.irA;
        guardar();
        texto.value = '';
      }));
    panel.querySelectorAll('.bg-mas').forEach((el) => el.addEventListener('click', () => { guardar(); texto.value = ''; }));
  };

  const preguntar = async () => {
    const q = texto.value.trim();
    if (!q) return cerrar();
    if (q.length < 2) {
      pintar({ corto: true, minimo: 2 });
      return;
    }
    const mio = ++BG.pedido;
    panel.innerHTML = '<div class="bg-vacio">Buscando…</div>';
    panel.hidden = false;
    try {
      const d = await api('GET', `/buscar?q=${encodeURIComponent(q)}`);
      // Una respuesta que llega después de haberse pedido otra ya no sirve:
      // pintarla dejaría en pantalla el resultado de lo que se escribió antes.
      if (mio !== BG.pedido) return;
      pintar(d);
    } catch (e) {
      if (mio !== BG.pedido) return;
      panel.innerHTML = `<div class="bg-vacio">${esc(e.message)}</div>`;
    }
  };

  let reloj = null;
  texto.addEventListener('input', () => {
    clearTimeout(reloj);
    reloj = setTimeout(preguntar, 250);
  });

  texto.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { guardar(); texto.blur(); return; }
    if (!BG.filas.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar((BG.marcada + 1) % BG.filas.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); marcar((BG.marcada - 1 + BG.filas.length) % BG.filas.length); }
    if (e.key === 'Enter' && BG.marcada >= 0) {
      e.preventDefault();
      location.hash = BG.filas[BG.marcada];
      guardar();
      texto.value = '';
    }
  });

  texto.addEventListener('focus', () => { if (texto.value.trim().length >= 2) preguntar(); });

  // Tocar fuera lo cierra: un panel que se queda abierto tapa la pantalla
  document.addEventListener('click', (e) => {
    if (!caja.contains(e.target)) guardar();
  });

  // En el teléfono, la lupa abre la caja sobre la barra
  document.getElementById('bgAbrir').addEventListener('click', () => {
    caja.classList.add('abierto');
    document.getElementById('bgAbrir').setAttribute('aria-expanded', 'true');
    texto.focus();
  });
  document.getElementById('bgCerrar').addEventListener('click', () => { texto.value = ''; guardar(); });

  // Y desde cualquier parte: «/» lleva el cursor al buscador, como en tantos
  // sistemas. No se roba la tecla mientras se está escribiendo en otro campo.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const donde = document.activeElement;
    if (donde && ['INPUT', 'TEXTAREA', 'SELECT'].includes(donde.tagName)) return;
    if (donde && donde.isContentEditable) return;
    e.preventDefault();
    caja.classList.add('abierto');
    texto.focus();
  });
}

/** Los cuerpos y grupos en los que participa un miembro, bajo su ficha. */
/**
 * Lo que pidió una persona, en su propia ficha.
 *
 * El módulo se diseñó «para poder ver todo lo que pidió una persona», pero para
 * eso había que ir al listado y buscar por nombre. Acá salen las dos maneras en
 * que alguien aparece en una solicitud, separadas porque no son lo mismo: las
 * que PRESENTÓ, y aquellas en las que FIGURA sin haberlas presentado —el niño
 * de una presentación, la persona a la que se traslada una ayuda—.
 */
/**
 * En qué servicios ha servido esta persona.
 *
 * Las tres cosas juntas —cuándo predicó, cuándo coordinó y cuándo leyó el
 * salmo—, con la fecha, el tipo de servicio y el pasaje. Cada fila abre su
 * servicio.
 */
async function renderServiciosDeLaPersona(personaId, contenedor) {
  if (!MOD['servicios']) return;
  let d;
  try {
    d = await api('GET', `/servicios/de-persona?id=${personaId}`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }

  const v = d.veces;
  const cuantas = (n, una, varias) => `${fmtNumero(n)} ${n === 1 ? una : varias}`;
  // Solo los papeles que de verdad tuvo: «Leyó el salmo 0 veces» no dice nada
  const resumen = [
    v.predico ? `📖 Predicó ${cuantas(v.predico, 'vez', 'veces')}` : null,
    v.coordino ? `🎙️ Coordinó ${cuantas(v.coordino, 'vez', 'veces')}` : null,
    v.leyo ? `📜 Leyó el salmo ${cuantas(v.leyo, 'vez', 'veces')}` : null,
  ].filter(Boolean);

  contenedor.innerHTML = `
    <div class="card bandeja-tabla" style="margin-top:18px">
      <div class="toolbar">
        <b>🕊️ En los servicios</b>
        <span style="color:var(--muted);font-size:13px">${esc(resumen.join(' · ') || 'Todavía no ha servido en ninguno')}</span>
      </div>
      ${d.servicios.length ? `
        <div class="table-scroll">
          <table class="grid grid-lista">
            <thead><tr>
              <th>Fecha</th><th>Tipo de servicio</th><th>Qué hizo</th><th>Pasaje del mensaje</th><th>Salmo</th>
            </tr></thead>
            <tbody>
              ${d.servicios.map((x) => `
                <tr data-ir="#/m/servicios/edit/${x.id}" tabindex="0">
                  <td data-col="fecha" data-label="Fecha"><b>${esc(fechaCorta(x.fecha))}</b></td>
                  <td data-label="Tipo de servicio">${esc(x.tipo || '')}</td>
                  <td data-label="Qué hizo">${x.papeles.map((p) => `<span class="badge">${esc(p)}</span>`).join(' ')}</td>
                  <td data-label="Pasaje del mensaje">${esc(x.papeles.includes('Predicó') ? x.cita_mensaje : '')}</td>
                  <td data-label="Salmo">${esc(x.papeles.includes('Leyó el salmo') ? x.cita_salmo : '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${v.servicios > d.servicios.length
          ? `<div class="card-body" style="color:var(--muted);font-size:13px">Se muestran los ${
              fmtNumero(d.servicios.length)} más recientes, de ${fmtNumero(v.servicios)}.</div>`
          : ''}`
        : '<div class="card-body" style="color:var(--muted);font-size:13px">No figura en ningún servicio registrado.</div>'}
    </div>`;
}

async function renderSolicitudesDeLaPersona(tipo, personaId, contenedor) {
  if (!MOD['solicitudes']) return;
  let d;
  try {
    d = await api('GET', `/solicitudes/de-persona?tipo=${encodeURIComponent(tipo)}&id=${personaId}`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }

  const filas = (lista, conRelacion) => `
    <div class="table-scroll">
      <table class="grid grid-lista">
        <thead><tr>
          <th>N.º</th><th>Fecha</th><th>Tipo</th><th>Asunto</th>
          ${conRelacion ? '<th>Qué papel tiene</th>' : ''}<th>Estado</th>
        </tr></thead>
        <tbody>
          ${lista.map((s) => `
            <tr data-ir="#/m/solicitudes/ficha/${s.id}" tabindex="0">
              <td data-col="numero" data-label="N.º"><b>${esc(s.numero || '—')}</b></td>
              <td data-label="Fecha">${esc(s.fecha ? fechaCorta(s.fecha) : '')}</td>
              <td data-label="Tipo">${esc(s.tipo || '')}</td>
              <td data-label="Asunto">${esc(s.asunto || '')}</td>
              ${conRelacion ? `<td data-label="Qué papel tiene">${esc(s.relacion || '')}</td>` : ''}
              <td data-label="Estado"><span class="badge ${badgeClass(s.estado)}">${esc(s.estado || '')}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  contenedor.innerHTML = `
    <div class="card bandeja-tabla" style="margin-top:18px">
      <div class="toolbar">
        <b>📨 Lo que ha pedido</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(d.titular.length)} solicitud(es)</span>
        <span class="spacer"></span>
        ${MOD['solicitudes'].perms.create
          ? `<a class="btn sm" href="#/m/solicitudes/new?solicitante_tipo=${encodeURIComponent(tipo)}&${
              tipo === 'Miembro' ? 'miembro_id' : 'no_miembro_id'}=${personaId}">➕ Nueva solicitud</a>`
          : ''}
      </div>
      ${d.titular.length ? filas(d.titular, false)
        : '<div class="card-body" style="color:var(--muted);font-size:13px">No ha presentado ninguna solicitud.</div>'}
    </div>
    ${d.involucrada.length ? `
      <div class="card bandeja-tabla" style="margin-top:14px">
        <div class="toolbar">
          <b>🧑‍🤝‍🧑 Donde figura sin haberla presentado</b>
          <span style="color:var(--muted);font-size:13px">${fmtNumero(d.involucrada.length)} solicitud(es)</span>
        </div>
        ${filas(d.involucrada, true)}
      </div>` : ''}`;
}

/**
 * De qué registro sale esta persona cuando recibe una ayuda. La ayuda guarda
 * un enlace u otro según el caso, nunca los dos (ver server/modules/ayudas_sociales.js).
 */
/**
 * Qué fichas llevan su historial en la hoja impresa, y cuántas anotaciones.
 *
 * El tope es el mismo que usa la hoja de una solicitud para su tramitación. Una
 * ficha corriente tiene catorce anotaciones y sale entera; una de veinte años
 * llega al tope, y entonces la hoja lo DICE en vez de cortar en silencio, que
 * es la misma regla que sigue la pestaña en pantalla.
 */
const HISTORIAL_EN_LA_HOJA = ['miembros', 'iglesias', 'pastores'];
const HISTORIAL_EN_EL_PAPEL = 200;

/**
 * Y qué fichas llevan la lista de su carpeta, con el mismo tope.
 *
 * La hoja llevaba los datos y el historial, y del historial se podía sacar la
 * idea de que también llevaba los papeles: hay líneas que dicen «Se adjuntó
 * "…"». No es lo mismo, y medido sobre una carpeta de tres papeles la hoja se
 * equivocaba en las dos direcciones: nombraba una carta de traslado que ya se
 * había quitado de la carpeta —porque la línea del historial queda— y no
 * nombraba un certificado de bautismo que sí estaba —porque entró por
 * importación y nunca dejó línea—. El historial cuenta lo que se fue
 * adjuntando; la carpeta es lo que hay hoy, y es lo que se necesita en papel
 * cuando se entrega una congregación, se prepara un traslado o alguien
 * pregunta qué le falta por presentar.
 *
 * Y desde la 1.202.0 lo mismo vale para la hoja de una iglesia y la de un
 * pastor, que hasta entonces salían con sus datos y nada más: sin historial
 * —el arreglo de la 1.185.0 nombraba solo a los miembros— y sin carpeta. Se
 * entrega una congregación con la hoja de la iglesia en la mano, y ahí tiene
 * que estar lo que la iglesia guarda.
 *
 * La de una solicitud no entra en estas dos listas porque no se imprime con
 * `printGenerico`: tiene su propia hoja, que ya lleva su tramitación.
 */
const DOCUMENTOS_EN_LA_HOJA = ['miembros', 'iglesias', 'pastores'];
const DOCUMENTOS_EN_EL_PAPEL = 200;

const COMO_RECIBE_AYUDA = { miembros: 'Miembro', no_miembros: 'No miembro' };

/** «3 entregas · la última el 20-07-2026», en una línea. */
function resumenDeAyudas(d) {
  if (!d || !d.registradas) return '';
  const partes = [];
  if (d.entregas) {
    partes.push(`${fmtNumero(d.entregas)} entrega${d.entregas === 1 ? '' : 's'}`);
    if (d.ultima) partes.push(`la última el ${fechaCorta(d.ultima)}`);
  }
  if (d.en_camino) partes.push(`${fmtNumero(d.en_camino)} en trámite`);
  // Todas rechazadas: no hubo entregas ni queda nada en camino, pero la
  // persona sí pasó por acá y decir «nada» sería falso.
  if (!partes.length) partes.push(`${fmtNumero(d.registradas)} ayuda(s) registrada(s)`);
  return partes.join(' · ');
}

/**
 * LO QUE SE LE HA ENTREGADO, EN SU PROPIA FICHA.
 *
 * Es la pregunta del mostrador: «¿a esta señora ya se le entregó algo?». El
 * dato estaba guardado desde siempre —cada ayuda apunta a su ficha— pero solo
 * se llegaba a él por el listado de Ayudas Sociales, que se ordena por fecha y
 * no por persona: había que salir de la ficha, buscarla por nombre y volver.
 *
 * La cuenta que se muestra arriba es la que manda el servidor sobre TODAS sus
 * ayudas, no una suma de las filas de la tabla: si alguna vez alguien tuviera
 * más de las que caben, la tabla mostraría menos y el total seguiría diciendo
 * la verdad. Por eso también se avisa cuando la tabla se quedó corta.
 */
async function renderAyudasDeLaPersona(tipo, personaId, contenedor, yaEsMiembro) {
  if (!MOD['ayudas_sociales']) return;
  let d;
  try {
    d = await api('GET', `/ayudas_sociales/de-persona?tipo=${encodeURIComponent(tipo)}&id=${personaId}`);
  } catch (e) {
    contenedor.innerHTML = `<div class="card"><div class="card-body" style="color:var(--danger)">${esc(e.message)}</div></div>`;
    return;
  }

  const faltan = d.registradas - d.ayudas.length;
  // Una ayuda nueva se le anota a la ficha que vive. Si esta persona ya se
  // inscribió, esa es la de Miembros: anotarla acá la dejaría colgando de una
  // ficha que ya nadie abre, que es justo lo que se está arreglando.
  const aQuien = yaEsMiembro ? 'Miembro' : tipo;
  const aCual = yaEsMiembro || personaId;
  const campo = aQuien === 'Miembro' ? 'miembro_id' : 'no_miembro_id';
  const puedeCrear = MOD['ayudas_sociales'].perms.create;

  contenedor.innerHTML = `
    <div class="card bandeja-tabla" style="margin-top:18px">
      <div class="toolbar">
        <b>🤝 Lo que se le ha entregado</b>
        <span class="mut">${esc(resumenDeAyudas(d) || 'nada registrado')}</span>
        <span class="spacer"></span>
        ${puedeCrear
          ? `<a class="btn sm" href="#/m/ayudas_sociales/new?beneficiario_tipo=${encodeURIComponent(aQuien)}&${campo}=${aCual}">➕ Registrar una ayuda</a>`
          : ''}
      </div>
      ${d.registradas ? `
        <div class="table-scroll">
          <table class="grid grid-lista">
            <thead><tr>
              <th>Fecha</th><th>Tipo de ayuda</th><th>Qué se entregó</th>
              <th class="num">Valor estimado</th><th>Estado</th>
            </tr></thead>
            <tbody>
              ${d.ayudas.map((a) => `
                <tr data-ir="#/m/ayudas_sociales/edit/${a.id}" tabindex="0">
                  <td data-label="Fecha">${esc(a.fecha ? fechaCorta(a.fecha) : '')}${
                    a.antes ? ' <span class="badge">antes de inscribirse</span>' : ''}</td>
                  <td data-label="Tipo de ayuda"><b>${esc(a.tipo_ayuda || '')}</b></td>
                  <td data-label="Qué se entregó">${esc(a.descripcion || '')}</td>
                  <td data-label="Valor estimado" class="num">${a.valor_estimado ? esc(fmtMoney(a.valor_estimado)) : ''}</td>
                  <td data-label="Estado"><span class="badge ${badgeClass(a.estado)}">${esc(a.estado || '')}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${faltan > 0
          ? `<div class="card-body mut" style="font-size:13px">Se muestran las ${fmtNumero(d.ayudas.length)} más recientes; hay ${fmtNumero(faltan)} más atrás.</div>`
          : ''}
        ${d.antes_de_inscribirse
          ? `<div class="card-body mut" style="font-size:13px">De esas, ${fmtNumero(d.antes_de_inscribirse)} se le
               ${d.antes_de_inscribirse === 1 ? 'entregó' : 'entregaron'} cuando todavía no estaba inscrita, y
               ${d.antes_de_inscribirse === 1 ? 'cuelga' : 'cuelgan'} de su ficha de No Miembro.</div>`
          : ''}
        ${d.entregado || d.sin_monto
          ? `<div class="card-body" style="font-size:13px">Suma estimada de lo entregado:
               <b>${esc(fmtMoney(d.entregado))}</b>${d.sin_monto
                 ? ` <span class="mut">— ${fmtNumero(d.sin_monto)} de sus entregas no ${d.sin_monto === 1 ? 'dice' : 'dicen'}
                     cuánto ${d.sin_monto === 1 ? 'valía' : 'valían'}, así que ${d.sin_monto === 1 ? 'cuenta' : 'cuentan'}
                     como $ 0</span>`
                 : ''}</div>`
          : ''}`
        : `<div class="card-body mut" style="font-size:13px">No se le ha registrado ninguna ayuda.</div>`}
    </div>`;
}

/**
 * CÓMO HA ASISTIDO, EN SU PROPIA FICHA.
 *
 * El informe por persona existe y está bien hecho —abre su porcentaje en cada
 * cuerpo y detalla marca por marca—, pero había que ir a buscarlo a la pestaña
 * de Informes y escribir su nombre. En la ficha, que es donde uno la está
 * mirando antes de una entrevista o de evaluar su período de prueba, no había
 * ni una palabra de su asistencia.
 *
 * Los números salen del MISMO informe, no de una cuenta propia: dos cálculos
 * para lo mismo se separan, y la ficha terminaría diciendo un porcentaje y el
 * informe otro. Se pide el año en curso —que es lo que se mira— y queda el
 * enlace al informe completo, donde el período se cambia.
 */
async function renderAsistenciaDeLaPersona(tipo, personaId, contenedor) {
  if (!MOD['asistencias']) return;
  const esNoMiembro = tipo === 'No miembro';
  const desde = `${new Date().getFullYear()}-01-01`;
  const params = new URLSearchParams({ tipo: 'persona', desde });
  params.set(esNoMiembro ? 'no_miembro_id' : 'miembro_id', personaId);

  let d;
  try {
    d = await api('GET', '/asistencias/informe?' + params.toString());
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }

  const alInforme = `#/asistencia/informes?tipo=persona&desde=${desde}&`
    + `${esNoMiembro ? 'no_miembro_id' : 'miembro_id'}=${personaId}`;
  const pct = (n) => `${String(n).replace('.', ',')}%`;
  const g = d.general;

  if (!g.total) {
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar"><b>✅ Cómo ha asistido</b><span class="spacer"></span>
          <a class="btn secondary sm" href="${alInforme}">📈 Ver el informe completo</a></div>
        <div class="empty-state" style="padding:26px">
          No tiene ninguna marca de asistencia este año.<br>
          <span class="mut">Aparecerá acá en cuanto se le pase lista en alguna actividad.</span>
        </div>
      </div>`;
    return;
  }

  /* Cuando participa en más de un cuerpo, cada uno lleva su propia cuenta y
     pueden no parecerse: al día en uno y flojo en el otro. */
  const porCuerpo = (d.porMiembroCuerpo || []).length > 1 ? `
    <div class="card" style="margin-top:14px">
      <div class="toolbar"><b>👥 En cada cuerpo</b></div>
      <div class="table-scroll">
        <table class="grid grid-lista">
          <thead><tr><th>Cuerpo / Grupo</th><th>Presentes</th><th>Ausentes</th><th>Justificados</th><th>Asistencia</th></tr></thead>
          <tbody>
            ${d.porMiembroCuerpo.map((f) => `
              <tr>
                <td class="col-primera col-titular" data-label="Cuerpo / Grupo">${esc(f.cuerpo || '—')}</td>
                <td class="num" data-label="Presentes">${esc(fmtNumero(f.presentes))}</td>
                <td class="num" data-label="Ausentes">${esc(fmtNumero(f.ausentes))}</td>
                <td class="num" data-label="Justificados">${esc(fmtNumero(f.justificados))}</td>
                <td data-label="Asistencia"><b>${pct(f.pct_presente)}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const ULTIMAS = 12;
  const ultimas = (d.marcas || []).slice(0, ULTIMAS);
  const insignia = (e) => `<span class="badge ${e === 'Presente' ? 'green' : e === 'Ausente' ? 'red' : 'blue'}">${esc(e || '')}</span>`;

  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>✅ Cómo ha asistido</b>
        <span class="mut">este año</span>
        <span class="spacer"></span>
        <a class="btn secondary sm" href="${alInforme}">📈 Ver el informe completo</a>
      </div>
      <div class="stats" style="padding:0 14px 14px">
        <div class="stat"><div class="ic">📋</div><div class="num">${esc(fmtNumero(g.total))}</div><div class="lbl">Actividades</div></div>
        <div class="stat"><div class="ic">✅</div><div class="num">${pct(g.pct_presente)}</div><div class="lbl">Asistencia</div></div>
        <div class="stat"><div class="ic">❌</div><div class="num">${pct(g.pct_ausente)}</div><div class="lbl">Inasistencia</div></div>
        <div class="stat"><div class="ic">📝</div><div class="num">${pct(g.pct_justificado)}</div><div class="lbl">Justificación</div></div>
      </div>
    </div>
    ${porCuerpo}
    <div class="card" style="margin-top:14px">
      <div class="toolbar">
        <b>🗓️ Sus últimas ${fmtNumero(ultimas.length)}</b>
        ${d.marcas.length > ULTIMAS
          ? `<span class="mut">de ${fmtNumero(d.marcas.length)} este año — el resto, en el informe</span>` : ''}
      </div>
      <div class="table-scroll">
        <table class="grid grid-lista">
          <thead><tr><th>Fecha</th><th>Cuerpo</th><th>Actividad</th><th>Estado</th><th>Motivo</th></tr></thead>
          <tbody>
            ${ultimas.map((m) => `
              <tr>
                <td class="col-primera col-titular" data-label="Fecha">${esc(fechaCorta(m.fecha))}</td>
                <td data-label="Cuerpo">${esc(m.cuerpo || '')}</td>
                <td data-label="Actividad">${esc(m.actividad || '')}</td>
                <td data-label="Estado">${insignia(m.estado)}</td>
                <td data-label="Motivo">${esc(m.motivo || '')}${m.detalle ? ` <span class="mut">(${esc(m.detalle)})</span>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Cómo pertenece hoy a ese cuerpo, dicho en la ficha de la persona.
 *
 * La lista mostraba todos los cuerpos igual, vigentes y retirados, porque el
 * servidor mandaba el estado y la pantalla no lo miraba. Así, la ficha de
 * quien falleció —a quien el sistema retira solo de sus cuerpos, ver
 * server/ya-no-esta.js— seguía leyéndose como si perteneciera a todos.
 */
function insigniaDePertenencia(c) {
  if (c.en === 'Retirado') return ' <span class="badge red">Retirado</span>';
  if (c.en === 'En prueba') return ' <span class="badge yellow">En prueba</span>';
  return '';
}

/** El motivo y la fecha de la salida, para la columna de la derecha. */
function porQueSalio(c) {
  if (c.en !== 'Retirado' || !c.salida) return '';
  const partes = [c.salida.motivo, c.salida.el ? `el ${fechaCorta(c.salida.el)}` : ''].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Retirado';
}

/**
 * De qué menores responde esta persona, en su propia ficha.
 *
 * Es la vuelta del vínculo. La ficha del niño dice quién responde por él; sin
 * esto, la de la madre no decía nada, y el vínculo servía para la mitad de lo
 * que tenía que servir.
 *
 * No se pinta nada cuando no hay nadie a cargo, que es el caso de casi todas
 * las fichas: una caja vacía que dice «no tiene menores a cargo» es ruido en
 * todas las fichas de la iglesia para servirle a unas pocas.
 */
async function renderMenoresACargo(miembroId, contenedor) {
  let d;
  try {
    d = await api('GET', `/miembros/${miembroId}/a-cargo`);
  } catch (e) {
    return;
  }
  if (!d.menores || !d.menores.length) return;

  const caja = document.createElement('div');
  caja.className = 'card';
  caja.style.marginTop = '18px';
  caja.innerHTML = `
    <div class="toolbar"><b>👨‍👩‍👧 Menores a su cargo</b></div>
    <ul class="mini-list">${d.menores.map((m) => `
      <li data-id="${m.id}">
        <span>${esc(nombreCorto(m))}${
          m.responsable_parentesco ? ` <span class="mut">· ${esc(m.responsable_parentesco)}</span>` : ''}</span>
        <span class="mut">${m.ya_es_mayor
          ? 'ya es mayor de edad'
          : esc(m.edad != null ? `${m.edad} año${m.edad === 1 ? '' : 's'}` : '')}</span>
      </li>`).join('')}</ul>`;
  contenedor.appendChild(caja);
  caja.querySelectorAll('.mini-list li').forEach((li) => {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => (location.hash = `#/m/miembros/ficha/${li.dataset.id}`));
  });
}

async function renderCuerposDelMiembro(miembroId, contenedor) {
  if (!MOD['cuerpos']) return;
  let d;
  try {
    d = await api('GET', `/miembros/${miembroId}/cuerpos`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }
  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar"><b>👥 Cuerpos y grupos</b></div>
      ${d.cuerpos.length
        ? `<ul class="mini-list">${d.cuerpos.map((c) => `
            <li data-id="${c.id}" class="${c.en === 'Retirado' ? 'salido' : ''}">
              <span>${esc(c.nombre)}${c.lidera ? ' <span class="badge blue">Lidera</span>' : ''}${insigniaDePertenencia(c)}</span>
              <span class="mut">${esc(porQueSalio(c) || c.tipo || '')}</span>
            </li>`).join('')}</ul>`
        : `<div class="card-body" style="color:var(--muted);font-size:13px">No participa en ningún cuerpo ni grupo.</div>`}
    </div>`;
  contenedor.querySelectorAll('.mini-list li').forEach((li) => {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => (location.hash = `#/m/cuerpos/ficha/${li.dataset.id}`));
  });
}

/* ---------------- formulario genérico ---------------- */
async function viewForm(name, id, precarga) {
  const m = MOD[name];
  const isNew = !id;
  if (isNew && !m.perms.create) return (location.hash = `#/m/${name}`);
  const canEdit = isNew ? m.perms.create : m.perms.edit;

  content().innerHTML = `
    <div class="page-head">
      <h2>${m.icon} ${isNew ? nuevoDe(m) : canEdit ? 'Editar' : 'Ver'} ${esc(m.labelSingular.toLowerCase())}</h2>
      <div class="actions">
        ${!isNew && CON_FICHA.includes(name) ? `<button class="btn secondary" id="btnFicha">👁️ Ver la ficha</button>` : ''}
        <button class="btn secondary" id="btnBack">← Volver</button>
      </div>
    </div>
    <div class="card"><form id="recForm"><div id="formGrid"><div class="form-grid"><p>Cargando…</p></div></div>
    <div class="form-error" id="formError" role="alert" aria-live="assertive"></div>
    <div class="form-foot" id="formFoot"></div></form></div>`;
  document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const bf = document.getElementById('btnFicha');
  if (bf) bf.addEventListener('click', () => (location.hash = `#/m/${name}/ficha/${id}`));

  let row = isNew && precarga ? { ...precarga } : {};
  if (!isNew) {
    try {
      row = await api('GET', `/${name}/${id}`);
    } catch (e) {
      content().querySelector('#formGrid').innerHTML =
        `<div class="form-grid"><p style="color:var(--danger)">${esc(e.message)}</p></div>`;
      return;
    }
  }

  // precargar opciones de todos los ref/multiref del módulo
  // Al crear, los valores por omisión ya cuentan para resolver de dónde salen
  // las opciones: si el movimiento nace como "Ingreso", su categoría tiene que
  // ofrecer las de ingreso desde el primer momento, no todas.
  if (isNew) {
    row = { ...Object.fromEntries(m.fields.filter((f) => f.default != null).map((f) => [f.name, f.default])), ...row };
  }
  const listas = [...new Set(
    m.fields
      .filter((f) => f.ref || f.type === 'persona' || (f.type === 'select' && f.optionsRoute))
      .map((f) => rutaOpciones(f, row))
  )];
  await Promise.all(listas.map((r) => getOptions(r).catch(() => [])));

  // Cómo se le trata a esta persona, junto al título de su ficha
  if (!isNew && row.tratamiento) {
    const titulo = content().querySelector('.page-head h2');
    if (titulo) {
      titulo.insertAdjacentHTML(
        'beforeend',
        ` <span class="trato-chip">${esc(row.tratamiento)} ${esc(nombreCorto(row))}</span>`
      );
    }
  }

  // Lo que no se puede pasar por alto de esta persona, antes de sus datos
  if (!isNew && name === 'miembros') avisosDelMiembro(row);
  if (!isNew) avisoDeLoReservado(row, name === 'miembros' ? ['miembros_salud'] : []);

  // Igual que en la ficha: lo que el servidor no mandó tampoco se ofrece para
  // escribir. Si se ofreciera, la persona escribiría algo, guardaría, y el
  // servidor lo ignoraría en silencio (ver server/sensibles.js).
  const visibles = m.fields.filter((f) => !f.computed && !estaReservado(f, row));

  const grid = document.getElementById('formGrid');
  grid.innerHTML =
    // El id del registro viaja oculto: hay selectores cuya lista depende de él
    (isNew ? '' : `<input type="hidden" name="id" value="${esc(id)}" />`) +
    formularioEnBloques(visibles, row, isNew);

  // Comportamientos de widgets
  visibles.forEach((f) => {
    if (f.type === 'multiref') initMultiref(f, row);
    if (f.type === 'money' || f.type === 'number') initNumero(f);
    if (f.type === 'richtext') initTextoRico(f);
    if (f.type === 'color') initColor(f);
    if (f.type === 'file') initFileField(f);
    if (f.type === 'rut') {
      const el = document.querySelector(`#recForm [name="${f.name}"]`);
      if (el) el.addEventListener('blur', () => { if (el.value) el.value = rutFormatear(el.value); });
    }
    if (f.type === 'permisos') initPermisos(f, row, row.rol);
    if (f.type === 'persona') initPersona(f);
    if (f.type === 'select') initSelectBuscable(f);
    if (f.type === 'ref') initRefBuscador(f, row);
    if (f.mostrarEdad) initEdad(f);
  });
  initCalculados(m);
  initSelectoresDependientes(m, row, isNew);

  // Campos que solo aplican según el valor de otro (showIf)
  aplicarCondiciones();
  renumerarBloques();

  // Un cuerpo se compone de miembros; un grupo, no necesariamente
  if (name === 'integrantes_cuerpo') prepararElIntegrante();
  if (name === 'cuerpos') prepararElCuerpo(isNew);

  // Cada tipo de certificado pide los datos de su hoja
  if (name === 'certificados') prepararElCertificado();

  // Y hay hojas que van siempre a lo ancho, porque así están hechas
  if (name === 'formatos_certificado') prepararElFormato();

  // Una solicitud sigue un recorrido: no todo estado lleva a todos los demás
  if (name === 'solicitudes') prepararLaSolicitud(row, isNew);

  // El acta: traer el texto del documento adjunto, y ver a quién enlaza
  if (name === 'actas_reuniones') prepararElActa(id, row, isNew);

  // El acta de asamblea también estrena su número, pero se numera por iglesia
  if (name === 'actas_asambleas') {
    proponerElNumeroDeActa(isNew, {
      ruta: '/actas_asambleas/proximo-numero',
      depende: ['iglesia_id', 'fecha'],
      clave: 'iglesia_id',
    });
  }

  /*
   * El certificado también estrena su número, por iglesia. Se escribía entero
   * a mano, y es un documento que se firma y se entrega: dos con el mismo
   * número son dos papeles que dicen ser el mismo.
   */
  if (name === 'certificados') {
    proponerElNumeroDeActa(isNew, {
      ruta: '/certificados/proximo-numero',
      depende: ['iglesia_id', 'fecha_emision'],
      clave: 'iglesia_id',
      campo: 'numero',
    });
  }

  /*
   * La oficina de partes estrena su número, y depende de DOS cosas: de la
   * iglesia —cada una lleva su libro— y del flujo, porque lo que entra y lo
   * que sale se numeran por separado. Lo interno no lleva número.
   */
  if (name === 'documentos') {
    proponerElNumeroDeActa(isNew, {
      ruta: '/documentos/proximo-numero',
      depende: ['iglesia_id', 'flujo', 'fecha_registro'],
      clave: 'iglesia_id',
      campo: 'numero',
    });
  }

  // Al traspasar, se muestra cuánto hay en la cuenta de origen
  if (name === 'traspasos') mostrarSaldoOrigen();

  // Al escribir la fecha de entrega de una credencial, se propone el vencimiento
  if (name === 'credenciales') proponerElVencimiento();

  // El perfil muestra a quiénes se les puso, y deja ponérselo a más
  if (name === 'perfiles_permisos' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderUsuariosDelPerfil(Number(id), zona);
  }

  // El pastor es también miembro: se avisa si le falta su ficha
  if (name === 'pastores' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderFichaMiembroPastor(Number(id), row, zona);
  }

  // La actividad se maneja en la pantalla de Asistencia; si alguien llega
  // igual a su ficha, se le ofrece volver allá para pasar la lista
  if (name === 'asistencias' && !isNew) {
    const acciones = content().querySelector('.page-head .actions');
    if (acciones) {
      acciones.insertAdjacentHTML('afterbegin',
        `<a class="btn secondary" href="#/asistencia?actividad=${esc(id)}">🖐️ Pasar lista</a>`);
    }
  }

  // Estado de la cuenta de tesorería bajo su ficha
  if (name === 'cuentas_tesoreria' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderEstadoCuenta(Number(id), zona);
  }

  // Cumplimiento y directivas bajo la ficha del cuerpo
  if (name === 'cuerpos' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderPanelesCuerpo(Number(id), zona);
  }

  // Cómo está el acceso de esta cuenta, bajo su ficha
  if (name === 'usuarios' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderClaveUsuario(Number(id), zona);
  }

  // Acceso al sistema del miembro, bajo su ficha
  if (name === 'miembros' && !isNew) {
    const zonaUsuario = document.createElement('div');
    content().appendChild(zonaUsuario);
    renderAccesoMiembro(Number(id), zonaUsuario);
  }

  // Documentos e historial: los llevan los miembros, las iglesias y los pastores
  if (!isNew && PANEL_DOCUMENTOS[name]) {
    const zonaDocs = document.createElement('div');
    content().appendChild(zonaDocs);
    renderDocumentos(PANEL_DOCUMENTOS[name], Number(id), zonaDocs);
  }
  if (!isNew && PANEL_HISTORIAL[name]) {
    const zonaHist = document.createElement('div');
    content().appendChild(zonaHist);
    renderHistorial(PANEL_HISTORIAL[name], Number(id), zonaHist);
  }

  const foot = document.getElementById('formFoot');
  /**
   * Los formatos de certificado y los certificados se pueden mirar antes de
   * guardar: lo que se imprime se firma y se entrega.
   *
   * La del CERTIFICADO pide la misma llave que Imprimir: muestra la hoja con
   * los datos de esa persona, así que dejarla sin llave sería una manera de
   * sacar por pantalla justo lo que esa llave existe para no dejar sacar.
   * La del FORMATO no la pide: ahí la hoja va con datos de relleno, y quien
   * administra los formatos tiene que poder ver lo que está diseñando.
   */
  const conPrevia = name === 'formatos_certificado'
    || (name === 'certificados' && tieneLlave('datos_impresion'));
  foot.innerHTML = `
    ${!isNew && m.printable && tieneLlave('datos_impresion') ? `<button type="button" class="btn secondary left" id="btnPrint">🖨️ Imprimir</button>` : ''}
    ${conPrevia ? `<button type="button" class="btn secondary${!isNew && m.printable && tieneLlave('datos_impresion') ? '' : ' left'}" id="btnPrevia">👁️ Vista previa</button>` : ''}
    <button type="button" class="btn secondary" id="btnCancel">Cancelar</button>
    ${canEdit ? `<button type="submit" class="btn">💾 Guardar</button>` : ''}`;
  document.getElementById('btnCancel').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const bp = document.getElementById('btnPrint');
  if (bp) bp.addEventListener('click', () => (location.hash = `#/print/${name}/${id}`));

  const bpv = document.getElementById('btnPrevia');
  if (bpv) {
    bpv.addEventListener('click', async () => {
      /*
       * Se lee el formulario tal como está, sin guardar: probar un cambio y
       * recién entonces aceptarlo es todo el sentido de la vista previa.
       */
      const enPantalla = collectForm(m);

      if (name === 'formatos_certificado') {
        return verVistaPreviaCertificado({
          formato: enPantalla,
          row: certDeEjemplo(enPantalla.nombre),
          titulo: `Vista previa: ${enPantalla.nombre || 'formato sin nombre'}`,
        });
      }

      /*
       * En un certificado, el formato viene del servidor —es lo que está
       * guardado para ese tipo— y lo escrito en pantalla manda sobre él. Las
       * etiquetas de las referencias no están en el formulario (guarda ids),
       * así que se toman de los selectores, que es donde se leen.
       */
      const tipo = enPantalla.tipo || '';
      const formato = tipo
        ? await api('GET', `/formatos_certificado/para?tipo=${encodeURIComponent(tipo)}`).catch(() => null)
        : null;
      const etiquetaDe = (campo) => {
        const el = document.querySelector(`#recForm [name="${campo}"]`);
        if (!el) return '';
        if (el.tagName === 'SELECT') return el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
        const caja = el.closest('.refbuscar');
        const txt = caja && caja.querySelector('.rb-txt');
        return txt ? txt.value.trim() : '';
      };
      const ejemplo = certDeEjemplo(tipo);
      verVistaPreviaCertificado({
        formato,
        row: {
          ...enPantalla,
          numero: enPantalla.numero || ejemplo.numero,
          nombre_titular: enPantalla.nombre_titular || ejemplo.nombre_titular,
          fecha_emision: enPantalla.fecha_emision || ejemplo.fecha_emision,
          iglesia_id_label: etiquetaDe('iglesia_id') || ejemplo.iglesia_id_label,
          oficiante_id_label: etiquetaDe('oficiante_id'),
        },
        titulo: tipo ? `Vista previa: ${tipo}` : 'Vista previa',
      });
    });
  }

  // Se pone en true cuando la persona confirma un aviso que admite confirmarse,
  // para que el segundo intento entre. Vuelve a false en cuanto se guarda.
  let yaConfirmo = false;

  document.getElementById('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const errEl = document.getElementById('formError');
    errEl.textContent = '';
    const data = collectForm(m);
    // La versión que se tenía a la vista: si otro la guardó mientras tanto, el
    // servidor avisa en vez de dejar que uno le borre el trabajo al otro.
    if (!isNew && row.updated_at) data.updated_at = row.updated_at;
    // Y si ya se respondió que sí a un aviso de los que se pueden confirmar
    // —un egreso que deja la cuenta en rojo—, se lo dice al servidor.
    if (yaConfirmo) data.igual_asi = true;
    try {
      if (isNew) await api('POST', `/${name}`, data);
      else await api('PUT', `/${name}/${id}`, data);
      yaConfirmo = false;
      invalidarOpciones(name); // refrescar selectores que referencien este módulo
      await refrescarSiEsUnoMismo(name, id);
      toast('Guardado correctamente');
      location.hash = !isNew && CON_FICHA.includes(name) ? `#/m/${name}/ficha/${id}` : `#/m/${name}`;
    } catch (err) {
      if (err.datos && err.datos.conflicto) return avisarEdicionSimultanea(err, row, name, id);
      if (err.datos && err.datos.confirmar) {
        return preguntarSiIgualVa(err, () => {
          yaConfirmo = true;
          document.getElementById('recForm').requestSubmit();
        });
      }
      errEl.textContent = err.message;
      // El aviso va al pie del formulario, junto al botón: se lleva la vista
      // hasta ahí. Antes se subía al encabezado y el motivo quedaba abajo, sin
      // que se viera por qué no se había guardado.
      errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

/**
 * Si lo que se acaba de guardar es la propia cuenta o la propia ficha de
 * miembro, la barra superior tiene que enterarse: el nombre y la foto de ahí
 * son los de quien está trabajando, y quedarían mostrando lo de antes hasta
 * volver a entrar.
 */
async function refrescarSiEsUnoMismo(modulo, id) {
  const esSuCuenta = modulo === 'usuarios' && Number(id) === Number(USER.id);
  const esSuFicha = modulo === 'miembros' && USER.miembro_id && Number(id) === Number(USER.miembro_id);
  if (!esSuCuenta && !esSuFicha) return;
  try {
    const me = await api('GET', '/auth/me');
    USER = { ...USER, ...me.user };
  } catch (e) {
    return; // si no se pudo, la barra queda como estaba hasta la próxima vuelta
  }
  const quien = document.querySelector('.who b');
  if (quien) quien.textContent = USER.nombre;
  const cara = document.querySelector('.who .avatar');
  if (cara) {
    const iniciales = (USER.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    cara.outerHTML = retratoDe(USER, iniciales);
  }
}

/**
 * Dos personas guardaron la misma ficha.
 *
 * Lo que uno escribió sigue en pantalla, sin perderse. Se le cuenta qué pasó
 * y se le dan las dos salidas honestas: mirar cómo quedó la ficha con lo que
 * guardó el otro —y volver a hacer lo suyo sobre eso— o insistir, dejando su
 * versión, que es lo que corresponde cuando el otro cambió otra cosa.
 */
function avisarEdicionSimultanea(err, row, name, id) {
  const errEl = document.getElementById('formError');
  errEl.innerHTML = `
    <div class="aviso choque">
      <b>✋ Alguien más guardó esta ficha</b>
      <span>${esc(err.message)} Lo que usted escribió sigue acá, no se ha perdido.</span>
      <div class="acciones">
        <button type="button" class="btn secondary" id="choqueRecargar">Ver cómo quedó</button>
        <button type="button" class="btn" id="choqueInsistir">Guardar lo mío de todas formas</button>
      </div>
    </div>`;
  errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  document.getElementById('choqueRecargar').addEventListener('click', () => {
    // Se vuelve a abrir la ficha tal como quedó: lo escrito acá se descarta
    viewForm(name, id);
  });
  document.getElementById('choqueInsistir').addEventListener('click', () => {
    // Se toma como propia la versión nueva y se vuelve a intentar: ahora el
    // servidor ya no ve un choque y guarda lo que esta persona escribió.
    row.updated_at = (err.datos.actual && err.datos.actual.updated_at) || null;
    errEl.textContent = '';
    document.getElementById('recForm').requestSubmit();
  });
}

/**
 * Un aviso que no es un rechazo sino una pregunta.
 *
 * El servidor puede responder que algo se puede guardar pero conviene mirarlo
 * dos veces: un egreso que deja la cuenta en rojo, por ejemplo. No es un error
 * —una cuenta puede quedar en rojo de verdad—, así que en vez del aviso rojo
 * de siempre se ofrecen los dos caminos, y el de volver atrás va primero,
 * porque en el caso corriente el número está mal.
 */
/**
 * Un cuadro de diálogo para preguntar algo que no cabe en un `confirm`.
 *
 * El `confirm` del navegador solo admite una línea de texto y un sí o un no.
 * Cuando hay que mostrar datos, avisos y un par de campos —crear una
 * credencial, revocarla— hace falta esto.
 *
 * Devuelve `null` si se canceló, y si se aceptó, lo que quedó escrito en los
 * campos, indexado por su id. Los valores se leen ANTES de sacar el diálogo
 * del documento: si el que llama intentara leerlos después de esperar la
 * respuesta, ya no encontraría nada —el nodo se fue— y recibiría un campo
 * vacío sin enterarse.
 *
 * Se usa `<dialog>` del propio navegador y no una caja inventada: trae gratis
 * el fondo, el foco atrapado adentro, el cierre con Escape y el papel de
 * diálogo para quien no ve la pantalla.
 */
function preguntarEnDialogo({ titulo, cuerpo, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise((resolver) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${esc(titulo)}</h3>
        <div class="dlg-cuerpo">${cuerpo}</div>
        <div class="dlg-pie">
          <button type="button" class="btn secondary" value="no" id="dlgNo">${esc(cancelar)}</button>
          <button type="button" class="btn${peligro ? ' peligro' : ''}" value="si" id="dlgSi">${esc(aceptar)}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);

    const cerrar = (acepto) => {
      let campos = null;
      if (acepto) {
        campos = {};
        dlg.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => {
          campos[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        });
      }
      dlg.close();
      dlg.remove();
      resolver(campos);
    };
    dlg.querySelector('#dlgNo').addEventListener('click', () => cerrar(false));
    dlg.querySelector('#dlgSi').addEventListener('click', () => cerrar(true));
    // Escape cuenta como cancelar
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(false); });
    dlg.showModal();
    const primero = dlg.querySelector('input, textarea, select');
    if (primero) primero.focus();
  });
}

function preguntarSiIgualVa(err, seguir, dondeVa = 'formError') {
  /*
   * Cada pregunta con su encabezado y sus botones.
   *
   * Estaba escrito «Revise este monto» y «Está bien, guardar así», que era lo
   * correcto para la única pregunta que existía —un egreso que deja la cuenta
   * en rojo— y quedó fijo. Al aparecer la segunda —desactivar una cuenta que
   * lleva solicitudes abiertas—, la pantalla decía «Revise este monto» sobre un
   * aviso que no habla de ningún monto. Lo que se pregunta lo dice el servidor
   * con `confirmar`; acá solo se le pone la cara que le corresponde.
   */
  const COMO_SE_PREGUNTA = {
    saldo_negativo: {
      titulo: '🔎 Revise este monto',
      volver: 'Volver y corregirlo',
      seguir: 'Está bien, guardar así',
    },
    movimiento_ya_anotado: {
      titulo: '💸 Puede que este movimiento ya esté anotado',
      volver: 'Volver y buscarlo',
      seguir: 'Son dos distintos, guardar',
    },
    traspaso_ya_anotado: {
      titulo: '🔁 Puede que este traspaso ya esté anotado',
      volver: 'Volver y buscarlo',
      seguir: 'Son dos distintos, guardar',
    },
    egreso_sin_respaldo: {
      titulo: '📎 Este egreso va sin su comprobante',
      volver: 'Volver y adjuntarlo',
      seguir: 'Guardar sin respaldo',
    },
    saldo_inicial_cambiado: {
      titulo: '🏦 Está moviendo el punto de partida de la cuenta',
      volver: 'Volver y dejarlo como estaba',
      seguir: 'El punto de partida era otro, guardar',
    },
    solicitudes_sin_responsable_activo: {
      titulo: '📨 Esta cuenta lleva solicitudes abiertas',
      volver: 'Volver y trasladarlas',
      seguir: 'Desactivarla igual',
    },
    miembro_con_el_mismo_nombre: {
      titulo: '🧍 Puede que esta persona ya esté registrada',
      volver: 'Volver y buscarla',
      seguir: 'Es otra persona, crear la ficha',
    },
    rut_de_un_miembro: {
      titulo: '🪪 Ese RUT ya está inscrito como miembro',
      volver: 'Volver y revisar el RUT',
      seguir: 'Guardar la ficha igual',
    },
    tipo_miembro_no_calza_con_la_edad: {
      titulo: '🎂 El tipo de miembro no calza con su edad',
      volver: 'Volver y corregirlo',
      seguir: 'Así corresponde, guardar',
    },
    traslado_sin_destino: {
      titulo: '📍 ¿A qué iglesia se traslada?',
      volver: 'Volver y anotarlo',
      seguir: 'No se sabe, guardar igual',
    },
    le_llega_a_muchos: {
      titulo: '📣 Le va a llegar a mucha gente',
      volver: 'Volver y acotar a quién',
      seguir: 'Sí, mandarlo',
    },
    el_servicio_duro_muchas_horas: {
      titulo: '🕐 Revise la hora',
      volver: 'Volver y corregirla',
      seguir: 'Duró eso, guardar',
    },
    servicio_ya_registrado_ese_dia: {
      titulo: '🕊️ Puede que este servicio ya esté registrado',
      volver: 'Volver y abrir el que está',
      seguir: 'Es otro servicio, guardar',
    },
    el_pasaje_no_calza_con_el_libro: {
      titulo: '📖 Revise el pasaje',
      volver: 'Volver y corregirlo',
      seguir: 'Está bien escrito, guardar',
    },
    fue_mucha_gente_al_servicio: {
      titulo: '🧍 Revise la asistencia',
      volver: 'Volver y corregirla',
      seguir: 'Fue esa gente, guardar',
    },
  };
  const como = COMO_SE_PREGUNTA[err.datos && err.datos.confirmar] || {
    titulo: '🔎 Revise esto antes de guardar',
    volver: 'Volver y corregirlo',
    seguir: 'Está bien, guardar así',
  };

  // Las pantallas hechas a mano tienen su propia caja de errores; la de los
  // formularios del motor es «formError», que es la de siempre
  /*
   * Y adónde ir, cuando la pregunta sabe dónde está lo que hay que mirar.
   *
   * «Abra la que ya existe» sin decir dónde obliga a salir, buscarla a mano y
   * volver a llenar el formulario; en la práctica nadie lo hace y se aprieta
   * «seguir», que es el único botón que hace algo. Con esto hay un botón que
   * lleva.
   *
   * Solo se acepta una dirección de este mismo sistema —las que empiezan por
   * «#/»—: la manda el servidor, pero un destino que se pone en un enlace se
   * revisa igual, porque el día que uno se arme con algo que escribió una
   * persona ya sería tarde para acordarse.
   */
  const ir = err.datos && err.datos.ir;
  const destino = ir && typeof ir.a === 'string' && ir.a.startsWith('#/') ? ir : null;

  const errEl = document.getElementById(dondeVa);
  errEl.innerHTML = `
    <div class="aviso confirmar">
      <b>${esc(como.titulo)}</b>
      <span>${esc(err.message)}</span>
      <div class="acciones">
        <button type="button" class="btn secondary" id="confVolver">${esc(como.volver)}</button>
        ${destino ? `<button type="button" class="btn secondary" id="confIr">${esc(destino.texto || 'Abrirla')}</button>` : ''}
        <button type="button" class="btn" id="confSeguir">${esc(como.seguir)}</button>
      </div>
    </div>`;
  errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('confVolver').addEventListener('click', () => {
    errEl.textContent = '';
  });
  const alDestino = document.getElementById('confIr');
  if (alDestino) alDestino.addEventListener('click', () => { location.hash = destino.a; });
  document.getElementById('confSeguir').addEventListener('click', () => {
    errEl.textContent = '';
    seguir();
  });
}

/** Se devuelve cuando la persona contesta que no a la segunda pregunta. */
const SE_ARREPINTIO = Symbol('se arrepintió');

/**
 * Borra un registro, y si el servidor pregunta algo, lo pregunta.
 *
 * Un gancho de borrado puede contestar con una PREGUNTA en vez de una negativa
 * —un objeto con `confirmar`, igual que al guardar—. Pasa cuando el borrado es
 * legítimo pero toca algo que conviene mirar: eliminar un traspaso se lleva sus
 * dos movimientos, y si una de las dos cuentas está cerrada eso le cambia el
 * saldo a una caja que la organización ya dio por terminada.
 *
 * Se pregunta en la misma caja del navegador que ya se usa para borrar, y no en
 * una ventana nueva a propósito: acá no hay un formulario donde poner el aviso
 * —se borra desde el listado— y sumarle una pantalla al camino de borrar es
 * cambiarle el paso a todos los módulos para el caso de uno.
 */
async function borrarPreguntando(ruta) {
  try {
    return await api('DELETE', ruta);
  } catch (err) {
    if (!(err.datos && err.datos.confirmar)) throw err;
    if (!confirm(`${err.message}\n\n¿Eliminarlo igual?`)) throw SE_ARREPINTIO;
    const junta = ruta.includes('?') ? '&' : '?';
    return api('DELETE', `${ruta}${junta}igual_asi=1`);
  }
}

/**
 * Avisos que encabezan la ficha de un miembro: su nota importante y, si es
 * menor de edad, la falta de su adulto responsable. Van arriba de todo para
 * que se vean sin buscarlos.
 */
/**
 * Lo que esta ficha tiene y esta persona no está viendo.
 *
 * Vale para cualquier módulo con datos reservados. Se dice en vez de callarlo:
 * una ficha sin teléfono y una ficha cuyo teléfono no se alcanza a ver se
 * parecen demasiado, y confundirlas hace que alguien salga a pedir un dato que
 * el sistema ya tiene.
 */
const LO_RESERVADO = {
  miembros_salud: ['🩺 Información médica reservada',
    'Esta ficha tiene datos de salud que su cuenta no alcanza a ver: los ve quien tenga ese permiso, y la propia persona en Mi perfil.'],
  miembros_contacto: ['📵 Datos de contacto reservados',
    'El teléfono, el correo y la dirección de esta ficha no se le están mostrando. Si necesita comunicarse con esta persona, pídalo en la oficina.'],
};

function avisoDeLoReservado(row, yaDichos) {
  const fuera = (row && row.reservado_oculto) || [];
  const avisos = fuera
    .filter((g) => LO_RESERVADO[g] && !(yaDichos || []).includes(g))
    .map((g) => `<div class="aviso"><b>${esc(LO_RESERVADO[g][0])}</b><span>${esc(LO_RESERVADO[g][1])}</span></div>`);
  if (!avisos.length) return;
  const tarjeta = content().querySelector('.card');
  if (tarjeta) tarjeta.insertAdjacentHTML('beforebegin', `<div class="avisos-ficha">${avisos.join('')}</div>`);
}

function avisosDelMiembro(row) {
  const avisos = [];
  if (row.nota_importante) {
    avisos.push(`<div class="aviso importante"><b>⚠️ Nota importante</b><span>${esc(row.nota_importante)}</span></div>`);
  }
  const anios = aniosDeFecha(row.fecha_nacimiento);
  // Sin NINGUNO de los dos: ni el adulto elegido de la membresía ni el nombre
  // escrito. Mirando solo el nombre, a todo menor con su adulto elegido se le
  // seguía avisando de que le faltaba.
  if (anios != null && anios < 18 && !row.responsable_nombre && !row.responsable_id) {
    avisos.push(
      `<div class="aviso"><b>👶 Menor de edad</b><span>Tiene ${anios} año${anios === 1 ? '' : 's'} y todavía no
       está registrado su adulto responsable. Complételo más abajo, en «Adulto responsable».</span></div>`
    );
  }
  if (row.enfermedades || row.alergias || row.indicaciones_medicas) {
    const partes = [
      row.enfermedades ? `Enfermedades: ${row.enfermedades}` : '',
      row.alergias ? `Alergias: ${row.alergias}` : '',
      row.indicaciones_medicas ? `Indicaciones: ${row.indicaciones_medicas}` : '',
    ].filter(Boolean);
    avisos.push(`<div class="aviso salud"><b>🩺 Información médica</b><span>${esc(partes.join(' · '))}</span></div>`);
  }
  if (row.salud_oculta) {
    // El servidor no le mandó los datos de salud a esta persona. Se dice, en
    // vez de dejar la ficha como si no hubiera nada: un espacio en blanco se
    // confunde con «no tiene ninguna alergia», y eso es peor que no decir nada.
    avisos.push(
      `<div class="aviso"><b>🔒 Información médica reservada</b><span>Esta ficha tiene datos de salud
       que su cuenta no alcanza a ver. Los ve quien tenga ese permiso —de fábrica, el pastor y el
       administrador— y la propia persona en Mi perfil.</span></div>`
    );
  }
  if (row.pareja_pendiente) {
    // Vincular el matrimonio de un pastor y registrarlo en Pastores / Guías
    // son dos actos distintos, y entre uno y otro pueden pasar meses. Guardar
    // la ficha ya no se bloquea por eso; se dice acá, que es donde alguien
    // puede hacer algo al respecto.
    avisos.push(
      `<div class="aviso"><b>💍 Pendiente con su cónyuge</b><span>${esc(row.pareja_pendiente)}</span></div>`
    );
  }
  if (!avisos.length) return;
  const tarjeta = content().querySelector('.card');
  if (tarjeta) tarjeta.insertAdjacentHTML('beforebegin', `<div class="avisos-ficha">${avisos.join('')}</div>`);
}

/**
 * Muestra u oculta los campos con condición showIf según el valor actual del
 * campo que los controla, y se mantiene atento a sus cambios.
 */
function aplicarCondiciones() {
  const form = document.getElementById('recForm');
  if (!form) return;
  const condicionales = form.querySelectorAll('[data-showif-field]');
  if (!condicionales.length) return;

  const evaluar = () => {
    condicionales.forEach((div) => {
      const control = form.querySelector(`[name="${div.dataset.showifField}"]`);
      const actual = control ? (control.type === 'checkbox' ? (control.checked ? '1' : '0') : control.value) : '';
      let visible;
      if (div.dataset.showifTipo === 'menorDe') {
        // Depende de la edad que da esa fecha, no del texto de la fecha
        const anios = aniosDeFecha(actual);
        visible = anios != null && anios < Number(div.dataset.showifValor);
      } else {
        visible = String(div.dataset.showifValor).split('|').includes(actual);
      }
      div.style.display = visible ? '' : 'none';

      /*
       * UN CAMPO QUE NO SE VE NO PUEDE SER OBLIGATORIO.
       *
       * Esconderlo con `display:none` no lo saca de la revisión que hace el
       * navegador antes de mandar el formulario: si sigue marcado obligatorio y
       * está vacío, el navegador intenta poner el cursor ahí, no puede, y no
       * manda nada. En la consola queda «An invalid form control with name=''
       * is not focusable» y en la pantalla, nada: el botón Guardar no hace
       * absolutamente nada y no hay ningún mensaje que explique por qué.
       *
       * Medido en Ayudas Sociales: registrar una ayuda a nombre de un NO
       * MIEMBRO era imposible desde el formulario. El campo «Miembro» —que es
       * obligatorio y se esconde al elegir «No miembro»— se dibuja como
       * buscador cuando hay más de veinte personas, o sea en cualquier iglesia
       * de verdad, y su casilla de texto se quedaba obligatoria. A nombre de un
       * miembro sí guardaba, porque el campo escondido de ese lado era un
       * desplegable corriente.
       *
       * Vale para cualquier campo con condición, no solo para esos dos.
       */
      div.querySelectorAll('input, select, textarea').forEach((control) => {
        if (!visible && control.required) {
          control.dataset.eraObligatorio = '1';
          control.required = false;
        } else if (visible && control.dataset.eraObligatorio) {
          control.required = true;
          delete control.dataset.eraObligatorio;
        }
      });
    });
    renumerarBloques();
  };

  const controles = new Set();
  condicionales.forEach((div) => controles.add(div.dataset.showifField));
  controles.forEach((nombre) => {
    const control = form.querySelector(`[name="${nombre}"]`);
    if (!control) return;
    control.addEventListener('change', evaluar);
    control.addEventListener('input', evaluar); // la fecha de nacimiento, al escribirla
  });
  evaluar();
}

/**
 * Los bloques se numeran por lo que se ve, no por lo que existe: si el de
 * «Adulto responsable» no aplica —porque el miembro es mayor de edad—, el
 * siguiente es el 2 y no el 3. Se vuelve a numerar cada vez que aparece o
 * desaparece uno.
 */
function renumerarBloques() {
  const form = document.getElementById('recForm');
  if (!form) return;
  let numero = 0;
  form.querySelectorAll('.form-bloque').forEach((caja) => {
    const marca = caja.querySelector(':scope > legend .nb');
    if (!marca) return;
    if (caja.style.display === 'none') return;
    marca.textContent = ++numero;
  });
}

/** Marca un control como de solo lectura (campos que se calculan solos). */
function marcarSoloLectura(html) {
  return html.replace(/<(input|textarea|select)\b/g, '<$1 readonly disabled data-solo-lectura="1"');
}

/**
 * Atributos con los que un campo dice de qué depende que se muestre. Los lee
 * aplicarCondiciones(). Hay dos formas:
 *   - por valor:  showIf { field, equals | in }
 *   - por edad:   showIf { field, menorDe }  (p. ej. los datos del adulto
 *     responsable, que solo aplican a los menores de 18 años)
 */
function condicionAttrs(f) {
  if (!f.showIf) return '';
  const valor = f.showIf.menorDe !== undefined
    ? f.showIf.menorDe
    : f.showIf.equals !== undefined ? f.showIf.equals : (f.showIf.in || []).join('|');
  const tipo = f.showIf.menorDe !== undefined ? ' data-showif-tipo="menorDe"' : '';
  return ` data-showif-field="${esc(f.showIf.field)}" data-showif-valor="${esc(valor)}"${tipo}`;
}

/**
 * El formulario, repartido en bloques numerados: cada campo que declara
 * `seccion` abre uno nuevo y los que le siguen quedan adentro. Así una ficha
 * larga se lee por partes —«3. Contacto»— en vez de ser una sola lista de
 * cuarenta casillas.
 *
 * Un módulo que no declara secciones se dibuja como siempre, sin cajas: no
 * tiene sentido encerrar seis campos en un cajón sin nombre.
 */
function formularioEnBloques(campos, row, isNew) {
  const bloques = [];
  for (const f of campos) {
    if (f.seccion || !bloques.length) bloques.push({ titulo: f.seccion || '', abre: f, campos: [] });
    bloques[bloques.length - 1].campos.push(f);
  }
  const sinTitulo = !bloques.some((b) => b.titulo);
  const grilla = (b) => `<div class="form-grid">${b.campos.map((f) => fieldHtml(f, row, isNew)).join('')}</div>`;
  if (sinTitulo) return bloques.map(grilla).join('');

  let numero = 0;
  const cajas = bloques.map((b) => {
    if (!b.titulo) return `<div class="form-bloque suelto">${grilla(b)}</div>`;
    numero++;
    // El bloque se muestra u oculta junto con el campo que lo abre
    return `
      <fieldset class="form-bloque"${condicionAttrs(b.abre)}>
        <legend><span class="nb">${numero}</span> ${esc(b.titulo)}</legend>
        ${grilla(b)}
      </fieldset>`;
  });
  return `<div class="form-bloques">${cajas.join('')}</div>`;
}

function fieldHtml(f, row, isNew) {
  const val = row[f.name] != null ? row[f.name] : isNew && f.default != null ? f.default : '';
  const req = f.required ? '<span class="req">*</span>' : '';
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  /*
   * Ancho completo: lo que de suyo ocupa toda la fila, y lo que el módulo pida
   * (un buscador de libros al lado de tres casillas de números queda apretado).
   *
   * Y `ancho: 'tercio'` para lo que se lee de un vistazo y va junto —el
   * capítulo y los dos versículos de una cita—: en el computador ya caían en la
   * misma fila, pero en el teléfono cada casilla se llevaba una fila entera y
   * tres números cortos ocupaban lo mismo que tres preguntas distintas.
   */
  const wide = f.ancho === 'completo' || ['textarea', 'richtext', 'multiref', 'permisos'].includes(f.type)
    ? ' full'
    : f.ancho === 'tercio' ? ' tercio' : '';
  let input = '';
  switch (f.type) {
    case 'textarea':
      input = `<textarea name="${f.name}">${esc(val)}</textarea>`;
      break;
    case 'richtext':
      // Se escribe con formato en una caja de verdad, y lo escrito viaja en un
      // campo oculto. El servidor vuelve a limpiarlo: acá no se confía nada.
      input = `
        <div class="rico" id="rico_${f.name}">
          <div class="rico-barra">
            <button type="button" data-cmd="bold" title="Negrita"><b>N</b></button>
            <button type="button" data-cmd="italic" title="Cursiva"><i>C</i></button>
            <button type="button" data-cmd="underline" title="Subrayado"><u>S</u></button>
            <span class="sep"></span>
            <button type="button" data-cmd="insertUnorderedList" title="Lista con viñetas">• Lista</button>
            <button type="button" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
            <span class="sep"></span>
            <button type="button" data-bloque="h3" title="Título">Título</button>
            <button type="button" data-bloque="p" title="Párrafo normal">Normal</button>
            <span class="sep"></span>
            <button type="button" data-cmd="removeFormat" title="Quitar el formato">Limpiar</button>
          </div>
          <div class="rico-hoja" contenteditable="true" id="ricoh_${f.name}"></div>
          <input type="hidden" name="${f.name}" value="${esc(val)}" />
        </div>`;
      break;
    case 'select': {
      const opciones = opcionesDe(f, row);
      const valores = opciones.map((o) => String(typeof o === 'object' ? o.value : o));

      // Con muchas opciones —los 66 libros de la Biblia— se ofrece un
      // desplegable con buscador en vez de una lista larguísima.
      if (usaBuscador(f, opciones)) {
        const etiqueta = val ? selectLabel(f, val) : '';
        input = `
          <div class="refbuscar selbuscar" id="sb_${f.name}">
            <input type="hidden" name="${f.name}" value="${esc(val)}" />
            <input type="text" class="rb-txt" autocomplete="off" spellcheck="false"
                   value="${esc(etiqueta)}" placeholder="Escriba para buscar…" ${f.required ? 'required' : ''} />
            <button type="button" class="rb-x" title="Quitar la selección" ${val ? '' : 'hidden'}>×</button>
            <ul class="rb-lista" hidden></ul>
          </div>`;
        break;
      }

      const opts = opciones.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
      });
      // Un valor guardado que ya no está en la lista (p. ej. un cargo de una
      // lista anterior) se agrega igual, para no cambiarlo sin querer.
      if (val && !valores.includes(String(val))) {
        opts.unshift(`<option value="${esc(val)}" selected>${esc(val)} (valor anterior)</option>`);
      }
      input = `<select name="${f.name}">${f.required ? '' : '<option value="">—</option>'}${opts.join('')}</select>`;
      break;
    }
    case 'ref': {
      const ruta = rutaOpciones(f, row);
      const lista = optionsCache[ruta] || [];
      const etiquetaActual = val
        ? (lista.find((o) => String(o.id) === String(val)) || {}).label || row[f.name + '_label'] || `#${val}`
        : '';

      // Con muchas opciones, en vez de una lista larguísima se ofrece un
      // buscador: se escribe parte del nombre, del apellido o del RUT.
      //
      // Lo que se escribe ahí no siempre es una persona. Una cuenta de
      // tesorería también pasa de veinte y su casilla decía «escriba el
      // nombre, el apellido o el RUT», que para una cuenta no quiere decir
      // nada. El campo puede traer el suyo.
      if (usaBuscador(f, lista)) {
        input = `
          <div class="refbuscar" id="rb_${f.name}" data-ruta="${esc(ruta)}">
            <input type="hidden" name="${f.name}" value="${esc(val)}" />
            <input type="text" class="rb-txt" autocomplete="off" spellcheck="false"
                   value="${esc(etiquetaActual)}"
                   placeholder="${esc(f.placeholder || 'Escriba el nombre, el apellido o el RUT…')}" ${f.required ? 'required' : ''} />
            <button type="button" class="rb-x" title="Quitar la selección" ${val ? '' : 'hidden'}>×</button>
            <ul class="rb-lista" hidden></ul>
          </div>`;
        break;
      }

      const dependeDe = camposDeLaRuta(f);
      const faltaElegir = dependeDe.length && dependeDe.some((c) => !row[c]);
      const opts = lista.map((o) => `<option value="${o.id}" ${String(val) === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`);
      // Si el valor guardado ya no figura en la lista (p. ej. quien era oficial
      // salió del cuerpo de oficiales), se agrega igual para no perderlo al guardar.
      if (val && !lista.some((o) => String(o.id) === String(val))) {
        opts.unshift(`<option value="${esc(val)}" selected>${esc(etiquetaActual)}</option>`);
      }
      const vacio = faltaElegir
        ? '— elija primero el cuerpo —'
        : lista.length ? '—' : '— sin opciones —';
      input = `<select name="${f.name}"><option value="">${esc(vacio)}</option>${opts.join('')}</select>`;
      break;
    }
    case 'multiref':
      input = `<div class="multiref" id="mr_${f.name}" data-name="${f.name}"></div>`;
      break;
    case 'boolean':
      return `<div class="fld check${wide}"${condicionAttrs(f)}><input type="checkbox" id="chk_${f.name}" name="${f.name}" ${val ? 'checked' : ''} /><label for="chk_${f.name}">${esc(f.label)}</label>${help}</div>`;
    case 'file': {
      // El control del navegador dice "Choose File" en inglés y no se puede
      // traducir: se esconde y se pone un botón propio que sí habla como el
      // resto del sistema.
      const esFoto = String(f.accept || '').startsWith('image');
      const hayFoto = val && /\.(jpe?g|png|webp)$/i.test(val);
      input = `
        <div class="filefld" id="ff_${f.name}">
          <input type="hidden" name="${f.name}" value="${esc(val)}" />
          <input type="file" id="file_${f.name}" class="oculto-de-verdad" ${f.accept ? `accept="${esc(f.accept)}"` : ''} />
          <label class="btn secondary sm" for="file_${f.name}">${esFoto ? '📷 Elegir foto' : '📎 Elegir archivo'}</label>
          ${f.recorte ? `<button type="button" class="btn secondary sm" id="ajustar_${f.name}" ${hayFoto ? '' : 'hidden'}>✂️ Ajustar</button>` : ''}
          <span class="fname" id="fname_${f.name}">${val
            ? `<a href="/uploads/${esc(val)}" target="_blank">📎 ${esc(nombreArchivo(val))}</a>`
            : '<span class="sin-archivo">Ningún archivo elegido</span>'}</span>
          ${val && /\.(jpe?g|png|gif|webp)$/i.test(val) ? `<img class="preview" src="/uploads/${esc(val)}" alt="" />` : ''}
        </div>`;
      break;
    }
    case 'password':
      input = `<input type="password" name="${f.name}" value="" autocomplete="new-password" ${f.required && isNew ? 'required' : ''} />`;
      break;
    case 'rut':
      input = `<input type="text" name="${f.name}" value="${esc(rutFormatear(val))}" placeholder="12.345.678-5" ${f.required ? 'required' : ''} />`;
      break;
    case 'persona': {
      // Se busca entre los registrados —y queda enlazado a su ficha— o se
      // escribe un nombre cualquiera, para quien no está en el registro.
      const enlace = row[f.name + '_id'] || '';
      // El aviso de "registrado / no registrado" va fuera de la caja del
      // buscador, para que el desplegable caiga justo bajo el campo.
      input = `
        <div class="refbuscar personafld" id="pf_${f.name}">
          <input type="hidden" name="${f.name}" value="${esc(val)}" />
          <input type="hidden" name="${f.name}_id" value="${esc(enlace)}" />
          <input type="text" class="rb-txt" autocomplete="off" spellcheck="false"
                 value="${esc(val)}" placeholder="Busque el nombre, o escríbalo si no está registrado"
                 ${f.required ? 'required' : ''} />
          <button type="button" class="rb-x" title="Vaciar" ${val ? '' : 'hidden'}>×</button>
          <ul class="rb-lista" hidden></ul>
        </div>
        <span class="persona-estado" id="pe_${f.name}"></span>`;
      break;
    }
    case 'permisos':
      input = `<div class="permisos-editor" id="perm_${f.name}"></div>`;
      break;
    case 'money':
    case 'number': {
      // Se escribe con los miles ya separados —113.130, no 113130— así que la
      // caja es de texto: la del navegador para números no deja ponerles
      // puntos. Al guardar se manda el número pelado.
      const escrito = val === '' || val == null ? '' : conMiles(String(val).replace('.', ','));
      const caja = `<input type="text" inputmode="decimal" class="numero" name="${f.name}"
             value="${esc(escrito)}" autocomplete="off" ${f.required ? 'required' : ''} />`;
      input = f.type === 'money'
        ? `<div class="conplata"><span class="signo">$</span>${caja}</div>`
        : caja;
      break;
    }
    case 'date': {
      // El calendario del navegador ya no ofrece lo que el servidor va a
      // rechazar: nada antes de 1900 y, salvo en los campos que admiten
      // futuro, nada después de hoy. Es un atajo, no la regla: quien mande
      // la petición a mano se topa igual con la comprobación del servidor.
      const tope = f.futuro ? '' : ` max="${hoyISO()}"`;
      input = `<input type="date" name="${f.name}" value="${esc(fechaISO(val))}" min="1900-01-01"${tope} ${f.required ? 'required' : ''} />`;
      break;
    }
    case 'time':
      input = `<input type="time" name="${f.name}" value="${esc(val)}" />`;
      break;
    case 'color': {
      /**
       * Un color se elige viéndolo, no escribiendo «#16265c».
       *
       * Van los dos controles juntos y atados: el cuadrito del navegador para
       * elegir, y la caja de texto para pegar el color exacto de la marca de
       * la iglesia, que es como llega cuando alguien lo trae de una imagen.
       * Vacío significa «el del sistema», y por eso hay un botón para volver
       * a dejarlo así: sin él, una vez tocado el cuadrito ya no habría manera
       * de deshacerlo.
       */
      const puesto = /^#[0-9a-f]{6}$/i.test(String(val || '')) ? String(val) : '';
      input = `
        <div class="colorcampo" data-name="${f.name}">
          <input type="color" class="cc-pico" value="${esc(puesto || f.porDefecto || '#16265c')}"
                 aria-label="Elegir el color de ${esc(f.label)}" />
          <input type="text" class="cc-texto" name="${f.name}" value="${esc(puesto)}"
                 aria-label="${esc(f.label)}, en código hexadecimal"
                 placeholder="${esc(f.porDefecto || 'del sistema')}" spellcheck="false" autocomplete="off" />
          <button type="button" class="cc-quitar" title="Dejar el color del sistema"
                  aria-label="Dejar el color del sistema en ${esc(f.label)}">Quitar</button>
        </div>`;
      break;
    }
    case 'email':
      input = `<input type="email" name="${f.name}" value="${esc(val)}" ${f.required ? 'required' : ''} />`;
      break;
    case 'tel':
      input = `<input type="tel" name="${f.name}" value="${esc(val)}" ${f.required ? 'required' : ''} />`;
      break;
    default:
      // Texto con sugerencias: se elige de la lista o se escribe otra cosa.
      // Así un parentesco puede quedar como "hija" o "nieta" sin forzarlo a
      // una lista cerrada, y lo que ya está guardado se ve tal cual.
      if (f.sugerencias && f.sugerencias.length) {
        input = `
          <input type="text" name="${f.name}" value="${esc(val)}" list="dl_${f.name}"
                 autocomplete="off" ${f.required ? 'required' : ''} />
          <datalist id="dl_${f.name}">${f.sugerencias.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>`;
        break;
      }
      input = `<input type="text" name="${f.name}" value="${esc(val)}" ${f.required ? 'required' : ''} />`;
  }
  if (f.readonly) input = marcarSoloLectura(input);
  const clases = `fld${wide}${f.readonly ? ' calculado' : ''}${f.destacado ? ' destacado' : ''}`;
  return `<div class="${clases}"${condicionAttrs(f)}><label>${esc(f.label)} ${req}</label>${input}${help}</div>`;
}

/** El texto de un campo con formato, sin las etiquetas. */
function textoPlano(html) {
  const caja = document.createElement('div');
  caja.innerHTML = String(html == null ? '' : html);
  return (caja.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Campo de texto con formato: negrita, cursiva, listas y títulos.
 *
 * Se escribe en una caja de verdad y lo escrito se copia a un campo oculto,
 * que es lo que viaja al guardar. El servidor lo vuelve a limpiar antes de
 * guardarlo (server/textorico.js): acá no se confía en nada de lo que llegue.
 */
/**
 * Ata el cuadrito de color con la caja de texto.
 *
 * Lo que se guarda es SIEMPRE la caja de texto —vacía quiere decir «el color
 * del sistema»—, y el cuadrito solo la escribe. Al revés no sirve: el control
 * del navegador no tiene estado «sin color», siempre devuelve uno, así que si
 * mandara él, abrir la ficha ya dejaría el color puesto sin que nadie lo
 * eligiera.
 */
function initColor(f) {
  const caja = document.querySelector(`.colorcampo[data-name="${f.name}"]`);
  if (!caja) return;
  const pico = caja.querySelector('.cc-pico');
  const texto = caja.querySelector('.cc-texto');
  const quitar = caja.querySelector('.cc-quitar');

  const alDia = () => {
    const puesto = /^#[0-9a-f]{6}$/i.test(texto.value.trim());
    if (puesto) pico.value = texto.value.trim().toLowerCase();
    quitar.hidden = !texto.value.trim();
  };

  pico.addEventListener('input', () => { texto.value = pico.value; alDia(); });
  texto.addEventListener('input', alDia);
  quitar.addEventListener('click', () => { texto.value = ''; alDia(); texto.focus(); });
  alDia();
}

function initTextoRico(f) {
  const caja = document.getElementById('rico_' + f.name);
  if (!caja) return;
  const hoja = caja.querySelector('.rico-hoja');
  const oculto = caja.querySelector('input[type=hidden]');

  hoja.innerHTML = oculto.value || '';
  if (!hoja.innerHTML.trim()) hoja.innerHTML = '<p><br></p>';

  const guardar = () => {
    const vacio = !hoja.textContent.trim() && !hoja.querySelector('img');
    oculto.value = vacio ? '' : hoja.innerHTML;
  };
  hoja.addEventListener('input', guardar);
  hoja.addEventListener('blur', guardar);

  // Al pegar desde Word o desde una página, entra solo el texto: el formato
  // ajeno trae estilos y etiquetas que no queremos guardar.
  hoja.addEventListener('paste', (e) => {
    e.preventDefault();
    const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, texto);
  });

  caja.querySelectorAll('.rico-barra button').forEach((boton) => {
    boton.addEventListener('mousedown', (e) => e.preventDefault());  // no perder el cursor
    boton.addEventListener('click', () => {
      hoja.focus();
      if (boton.dataset.bloque) document.execCommand('formatBlock', false, boton.dataset.bloque);
      else document.execCommand(boton.dataset.cmd, false, null);
      guardar();
    });
  });
}

/**
 * Un campo numérico se va separando en miles a medida que se escribe, sin que
 * el cursor se mueva de donde estaba: se cuenta cuántas cifras había antes de
 * él y se lo devuelve después de esas mismas cifras.
 */
function initNumero(f) {
  const el = document.querySelector(`#recForm [name="${f.name}"].numero`);
  if (!el || el.disabled) return;

  el.addEventListener('input', () => {
    const antes = el.value;
    const hasta = el.selectionStart == null ? antes.length : el.selectionStart;
    const cifrasAntes = antes.slice(0, hasta).replace(/[^\d,]/g, '').length;
    const despues = conMiles(antes);
    if (despues === antes) return;
    el.value = despues;
    let vistas = 0;
    let donde = 0;
    while (donde < despues.length && vistas < cifrasAntes) {
      if (/[\d,]/.test(despues[donde])) vistas++;
      donde++;
    }
    el.setSelectionRange(donde, donde);
  });

  // Al salir queda parejo, sin ceros ni comas sueltas, y se avisa en el acto
  // si el número no cabe donde va: mejor decirlo ahí que después de guardar.
  el.addEventListener('blur', () => {
    const n = numeroEscrito(el.value);
    el.value = n === null ? '' : conMiles(String(n).replace('.', ','));
    avisarSiNoCabe(f, el, n);
  });
  el.addEventListener('input', () => avisarSiNoCabe(f, el, numeroEscrito(el.value)));
}

/**
 * El aviso de que un número se pasa de lo que el campo admite.
 *
 * Es el mismo criterio que el servidor, dicho antes: el servidor lo vuelve a
 * comprobar igual —esto es una cortesía, no una defensa—, pero enterarse al
 * salir del campo es muy distinto que enterarse después de apretar Guardar.
 */
function avisarSiNoCabe(f, el, n) {
  const zona = el.closest('.fld') || el.parentElement;
  const previo = zona && zona.querySelector('.aviso-numero');
  if (previo) previo.remove();
  el.classList.remove('fuera-de-rango');
  if (n === null || n === undefined || !zona) return;

  let problema = null;
  if (f.min != null && n < f.min) {
    problema = f.min === 0
      ? 'No puede ser negativo.'
      : n <= 0
        ? (f.type === 'money' ? 'Tiene que ser mayor que cero. Si quiere restar, anótelo como egreso.' : 'Tiene que ser mayor que cero.')
        : `No puede ser menor que ${fmtNumero(f.min)}.`;
  } else if (f.max != null && n > f.max) {
    problema = `No puede pasar de ${fmtNumero(f.max)}.`;
  } else if (Math.abs(n) > 9999999999) {
    problema = 'Ese número es imposible. Revise si se le fue un dígito.';
  }
  if (!problema) return;

  el.classList.add('fuera-de-rango');
  const aviso = document.createElement('span');
  aviso.className = 'aviso-numero';
  aviso.textContent = problema;
  zona.appendChild(aviso);
}

/**
 * Motor común de los desplegables con buscador: una caja de texto que filtra
 * una lista al escribir, con teclado (flechas, Enter, Escape) y con el ratón.
 *
 * Lo usan el selector de opciones largas —los libros de la Biblia— y el campo
 * de persona. Cada uno le dice qué hacer al elegir y qué hacer al salir.
 */
function montarBuscador(caja, { opciones, alElegir, alSalir, alEscribir, etiqueta }) {
  const texto = caja.querySelector('.rb-txt');
  const quitar = caja.querySelector('.rb-x');
  const lista = caja.querySelector('.rb-lista');
  const MAXIMO = 40;
  let marcado = -1;

  const cerrar = () => { lista.hidden = true; marcado = -1; };

  const tomar = (elegida) => {
    if (!elegida) return;
    alElegir(elegida);
    texto.value = etiqueta(elegida);
    quitar.hidden = false;
    cerrar();
  };

  const pintar = (resultados) => {
    if (!resultados.length) {
      lista.innerHTML = '<li class="rb-vacio">Sin coincidencias</li>';
      lista.hidden = false;
      return;
    }
    lista.innerHTML = resultados
      .map((o, i) => `<li data-valor="${esc(o.valor)}" class="${i === marcado ? 'marcado' : ''}">${esc(etiqueta(o))}</li>`)
      .join('');
    lista.hidden = false;
    lista.querySelectorAll('li[data-valor]').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // antes del blur, para que no se cierre primero
        tomar(resultados.find((o) => String(o.valor) === li.dataset.valor));
      });
    });
  };

  const buscar = () => {
    const palabras = textoBuscable(texto.value).split(/\s+/).filter(Boolean);
    const resultados = (palabras.length
      ? opciones.filter((o) => palabras.every((p) => textoBuscable(o.buscar || etiqueta(o)).includes(p)))
      : opciones
    ).slice(0, MAXIMO);
    marcado = -1;
    pintar(resultados);
    return resultados;
  };

  // Al entrar al campo se despliega la lista entera y se marca lo escrito:
  // así se ve todo lo que hay, y escribir reemplaza lo que estaba.
  texto.addEventListener('focus', () => {
    texto.select();
    marcado = -1;
    pintar(opciones.slice(0, MAXIMO));
  });
  texto.addEventListener('input', () => {
    if (alEscribir) alEscribir(texto.value);
    quitar.hidden = !texto.value;
    buscar();
  });
  texto.addEventListener('keydown', (e) => {
    const items = [...lista.querySelectorAll('li[data-valor]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      marcado = e.key === 'ArrowDown' ? Math.min(items.length - 1, marcado + 1) : Math.max(0, marcado - 1);
      items.forEach((li, i) => li.classList.toggle('marcado', i === marcado));
      items[marcado].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!lista.hidden && items.length) {
        e.preventDefault();
        const li = items[marcado >= 0 ? marcado : 0];
        tomar(opciones.find((o) => String(o.valor) === li.dataset.valor));
      }
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });
  texto.addEventListener('blur', () => {
    setTimeout(() => {
      cerrar();
      if (alSalir) alSalir(texto);
    }, 140);
  });
  quitar.addEventListener('click', () => {
    texto.value = '';
    quitar.hidden = true;
    if (alEscribir) alEscribir('');
    texto.focus();
  });
}

/**
 * Selector de una lista larga —los 66 libros de la Biblia— como desplegable
 * con buscador: se escriben las primeras letras y aparece. Solo admite
 * valores de la lista.
 */
function initSelectBuscable(f) {
  const caja = document.getElementById('sb_' + f.name);
  if (!caja) return;
  const oculto = caja.querySelector('input[type=hidden]');
  const opciones = (f.options || []).map((o) => ({
    valor: String(typeof o === 'object' ? o.value : o),
    texto: String(typeof o === 'object' ? o.label : o),
  }));

  montarBuscador(caja, {
    opciones,
    etiqueta: (o) => o.texto,
    alElegir: (o) => {
      oculto.value = o.valor;
      oculto.dispatchEvent(new Event('change', { bubbles: true }));
    },
    alEscribir: () => {
      oculto.value = ''; // mientras se escribe, no hay nada elegido
    },
    alSalir: (texto) => {
      // Se restituye lo que esté elegido. Si lo guardado no figura en la
      // lista —viene de otro sistema o de una lista anterior—, se muestra tal
      // cual: el dato está, y borrarlo por no reconocerlo sería peor.
      const actual = opciones.find((o) => o.valor === oculto.value);
      texto.value = actual ? actual.texto : oculto.value || '';
      caja.querySelector('.rb-x').hidden = !oculto.value;
    },
  });
}

/**
 * Campo de persona: desplegable con buscador sobre los registros del módulo
 * referenciado, que además deja escribir cualquier nombre. Si se elige de la
 * lista queda enlazado a su ficha; si se escribe un nombre que no está, se
 * guarda tal cual, que es como se anota a un visitante o a un predicador
 * invitado.
 */
function initPersona(f) {
  const caja = document.getElementById('pf_' + f.name);
  if (!caja) return;
  const nombre = caja.querySelector(`input[name="${f.name}"]`);
  const enlace = caja.querySelector(`input[name="${f.name}_id"]`);
  const estado = document.getElementById('pe_' + f.name);
  const opciones = (optionsCache[rutaOpciones(f)] || []).map((o) => ({
    valor: String(o.id), texto: o.label, buscar: o.buscar || o.label,
  }));

  const revisar = () => {
    if (enlace.value) {
      estado.className = 'persona-estado enlazado';
      estado.textContent = '✓ registrado';
    } else {
      estado.className = 'persona-estado libre';
      estado.textContent = nombre.value.trim() ? 'no está en el registro' : '';
    }
  };

  montarBuscador(caja, {
    opciones,
    etiqueta: (o) => o.texto,
    alElegir: (o) => {
      nombre.value = o.texto;
      enlace.value = o.valor;
      revisar();
    },
    // Mientras se escribe no hay nadie elegido: vale lo escrito tal cual
    alEscribir: (valor) => {
      nombre.value = valor;
      enlace.value = '';
      revisar();
    },
    alSalir: () => revisar(),
  });
  revisar();
}

/**
 * Campos que se calculan solos (totales, porcentajes): se actualizan mientras
 * se escribe, con la misma regla que aplica el servidor al guardar.
 */
function initCalculados(m) {
  const form = document.getElementById('recForm');
  if (!form) return;
  const calculados = m.fields.filter((f) => f.calcula && !f.computed);
  if (!calculados.length) return;

  const num = (nombre) => {
    const el = form.querySelector(`[name="${nombre}"]`);
    return (el ? numeroEscrito(el.value) : null) || 0;
  };
  const redondear = (n) => Math.round(n * 100) / 100;

  const recalcular = () => {
    for (const f of calculados) {
      const c = f.calcula;
      let v = null;
      if (c.tipo === 'suma') v = redondear(c.campos.reduce((a, n) => a + num(n), 0));
      else if (c.tipo === 'resta') v = redondear(c.campos.reduce((a, n, i) => (i === 0 ? num(n) : a - num(n)), 0));
      else if (c.tipo === 'porcentaje') v = redondear((num(c.campo) * (Number(c.porcentaje) || 0)) / 100);
      const el = form.querySelector(`[name="${f.name}"]`);
      if (el && v !== null) el.value = el.classList.contains('numero') ? conMiles(String(v).replace('.', ',')) : v;
    }
  };

  const origenes = new Set();
  calculados.forEach((f) => (f.calcula.campos || [f.calcula.campo]).forEach((n) => origenes.add(n)));
  origenes.forEach((n) => {
    const el = form.querySelector(`[name="${n}"]`);
    if (el) el.addEventListener('input', recalcular);
  });
  recalcular();
}

/** Años (o meses, para los más pequeños) cumplidos a hoy. */
/** Años cumplidos que da una fecha, o null si no se puede saber. */
function aniosDeFecha(iso) {
  if (!iso) return null;
  const nace = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(nace.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nace.getFullYear();
  const dm = hoy.getMonth() - nace.getMonth();
  if (dm < 0 || (dm === 0 && hoy.getDate() < nace.getDate())) anios--;
  return anios >= 0 && anios <= 130 ? anios : null;
}

function edadDeFecha(iso) {
  if (!iso) return '';
  const nace = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(nace.getTime())) return '';
  const hoy = new Date();
  let anios = hoy.getFullYear() - nace.getFullYear();
  const dm = hoy.getMonth() - nace.getMonth();
  if (dm < 0 || (dm === 0 && hoy.getDate() < nace.getDate())) anios--;
  if (anios < 0 || anios > 130) return '';
  if (anios > 0) return `${anios} año${anios === 1 ? '' : 's'}`;
  let meses = (hoy.getFullYear() - nace.getFullYear()) * 12 + dm;
  if (hoy.getDate() < nace.getDate()) meses--;
  meses = Math.max(0, meses);
  return `${meses} mes${meses === 1 ? '' : 'es'}`;
}

/** Muestra la edad al lado de la fecha de nacimiento, mientras se escribe. */
function initEdad(f) {
  const form = document.getElementById('recForm');
  const campo = form && form.querySelector(`[name="${f.name}"]`);
  if (!campo) return;
  const marca = document.createElement('span');
  marca.className = 'edad-chip';
  campo.parentNode.insertBefore(marca, campo.nextSibling);
  const refrescar = () => {
    const edad = edadDeFecha(campo.value);
    marca.textContent = edad ? `🎂 ${edad}` : '';
    marca.style.display = edad ? '' : 'none';
  };
  campo.addEventListener('input', refrescar);
  campo.addEventListener('change', refrescar);
  refrescar();
}

/**
 * Selectores que dependen de otro campo: al cambiar ese campo se vuelven a
 * pedir sus opciones. Es lo que hace que los cargos de una directiva ofrezcan
 * solo a los integrantes del cuerpo elegido.
 */
function initSelectoresDependientes(m, row, isNew) {
  const form = document.getElementById('recForm');
  if (!form) return;
  const dependientes = m.fields.filter((f) => !f.computed && camposDeLaRuta(f).length);
  if (!dependientes.length) return;

  const fuentes = new Set();
  dependientes.forEach((f) => camposDeLaRuta(f).forEach((c) => fuentes.add(c)));

  const refrescar = async () => {
    const valores = valoresDelFormulario();
    for (const f of dependientes) {
      const ruta = rutaOpciones(f, valores);
      try {
        await getOptions(ruta);
      } catch (e) {
        optionsCache[ruta] = [];
      }
      // Se vuelve a dibujar el campo con la lista nueva. Si quien estaba
      // elegido ya no figura en ella, se suelta: no puede quedar un cargo en
      // alguien que no pertenece al cuerpo.
      const actual = (form.querySelector(`[name="${f.name}"]`) || {}).value || '';
      const sigueValiendo = (optionsCache[ruta] || []).some((o) => String(o.id) === String(actual));
      const fila = { ...valores, [f.name]: sigueValiendo ? actual : '' };
      const contenedor = form.querySelector(`.fld:has([name="${f.name}"])`);
      if (!contenedor) continue;
      const nuevo = document.createElement('div');
      nuevo.innerHTML = fieldHtml(f, fila, isNew);
      contenedor.replaceWith(nuevo.firstElementChild);
      if (f.type === 'ref') initRefBuscador(f, fila);
      if (f.type === 'select') initSelectBuscable(f);
    }
    aplicarCondiciones();
  };

  /*
   * Se escucha el FORMULARIO entero y no cada campo del que se depende.
   *
   * Cuando el módulo referenciado tiene muchas opciones —más de veinte
   * cuerpos, por ejemplo— el campo no es un desplegable sino un buscador: una
   * caja de texto visible más un campo oculto que lleva el nombre. Al elegir,
   * el aviso de «cambió» se dispara en la CAJA, no en el campo oculto, así que
   * escuchando el campo por su nombre no llegaba nunca y la lista dependiente
   * se quedaba con lo de antes, sin decir nada. Con pocas opciones —cuando sí
   * era un desplegable— funcionaba, que es lo que lo hacía difícil de ver.
   *
   * El aviso sube por el formulario, así que oyéndolo ahí se enteran los dos
   * casos.
   */
  form.addEventListener('change', (e) => {
    if (!e.target || !e.target.closest) return;
    const suyo = e.target.closest('.fld');
    if (!suyo) return;
    const nombres = [...suyo.querySelectorAll('[name]')].map((el) => el.name);
    if (nombres.some((n) => fuentes.has(n))) refrescar();
  });
}

/** Texto comparable: sin tildes, sin mayúsculas y sin puntos ni guiones. */
function textoBuscable(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.\-_]/g, '');
}

/**
 * ¿Este selector conviene mostrarlo como buscador? Cuando la lista es larga
 * —como los miembros de una iglesia— buscar es mucho más rápido que
 * desplegar cientos de opciones. Un campo puede pedirlo con `buscador: true`.
 */
function usaBuscador(f, lista) {
  if (f.buscador === false) return false;
  return f.buscador === true || (lista || []).length > 20;
}

/**
 * Selector con buscador: se escribe parte del nombre, del apellido o del RUT
 * y aparecen las coincidencias. Todas las palabras escritas tienen que
 * calzar, así "rosa diaz" o "13724" encuentran a la persona.
 */
function initRefBuscador(f, row) {
  const caja = document.getElementById('rb_' + f.name);
  if (!caja) return;
  const oculto = caja.querySelector('input[type=hidden]');
  const texto = caja.querySelector('.rb-txt');
  const quitar = caja.querySelector('.rb-x');
  const lista = caja.querySelector('.rb-lista');
  const opciones = optionsCache[caja.dataset.ruta] || [];
  const MAXIMO = 30;

  let marcado = -1;

  const cerrar = () => { lista.hidden = true; marcado = -1; };

  /*
   * El aviso de «cambió» va sobre el campo OCULTO, que es el que lleva el dato
   * y el nombre del campo.
   *
   * Iba sobre la caja de texto, que es su hermana. Quien escuchara al campo por
   * su nombre —`[name="cuenta_origen_id"]`— no se enteraba nunca: el aviso sube
   * por otra rama. Eso dejó sin funcionar el saldo de la cuenta de origen en el
   * formulario de traspaso: la función existe, consulta el saldo, lo pinta en
   * rojo si es negativo y hasta contempla a quien no alcanza la llave de los
   * montos, y su hueco estaba SIEMPRE VACÍO. Comprobado disparando el aviso a
   * mano sobre el campo oculto: apareció al instante.
   *
   * Ya había mordido antes: los selectores que dependen de otro campo tuvieron
   * que ponerse a escuchar el formulario entero en vez del campo, y su
   * comentario explica el rodeo. Se arregla donde estaba el problema, y ese
   * rodeo sigue funcionando igual porque el aviso pasa por los mismos padres.
   */
  const elegir = (o) => {
    oculto.value = o.id;
    texto.value = o.label;
    quitar.hidden = false;
    cerrar();
    oculto.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const pintar = (resultados) => {
    if (!resultados.length) {
      lista.innerHTML = '<li class="rb-vacio">Sin coincidencias</li>';
      lista.hidden = false;
      return;
    }
    lista.innerHTML = resultados
      .map((o, i) => `<li data-id="${o.id}" class="${i === marcado ? 'marcado' : ''}">${esc(o.label)}${
        o.detalle ? `<span class="rb-det">${esc(o.detalle)}</span>` : ''
      }</li>`)
      .join('');
    lista.hidden = false;
    lista.querySelectorAll('li[data-id]').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // antes del blur, para que no se cierre primero
        elegir(opciones.find((o) => String(o.id) === li.dataset.id));
      });
    });
  };

  const buscar = () => {
    const palabras = textoBuscable(texto.value).split(/\s+/).filter(Boolean);
    let resultados = opciones;
    if (palabras.length) {
      resultados = opciones.filter((o) => {
        const donde = textoBuscable(o.buscar || o.label);
        return palabras.every((p) => donde.includes(p));
      });
    }
    // Se muestra también el dato con el que se encontró (RUT, teléfono…)
    resultados = resultados.slice(0, MAXIMO).map((o) => {
      const resto = (o.buscar || '').slice(o.label.length).trim().split(/\s+/).slice(0, 2);
      // El RUT se muestra con sus puntos, como se lee habitualmente
      const detalle = resto.map((t) => (/^\d{7,8}-[\dkK]$/.test(t) ? rutFormatear(t) : t)).join(' · ');
      return { ...o, detalle };
    });
    marcado = -1;
    pintar(resultados);
  };

  texto.addEventListener('focus', buscar);
  texto.addEventListener('input', () => {
    oculto.value = ''; // mientras se escribe, no hay nadie elegido
    quitar.hidden = true;
    buscar();
  });
  texto.addEventListener('keydown', (e) => {
    const items = [...lista.querySelectorAll('li[data-id]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      marcado = e.key === 'ArrowDown'
        ? Math.min(items.length - 1, marcado + 1)
        : Math.max(0, marcado - 1);
      items.forEach((li, i) => li.classList.toggle('marcado', i === marcado));
      items[marcado].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!lista.hidden && items.length) {
        e.preventDefault();
        const li = items[marcado >= 0 ? marcado : 0];
        elegir(opciones.find((o) => String(o.id) === li.dataset.id));
      }
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });
  texto.addEventListener('blur', () => {
    setTimeout(() => {
      cerrar();
      // Si se escribió algo pero no se eligió a nadie, se limpia para no
      // dejar un nombre suelto que el sistema no reconoce.
      if (!oculto.value) texto.value = '';
    }, 120);
  });
  quitar.addEventListener('click', () => {
    oculto.value = '';
    texto.value = '';
    quitar.hidden = true;
    texto.focus();
    // Vaciarlo es un cambio como cualquier otro: sin avisar, lo que dependa de
    // este campo se queda mostrando lo del que ya no está elegido.
    oculto.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function initMultiref(f, row) {
  const box = document.getElementById('mr_' + f.name);
  if (!box) return;
  const selected = new Set((Array.isArray(row[f.name]) ? row[f.name] : []).map(Number));
  const options = optionsCache[rutaOpciones(f)] || [];
  box.innerHTML = `
    <input class="mr-search" type="search" placeholder="Buscar por nombre, apellido o RUT…" />
    <div class="mr-list"></div>
    <div class="mr-count"></div>`;
  const listEl = box.querySelector('.mr-list');
  const countEl = box.querySelector('.mr-count');
  const render = (filter) => {
    // Se busca igual que en el selector con buscador: por cualquier palabra,
    // sin distinguir tildes ni mayúsculas, y también por RUT o teléfono.
    const palabras = textoBuscable(filter).split(/\s+/).filter(Boolean);
    listEl.innerHTML = options
      .filter((o) => !palabras.length || palabras.every((p) => textoBuscable(o.buscar || o.label).includes(p)))
      .map((o) => `
        <label class="mr-item"><input type="checkbox" data-id="${o.id}" ${selected.has(o.id) ? 'checked' : ''} /> ${esc(o.label)}</label>`)
      .join('') || '<div class="mr-item" style="color:var(--muted)">Sin opciones</div>';
    listEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const oid = Number(cb.dataset.id);
        if (cb.checked) selected.add(oid);
        else selected.delete(oid);
        box.dataset.value = JSON.stringify([...selected]);
        countEl.textContent = `${selected.size} seleccionado(s)`;
      });
    });
  };
  box.dataset.value = JSON.stringify([...selected]);
  countEl.textContent = `${selected.size} seleccionado(s)`;
  render('');
  box.querySelector('.mr-search').addEventListener('input', (e) => render(e.target.value));
}

/** Nombre del archivo tal como lo subió el usuario, sin el prefijo interno. */
function nombreArchivo(guardado) {
  return String(guardado || '').replace(/^\d+-[0-9a-f]{6,}-/, '');
}

/** Tamaño legible: 1.2 MB, 340 KB… */
function tamanoLegible(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  /*
   * Lo que no llega a un kilo se dice en bytes.
   *
   * Redondeado a kilos, un acuerdo de dos líneas o una firma escaneada chica
   * salían como «0 KB», que se lee como que no se subió nada —y justo se acaba
   * de subir—. Se ve en el campo de archivo de cualquier ficha, en la ventana
   * de anotación y en el panel de espacio, que dice cuánto pesa en promedio
   * cada archivo subido.
   */
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return `${Math.round(bytes)} ${Math.round(bytes) === 1 ? 'byte' : 'bytes'}`;
}

/**
 * Reduce una foto antes de subirla: la deja con su lado mayor en el tamaño
 * configurado, conservando la proporción y el detalle a simple vista. Así una
 * foto de teléfono de varios MB sube en un instante, sin que se note.
 *
 * Si el archivo no es una imagen, o ya es pequeño, se sube tal cual.
 */
async function reducirImagen(file, ladoPedido) {
  if (!file.type.startsWith('image/') || /svg|gif/i.test(file.type)) return { file, reducida: false };
  const lado = Number(ladoPedido) || Number(AJUSTES.imagen_lado_maximo) || 1600;
  const calidad = (Number(AJUSTES.imagen_calidad) || 88) / 100;
  try {
    const bitmap = await createImageBitmap(file);
    const mayor = Math.max(bitmap.width, bitmap.height);
    const escala = mayor > lado ? lado / mayor : 1;
    // Si ya es chica y liviana, no se toca
    if (escala === 1 && file.size < 900 * 1024) {
      bitmap.close();
      return { file, reducida: false };
    }
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    /**
     * Una imagen con transparencia NO se pasa a JPEG.
     *
     * El JPEG no sabe de transparencia: para guardarla hay que rellenar lo
     * transparente con algo, y ese algo era blanco. En una foto da igual —una
     * foto no tiene agujeros—, pero acá se suben también el logo, el sello y la
     * firma de la credencial, y esos tres TIENEN que ser transparentes: el
     * sello va cruzado sobre la fotografía del titular y la firma sobre la
     * línea de firma. Con el fondo relleno, el sello tapaba media cara con un
     * cuadrado blanco y la firma salía dentro de un recuadro.
     *
     * Así que primero se mira si la imagen tiene algo transparente, y si lo
     * tiene se guarda como PNG. Pesa más, pero un logo pesa poco de todos
     * modos, y una foto —que es lo que de verdad hay que aligerar— nunca trae
     * transparencia y sigue yendo a JPEG como siempre.
     */
    let tieneTransparencia = false;
    try {
      const pixeles = ctx.getImageData(0, 0, ancho, alto).data;
      // De cuatro en cuatro píxeles: alcanza de sobra para saber si hay agujeros
      for (let i = 3; i < pixeles.length; i += 16) {
        if (pixeles[i] < 250) { tieneTransparencia = true; break; }
      }
    } catch (e) {
      // Si el navegador no deja leer los píxeles, se supone lo más cuidadoso
      tieneTransparencia = /png|webp/i.test(file.type);
    }

    if (!tieneTransparencia) {
      // Opaca: el fondo blanco no cambia nada y el JPEG pesa mucho menos
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, ancho, alto);
      ctx.globalCompositeOperation = 'source-over';
    }

    const formato = tieneTransparencia ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => lienzo.toBlob(res, formato, calidad));
    if (!blob || blob.size >= file.size) return { file, reducida: false };
    const nombre = file.name.replace(/\.[^.]+$/, '') + (tieneTransparencia ? '.png' : '.jpg');
    return {
      file: new File([blob], nombre, { type: formato }),
      reducida: true,
      antes: file.size, despues: blob.size, ancho, alto, transparente: tieneTransparencia,
    };
  } catch (e) {
    return { file, reducida: false }; // ante cualquier problema, se sube el original
  }
}

/**
 * Editor de fotos: recortar, girar y ajustar el brillo y el contraste antes
 * de guardar.
 *
 * Las fotos de perfil se muestran cuadradas en todo el sistema —redondas en
 * los cumpleaños, cuadradas en las fichas y en las credenciales—, así que el
 * recorte es cuadrado: lo que se ve en el marco es exactamente lo que va a
 * quedar guardado. Se arrastra para mover, se acerca con la rueda o con dos
 * dedos, y las dos barras corrigen una foto quemada o una tomada a oscuras.
 *
 * Devuelve el archivo listo para subir, o null si la persona se arrepiente.
 */
function ajustarImagen(fuente, { titulo = 'Ajustar la foto' } = {}) {
  return new Promise((resolver) => {
    const LADO = 320;                                    // el marco en pantalla
    const salida = Math.max(200, Number(AJUSTES.imagen_lado_maximo) || 1600);
    const calidad = (Number(AJUSTES.imagen_calidad) || 88) / 100;

    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `
      <div class="modal editor-foto" style="max-width:420px">
        <div class="modal-head"><h3>✂️ ${esc(titulo)}</h3><button class="cerrar" title="Cerrar" aria-label="Cerrar">&times;</button></div>
        <div class="modal-body">
          <div class="ef-marco"><canvas id="efLienzo" width="${LADO}" height="${LADO}"></canvas></div>
          <p class="ef-ayuda">Arrastre la foto para moverla y use la barra para acercarla. Lo que se ve en el marco es lo que queda guardado.</p>
          <label class="ef-barra"><span>Acercar</span><input type="range" id="efZoom" min="100" max="400" value="100" /></label>
          <label class="ef-barra"><span>Brillo</span><input type="range" id="efBrillo" min="-100" max="100" value="0" /></label>
          <label class="ef-barra"><span>Contraste</span><input type="range" id="efContraste" min="-100" max="100" value="0" /></label>
          <div class="ef-botones">
            <button class="btn secondary sm" id="efGirar">↻ Girar</button>
            <button class="btn secondary sm" id="efReiniciar">↺ Dejar como estaba</button>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn secondary" id="efCancelar">Cancelar</button>
          <button class="btn" id="efUsar" disabled>💾 Usar esta foto</button>
        </div>
      </div>`;
    document.body.appendChild(fondo);

    const lienzo = fondo.querySelector('#efLienzo');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    const zoom = fondo.querySelector('#efZoom');
    const brillo = fondo.querySelector('#efBrillo');
    const contraste = fondo.querySelector('#efContraste');
    let imagen = null;
    let giro = 0;
    let x = 0;
    let y = 0;
    let terminado = false;

    const cerrar = (resultado) => {
      if (terminado) return;
      terminado = true;
      fondo.remove();
      resolver(resultado);
    };

    /** El zoom que hace que la foto cubra el marco justo, sin bordes vacíos. */
    const escalaMinima = () => {
      const derecho = giro % 180 === 0;
      const ancho = derecho ? imagen.width : imagen.height;
      const alto = derecho ? imagen.height : imagen.width;
      return Math.max(LADO / ancho, LADO / alto);
    };
    const escalaActual = () => escalaMinima() * (Number(zoom.value) / 100);

    /** No se deja arrastrar la foto más allá de sus bordes */
    const encajar = () => {
      const e = escalaActual();
      const derecho = giro % 180 === 0;
      const ancho = (derecho ? imagen.width : imagen.height) * e;
      const alto = (derecho ? imagen.height : imagen.width) * e;
      const sobraX = Math.max(0, (ancho - LADO) / 2);
      const sobraY = Math.max(0, (alto - LADO) / 2);
      x = Math.min(sobraX, Math.max(-sobraX, x));
      y = Math.min(sobraY, Math.max(-sobraY, y));
    };

    /**
     * El brillo y el contraste se aplican píxel a píxel en vez de con el
     * filtro del lienzo: así se ve igual en cualquier navegador y lo que se
     * guarda es idéntico a lo que se vio.
     */
    const corregir = (contexto, ancho, alto) => {
      const b = Number(brillo.value);
      const c = Number(contraste.value);
      if (!b && !c) return;
      const datos = contexto.getImageData(0, 0, ancho, alto);
      const p = datos.data;
      const factor = (259 * (c * 2.55 + 255)) / (255 * (259 - c * 2.55));
      for (let i = 0; i < p.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          let v = p[i + k] + b;
          v = factor * (v - 128) + 128;
          p[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
      contexto.putImageData(datos, 0, 0);
    };

    const dibujarEn = (contexto, lado) => {
      const proporcion = lado / LADO;
      contexto.save();
      contexto.fillStyle = '#fff';           // el JPEG no tiene transparencia
      contexto.fillRect(0, 0, lado, lado);
      contexto.imageSmoothingEnabled = true;
      contexto.imageSmoothingQuality = 'high';
      contexto.translate(lado / 2 + x * proporcion, lado / 2 + y * proporcion);
      contexto.rotate((giro * Math.PI) / 180);
      const e = escalaActual() * proporcion;
      contexto.scale(e, e);
      contexto.drawImage(imagen, -imagen.width / 2, -imagen.height / 2);
      contexto.restore();
      corregir(contexto, lado, lado);
    };

    const pintar = () => {
      if (!imagen) return;
      encajar();
      dibujarEn(ctx, LADO);
    };

    // ---- mover con el dedo o con el ratón ----
    let arrastrando = false;
    let desdeX = 0;
    let desdeY = 0;
    let origenX = 0;
    let origenY = 0;
    const punto = (e) => (e.touches && e.touches[0] ? e.touches[0] : e);
    // En una pantalla angosta el marco se dibuja más chico de lo que mide por
    // dentro: el arrastre se convierte para que la foto siga al dedo.
    const razon = () => LADO / (lienzo.getBoundingClientRect().width || LADO);
    const tomar = (e) => {
      if (e.touches && e.touches.length > 1) return;
      arrastrando = true;
      desdeX = punto(e).clientX;
      desdeY = punto(e).clientY;
      origenX = x;
      origenY = y;
    };
    const mover = (e) => {
      if (!arrastrando) return;
      const r = razon();
      x = origenX + (punto(e).clientX - desdeX) * r;
      y = origenY + (punto(e).clientY - desdeY) * r;
      pintar();
      if (e.cancelable) e.preventDefault();
    };
    const soltar = () => { arrastrando = false; };
    lienzo.addEventListener('mousedown', tomar);
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    lienzo.addEventListener('touchstart', tomar, { passive: true });
    lienzo.addEventListener('touchmove', mover, { passive: false });
    lienzo.addEventListener('touchend', soltar);

    // ---- acercar con la rueda o con dos dedos ----
    lienzo.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom.value = Math.min(400, Math.max(100, Number(zoom.value) - Math.sign(e.deltaY) * 8));
      pintar();
    }, { passive: false });

    let separacion = 0;
    lienzo.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) separacion = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    lienzo.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !separacion) return;
      const ahora = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      zoom.value = Math.min(400, Math.max(100, Number(zoom.value) * (ahora / separacion)));
      separacion = ahora;
      pintar();
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    [zoom, brillo, contraste].forEach((b) => b.addEventListener('input', pintar));
    fondo.querySelector('#efGirar').addEventListener('click', () => {
      giro = (giro + 90) % 360;
      x = 0; y = 0;
      pintar();
    });
    fondo.querySelector('#efReiniciar').addEventListener('click', () => {
      giro = 0; x = 0; y = 0;
      zoom.value = 100; brillo.value = 0; contraste.value = 0;
      pintar();
    });

    fondo.querySelector('.cerrar').addEventListener('click', () => cerrar(null));
    fondo.querySelector('#efCancelar').addEventListener('click', () => cerrar(null));
    fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(null); });

    fondo.querySelector('#efUsar').addEventListener('click', async () => {
      // El recorte se dibuja de nuevo, en grande. Nunca con más resolución de
      // la que tiene el pedazo recortado: acercarse no inventa detalle.
      const cabe = Math.round(LADO / escalaActual());
      const lado = Math.max(200, Math.min(salida, cabe));
      const grande = document.createElement('canvas');
      grande.width = lado;
      grande.height = lado;
      dibujarEn(grande.getContext('2d', { willReadFrequently: true }), lado);
      const blob = await new Promise((res) => grande.toBlob(res, 'image/jpeg', calidad));
      if (!blob) return cerrar(null);
      cerrar(new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
    });

    // ---- se carga la foto ----
    (async () => {
      try {
        imagen = typeof fuente === 'string'
          ? await new Promise((ok, mal) => {
              const i = new Image();
              i.onload = () => ok(i);
              i.onerror = () => mal(new Error('No se pudo abrir la foto guardada'));
              i.src = fuente;
            })
          : await createImageBitmap(fuente);
        fondo.querySelector('#efUsar').disabled = false;
        pintar();
      } catch (e) {
        toast('No se pudo abrir la imagen', true);
        cerrar(null);
      }
    })();
  });
}

function initFileField(f) {
  const fileInput = document.getElementById('file_' + f.name);
  if (!fileInput) return;
  const caja = document.getElementById('ff_' + f.name);
  if (!caja) return;
  const nameEl = document.getElementById('fname_' + f.name);
  const hidden = caja.querySelector('input[type=hidden]');
  const botonAjustar = document.getElementById('ajustar_' + f.name);

  /** Deja el campo mostrando el archivo que quedó guardado. */
  const mostrar = (r, detalle) => {
    hidden.value = r.filename;
    nameEl.innerHTML = `<a href="${esc(r.url)}" target="_blank">📎 ${esc(r.original)}</a>${detalle || ''}`;
    const esImagen = /\.(jpe?g|png|webp)$/i.test(r.filename);
    if (esImagen) {
      let img = caja.querySelector('img.preview');
      if (!img) {
        img = document.createElement('img');
        img.className = 'preview';
        caja.appendChild(img);
      }
      img.src = r.url + '?v=' + Date.now();   // sin caché: la foto acaba de cambiar
    }
    if (botonAjustar) botonAjustar.hidden = !esImagen;
  };

  const subir = async (archivo, aviso) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    nameEl.textContent = 'Subiendo…';
    const r = await api('POST', '/upload', fd, true);
    mostrar(r, `<span class="fmeta">${tamanoLegible(archivo.size)}</span>`);
    toast(aviso);
    return r;
  };

  fileInput.addEventListener('change', async () => {
    const original = fileInput.files[0];
    if (!original) return;
    nameEl.textContent = original.type.startsWith('image/') ? 'Preparando la imagen…' : 'Subiendo…';
    try {
      const ajustada = await reducirImagen(original);
      const fd = new FormData();
      fd.append('archivo', ajustada.file);
      nameEl.textContent = 'Subiendo…';
      const r = await api('POST', '/upload', fd, true);
      const detalle = ajustada.reducida
        ? `<span class="fmeta">imagen ajustada a ${ajustada.ancho}×${ajustada.alto} — de ${tamanoLegible(ajustada.antes)} a ${tamanoLegible(ajustada.despues)}</span>`
        : `<span class="fmeta">${tamanoLegible(original.size)}</span>`;
      mostrar(r, detalle);
      toast(ajustada.reducida ? 'Imagen ajustada y subida' : 'Archivo subido');
    } catch (e) {
      nameEl.textContent = '';
      toast(e.message, true);
    }
  });

  // Recortar, girar y corregir el brillo y el contraste de la foto guardada
  if (!botonAjustar) return;
  botonAjustar.addEventListener('click', async () => {
    if (!hidden.value) return;
    const recortada = await ajustarImagen(`/uploads/${hidden.value}`, { titulo: `Ajustar: ${f.label}` });
    if (!recortada) return;
    try {
      await subir(recortada, 'Foto ajustada');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function collectForm(m) {
  const form = document.getElementById('recForm');
  const data = {};
  for (const f of m.fields) {
    if (f.computed) continue;
    if (f.type === 'multiref') {
      const box = document.getElementById('mr_' + f.name);
      data[f.name] = box ? JSON.parse(box.dataset.value || '[]') : [];
    } else if (f.type === 'permisos') {
      const box = document.getElementById('perm_' + f.name);
      let v = {};
      try { v = JSON.parse(box ? box.dataset.value || '{}' : '{}'); } catch (e) { v = {}; }
      data[f.name] = Object.keys(v).length ? v : null;
    } else if (f.type === 'boolean') {
      const el = form.querySelector(`[name="${f.name}"]`);
      data[f.name] = el && el.checked ? 1 : 0;
    } else {
      const el = form.querySelector(`[name="${f.name}"]`);
      if (!el) continue;
      if (f.type === 'password' && el.value === '') continue; // no cambiar contraseña
      if (f.type === 'money' || f.type === 'number') {
        // La caja muestra 113.130; lo que viaja es 113130
        const n = numeroEscrito(el.value);
        data[f.name] = n === null ? '' : n;
        continue;
      }
      data[f.name] = el.value;
      if (f.type === 'persona') {
        const enlace = form.querySelector(`[name="${f.name}_id"]`);
        data[f.name + '_id'] = enlace ? enlace.value : '';
      }
    }
  }
  return data;
}

/* ---------------- informes de asistencia ---------------- */
/**
 * Informes de asistencia: general, por cuerpo o por persona, con los
 * promedios de asistencia, inasistencia y justificación por día, por cuerpo y
 * por miembro. Se puede acotar por fechas e imprimir.
 */
/** Lo último que devolvió el informe, para poder bajarlo a una planilla. */
let INFORME = null;

async function renderInformeAsistencia(contenedor, precarga) {
  const st = {
    tipo: (precarga && precarga.tipo) || 'general',
    cuerpo_id: (precarga && precarga.cuerpo_id) || '',
    miembro_id: (precarga && precarga.miembro_id) || '',
    // El informe por persona también sirve para quien sirve en un grupo sin
    // estar inscrito: ese llega por el número del OTRO registro
    no_miembro_id: (precarga && precarga.no_miembro_id) || '',
    no_miembro_nombre: (precarga && precarga.no_miembro_nombre) || '',
    /*
     * Se abre en el AÑO EN CURSO, no en todo lo registrado.
     *
     * Este informe hace siete preguntas sobre la tabla de marcas de
     * asistencia, que es la que más crece del sistema: una fila por persona y
     * por actividad. Sin acotar, esas siete preguntas recorren todo lo que
     * haya. Medido con diez años de datos —124.812 marcas—: el informe entero
     * costaba 157 ms, y como el servidor atiende de a una cosa, esos 157 ms no
     * los pagaba solo quien lo pidió. Con cuatro personas pidiéndolo a la vez,
     * el panel de todos los demás pasaba de 19 ms a 105 ms, con puntas de 793.
     *
     * Acotado al año en curso, y con el índice por fecha que trajo la misma
     * versión (ver dateField en server/modules/asistencia_detalle.js), el
     * mismo informe baja a menos de un milisegundo.
     *
     * Nadie pierde nada: el rango sigue estando a la vista y editable, y hay
     * un botón que lo abre a todo lo registrado de un clic. Lo que cambia es
     * que la respuesta cara dejó de ser la que se da sin que nadie la pida.
     */
    // Si el enlace trae «desde» —aunque venga vacío, que significa «todo»— se
    // respeta; si no dice nada, se propone el año en curso.
    desde: precarga && precarga.desde !== undefined
      ? precarga.desde
      : `${new Date().getFullYear()}-01-01`,
    hasta: (precarga && precarga.hasta) || '',
    // La planilla mensual se pide por mes, no por un rango de fechas
    mes: (precarga && precarga.mes) || new Date().toISOString().slice(0, 7),
    /*
     * POR TIPO DE ACTIVIDAD. Vacío quiere decir todas.
     *
     * Se podía acotar por cuerpo, por persona y por período, pero no por tipo:
     * con doce tipos configurados no había manera de contestar «¿cómo anda la
     * asistencia al Estudio Bíblico?», que es justo la pregunta que hace que
     * valga la pena tener tipos.
     */
    actividad: (precarga && precarga.actividad) || '',
  };

  contenedor.innerHTML = `
    <!-- La caja de los filtros no se imprime, y la tarjeta que la envuelve
         tampoco: si queda en pie, aunque esté vacía, el navegador le reserva
         una hoja antes del informe. -->
    <div class="card no-print">
      <div class="toolbar" id="infFiltros"></div>
    </div>
    <div id="infResultado"><p style="padding:18px">Cargando…</p></div>`;

  await getOptions('cuerpos').catch(() => []);
  await getOptions('miembros').catch(() => []);
  const cuerpos = optionsCache['cuerpos'] || [];
  // Los tipos salen de donde los mantiene la iglesia, no de una lista escrita
  // acá: es la misma vía que usa el filtro del calendario
  const tiposDeActividad = await opcionesDelCampo('asistencias', 'tipo_reunion').catch(() => []);

  const filtros = contenedor.querySelector('#infFiltros');
  filtros.innerHTML = `
    <select id="infTipo" aria-label="Qué informe se quiere ver">
      <option value="general" ${st.tipo === 'general' ? 'selected' : ''}>Informe general</option>
      <option value="cuerpo" ${st.tipo === 'cuerpo' ? 'selected' : ''}>Informe por cuerpo</option>
      <option value="planilla" ${st.tipo === 'planilla' ? 'selected' : ''}>Planilla mensual</option>
      <option value="persona" ${st.tipo === 'persona' ? 'selected' : ''}>Informe por persona</option>
    </select>
    <select id="infCuerpo" aria-label="Cuerpo del que se quiere el informe"
            ${st.tipo === 'cuerpo' || st.tipo === 'planilla' ? '' : 'hidden'}>
      <option value="">— Elija el cuerpo —</option>
      ${cuerpos.map((c) => `<option value="${c.id}" ${String(st.cuerpo_id) === String(c.id) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
    </select>
    <span class="badge inf-no-inscrito" id="infNoInscrito" ${st.tipo === 'persona' && st.no_miembro_id ? '' : 'hidden'}>
      ${esc(st.no_miembro_nombre || 'Persona no inscrita')} (no inscrito)
      <button type="button" id="infNoInscritoX" aria-label="Quitar a esta persona del informe">×</button>
    </span>
    <div class="refbuscar inf-persona" id="rb_miembro_id" data-ruta="miembros"
         ${st.tipo === 'persona' && !st.no_miembro_id ? '' : 'hidden'}>
      <input type="hidden" name="miembro_id" value="${esc(st.miembro_id)}" />
      <input type="text" class="rb-txt" aria-label="Persona de la que se quiere el informe"
             placeholder="Busque a la persona por nombre o RUT…" autocomplete="off" />
      <button type="button" class="rb-x" title="Quitar" hidden>×</button>
      <ul class="rb-lista" hidden></ul>
    </div>
    <label class="range" id="infMesCaja" ${st.tipo === 'planilla' ? '' : 'hidden'}>Mes <input type="month" id="infMes" value="${esc(st.mes)}" /></label>
    <select id="infActividad" aria-label="Tipo de actividad" title="Ver solo un tipo de actividad"
            ${st.tipo === 'planilla' ? 'hidden' : ''}>
      <option value="">Todas las actividades</option>
      ${tiposDeActividad.map((t) => `<option value="${esc(t)}" ${st.actividad === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>
    <label class="range rango-fechas" ${st.tipo === 'planilla' ? 'hidden' : ''}>Desde <input type="date" id="infDesde" value="${esc(st.desde)}" /></label>
    <label class="range rango-fechas" ${st.tipo === 'planilla' ? 'hidden' : ''}>Hasta <input type="date" id="infHasta" value="${esc(st.hasta)}" /></label>
    <button type="button" class="btn secondary sm rango-fechas" id="infTodo"
            title="Quita el rango de fechas y toma todo lo que haya registrado"
            ${st.tipo === 'planilla' ? 'hidden' : ''}>Todo lo registrado</button>
    <span class="spacer"></span>
    <button class="btn sm" id="infVer">Ver informe</button>`;

  initRefBuscador({ name: 'miembro_id' }, {});

  const sincronizar = () => {
    st.tipo = document.getElementById('infTipo').value;
    // La planilla mensual también se pide por cuerpo, pero por mes y no por rango
    document.getElementById('infCuerpo').hidden = st.tipo !== 'cuerpo' && st.tipo !== 'planilla';
    document.getElementById('rb_miembro_id').hidden = st.tipo !== 'persona' || !!st.no_miembro_id;
    document.getElementById('infNoInscrito').hidden = st.tipo !== 'persona' || !st.no_miembro_id;
    document.getElementById('infMesCaja').hidden = st.tipo !== 'planilla';
    filtros.querySelectorAll('.rango-fechas').forEach((l) => { l.hidden = st.tipo === 'planilla'; });
    st.cuerpo_id = document.getElementById('infCuerpo').value;
    const elegido = document.querySelector('#rb_miembro_id input[type=hidden]').value;
    // Elegir a un miembro suelta a la persona no inscrita que se estuviera viendo
    if (elegido) { st.no_miembro_id = ''; st.no_miembro_nombre = ''; }
    st.miembro_id = elegido;
    st.desde = document.getElementById('infDesde').value;
    st.hasta = document.getElementById('infHasta').value;
    st.mes = document.getElementById('infMes').value;
    // La planilla mensual es de un cuerpo y un mes: el tipo no le aplica
    const porTipo = document.getElementById('infActividad');
    porTipo.hidden = st.tipo === 'planilla';
    st.actividad = st.tipo === 'planilla' ? '' : porTipo.value;
  };
  document.getElementById('infTipo').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infCuerpo').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('rb_miembro_id').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infNoInscritoX').addEventListener('click', () => {
    st.no_miembro_id = ''; st.no_miembro_nombre = '';
    sincronizar(); cargar();
  });
  document.getElementById('infActividad').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infDesde').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infHasta').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infMes').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infVer').addEventListener('click', () => { sincronizar(); cargar(); });
  // Abrir el informe a todo lo registrado: se vacían las dos fechas y se pide.
  // Es la respuesta cara, y por eso se da cuando alguien la pide.
  document.getElementById('infTodo').addEventListener('click', () => {
    document.getElementById('infDesde').value = '';
    document.getElementById('infHasta').value = '';
    sincronizar();
    cargar();
  });

  const pct = (n) => `${String(n).replace('.', ',')}%`;
  const aMedioPasar = (f) => (loQueFaltaMarcar(f)
    ? ` <span class="badge yellow" title="El porcentaje se reparte solo entre los ${f.total} ya marcados">${esc(loQueFaltaMarcar(f))}</span>`
    : '');
  const barra = (f) => `
    <div class="barra" title="${f.presentes} presentes, ${f.ausentes} ausentes, ${f.justificados} justificados">
      <span class="p" style="width:${f.pct_presente}%"></span>
      <span class="j" style="width:${f.pct_justificado}%"></span>
      <span class="a" style="width:${f.pct_ausente}%"></span>
    </div>`;

  const tabla = (titulo, filas, columna, verMas) => `
    <div class="card" style="margin-bottom:18px">
      <h3>${titulo}</h3>
      ${filas.length ? `
      <div style="overflow-x:auto">
      <!-- «grid-lista» es lo que hace que en el teléfono cada fila se dibuje
           como una tarjeta en vez de una tabla de ocho columnas: ver
           styles.css. Sin eso se veían tres columnas y las otras cinco —los
           tres porcentajes y el reparto, que es lo que se viene a mirar—
           quedaban seiscientos píxeles a la derecha, sin nada que lo dijera.
           En el computador la tabla es la misma de siempre. -->
      <table class="grid informe grid-lista">
        <thead><tr>
          <th>${columna}</th><th>Presentes</th><th>Ausentes</th><th>Justificados</th>
          <th>Asistencia</th><th>Inasistencia</th><th>Justificación</th><th class="no-sort">Reparto</th>
        </tr></thead>
        <tbody>
          ${filas.map((f) => `
            <tr ${verMas ? `data-ver="${verMas(f)}" style="cursor:pointer"` : ''}>
              <td class="col-primera col-titular" data-label="${esc(columna)}">${esc(f.etiqueta)}${aMedioPasar(f)}</td>
              <td class="num" data-label="Presentes">${esc(fmtNumero(f.presentes))}</td>
              <td class="num" data-label="Ausentes">${esc(fmtNumero(f.ausentes))}</td>
              <td class="num" data-label="Justificados">${esc(fmtNumero(f.justificados))}</td>
              <td data-label="Asistencia"><b>${pct(f.pct_presente)}</b></td>
              <td data-label="Inasistencia">${pct(f.pct_ausente)}</td>
              <td data-label="Justificación">${pct(f.pct_justificado)}</td>
              <td class="reparto" data-label="Reparto" style="min-width:140px">${barra(f)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty-state" style="padding:22px">Sin datos en este período.</div>'}
    </div>`;

  /**
   * La planilla mensual del cuerpo, tal como se llevaba en la hoja de cálculo.
   *
   * Una fila por integrante, una columna por día del mes, y en el cruce la
   * letra: S estuvo, J justificó, N faltó. En blanco los días sin reunión.
   * A la derecha, cómo le fue a cada uno; al pie, cómo estuvo cada día.
   *
   * Sale apaisada: treinta y un columnas no caben de otra forma en una hoja.
   */
  function pintarPlanilla(d) {
    const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const titulo = `REGISTRO DE ASISTENCIAS · ${d.cuerpo.nombre.toUpperCase()} · ${MESES[d.numeroDeMes - 1]} ${d.anio}`;
    const hubo = new Set(d.diasConReunion);
    const pct = (n) => `${n}%`;

    /** La celda de un día: con letra si hubo reunión, vacía si no. */
    const celda = (p, dia) => {
      if (!hubo.has(dia)) return '<td class="sin-reunion"></td>';
      const l = p.marcas[dia];
      return `<td class="marca ${l === 'S' ? 'si' : l === 'J' ? 'jus' : 'no'}">${l}</td>`;
    };

    /** Una fila del pie, con un número por día. */
    const pie = (etiqueta, clase, saca) => `
      <tr class="pie ${clase}">
        <td colspan="2">${esc(etiqueta)}</td>
        ${d.dias.map((dia) => hubo.has(dia)
          ? `<td>${esc(String(saca(d.porDia[dia])))}</td>`
          : '<td class="sin-reunion"></td>').join('')}
        <td colspan="7"></td>
      </tr>`;

    const sinNada = !d.integrantes.length
      ? '<div class="empty-state" style="padding:26px">Este cuerpo no tiene integrantes vigentes.</div>'
      : !d.diasConReunion.length
        ? '<div class="empty-state" style="padding:26px">No se pasó lista a este cuerpo en ese mes.</div>'
        : '';

    return `
      <div class="informe-hoja planilla-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit planilla-tit">${esc(titulo)}</h3>
        ${sinNada || `
        <div class="planilla-scroll">
        <table class="planilla-mes">
          <thead>
            <tr>
              <th class="col-n">N°</th>
              <th class="col-nombre">NOMBRE Y APELLIDOS</th>
              ${d.dias.map((dia) => `<th class="col-dia ${hubo.has(dia) ? '' : 'sin-reunion'}">${dia}</th>`).join('')}
              <th class="col-tot" title="Reuniones que hubo en el mes">T.</th>
              <th class="col-tot si" title="Veces que asistió">S</th>
              <th class="col-tot si">% S</th>
              <th class="col-tot jus" title="Veces que justificó">J</th>
              <th class="col-tot jus">% J</th>
              <th class="col-tot no" title="Veces que faltó">N</th>
              <th class="col-tot no">% N</th>
            </tr>
          </thead>
          <tbody>
            ${d.integrantes.map((p) => `
              <tr>
                <td class="col-n">${String(p.n).padStart(2, '0')}</td>
                <td class="col-nombre">${esc(`${p.trato ? p.trato + ' ' : ''}${p.nombre}`)}</td>
                ${d.dias.map((dia) => celda(p, dia)).join('')}
                <td class="col-tot">${p.total}</td>
                <td class="col-tot si">${p.presentes}</td>
                <td class="col-tot si">${pct(p.pct_presente)}</td>
                <td class="col-tot jus">${p.justificados}</td>
                <td class="col-tot jus">${pct(p.pct_justificado)}</td>
                <td class="col-tot no">${p.ausentes}</td>
                <td class="col-tot no">${pct(p.pct_ausente)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            ${pie('TOTAL INTEGRANTES', '', (x) => x.integrantes)}
            ${pie('TOTAL ASISTENCIA', 'si', (x) => x.presentes)}
            ${pie('PORCENTAJE ASISTENCIA', 'si', (x) => pct(x.pct_presente))}
            ${pie('TOTAL JUSTIFICADOS', 'jus', (x) => x.justificados)}
            ${pie('PORCENTAJE JUSTIFICACIÓN', 'jus', (x) => pct(x.pct_justificado))}
            ${pie('TOTAL INASISTENCIA', 'no', (x) => x.ausentes)}
            ${pie('PORCENTAJE INASISTENCIA', 'no', (x) => pct(x.pct_ausente))}
          </tfoot>
        </table>
        </div>`}
        <div class="informe-pie mut">
          ${pieDelDocumento()} ·
          <b>S</b> asistió · <b>J</b> justificó · <b>N</b> faltó · en blanco, ese día no hubo reunión del cuerpo.<br>
          Salen los integrantes vigentes del cuerpo —activos y en período de prueba—. Un día en que hubo dos
          actividades del cuerpo cuenta como una sola columna, con lo mejor de las dos.
        </div>
      </div>`;
  }

  async function cargar() {
    const caja = contenedor.querySelector('#infResultado');
    if (st.tipo === 'planilla') {
      if (!st.cuerpo_id) {
        caja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Elija un cuerpo para ver su planilla.</div></div>';
        return;
      }
      caja.innerHTML = '<p style="padding:18px">Armando la planilla…</p>';
      let pl;
      try {
        pl = await api('GET', `/asistencias/hoja-mensual?cuerpo_id=${encodeURIComponent(st.cuerpo_id)}&mes=${encodeURIComponent(st.mes)}`);
      } catch (e) {
        caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
        return;
      }
      INFORME = { planilla: pl, titulo: `Planilla mensual — ${pl.cuerpo.nombre}`, periodo: pl.mes };
      caja.innerHTML = pintarPlanilla(pl);
      return;
    }
    if (st.tipo === 'cuerpo' && !st.cuerpo_id) {
      caja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Elija un cuerpo para ver su informe.</div></div>';
      return;
    }
    if (st.tipo === 'persona' && !st.miembro_id && !st.no_miembro_id) {
      caja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Busque a la persona para ver su informe.</div></div>';
      return;
    }
    caja.innerHTML = '<p style="padding:18px">Calculando…</p>';
    const params = new URLSearchParams({ tipo: st.tipo });
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    // `tipo` ya es QUÉ informe se pide; el tipo de actividad va por su nombre
    if (st.actividad) params.set('tipo_actividad', st.actividad);
    if (st.tipo === 'cuerpo' && st.cuerpo_id) params.set('cuerpo_id', st.cuerpo_id);
    if (st.tipo === 'persona' && st.no_miembro_id) params.set('no_miembro_id', st.no_miembro_id);
    else if (st.tipo === 'persona' && st.miembro_id) params.set('miembro_id', st.miembro_id);

    let d;
    try {
      d = await api('GET', '/asistencias/informe?' + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }

    /*
     * Un informe acotado que no lo dice se lee como si fuera el de todo —y se
     * imprime igual—, así que el tipo va junto al período, que es donde el ojo
     * ya busca de qué es este informe.
     */
    const soloDe = d.tipo_actividad ? `solo «${d.tipo_actividad}», ` : '';
    const periodo = d.desde || d.hasta
      ? `${soloDe}del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : `${soloDe}de todo lo registrado`;
    const g = d.general;

    const resumen = `
      <div class="stats informe-stats">
        <div class="stat"><div class="ic">📋</div><div class="num">${esc(fmtNumero(g.actividades))}</div><div class="lbl">Actividades</div></div>
        <div class="stat"><div class="ic">🧍</div><div class="num">${esc(fmtNumero(g.personas))}</div><div class="lbl">Personas</div></div>
        <div class="stat"><div class="ic">✅</div><div class="num">${pct(g.pct_presente)}</div><div class="lbl">Promedio de asistencia</div></div>
        <div class="stat"><div class="ic">❌</div><div class="num">${pct(g.pct_ausente)}</div><div class="lbl">Promedio de inasistencia</div></div>
        <div class="stat"><div class="ic">📝</div><div class="num">${pct(g.pct_justificado)}</div><div class="lbl">Promedio de justificación</div></div>
      </div>`;

    const motivos = d.porMotivo.length ? `
      <div class="card" style="margin-bottom:18px">
        <h3>Motivos de las justificaciones</h3>
        <ul class="mini-list">
          ${d.porMotivo.map((m) => `<li><span>${esc(m.motivo)}</span><span class="mut">${esc(fmtNumero(m.n))} vez(ces)</span></li>`).join('')}
        </ul>
      </div>` : '';

    const conEtiqueta = (arr, campo) => arr.map((f) => ({ ...f, etiqueta: f[campo] || '—' }));

    let cuerpoTexto = '';
    if (st.tipo === 'cuerpo') cuerpoTexto = (d.porCuerpo[0] || {}).cuerpo || '';
    if (st.tipo === 'persona') cuerpoTexto = (d.porMiembro[0] || {}).miembro || '';

    // Lo que se está viendo, por si se quiere bajar a una planilla
    INFORME = {
      datos: d, periodo,
      titulo: st.tipo === 'general' ? 'General'
        : st.tipo === 'cuerpo' ? `Por cuerpo — ${cuerpoTexto}` : `Por persona — ${cuerpoTexto}`,
    };

    caja.innerHTML = `
      <div class="informe-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="informe-tit">
          ${st.tipo === 'general' ? 'Informe general de asistencia'
            : st.tipo === 'cuerpo' ? `Informe de asistencia — ${esc(cuerpoTexto)}`
            : `Informe de asistencia — ${esc(cuerpoTexto)}`}
          <span class="mut">${esc(periodo)}</span>
        </h3>
        ${resumen}
        ${st.tipo === 'persona' ? `
          ${d.porMiembroCuerpo.length > 1
            ? tabla('Su asistencia en cada cuerpo', conEtiqueta(d.porMiembroCuerpo, 'cuerpo'), 'Cuerpo / Grupo')
            : ''}
          ${tabla('Actividad por actividad', d.porActividad.map((x) => ({
              ...x, etiqueta: `${fechaCorta(x.fecha)} · ${x.actividad || ''}`,
            })), 'Actividad')}
          ${tabla('Promedio por día', conEtiqueta(d.porDia.map((x) => ({
              ...x, fecha: `${fechaCorta(x.fecha)}${x.actividades > 1 ? ` (${x.actividades} actividades)` : ''}`,
            })), 'fecha'), 'Fecha')}
          <div class="card" style="margin-bottom:18px">
            <h3>Detalle de sus marcas</h3>
            <div style="overflow-x:auto">
            <table class="grid informe">
              <thead><tr><th>Fecha</th><th>Cuerpo</th><th>Actividad</th><th>Estado</th><th>Motivo</th><th>Detalle</th></tr></thead>
              <tbody>
                ${d.marcas.map((m) => `
                  <tr>
                    <td>${fechaCorta(m.fecha)}</td><td>${esc(m.cuerpo || '')}</td><td>${esc(m.actividad || '')}</td>
                    <td><span class="badge ${m.estado === 'Presente' ? 'green' : m.estado === 'Ausente' ? 'red' : 'blue'}">${esc(m.estado)}</span></td>
                    <td>${esc(m.motivo || '')}</td><td>${esc(m.detalle || '')}</td>
                  </tr>`).join('')}
              </tbody>
            </table></div>
          </div>
          ${motivos}`
        : `
          ${tabla('Promedio por cuerpo', conEtiqueta(d.porCuerpo, 'cuerpo'), 'Cuerpo / Grupo')}
          ${tabla('Promedio por día', conEtiqueta(d.porDia.map((x) => ({
              ...x, fecha: `${fechaCorta(x.fecha)}${x.actividades > 1 ? ` (${x.actividades} actividades)` : ''}`,
            })), 'fecha'), 'Fecha')}
          ${tabla('Actividad por actividad', d.porActividad.map((x) => ({
              ...x, etiqueta: `${fechaCorta(x.fecha)} · ${x.actividad || ''}`,
            })), 'Actividad')}
          ${tabla('Promedio por persona', conEtiqueta(d.porMiembro.map((f) => ({
              ...f,
              miembro: f.persona_tipo === 'No miembro' ? `${f.miembro} (no inscrito)` : f.miembro,
            })), 'miembro'), 'Persona',
            // Con la letra del registro: el miembro n.º 7 y el no miembro n.º 7
            // son dos personas, y sin ella el informe abría la de otra
            (f) => (f.no_miembro_id ? `n${f.no_miembro_id}` : `m${f.miembro_id}`))}
          ${motivos}`}
        <div class="informe-pie mut">
          ${pieDelDocumento()} · Verde: presentes · Azul: justificados · Rojo: ausentes.<br>
          Cada actividad cuenta por separado: quien pertenece a varios cuerpos tiene una marca en cada actividad a la que
          fue convocado, y en el promedio de cada cuerpo cuenta solo lo de ese cuerpo.
        </div>
      </div>`;

    // Desde el promedio por persona se salta a su informe personal
    caja.querySelectorAll('tr[data-ver]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const quien = String(tr.dataset.ver || '');
        const numero = quien.slice(1);
        renderInformeAsistencia(contenedor, {
          tipo: 'persona',
          miembro_id: quien[0] === 'n' ? '' : numero,
          no_miembro_id: quien[0] === 'n' ? numero : '',
          no_miembro_nombre: quien[0] === 'n' ? (tr.querySelector('td') || {}).textContent || '' : '',
          desde: st.desde, hasta: st.hasta,
        });
      });
    });
  }

  cargar();
}

/**
 * Baja el informe que se está viendo como planilla (CSV, que Excel abre sin
 * más). Se arma con lo mismo que muestra la pantalla, para que cuadre.
 */
/*
 * CUANDO LA LISTA QUEDÓ A MEDIO PASAR, SE DICE.
 *
 * Los porcentajes de este informe se reparten entre los MARCADOS, que para el
 * promedio de un período es lo que corresponde. En la fila de UNA actividad
 * no: una lista con una marca de cuarenta y nueve salía «100 %», y ese número
 * no describe nada de lo que pasó en esa reunión. Medido.
 *
 * El servidor manda ahora a cuánta gente se convocó, y con eso la fila puede
 * decirlo. El porcentaje se deja donde está —quitarlo cambiaría el significado
 * de todas las demás filas—; lo que se agrega es con qué compararlo.
 *
 * Vive acá afuera porque lo usan la pantalla y la planilla que se baja, y
 * tienen que decir lo mismo.
 */
function loQueFaltaMarcar(f) {
  if (!f || !f.convocados || !(f.total < f.convocados)) return '';
  return `${fmtNumero(f.total)} de ${fmtNumero(f.convocados)} marcados`;
}

function exportarInformeCSV() {
  if (!INFORME) return toast('Primero vea un informe.', true);
  if (INFORME.planilla) return exportarPlanillaCSV(INFORME.planilla);
  const d = INFORME.datos;
  const comilla = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  // En Chile el decimal se escribe con coma; el separador de columnas es «;»,
  // así que la coma decimal no confunde a nadie y el número puede ir pelado.
  // Entre comillas la planilla puede tomarlo por texto y ahí no se promedia.
  const numero = (v) => String(v).replace('.', ',');
  const lineas = [];
  const bloque = (titulo, columna, filas, campo) => {
    if (!filas.length) return;
    lineas.push([comilla(titulo)].join(';'));
    lineas.push([columna, 'Presentes', 'Ausentes', 'Justificados', '% asistencia', '% inasistencia', '% justificación'].map(comilla).join(';'));
    filas.forEach((f) => lineas.push([
      comilla(campo(f)), f.presentes, f.ausentes, f.justificados,
      numero(f.pct_presente), numero(f.pct_ausente), numero(f.pct_justificado),
    ].join(';')));
    lineas.push('');
  };

  lineas.push([comilla('Informe de asistencia'), comilla(INFORME.titulo)].join(';'));
  lineas.push([comilla('Institución'), comilla(IGLESIA.nombre)].join(';'));
  lineas.push([comilla('Período'), comilla(INFORME.periodo)].join(';'));
  lineas.push([comilla(''), comilla(pieDelDocumentoEnPlano())].join(';'));
  lineas.push('');
  bloque('Resumen general', 'Total', [d.general], () => 'Todo');
  bloque('Por cuerpo', 'Cuerpo / Grupo', d.porCuerpo, (f) => f.cuerpo || '—');
  bloque('Por día', 'Fecha', d.porDia, (f) => f.fecha);
  bloque('Actividad por actividad', 'Actividad', d.porActividad, (f) => {
    const nombre = `${f.fecha} ${f.actividad || ''}`.trim();
    const falta = loQueFaltaMarcar(f);
    return falta ? `${nombre} (${falta})` : nombre;
  });
  bloque('Por miembro', 'Miembro', d.porMiembro, (f) => f.miembro || '—');
  if (d.porMotivo && d.porMotivo.length) {
    lineas.push([comilla('Motivos de las justificaciones')].join(';'));
    lineas.push([comilla('Motivo'), comilla('Veces')].join(';'));
    d.porMotivo.forEach((m) => lineas.push([comilla(m.motivo), m.n].join(';')));
  }

  // El BOM hace que Excel reconozca las tildes
  const blob = new Blob(['\ufeff' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `asistencia-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  toast('Planilla descargada');
}

/**
 * Baja la planilla mensual con la misma forma que tiene en pantalla: una
 * columna por día, los totales de cada persona a la derecha y los del día
 * abajo. Se abre en Excel y se puede seguir trabajando ahí, que es de donde
 * venía esta planilla.
 */
function exportarPlanillaCSV(pl) {
  const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const comilla = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const hubo = new Set(pl.diasConReunion);
  const lineas = [];

  /*
   * LA REGLA, EN TODA LA PLANILLA: el texto va entre comillas y los números
   * van pelados. Antes no era así y el mismo dato se escribía de dos maneras
   * en el mismo archivo —los conteos del cuerpo iban como número («2») y los
   * del pie como texto («"32"»)—, así que una planilla podía sumar una fila y
   * no la otra sin que nadie entendiera por qué.
   *
   * Y los porcentajes salen sin el signo. Un «41%» es un valor ya formateado:
   * si la planilla lo toma como texto, no se promedia ni se grafica, y si lo
   * toma como número depende de la versión y del idioma. Mandando el número
   * pelado no queda ninguna duda, y el encabezado ya dice que es un porcentaje.
   */
  lineas.push([comilla(`REGISTRO DE ASISTENCIAS · ${pl.cuerpo.nombre.toUpperCase()} · ${MESES[pl.numeroDeMes - 1]} ${pl.anio}`)].join(';'));
  lineas.push([comilla(IGLESIA.nombre)].join(';'));
  lineas.push([comilla(pieDelDocumentoEnPlano())].join(';'));
  lineas.push('');
  lineas.push(['N°', 'NOMBRE Y APELLIDOS', ...pl.dias, 'T.', 'S', '% S', 'J', '% J', 'N', '% N'].map(comilla).join(';'));

  for (const p of pl.integrantes) {
    lineas.push([
      comilla(String(p.n).padStart(2, '0')),
      comilla(`${p.trato ? p.trato + ' ' : ''}${p.nombre}`),
      ...pl.dias.map((dia) => comilla(hubo.has(dia) ? p.marcas[dia] : '')),
      p.total, p.presentes, p.pct_presente,
      p.justificados, p.pct_justificado,
      p.ausentes, p.pct_ausente,
    ].join(';'));
  }

  const pie = (etiqueta, saca) => lineas.push([
    comilla(''), comilla(etiqueta),
    ...pl.dias.map((dia) => (hubo.has(dia) ? saca(pl.porDia[dia]) : '')),
  ].join(';'));
  lineas.push('');
  pie('TOTAL INTEGRANTES', (x) => x.integrantes);
  pie('TOTAL ASISTENCIA', (x) => x.presentes);
  pie('PORCENTAJE ASISTENCIA', (x) => x.pct_presente);
  pie('TOTAL JUSTIFICADOS', (x) => x.justificados);
  pie('PORCENTAJE JUSTIFICACIÓN', (x) => x.pct_justificado);
  pie('TOTAL INASISTENCIA', (x) => x.ausentes);
  pie('PORCENTAJE INASISTENCIA', (x) => x.pct_ausente);

  // El BOM hace que Excel reconozca las tildes
  const blob = new Blob(['\ufeff' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `asistencia-${pl.cuerpo.nombre.replace(/[^\w]+/g, '-').toLowerCase()}-${pl.mes}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  toast('Planilla descargada');
}

/* ---------------- vistas de impresión ---------------- */
async function viewPrint(name, id) {
  const m = MOD[name];
  let row;
  try {
    row = await api('GET', `/${name}/${id}`);
  } catch (e) {
    content().innerHTML = `<p>${esc(e.message)}</p>`;
    return;
  }
  // La credencial pastoral no se arma con la fila a secas: necesita el código
  // QR, que se firma en el servidor, y los recursos institucionales.
  if (name === 'credenciales') return viewImprimirCredencial(id);

  /*
   * El acta que enlazó su asistencia se imprime CON la lista de ese día. Es lo
   * que hace que el enlace sirva de algo: un acta que se firma tiene que decir
   * quiénes estuvieron, y hasta acá eso vivía solo en la pantalla.
   */
  let asistenciaDelActa = null;
  if (name === 'actas_reuniones' && row.asistencia_id && row.cuerpo_id) {
    asistenciaDelActa = await api(
      'GET', `/asistencias/${row.asistencia_id}/por-cuerpo?cuerpo_id=${encodeURIComponent(row.cuerpo_id)}`
    ).catch(() => null); // sin permiso para ver asistencia, el acta se imprime igual
  }

  /*
   * El certificado se imprime con SU formato: el texto, qué partes se muestran
   * y el diseño salen de ahí. Si no se puede traer —sin permiso, sin señal, o
   * su tipo ya no tiene formato— la hoja sale con lo que traía el sistema, que
   * es preferible a no salir cuando alguien necesita imprimir.
   */
  let formatoCert = null;
  if (name === 'certificados' && row.tipo) {
    formatoCert = await api(
      'GET', `/formatos_certificado/para?tipo=${encodeURIComponent(row.tipo)}`
    ).catch(() => null);
  }

  /*
   * La solicitud se imprime CON su tramitación: el seguimiento, las personas
   * que involucra y los antecedentes. Es lo que hace que la hoja sirva para
   * archivar o para llevarla a una reunión; sin eso es la ficha a secas y no
   * cuenta nada de lo que pasó. Lo que no se pueda traer —sin permiso sobre
   * ese módulo, o sin señal— no impide imprimir: sale la parte que sí está.
   */
  let deLaSolicitud = null;
  if (name === 'solicitudes') {
    const traer = (modulo, orden) => (MOD[modulo]
      ? api('GET', `/${modulo}?f_solicitud_id=${encodeURIComponent(id)}&limit=200&sort=${orden}&dir=asc`)
        .then((d) => d.rows || []).catch(() => [])
      : Promise.resolve([]));
    const [seguimiento, personas, documentos] = await Promise.all([
      // Por id y no por fecha: en un mismo día pasan varias cosas, y lo que
      // interesa es en qué orden pasaron
      traer('historial_solicitudes', 'id'),
      traer('personas_solicitud', 'id'),
      traer('documentos_solicitudes', 'fecha'),
    ]);
    deLaSolicitud = { seguimiento, personas, documentos };
  }

  /*
   * La ficha de una persona se imprime CON lo que se le ha entregado.
   *
   * Es lo que hace que la hoja sirva para ir a la casa: sin eso es la ficha a
   * secas y no dice a qué se va. Lo que no se pueda traer —sin permiso sobre
   * Ayudas Sociales, o sin señal— no impide imprimir: sale la parte que sí
   * está, como en la solicitud.
   */
  let susAyudas = null;
  if (COMO_RECIBE_AYUDA[name] && MOD['ayudas_sociales']) {
    susAyudas = await api(
      'GET', `/ayudas_sociales/de-persona?tipo=${encodeURIComponent(COMO_RECIBE_AYUDA[name])}&id=${id}`
    ).catch(() => null);
  }

  /*
   * La ficha de un miembro se imprime CON su historial.
   *
   * No se imprime una anotación suelta —una línea en una hoja con membrete no
   * es nada—: lo que hace falta en papel es la historia de la persona, y las
   * tres veces que se necesita son las mismas de siempre. Cuando se entrega una
   * congregación y hay que dejar dicho quién es cada quien. Cuando se resuelve
   * un caso de disciplina o de reconocimiento y hay que llevarlo a la reunión.
   * Y cuando alguien pide su constancia. Hasta la 1.185.0 eso se copiaba a mano
   * de la pantalla, porque el historial no salía en ninguna hoja del sistema.
   *
   * Desde la 1.202.0 la de una iglesia y la de un pastor llevan el suyo
   * también: son las tres fichas que se entregan en papel.
   */
  let suHistorial = null;
  const panelHist = HISTORIAL_EN_LA_HOJA.includes(name) ? PANEL_HISTORIAL[name] : null;
  if (panelHist && MOD[panelHist.modulo]) {
    // Sin permiso sobre la bitácora la hoja se imprime igual, sin esta parte,
    // como pasa con las ayudas: lo que no se pueda traer no impide imprimir.
    suHistorial = await api(
      'GET', `/${panelHist.modulo}?f_${panelHist.campo}=${id}&limit=${HISTORIAL_EN_EL_PAPEL}&sort=fecha&dir=desc`
    ).catch(() => null);
  }

  /*
   * Y su carpeta. Se pide aparte del historial porque son dos cosas distintas:
   * una dice qué hay hoy y la otra qué fue pasando. Si no se puede traer —sin
   * permiso sobre los documentos— la hoja se imprime igual sin esta parte, que
   * es la regla de las ayudas y del historial.
   */
  let susDocumentos = null;
  const panelDocs = DOCUMENTOS_EN_LA_HOJA.includes(name) ? PANEL_DOCUMENTOS[name] : null;
  if (panelDocs && MOD[panelDocs.modulo]) {
    susDocumentos = await api(
      'GET', `/${panelDocs.modulo}?f_${panelDocs.campo}=${id}&limit=${DOCUMENTOS_EN_EL_PAPEL}&sort=fecha&dir=desc`
    ).catch(() => null);
  }

  /*
   * Un artículo de inventario que no es de la iglesia se imprime como
   * CONSTANCIA, no como ficha: es un papel que firman el dueño y la iglesia. La
   * cláusula del depósito la escribe la corporación en Configuración y llega
   * por su propia ruta; si no se puede traer, la hoja sale igual —sin ella— en
   * vez de no salir, que es la regla de las ayudas y del historial.
   */
  /*
   * La hoja de una iglesia sale con LO QUE TIENE HOY: cuánta gente, cuántos
   * cuerpos, cuántos pastores, cuánto hay en sus cajas y cuándo fue la última
   * actividad.
   *
   * Es lo que hace que esta hoja sirva para lo que se pide en papel —entregar
   * una congregación, presentarla en una visita, acompañar un trámite—: sin
   * eso es la ficha a secas, cinco datos que ya se sabían. Sale de la MISMA
   * ruta que pinta el resumen de la pantalla, así que el papel y la ficha no
   * pueden decir cifras distintas; y esa ruta ya calla lo que esa persona no
   * puede ver, de modo que la hoja tampoco lo imprime.
   *
   * Si no se puede traer, la hoja sale igual sin esta parte, que es la regla
   * de las ayudas, del historial y de la carpeta.
   */
  let loQueTiene = null;
  if (name === 'iglesias') {
    loQueTiene = await api('GET', `/iglesias/${id}/resumen`).catch(() => null);
  }

  let clausulaDeposito = null;
  if (name === 'inventarios' && row.regimen === 'En depósito') {
    clausulaDeposito = await api('GET', '/inventarios/clausula-deposito')
      .then((d) => d.texto)
      .catch(() => null);
  }

  let sheet;
  if (name === 'solicitudes') sheet = printSolicitud(m, row, deLaSolicitud);
  else if (name === 'inventarios' && (row.regimen === 'Prestado' || row.regimen === 'En depósito')) {
    sheet = printBienAjeno(m, row, clausulaDeposito);
  }
  else if (name === 'certificados') sheet = printCertificado(row, formatoCert, { conPagina: true });
  else if (name === 'actas_reuniones' || name === 'actas_asambleas') sheet = printActa(m, row, name === 'actas_asambleas', asistenciaDelActa);
  else if (name === 'servicios') sheet = printServicio(m, row);
  else if (name === 'tesoreria') sheet = printMovimiento(m, row);
  else sheet = printGenerico(m, row, susAyudas, suHistorial, susDocumentos, loQueTiene);

  content().innerHTML = `
    <div class="print-actions no-print">
      <button class="btn secondary" data-ir="#/m/${name}">← Volver</button>
      ${name === 'actas_reuniones' ? `<button class="btn secondary" id="actaPDF">⬇️ Descargar PDF</button>` : ''}
      <button class="btn" data-imprimir="1">🖨️ Imprimir</button>
    </div>
    ${sheet}`;

  const bajarPdf = document.getElementById('actaPDF');
  if (bajarPdf) bajarPdf.addEventListener('click', () => descargarActaEnPdf(id, bajarPdf));
}

/**
 * Reemplaza los datos entre llaves de un formato por los del certificado.
 *
 * Es lo que hace que un formato sirva para todos: el texto se escribe una vez
 * —«bautizado(a) … el día {fecha_evento}, en {iglesia}»— y cada hoja sale con
 * lo suyo. Un dato que no esté queda en blanco y no deja la llave a la vista,
 * que es peor que el hueco: un certificado entregado que diga «{fecha_evento}»
 * hay que rehacerlo.
 */
const CERT_MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/**
 * Los datos de un certificado, listos para reemplazar en el texto del formato.
 *
 * Las fechas vienen de dos maneras a propósito. Entera —{fecha_evento}— para
 * los textos corridos de siempre, y partida en día, mes y año —{ev_dia},
 * {ev_mes}, {ev_anio}— para las hojas que traen la frase con espacios en
 * blanco: «con fecha __ de ______ del año ____». Escribirla entera ahí
 * obligaría a la iglesia a redactar tres textos distintos para la misma frase.
 */
function certDatos(row) {
  const partes = (iso) => {
    const t = String(iso || '').slice(0, 10);
    const [a, m, d] = t.split('-');
    return Number(a) && Number(m) && Number(d)
      ? { dia: d, mes: CERT_MESES[Number(m) - 1] || '', anio: a }
      : { dia: '', mes: '', anio: '' };
  };
  const nace = partes(row.fecha_nacimiento);
  const evento = partes(row.fecha_evento);
  const emite = partes(row.fecha_emision);

  return {
    titular: row.nombre_titular || '',
    conyuge: row.conyuge || '',
    padre: row.padre || '',
    madre: row.madre || '',
    tipo: row.tipo || '',
    numero: row.numero || '',
    iglesia: iglesiaDeTrabajo(row.iglesia_id_label) || '',
    institucion: IGLESIA.nombre || '',
    ciudad: row.ciudad || '',
    fecha_nacimiento: row.fecha_nacimiento ? fechaLarga(row.fecha_nacimiento) : '',
    fecha_evento: row.fecha_evento ? fechaLarga(row.fecha_evento) : '',
    fecha_emision: row.fecha_emision ? fechaLarga(row.fecha_emision) : '',
    nac_dia: nace.dia, nac_mes: nace.mes, nac_anio: nace.anio,
    ev_dia: evento.dia, ev_mes: evento.mes, ev_anio: evento.anio,
    em_dia: emite.dia, em_mes: emite.mes, em_anio: emite.anio,
    oficiante: row.oficiante_id_label || '',
    rut: row.miembro_id_label && row.rut ? rutFormatear(row.rut) : (row.rut ? rutFormatear(row.rut) : ''),
  };
}

function certRellenar(texto, row) {
  if (!texto) return '';
  const datos = certDatos(row);
  return String(texto).replace(/\{(\w+)\}/g, (entero, clave) =>
    Object.prototype.hasOwnProperty.call(datos, clave) ? datos[clave] : entero
  );
}

/**
 * Lo mismo, pero dejando a la vista qué parte es dato y qué parte es texto fijo.
 *
 * Es como se ven estos certificados en papel desde siempre: una frase impresa
 * con espacios en blanco, y el dato escrito encima, sobre la línea. Acá cada
 * dato reemplazado sale subrayado y en el color del título, y el que no está
 * deja la línea vacía —igual que el formulario en blanco—, que es preferible a
 * que la frase se cierre sola y nadie note que falta algo.
 *
 * Devuelve HTML, así que el texto del formato se escapa ANTES de reemplazar:
 * lo escribe una persona en un campo de texto, y sin eso una llave con
 * etiquetas adentro terminaría dentro de la hoja impresa.
 */
function certRellenarMarcado(texto, row) {
  if (!texto) return '';
  const datos = certDatos(row);
  return esc(String(texto)).replace(/\{(\w+)\}/g, (entero, clave) => {
    if (!Object.prototype.hasOwnProperty.call(datos, clave)) return entero;
    const v = String(datos[clave] || '').trim();
    return `<u class="cert-dato${v ? '' : ' vacio'}">${esc(v)}</u>`;
  });
}

/** Las tipografías que ofrece el formato, en lo que el navegador entiende. */
const CERT_TIPOGRAFIAS = {
  'Con serifa (Georgia)': "Georgia, 'Times New Roman', serif",
  'Sin serifa': "'Segoe UI', system-ui, -apple-system, sans-serif",
  'Manuscrita': "'Segoe Script', 'Brush Script MT', cursive",
};

const CERT_MARCOS = {
  'Doble línea': '3px double',
  'Línea simple': '1px solid',
  'Sin marco': '0 none',
};

/**
 * El papel, con sus medidas reales en milímetros.
 *
 * CARTA es la hoja de siempre; CIRCULAR es la larga —216 × 330 mm, 8,5 × 13
 * pulgadas—, que muchas impresoras listan con ese nombre y otras como «Oficio»
 * o «Folio»: es la misma hoja.
 *
 * De acá salen dos cosas que TIENEN que coincidir o la impresión no sirve: el
 * tamaño con que se dibuja la hoja en pantalla y el `size` que se le declara a
 * la impresora. Si la página fuera carta y la hoja se dibujara de 330 mm, la
 * impresora achicaría todo para que entrara y el certificado saldría más chico
 * de lo que se diseñó. Por eso las dos cosas se arman del mismo número.
 *
 * La misma tabla está en server/modules/formatos_certificado.js, y una prueba
 * comprueba que digan lo mismo.
 */
const CERT_HOJAS = {
  Carta: { ancho: 216, alto: 279 },
  Circular: { ancho: 216, alto: 330 },
};

/**
 * La hoja del certificado, armada con su formato.
 *
 * El formato manda sobre lo que dice, sobre qué partes aparecen y sobre cómo
 * se ve. Cuando no hay formato —un certificado de un tipo que después se
 * borró— la hoja sale igual, con lo que traía el sistema: es preferible una
 * hoja con el aspecto de siempre a una pantalla en blanco cuando alguien
 * necesita imprimir.
 */
function printCertificado(row, formato, { conPagina = false } = {}) {
  const f = formato || {};
  const conNumero = f.muestra_numero === undefined ? true : !!f.muestra_numero;
  const puesto = (v, sino) => (String(v || '').trim() ? String(v).trim() : sino);

  const titulo = certRellenar(puesto(f.titulo, `Certificado de ${row.tipo || ''}`), row);
  const rotulo = certRellenar(puesto(f.rotulo_titular, 'Otorgado a:'), row);
  const cuerpo = certRellenar(row.texto || f.texto || '', row);
  const lineaFecha = f.muestra_fecha === 0 ? '' : certRellenar(
    puesto(f.texto_fecha, row.fecha_emision ? `Dado el ${fechaLarga(row.fecha_emision)}` : ''), row
  );
  const firma1 = certRellenar(puesto(f.firma_izquierda, row.oficiante_id_label || 'Oficiante'), row);
  const firma2 = certRellenar(puesto(f.firma_derecha, 'Secretaría'), row);

  /* El diseño, acotado a lo que se puede imprimir (el servidor ya lo acotó al
     guardar; acá se repite porque un formato viejo puede traer cualquier cosa) */
  const entre = (v, min, max, sino) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : sino;
  };
  const color = (v, sino) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : sino);

  /*
   * El papel y hacia dónde va. Apaisado se dan vuelta las medidas: es la misma
   * hoja puesta de lado, no otra hoja.
   */
  const papel = CERT_HOJAS[f.tamano_hoja] ? f.tamano_hoja : 'Carta';
  const deLado = f.orientacion === 'Horizontal';
  const medidas = CERT_HOJAS[papel];
  const anchoHoja = deLado ? medidas.alto : medidas.ancho;
  const altoHoja = deLado ? medidas.ancho : medidas.alto;

  const estiloHoja = [
    `--cert-color-titulo:${color(f.color_titulo, '#16265c')}`,
    `--cert-color-texto:${color(f.color_texto, '#44403c')}`,
    `--cert-color-marco:${color(f.color_marco, '#e8b52c')}`,
    `--cert-fuente-titulo:${CERT_TIPOGRAFIAS[f.tipografia_titulo] || CERT_TIPOGRAFIAS['Con serifa (Georgia)']}`,
    `--cert-fuente-texto:${CERT_TIPOGRAFIAS[f.tipografia_texto] || CERT_TIPOGRAFIAS['Sin serifa']}`,
    `--cert-tam-titulo:${entre(f.tamano_titulo, 12, 96, 34)}px`,
    `--cert-tam-texto:${entre(f.tamano_texto, 8, 40, 15)}px`,
    `--cert-margen:${entre(f.margen, 0, 40, 18)}mm`,
    // El grosor va aparte del estilo: la misma doble línea sirve para una orla
    // gruesa y para un marco sobrio, y es lo que distingue una hoja de otra
    `--cert-marco:${f.marco === 'Sin marco'
      ? CERT_MARCOS['Sin marco']
      : `${entre(f.grosor_marco, 1, 12, 3)}px ${f.marco === 'Línea simple' ? 'solid' : 'double'}`}`,
    `--cert-fondo-opacidad:${entre(f.fondo_opacidad, 5, 100, 100) / 100}`,
    `--cert-ancho:${anchoHoja}mm`,
    `--cert-alto:${altoHoja}mm`,
  ].join(';');

  const horizontal = `${deLado ? ' apaisado' : ''} hoja-${papel.toLowerCase()}${deLado ? '-h' : ''}`;
  const fondo = f.fondo && /\.(jpe?g|png|webp)$/i.test(f.fondo)
    ? `<img class="cert-fondo" src="/uploads/${esc(f.fondo)}" alt="" />`
    : '';

  const encabezado = [
    f.muestra_logo === 0 || !IGLESIA.logo ? '' : `<img class="cert-logo" src="${IGLESIA.logo}" alt="" />`,
    f.muestra_institucion === 0 ? '' : `<div class="church">${esc(IGLESIA.nombre)}${
      IGLESIA.lema ? `<br><span class="lema">${esc(IGLESIA.lema)}</span>` : ''}</div>`,
    f.muestra_iglesia === 0 ? '' : `<div class="local">${esc(iglesiaDeTrabajo(row.iglesia_id_label))}</div>`,
  ].join('');

  /* El versículo bajo el título: lo traen la presentación y el matrimonio */
  const epigrafe = certRellenar(f.epigrafe || '', row);
  const cita = String(f.epigrafe_cita || '').trim();
  const bloqueEpigrafe = epigrafe
    ? `<div class="cert-epigrafe">${esc(epigrafe)}${cita ? `<b>${esc(cita)}</b>` : ''}</div>`
    : '';

  /*
   * Las firmas. En la hoja clásica la línea lleva el nombre encima y el rótulo
   * «Firma» debajo. En las hojas de presentación y de matrimonio no: la línea
   * va en blanco para firmar sobre ella, y debajo dice qué firma va ahí
   * —«Firma Pastor», «Timbre Iglesia»—, que es como están hechas en papel.
   */
  const bloqueFirmas = (soloRotulo) => (f.muestra_firmas === 0 ? '' : `
    <div class="cert-firmas${soloRotulo ? ' en-blanco' : ''}">
      <div class="firma">${soloRotulo
        ? `<span class="rotulo">${esc(firma1)}</span>`
        : `${esc(firma1)}<br><span class="rotulo">Firma</span>`}</div>
      <div class="firma">${soloRotulo
        ? `<span class="rotulo">${esc(firma2)}</span>`
        : `${esc(firma2)}<br><span class="rotulo">Firma y sello</span>`}</div>
    </div>`);
  const firmas = bloqueFirmas(false);
  const pie = f.muestra_pie === 0 || !pieDeLaInstitucion()
    ? '' : `<div class="cert-pie">${esc(pieDeLaInstitucion())}</div>`;

  /*
   * EL TAMAÑO DE LA PÁGINA SE LE DICE A LA IMPRESORA ACÁ.
   *
   * No en la hoja de estilos con una regla por tamaño: probado, el navegador
   * elegía la primera `@page` que encontraba y una hoja circular apaisada
   * salía impresa en carta de pie —la achicaba para que entrara, con el marco
   * corrido y los márgenes cambiados—. Escrita en el momento, con las medidas
   * del formato que se está imprimiendo, hay UNA sola regla y no hay nada que
   * elegir.
   *
   * Va solo al imprimir de verdad. La vista previa no la lleva: es una ventana
   * sobre otra pantalla, y una regla de página ahí adentro le cambiaría el
   * tamaño del papel a lo que hubiera detrás.
   */
  const laPagina = conPagina
    ? `<style>@page { size: ${anchoHoja}mm ${altoHoja}mm; margin: 0; }</style>`
    : '';

  const envolver = (clase, dentro) => `
    ${laPagina}
    <div class="print-sheet cert-sheet${clase}${horizontal}" style="${esc(estiloHoja)}">
      ${fondo}
      <div class="cert-inner">${dentro}</div>
    </div>`;

  /**
   * LA PRESENTACIÓN DE NIÑOS.
   *
   * La hoja de siempre de la iglesia: el nombre del niño destacado, la frase
   * con los espacios en blanco rellenados —cuándo nació, quién lo presentó,
   * con qué fecha—, sus padres y sus dos parejas de padrinos. El par de
   * padrinos que quede vacío no sale: una línea en blanco en un documento
   * entregado se lee como un dato que falta.
   */
  if (f.disposicion === 'Presentación de niños') {
    const par = (a, b, separador) => {
      if (!String(a || '').trim() && !String(b || '').trim()) return '';
      return `<div class="cn-par">
                <span>${esc(a || '')}</span><i>${separador}</i><span>${esc(b || '')}</span>
              </div>`;
    };
    const padrinos = [par(row.padrino_1, row.madrina_1, '&'), par(row.padrino_2, row.madrina_2, '&')]
      .filter(Boolean).join('');

    return envolver(' cert-ninos', `
      ${conNumero && row.numero ? `<div class="cert-no cn-numero">N.º ${esc(row.numero)}</div>` : ''}
      <div class="cn-cab">
        ${f.muestra_logo === 0 || !IGLESIA.logo ? '' : `<img class="cert-logo" src="${IGLESIA.logo}" alt="" />`}
        <div class="cn-tit">
          ${titulo ? `<h1>${esc(titulo)}</h1>` : ''}
          ${bloqueEpigrafe}
        </div>
      </div>
      ${rotulo ? `<div class="cn-rotulo">${esc(rotulo)}</div>` : ''}
      <div class="cn-nombre">${esc(row.nombre_titular || '')}</div>
      ${cuerpo ? `<p class="cn-parrafo">${certRellenarMarcado(row.texto || f.texto || '', row)}</p>` : ''}
      ${row.padre || row.madre ? `<div class="cn-rotulo">SUS PADRES:</div>${par(row.padre, row.madre, 'y')}` : ''}
      ${padrinos ? `<div class="cn-rotulo">SUS PADRINOS:</div>${padrinos}` : ''}
      ${bloqueFirmas(true)}
      ${lineaFecha ? `<div class="cn-emision">${certRellenarMarcado(
        puesto(f.texto_fecha, 'FECHA DE EMISIÓN: {ciudad}, {em_dia} de {em_mes} del año {em_anio}'), row
      )}</div>` : ''}
      ${pie}`);
  }

  /**
   * EL MATRIMONIO.
   *
   * Nombra a los dos cónyuges en una sola frase corrida, con los espacios en
   * blanco rellenados, y lleva el versículo al pie en una banda, como la hoja
   * que la iglesia usa desde siempre.
   */
  if (f.disposicion === 'Matrimonio') {
    return envolver(' cert-boda', `
      <div class="cb-cab">
        ${f.muestra_logo === 0 || !IGLESIA.logo ? '' : `<img class="cert-logo" src="${IGLESIA.logo}" alt="" />`}
        <div class="cb-membrete">
          ${f.muestra_institucion === 0 ? '' : `<b>${esc(IGLESIA.nombre)}</b>`}
          ${f.muestra_institucion === 0 || !IGLESIA.lema ? '' : `<i>${esc(IGLESIA.lema)}</i>`}
          ${f.muestra_iglesia === 0 ? '' : `<span>${esc(iglesiaDeTrabajo(row.iglesia_id_label))}</span>`}
        </div>
        ${conNumero && row.numero ? `<div class="cert-no">N.º ${esc(row.numero)}</div>` : ''}
      </div>
      <div class="cb-banda">
        ${rotulo ? `<span>${esc(rotulo)}</span>` : ''}
        ${titulo ? `<h1>${esc(titulo)}</h1>` : ''}
      </div>
      ${cuerpo ? `<p class="cb-parrafo">${certRellenarMarcado(row.texto || f.texto || '', row)}</p>` : ''}
      ${bloqueFirmas(true)}
      ${bloqueEpigrafe}
      ${lineaFecha ? `<div class="cb-emision">${certRellenarMarcado(
        puesto(f.texto_fecha, 'Certificado entregado en {ciudad} el {em_dia} de {em_mes} de {em_anio}'), row
      )}</div>` : ''}
      ${pie}`);
  }

  /* La de siempre, y la que vale cuando el formato no dice nada */
  return envolver('', `
        ${encabezado}
        ${titulo ? `<h1>${esc(titulo)}</h1>` : ''}
        ${bloqueEpigrafe}
        ${conNumero && row.numero ? `<div class="cert-no">N.º ${esc(row.numero)}</div>` : ''}
        ${rotulo ? `<div class="otorgado">${esc(rotulo)}</div>` : ''}
        <div class="titular">${esc(row.nombre_titular || '')}</div>
        ${cuerpo ? `<div class="texto">${esc(cuerpo)}</div>` : ''}
        ${firmas}
        ${lineaFecha ? `<div class="cert-fecha">${esc(lineaFecha)}</div>` : ''}
        ${pie}`);
}

/**
 * Un certificado de mentira, para ver cómo queda un formato.
 *
 * Los datos son de relleno a propósito y se nota que lo son: si la vista
 * previa mostrara un nombre plausible, alguien terminaría imprimiendo la
 * prueba creyendo que es el certificado de esa persona.
 */
function certDeEjemplo(tipo) {
  const hoy = new Date().toISOString().slice(0, 10);

  /*
   * La iglesia sale de la barra de arriba, para que la muestra tenga el largo
   * de línea de verdad: con un hueco en blanco donde va el nombre no se puede
   * juzgar si el texto entra en un renglón o se parte en tres. Cuando arriba
   * dice «Todas las iglesias» no hay una sola que poner, y ahí sí va un nombre
   * de relleno, con el largo de uno típico.
   */
  const enLaBarra = (document.querySelector('.iglesia-local .nm') || {}).textContent || '';
  const unaSola = enLaBarra.trim() && !/^todas\b/i.test(enLaBarra.trim());

  return {
    numero: 'CERT-000-0000',
    tipo: tipo || 'Certificado',
    nombre_titular: 'Nombre Del Titular Apellido',
    fecha_evento: hoy,
    fecha_emision: hoy,
    oficiante_id_label: 'Nombre del oficiante',
    iglesia_id_label: unaSola ? enLaBarra.trim() : 'Iglesia Local de Ejemplo',
    rut: '11111111-1',
    texto: '',
    /*
     * Lo que piden las otras dos disposiciones. Van siempre, aunque el formato
     * que se esté mirando sea el clásico: los campos que esa hoja no usa no se
     * dibujan, y así la muestra sirve para las tres sin preguntar cuál es.
     */
    ciudad: 'Ciudad de Ejemplo',
    fecha_nacimiento: hoy,
    padre: 'Nombre Del Padre Apellido',
    madre: 'Nombre De La Madre Apellido',
    padrino_1: 'Nombre Del Padrino Apellido',
    madrina_1: 'Nombre De La Madrina Apellido',
    padrino_2: 'Nombre Del Segundo Padrino',
    madrina_2: 'Nombre De La Segunda Madrina',
    conyuge: 'Nombre Del Otro Cónyuge Apellido',
  };
}

/**
 * La vista previa de un certificado, sin guardar nada.
 *
 * Existe porque un certificado se firma y se entrega: lo que salió impreso no
 * se corrige después. Hasta acá, la única manera de ver cómo quedaba un
 * formato era guardarlo, emitir un certificado y entrar a imprimirlo —tres
 * pasos y un registro de mentira que después hay que borrar—, así que en la
 * práctica nadie miraba antes.
 *
 * Se arma con lo que hay EN EL FORMULARIO en este momento, no con lo guardado:
 * el sentido es probar un cambio antes de aceptarlo.
 */
function verVistaPreviaCertificado({ formato, row, titulo }) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal modal-previa">
      <div class="modal-head">
        <h3>👁️ ${esc(titulo || 'Vista previa')}</h3>
        <button class="cerrar" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body previa-cuerpo">
        <div class="previa-aviso">
          Es una muestra con datos de relleno, para ver cómo queda la hoja.
          No se guarda nada y no queda ningún certificado emitido.
        </div>
        <div class="previa-hoja">${printCertificado(row, formato)}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="previaCerrar">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#previaCerrar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', function fuga(e) {
    if (e.key !== 'Escape') return;
    document.removeEventListener('keydown', fuga);
    cerrar();
  });
  /*
   * El alto de la caja, cuando la hoja va achicada. `transform: scale` no
   * cambia el lugar que el elemento reserva en la página: la hoja se ve chica
   * pero sigue ocupando el alto de la grande, y el diálogo queda con un hueco
   * de varias pantallas debajo. Se mide y se ajusta acá, que es donde se sabe
   * cuánto mide de verdad.
   */
  const caja = fondo.querySelector('.previa-hoja');
  const hoja = caja.querySelector('.print-sheet');
  const ajustarAlto = () => {
    /*
     * Cuánto se achica la hoja para que quepa. Se calcula acá y no en la hoja
     * de estilos porque depende del PAPEL elegido: una circular apaisada mide
     * 330 mm de ancho y una carta de pie 216, y con un porcentaje fijo la
     * primera se salía del diálogo mientras la segunda quedaba chica.
     */
    const sitio = caja.clientWidth;
    const mide = hoja.offsetWidth;
    const escala = sitio && mide ? Math.min(1, sitio / mide) : 1;
    caja.style.setProperty('--previa-escala', String(escala));
    if (escala >= 1) { caja.style.height = ''; return; }
    caja.style.height = `${Math.ceil(hoja.offsetHeight * escala)}px`;
  };
  ajustarAlto();
  addEventListener('resize', ajustarAlto);
  fondo.addEventListener('remove', () => removeEventListener('resize', ajustarAlto));

  fondo.querySelector('#previaCerrar').focus();
}

/**
 * LA BANDEJA DE SOLICITUDES: la primera pantalla del módulo.
 *
 * El listado sirve para buscar una solicitud que uno ya sabe que existe. La
 * bandeja sirve para lo otro, que es lo que se hace todos los días: ver qué
 * hay que mover hoy. Hasta acá eso había que armarlo a mano —entrar al
 * listado, abrir los filtros, elegirse a uno mismo de una lista de
 * responsables—, y eso no lo hace nadie a diario.
 *
 * Arriba van las cuatro cuentas, siempre las cuatro, aunque se esté mirando
 * una: son el tablero, y la que está en cero también dice algo. Debajo, las
 * filas de la que se eligió, con lo que se lee de un vistazo y el número de
 * días en rojo cuando ya se pasó el plazo.
 */
const BANDEJA_CAJAS = [
  { clave: 'mias', icono: '📥', label: 'Las que llevo yo', pie: 'Abiertas, a mi nombre' },
  { clave: 'vencidas', icono: '⏰', label: 'Pasadas de plazo', pie: 'Ya debían estar contestadas' },
  { clave: 'abiertas', icono: '📨', label: 'Todas las abiertas', pie: 'En trámite, lleve quien lleve' },
  // Solo aparece cuando hay alguna: una caja en cero para algo que casi nunca
  // pasa es una caja que estorba todos los días
  { clave: 'huerfanas', icono: '🫥', label: 'Sin nadie que las lleve', pie: 'Su responsable ya no entra', soloSiHay: true },
  { clave: 'cerradas', icono: '✅', label: 'Cerradas', pie: 'Resueltas en los últimos 30 días' },
];

async function viewBandejaSolicitudes(precarga) {
  const iglesias = await getOptions('iglesias').catch(() => []);
  const st = {
    caja: BANDEJA_CAJAS.some((c) => c.clave === precarga.caja) ? precarga.caja : 'mias',
    iglesia_id: String(precarga.iglesia_id || ''),
  };

  content().innerHTML = `
    <div class="page-head">
      <h2>📥 Bandeja de solicitudes</h2>
      <div class="actions">
        <button class="btn secondary sm" data-ir="#/m/solicitudes">📋 Ver el listado completo</button>
        ${MOD['solicitudes'].perms.create ? '<button class="btn sm" data-ir="#/m/solicitudes/new">➕ Nueva solicitud</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <select id="bjIglesia" aria-label="Iglesia">
          <option value="">— Todas las iglesias que administro —</option>
          ${iglesias.map((i) => `<option value="${esc(String(i.id))}" ${String(i.id) === st.iglesia_id ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="bandeja-cajas" id="bjCajas"></div>
    <div id="bjLista"></div>`;

  const cajas = document.getElementById('bjCajas');
  const lista = document.getElementById('bjLista');

  const pintar = async () => {
    lista.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Buscando…</div></div>';
    let d;
    try {
      d = await api('GET', `/solicitudes/bandeja?caja=${encodeURIComponent(st.caja)}` +
        `&iglesia_id=${encodeURIComponent(st.iglesia_id)}`);
    } catch (e) {
      cajas.innerHTML = '';
      lista.innerHTML = `<div class="card"><div class="empty-state" style="padding:26px">${esc(e.message)}</div></div>`;
      return;
    }

    const seVe = (c) => !c.soloSiHay || d.cuentas[c.clave] || c.clave === d.caja;
    cajas.innerHTML = BANDEJA_CAJAS.filter(seVe).map((c) => `
      <button type="button" class="bandeja-caja${c.clave === d.caja ? ' puesta' : ''}${
        ['vencidas', 'huerfanas'].includes(c.clave) && d.cuentas[c.clave] ? ' urge' : ''}"
              data-caja="${esc(c.clave)}" aria-pressed="${c.clave === d.caja}">
        <span class="bc-n">${fmtNumero(d.cuentas[c.clave] || 0)}</span>
        <span class="bc-q">${esc(c.icono)} ${esc(c.label)}</span>
        <span class="bc-d">${esc(c.pie)}</span>
      </button>`).join('');

    const cerradas = d.caja === 'cerradas';
    lista.innerHTML = d.filas.length ? `
      <div class="card">
        <div class="toolbar">
          <b>${esc(d.titulo)}</b>
          <span style="color:var(--muted);font-size:13px">${fmtNumero(d.filas.length)} solicitud(es)</span>
        </div>
        <div class="table-scroll">
          <table class="grid grid-lista bandeja-tabla">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Solicitante</th>
                <th>Asunto</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>${cerradas ? 'Cerrada' : 'A cargo de'}</th>
                <th>${cerradas ? '' : 'Plazo'}</th>
              </tr>
            </thead>
            <tbody>
              ${d.filas.map((f) => `
                <tr data-ir="#/m/solicitudes/ficha/${f.id}" tabindex="0">
                  <td data-col="numero" data-label="N.º"><b>${esc(f.numero || '—')}</b></td>
                  <td data-label="Solicitante">${esc(f.solicitante || '')}</td>
                  <td data-label="Asunto">${esc(f.asunto || '')}</td>
                  <td data-label="Tipo">${esc(f.tipo || '')}</td>
                  <td data-label="Estado"><span class="badge ${badgeClass(f.estado)}">${esc(f.estado || '')}</span></td>
                  <td data-label="${cerradas ? 'Cerrada' : 'A cargo de'}">${cerradas
                      ? esc(f.fecha_respuesta ? fechaCorta(f.fecha_respuesta) : '')
                      : esc(f.responsable || '—')
                        + (Number(f.responsable_id) === Number(d.yo) ? ' <span class="mut">(yo)</span>' : '')
                        // Que la cuenta esté desactivada no se puede adivinar del
                        // nombre, y es justo lo que explica por qué nadie la mueve
                        + (f.responsable_activo === 0 ? ' <span class="badge red">ya no entra</span>' : '')}</td>
                  <td data-label="Plazo">${cerradas ? '' : plazoDeLaSolicitud(f, d.dias)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : `
      <div class="card"><div class="empty-state" style="padding:26px">
        ${esc(d.caja === 'mias' ? 'No tiene ninguna solicitud abierta a su nombre.'
          : d.caja === 'vencidas' ? 'Ninguna solicitud está pasada de plazo.'
            : d.caja === 'abiertas' ? 'No hay solicitudes en trámite.'
              : d.caja === 'huerfanas' ? 'Todas las solicitudes abiertas tienen a alguien que las lleva.'
                : 'No se cerró ninguna solicitud en los últimos 30 días.')}
      </div></div>`;

    cajas.querySelectorAll('[data-caja]').forEach((b) => {
      b.addEventListener('click', () => { st.caja = b.dataset.caja; pintar(); });
    });
  };

  document.getElementById('bjIglesia').addEventListener('change', (e) => {
    st.iglesia_id = e.target.value;
    pintar();
  });

  await pintar();
}

/**
 * Cómo va de plazo una solicitud, dicho en una línea.
 *
 * Con fecha comprometida se cuenta contra ella, que es lo que se le prometió a
 * quien pidió; sin ella, contra el día en que entró y el plazo general. Se
 * dicen las dos cosas —cuál es el plazo y cuánto falta o cuánto lleva
 * pasado— porque «vencida» a secas no dice si fue ayer o hace dos meses.
 */
function plazoDeLaSolicitud(f, diasGenerales) {
  const dias = Number(f.dias);
  if (!Number.isFinite(dias)) return '';
  if (f.fecha_compromiso) {
    if (dias > 0) return `<span class="plazo vencido">${fmtNumero(dias)} día(s) pasado</span>`;
    if (dias === 0) return '<span class="plazo justo">vence hoy</span>';
    return `<span class="plazo">para el ${esc(fechaCorta(f.fecha_compromiso))}</span>`;
  }
  // Sin fecha comprometida, lo que cuenta es el plazo general: es exactamente
  // cuándo sale el recordatorio (ver server/avisos/vigia.js)
  const pasada = dias >= diasGenerales;
  return `<span class="plazo${pasada ? ' vencido' : ''}">${fmtNumero(dias)} día(s) abierta</span>`;
}

/**
 * El libro de la oficina de partes, para leerlo entero y para imprimirlo.
 *
 * La ficha de un documento sirve para trabajarlo; el libro sirve para otra
 * cosa: para mostrarlo. Es la hoja que se lleva a una reunión, la que se
 * archiva al cerrar el año, la que responde «muéstreme lo que entró en marzo».
 * Por eso es una tabla apretada con lo que se lee de un vistazo —número,
 * fecha, materia, con quién— y no una ficha por página.
 *
 * SIEMPRE DE UNA IGLESIA. Un libro que mezclara la matriz con las sedes
 * tendría dos veces el número 001 en la misma página, y no sería el libro de
 * nadie. Por eso la iglesia no admite «todas».
 */
async function viewLibroDePartes(precarga) {
  const m = MOD['documentos'];
  const iglesias = await getOptions('iglesias');
  const puedeImprimir = tieneLlave('datos_impresion');

  /* La iglesia con que se abre: la que venga en la dirección, la que se esté
     usando arriba, o la primera que la persona tenga a mano. */
  const st = {
    iglesia_id: String(precarga.iglesia_id || USER.iglesia_id || (iglesias[0] || {}).id || ''),
    anio: String(precarga.anio || ''),
    flujo: String(precarga.flujo || ''),
  };

  content().innerHTML = `
    <div class="page-head no-print">
      <h2>📖 Libro de la Oficina de Partes</h2>
      <button class="btn secondary sm" data-ir="#/m/documentos">← Volver al listado</button>
    </div>
    <div class="card no-print">
      <div class="toolbar" id="libroFiltros">
        <select id="lbIglesia" aria-label="Iglesia del libro">
          ${iglesias.map((i) => `<option value="${esc(String(i.id))}" ${String(i.id) === st.iglesia_id ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}
        </select>
        <select id="lbAnio" aria-label="Año del libro"><option value="">— Todos los años —</option></select>
        <select id="lbFlujo" aria-label="Qué parte del libro">
          <option value="">Entradas y salidas</option>
          <option value="Recibido">Solo lo recibido</option>
          <option value="Emitido">Solo lo emitido</option>
          <option value="Interno o de archivo">Solo el archivo interno</option>
        </select>
        <span class="spacer"></span>
        ${puedeImprimir ? '<button class="btn" data-imprimir="1">🖨️ Imprimir</button>' : ''}
      </div>
    </div>
    <div id="libroHoja"></div>`;

  const hoja = document.getElementById('libroHoja');
  const sel = (id) => document.getElementById(id);

  const pintar = async () => {
    hoja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Armando el libro…</div></div>';
    let d;
    try {
      d = await api('GET', `/documentos/libro?iglesia_id=${encodeURIComponent(st.iglesia_id)}` +
        `&anio=${encodeURIComponent(st.anio)}&flujo=${encodeURIComponent(st.flujo)}`);
    } catch (e) {
      hoja.innerHTML = `<div class="card"><div class="empty-state" style="padding:26px">${esc(e.message)}</div></div>`;
      return;
    }

    // Los años que el libro tiene escritos, para elegir sin adivinar
    const anios = sel('lbAnio');
    anios.innerHTML = '<option value="">— Todos los años —</option>' +
      d.anios.map((a) => `<option value="${esc(a)}" ${a === st.anio ? 'selected' : ''}>${esc(a)}</option>`).join('');

    const queParte = st.flujo === 'Recibido' ? 'Documentos recibidos'
      : st.flujo === 'Emitido' ? 'Documentos emitidos'
        : st.flujo === 'Interno o de archivo' ? 'Archivo interno'
          : 'Entradas y salidas';
    const cuando = d.anio ? `Año ${d.anio}` : 'Todos los años';

    const cabecera = (f) => (f.flujo === 'Emitido' ? 'Para' : 'De');

    hoja.innerHTML = `
      <div class="card libro-hoja">
        <div class="print-only">${membreteDelDocumento()}</div>
        <h3 class="libro-tit">Libro de la Oficina de Partes</h3>
        <div class="libro-sub">
          <span><b>${esc(d.iglesia)}</b></span>
          <span>${esc(queParte)}</span>
          <span>${esc(cuando)}</span>
        </div>
        ${d.filas.length ? `
        <div class="libro-scroll">
          <table class="libro">
            <thead>
              <tr>
                <th class="col-n">N.º</th>
                <th class="col-f">Registro</th>
                <th class="col-f">Documento</th>
                <th class="col-t">Tipo</th>
                <th>Materia / Asunto</th>
                <th class="col-q">De / Para</th>
                <th class="col-r">Referencia</th>
                <th class="col-fo">Fs.</th>
                <th class="col-e">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${d.filas.map((f) => `
                <tr class="${f.flujo === 'Emitido' ? 'sale' : f.flujo === 'Recibido' ? 'entra' : 'archivo'}">
                  <td class="col-n"><b>${esc(f.numero || '—')}</b></td>
                  <td class="col-f">${esc(f.fecha_registro ? fechaCorta(f.fecha_registro) : '')}</td>
                  <td class="col-f">${esc(f.fecha ? fechaCorta(f.fecha) : '')}</td>
                  <td class="col-t">${esc(f.tipo || '')}</td>
                  <td>${esc(f.titulo || '')}</td>
                  <td class="col-q">
                    ${(f.remitente || f.destinatario)
                      ? `<span class="rot">${esc(cabecera(f))}:</span> ${esc(f.destinatario || f.remitente)}`
                      : ''}
                  </td>
                  <td class="col-r">${esc(f.referencia || '')}</td>
                  <td class="col-fo num">${esc(f.folios == null ? '' : String(f.folios))}</td>
                  <td class="col-e">${esc(f.estado || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="libro-cierre">
          <div class="libro-cuenta">
            En este libro constan <b>${fmtNumero(d.resumen.total)}</b> documento(s):
            <b>${fmtNumero(d.resumen.recibidos)}</b> recibido(s) y
            <b>${fmtNumero(d.resumen.emitidos)}</b> emitido(s)${
              d.resumen.folios ? `, con un total de <b>${fmtNumero(d.resumen.folios)}</b> folio(s)` : ''}.
          </div>
          <div class="libro-firmas print-only">
            <div class="firma">Secretaría<br><span class="rotulo">Firma y timbre</span></div>
            <div class="firma">Pastor(a) / Encargado(a)<br><span class="rotulo">Firma</span></div>
          </div>
          <div class="libro-pie print-only">
            Impreso el ${esc(fechaLarga(hoyISO()))}${pieDeLaInstitucion() ? ` · ${esc(pieDeLaInstitucion())}` : ''}
          </div>
        </div>
      </div>`
      : `<div class="card"><div class="empty-state" style="padding:26px">
           El libro no tiene documentos con esos filtros.
         </div></div>`}`;
  };

  const alCambiar = (id, campo) => {
    const el = sel(id);
    if (!el) return;
    el.addEventListener('change', () => { st[campo] = el.value; pintar(); });
  };
  alCambiar('lbIglesia', 'iglesia_id');
  alCambiar('lbAnio', 'anio');
  alCambiar('lbFlujo', 'flujo');
  sel('lbFlujo').value = st.flujo;

  await pintar();
}

/* =====================================================================
 * La credencial pastoral impresa
 *
 * El anverso y el reverso salen UNIDOS EN UNA SOLA PIEZA PLEGABLE, en una sola
 * página tamaño Carta: se recorta por la línea exterior, se dobla por la del
 * centro, se pegan las dos caras y se plastifica. Cada cara mide exactamente
 * 54 × 86 mm.
 *
 * El reverso va ARRIBA y girado 180°, y el anverso abajo. Así, al doblar hacia
 * atrás por el pliegue, el reverso queda derecho detrás del anverso. Parece un
 * detalle y es lo que hace que la tarjeta se pueda armar.
 *
 * La estructura y los estilos son los del archivo de diseño aprobado
 * (docs/credencial-pastor.html), trasladados sin rediseñar nada. Lo que cambia
 * respecto de ese archivo es de dónde salen los datos: allá se escribían a
 * mano en la propia tarjeta; acá vienen de la credencial emitida y no se
 * pueden tocar.
 * ===================================================================== */

/** El guilloché dorado del fondo: bandas de ondas finas entrecruzadas. */
function pintarGuilloche(svg) {
  const NS = 'http://www.w3.org/2000/svg';
  const grupos = [
    { rot: -13, cx: 270, cy: 150, y0: 60, n: 30, sp: 8.2, amp: 46, wl: 300, ph: 0.0 },
    { rot: 13, cx: 270, cy: 170, y0: 88, n: 30, sp: 8.2, amp: 42, wl: 270, ph: 1.4 },
    { rot: 0, cx: 270, cy: 430, y0: 250, n: 26, sp: 9, amp: 30, wl: 340, ph: 0.7 },
  ];
  grupos.forEach((g) => {
    const grp = document.createElementNS(NS, 'g');
    grp.setAttribute('transform', `rotate(${g.rot} ${g.cx} ${g.cy})`);
    grp.setAttribute('fill', 'none');
    grp.setAttribute('stroke', '#BF9E1E');
    grp.setAttribute('stroke-width', '1.5');
    grp.setAttribute('stroke-opacity', '0.5');
    for (let i = 0; i < g.n; i++) {
      let d = '';
      for (let x = -140; x <= 700; x += 16) {
        const y = g.y0 + i * g.sp + Math.sin((x / g.wl) * Math.PI * 2 + g.ph + i * 0.1) * g.amp;
        d += (d ? ' L ' : 'M ') + x + ' ' + y.toFixed(1);
      }
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      grp.appendChild(path);
    }
    svg.appendChild(grp);
  });
}

/**
 * El texto que no cabe se achica antes de partirse en dos líneas.
 *
 * Es la misma lógica del archivo de diseño: primero se reduce la letra hasta
 * un mínimo razonable, y solo si aun así no entra se permiten dos líneas.
 * Sin esto, un apellido largo se sale del recuadro y pisa lo de al lado.
 */
function ajustarAlAncho(el) {
  el.classList.remove('dos-lineas');
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  const min = base * 0.6;
  let size = base;
  let guarda = 0;
  while (el.scrollWidth > el.clientWidth + 1 && size > min && guarda < 120) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
    guarda++;
  }
  if (el.scrollWidth > el.clientWidth + 1) el.classList.add('dos-lineas');
}

/**
 * El diseño de la credencial se trae solo donde se dibuja, y se suelta al salir.
 *
 * public/credencial.css está copiado tal cual del original aprobado, y ese
 * original era una página suelta: nombra `.card`, `.toolbar` y `@page` a secas,
 * porque en su hoja no había nada más que la credencial. Cargado junto con el
 * resto del sistema le gana a styles.css por venir después, y entonces TODAS
 * las tarjetas del programa pasan a medir 54 × 86 mm con zoom 1,9. Pasó: el
 * listado de miembros quedó dentro de un rectángulo del tamaño de una tarjeta.
 *
 * Antes que retocar el diseño —que no se toca—, se carga solo cuando hace
 * falta. Devuelve una promesa porque las medidas se toman apenas se pinta la
 * tarjeta, y medir antes de que llegue la hoja da números que no son.
 */
function estiloDeCredencial() {
  const puesto = document.getElementById('estiloCredencial');
  if (puesto) return puesto.dataset.listo ? Promise.resolve() : esperarQueCargue(puesto);
  const hoja = document.createElement('link');
  hoja.id = 'estiloCredencial';
  hoja.rel = 'stylesheet';
  hoja.href = `/credencial.css?v=${VERSION_DEL_SISTEMA}`;
  document.head.appendChild(hoja);
  return esperarQueCargue(hoja);
}

function esperarQueCargue(hoja) {
  return new Promise((listo) => {
    const terminar = () => { hoja.dataset.listo = '1'; listo(); };
    hoja.addEventListener('load', terminar, { once: true });
    // Si no llega, se sigue igual: mejor la credencial sin estilo que colgada
    hoja.addEventListener('error', terminar, { once: true });
    setTimeout(terminar, 4000);
  });
}

/** Soltarla al salir, para que deje de pisar al resto del sistema. */
function soltarEstiloDeCredencial() {
  const puesto = document.getElementById('estiloCredencial');
  if (puesto) puesto.remove();
}

/**
 * El número de versión, sacado de la dirección con que se pidió este mismo
 * guion (`/app.js?v=1.76.0`). Lo necesita la hoja de estilos que se carga a
 * mano, para que al publicar una versión nueva no llegue la guardada.
 */
const VERSION_DEL_SISTEMA = (() => {
  const yo = document.querySelector('script[src*="/app.js"]');
  const cual = /[?&]v=([^&]+)/.exec((yo && yo.getAttribute('src')) || '');
  return cual ? cual[1] : '';
})();

/** La pantalla completa de impresión de una credencial. */
async function viewImprimirCredencial(id) {
  await estiloDeCredencial();
  content().innerHTML = '<div class="card"><div class="card-body">Preparando la credencial…</div></div>';
  let d;
  try {
    d = await api('GET', `/credenciales/${id}/impresion`);
  } catch (e) {
    content().innerHTML = `<div class="card"><div class="card-body" style="color:var(--danger)">${esc(e.message)}</div></div>`;
    return;
  }

  const c = d.credencial;
  const logo = IGLESIA.logo;
  const sello = '/api/configuracion/recurso/sello';
  const firma = '/api/configuracion/recurso/firma';

  if (d.recursos_que_faltan.length) {
    content().innerHTML = `
      <div class="print-actions no-print">
        <button class="btn secondary" data-ir="#/m/credenciales/ficha/${id}">← Volver</button>
      </div>
      <div class="cred-ayuda">
        <b>No se puede imprimir todavía.</b> Falta cargar ${esc(d.recursos_que_faltan.join(', '))}
        en Configuración del Sistema. La credencial lleva el logo, el sello y la firma del Pastor
        Presidente: sin ellos no es un documento válido.
      </div>`;
    return;
  }

  // El número de serie repetido en vertical junto a la foto, como control
  // cruzado con el del reverso (elemento de seguridad del punto 11.9)
  const serieVertical = c.serie_completa ? `N°${c.serie_completa}  `.repeat(6) : '';

  const qr = d.qr.hay
    ? `<svg viewBox="0 0 ${d.qr.size} ${d.qr.size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
         <rect width="${d.qr.size}" height="${d.qr.size}" fill="#fff"/>
         <path d="${d.qr.path}" fill="#000"/>
       </svg>`
    : '<span class="qr-falta">DATOS<br>INCOMPLETOS</span>';

  const fechaImpresa = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    return `${m[3]} / ${MESES[Number(m[2]) - 1]} / ${m[1]}`;
  };

  content().innerHTML = `
    <div class="print-actions no-print">
      <button class="btn secondary" data-ir="#/m/credenciales/ficha/${id}">← Volver</button>
      <button class="btn" id="credImprimir">🖨️ Imprimir</button>
    </div>

    <div class="cred-ayuda no-print">
      <b>Antes de imprimir, en el cuadro de la impresora:</b>
      <ul>
        <li>Escala <b>100 %</b> (tamaño real). Si dice «ajustar a la página», cámbielo.</li>
        <li><b>Gráficos de fondo</b> activados: de eso dependen el guilloché, el sello y las franjas doradas.</li>
        <li>Tamaño de papel <b>Carta</b>. Todo cabe en una sola página.</li>
      </ul>
      Después: <b>recorte</b> por la línea exterior, <b>doble</b> por la del centro, <b>pegue</b> las dos caras
      entre sí y <b>plastifique</b>. La tarjeta terminada mide 54 × 86 mm.
      ${!d.qr.hay ? `<br><b>⚠️ Sin código QR:</b> falta ${esc((d.qr.falta || []).join(', '))}.` : ''}
      <br><span class="mut">Para guardarla como PDF, elija «Guardar como PDF» en el destino de la impresora:
      sale idéntica, porque la produce el mismo motor que imprime.</span>
      ${d.qr.hay && /^https?:\/\//.test(d.qr.texto || '')
        ? `<br><a href="${esc(d.qr.texto)}" target="_blank" rel="noopener">🔎 Ver lo que muestra el código QR</a>
           <span class="mut">— abre la misma página que verá quien lo escanee. Conviene mirarla antes de
           entregar la credencial.</span>`
        : ''}
    </div>

    <!-- Todo el diseño va dentro de .cred-disenio: es lo que hace que sus
         reglas —que se llaman .card, .titulo, .datos— valgan solo acá dentro
         y no pisen las del sistema. -->
    <div class="cred-disenio">
    <main class="lienzo">
      <div class="plegable">

        <section class="pieza pieza-frente">
          <div class="etiqueta">ANVERSO</div>
          <article class="card frente">
            <svg class="ondas" viewBox="0 0 540 860" preserveAspectRatio="none" aria-hidden="true"></svg>
            <img class="logo-img marca-agua" src="${logo}" alt="" aria-hidden="true">

            <div class="logoc"><img class="logo-img" src="${logo}" alt="${esc(IGLESIA.nombre)}"></div>

            <div class="titulo">CREDENCIAL PASTORAL</div>
            <div class="microtexto" aria-hidden="true">${
              ('IGLESIA&nbsp;PENTECOSTAL&nbsp;TRIUNFANTE·LA&nbsp;NUEVA&nbsp;JERUSAL&Eacute;N·PERS.&nbsp;JUR.&nbsp;' +
               d.institucion.personalidad_juridica + '·CREDENCIAL&nbsp;PASTORAL·').repeat(3)}</div>

            <div class="cuerpo">
              <div class="serie-vert" aria-hidden="true">${esc(serieVertical)}</div>
              <div class="col-izq">
                <figure class="foto ${c.snap_foto ? 'con-foto' : ''}" id="credFoto">
                  <div class="foto-capa" id="credFotoCapa"></div>
                  ${c.snap_foto ? '' : '<figcaption class="foto-hint">FOTOGRAF&Iacute;A<br>3 &times; 4</figcaption>'}
                </figure>
              </div>
              <img class="sello-foto" src="${sello}" alt="" aria-hidden="true">

              <div class="datos ${c.snap_funcion ? '' : 'sin-cargo'}">
                <div class="campo">
                  <span class="lbl">Grado:</span>
                  <span class="valor">${esc(c.snap_grado || '')}</span>
                </div>
                <div class="campo campo-opcional ${c.snap_funcion ? '' : 'vacio'}">
                  <span class="lbl">Cargo:</span>
                  <span class="valor">${esc(c.snap_funcion || '')}</span>
                </div>
                <div class="campo campo-destacado">
                  <span class="lbl">Nombres:</span>
                  <span class="valor">${esc(c.snap_nombres || '')}</span>
                </div>
                <div class="campo campo-destacado">
                  <span class="lbl">Apellidos:</span>
                  <span class="valor">${esc(c.snap_apellidos || '')}</span>
                </div>
                <div class="campo">
                  <span class="lbl">RUT:</span>
                  <span class="valor mono">${esc(c.snap_rut || '')}</span>
                </div>
                <div class="campo campo-iglesia">
                  <span class="lbl">Iglesia:</span>
                  <span class="iglesia-fila">
                    <span class="cat-iglesia">${esc(c.snap_categoria || '')}</span>
                    <span class="valor">${esc(c.snap_iglesia || '')}</span>
                  </span>
                </div>
                <div class="campo">
                  <span class="lbl">Comuna:</span>
                  <span class="valor">${esc(c.snap_comuna || '')}</span>
                </div>
              </div>
            </div>

            <div class="cruces"></div>
            <div class="base-oro"></div>
          </article>
        </section>

        <section class="pieza pieza-reverso">
          <div class="etiqueta">REVERSO</div>
          <article class="card reverso">
            <svg class="ondas" viewBox="0 0 540 860" preserveAspectRatio="none" aria-hidden="true"></svg>
            <div class="ghost-marco ${c.snap_foto ? 'activa' : ''}" aria-hidden="true">
              <div class="foto-ghost" id="credFotoGhost"></div>
            </div>

            <div class="logoc"><img class="logo-img" src="${logo}" alt=""></div>
            <div class="tit-rev">REGISTRO Y VIGENCIA<br>DE CREDENCIAL</div>

            <div class="rdatos">
              <div class="rlinea">
                <span class="rlbl">N&deg; DE SERIE:</span>
                <span class="serie-wrap">
                  <span class="rval mono">${esc(c.serie || '')}</span>
                  <span class="dv-serie mono">${c.serie_dv ? '-' + esc(c.serie_dv) : ''}</span>
                </span>
              </div>
              <div class="rlinea">
                <span class="rlbl">FECHA DE ENTREGA:</span>
                <span class="rval">${esc(fechaImpresa(c.fecha_emision))}</span>
              </div>
              <div class="rlinea">
                <span class="rlbl">FECHA DE VENCIMIENTO:</span>
                <span class="rval">${esc(fechaImpresa(c.fecha_vencimiento))}</span>
              </div>
            </div>

            <div class="ff">
              <div class="firma">
                <img class="firma-img" src="${firma}" alt="Firma del Pastor Presidente">
                <div class="espacio"></div>
                <div class="linea">
                  <div class="l1">FIRMA</div>
                  <div class="l2">PASTOR PRESIDENTE</div>
                </div>
              </div>
              <figure class="sello-box"><img class="sello-real" src="${sello}" alt="Sello oficial"></figure>
            </div>

            <div class="pj">PERSONALIDAD JUR&Iacute;DICA N&deg; ${esc(d.institucion.personalidad_juridica)}</div>
            <div class="pj-sub">IGLESIA CENTRAL CONCEPCI&Oacute;N</div>

            <div class="leyenda">
              EMITIDA EN CONCEPCI&Oacute;N, CHILE &middot; V&Aacute;LIDA PARA EL MINISTERIO RELIGIOSO.<br>
              SE ANULA SI PRESENTA ENMIENDAS O ADULTERACIONES.<br>
              DEVOLVER A LA IGLESIA SI ES ENCONTRADA.
            </div>

            <div class="barra">
              <div class="qr-holder ${d.qr.hay ? '' : 'incompleto'}">${qr}</div>
              <div class="barra-txt">
                <span class="mini">ESCANEE PARA VERIFICAR LOS DATOS</span>
                <span class="mini-cod">El c&oacute;digo &laquo;C:&raquo; valida su contenido</span>
                <span class="mini-wa">WhatsApp&nbsp;+56&nbsp;9&nbsp;7172&nbsp;7872</span>
              </div>
            </div>
          </article>
        </section>

      </div>
    </main>
    </div>`;

  // El fondo guilloché de las dos caras
  content().querySelectorAll('svg.ondas').forEach(pintarGuilloche);

  /**
   * La fotografía, con el encuadre que quedó guardado al emitirla.
   *
   * Se pinta con las mismas tres funciones que usan los mandos del encuadre
   * —urlDeLaFoto, cuantoCubre y pintarLaFoto—, y no con una cuenta parecida
   * escrita acá. Si fueran dos cuentas distintas, lo que se encuadró en
   * pantalla no sería lo que sale impreso, y esa diferencia no se ve hasta
   * tener el papel en la mano.
   */
  if (c.snap_foto) {
    const caja = document.getElementById('credFoto');
    const capa = document.getElementById('credFotoCapa');
    const ghost = document.getElementById('credFotoGhost');
    const url = urlDeLaFoto(c);
    capa.style.backgroundImage = `url("${url}")`;
    if (ghost) ghost.style.backgroundImage = `url("${url}")`;
    const natural = await medirLaImagen(url);
    pintarLaFoto(capa, encuadreGuardado(c), cuantoCubre(caja, natural));
  }

  // Los textos largos se ajustan para no salirse de su recuadro
  const ajustables = content().querySelectorAll('.valor, .rval, .titulo');
  ajustables.forEach(ajustarAlAncho);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ajustables.forEach(ajustarAlAncho));
  }

  document.getElementById('credImprimir').addEventListener('click', () => {
    document.body.classList.add('imprimiendo-credencial');
    // Queda anotado quién la imprimió y cuándo (punto 15.7)
    api('POST', `/credenciales/${id}/impresa`).catch(() => {});
    window.print();
    setTimeout(() => document.body.classList.remove('imprimiendo-credencial'), 1500);
  });
}

function printActa(m, row, esAsamblea, asistencia) {
  // Los escritos a mano: ya no se piden en el formulario, pero un acta antigua
  // que los traiga se sigue imprimiendo tal cual (ver el módulo).
  const asistentes = (row.asistentes_labels || []).join(' · ');

  /** Un grupo de la lista enlazada, solo si tiene gente. */
  const grupoImpreso = (titulo, gente, conMotivo) => {
    if (!gente || !gente.length) return '';
    return `<tr>
      <td class="k">${esc(titulo)} (${gente.length})</td>
      <td>${gente.map((p) => esc(p.nombre) + (conMotivo && p.motivo
        ? ` <span class="mut">(${esc(p.motivo)}${p.detalle ? `: ${esc(p.detalle)}` : ''})</span>` : '')).join(' · ')}</td>
    </tr>`;
  };
  const listaEnlazada = asistencia && !asistencia.sin_marcar ? `
    <h3>Asistencia</h3>
    <table class="meta-tbl">
      ${grupoImpreso('Asistieron', asistencia.presentes)}
      ${grupoImpreso('Se justificaron', asistencia.justificados, true)}
      ${grupoImpreso('No asistieron', asistencia.ausentes)}
    </table>` : '';
  return `
    <div class="print-sheet acta-sheet">
      ${membreteDelDocumento()}
      <h1>${esAsamblea ? 'Acta de Asamblea' : 'Acta de Reunión'} N.º ${esc(row.numero_acta || '')}</h1>
      <div class="sub">${esc(iglesiaDeTrabajo(row.iglesia_id_label))}${row.cuerpo_id_label ? ' — ' + esc(row.cuerpo_id_label) : ''}</div>
      <table class="meta-tbl">
        <tr><td class="k">Fecha</td><td>${fechaLarga(row.fecha)}</td></tr>
        ${esAsamblea ? `<tr><td class="k">Tipo de asamblea</td><td>${esc(row.tipo || '')}</td></tr>` : ''}
        <tr><td class="k">Lugar</td><td>${esc(row.lugar || '')}</td></tr>
        <tr><td class="k">Hora</td><td>${esc(row.hora_inicio || '')}${row.hora_fin ? ' a ' + esc(row.hora_fin) : ''}</td></tr>
        <tr><td class="k">Presidida por</td><td>${esc(row.presidida_por || '')}</td></tr>
        <tr><td class="k">Secretario(a)</td><td>${esc(row.secretario || '')}</td></tr>
        ${esAsamblea ? `<tr><td class="k">Asistentes / Quórum</td><td>${esc(row.total_asistentes ?? '')} asistentes — ${row.hubo_quorum ? 'hubo quórum' : 'sin quórum'}</td></tr>` : ''}
      </table>
      ${listaEnlazada}
      ${asistentes ? `<h3>Asistentes</h3><p>${esc(asistentes)}</p>` : ''}
      ${/*
          Sin esc(): estos campos son de texto con formato y ya vienen limpios
          del servidor (server/textorico.js deja solo las etiquetas de formato
          y bota todo lo demás), igual que en la ficha en pantalla. Escapándolos
          el acta salía impresa con las etiquetas a la vista —«<p>Se acordó…</p>»—
          en un documento que se firma.
        */''}
      ${row.agenda ? `<h3>Agenda / Orden del día</h3><div class="blk">${row.agenda}</div>` : ''}
      ${row.desarrollo ? `<h3>Desarrollo</h3><div class="blk">${row.desarrollo}</div>` : ''}
      ${row.acuerdos ? `<h3>Acuerdos</h3><div class="blk">${row.acuerdos}</div>` : ''}
      <div class="acta-firmas">
        <div class="firma">${esc(row.presidida_por || 'Preside')}<br>Preside</div>
        <div class="firma">${esc(row.secretario || 'Secretario(a)')}<br>Secretario(a)</div>
      </div>
      <div class="doc-pie">${pieDelDocumento()}</div>
    </div>`;
}

/**
 * Hoja de un bien que NO es de la iglesia: préstamo o depósito, para firmar.
 *
 * Es lo que hace que el régimen sirva de algo fuera de la pantalla. La ficha
 * corriente de inventario dice qué hay y dónde está; ésta dice de quién es,
 * desde cuándo, hasta cuándo, y —en el depósito— bajo qué condiciones, con las
 * dos firmas al pie. Sin ella la responsabilidad queda de palabra: una nota
 * sin fecha, sin firma y que el dueño nunca vio.
 *
 * Las dos hojas son la misma salvo el párrafo del medio, porque el trato es
 * distinto: en el PRÉSTAMO la iglesia recibe algo que tiene que devolver y
 * responde por ello; en el DEPÓSITO lo guarda por comodidad del dueño y no
 * responde. El texto del depósito no está acá: lo escribe la corporación en
 * Configuración y llega por su propia ruta (ver `extraRoutes` en
 * server/modules/inventarios.js), porque es lo que se firma.
 *
 * Se imprime en dos copias, que es como se firma un papel así: una queda en la
 * iglesia y la otra se la lleva el dueño.
 */
function printBienAjeno(m, row, clausula) {
  const enDeposito = row.regimen === 'En depósito';
  const fila = (k, v) => (v == null || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`);
  const nivel = row.cuerpo_id_label
    ? `${row.cuerpo_id_label} — ${row.iglesia_id_label || ''}`
    : row.iglesia_id_label || 'La corporación';

  const trato = enDeposito
    ? `<h3>Condiciones del depósito</h3>
       <div class="blk">${esc(clausula || '')
         .split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`
    : `<h3>Condiciones del préstamo</h3><div class="blk"><p>${[
        'El bien descrito en esta hoja fue prestado a la iglesia por su dueño, quien conserva su',
        'dominio sobre él. La iglesia lo recibe para su uso, se obliga a cuidarlo y a devolverlo',
        row.fecha_devolucion ? `el ${fechaLarga(row.fecha_devolucion)},` : 'cuando su dueño lo requiera,',
        'y responde por él mientras lo tenga en su poder.',
      /*
       * Se junta con espacios y no se escribe como un párrafo con saltos de
       * línea: `.blk` lleva `white-space: pre-wrap` —lo necesita el acta, donde
       * los saltos que alguien escribió son parte del texto—, así que la
       * sangría del código salía impresa en la hoja, con las líneas cortadas
       * donde las cortó el editor. Se vio en la hoja de verdad.
       */
      ].join(' ')}</p></div>`;

  return `
    <div class="print-sheet print-generic">
      ${membreteDelDocumento()}
      <h1>${enDeposito ? 'Constancia de depósito' : 'Constancia de préstamo'}</h1>
      <div class="sub">${esc(nivel)} — Registro de inventario N.º ${row.id}</div>

      <h3>El bien</h3>
      <table class="meta-tbl">
        ${fila('Artículo', row.articulo)}
        ${fila('Categoría', row.categoria)}
        ${fila('Cantidad', row.cantidad)}
        ${fila('Estado en que se recibe', row.estado)}
        ${fila('Ubicación', row.ubicacion)}
        ${fila('Valor estimado', row.valor_estimado ? fmtMoney(row.valor_estimado) : '')}
      </table>

      <h3>Su dueño</h3>
      <table class="meta-tbl">
        ${fila('Nombre', row.dueno)}
        ${fila('Teléfono o correo', row.dueno_contacto)}
        ${fila('En la iglesia desde', row.fecha_recepcion ? fechaLarga(row.fecha_recepcion) : '')}
        ${enDeposito ? '' : fila('Devolución comprometida', row.fecha_devolucion ? fechaLarga(row.fecha_devolucion) : 'Sin plazo')}
        ${fila('Devuelto el', row.fecha_devuelto ? fechaLarga(row.fecha_devuelto) : '')}
      </table>

      ${trato}
      ${row.notas ? `<h3>Observaciones</h3><div class="blk"><p>${esc(row.notas)}</p></div>` : ''}

      <div class="acta-firmas">
        <div class="firma">${esc(row.dueno || 'El dueño')}<br>Dueño del bien</div>
        <div class="firma">Por la iglesia<br>Nombre, cargo y firma</div>
      </div>
      <div class="doc-pie">${pieDelDocumento('Se firma en dos copias: una queda en la iglesia y la otra la conserva el dueño.')}</div>
    </div>`;
}

/** Hoja de un servicio: los datos agrupados como se viven en el culto. */
function printServicio(m, row) {
  const fila = (k, v) => (v == null || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`);
  return `
    <div class="print-sheet print-generic">
      ${membreteDelDocumento()}
      <h1>Registro de Servicio</h1>
      <div class="sub">${esc(iglesiaDeTrabajo(row.iglesia_id_label))} — ${fechaLarga(row.fecha)}</div>
      <table class="meta-tbl">
        ${fila('Tipo de servicio', row.tipo)}
        ${fila('Horario', row.horario)}
        ${fila('Coordinador(a)', row.coordinador)}
      </table>

      <h3>Salmo</h3>
      <table class="meta-tbl">
        ${fila('Salmista', row.salmista)}
        ${fila('Pasaje leído', row.cita_salmo)}
      </table>

      <h3>Mensaje</h3>
      <table class="meta-tbl">
        ${fila('Predicador(a)', row.predicador)}
        ${fila('Pasaje', row.cita_mensaje)}
      </table>

      <h3>Asistencia</h3>
      <table class="meta-tbl">
        ${fila('Adultos', fmtNumero(row.asistencia_adultos))}
        ${fila('Niños', fmtNumero(row.asistencia_ninos))}
        ${fila('Total general', fmtNumero(row.asistencia_total))}
      </table>

      <h3>Ofrenda</h3>
      <table class="meta-tbl">
        ${fila('Recibida (total)', fmtMoney(row.ofrenda_total))}
        <!-- El reparto solo cuando lo hay: una hoja que dice «por transferencia
             $0» en todos los servicios de la iglesia no informa, estorba. -->
        ${Number(row.ofrenda_transferencia) > 0 ? `
          ${fila('En efectivo', fmtMoney(row.ofrenda_efectivo))}
          ${fila('Por transferencia', fmtMoney(row.ofrenda_transferencia))}` : ''}
        ${fila(`Aporte a la corporación${row.ofrenda_porcentaje != null && row.ofrenda_porcentaje !== '' ? ` (${row.ofrenda_porcentaje}%)` : ''}`, fmtMoney(row.ofrenda_fondo))}
        ${fila('Queda para la iglesia', fmtMoney(row.ofrenda_iglesia))}
      </table>

      ${row.observaciones ? `<h3>Observaciones</h3><div class="blk">${esc(row.observaciones)}</div>` : ''}
      <div class="acta-firmas">
        <div class="firma">${esc(row.coordinador || 'Coordinador(a)')}<br>Coordinador(a)</div>
        <div class="firma">${esc(row.predicador || 'Predicador(a)')}<br>Predicador(a)</div>
      </div>
    </div>`;
}

/**
 * LA SOLICITUD IMPRESA, con su tramitación.
 *
 * Salía como cualquier ficha: la tabla de sus campos y nada más. Para archivar
 * en papel o llevarla a una reunión, eso es justo lo que no sirve —falta todo
 * lo que pasó—, y una solicitud es antes que nada lo que pasó con ella.
 *
 * Así que la hoja lleva cuatro cosas, en el orden en que se leen:
 *
 *   · LA SOLICITUD: quién pidió, qué pidió y cómo está hoy.
 *   · LA RESOLUCIÓN, si está cerrada, en su propio recuadro. Es lo que se le
 *     contestó a la persona y lo primero que alguien va a buscar.
 *   · EL SEGUIMIENTO completo, en el orden en que pasaron las cosas: es la
 *     constancia de por qué la solicitud anduvo dando vueltas.
 *   · LAS PERSONAS que involucra y LOS ANTECEDENTES que se juntaron, con su
 *     nombre y su fecha. Los archivos no se imprimen —son fotos y PDF—; se
 *     imprime la lista, que es lo que dice qué se acompañó.
 *
 * Al pie van las dos firmas, como en el acta: quien la llevó y quien resolvió.
 */
function printSolicitud(m, row, extras) {
  const seguimiento = (extras && extras.seguimiento) || [];
  const personas = (extras && extras.personas) || [];
  const documentos = (extras && extras.documentos) || [];
  const fila = (k, v) => (v == null || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`);
  // La lista de estados cerrados es la del formulario (SOL_CERRADOS): «/api/meta»
  // manda los campos del módulo, no sus constantes
  const cerrada = SOL_CERRADOS.includes(row.estado);

  return `
    <div class="print-sheet print-generic">
      ${membreteDelDocumento()}
      <h1>Solicitud ${esc(row.numero || '')}</h1>
      <div class="sub">${esc(iglesiaDeTrabajo(row.iglesia_id_label))} — ${fechaLarga(row.fecha)}</div>

      <table class="meta-tbl">
        ${fila('Solicitante', row.solicitante)}
        ${fila('Presentada por', row.solicitante_tipo)}
        ${fila('Tipo de solicitud', row.tipo)}
        ${fila('Asunto', row.asunto)}
        ${fila('Estado', row.estado)}
        ${fila('Responsable', row.responsable_id_label)}
        ${fila('Respuesta comprometida para', row.fecha_compromiso ? fechaLarga(row.fecha_compromiso) : '')}
        ${fila('Fecha de respuesta', row.fecha_respuesta ? fechaLarga(row.fecha_respuesta) : '')}
        ${fila('Tipo de ayuda', row.ayuda_tipo)}
        ${fila('Valor estimado', row.ayuda_monto == null || row.ayuda_monto === '' ? '' : fmtMoney(row.ayuda_monto))}
      </table>

      ${row.descripcion ? `<h3>Lo que se pide</h3><div class="blk">${esc(row.descripcion)}</div>` : ''}

      ${cerrada && row.respuesta
        ? `<h3>Resolución</h3><div class="blk resolucion">${esc(row.respuesta)}</div>`
        : row.respuesta ? `<h3>Respuesta</h3><div class="blk">${esc(row.respuesta)}</div>` : ''}

      <h3>Tramitación</h3>
      ${seguimiento.length ? `
        <table class="grid tramite">
          <thead><tr><th>Fecha</th><th>Qué pasó</th><th>Registrado por</th></tr></thead>
          <tbody>
            ${seguimiento.map((h) => `
              <tr>
                <td class="nowrap">${esc(h.fecha ? fechaCorta(h.fecha) : '')}</td>
                <td><b>${esc(h.tipo || '')}.</b> ${esc(h.descripcion || '')}</td>
                <td class="nowrap">${esc(h.registrado_por || (h.origen === 'Automático' ? 'El sistema' : ''))}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
        : '<div class="blk vacio">Sin anotaciones en el seguimiento.</div>'}

      ${personas.length ? `
        <h3>Personas que involucra</h3>
        <table class="grid tramite">
          <thead><tr><th>Persona</th><th>Registro</th><th>Qué papel tiene</th></tr></thead>
          <tbody>
            ${personas.map((p) => `
              <tr>
                <td>${esc(p.persona || '')}</td>
                <td class="nowrap">${esc(p.persona_tipo || '')}</td>
                <td>${esc(p.relacion || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}

      <h3>Antecedentes acompañados</h3>
      ${documentos.length ? `
        <table class="grid tramite">
          <thead><tr><th>Fecha</th><th>Documento</th><th>Tipo</th></tr></thead>
          <tbody>
            ${documentos.map((d) => `
              <tr>
                <td class="nowrap">${esc(d.fecha ? fechaCorta(d.fecha) : '')}</td>
                <td>${esc(d.nombre || '')}</td>
                <td class="nowrap">${esc(d.tipo || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="blk vacio">
          ${fmtNumero(documentos.length)} antecedente(s). Los archivos quedan en el sistema, en la ficha de esta solicitud.
        </div>`
        : '<div class="blk vacio">No se acompañaron antecedentes.</div>'}

      <div class="acta-firmas">
        <div class="firma">${esc(row.responsable_id_label || 'Responsable')}<br>A cargo de la solicitud</div>
        <div class="firma">Pastor(a) / Encargado(a)<br>Resuelve</div>
      </div>
      <div class="doc-pie">${pieDelDocumento()}</div>
    </div>`;
}

/**
 * El comprobante de un movimiento.
 *
 * Un traspaso se imprimía y un movimiento no, siendo el mismo dinero. La ficha
 * a secas —campo por campo, como sale de printGenerico— no sirve de
 * comprobante: lo que se archiva o se le entrega a alguien tiene que decir de
 * un vistazo cuánto, de qué cuenta, por qué concepto y quién lo anotó.
 */
function printMovimiento(m, row) {
  const esEgreso = row.tipo === 'Egreso';
  const dato = (llave, valor) => (valor == null || valor === ''
    ? '' : `<tr><td class="k">${esc(llave)}</td><td>${esc(valor)}</td></tr>`);

  // De dónde salió, cuando no lo escribió una persona
  const origen = row.traspaso_id
    ? 'Generado por un traspaso entre cuentas'
    : row.servicio_id ? 'Generado por la ofrenda de un servicio' : null;

  return `
    <div class="print-sheet print-generic">
      ${membreteDelDocumento()}
      <h1>Comprobante de ${esEgreso ? 'egreso' : 'ingreso'}</h1>
      <div class="sub">N.º ${row.id} · ${esc(fechaLarga(row.fecha))}</div>
      <div class="comprobante-monto">
        <div class="lbl">${esEgreso ? 'Sale de la cuenta' : 'Entra a la cuenta'}</div>
        <div class="num">${fmtMoney(row.monto)}</div>
      </div>
      <table>
        ${dato('Concepto', row.concepto)}
        ${dato('Categoría', row.categoria)}
        ${dato('Cuenta de tesorería', row.cuenta_id_label)}
        ${dato('Iglesia', row.iglesia_id_label)}
        ${dato('Cuerpo / Grupo', row.cuerpo_id_label)}
        ${dato('Método', row.metodo)}
        ${dato('Comprobante adjunto', row.comprobante ? 'Sí' : '')}
        ${dato('Notas', row.notas)}
        ${dato('Origen', origen)}
      </table>
      <!-- El mismo bloque de firmas que ya usan las actas, para que un papel del
           sistema se vea como los demás papeles del sistema -->
      <div class="acta-firmas">
        <div class="firma">Tesorería</div>
        <div class="firma">${esEgreso ? 'Recibí conforme' : 'Entregó'}</div>
      </div>
      <div class="doc-pie">${pieDelDocumento()}</div>
    </div>`;
}

function printGenerico(m, row, susAyudas, suHistorial, susDocumentos, loQueTiene) {
  /*
   * Lo que una congregación tiene hoy, arriba de su carpeta y de su historial.
   *
   * Va en un cuadro de cifras y no en la tabla de datos porque no son datos de
   * la ficha —nadie los escribió— sino el estado de la iglesia en el momento
   * de imprimir, y por eso la hoja dice el día. La plata de sus cuerpos va
   * aparte de la suya, con la misma regla que en la pantalla y que en el
   * inventario: son dos dueños distintos.
   */
  const cifras = [];
  if (loQueTiene) {
    const sumar = (que, cuanto, apunte) =>
      cifras.push(`<tr><td class="k">${esc(que)}</td><td><b>${esc(cuanto)}</b>${
        apunte ? ` <i>${esc(apunte)}</i>` : ''}</td></tr>`);
    const yLosQueSeFueron = (c, palabra) =>
      c.total > c.activos ? `— y ${fmtNumero(c.total - c.activos)} ${palabra}` : '';

    if (loQueTiene.miembros) {
      sumar('Miembros', fmtNumero(loQueTiene.miembros.activos),
        yLosQueSeFueron(loQueTiene.miembros, 'que ya no están'));
    }
    if (loQueTiene.cuerpos) {
      sumar('Cuerpos y grupos', fmtNumero(loQueTiene.cuerpos.activos),
        yLosQueSeFueron(loQueTiene.cuerpos, 'inactivos'));
    }
    if (loQueTiene.pastores) {
      sumar('Pastores y guías', fmtNumero(loQueTiene.pastores.activos),
        yLosQueSeFueron(loQueTiene.pastores, 'que ya no sirven acá'));
    }
    if (loQueTiene.tesoreria) {
      const t = loQueTiene.tesoreria;
      sumar('Cajas propias', `${fmtNumero(t.cuentas)}${t.reservado ? '' : ` · ${fmtMoney(t.saldo)}`}`,
        t.reservado ? '— los saldos no se le muestran a quien imprimió esta hoja' : '');
      if (t.cuentas_de_cuerpos) {
        sumar('Cajas de sus cuerpos', `${fmtNumero(t.cuentas_de_cuerpos)}${
          t.reservado ? '' : ` · ${fmtMoney(t.saldo_de_cuerpos)}`}`,
          '— esa plata tiene otro dueño y no se suma a la de la iglesia');
      }
    }
    if (loQueTiene.asistencia) {
      sumar('Actividades este año', fmtNumero(loQueTiene.asistencia.este_ano),
        loQueTiene.asistencia.ultima ? `— la última, el ${fechaCorta(loQueTiene.asistencia.ultima)}` : '');
    }
    if (loQueTiene.solicitudes && loQueTiene.solicitudes.abiertas) {
      sumar('Solicitudes en trámite', fmtNumero(loQueTiene.solicitudes.abiertas));
    }
  }
  const loSuyo = cifras.length ? `
    <h2 class="print-h2">Lo que tiene hoy</h2>
    <div class="sub">Al ${fechaLarga(new Date().toISOString())}. No son datos escritos en su ficha: es lo que hay
      anotado en el sistema en el momento de imprimir esta hoja.</div>
    <table>${cifras.join('')}</table>` : '';

  /*
   * Lo que se le ha entregado, debajo de sus datos.
   *
   * Va con el detalle y no con un total: la hoja se lleva a la casa y quien la
   * lleva tiene que poder decir «la última vez le llevamos medicamentos, en
   * marzo». Un «3 entregas» a secas no sirve para eso.
   */
  const entregas = susAyudas && susAyudas.registradas ? `
    <h2 class="print-h2">Lo que se le ha entregado</h2>
    <div class="sub">${esc(resumenDeAyudas(susAyudas) || '')}</div>
    <table class="entregas">
      <tr><td class="k">Fecha</td><td class="k">Tipo de ayuda</td><td class="k">Qué se entregó</td><td class="k">Estado</td></tr>
      ${susAyudas.ayudas.map((a) => `
        <tr>
          <td>${esc(a.fecha ? fechaLarga(a.fecha) : '')}</td>
          <td>${esc(a.tipo_ayuda || '')}</td>
          <td>${esc(a.descripcion || '')}</td>
          <td>${esc(a.estado || '')}</td>
        </tr>`).join('')}
    </table>` : '';

  /*
   * Lo que hay en su carpeta, antes del historial.
   *
   * Va antes porque es una lista corta y de hecho —cuatro líneas que se leen de
   * una mirada— y el historial es largo y se lee al final. Y va con el número
   * de papeles dicho arriba, porque la pregunta que trae a alguien a esta hoja
   * suele ser «¿qué le falta?».
   *
   * El subtítulo dice en una línea qué es esta lista y qué NO es, porque la
   * confusión con el historial es fácil y cara: quien lea «Se adjuntó "su
   * carnet"» quince líneas más abajo puede creer que el carnet está, y puede no
   * estar. Un papel sin archivo se marca: los hay, de los que entraron por
   * importación o de los que se cargaron antes de que el sistema exigiera el
   * archivo (1.193.0), y en una hoja que se firma no da lo mismo un documento
   * que está en el sistema que uno que solo está anotado.
   */
  const papeles = (susDocumentos && susDocumentos.rows) || [];
  const cuantosPapeles = susDocumentos ? susDocumentos.total : 0;
  /*
   * La columna de vencimiento solo si alguno vence. La carpeta de un miembro
   * tiene esa fecha desde la 1.200.0; la de una iglesia y la de un pastor no
   * la tienen, así que en sus hojas la columna saldría entera con rayas. Una
   * columna que nunca dice nada, en una hoja que alguien firma, es peso muerto.
   */
  const algunoVence = papeles.some((d) => d.vence);
  const carpeta = susDocumentos ? `
    <h2 class="print-h2">Documentos en carpeta</h2>
    <div class="sub">${papeles.length < cuantosPapeles
      ? `Se imprimen los ${papeles.length} más recientes, de ${cuantosPapeles}. El resto está en su ficha.`
      : cuantosPapeles
        ? `${cuantosPapeles} documento(s). Es lo que hay hoy en el sistema; el historial de más abajo cuenta lo que se fue adjuntando, que no es lo mismo.`
        : 'Sin documentos en carpeta.'}</div>
    ${papeles.length ? `
      <table class="grid tramite">
        <thead><tr><th>Fecha</th><th>Tipo de documento</th><th>Nombre</th>${algunoVence
          ? '<th>Vence</th>' : ''}<th>Observaciones</th></tr></thead>
        <tbody>
          ${papeles.map((d) => `
            <tr>
              <td class="nowrap">${esc(d.fecha ? fechaCorta(d.fecha) : '')}</td>
              <td>${esc(d.tipo || '')}</td>
              <td>${esc(d.nombre || '')}${d.archivo ? '' : ' <i>— anotado, sin archivo en el sistema</i>'}</td>
              ${algunoVence ? `<td class="nowrap">${d.vence
                ? `${esc(fechaCorta(d.vence))}${estaVencido(d.vence) ? ' <b>(vencido)</b>' : ''}`
                : '—'}</td>` : ''}
              <td>${esc(d.observaciones || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : ''}` : '';

  /*
   * Y su historial, debajo de todo: es lo último que se lee y lo que más ocupa.
   *
   * Cada línea dice quién la dejó, sea una nota del equipo o algo que el sistema
   * anotó al ocurrir —detrás de una automática también hay una persona—. Y una
   * anotación del sistema que alguien corrigió a mano lo dice en la propia hoja,
   * con lo que decía antes: en una constancia que alguien firma, un texto
   * reescrito que se presenta como registro del sistema no puede pasar callado.
   */
  const filas = (suHistorial && suHistorial.rows) || [];
  const cuantas = suHistorial ? suHistorial.total : 0;
  const historial = suHistorial ? `
    <h2 class="print-h2">Historial</h2>
    <div class="sub">${filas.length < cuantas
      ? `Se imprimen las ${filas.length} anotaciones más recientes, de ${cuantas}. El resto está en su ficha.`
      : cuantas
        ? `${cuantas} anotación(es), desde el ${esc(fechaCorta(filas[filas.length - 1].fecha))}`
        : 'Sin anotaciones todavía.'}</div>
    ${filas.length ? `
      <table class="grid tramite">
        <thead><tr><th>Fecha</th><th>Qué pasó</th><th>Registrado por</th></tr></thead>
        <tbody>
          ${filas.map((h) => `
            <tr>
              <td class="nowrap">${esc(h.fecha ? fechaCorta(h.fecha) : '')}</td>
              <td><b>${esc(h.tipo || '')}.</b> ${esc(h.descripcion || '')}${h.adjunto
                ? ` <i>— con documento adjunto: ${esc(nombreArchivo(h.adjunto))}</i>`
                : ''}${h.texto_original
                ? ` <i>— corregida a mano${h.corregido_por ? ' por ' + esc(h.corregido_por) : ''}; el sistema había anotado: «${esc(h.texto_original)}»</i>`
                : ''}</td>
              <td class="nowrap">${esc(h.registrado_por || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : ''}` : '';

  return `
    <div class="print-sheet print-generic">
      ${membreteDelDocumento()}
      <h1>${esc(m.labelSingular)}</h1>
      <div class="sub">Registro N.º ${row.id}</div>
      <table>
        ${m.fields
          /*
           * Un campo puede pedir quedarse fuera del papel con
           * `enElPapel: false`. Hace falta para lo que la hoja ya cuenta mejor
           * más abajo: «Entregas 3» arriba y «Lo que se le ha entregado · 3
           * entregas» debajo es el mismo dato dicho dos veces, y en una hoja
           * que alguien firma eso hace dudar de cuál de las dos manda.
           */
          .filter((f) => f.type !== 'password' && f.enElPapel !== false)
          .map((f) => {
            let v = row[f.name];
            if (f.computed && v && typeof v === 'object') v = v.texto; // p. ej. estado de cumplimiento
            if (f.type === 'ref') v = row[f.name + '_label'];
            if (f.type === 'multiref') v = (row[f.name + '_labels'] || []).join(', ');
            if (f.type === 'money') v = fmtMoney(v);
            if (f.type === 'rut') v = rutFormatear(v);
            if (f.type === 'boolean') v = v ? 'Sí' : 'No';
            // Las fechas salían como «1975-04-12», que es como las guarda la
            // base, no como se escriben en un documento que alguien firma.
            if (f.type === 'date' && v) v = fechaLarga(v);
            if (v == null || v === '') return '';

            /*
             * UN ARCHIVO NO SE IMPRIME POR SU NOMBRE GUARDADO.
             *
             * Se vio al imprimir por primera vez la hoja de una iglesia, en la
             * 1.235.0: la primera línea de sus datos, arriba del nombre de la
             * congregación, decía «Fotografía del templo ·
             * 1756...-a3f9c2-templo.jpg». Eso es el nombre con que el sistema
             * lo archiva —fecha, revoltijo y todo— y no le dice nada a nadie:
             * es ruido interno en una hoja que se entrega y se firma. Le pasaba
             * a las seis hojas genéricas que llevan un campo de archivo.
             *
             * Una fotografía se imprime: la del templo en la hoja de la
             * iglesia y la del pastor en la suya son justamente para lo que la
             * hoja se pide. Un documento adjunto no cabe en la hoja, así que se
             * dice que está y cómo se llama de verdad.
             */
            if (f.type === 'file') {
              const esImagen = /\.(jpe?g|png|gif|webp)$/i.test(v);
              return `<tr><td class="k">${esc(f.label)}</td><td>${esImagen
                ? `<img class="foto-papel" src="/uploads/${esc(v)}" alt="" />`
                : `<i>Adjunto: ${esc(nombreArchivo(v))}</i>`}</td></tr>`;
            }
            return `<tr><td class="k">${esc(f.label)}</td><td>${esc(v)}</td></tr>`;
          })
          .join('')}
      </table>
      ${loSuyo}
      ${entregas}
      ${carpeta}
      ${historial}
      <div class="doc-pie">${pieDelDocumento()}</div>
    </div>`;
}


/* =====================================================================
 * Importación de datos desde archivos CSV
 *
 * Flujo: elegir archivo → indicar a qué campo corresponde cada columna →
 * revisión previa (no guarda nada) → importar.
 * ===================================================================== */

/** Lee texto CSV respetando comillas, saltos de línea y separador , ; o tabulador. */
function leerCSV(texto) {
  texto = texto.replace(/^﻿/, ''); // quitar marca de orden de bytes
  const primeraLinea = texto.split(/\r?\n/)[0] || '';
  const cuenta = (c) => (primeraLinea.match(new RegExp('\\' + c, 'g')) || []).length;
  const sep = cuenta(';') > cuenta(',') ? ';' : cuenta('\t') > cuenta(',') ? '\t' : ',';

  const filas = [];
  let campo = '';
  let fila = [];
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === sep) { fila.push(campo); campo = ''; continue; }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((v) => String(v).trim() !== ''));
}

/** Sugiere a qué campo corresponde una columna, comparando nombres y etiquetas. */
function adivinarCampo(columna, campos) {
  const normal = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const col = normal(columna);
  if (!col) return '';
  let mejor = campos.find((f) => normal(f.name) === col || normal(f.label) === col);
  if (mejor) return mejor.name;
  mejor = campos.find((f) => normal(f.label).startsWith(col) || col.startsWith(normal(f.name)));
  return mejor ? mejor.name : '';
}

function abrirImportador(m, alTerminar) {
  const campos = m.fields.filter((f) => f.type !== 'file' && !f.computed);
  let columnas = [];
  let filasArchivo = [];

  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>⬆️ Importar ${esc(m.label.toLowerCase())}</h3>
        <button class="cerrar" title="Cerrar" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body" id="impBody">
        <div class="paso">
          <h4>1 · Elija el archivo</h4>
          <p style="font-size:13.5px;color:var(--muted);margin-bottom:10px">
            Archivo <b>CSV</b> con una fila de encabezados. Desde Excel: <i>Archivo → Guardar como → CSV</i>.
          </p>
          <input type="file" id="impArchivo" accept=".csv,.txt,text/csv" />
          <button class="btn secondary sm" id="impPlantilla" style="margin-left:10px">⬇️ Descargar plantilla</button>
        </div>
        <div id="impResto"></div>
      </div>
      <div class="modal-foot">
        <span class="left" id="impEstado" style="font-size:13px;color:var(--muted)"></span>
        <button class="btn secondary" id="impCancelar">Cerrar</button>
        <button class="btn" id="impRevisar" style="display:none">🔎 Revisar</button>
        <button class="btn" id="impGuardar" style="display:none">💾 Importar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);

  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#impCancelar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });

  // Plantilla CSV con los encabezados del módulo
  fondo.querySelector('#impPlantilla').addEventListener('click', () => {
    const encabezados = campos.map((f) => f.label);
    const ejemplo = campos.map((f) => (f.type === 'ref' ? 'nombre del registro' : f.required ? '(obligatorio)' : ''));
    const csv = '﻿' + [encabezados, ejemplo].map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = `plantilla-${m.name}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  });

  fondo.querySelector('#impArchivo').addEventListener('change', (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => {
      const filas = leerCSV(String(lector.result));
      if (filas.length < 2) {
        fondo.querySelector('#impResto').innerHTML = '<div class="resultado err">El archivo no tiene encabezados y al menos una fila de datos.</div>';
        return;
      }
      columnas = filas[0].map((c) => String(c).trim());
      filasArchivo = filas.slice(1);
      dibujarMapeo();
    };
    lector.readAsText(archivo, 'UTF-8');
  });

  function dibujarMapeo() {
    const opciones = (sel) =>
      '<option value="">— no importar —</option>' +
      campos.map((f) => `<option value="${f.name}" ${sel === f.name ? 'selected' : ''}>${esc(f.label)}${f.required ? ' *' : ''}</option>`).join('');

    fondo.querySelector('#impResto').innerHTML = `
      <div class="paso">
        <h4>2 · Indique a qué campo corresponde cada columna</h4>
        <div class="mapeo">
          ${columnas.map((c, i) => `
            <div class="par">
              <span class="col" title="${esc(c)}">${esc(c || '(sin nombre)')}</span> →
              <select data-col="${i}">${opciones(adivinarCampo(c, campos))}</select>
            </div>`).join('')}
        </div>
      </div>
      <div class="paso">
        <h4>3 · Vista previa (primeras 5 filas de ${filasArchivo.length})</h4>
        <div class="previa">
          <table>
            <thead><tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>
              ${filasArchivo.slice(0, 5).map((f) => `<tr>${columnas.map((_, i) => `<td>${esc(f[i] || '')}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="impResultado"></div>`;
    fondo.querySelector('#impRevisar').style.display = '';
    fondo.querySelector('#impGuardar').style.display = 'none';
    fondo.querySelector('#impEstado').textContent = `${filasArchivo.length} fila(s) leídas`;
  }

  function construirFilas() {
    const mapa = {};
    fondo.querySelectorAll('.mapeo select').forEach((sel) => {
      if (sel.value) mapa[Number(sel.dataset.col)] = sel.value;
    });
    return filasArchivo.map((f) => {
      const obj = {};
      for (const [idx, campo] of Object.entries(mapa)) obj[campo] = f[Number(idx)] ?? '';
      return obj;
    });
  }

  async function enviar(prueba) {
    const filas = construirFilas();
    if (!filas.length || !Object.keys(filas[0]).length) {
      toast('Indique al menos una columna a importar', true);
      return;
    }
    const estado = fondo.querySelector('#impEstado');
    estado.textContent = prueba ? 'Revisando…' : 'Importando…';
    try {
      const r = await api('POST', `/importar/${m.name}`, { filas, prueba });
      mostrarResultado(r);
      estado.textContent = '';
    } catch (e) {
      fondo.querySelector('#impResultado').innerHTML = `<div class="resultado err">${esc(e.message)}</div>`;
      estado.textContent = '';
    }
  }

  function mostrarResultado(r) {
    const clase = r.conError === 0 ? 'ok' : r.correctas > 0 ? 'warn' : 'err';
    const titulo = r.prueba
      ? `Revisión: ${r.correctas} de ${r.total} fila(s) están listas para importar`
      : `Importación terminada: ${r.correctas} de ${r.total} fila(s) guardadas`;
    fondo.querySelector('#impResultado').innerHTML = `
      <div class="resultado ${clase}">
        <b>${esc(titulo)}</b>
        ${r.conError ? `<div style="margin-top:6px">${r.conError} fila(s) con problemas${r.prueba ? ' — se omitirán al importar' : ''}:</div>` : ''}
        ${r.errores.length ? `<div class="lista-errores">
          ${r.errores.map((e) => `<div><b>Fila ${e.fila}:</b> ${esc(e.errores.join(' · '))}</div>`).join('')}
        </div>` : ''}
      </div>`;
    if (r.prueba) {
      fondo.querySelector('#impGuardar').style.display = r.correctas > 0 ? '' : 'none';
    } else {
      fondo.querySelector('#impRevisar').style.display = 'none';
      fondo.querySelector('#impGuardar').style.display = 'none';
      invalidarOpciones(m.name);
      if (alTerminar) alTerminar();
      toast(`${r.correctas} registro(s) importado(s)`);
    }
  }

  fondo.querySelector('#impRevisar').addEventListener('click', () => enviar(true));
  fondo.querySelector('#impGuardar').addEventListener('click', () => {
    if (confirm('¿Importar las filas correctas? Las filas con problemas se omitirán.')) enviar(false);
  });
}


/* =====================================================================
 * Configuración del sistema (solo administradores)
 * ===================================================================== */
/**
 * Bajarse todo el sistema en un archivo.
 *
 * Los datos viven en un solo disco, y los discos se pierden. Acá el
 * administrador se lleva una copia cuando quiera —la base entera y los
 * archivos subidos— y la guarda donde le parezca.
 */
async function renderRespaldo(zona) {
  if (!zona || !tieneLlave('sistema_respaldo')) return;
  let info;
  try {
    info = await api('GET', '/respaldo/info');
  } catch (e) {
    return; // sin permiso o sin la ruta: no se ofrece
  }

  zona.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="toolbar"><b>💾 Respaldo del sistema</b></div>
      <div class="respaldo">
        <p>
          Se baja <b>todo</b> en un solo archivo: los registros y los documentos y fotos que se han subido.
          Guárdelo donde quiera —su computador, un pendrive, su nube—: si algún día se pierde el servidor,
          con esto se vuelve a levantar el sistema tal como estaba.
        </p>
        <div class="respaldo-datos">
          <div><span class="mut">Registros</span><b>${tamanoLegible(info.base)}</b></div>
          <div><span class="mut">Documentos y fotos</span><b>${fmtNumero(info.cuantos)} archivo(s) · ${tamanoLegible(info.archivos)}</b></div>
          <div><span class="mut">Se baja como</span><b>${esc(info.nombre)}</b></div>
        </div>
        <div class="respaldo-acciones">
          <a class="btn" id="btnRespaldo" href="/api/respaldo" download>⬇️ Descargar el respaldo</a>
          <span class="mut" id="respaldoEstado"></span>
        </div>
        <p class="mut" style="font-size:12.5px">
          Se comprime al vuelo, así que el archivo pesa bastante menos que eso y la descarga puede demorar
          un poco en empezar. Hágalo cada cierto tiempo: un respaldo de hace un mes solo devuelve lo de hace un mes.
        </p>
      </div>
    </div>`;

  document.getElementById('btnRespaldo').addEventListener('click', () => {
    const estado = document.getElementById('respaldoEstado');
    estado.textContent = 'Preparando el respaldo… la descarga parte en unos segundos.';
    setTimeout(() => { estado.textContent = ''; }, 20000);
  });

  renderRespaldoAutomatico(zona);
  renderDisco(zona);
}

/**
 * A dónde se está yendo el espacio del disco.
 *
 * El sistema vive en un volumen de tamaño fijo. Saber que «quedan 414 MB» no
 * sirve de mucho si no se sabe en qué se gastaron los otros: la decisión de si
 * conviene comprimir los escaneos o agrandar el disco depende justamente de
 * eso. Acá se ve el reparto, y una cuenta que responde la pregunta de quien
 * está por subir doscientos documentos: cuántos más caben, al peso que están
 * pesando los que ya subió.
 */
async function renderDisco(zona) {
  let d;
  try {
    d = await api('GET', '/disco');
  } catch (err) {
    return; // versión antigua del servidor: no se ofrece
  }

  const caja = document.createElement('div');
  caja.className = 'card';
  caja.style.marginBottom = '18px';
  zona.appendChild(caja);

  const parte = (n) => (d.total ? Math.max(n / d.total * 100, n > 0 ? 0.4 : 0) : 0);
  const trozos = [
    { que: 'Documentos y fotos', bytes: d.documentos, clase: 'doc' },
    { que: 'La base de datos', bytes: d.base, clase: 'base' },
    { que: 'Las copias automáticas', bytes: d.respaldos, clase: 'copias' },
    // Lo que ocupa el disco y no es del sistema. Si no se nombrara, quedaría
    // pintado como espacio libre y la barra diría que hay más sitio del que hay.
    { que: 'Otras cosas del disco', bytes: d.otros || 0, clase: 'otros' },
  ].filter((t) => t.bytes > 0);

  const barra = d.total
    ? `<div class="disco-barra">
         ${trozos.map((t) => `<span class="${t.clase}" style="width:${parte(t.bytes).toFixed(2)}%" title="${esc(t.que)}: ${tamanoLegible(t.bytes)}"></span>`).join('')}
       </div>`
    : '';

  const leyenda = trozos
    .map((t) => `<div><span class="punto ${t.clase}"></span>${esc(t.que)}<b>${tamanoLegible(t.bytes)}</b></div>`)
    .join('');

  // La cuenta que de verdad se quiere hacer: a este peso, cuántos más entran
  const cuentaDeDocumentos =
    d.promedio_documento && d.documentos_que_caben !== null
      ? `<p class="mut" style="font-size:13px;margin:10px 0 0">
           Los ${fmtNumero(d.cuantos_documentos)} archivos subidos pesan <b>${tamanoLegible(d.promedio_documento)}</b> cada uno
           en promedio. A ese ritmo caben unos <b>${fmtNumero(d.documentos_que_caben)}</b> más.
           Si va a subir muchos escaneos, comprimirlos antes es lo que más rinde: un documento
           a 200 dpi en escala de grises pesa como la décima parte que a color.
         </p>`
      : `<p class="mut" style="font-size:13px;margin:10px 0 0">
           Todavía no hay archivos subidos con los que estimar. En cuanto suba unos cuantos,
           acá aparece cuánto pesan en promedio y cuántos más caben.
         </p>`;

  caja.innerHTML = `
    ${d.apretado ? `<div class="aviso choque">
      <b>💾 Queda muy poco espacio</b>
      <span>Con el disco lleno el sistema no puede guardar nada más: ni una ficha, ni una foto,
        ni el respaldo de la noche. Libere sitio o agrande el volumen antes de que pase.</span>
    </div>` : ''}
    <div class="toolbar"><b>💾 En qué se está usando el disco</b></div>
    <div class="respaldo">
      ${barra}
      <div class="disco-leyenda">
        ${leyenda}
        <div><span class="punto libre"></span>Libre<b>${d.libre === null ? '—' : tamanoLegible(d.libre)}</b></div>
      </div>
      ${cuentaDeDocumentos}
      ${d.solo_nuestro ? '' : `<p class="mut" style="font-size:12.5px;margin:8px 0 0">
        Este disco no es solo del sistema: lo que aparece como «otras cosas» son archivos de la
        máquina que no tienen que ver con la iglesia. En el servidor publicado, donde los datos
        viven en su propio volumen, esa parte no aparece.
      </p>`}
    </div>`;
}

/**
 * El aviso de que hace mucho que nadie se baja el respaldo completo.
 *
 * Es el único que sale del servidor. La copia automática vive en el mismo
 * disco que protege: sirve para volver atrás cuando algo se borró mal, y no
 * sirve para lo único contra lo que existen los respaldos, que es que el disco
 * se pierda. Y para que este salga, alguien tiene que acordarse.
 *
 * Por eso el sistema lo cuenta en vez de esperar a que se acuerden. Se avisa
 * con tres tonos, según cuánto haga: al día no se dice nada más que la fecha;
 * pasado el plazo se avisa; y si no consta ninguno, se avisa más fuerte,
 * porque ahí no hay nada afuera.
 */
function avisoDeLaCopiaAMano(b) {
  if (!b) return ''; // servidor anterior a esto: no se inventa nada

  const bajar = '<a class="btn sm" href="/api/respaldo" download>⬇️ Bajar el respaldo completo</a>';

  if (!b.cuando) {
    return `<div class="aviso choque">
      <b>📦 No hay ningún respaldo guardado fuera del servidor</b>
      <span>No consta que nadie se haya bajado el respaldo completo. Mientras no salga una copia
        de acá, si se pierde el servidor se pierde todo: las fichas, el dinero y los documentos.</span>
      <div class="acciones">${bajar}</div>
    </div>`;
  }

  const cuando = String(b.cuando).slice(0, 10).split('-').reverse().join('-');
  const hace = b.dias === 0 ? 'hoy' : b.dias === 1 ? 'ayer' : `hace ${b.dias} días`;
  const quien = b.quien ? ` · lo bajó ${esc(b.quien)}` : '';

  if (b.alDia) {
    return `<p class="mut" style="margin:0 0 12px;font-size:13px">
      ✅ El respaldo completo se bajó ${esc(hace)} (${esc(cuando)})${quien}. Guárdelo fuera del servidor.
    </p>`;
  }

  return `<div class="aviso confirmar">
    <b>📦 Hace ${b.dias} días que nadie se baja el respaldo</b>
    <span>El último salió el ${esc(cuando)}${quien}. Conviene bajarlo al menos cada ${b.cada} días
      y guardarlo en otra parte: es la única copia que no se pierde junto con el servidor.</span>
    <div class="acciones">${bajar}</div>
  </div>`;
}

/**
 * La copia que el sistema hace solo, a la vista.
 *
 * Un respaldo automático que nadie ve es un respaldo en el que nadie confía:
 * el día que hace falta, lo primero que se pregunta es si de verdad se estaba
 * haciendo. Acá se ve la fecha de la última copia, cuántas hay guardadas y lo
 * que pesa cada una, se puede bajar cualquiera y se puede hacer una ahora
 * mismo sin esperar a la noche.
 */
async function renderRespaldoAutomatico(zona) {
  let e;
  try {
    e = await api('GET', '/respaldo/automatico');
  } catch (err) {
    return; // versión antigua del servidor: no se ofrece
  }

  const caja = document.createElement('div');
  caja.className = 'card';
  caja.style.marginBottom = '18px';
  caja.id = 'cajaRespaldoAuto';
  zona.appendChild(caja);

  const pintar = (estado) => {
    const u = estado.ultima;
    const senal = !estado.activo ? '⏸️' : estado.alDia ? '✅' : '⚠️';
    const cuando = !u
      ? 'Todavía no hay ninguna. La primera se hace esta noche.'
      : estado.dias === 0
        ? `Hoy (${u.dia}), ${tamanoLegible(u.peso)}.`
        : estado.dias === 1
          ? `Ayer (${u.dia}), ${tamanoLegible(u.peso)}.`
          : `Hace ${estado.dias} días (${u.dia}), ${tamanoLegible(u.peso)}.`;

    const filas = estado.copias.length
      ? estado.copias
          .map(
            (c) => `<li>
              <span>${esc(c.dia)}</span>
              <span class="mut">${tamanoLegible(c.peso)}</span>
              <a href="/api/respaldo/automatico/${encodeURIComponent(c.nombre)}" download>⬇️ bajar</a>
            </li>`
          )
          .join('')
      : '<li class="mut">Ninguna todavía</li>';

    caja.innerHTML = `
      ${avisoDeLaCopiaAMano(estado.bajada)}
      <div class="toolbar"><b>🕒 La copia que se hace sola</b></div>
      <div class="respaldo">
        <p>
          ${estado.activo
            ? `Todas las noches, a partir de las <b>${String(estado.hora).padStart(2, '0')}:00</b>, el sistema guarda
               una copia comprimida de la base y conserva las <b>últimas ${estado.conservar}</b>.`
            : 'Está <b>apagada</b>. Se enciende más abajo, en <i>Respaldos</i>.'}
        </p>
        <div class="respaldo-datos">
          <div><span class="mut">Última copia</span><b>${senal} ${esc(cuando)}</b></div>
          <div><span class="mut">Guardadas</span><b>${estado.copias.length} de ${estado.conservar}</b></div>
        </div>
        <ul class="respaldo-copias">${filas}</ul>
        <div class="respaldo-acciones">
          ${tieneLlave('sistema_respaldo', 'create')
            ? '<button class="btn secundario" id="btnCopiaAhora">🕒 Hacer una copia ahora</button>'
            : ''}
          <span class="mut" id="copiaEstado"></span>
        </div>
        <p class="mut" style="font-size:12.5px">
          <b>Ojo con qué protege esto.</b> La copia queda en el mismo disco que los datos, así que sirve para
          volver atrás cuando algo se borró o quedó mal cargado, pero <b>no</b> sirve si se pierde el servidor.
          Para eso está el respaldo de arriba: ese hay que bajarlo y guardarlo en otra parte.
        </p>
      </div>`;

    const botonCopia = document.getElementById('btnCopiaAhora');
    if (botonCopia) botonCopia.addEventListener('click', async (ev) => {
      const boton = ev.currentTarget;
      const aviso = document.getElementById('copiaEstado');
      boton.disabled = true;
      aviso.textContent = 'Haciendo la copia…';
      try {
        const r = await api('POST', '/respaldo/automatico');
        pintar(r.estado);
        const nuevo = document.getElementById('copiaEstado');
        if (nuevo) {
          nuevo.textContent = `Lista: ${r.nombre} (${tamanoLegible(r.peso)}).`;
          setTimeout(() => {
            const q = document.getElementById('copiaEstado');
            if (q) q.textContent = '';
          }, 6000);
        }
      } catch (err) {
        aviso.textContent = err.message;
        boton.disabled = false;
      }
    });
  };

  pintar(e);
}

async function viewConfiguracion() {
  content().innerHTML = `<div class="page-head"><h2>⚙️ Configuración del sistema</h2></div><p>Cargando…</p>`;
  let datos;
  try {
    datos = await api('GET', '/configuracion');
  } catch (e) {
    content().innerHTML = `<div class="page-head"><h2>⚙️ Configuración</h2></div><p style="color:var(--danger)">${esc(e.message)}</p>`;
    return;
  }

  /**
   * Se puede tener la configuración a la vista sin poder cambiarla: son dos
   * permisos distintos. A quien solo la ve se le muestra todo igual, pero sin
   * el botón de guardar y con los campos bloqueados, para que no llene un
   * formulario que después el servidor le va a rechazar.
   */
  const puedeCambiarla = tieneLlave('sistema_configuracion', 'edit');
  const bloqueado = puedeCambiarla ? '' : ' disabled';

  const campo = (o) => {
    if (o.tipo === 'boolean') {
      return `<div class="fld check full">
        <input type="checkbox" id="cfg_${o.clave}" data-clave="${o.clave}" data-tipo="boolean" ${String(o.valor) === '1' ? 'checked' : ''}${bloqueado} />
        <label for="cfg_${o.clave}">${esc(o.label)}</label>
        ${o.ayuda ? `<div class="help" style="flex-basis:100%">${esc(o.ayuda)}</div>` : ''}
      </div>`;
    }
    if (o.tipo === 'imagen') {
      // Se ve, se cambia y se quita en el mismo lugar. El valor que viaja al
      // guardar es el nombre del archivo, igual que en cualquier campo de
      // archivo; lo que se muestra es la ruta que lo entrega. El logo tiene la
      // suya propia porque también se ve sin sesión, en la pantalla de acceso.
      const verla = o.clave === 'iglesia_logo'
        ? `/api/configuracion/logo${o.valor ? `?v=${encodeURIComponent(o.valor)}` : ''}`
        : (o.valor ? `/uploads/${encodeURIComponent(o.valor)}` : '');
      return `<div class="fld full cfg-imagen">
        <label>${esc(o.label)}</label>
        <div class="cfg-imagen-caja">
          <img id="cfgImagen_${o.clave}" alt="" class="${verla ? '' : 'sin-imagen'}" src="${verla}" />
          <input type="hidden" data-clave="${o.clave}" data-tipo="imagen"
                 data-antes="${esc(o.valor || '')}" value="${esc(o.valor || '')}" />
          ${puedeCambiarla ? `
            <div class="cfg-imagen-acciones">
              <button type="button" class="btn secondary sm" data-elegir-imagen="${o.clave}">🖼️ Elegir una imagen</button>
              <button type="button" class="btn secondary sm" data-quitar-imagen="${o.clave}"
                ${o.valor ? '' : 'disabled'}>${o.clave === 'iglesia_logo' ? 'Volver al de fábrica' : 'Quitarla'}</button>
              <span class="mut" id="cfgImagenEstado_${o.clave}"></span>
            </div>` : ''}
        </div>
        ${o.ayuda ? `<div class="help">${esc(o.ayuda)}</div>` : ''}
      </div>`;
    }
    if (o.tipo === 'select') {
      /*
       * La zona horaria lleva debajo la hora que tiene el sistema en este
       * momento. Un desplegable que dice «Chile» no prueba nada; una fecha y
       * hora que coinciden con el reloj de la pared, sí. Es la única manera de
       * que alguien note que está mal sin tener que revisar fechas guardadas.
       */
      const reloj = o.clave === 'zona_horaria' && datos.hora
        ? `<div class="help" id="cfgReloj">🕒 Ahora el sistema son las <b>${esc(datos.hora.texto)}</b></div>`
        : '';
      return `<div class="fld">
        <label>${esc(o.label)}</label>
        <select data-clave="${o.clave}" data-tipo="select"${bloqueado}>
          ${(o.opciones || []).map((x) => `
            <option value="${esc(x.valor)}" ${String(o.valor) === String(x.valor) ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
        </select>
        ${reloj}
        ${o.ayuda ? `<div class="help">${esc(o.ayuda)}</div>` : ''}
      </div>`;
    }
    const tipo = o.tipo === 'number' ? 'number' : 'text';
    const limites = o.tipo === 'number'
      ? `${o.min === undefined || o.min === null ? '' : ` min="${o.min}"`}${o.max === undefined || o.max === null ? '' : ` max="${o.max}"`}`
      : '';
    const control = o.tipo === 'textarea'
      ? `<textarea data-clave="${o.clave}" data-tipo="textarea"${bloqueado}>${esc(o.valor || '')}</textarea>`
      : `<input type="${tipo}" data-clave="${o.clave}" data-tipo="${o.tipo}" value="${esc(o.valor || '')}"${limites}${bloqueado} />`;
    return `<div class="fld${o.tipo === 'textarea' ? ' full' : ''}">
      <label>${esc(o.label)}${o.tipo === 'number' && o.min !== undefined ? ` <span class="mut">(${fmtNumero(o.min)} a ${fmtNumero(o.max)})</span>` : ''}</label>${control}
      ${o.ayuda ? `<div class="help">${esc(o.ayuda)}</div>` : ''}
    </div>`;
  };

  /**
   * La configuración, en pestañas.
   *
   * Antes era una sola columna con ocho tarjetas y tres paneles al pie, y para
   * llegar al último había que pasar por todos los demás. Ahora se reparte en
   * pestañas, la misma barra de las fichas de Miembros, Cuerpos y Pastores.
   *
   * Dos cosas quedan FUERA de las pestañas a propósito:
   *
   *   · el botón de guardar, que vale para toda la pantalla y no para la
   *     pestaña abierta;
   *   · el aviso de lo que pasó al guardar, para que se lea sin importar en
   *     qué pestaña estaba quien guardó.
   *
   * Y los campos de todos los grupos se escriben de entrada, aunque su pestaña
   * esté cerrada: el botón de guardar los junta de una sola pasada, y lo que no
   * está en la pantalla no se guardaría.
   */
  const ICONOS = {
    'Mantenimiento': '🛠️',
    'Identidad': '⛪',
    'Organización': '👥',
    'Acceso': '🔐',
    'Respaldos': '💾',
    'Recursos de la credencial': '🪪',
    'Límites y espacio': '📦',
    'Preferencias': '🎛️',
  };
  /**
   * En la pestaña, el nombre corto; adentro, el largo.
   *
   * «Recursos de la credencial» y «Límites y espacio» son buenos títulos para
   * la tarjeta, y demasiado largos para una pestaña: con esos dos enteros, las
   * diez no caben en la pantalla de un computador y las últimas quedan cortadas
   * por el borde sin que nada avise de que siguen.
   */
  const NOMBRE_CORTO = {
    'Recursos de la credencial': 'Credencial',
    'Límites y espacio': 'Límites',
  };
  const enClave = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');

  const pestanas = datos.grupos.map((g) => ({
    clave: enClave(g.grupo),
    titulo: NOMBRE_CORTO[g.grupo] || g.grupo,
    icono: ICONOS[g.grupo] || '⚙️',
    html: `
      <div class="card" style="margin-bottom:18px">
        <div class="toolbar"><b>${esc(g.grupo)}</b></div>
        <div class="form-grid">${g.items.map(campo).join('')}</div>
      </div>
      ${g.grupo === 'Respaldos' ? '<div id="cfgRespaldo"></div>' : ''}`,
    // El panel del respaldo cuelga del grupo que lo configura: sus ajustes y
    // el botón de bajarlo son la misma cosa y estaban en dos sitios distintos
    pinta: g.grupo === 'Respaldos'
      ? () => renderRespaldo(document.getElementById('cfgRespaldo'))
      : null,
  }));

  if (tieneLlave('sistema_importacion')) {
    pestanas.push({
      clave: 'traspaso', titulo: 'Traspaso', icono: '🚚',
      html: '<div id="cfgTraspaso"></div>',
      pinta: () => renderTraspaso(document.getElementById('cfgTraspaso')),
    });
  }
  pestanas.push({
    clave: 'versiones', titulo: 'Versiones', icono: '🏷️',
    html: '<div id="cfgVersiones"></div>',
    pinta: () => renderVersiones(document.getElementById('cfgVersiones')),
  });

  content().innerHTML = `
    <div class="page-head">
      <h2>⚙️ Configuración del sistema</h2>
      <div class="actions">${puedeCambiarla ? '<button class="btn" id="cfgGuardar">💾 Guardar cambios</button>' : ''}</div>
    </div>
    ${puedeCambiarla ? '' : '<div class="resultado warn">👁️ Puede <b>ver</b> la configuración, pero no cambiarla. Para modificar algo de acá, pídale a la oficina que le dé también el permiso de editarla.</div>'}
    <div id="cfgEstado"></div>
    <div id="cfgPestanas"></div>
    <div id="cfgPaneles"></div>`;

  montarPestanas({
    barra: document.getElementById('cfgPestanas'),
    zona: document.getElementById('cfgPaneles'),
    pestanas,
    etiqueta: 'Secciones de la configuración',
    // La pestaña abierta va en la dirección: así se puede guardar el enlace de
    // «Traspaso» o mandárselo a alguien, en vez de decirle dónde tocar
    elegida: (location.hash.split('/')[2] || '').split('?')[0],
    direccionDe: (clave) => (clave === pestanas[0].clave ? '#/config' : `#/config/${clave}`),
  });

  /**
   * Elegir y quitar el logo.
   *
   * Se sube por la misma puerta que cualquier archivo —con su comprobación de
   * formato y de tamaño—, y lo que queda escrito en la configuración es el
   * nombre del archivo. No se guarda hasta que se toca «Guardar cambios», como
   * todo lo demás de esta pantalla: se ve antes de comprometerse.
   */
  content().querySelectorAll('[data-elegir-imagen]').forEach((boton) => {
    const clave = boton.dataset.elegirImagen;
    const oculto = content().querySelector(`input[data-clave="${clave}"]`);
    const vista = document.getElementById(`cfgImagen_${clave}`);
    const aviso = document.getElementById(`cfgImagenEstado_${clave}`);
    const quitar = content().querySelector(`[data-quitar-imagen="${clave}"]`);

    boton.addEventListener('click', () => {
      const elegir = document.createElement('input');
      elegir.type = 'file';
      elegir.accept = 'image/png,image/jpeg,image/webp';
      elegir.addEventListener('change', async () => {
        const archivo = elegir.files[0];
        if (!archivo) return;
        aviso.textContent = 'Preparando la imagen…';
        try {
          // El logo lo baja TODO el que entra al sistema, así que se guarda más
          // chico que el resto: mil pixeles alcanzan de sobra para los 116 con
          // que se ve en la pantalla de acceso, para los 22,5 mm de la
          // credencial y para el encabezado del acta impresa. El sello y la
          // firma no se tocan: van sobre la credencial y ahí sí se notaría.
          const ajustada = await reducirImagen(archivo, clave === 'iglesia_logo' ? 1024 : 0);
          const fd = new FormData();
          fd.append('archivo', ajustada.file);
          aviso.textContent = 'Subiendo…';
          const r = await api('POST', '/upload', fd, true);
          oculto.value = r.filename;
          vista.src = `/uploads/${encodeURIComponent(r.filename)}`;
          vista.classList.remove('sin-imagen');
          if (quitar) quitar.disabled = false;
          aviso.textContent = 'Listo: guarde los cambios para dejarlo puesto.';
        } catch (e) {
          aviso.textContent = '';
          toast(e.message, true);
        }
      });
      elegir.click();
    });

    if (quitar) {
      quitar.addEventListener('click', () => {
        oculto.value = '';
        if (clave === 'iglesia_logo') {
          vista.src = '/img/logo.png';
          aviso.textContent = 'Vuelve el de fábrica: guarde los cambios.';
        } else {
          vista.removeAttribute('src');
          vista.classList.add('sin-imagen');
          aviso.textContent = 'Queda sin cargar: guarde los cambios.';
        }
        quitar.disabled = true;
      });
    }
  });

  const botonGuardar = document.getElementById('cfgGuardar');
  if (botonGuardar) botonGuardar.addEventListener('click', async () => {
    const cambios = {};
    content().querySelectorAll('[data-clave]').forEach((el) => {
      cambios[el.dataset.clave] = el.dataset.tipo === 'boolean' ? el.checked : el.value;
    });
    const mantenimiento = cambios.mantenimiento_activo === true;
    if (mantenimiento && !confirm('¿Activar el modo mantenimiento?\n\nSolo podrá ingresar quien tenga permiso para cambiar la configuración; el resto verá el aviso y se cerrará su sesión.')) return;
    try {
      const r = await api('PUT', '/configuracion', cambios);
      toast('Configuración guardada');
      // Lo que se guarda es lo que se usa: si un número quedó fuera de sus
      // límites, se ajustó y se dice cuál y en cuánto quedó. Callarlo dejaría
      // la pantalla mostrando un valor que el sistema no está usando.
      // Y el reloj, con la zona que quedó puesta: se aplica al momento, así
      // que la hora de abajo tiene que moverse al guardar, no al reiniciar.
      const reloj = document.getElementById('cfgReloj');
      if (reloj && r && r.hora) {
        reloj.innerHTML = `🕒 Ahora el sistema son las <b>${esc(r.hora.texto)}</b>`;
      }
      const ajustados = (r && r.ajustados) || [];
      const avisoDeLimites = ajustados.length
        ? `<div class="resultado warn"><b>✏️ Se ajustó lo que no cabía.</b> ${ajustados
            .map((a) => `«${esc(a.label)}» quedó en <b>${fmtNumero(a.quedo)}</b> (se pidió ${fmtNumero(a.pedido)})`)
            .join(' · ')}.</div>`
        : '';
      // Y los campos se ponen al día con lo que de verdad quedó guardado: si
      // uno se ajustó, dejar el número pedido en pantalla sería seguir
      // mostrando algo que el sistema no está usando.
      if (r && r.valores) {
        content().querySelectorAll('[data-clave]').forEach((el) => {
          const quedo = r.valores[el.dataset.clave];
          if (quedo === undefined) return;
          if (el.dataset.tipo === 'boolean') el.checked = String(quedo) === '1';
          else el.value = quedo === null ? '' : quedo;
        });
      }
      document.getElementById('cfgEstado').innerHTML = avisoDeLimites + (mantenimiento
        ? `<div class="resultado warn"><b>🛠️ El sistema quedó en mantenimiento.</b> Solo puede ingresar quien tenga permiso para cambiar la configuración. Desactive esta opción para volver a la normalidad.</div>`
        : '');
      // El logo se ve en toda la pantalla —el menú, lo que se imprime—, así
      // que si cambió se vuelve a cargar para que quede puesto en todas partes
      const campoLogo = content().querySelector('[data-tipo="imagen"][data-clave="iglesia_logo"]');
      if (campoLogo && campoLogo.value !== campoLogo.dataset.antes) {
        setTimeout(() => location.reload(), 700);
        return;
      }
      // El traspaso depende del modo mantenimiento: al cambiarlo, su panel se
      // pinta de nuevo para que el botón de importar quede como corresponde
      renderTraspaso(document.getElementById('cfgTraspaso'));
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/**
 * El historial de versiones, al pie de la configuración.
 *
 * Lo primero que dice es qué versión está corriendo AHORA, preguntándoselo al
 * servidor que está atendiendo. Después de publicar, esa es siempre la
 * pregunta —«¿ya se actualizó?»— y hasta ahora había que mirar el número
 * chiquito de la pantalla de acceso, saliéndose del sistema.
 *
 * Y si la versión que corre no está en la lista, lo dice en vez de callarse:
 * significa que se publicó algo sin dejar su línea, y es mejor enterarse.
 */
async function renderVersiones(contenedor) {
  if (!contenedor) return;
  let d;
  try {
    d = await api('GET', '/configuracion/versiones');
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }

  const CUANTAS_DE_ENTRADA = 6;
  const laDeAhora = d.versiones.find((v) => v.version === d.corriendo);

  const linea = (v) => `
    <li class="${v.version === d.corriendo ? 'es-la-de-ahora' : ''}">
      <span><b class="mono">${esc(v.version)}</b> <span class="mut">${fechaCorta(v.fecha)}</span></span>
      <span>${esc(v.titulo)}${v.version === d.corriendo ? ' <span class="badge green">la que está corriendo</span>' : ''}</span>
    </li>`;

  contenedor.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="toolbar">
        <b>🏷️ Historial de versiones</b>
        <span class="spacer"></span>
        <span class="mut">Corriendo la <b class="mono">${esc(d.corriendo)}</b></span>
      </div>
      <div class="respaldo">
        ${d.anotada
          ? `<p class="mut">Este servidor está atendiendo con la versión <b>${esc(d.corriendo)}</b>${
              laDeAhora ? `, publicada el ${fechaCorta(laDeAhora.fecha)}` : ''}. Si acaba de publicar
              una versión nueva y acá sigue diciendo la anterior, el servidor todavía no se reinició.</p>`
          : `<div class="resultado warn">⚠️ Está corriendo la versión <b>${esc(d.corriendo)}</b>, que no está
              anotada en el historial. Alguien publicó sin dejar su línea en <code>server/versiones.js</code>.</div>`}
        <ul class="mini-list versiones-lista">
          ${d.versiones.slice(0, CUANTAS_DE_ENTRADA).map(linea).join('')}
        </ul>
        ${d.versiones.length > CUANTAS_DE_ENTRADA ? `
          <ul class="mini-list versiones-lista" id="versionesResto" hidden>
            ${d.versiones.slice(CUANTAS_DE_ENTRADA).map(linea).join('')}
          </ul>
          <button class="btn sm secondary" id="versionesTodas" style="margin-top:10px">
            Ver las ${d.versiones.length - CUANTAS_DE_ENTRADA} anteriores
          </button>` : ''}
        <p class="mut" style="font-size:12px; margin-top:10px">
          Las versiones anteriores a la 1.58.0 son de antes de este registro.
        </p>
      </div>
    </div>`;

  const boton = document.getElementById('versionesTodas');
  if (boton) {
    boton.addEventListener('click', () => {
      const resto = document.getElementById('versionesResto');
      resto.hidden = !resto.hidden;
      boton.textContent = resto.hidden
        ? `Ver las ${d.versiones.length - CUANTAS_DE_ENTRADA} anteriores`
        : 'Ver solo las últimas';
    });
  }
}

/* =====================================================================
 * Traspaso desde el sistema anterior
 *
 * La importación se puede correr desde la consola del servidor, pero quien
 * tiene que mirar los conteos y decir "sí, esos son nuestros datos" es la
 * iglesia. Esta pantalla pone lo mismo al alcance de la mano, en cuatro
 * pasos y en el orden en que hay que hacerlos:
 *
 *   1. guardar un respaldo de lo que hay hoy;
 *   2. el ensayo, que hace todo el trabajo y lo deshace al final;
 *   3. la importación de verdad, que exige el modo mantenimiento;
 *   4. el informe, que compara las dos bases y revisa las relaciones.
 * ===================================================================== */

/** La salida del traspaso, tal como se vería en la consola del servidor. */
function pintarConsola(titulo, lineas, clase) {
  const salida = document.getElementById('tpSalida');
  if (!salida) return null;
  salida.innerHTML = `
    <div class="consola ${clase || ''}">
      <div class="consola-cab">
        <b>${esc(titulo)}</b>
        <button class="btn secondary sm" id="tpCerrar">Cerrar</button>
      </div>
      <pre>${esc(lineas.join('\n'))}</pre>
    </div>`;
  document.getElementById('tpCerrar').addEventListener('click', () => { salida.innerHTML = ''; });
  salida.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return salida;
}

/** El informe del traspaso en pantalla, con su botón para guardarlo. */
function mostrarInforme(contenedor, r) {
  const salida = pintarConsola(
    r.guardado ? '📋 Informe del traspaso (el que quedó guardado)' : '📋 Informe de la importación',
    r.texto.split('\n'),
    r.todo_cuadra === false ? 'mal' : 'bien'
  );
  if (!salida) return;

  const guardar = document.createElement('button');
  guardar.className = 'btn secondary sm';
  guardar.textContent = '⬇️ Guardarlo';
  guardar.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([r.texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `informe-importacion-${HOY()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  salida.querySelector('.consola-cab').appendChild(guardar);
}

async function renderTraspaso(contenedor, mostrarDespues) {
  // Sin la llave del traspaso no se pregunta siquiera: preguntar y comerse el
  // 403 funcionaba, pero dejaba un error en la consola del navegador de alguien
  // que no hizo nada mal.
  if (!tieneLlave('sistema_importacion')) {
    if (contenedor) contenedor.innerHTML = '';
    return;
  }
  // Desde que la configuración va en pestañas, este panel puede no estar en la
  // pantalla: su pestaña quizá no se abrió nunca. Se llama igual al guardar,
  // porque el traspaso depende del modo mantenimiento.
  if (!contenedor) return;
  let estado;
  try {
    estado = await api('GET', '/importacion/estado');
  } catch (e) {
    contenedor.innerHTML = ''; // sin permiso o sin el módulo: no se muestra
    return;
  }

  const filas = [
    ['miembros', 'Miembros'], ['cuerpos', 'Cuerpos y grupos'], ['actividades', 'Actividades'],
    ['marcas', 'Marcas de asistencia'], ['servicios', 'Servicios'], ['movimientos', 'Movimientos de tesorería'],
    ['anotaciones', 'Anotaciones de bitácora'], ['documentos', 'Documentos'], ['usuarios', 'Usuarios'],
  ];

  const sinOrigen = !estado.origen;
  const yaImportado = estado.ya_importado > 0;

  contenedor.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="toolbar">
        <b>🚚 Traspaso desde el sistema anterior</b>
        <span class="spacer"></span>
        ${yaImportado ? `<span class="badge blue">Ya se importó una vez</span>` : ''}
      </div>

      ${sinOrigen ? `
        <div class="card-body">
          ${yaImportado ? `
            <p style="margin:0 0 10px">
              <b>El traspaso ya está hecho.</b> Hay ${estado.hoy.miembros} miembros, ${estado.hoy.cuerpos} cuerpos
              y ${estado.hoy.marcas} marcas de asistencia traídas del sistema anterior.
            </p>
            <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
              El archivo con los datos ya no está en el servidor, y así corresponde: los datos de la iglesia
              están en el sistema, no dando vueltas en un archivo. El informe de aquel día quedó guardado.
            </p>
            ${estado.hay_informe_guardado
              ? `<button class="btn secondary sm" id="tpInformeSolo">📋 Ver el informe del traspaso</button>`
              : ''}` : `
            <p style="margin:0 0 10px"><b>No hay ningún archivo con los datos del sistema anterior.</b></p>
            <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
              Para traspasarlos, suba acá el volcado que entrega el sistema antiguo. Queda guardado junto a
              la base de datos, no dentro del programa.
            </p>`}
          <div class="fld full" style="margin-top:10px">
            <label>${yaImportado ? 'Si necesita volver a traspasar, suba el archivo de nuevo' : 'Archivo del volcado (.json)'}</label>
            <input type="file" id="tpArchivo" accept="application/json,.json" />
            <div class="help">Se acepta el volcado completo del sistema anterior, en formato JSON.</div>
          </div>
        </div>` : `
        <div class="card-body" style="padding-bottom:6px">
          <p style="margin:0 0 12px;color:var(--muted);font-size:13.5px">
            Archivo <b>${esc(estado.origen.archivo)}</b> · volcado del ${esc(String(estado.origen.lote).slice(0, 10))}.
            La importación se puede repetir sin miedo: cada registro se reconoce y se actualiza, no se duplica.
          </p>
          <div class="table-scroll">
            <table class="grid">
              <thead><tr><th>Qué</th><th style="text-align:right">Archivo</th><th style="text-align:right">Hoy</th></tr></thead>
              <tbody>
                ${filas.map(([clave, etiqueta]) => `
                  <tr>
                    <td>${esc(etiqueta)}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">${estado.origen.trae[clave]}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">${estado.hoy[clave]}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="traspaso-pasos">
          <div class="tp">
            <b>1 · Guardar lo que hay</b>
            <span>Un respaldo de la base completa, en su computador, por si algo sale mal.</span>
            <button class="btn secondary sm" id="tpRespaldo">💾 Descargar respaldo</button>
          </div>
          <div class="tp">
            <b>2 · Dejar la base como nueva</b>
            <span>Saca lo que se haya cargado probando. Muestra primero qué hay, para reconocerlo.</span>
            <button class="btn secondary sm" id="tpLimpiar">🧹 Ver qué hay hoy</button>
          </div>
          <div class="tp">
            <b>3 · Ensayo</b>
            <span>Hace todo el trabajo y lo deshace al final. Sirve para ver los conteos sin tocar nada.</span>
            <button class="btn secondary sm" id="tpEnsayo">🧪 Correr el ensayo</button>
          </div>
          <div class="tp">
            <b>4 · Importar de verdad</b>
            <span>
              ${estado.mantenimiento
                ? 'El sistema está en mantenimiento: se puede importar.'
                : 'Primero active el modo mantenimiento, arriba en esta misma pantalla.'}
            </span>
            <button class="btn sm" id="tpImportar" ${estado.mantenimiento && estado.ultimo_ensayo ? '' : 'disabled'}>📥 Importar</button>
          </div>
          <div class="tp">
            <b>5 · Verificar</b>
            <span>Compara las dos bases módulo por módulo y revisa que las relaciones quedaran intactas.</span>
            <button class="btn secondary sm" id="tpInforme">📋 Ver el informe</button>
          </div>
          <!--
            El paso que faltaba. La ruta para sacar el archivo existía desde el
            principio y esta pantalla nunca la ofrecía, así que el volcado se
            quedaba en el servidor para siempre: una copia entera de los datos
            del sistema anterior —nombres, RUT, teléfonos, direcciones— que ya
            no sirve para nada. El dato que no está no se puede filtrar.
          -->
          <div class="tp">
            <b>6 · Sacar el archivo</b>
            <span>
              ${yaImportado
                ? 'El traspaso ya está hecho: los datos viven en el sistema y este archivo ya no hace falta. El informe queda igual.'
                : 'Cuando el traspaso esté hecho, conviene sacarlo: es una copia completa de los datos del sistema anterior.'}
            </span>
            <button class="btn ${yaImportado ? '' : 'secondary '}sm" id="tpSacarOrigen">🗑️ Sacar el archivo del servidor</button>
          </div>
        </div>

        `}
      <div id="tpSalida"></div>
    </div>`;

  // Subir el volcado del sistema anterior: es lo único que hace falta cuando
  // el archivo no está en el servidor
  const archivo = document.getElementById('tpArchivo');
  if (archivo) {
    archivo.addEventListener('change', async () => {
      const elegido = archivo.files && archivo.files[0];
      if (!elegido) return;
      archivo.disabled = true;
      const cuerpo = new FormData();
      cuerpo.append('archivo', elegido);
      try {
        const r = await api('POST', '/importacion/origen', cuerpo, true);
        toast(`Archivo recibido: ${r.miembros} miembros`);
        renderTraspaso(contenedor);
      } catch (e) {
        toast(e.message, true);
        archivo.disabled = false;
      }
    });
  }

  if (sinOrigen) {
    const soloInforme = document.getElementById('tpInformeSolo');
    if (soloInforme) {
      soloInforme.addEventListener('click', async () => {
        soloInforme.disabled = true;
        try {
          const r = await api('GET', '/importacion/informe');
          mostrarInforme(contenedor, r);
        } catch (e) {
          toast(e.message, true);
        } finally {
          soloInforme.disabled = false;
        }
      });
    }
    return;
  }

  const salida = document.getElementById('tpSalida');
  const pintar = (titulo, lineas, clase) => pintarConsola(titulo, lineas, clase);

  const correr = async (boton, prueba) => {
    const texto = boton.textContent;
    boton.disabled = true;
    boton.textContent = prueba ? 'Ensayando…' : 'Importando…';
    salida.innerHTML = `<div class="consola"><pre>Trabajando… no cierre esta página.</pre></div>`;
    try {
      const r = await api('POST', '/importacion/correr', { prueba, ruts: 'conservar' });
      pintar(
        `${prueba ? '🧪 Ensayo' : '📥 Importación'} · ${r.segundos} segundos`,
        r.lineas,
        r.error ? 'mal' : 'bien'
      );
      if (!r.error) toast(prueba ? 'El ensayo terminó bien' : 'Importación terminada');
      else toast('La importación se detuvo: revise el detalle', true);
      if (!r.error) {
        // El panel se pinta de nuevo —tras el ensayo, para habilitar el botón
        // de importar; tras la importación, porque los conteos cambiaron—, y
        // lo que acaba de pasar se queda en pantalla: es lo que hay que leer.
        renderTraspaso(contenedor, {
          titulo: `${prueba ? '🧪 Ensayo' : '📥 Importación'} · ${r.segundos} segundos`,
          lineas: r.lineas,
          clase: 'bien',
        });
      }
    } catch (e) {
      pintar('No se pudo correr', [e.message], 'mal');
      toast(e.message, true);
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  };

  if (mostrarDespues) pintar(mostrarDespues.titulo, mostrarDespues.lineas, mostrarDespues.clase);

  document.getElementById('tpEnsayo').addEventListener('click', (e) => correr(e.currentTarget, true));

  document.getElementById('tpLimpiar').addEventListener('click', () => abrirLimpieza(contenedor));

  document.getElementById('tpImportar').addEventListener('click', (e) => {
    if (!confirm(
      '¿Importar los datos del sistema anterior?\n\n' +
      'Se puede repetir sin duplicar nada, pero conviene tener el respaldo guardado antes.'
    )) return;
    correr(e.currentTarget, false);
  });

  document.getElementById('tpInforme').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;
    try {
      mostrarInforme(contenedor, await api('GET', '/importacion/informe'));
    } catch (err) {
      toast(err.message, true);
    } finally {
      boton.disabled = false;
    }
  });

  /*
   * Sacar el volcado del servidor.
   *
   * Es un borrado y no se deshace, así que se pregunta antes y se dice
   * exactamente qué se va y qué se queda: lo que desaparece es el archivo del
   * sistema anterior, no lo que ya se importó. Si mañana hiciera falta otra
   * vez, se vuelve a subir.
   */
  document.getElementById('tpSacarOrigen').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    if (!confirm(
      '¿Sacar del servidor el archivo con los datos del sistema anterior?\n\n' +
      'NO se toca nada de lo que ya está en el sistema: los miembros, la tesorería y todo lo\n' +
      'demás quedan como están, y el informe del traspaso también.\n\n' +
      'Lo que se va es el archivo del volcado. Si algún día hace falta, se vuelve a subir.'
    )) return;
    boton.disabled = true;
    try {
      const r = await api('DELETE', '/importacion/origen');
      toast(r && r.ya_no_estaba ? 'El archivo ya no estaba' : 'El archivo salió del servidor');
      renderTraspaso(contenedor);
    } catch (err) {
      toast(err.message, true);
      boton.disabled = false;
    }
  });

  document.getElementById('tpRespaldo').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;
    boton.textContent = 'Preparando…';
    try {
      const r = await fetch('/api/importacion/respaldo', { headers: { Authorization: 'Bearer ' + TOKEN } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo preparar el respaldo');
      const nombre = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre ? nombre[1] : 'respaldo.db';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Respaldo descargado');
    } catch (err) {
      toast(err.message, true);
    } finally {
      boton.disabled = false;
      boton.textContent = '💾 Descargar respaldo';
    }
  });
}

/**
 * Dejar la base como nueva, antes de traer los datos de verdad.
 *
 * Primero se muestra qué hay —los módulos con datos, y los miembros con
 * nombre y apellido— para poder mirarlo y reconocer si es todo de prueba.
 * Recién entonces aparece el botón, y hay que escribir la palabra completa:
 * es lo único del sistema que no se puede deshacer.
 */
async function abrirLimpieza(contenedor) {
  let d;
  try {
    d = await api('GET', '/importacion/limpieza');
  } catch (e) {
    return toast(e.message, true);
  }

  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:620px">
      <div class="modal-head"><h3>🧹 Dejar la base como nueva</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body">
        ${d.total === 0 ? `
          <p class="modal-nota" style="margin-top:0">
            No hay nada que sacar: la base está limpia y lista para importar.
          </p>` : `
          <p class="modal-nota" style="margin-top:0">
            Esto es lo que hay hoy en el sistema. Mírelo antes: lo que se saque
            <b>no se puede recuperar</b> si no tiene el respaldo guardado.
          </p>

          <table class="grid" style="margin-bottom:14px">
            <thead><tr><th>Módulo</th><th style="text-align:right">Registros</th></tr></thead>
            <tbody>
              ${d.tablas.map((t) => `
                <tr><td>${esc(t.etiqueta)}</td>
                    <td style="text-align:right;font-variant-numeric:tabular-nums">${t.filas}</td></tr>`).join('')}
            </tbody>
          </table>

          ${d.miembros.length ? `
            <div class="fld full" style="margin-bottom:12px">
              <label>Las personas registradas${d.miembros_total > d.miembros.length ? ` (las primeras ${d.miembros.length} de ${d.miembros_total})` : ''}</label>
              <ul class="mini-list" style="border:1px solid var(--border);border-radius:8px;max-height:190px;overflow:auto">
                ${d.miembros.map((m) => `
                  <li><span>${esc(nombreCorto(m))}</span>
                      <span class="mut">${esc(m.rut ? rutFormatear(m.rut) : 'sin RUT')}</span></li>`).join('')}
              </ul>
            </div>` : ''}

          ${d.usuarios.length > 1 ? `
            <div class="fld full" style="margin-bottom:12px">
              <label>Cuentas de acceso</label>
              <ul class="mini-list" style="border:1px solid var(--border);border-radius:8px">
                ${d.usuarios.map((u) => `
                  <li><span>${esc(u.nombre)} ${u.es_usted ? '<span class="badge green">la suya, se queda</span>' : ''}</span>
                      <span class="mut">${esc(u.rut ? rutFormatear(u.rut) : '—')}</span></li>`).join('')}
              </ul>
            </div>` : ''}

          <p style="font-size:13.5px;color:var(--muted);margin:0 0 12px">
            Quedan la iglesia, sus cuentas de tesorería, la configuración y la cuenta con la que
            usted está entrando. Todo lo demás se va.
          </p>

          ${d.mantenimiento ? '' : `
            <div class="resultado warn" style="margin-bottom:12px">
              Antes hay que activar el <b>modo mantenimiento</b>, arriba en esta misma pantalla.
            </div>`}

          <div class="fld full">
            <label>Para confirmar, escriba <b>BORRAR</b></label>
            <input type="text" id="limpConfirma" autocomplete="off" placeholder="BORRAR" ${d.mantenimiento ? '' : 'disabled'} />
          </div>
          <div class="form-error" id="limpError" style="padding:0"></div>`}
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="limpCancelar">${d.total === 0 ? 'Cerrar' : 'Mejor no'}</button>
        ${d.total === 0 ? '' : `<button class="btn danger" id="limpBorrar" disabled>🧹 Vaciar la base</button>`}
      </div>
    </div>`;
  document.body.appendChild(fondo);

  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#limpCancelar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  if (d.total === 0) return;

  const boton = fondo.querySelector('#limpBorrar');
  const escrito = fondo.querySelector('#limpConfirma');
  escrito.addEventListener('input', () => {
    boton.disabled = escrito.value.trim().toUpperCase() !== 'BORRAR';
  });

  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = 'Vaciando…';
    try {
      const r = await api('POST', '/importacion/limpieza', { confirmacion: escrito.value });
      cerrar();
      toast(`La base quedó como nueva: salieron ${r.total} registros`);
      renderTraspaso(contenedor, {
        titulo: '🧹 La base quedó como nueva',
        clase: 'bien',
        lineas: [
          'Salieron estos registros:',
          '',
          ...Object.entries(r.vaciadas).map(([t, n]) => `   ${String(n).padStart(6)}  ${t}`),
          '',
          'Quedaron la iglesia, sus cuentas de tesorería, la configuración y su cuenta.',
          'El ensayo hay que correrlo de nuevo: la base es otra.',
        ],
      });
    } catch (e) {
      fondo.querySelector('#limpError').textContent = e.message;
      boton.disabled = false;
      boton.textContent = '🧹 Vaciar la base';
    }
  });
}

/* =====================================================================
 * Editor de permisos personalizados por usuario
 * ===================================================================== */
/**
 * Combinaciones que se repiten, para no tener que marcar casilla por casilla.
 * Son las que se piden de verdad: alguien que solo mira, alguien que anota
 * pero no borra, alguien que corrige lo que ya está pero no agrega.
 */
const ATAJOS_PERMISO = [
  { clave: 'nada', texto: 'Nada', titulo: 'Este módulo no le aparece', acciones: [] },
  { clave: 'ver', texto: 'Solo ver', titulo: 'Puede mirar, no tocar', acciones: ['view'] },
  { clave: 'corregir', texto: 'Ver y corregir', titulo: 'Puede mirar y corregir lo que ya está, pero no agregar ni eliminar', acciones: ['view', 'edit'] },
  { clave: 'anotar', texto: 'Ver, agregar y corregir', titulo: 'Puede trabajar en el módulo, pero no eliminar nada', acciones: ['view', 'create', 'edit'] },
  { clave: 'todo', texto: 'Todo', titulo: 'Incluye eliminar', acciones: ['view', 'create', 'edit', 'delete'] },
];

/**
 * Editor de una tabla de permisos. Lo usan dos pantallas:
 *
 *   · el PERFIL, donde se arma el juego de permisos de un trabajo —«Tesorero
 *     de cuerpo»— desde cero;
 *   · el USUARIO, donde se ajustan las excepciones de una persona sobre lo
 *     que ya le da su perfil o su rol.
 *
 * Cada módulo se deja en uno de cinco escalones —nada, solo ver, ver y
 * corregir, ver agregar y corregir, todo— o se marcan las casillas sueltas,
 * para los casos que no calzan con ninguno. Lo que queda se resume abajo en
 * castellano, para revisarlo sin leer una tabla de cien casillas.
 */
function initPermisos(f, row, rolActual) {
  const caja = document.getElementById('perm_' + f.name);
  if (!caja || !PERMISOS_CATALOGO) return;

  const asignados = row[f.name] && typeof row[f.name] === 'object' ? { ...row[f.name] } : {};
  const { acciones, modulos, porRol } = PERMISOS_CATALOGO;
  const PERFILES_ASIGNABLES = PERMISOS_CATALOGO.perfiles || {};
  let buscando = '';
  const cerrados = new Set();

  const mismasAcciones = (a, b) => {
    const x = [...(a || [])].sort().join(',');
    const y = [...(b || [])].sort().join(',');
    return x === y;
  };
  const atajoDe = (lista) => (ATAJOS_PERMISO.find((a) => mismasAcciones(a.acciones, lista)) || {}).clave || null;

  /**
   * Qué acciones tienen sentido para esta fila.
   *
   * Los módulos admiten las cuatro. Las llaves del sistema no: «eliminar la
   * configuración» no significa nada, y ofrecerlo sería ruido. Cada llave dice
   * cuáles admite y acá se recorta todo a esa lista —las casillas, los atajos
   * y el atajo de grupo— para que no se pueda marcar algo que no existe.
   */
  const acepta = (m) => (Array.isArray(m.acciones) && m.acciones.length ? m.acciones : acciones.map((a) => a.value));
  const recortar = (m, lista) => lista.filter((a) => acepta(m).includes(a));
  const nombreDe = (v) => (acciones.find((a) => a.value === v) || {}).label || v;
  const atajosDe = (m) => {
    const vistos = new Set();
    // Una llave de una sola acción se tiene o no se tiene: ahí «Nada» y «Solo
    // ver» son una manera rebuscada de decir no y sí, y así se dicen.
    const deSiONo = acepta(m).length === 1;
    return ATAJOS_PERMISO
      .map((a) => {
        const queda = recortar(m, a.acciones);
        if (deSiONo) {
          return queda.length
            ? { ...a, acciones: queda, texto: 'Sí', titulo: `La tiene: ${m.label.toLowerCase()}` }
            : { ...a, acciones: queda, texto: 'No', titulo: `No la tiene: ${m.label.toLowerCase()}` };
        }
        // Si al recortar el atajo dejó de ser lo que su nombre decía, se
        // renombra con lo que de verdad hace: en Respaldos, «Ver, agregar y
        // corregir» quedaba en ver y crear, y el letrero mentía.
        const cambio = queda.length !== a.acciones.length;
        const texto = !cambio || !queda.length ? a.texto : queda.map(nombreDe).join(' + ');
        return { ...a, acciones: queda, texto, titulo: cambio && queda.length ? `Puede: ${texto.toLowerCase()}` : a.titulo };
      })
      .filter((a) => {
        const firma = [...a.acciones].sort().join(',');
        if (vistos.has(firma)) return false; // dos atajos que quedan iguales al recortar
        vistos.add(firma);
        return true;
      });
  };

  const grupos = () => {
    const porGrupo = new Map();
    const texto = buscando.trim().toLowerCase();
    for (const m of modulos) {
      if (texto && !`${m.label} ${m.group}`.toLowerCase().includes(texto)) continue;
      if (!porGrupo.has(m.group)) porGrupo.set(m.group, []);
      porGrupo.get(m.group).push(m);
    }
    return [...porGrupo.entries()];
  };

  // En la ficha de un perfil no hay rol: el perfil se arma desde cero
  const esPerfil = f.name === 'permisos' && !document.querySelector('#recForm [name="rol"]') && !rolActual;

  const dibujar = () => {
    const selRol = document.querySelector('#recForm [name="rol"]');
    const rol = selRol ? selRol.value : rolActual;
    const selPerfil = document.querySelector('#recForm [name="perfil_id"]');
    const perfilId = selPerfil ? selPerfil.value : null;
    const delPerfil = perfilId && PERFILES_ASIGNABLES[perfilId] ? PERFILES_ASIGNABLES[perfilId].permisos : null;
    // De dónde sale lo que NO se ajuste acá: el perfil si tiene, si no el rol
    const base = esPerfil ? {} : (delPerfil || porRol[rol] || {});
    const deDonde = esPerfil ? '' : delPerfil ? 'su perfil' : 'su rol';
    const efectivosDe = (m) => (Array.isArray(asignados[m.name]) ? asignados[m.name] : (base[m.name] || []));

    const personalizados = Object.keys(asignados).length;
    const resumen = modulos
      .map((m) => ({ m, acc: efectivosDe(m) }))
      .filter((x) => x.acc.length)
      .map((x) => {
        const atajo = ATAJOS_PERMISO.find((a) => mismasAcciones(a.acciones, x.acc));
        // Una llave de una sola acción se resume como lo que es: la tiene
        const como = acepta(x.m).length === 1
          ? 'sí'
          : atajo
            ? atajo.texto.toLowerCase()
            : x.acc.map((a) => (acciones.find((y) => y.value === a) || {}).label || a).join(' + ').toLowerCase();
        return `<li><b>${esc(x.m.label)}</b><span class="mut">${esc(como)}</span></li>`;
      });

    caja.innerHTML = `
      <div class="perm-cabecera">
        <span>${esPerfil
          ? 'Marque lo que va a poder hacer quien tenga este perfil. Lo que quede sin marcar, no lo podrá hacer.'
          : `Acá van solo las <b>excepciones</b> de esta persona. Lo que no se ajuste sigue ${deDonde}.`}</span>
        <button type="button" class="btn secondary sm" id="permLimpiar" ${personalizados ? '' : 'disabled'}>
          ${esPerfil ? 'Desmarcar todo' : `Sin excepciones${personalizados ? ` (${personalizados})` : ''}`}</button>
      </div>

      <div class="perm-buscar">
        <input type="search" id="permBuscar" placeholder="Buscar un módulo…" value="${esc(buscando)}" autocomplete="off" />
      </div>

      <div class="perm-grupos">
        ${grupos().map(([grupo, suyos]) => {
          const abierto = !cerrados.has(grupo);
          return `
          <div class="perm-grupo ${abierto ? '' : 'cerrado'}">
            <div class="pg-cab" data-grupo="${esc(grupo)}">
              <span class="flecha">${abierto ? '▾' : '▸'}</span>
              <b>${esc(grupo)}</b>
              <span class="mut">${suyos.length} módulo(s)</span>
              <span class="spacer"></span>
              ${(() => {
                // El atajo de grupo solo ofrece lo que ese grupo admite: en
                // «Datos reservados», donde las llaves son de solo ver,
                // ofrecer «Todo» daría a entender algo que no existe. Y si
                // todas las de ese grupo se tienen o no se tienen, el atajo se
                // dice como se dicen ellas: no y sí.
                const vistos = new Set();
                const grupoDeSiONo = suyos.every((m) => acepta(m).length === 1);
                return ATAJOS_PERMISO
                  .map((a) => {
                    const util = suyos.some((m) => recortar(m, a.acciones).length === a.acciones.length);
                    if (!util) return null;
                    return grupoDeSiONo ? { ...a, texto: a.acciones.length ? 'Sí' : 'No' } : a;
                  })
                  .filter((a) => {
                    if (!a) return false;
                    const firma = [...a.acciones].sort().join(',');
                    if (vistos.has(firma)) return false;
                    vistos.add(firma);
                    return true;
                  })
                  .map((a) => `
                <button type="button" class="chip sm" data-grupo-atajo="${esc(grupo)}" data-atajo="${a.clave}"
                  title="Aplicar «${esc(a.texto)}» a todo ${esc(grupo)}">${esc(a.texto)}</button>`).join('');
              })()}
            </div>
            ${abierto ? `
            <table class="perm-tabla">
              <thead><tr>
                <th>Módulo</th>
                <th class="atajos">Qué puede hacer</th>
                ${acciones.map((a) => `<th class="c">${esc(a.label)}</th>`).join('')}
              </tr></thead>
              <tbody>
                ${suyos.map((m) => {
                  const propio = Array.isArray(asignados[m.name]);
                  const efectivos = efectivosDe(m);
                  return `<tr class="${propio ? 'personalizado' : ''}">
                    <td class="nom">${esc(m.label)}
                      ${propio ? '<span class="marca" title="Personalizado para esta persona">•</span>' : ''}
                      ${m.ayuda ? `<span class="mut nota">${esc(m.ayuda)}</span>` : ''}</td>
                    <td class="atajos">
                      ${atajosDe(m).map((a) => `
                        <button type="button" class="chip ${mismasAcciones(a.acciones, efectivos) ? 'on' : ''}"
                          data-mod="${m.name}" data-atajo="${a.clave}" title="${esc(a.titulo)}">${esc(a.texto)}</button>`).join('')}
                    </td>
                    ${acciones.map((a) => {
                      // La celda dice a qué acción corresponde y si acá tiene
                      // sentido. En el computador esto no hace falta —la
                      // columna lo dice arriba— pero en el teléfono la tabla se
                      // dibuja como tarjetas y el encabezado ya no está, así
                      // que cada casilla lleva su nombre al lado y las que no
                      // aplican se guardan (ver styles.css).
                      const aplica = acepta(m).includes(a.value);
                      return `
                      <td class="c${aplica ? '' : ' sin-sentido'}" data-label="${esc(a.label)}">
                        ${aplica
                          ? `<input type="checkbox" class="perm-acc" data-mod="${m.name}" data-acc="${a.value}"
                               aria-label="${esc(a.label)} · ${esc(m.label)}"
                               ${efectivos.includes(a.value) ? 'checked' : ''} />`
                          : '<span class="no-aplica" title="Esta acción no tiene sentido acá">—</span>'}
                      </td>`;
                    }).join('')}
                  </tr>`;
                }).join('')}
              </tbody>
            </table>` : ''}
          </div>`;
        }).join('')}
      </div>

      <div class="perm-resumen">
        <b>${esPerfil ? 'Quien tenga este perfil podrá:' : 'Al final, esta persona podrá:'}</b>
        ${resumen.length ? `<ul>${resumen.join('')}</ul>` : '<p class="mut">Nada todavía: no hay ningún módulo con permiso.</p>'}
        <p class="mut">${esPerfil
          ? 'Y solo sobre las iglesias y los cuerpos que tenga asignados cada usuario en su ficha.'
          : 'Y solo sobre las iglesias y los cuerpos que tenga asignados más arriba.'}</p>
      </div>`;

    caja.dataset.value = JSON.stringify(asignados);

    // ---- lo que hace cada control ----
    const ponerA = (modulo, atajo) => {
      const a = ATAJOS_PERMISO.find((x) => x.clave === atajo);
      const m = modulos.find((x) => x.name === modulo);
      if (!a || !m) return;
      asignados[modulo] = recortar(m, a.acciones);
    };

    caja.querySelectorAll('[data-atajo][data-mod]').forEach((b) =>
      b.addEventListener('click', () => { ponerA(b.dataset.mod, b.dataset.atajo); dibujar(); }));

    caja.querySelectorAll('[data-grupo-atajo]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const m of modulos.filter((x) => x.group === b.dataset.grupoAtajo)) ponerA(m.name, b.dataset.atajo);
        dibujar();
      }));

    caja.querySelectorAll('.pg-cab').forEach((cab) =>
      cab.addEventListener('click', () => {
        const g = cab.dataset.grupo;
        cerrados.has(g) ? cerrados.delete(g) : cerrados.add(g);
        dibujar();
      }));

    caja.querySelectorAll('.perm-acc').forEach((cb) =>
      cb.addEventListener('change', () => {
        const mod = cb.dataset.mod;
        const desde = Array.isArray(asignados[mod]) ? asignados[mod] : (base[mod] || []);
        const set = new Set(desde);
        cb.checked ? set.add(cb.dataset.acc) : set.delete(cb.dataset.acc);
        // Sin poder mirar no se puede hacer nada más: se van los demás con él
        if (cb.dataset.acc === 'view' && !cb.checked) set.clear();
        else if (set.size) set.add('view');
        const suyo = modulos.find((x) => x.name === mod);
        asignados[mod] = suyo ? recortar(suyo, [...set]) : [...set];
        dibujar();
      }));

    const limpiar = caja.querySelector('#permLimpiar');
    if (limpiar) limpiar.addEventListener('click', () => {
      Object.keys(asignados).forEach((k) => delete asignados[k]);
      dibujar();
    });

    const buscador = caja.querySelector('#permBuscar');
    if (buscador) {
      buscador.addEventListener('input', () => {
        buscando = buscador.value;
        dibujar();
        const otra = caja.querySelector('#permBuscar');
        if (otra) { otra.focus(); otra.setSelectionRange(otra.value.length, otra.value.length); }
      });
    }
  };

  dibujar();
  const selRol = document.querySelector('#recForm [name="rol"]');
  if (selRol) selRol.addEventListener('change', dibujar);
  const selPerfil = document.querySelector('#recForm [name="perfil_id"]');
  if (selPerfil) selPerfil.addEventListener('change', dibujar);
}

/* =====================================================================
 * Historial (bitácora) dentro de la ficha del miembro
 * ===================================================================== */
/**
 * En el formulario de traspaso, muestra el saldo de la cuenta de origen al
 * elegirla: así se ve de inmediato con cuánto se cuenta antes de traspasar.
 */
function mostrarSaldoOrigen() {
  const form = document.getElementById('recForm');
  const select = form && form.querySelector('[name="cuenta_origen_id"]');
  if (!select) return;
  const marca = document.createElement('div');
  marca.className = 'saldo-origen';
  /*
   * Debajo del campo, no dentro de él. Cuando la lista de cuentas es larga el
   * campo no es un desplegable sino un buscador, y ese buscador es una caja con
   * el campo oculto adentro: colgando el aviso del campo, el saldo quedaba
   * ARRIBA de la casilla donde se escribe, metido entre medio de sus partes.
   * Se cuelga de la caja entera cuando la hay, que es lo que se ve en pantalla.
   */
  const caja = select.closest('.refbuscar') || select;
  caja.parentNode.insertBefore(marca, caja.nextSibling);

  const refrescar = async () => {
    if (!select.value) {
      marca.textContent = '';
      return;
    }
    marca.textContent = 'Consultando el saldo…';
    try {
      const e = await api('GET', `/cuentas_tesoreria/${select.value}/estado`);
      // Quien no alcanza la llave de los montos anota movimientos igual; lo que
      // no ve es cuánto hay. Se dice, en vez de escribir «Saldo disponible hoy:»
      // sin número al lado.
      if (sinCifras(e)) { marca.innerHTML = '<span class="mut">🔒 El saldo de esta cuenta es reservado.</span>'; return; }
      marca.innerHTML = `Saldo disponible hoy: <b class="${e.saldo < 0 ? 'saldo-negativo' : ''}">${fmtMoney(e.saldo)}</b>`
        + (Number(e.agendado)
          ? ` <span class="mut">(y ${fmtMoney(e.agendado)} agendado para más adelante)</span>` : '');
    } catch (err) {
      marca.textContent = '';
    }
  };
  select.addEventListener('change', refrescar);
  refrescar();
}

/**
 * El pastor y la pastora son también miembros de su iglesia. Aquí se muestra
 * si su ficha de miembro ya existe y, si no, se ofrece crearla con sus mismos
 * datos.
 */
async function renderFichaMiembroPastor(pastorId, row, contenedor) {
  const modMiembros = MOD['miembros'];
  if (!modMiembros) return;
  let d;
  try {
    d = await api('GET', `/pastores/${pastorId}/ficha-miembro`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }

  const nivel = { ok: 'green', medio: '', bajo: 'red' }[d.nivel] || '';
  const rutTexto = (v) => (v ? rutFormatear(v) : '—');
  const explicacion = {
    'Registrado': 'Está registrado(a) también como miembro, y el RUT calza en las dos fichas.',
    'RUT distinto': 'El RUT de esta ficha y el de su ficha de miembro no son el mismo. Corrija el que esté equivocado.',
    'Falta el RUT en su ficha': 'Su ficha de miembro todavía no tiene RUT. Cuando lo tenga, debe ser el mismo de aquí.',
    'Falta el RUT aquí': 'Esta ficha no tiene RUT. Debe ser el mismo que el de su ficha de miembro.',
    'Falta registrarlo': 'El pastor y la pastora de una iglesia local son también miembros de ella. Con el botón de arriba se crea su ficha de miembro con estos mismos datos.',
  }[d.estado] || '';

  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🧍 Su ficha de miembro</b>
        <span class="spacer"></span>
        ${d.miembro ? `<button class="btn sm secondary" id="verMiembro">Abrir su ficha de miembro</button>` : ''}
        ${!d.miembro && modMiembros.perms.create ? `<button class="btn sm" id="crearMiembro">➕ Crear su ficha de miembro</button>` : ''}
        ${d.estado === 'Falta el RUT en su ficha' && modMiembros.perms.edit
          ? `<button class="btn sm" id="copiarRut">Copiar el RUT a su ficha</button>` : ''}
      </div>
      <div style="padding:14px 18px;font-size:13.5px">
        <span class="badge ${nivel}">${esc(d.estado)}</span>
        ${d.miembro ? `<b>${esc(d.miembro.nombre)}</b>` : ''}
        <div class="mut" style="margin-top:6px">${esc(explicacion)}</div>
        ${d.miembro ? `
          <table class="rut-cotejo">
            <tr><td>RUT en Pastores / Guías</td><td><b>${esc(rutTexto(d.rut_pastor))}</b></td></tr>
            <tr><td>RUT en su ficha de miembro</td><td><b class="${d.estado === 'RUT distinto' ? 'saldo-negativo' : ''}">${esc(rutTexto(d.miembro.rut))}</b></td></tr>
          </table>` : ''}
      </div>
    </div>`;

  const ver = document.getElementById('verMiembro');
  if (ver) ver.addEventListener('click', () => (location.hash = `#/m/miembros/ficha/${d.miembro.id}`));

  const crear = document.getElementById('crearMiembro');
  if (crear) {
    crear.addEventListener('click', async () => {
      crear.disabled = true;
      try {
        const r = await api('POST', `/pastores/${pastorId}/ficha-miembro`);
        toast(r.creada ? 'Ficha de miembro creada' : 'Ya existía su ficha: quedó enlazada');
        location.hash = `#/m/miembros/edit/${r.miembro_id}`;
      } catch (e) {
        toast(e.message, true);
        crear.disabled = false;
      }
    });
  }

  const copiar = document.getElementById('copiarRut');
  if (copiar) {
    copiar.addEventListener('click', async () => {
      copiar.disabled = true;
      try {
        await api('POST', `/pastores/${pastorId}/copiar-rut`);
        toast('RUT copiado a su ficha de miembro');
        renderFichaMiembroPastor(pastorId, row, contenedor);
      } catch (e) {
        toast(e.message, true);
        copiar.disabled = false;
      }
    });
  }
}

/* =====================================================================
 * Asistencia: un solo lugar
 *
 * Aquí se hace todo lo de asistencia: crear la actividad, tomar la lista y
 * ver los informes. Nada de saltar entre pantallas.
 *
 * Está pensado para el teléfono, que es donde se toma la asistencia casi
 * siempre: calendario del mes con un punto en los días que tienen actividad,
 * las actividades del día elegido, y debajo la lista para marcar con botones
 * grandes, buscador, filtros y guardado automático con respaldo en el propio
 * teléfono, para no perder nada si se corta la señal.
 * ===================================================================== */

/** Lo que se está mirando en la pantalla de Asistencia. */
const ASIS = {
  tab: 'registrar',
  vista: 'calendario',
  mes: null,          // primer día del mes que se muestra
  dia: null,          // 'YYYY-MM-DD' elegido en el calendario
  cuerpo_id: '',
  tipo: '',
  actividadId: null,
  agenda: null,
  bajadoA: null,      // a qué lista ya se bajó la pantalla: ver renderPasarLista
  // Las listas que mantiene la iglesia, pedidas una vez al abrir la pantalla:
  // los tipos de actividad y los motivos de ausencia (ver opcionesDelCampo)
  tipos: null,
  motivos: null,
};

const ISO = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
const HOY = () => ISO(new Date());
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/** Lo marcado y todavía no guardado, en el propio teléfono. */
function leerBorrador(clave) {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    return null;
  }
}
function guardarBorrador(clave, marcas) {
  try {
    localStorage.setItem(clave, JSON.stringify(marcas));
  } catch (e) {
    /* sin espacio o sin permiso: el borrador es una ayuda, no un requisito */
  }
}
function borrarBorrador(clave) {
  try {
    localStorage.removeItem(clave);
  } catch (e) {
    /* nada que hacer */
  }
}

/* ---------------- la pantalla ---------------- */

async function viewAsistencia(precarga) {
  const p = precarga || {};
  if (p.tab) ASIS.tab = p.tab === 'informes' ? 'informes' : 'registrar';
  if (p.dia) { ASIS.dia = p.dia; ASIS.mes = new Date(p.dia + 'T00:00:00'); }
  if (p.actividad) ASIS.actividadId = Number(p.actividad);
  if (!ASIS.mes) ASIS.mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (!ASIS.dia) ASIS.dia = HOY();

  // Si se llega apuntando a una actividad de otro mes —desde su ficha o desde
  // un enlace guardado—, la pantalla se ubica en el día de esa actividad, en
  // vez de abrir el mes de hoy y perderla.
  if (p.actividad && !p.dia) {
    try {
      const suya = await api('GET', `/asistencias/${Number(p.actividad)}`);
      if (suya && suya.fecha) {
        ASIS.dia = String(suya.fecha).slice(0, 10);
        ASIS.mes = new Date(ASIS.dia + 'T00:00:00');
      }
    } catch (e) {
      /* si no se puede leer, se sigue con el mes de hoy */
    }
  }

  content().innerHTML = `
    <!-- El encabezado de la pantalla y sus pestañas no se imprimen: lo que se
         imprime desde acá son los informes, y cada uno lleva su propio membrete
         y su propio título. Antes se llevaban una hoja entera para decir
         «Asistencia · Registrar · Informes». -->
    <div class="page-head no-print">
      <div>
        <h2>📋 Asistencia</h2>
        <p class="sub-iglesia">Actividades, listas e informes</p>
      </div>
      <div class="actions" id="asisAcciones"></div>
    </div>
    <div class="tabs no-print" id="asisTabs">
      <button data-tab="registrar" class="${ASIS.tab === 'registrar' ? 'on' : ''}">🖐️ Registrar</button>
      <button data-tab="informes" class="${ASIS.tab === 'informes' ? 'on' : ''}">📈 Informes</button>
    </div>
    <div id="tabRegistrar" ${ASIS.tab === 'registrar' ? '' : 'hidden'}>
      <div class="card">
        <div class="toolbar asis-filtros" id="asisFiltros"></div>
        <!-- En pantalla ancha el mes y el día elegido van uno al lado del otro -->
        <div class="asis-tablero">
          <div id="asisAgenda"><div class="empty-state" style="padding:26px">Cargando…</div></div>
          <div id="asisDelDia"></div>
        </div>
      </div>
      <div id="asisMarcar"></div>
    </div>
    <div id="tabInformes" ${ASIS.tab === 'informes' ? '' : 'hidden'}></div>`;

  content().querySelectorAll('#asisTabs button').forEach((b) => {
    b.addEventListener('click', () => {
      ASIS.tab = b.dataset.tab;
      content().querySelectorAll('#asisTabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('tabRegistrar').hidden = ASIS.tab !== 'registrar';
      document.getElementById('tabInformes').hidden = ASIS.tab === 'registrar';
      pintarAcciones();
      if (ASIS.tab === 'informes' && !document.getElementById('tabInformes').dataset.listo) {
        document.getElementById('tabInformes').dataset.listo = '1';
        renderInformeAsistencia(document.getElementById('tabInformes'));
      }
    });
  });

  await getOptions('cuerpos').catch(() => []);
  // Las listas que mantiene la iglesia, de una vez: el filtro, el diálogo de
  // la actividad y los motivos al justificar salen de acá
  [ASIS.tipos, ASIS.motivos] = await Promise.all([
    opcionesDelCampo('asistencias', 'tipo_reunion'),
    opcionesDelCampo('asistencia_detalle', 'motivo'),
  ]);
  pintarAcciones();
  pintarFiltros();
  await cargarAgenda();
  if (ASIS.tab === 'informes') {
    document.getElementById('tabInformes').dataset.listo = '1';
    /*
     * Lo que traiga la dirección se le pasa al informe.
     *
     * `#/asistencia/informes?tipo=persona&miembro_id=7` llegaba hasta acá y se
     * perdía: el informe se armaba en blanco y salía el general. Se veía al
     * entrar desde la ficha de una persona, que es justo para lo que existe
     * ese enlace. Solo en la primera pintada: al cambiar de pestaña a mano,
     * lo que se quiere es el informe que uno estaba mirando, no el del enlace.
     */
    renderInformeAsistencia(document.getElementById('tabInformes'), p);
  }
}

/** Los botones de la cabecera, distintos en cada pestaña. */
function pintarAcciones() {
  const zona = document.getElementById('asisAcciones');
  if (!zona) return;
  zona.innerHTML = ASIS.tab === 'informes'
    ? `<button class="btn secondary" id="asisPDF">🖨️ PDF</button>
       ${tieneLlave('datos_planilla') ? '<button class="btn secondary" id="asisExcel">⬇️ Excel</button>' : ''}`
    : `<button class="btn secondary" id="asisHoy">📅 Hoy</button>`;
  const pdf = document.getElementById('asisPDF');
  if (pdf) pdf.addEventListener('click', () => window.print());
  const excel = document.getElementById('asisExcel');
  if (excel) excel.addEventListener('click', exportarInformeCSV);
  const hoy = document.getElementById('asisHoy');
  if (hoy) {
    hoy.addEventListener('click', () => {
      ASIS.dia = HOY();
      ASIS.mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      ASIS.actividadId = null; ASIS.bajadoA = null;
      cargarAgenda();
    });
  }
}

function pintarFiltros() {
  const cuerpos = optionsCache['cuerpos'] || [];
  // Los tipos los mantiene la iglesia, así que vienen de su ruta y no del
  // campo. Ya están pedidos al abrir la pantalla (ver viewAsistencia).
  const tipos = ASIS.tipos || [];
  const zona = document.getElementById('asisFiltros');
  zona.innerHTML = `
    <!-- El «title» es la explicación que sale al pasar por encima; el nombre
         corto va aparte, porque es lo que se anuncia al llegar al campo. -->
    <select id="asisCuerpo" aria-label="Cuerpo con el que se trabaja"
            title="Con qué cuerpo se está trabajando: filtra las actividades del calendario y abre sus listas mostrando a sus integrantes">
      <option value="">Todos los cuerpos</option>
      ${cuerpos.map((c) => `<option value="${c.id}" ${String(ASIS.cuerpo_id) === String(c.id) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
    </select>
    <select id="asisTipo" aria-label="Filtrar por tipo de actividad">
      <option value="">Todos los tipos</option>
      ${tipos.map((t) => `<option value="${esc(t)}" ${ASIS.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>
    <span class="spacer"></span>
    <div class="vista-toggle" id="asisVista">
      <button type="button" data-vista="calendario" class="${ASIS.vista === 'calendario' ? 'on' : ''}" title="Calendario">🗓️</button>
      <button type="button" data-vista="lista" class="${ASIS.vista === 'lista' ? 'on' : ''}" title="Lista">☰</button>
    </div>
    <button class="btn" id="asisNueva" hidden>➕ Actividad</button>`;

  document.getElementById('asisCuerpo').addEventListener('change', (e) => {
    ASIS.cuerpo_id = e.target.value;
    cargarAgenda();
  });
  document.getElementById('asisTipo').addEventListener('change', (e) => {
    ASIS.tipo = e.target.value;
    cargarAgenda();
  });
  zona.querySelectorAll('#asisVista button').forEach((b) => {
    b.addEventListener('click', () => {
      ASIS.vista = b.dataset.vista;
      zona.querySelectorAll('#asisVista button').forEach((x) => x.classList.toggle('on', x === b));
      pintarAgenda();
    });
  });
  document.getElementById('asisNueva').addEventListener('click', () => abrirActividad(null));
}

/** Trae las actividades del mes que se está mirando. */
async function cargarAgenda() {
  const primero = new Date(ASIS.mes.getFullYear(), ASIS.mes.getMonth(), 1);
  const ultimo = new Date(ASIS.mes.getFullYear(), ASIS.mes.getMonth() + 1, 0);
  const params = new URLSearchParams({ desde: ISO(primero), hasta: ISO(ultimo) });
  if (ASIS.cuerpo_id) params.set('cuerpo_id', ASIS.cuerpo_id);
  if (ASIS.tipo) params.set('tipo', ASIS.tipo);
  try {
    ASIS.agenda = await api('GET', '/asistencias/agenda?' + params.toString());
  } catch (e) {
    document.getElementById('asisAgenda').innerHTML =
      `<div class="empty-state" style="padding:26px">${esc(e.message)}</div>`;
    return;
  }
  const nueva = document.getElementById('asisNueva');
  if (nueva) nueva.hidden = !ASIS.agenda.puede_crear;
  pintarAgenda();
}

function actividadesDe(dia) {
  return ((ASIS.agenda && ASIS.agenda.actividades) || []).filter((a) => a.fecha === dia);
}

function pintarAgenda() {
  if (ASIS.vista === 'lista') pintarListaDeActividades();
  else pintarCalendario();
  pintarDelDia();
}

/** Calendario del mes, con un punto en los días que tienen actividad. */
function pintarCalendario() {
  const año = ASIS.mes.getFullYear();
  const mes = ASIS.mes.getMonth();
  const primero = new Date(año, mes, 1);
  const dias = new Date(año, mes + 1, 0).getDate();
  const desplaza = (primero.getDay() + 6) % 7; // la semana empieza el lunes

  const porDia = {};
  ((ASIS.agenda && ASIS.agenda.actividades) || []).forEach((a) => {
    (porDia[a.fecha] = porDia[a.fecha] || []).push(a);
  });

  const celdas = [];
  for (let i = 0; i < desplaza; i++) celdas.push('<span class="cal-vacio"></span>');
  for (let d = 1; d <= dias; d++) {
    const iso = ISO(new Date(año, mes, d));
    const delDia = porDia[iso] || [];
    const completas = delDia.length && delDia.every((a) => a.convocados && a.marcados >= a.convocados);
    const sinTomar = delDia.some((a) => !a.marcados);
    const punto = delDia.length
      ? `<i class="pt ${completas ? 'ok' : sinTomar ? 'falta' : 'medio'}" title="${delDia.length} actividad(es)"></i>`
      : '';
    celdas.push(
      `<button type="button" class="cal-dia ${iso === HOY() ? 'hoy' : ''} ${iso === ASIS.dia ? 'sel' : ''}"
               data-dia="${iso}">${d}${punto}</button>`
    );
  }

  document.getElementById('asisAgenda').innerHTML = `
    <div class="cal">
      <div class="cal-cab">
        <button type="button" id="calAnt" title="Mes anterior">‹</button>
        <b>${MESES[mes]} ${año}</b>
        <button type="button" id="calSig" title="Mes siguiente">›</button>
      </div>
      <div class="cal-grilla">
        ${['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'].map((d) => `<span class="cal-dow">${d}</span>`).join('')}
        ${celdas.join('')}
      </div>
    </div>`;

  document.getElementById('calAnt').addEventListener('click', () => {
    ASIS.mes = new Date(año, mes - 1, 1);
    cargarAgenda();
  });
  document.getElementById('calSig').addEventListener('click', () => {
    ASIS.mes = new Date(año, mes + 1, 1);
    cargarAgenda();
  });
  document.querySelectorAll('.cal-dia').forEach((b) => {
    b.addEventListener('click', () => {
      ASIS.dia = b.dataset.dia;
      ASIS.actividadId = null; ASIS.bajadoA = null;
      pintarCalendario();
      pintarDelDia();
    });
  });
}

/** Las actividades del mes como lista, para quien prefiera verlas seguidas. */
function pintarListaDeActividades() {
  const actividades = (ASIS.agenda && ASIS.agenda.actividades) || [];
  document.getElementById('asisAgenda').innerHTML = actividades.length
    ? `<ul class="pl-actividades">${actividades.map((a) => `
        <li data-id="${a.id}" data-dia="${a.fecha}">
          <div class="pa-dia">
            <b>${esc(diaSemanaYMes(a.fecha))}</b>
            <span>${esc(cuandoFue(a.fecha))}${a.hora_inicio ? ' · ' + esc(a.hora_inicio) : ''}</span>
          </div>
          <div class="pa-que">
            <b>${esc(a.nombre || a.tipo_reunion || 'Actividad')}</b>
            ${a.nombre ? `<span class="mut">${esc(a.tipo_reunion || '')}</span>` : ''}
            <span>${esc(a.cuerpos.map((c) => c.nombre).join(', ') || 'sin cuerpos')}${a.lugar ? ' · ' + esc(a.lugar) : ''}</span>
            <div class="pa-barra"><span style="width:${a.convocados ? Math.round((a.marcados / a.convocados) * 100) : 0}%"></span></div>
          </div>
          <div class="pa-estado">
            ${etiquetaAvance(a)}
            <span class="mut">${a.marcados} de ${a.convocados}</span>
          </div>
        </li>`).join('')}</ul>`
    : `<div class="empty-state" style="padding:30px">No hay actividades en ${MESES[ASIS.mes.getMonth()]} de ${ASIS.mes.getFullYear()}.</div>`;

  document.querySelectorAll('#asisAgenda .pl-actividades li').forEach((li) => {
    li.addEventListener('click', () => {
      ASIS.dia = li.dataset.dia;
      ASIS.actividadId = Number(li.dataset.id);
      pintarDelDia();
      irA('asisMarcar');
    });
  });
}

/** Lleva la pantalla a una zona, sin que la barra de arriba la tape. */
function irA(id) {
  const zona = document.getElementById(id);
  if (!zona) return;
  const alto = (document.querySelector('.topbar') || {}).offsetHeight || 0;
  window.scrollTo({ top: zona.getBoundingClientRect().top + window.scrollY - alto - 8, behavior: 'smooth' });
}

function etiquetaAvance(a) {
  const falta = Math.max(0, a.convocados - a.marcados);
  const estado = !a.convocados
    ? { texto: 'Sin integrantes', clase: 'gris' }
    : falta === 0
      ? { texto: 'Lista completa', clase: 'ok' }
      : a.marcados
        ? { texto: `Faltan ${falta}`, clase: 'medio' }
        : { texto: 'Sin tomar', clase: 'bajo' };
  return `<span class="badge ${nivelClase(estado.clase)}">${esc(estado.texto)}</span>`;
}

/** Las actividades del día elegido, y debajo la lista de la que se elija. */
function pintarDelDia() {
  const zona = document.getElementById('asisDelDia');
  const delDia = actividadesDe(ASIS.dia);

  // Si hay una sola, se abre sola: un toque menos
  if (!ASIS.actividadId && delDia.length === 1) ASIS.actividadId = delDia[0].id;
  if (ASIS.actividadId && !delDia.some((a) => a.id === ASIS.actividadId)) {
    const suya = ((ASIS.agenda && ASIS.agenda.actividades) || []).find((a) => a.id === ASIS.actividadId);
    if (suya) ASIS.dia = suya.fecha;
    else { ASIS.actividadId = null; ASIS.bajadoA = null; }
  }

  const puedeEditar = ASIS.agenda && ASIS.agenda.puede_editar;
  const puedeEliminar = ASIS.agenda && ASIS.agenda.puede_eliminar;

  zona.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>Actividades del ${esc(diaSemanaYMes(ASIS.dia))}</b>
        <span class="spacer"></span>
        <span style="color:var(--muted);font-size:13px">${delDia.length || 'sin'} actividad(es)</span>
      </div>
      ${delDia.length ? `<ul class="asis-actividades">${delDia.map((a) => `
        <li data-id="${a.id}" class="${a.id === ASIS.actividadId ? 'on' : ''}">
          <div class="aa-datos">
            <div class="aa-tit">
              <span class="badge ${badgeClass(a.tipo_reunion)}">${esc(a.tipo_reunion || 'Actividad')}</span>
              ${a.nombre ? `<b>${esc(a.nombre)}</b>` : ''}
              ${a.hora_inicio ? `<span class="mut">${esc(a.hora_inicio)}</span>` : ''}
              ${a.lugar ? `<span class="mut">· ${esc(a.lugar)}</span>` : ''}
            </div>
            <div class="aa-cuerpos">${esc(a.cuerpos.map((c) => c.nombre).join(', ') || 'sin cuerpos')}</div>
          </div>
          <div class="aa-avance">
            <b>${a.marcados}/${a.convocados}</b>
            ${etiquetaAvance(a)}
          </div>
          <div class="aa-acc">
            ${puedeEditar ? '<button class="ico" data-editar title="Editar la actividad">✏️</button>' : ''}
            ${puedeEliminar ? '<button class="ico" data-borrar title="Eliminar la actividad">🗑️</button>' : ''}
          </div>
        </li>`).join('')}</ul>`
        : `<div class="empty-state" style="padding:26px">
             No hay actividades este día.${ASIS.agenda && ASIS.agenda.puede_crear ? ' Cree una con ➕ Actividad.' : ''}
           </div>`}
    </div>`;

  zona.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('.aa-acc')) return;
      const yaEstaba = ASIS.actividadId === Number(li.dataset.id);
      ASIS.actividadId = Number(li.dataset.id);
      pintarDelDia();
      // Con varias actividades en el día, la lista queda lejos: se va a ella
      if (!yaEstaba) setTimeout(() => irA('asisMarcar'), 150);
    });
    const editar = li.querySelector('[data-editar]');
    if (editar) {
      editar.addEventListener('click', () => abrirActividad(delDia.find((a) => a.id === Number(li.dataset.id))));
    }
    const borrar = li.querySelector('[data-borrar]');
    if (borrar) {
      borrar.addEventListener('click', async () => {
        const a = delDia.find((x) => x.id === Number(li.dataset.id));
        if (!confirm(`¿Eliminar la actividad "${a.tipo_reunion}" del ${fechaCorta(a.fecha)}?\n\n` +
          `Se borrarán también sus ${a.marcados} marca(s) de asistencia. Esta acción no se puede deshacer.`)) return;
        try {
          await api('DELETE', `/asistencias/${a.id}`);
          toast('Actividad eliminada');
          if (ASIS.actividadId === a.id) { ASIS.actividadId = null; ASIS.bajadoA = null; }
          cargarAgenda();
        } catch (e) {
          toast(e.message, true);
        }
      });
    }
  });

  const marcar = document.getElementById('asisMarcar');
  marcar.innerHTML = '';
  if (ASIS.actividadId) renderPasarLista(ASIS.actividadId, marcar, { alGuardar: refrescarAvance });
}

/** Deja al día el contador de la actividad sin volver a pintar toda la pantalla. */
function refrescarAvance(resumen) {
  const a = ((ASIS.agenda && ASIS.agenda.actividades) || []).find((x) => x.id === ASIS.actividadId);
  if (!a) return;
  a.presentes = resumen.presentes;
  a.ausentes = resumen.ausentes;
  a.justificados = resumen.justificados;
  a.marcados = resumen.presentes + resumen.ausentes + resumen.justificados;
  const li = document.querySelector(`.asis-actividades li[data-id="${a.id}"]`);
  if (li) li.querySelector('.aa-avance').innerHTML = `<b>${a.marcados}/${a.convocados}</b>${etiquetaAvance(a)}`;
  if (ASIS.vista === 'calendario') pintarCalendario();
}

/* ---------------- crear o editar una actividad ---------------- */

function abrirActividad(actividad) {
  const editando = !!actividad;
  const tipos = ASIS.tipos || [];
  /*
   * Al crear, viene marcado el tipo que la iglesia fijó en Configuración; al
   * editar, el que la actividad tenga. Antes no venía marcado ninguno porque
   * la lista salía vacía, y ahí estaba el problema de fondo: el diálogo
   * mandaba el tipo en blanco y una actividad ya creada no se podía guardar.
   */
  const campoTipo = (MOD['asistencias'].fields || []).find((f) => f.name === 'tipo_reunion') || {};
  const tipoPuesto = editando
    ? actividad.tipo_reunion
    : (tipos.includes(campoTipo.default) ? campoTipo.default : tipos[0] || '');
  const cuerpos = optionsCache['cuerpos'] || [];
  const elegidos = new Set(editando ? actividad.cuerpos.map((c) => c.id) : (ASIS.cuerpo_id ? [Number(ASIS.cuerpo_id)] : []));

  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>${editando ? '✏️ Editar actividad' : '➕ Nueva actividad'}</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body">
        <div class="modal-fila">
          <div class="fld"><label>Fecha <span class="req">*</span></label>
            <input type="date" id="acFecha" value="${esc(editando ? fechaISO(actividad.fecha) : ASIS.dia)}" /></div>
          <div class="fld"><label>Hora</label>
            <input type="time" id="acHora" value="${esc(editando ? actividad.hora_inicio || '' : '')}" /></div>
        </div>
        <div class="fld" style="margin-top:12px"><label>Actividad <span class="req">*</span></label>
          <select id="acTipo">${tipos.length
            ? tipos.map((t) => `<option value="${esc(t)}" ${t === tipoPuesto ? 'selected' : ''}>${esc(t)}</option>`).join('')
            // Sin ningún tipo en uso no se inventa uno: se dice, y el guardado
            // avisa igual. Callarlo es lo que hacía que el diálogo pareciera
            // andar y no anduviera.
            : '<option value="">— No hay tipos de actividad en uso —</option>'}</select>
          ${tipos.length ? '' : '<div class="help">Agregue uno en Tipos de Actividad, o vuelva a activar los que había.</div>'}
        </div>
        <div class="fld" style="margin-top:12px">
          <label>Cuerpos convocados <span class="req">*</span></label>
          <div class="chips-elegir" id="acCuerpos">
            ${cuerpos.map((c) => `
              <button type="button" class="chip ${elegidos.has(c.id) ? 'on' : ''}" data-id="${c.id}">${esc(c.label)}</button>`).join('')}
          </div>
          <div class="help">Se le pasará lista a los integrantes de todos los que elija.</div>
        </div>
        <div class="fld" style="margin-top:12px"><label>Nombre de la actividad</label>
          <input type="text" id="acNombre" value="${esc(editando ? actividad.nombre || '' : '')}"
                 placeholder="Opcional: «Jornada de jóvenes», «Encuentro de varones»…" /></div>
        <div class="fld" style="margin-top:12px"><label>Lugar</label>
          <input type="text" id="acLugar" value="${esc(editando ? actividad.lugar || '' : '')}" /></div>
        <div class="fld" style="margin-top:12px"><label>Observaciones</label>
          <textarea id="acObs">${esc(editando ? actividad.observaciones || '' : '')}</textarea></div>
        ${editando ? '' : bloqueDeRepeticion()}
        <div class="form-error" id="acError" style="padding:0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="acCancelar">Cancelar</button>
        <button class="btn" id="acGuardar">💾 Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#acCancelar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelectorAll('#acCuerpos .chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('on'));
  });

  fondo.querySelector('#acGuardar').addEventListener('click', async () => {
    const datos = {
      fecha: fondo.querySelector('#acFecha').value,
      hora_inicio: fondo.querySelector('#acHora').value || null,
      tipo_reunion: fondo.querySelector('#acTipo').value,
      nombre: fondo.querySelector('#acNombre').value || null,
      cuerpos: [...fondo.querySelectorAll('#acCuerpos .chip.on')].map((c) => Number(c.dataset.id)),
      lugar: fondo.querySelector('#acLugar').value || null,
      observaciones: fondo.querySelector('#acObs').value || null,
    };
    if (!datos.fecha) return (fondo.querySelector('#acError').textContent = 'Indique la fecha.');
    if (!datos.cuerpos.length) return (fondo.querySelector('#acError').textContent = 'Elija al menos un cuerpo.');
    try {
      const guardada = editando
        ? await api('PUT', `/asistencias/${actividad.id}`, datos)
        : await api('POST', '/asistencias', datos);

      /*
       * Las que se repiten se piden DESPUÉS y aparte, copiando la que se acaba
       * de crear. Así la primera pasa por todas las comprobaciones de siempre
       * —sus cuerpos, su iglesia, su tipo— y las copias heredan una actividad
       * ya revisada, sin que haya que comprobar nada dos veces.
       */
      let repetidas = null;
      if (!editando) {
        const pedido = loQueSeRepite(fondo);
        if (pedido) {
          try {
            repetidas = await api('POST', `/asistencias/${guardada.id}/repetir`, pedido);
          } catch (e) {
            // La actividad SÍ quedó creada: se dice lo uno y lo otro, en vez de
            // dejar a la persona creyendo que no se guardó nada
            toast(`Se creó la actividad, pero no se pudo repetir: ${e.message}`, true);
          }
        }
      }

      if (repetidas && repetidas.creadas) {
        toast(`Actividad creada, y ${fmtNumero(repetidas.creadas)} más ${repetidas.como_se_lee}`
          + (repetidas.ya_estaban ? ` (${fmtNumero(repetidas.ya_estaban)} ya estaban)` : ''));
      } else if (!repetidas) {
        toast(editando ? 'Actividad actualizada' : 'Actividad creada');
      }
      cerrar();
      ASIS.dia = datos.fecha;
      ASIS.mes = new Date(datos.fecha + 'T00:00:00');
      ASIS.actividadId = guardada.id;
      cargarAgenda();
    } catch (e) {
      fondo.querySelector('#acError').textContent = e.message;
    }
  });

  if (!editando) prepararRepeticion(fondo);
}

/**
 * «Esta se repite todos los domingos hasta fin de año.»
 *
 * El servicio del domingo, el estudio del miércoles y el ensayo del sábado son
 * los mismos todas las semanas. Se creaban de a una: más de 150 al año para
 * una iglesia con tres reuniones semanales.
 *
 * Cada fecha da una actividad independiente —se edita o se borra por separado,
 * como cualquier otra—, no una «serie» con dueño.
 */
function bloqueDeRepeticion() {
  const reglas = (ASIS.agenda && ASIS.agenda.reglas_de_repeticion) || [];
  if (!reglas.length) return '';
  return `
    <div class="fld ac-repite" style="margin-top:14px">
      <label for="acRepite">🔁 Se repite</label>
      <div class="modal-fila">
        <select id="acRepite">
          <option value="">No se repite</option>
          ${reglas.map((r) => `<option value="${esc(r.valor)}">${esc(r.label)}</option>`).join('')}
        </select>
        <input type="date" id="acRepiteHasta" aria-label="Hasta qué fecha se repite" hidden />
      </div>
      <div class="help" id="acRepiteAviso" hidden></div>
    </div>`;
}

/** Lo que hay que pedirle al servidor, o null si no se repite. */
function loQueSeRepite(fondo) {
  const regla = fondo.querySelector('#acRepite');
  const hasta = fondo.querySelector('#acRepiteHasta');
  if (!regla || !regla.value || !hasta || !hasta.value) return null;
  return { regla: regla.value, hasta: hasta.value };
}

/** Muestra el «hasta» al elegir una regla, y dice cuántas se van a crear. */
function prepararRepeticion(fondo) {
  const regla = fondo.querySelector('#acRepite');
  if (!regla) return;
  const hasta = fondo.querySelector('#acRepiteHasta');
  const aviso = fondo.querySelector('#acRepiteAviso');
  const fecha = fondo.querySelector('#acFecha');

  // De fábrica, hasta el 31 de diciembre del año de la actividad: es el año
  // eclesiástico que la iglesia arma en enero
  const finDeAno = () => `${String(fecha.value || HOY()).slice(0, 4)}-12-31`;

  const contar = () => {
    const hay = !!regla.value;
    hasta.hidden = !hay;
    aviso.hidden = !hay;
    if (!hay) return;
    if (!hasta.value || hasta.value <= (fecha.value || '')) hasta.value = finDeAno();
    /*
     * La cuenta se hace acá para poder decirla ANTES de guardar —nadie quiere
     * enterarse de que creó cuarenta actividades después de crearlas—, pero el
     * servidor la vuelve a hacer y es él quien manda: esto es un aviso, no la
     * decisión.
     */
    const cuantas = cuantasVecesSeRepite(fecha.value, regla.value, hasta.value);
    aviso.textContent = cuantas
      ? `Se crearán ${fmtNumero(cuantas)} actividad(es) más, hasta el ${fechaCorta(hasta.value)}. Cada una se edita y se borra por separado.`
      : 'Entre esas dos fechas no se repite ninguna vez.';
  };

  regla.addEventListener('change', contar);
  hasta.addEventListener('change', contar);
  fecha.addEventListener('change', () => { if (regla.value) contar(); });
  contar();
}

/**
 * Cuántas veces se repite entre dos fechas. Es el mismo cálculo que hace el
 * servidor (server/asistencia-repeticion.js), acá solo para poder avisarlo
 * antes de guardar; la que vale es la del servidor.
 */
function cuantasVecesSeRepite(desde, regla, hasta) {
  const bien = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (!bien(desde) || !bien(hasta) || hasta <= desde) return 0;
  const dia = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const texto = (ms) => new Date(ms).toISOString().slice(0, 10);
  const DIA = 86400000;
  const fin = dia(hasta);
  const inicio = dia(desde);
  const TOPE = 200;

  if (regla === 'semanal' || regla === 'quincenal') {
    const salto = (regla === 'semanal' ? 7 : 14) * DIA;
    return Math.min(TOPE, Math.floor((fin - inicio) / salto));
  }
  const [anio, mes, numero] = desde.split('-').map(Number);
  const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  let cuantas = 0;
  for (let i = 1; cuantas < TOPE; i++) {
    const m = mes - 1 + i;
    const a = anio + Math.floor(m / 12);
    const mm = (m % 12) + 1;
    if (Date.UTC(a, mm - 1, 1) > fin) break;
    let cae = null;
    if (regla === 'mensual_dia') {
      if (numero <= diasDelMes(a, mm)) cae = texto(Date.UTC(a, mm - 1, numero));
    } else if (regla === 'mensual_semana') {
      const diaSemana = new Date(inicio).getUTCDay();
      const cual = Math.floor((numero - 1) / 7) + 1;
      const primero = new Date(Date.UTC(a, mm - 1, 1)).getUTCDay();
      const d = 1 + ((diaSemana - primero + 7) % 7) + (cual - 1) * 7;
      if (d <= diasDelMes(a, mm)) cae = texto(Date.UTC(a, mm - 1, d));
    } else {
      return 0;
    }
    if (cae && dia(cae) > inicio && dia(cae) <= fin) cuantas++;
  }
  return cuantas;
}

/* ---------------- pasar lista ---------------- */

/**
 * ANOTAR A QUIEN ESTUVO SIN SER DEL CUERPO.
 *
 * La lista sale de los integrantes de los cuerpos convocados, y quien llegó
 * sin pertenecer a ninguno —una visita, alguien de otro cuerpo que pasó, un
 * familiar— no se podía anotar. La regla que lo impedía está bien: es la que
 * evita ensuciar el porcentaje con gente que no corresponde. Lo que faltaba
 * era esto: sumarla como VISITA, marcada como tal y fuera del porcentaje.
 *
 * Se busca entre la membresía y quienes sirven sin estar inscritos, por
 * IGLESIA y no por cuerpo: el caso que esto resuelve es justamente el de
 * alguien de otro cuerpo. Quien ya está en la lista no se ofrece.
 */
function abrirVisita(asistenciaId, alElegir) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>🧍 Anotar una visita</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body">
        <p class="mut" style="margin-top:0">
          Alguien que estuvo en esta actividad sin ser del cuerpo. Queda constancia de que
          estuvo, y <b>no cuenta en el porcentaje</b> de nadie.
        </p>
        <div class="fld"><label for="vsCuerpo">A la lista de</label>
          <select id="vsCuerpo"></select></div>
        <div class="fld" style="margin-top:12px"><label for="vsBuscar">Quién</label>
          <input type="search" id="vsBuscar" placeholder="🔎 Nombre o RUT…" autocomplete="off" /></div>
        <div id="vsLista" class="vs-lista"></div>
        <div class="form-error" id="vsError" style="padding:0"></div>
      </div>
      <div class="modal-foot"><button class="btn secondary" id="vsCerrar">Cerrar</button></div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#vsCerrar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });

  const caja = fondo.querySelector('#vsLista');
  const selCuerpo = fondo.querySelector('#vsCuerpo');
  const entrada = fondo.querySelector('#vsBuscar');
  let cuerpos = [];
  let reloj = null;

  const buscar = async () => {
    const texto = entrada.value.trim();
    if (texto.length < 2) {
      caja.innerHTML = '<div class="mut" style="padding:12px 2px">Escriba al menos dos letras del nombre o del RUT.</div>';
      return;
    }
    caja.innerHTML = '<div class="mut" style="padding:12px 2px">Buscando…</div>';
    let d;
    try {
      d = await api('GET', `/asistencias/${asistenciaId}/quien-puede-visitar?buscar=${encodeURIComponent(texto)}`);
    } catch (e) {
      caja.innerHTML = '';
      fondo.querySelector('#vsError').textContent = e.message;
      return;
    }
    if (!cuerpos.length) {
      cuerpos = d.cuerpos || [];
      selCuerpo.innerHTML = cuerpos.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
      selCuerpo.parentElement.hidden = cuerpos.length < 2;
    }
    if (!(d.gente || []).length) {
      caja.innerHTML = `<div class="mut" style="padding:12px 2px">
        Nadie con ese nombre fuera de esta lista.<br>
        Si es alguien que no está en el sistema, primero cree su ficha en <b>No Miembros</b>.
      </div>`;
      return;
    }
    caja.innerHTML = `<ul class="mini-list">${(d.gente || []).map((p, i) => `
      <li data-i="${i}" tabindex="0" role="button">
        <span><b>${esc(p.nombre)}</b>${p.persona_tipo === 'No miembro' ? ' <span class="badge">No inscrito(a)</span>' : ''}</span>
        <span class="mut">${p.rut ? esc(rutFormatear(p.rut)) : ''}</span>
      </li>`).join('')}</ul>`;
    caja.querySelectorAll('li').forEach((li) => {
      const elegir = () => {
        const quien = d.gente[Number(li.dataset.i)];
        const cuerpoId = Number(selCuerpo.value) || (cuerpos[0] || {}).id;
        const cuerpo = (cuerpos.find((c) => c.id === cuerpoId) || {}).nombre || '';
        cerrar();
        alElegir({ ...quien, cuerpo_id: cuerpoId, cuerpo });
      };
      li.addEventListener('click', elegir);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(); } });
    });
  };

  entrada.addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(buscar, 280); });
  buscar();
  entrada.focus();
}

/**
 * La lista para marcar: buscador, filtros por estado, avance y los tres
 * botones por persona. Se guarda sola y deja respaldo en el teléfono.
 */
async function renderPasarLista(asistenciaId, contenedor, opciones) {
  const alGuardar = (opciones && opciones.alGuardar) || null;
  let datos;
  try {
    datos = await api('GET', `/asistencias/${asistenciaId}/lista`);
  } catch (e) {
    contenedor.innerHTML = `<div class="card" style="margin-top:18px"><div class="empty-state" style="padding:26px">${esc(e.message)}</div></div>`;
    return;
  }
  // Pasar lista depende del permiso de "Toma de Asistencia", no del de crear
  // actividades: el servidor lo resuelve y lo dice aquí.
  const puedeEditar = !!datos.puede_marcar;
  // Los motivos los mantiene la iglesia. Se leen de donde ya quedaron pedidos
  // al abrir la pantalla; si esta lista se abre desde otro lado —la ficha de un
  // acta—, se piden acá mismo.
  const MOTIVOS = (ASIS.motivos && ASIS.motivos.length)
    ? ASIS.motivos
    : await opcionesDelCampo('asistencia_detalle', 'motivo');
  const CON_DETALLE = datos.motivos_con_detalle || [];
  const CLAVE = `pasarlista:${asistenciaId}`;

  // Lo que quedó marcado sin guardar en este teléfono manda sobre lo guardado
  const borrador = puedeEditar ? leerBorrador(CLAVE) : null;
  let recuperadas = 0;
  const recuperadasIds = [];
  // La clave de cada fila es la persona Y el cuerpo: la asistencia se lleva
  // por cuerpo, así que quien está en dos tiene dos filas y dos marcas. La
  // arma el servidor —dice de qué registro sale la persona—, y acá solo se usa.
  const claveDe = (p) => p.clave || `m${p.miembro_id}:${p.cuerpo_id || 0}`;
  if (borrador) {
    for (const p of datos.personas) {
      const b = borrador[claveDe(p)];
      if (!b) continue;
      const igual = (b.estado || null) === (p.estado || null)
        && (b.motivo || null) === (p.motivo || null)
        && (b.detalle || null) === (p.detalle || null);
      if (igual) continue;
      p.estado = b.estado || null;
      p.motivo = b.motivo || null;
      p.detalle = b.detalle || null;
      recuperadasIds.push(claveDe(p)); // quedaron sin guardar: son suyas
      recuperadas++;
    }
    if (!recuperadas) borrarBorrador(CLAVE);
  }

  /**
   * Si la iglesia lo pidió, una lista nueva se abre con todos presentes.
   *
   * PROPUESTO, NO GUARDADO. Nada de esto llega a la base hasta que alguien
   * aprieta Guardar; lo que cambia es por dónde se empieza. Donde casi nadie
   * falta, marcar solo las ausencias es mucho más rápido que marcar a los
   * ciento setenta y nueve que sí vinieron.
   *
   * Solo pasa en listas VÍRGENES: si ya hay aunque sea una marca puesta,
   * alguien empezó a pasar lista y proponer encima le pisaría el trabajo —o
   * peor, daría por presente a quien esa persona todavía no había mirado—.
   */
  const propuestas = (() => {
    if ((AJUSTES || {}).asistencia_marca_inicial !== 'Presente') return 0;
    if (!puedeEditar) return 0;
    if (datos.personas.some((p) => p.estado)) return 0;
    for (const p of datos.personas) p.estado = 'Presente';
    return datos.personas.length;
  })();

  /**
   * Los cuerpos que aparecen en esta lista, con cuánta gente trae cada uno.
   *
   * A una actividad la pueden convocar varios cuerpos y la lista viene toda
   * junta. Cuando hay más de uno, se ofrece elegir: al pasar lista uno va
   * cuerpo por cuerpo, no persona por persona salteando entre grupos.
   */
  const cuerposDeLaLista = (() => {
    const porId = new Map();
    for (const p of datos.personas) {
      if (!p.cuerpo_id) continue;
      const ya = porId.get(p.cuerpo_id);
      if (ya) ya.cuantos++;
      else porId.set(p.cuerpo_id, { id: p.cuerpo_id, nombre: p.cuerpo || 'Sin cuerpo', cuantos: 1 });
    }
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  })();

  /**
   * Con qué cuerpo se abre la lista.
   *
   * Arriba, en el calendario, ya se eligió uno para ver sus actividades. Quien
   * hizo eso está trabajando con ese cuerpo, así que la lista se abre mostrando
   * a los suyos y no a los de los siete cuerpos convocados: era desconcertante
   * elegir «Oficiales» arriba y encontrarse abajo con los ciclistas.
   *
   * Si ese cuerpo no está entre los de esta actividad, se abre con todos.
   */
  const cuerpoElegido = cuerposDeLaLista.some((c) => String(c.id) === String(ASIS.cuerpo_id))
    ? String(ASIS.cuerpo_id)
    : '';

  const fila = (p) => `
    <li data-clave="${esc(claveDe(p))}" data-id="${p.miembro_id || ''}"
        data-no-miembro="${p.no_miembro_id || ''}" data-cuerpo="${esc(String(p.cuerpo_id || ''))}"
        ${p.visita ? 'data-visita="1"' : ''}
        data-buscar="${esc(textoBuscable(`${p.nombre} ${p.rut || ''}`))}"
        class="${p.estado ? 'marcado' : ''}${p.visita ? ' es-visita' : ''}">
      <div class="pl-quien">
        <b>${esc(p.nombre)}</b>
        ${p.visita
          ? '<span class="badge yellow" title="Estuvo, pero no es del cuerpo: no cuenta en el porcentaje">Visita</span>'
          : ''}
        ${p.cuerpo ? `<span class="pl-cuerpo-chip">${esc(p.cuerpo)}</span>` : ''}
        ${p.persona_tipo === 'No miembro'
          ? '<span class="badge" title="Sirve en este grupo sin estar inscrita en la membresía">No inscrito(a)</span>'
          : ''}
        ${p.rut ? `<span class="mut">${esc(rutFormatear(p.rut))}</span>` : ''}
      </div>
      <div class="pl-botones">
        ${['Presente', 'Ausente', 'Justificado'].map((e) => `
          <button type="button" class="pl-b ${e.toLowerCase()} ${p.estado === e ? 'on' : ''}" data-estado="${e}" ${puedeEditar ? '' : 'disabled'}>${e}</button>`).join('')}
      </div>
      <div class="pl-just" ${p.estado === 'Justificado' ? '' : 'hidden'}>
        <select class="pl-motivo" aria-label="Motivo de la ausencia de ${esc(p.nombre)}" ${puedeEditar ? '' : 'disabled'}>
          <option value="">— Motivo —</option>
          ${MOTIVOS.map((o) => `<option value="${esc(o)}" ${p.motivo === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
        <input type="text" class="pl-detalle" placeholder="Especifique el detalle" value="${esc(p.detalle || '')}"
               aria-label="Detalle de la ausencia de ${esc(p.nombre)}"
               ${CON_DETALLE.includes(p.motivo) ? '' : 'hidden'} ${puedeEditar ? '' : 'disabled'} />
      </div>
    </li>`;

  contenedor.innerHTML = `
    <div class="card pl-card" style="margin-top:18px">
      <div class="pl-cab">
        <div class="pl-que">
          <b>🖐️ ${esc(datos.actividad.tipo || 'Actividad')} <span class="mut">${esc(diaSemanaYMes(datos.actividad.fecha).toLowerCase())}</span></b>
          <span>${(datos.actividad.cuerpos || []).map((c) => `<span class="badge">${esc(c.nombre)}</span>`).join(' ') || 'sin cuerpos'}</span>
          ${datos.actividad.solo_los_suyos
            ? `<span class="pl-solo-suyos" title="A esta actividad la convocan ${datos.actividad.cuerpos_convocados} cuerpos">
                 Le toca pasar lista solo a ${(datos.actividad.cuerpos || []).length === 1 ? 'su cuerpo' : 'sus cuerpos'}
               </span>`
            : ''}
          <span class="pl-tomada" id="plTomada" ${quienPasoLaLista(datos.tomada) ? '' : 'hidden'}>🖊️ ${esc(quienPasoLaLista(datos.tomada))}</span>
        </div>
      </div>
      ${datos.personas.length ? `
        ${recuperadas ? `<div class="pl-recuperado">📵 Se recuperaron ${recuperadas} marca(s) que habían quedado sin guardar en este teléfono. Revíselas y guarde.</div>` : ''}
        ${propuestas ? `<div class="pl-recuperado">✅ La lista se abrió con las ${fmtNumero(propuestas)} personas marcadas como presentes, según lo configurado. <b>Todavía no se ha guardado nada</b>: marque a quienes faltaron y después guarde.</div>` : ''}
        <div class="pl-filtros">
          <input type="search" id="plBuscar" aria-label="Buscar a alguien de esta lista por nombre o RUT"
                 placeholder="🔎 Buscar miembro por nombre o RUT…" autocomplete="off" />
          ${cuerposDeLaLista.length > 1 ? `
            <select id="plCuerpo" aria-label="Ver solo los integrantes de un cuerpo" title="Ver solo los integrantes de un cuerpo">
              <option value="">Todos los cuerpos (${fmtNumero(datos.personas.length)})</option>
              ${cuerposDeLaLista.map((c) => `
                <option value="${esc(String(c.id))}" ${String(c.id) === String(cuerpoElegido) ? 'selected' : ''}>
                  ${esc(c.nombre)} (${fmtNumero(c.cuantos)})
                </option>`).join('')}
            </select>` : ''}
          <div class="pl-chips">
            <button type="button" class="chip on" data-filtro="todos">Todos</button>
            <button type="button" class="chip verde" data-filtro="Presente">Presentes</button>
            <button type="button" class="chip roja" data-filtro="Ausente">Ausentes</button>
            <button type="button" class="chip ambar" data-filtro="Justificado">Justificados</button>
            <button type="button" class="chip" data-filtro="sin">Sin marcar</button>
          </div>
        </div>
        <div class="pl-avance">
          <div class="pl-avance-tit"><span>Progreso de marcado</span><b id="plPct">0/0 (0%)</b></div>
          <div class="pa-barra"><span id="plBarra" style="width:0%"></span></div>
        </div>
        <ul class="pasar-lista">${datos.personas.map(fila).join('')}</ul>
        <div class="pl-sinresultados" hidden>Nadie con ese nombre en esta lista.</div>
        <div class="pl-barra">
          <div class="pl-resumen" id="plResumen"></div>
          <div class="pl-estado" id="plEstado"></div>
          ${puedeEditar ? `
            <div class="pl-acciones">
              <button class="btn secondary" id="plVisita" aria-label="Anotar una visita"
                      title="Anotar a alguien que estuvo sin ser del cuerpo">🧍<span class="solo-ancho"> Anotar una visita</span></button>
              <button class="btn secondary" id="plTodos">✓ Todos presentes</button>
              <button class="btn" id="plGuardar">💾 Guardar lista</button>
            </div>` : ''}
        </div>`
      : `<div class="empty-state" style="padding:26px">
           ${(datos.actividad.cuerpos || []).length
             ? 'Los cuerpos que le toca pasar todavía no tienen integrantes. Agréguelos en Cuerpos / Grupos y vuelva a pasar lista.'
             : 'De los cuerpos convocados a esta actividad, ninguno es de los que tiene asignados.'}
         </div>`}
    </div>`;

  /**
   * Al abrir una lista, la pantalla baja hasta ella.
   *
   * En un teléfono la tarjeta de la lista queda entera debajo del borde: uno
   * toca la actividad, la lista se arma... y sigue viendo el calendario, sin
   * señal de que pasó algo. Hay que bajar a ciegas.
   *
   * Y hay algo peor que lo incómodo. La barra de «Guardar lista» va pegada
   * abajo, y cuando la tarjeta está casi toda por debajo del borde, esa barra
   * no tiene hasta dónde bajar y se apoya contra el techo de la tarjeta:
   * queda justo encima del botón «Todos presentes», tapándolo. En esa franja
   * —unos sesenta píxeles de desplazamiento— tocar «Todos presentes» guarda
   * la lista en blanco. Dejando la tarjeta arriba, la barra tiene todo el alto
   * de la pantalla para apoyarse y las dos cosas nunca se pisan.
   *
   * Se baja UNA vez por lista: si se bajara en cada refresco, a quien está
   * marcando se le movería la pantalla bajo el dedo.
   */
  if (ASIS.bajadoA !== asistenciaId) {
    ASIS.bajadoA = asistenciaId;
    const tarjeta = contenedor.querySelector('.pl-card');
    // Solo si de verdad quedó abajo: en un computador la tarjeta entra en
    // pantalla y mover la página sin motivo desorienta más de lo que ayuda
    if (tarjeta && tarjeta.scrollIntoView && tarjeta.getBoundingClientRect().top > window.innerHeight * 0.4) {
      tarjeta.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  const lista = contenedor.querySelector('ul.pasar-lista');
  if (!lista) return;

  // Por la clave y no por el id: quien no está inscrito no tiene número de
  // miembro, y con `li[data-id]` sus filas quedaban fuera de la lista entera
  const filas = () => [...lista.querySelectorAll('li[data-clave]')];

  /**
   * A quiénes tocó esta persona desde que abrió la lista.
   *
   * Es lo único que se manda al guardar. La pantalla es una foto del momento
   * en que se abrió, y a una lista la pueden estar pasando dos personas a la
   * vez —o la misma con el teléfono y el computador—: si se mandara la lista
   * entera, las filas que uno nunca tocó irían en blanco y borrarían lo que
   * el otro acababa de marcar.
   */
  const tocadas = new Set(recuperadasIds);

  const marcasDe = () => filas().map((li) => {
    const on = li.querySelector('.pl-b.on');
    return {
      clave: li.dataset.clave,
      // Uno de los dos, nunca los dos: o es un miembro inscrito o es alguien
      // que sirve en el grupo sin estarlo
      miembro_id: Number(li.dataset.id) || null,
      no_miembro_id: Number(li.dataset.noMiembro) || null,
      // Sin el cuerpo, el servidor no sabría a cuál de las dos marcas de esta
      // persona corresponde, y una le borraría la otra
      cuerpo_id: Number(li.dataset.cuerpo) || null,
      estado: on ? on.dataset.estado : null,
      motivo: li.querySelector('.pl-motivo').value || null,
      detalle: li.querySelector('.pl-detalle').value || null,
      // Estuvo sin ser del cuerpo: el servidor la guarda fuera del porcentaje
      visita: li.dataset.visita === '1' || undefined,
    };
  });

  /** Lo que se manda al guardar: únicamente lo que esta persona cambió. */
  const marcasTocadas = () => marcasDe().filter((m) => tocadas.has(m.clave));

  /** Justificaciones suyas a las que todavía les falta el motivo o el detalle. */
  const incompletas = () => marcasTocadas().filter(
    (m) => m.estado === 'Justificado' && (!m.motivo || (CON_DETALLE.includes(m.motivo) && !String(m.detalle || '').trim()))
  ).length;

  let sinGuardar = recuperadas > 0 || propuestas > 0;
  let reloj = null;

  const pintarEstado = (texto, clase) => {
    const el = document.getElementById('plEstado');
    if (el) el.innerHTML = texto ? `<span class="${clase || ''}">${esc(texto)}</span>` : '';
  };

  /**
   * Las filas que cuentan para el avance: las del cuerpo elegido, si se eligió
   * uno. Quien está pasando lista de su cuerpo quiere saber cuánto le falta a
   * él, no a la actividad entera.
   */
  /**
   * ¿Esta fila es del cuerpo elegido en el filtro?
   *
   * Cada fila es de UN cuerpo: quien está en dos tiene dos filas, una en cada
   * lista, y se le marca por separado en cada una.
   */
  const esDelCuerpo = (li, cuerpo) => !cuerpo || li.dataset.cuerpo === cuerpo;

  /*
   * Las filas que cuentan para el avance. Las VISITAS no: estuvieron, pero no
   * son del cuerpo, y sumarlas diría que la lista va más adelantada de lo que
   * va —y que hay más gente convocada de la que hay—.
   */
  const filasQueCuentan = () => {
    const cuerpo = (document.getElementById('plCuerpo') || {}).value || '';
    const propias = filas().filter((li) => li.dataset.visita !== '1');
    return cuerpo ? propias.filter((li) => esDelCuerpo(li, cuerpo)) : propias;
  };

  const resumen = () => {
    const cuenta = { Presente: 0, Ausente: 0, Justificado: 0, sin: 0 };
    const cuentan = filasQueCuentan();
    cuentan.forEach((li) => {
      const on = li.querySelector('.pl-b.on');
      if (on) cuenta[on.dataset.estado]++;
      else cuenta.sin++;
    });
    const total = cuentan.length;
    const marcados = total - cuenta.sin;
    const pct = total ? Math.round((marcados / total) * 100) : 0;
    document.getElementById('plPct').textContent = `${marcados}/${total} (${pct}%)`;
    document.getElementById('plBarra').style.width = `${pct}%`;
    const visitas = filas().filter((li) => li.dataset.visita === '1' && li.querySelector('.pl-b.on')).length;
    document.getElementById('plResumen').innerHTML =
      `<span class="badge green">${cuenta.Presente} presentes</span>
       <span class="badge red">${cuenta.Ausente} ausentes</span>
       <span class="badge blue">${cuenta.Justificado} justificados</span>
       ${cuenta.sin ? `<span class="badge">${cuenta.sin} sin marcar</span>` : ''}
       ${visitas ? `<span class="badge yellow" title="Estuvieron, pero no son del cuerpo: no cuentan en el porcentaje">${visitas} visita(s)</span>` : ''}`;
    const chip = contenedor.querySelector('[data-filtro="sin"]');
    if (chip) chip.textContent = `Sin marcar (${cuenta.sin})`;
    return cuenta;
  };

  /**
   * Pone la pantalla al día con lo que hay guardado, sin tocar las filas que
   * esta persona tiene a medio marcar: lo suyo manda sobre lo que llegue.
   */
  const ponerseAlDia = (marcas) => {
    if (!Array.isArray(marcas)) return;
    // La clave la arma el servidor y viene en cada marca: acá no se rehace,
    // porque el formato tiene que ser exactamente el mismo de las filas
    const porPar = new Map(marcas.filter((m) => m.clave).map((m) => [m.clave, m]));
    let ajenas = 0;
    for (const li of filas()) {
      const clave = li.dataset.clave;
      if (tocadas.has(clave)) continue; // lo que esta persona está marcando no se toca
      const m = porPar.get(clave) || {};
      const estabaEn = li.dataset.estado || '';
      li.querySelectorAll('.pl-b').forEach((b) => b.classList.toggle('on', b.dataset.estado === m.estado));
      li.querySelector('.pl-motivo').value = m.motivo || '';
      li.querySelector('.pl-detalle').value = m.detalle || '';
      pintarFila(li);
      if ((m.estado || '') !== estabaEn) ajenas++;
    }
    if (ajenas) resumen();
    return ajenas;
  };

  /** Deja al día el sello de quién pasó la lista, sin repintar la pantalla. */
  const pintarQuienLaPaso = (tomada) => {
    const sello = document.getElementById('plTomada');
    if (!sello) return;
    const frase = quienPasoLaLista(tomada);
    sello.textContent = frase ? `🖊️ ${frase}` : '';
    sello.hidden = !frase;
  };

  const guardar = async (automatico) => {
    const mias = marcasTocadas();
    if (!mias.length) {
      // Nada que mandar. Si lo pidió a mano, al menos se le muestra cómo va la
      // lista con lo que hayan marcado los demás.
      if (!automatico) {
        try {
          const al = await api('GET', `/asistencias/${asistenciaId}/lista`);
          const ajenas = ponerseAlDia(al.personas || []);
          pintarEstado(ajenas ? `Al día: ${ajenas} marca(s) de otra persona` : 'No hay cambios suyos que guardar', 'ok-texto');
        } catch (e) {
          pintarEstado(e.message, 'aviso-texto');
        }
      }
      return;
    }

    const faltan = incompletas();
    if (faltan) {
      pintarEstado(`Falta el motivo de ${faltan} justificación(es)`, 'aviso-texto');
      if (automatico) return;
    }
    const btn = document.getElementById('plGuardar');
    if (btn) btn.disabled = true;
    pintarEstado('Guardando…');
    try {
      const r = await api('POST', `/asistencias/${asistenciaId}/lista`, { marcas: mias });
      borrarBorrador(CLAVE);
      sinGuardar = false;
      tocadas.clear(); // ya están guardadas: dejan de ser "lo suyo sin mandar"
      const ajenas = ponerseAlDia(r.marcas);
      const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      pintarEstado(
        ajenas ? `Guardado a las ${hora} · ${ajenas} marca(s) de otra persona` : `Guardado a las ${hora}`,
        'ok-texto'
      );
      pintarQuienLaPaso(r.tomada);
      if (alGuardar) alGuardar(r);
      if (!automatico) {
        toast(`Lista guardada: ${r.presentes} presentes, ${r.ausentes} ausentes, ${r.justificados} justificados`);
      }
    } catch (e) {
      pintarEstado(e.message, 'aviso-texto');
      if (!automatico) toast(e.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /**
   * Cada cambio queda en el teléfono al instante y se guarda solo al ratito.
   *
   * Se anota a quién se tocó, porque es lo único que se manda al guardar y lo
   * único que se conserva en el borrador: así, si se corta el internet y la
   * lista se recupera después, se recupera el trabajo de esta persona y no una
   * foto vieja de lo que hayan marcado los demás.
   */
  const cambio = (quienes) => {
    for (const li of Array.isArray(quienes) ? quienes : quienes ? [quienes] : []) {
      tocadas.add(li.dataset.clave);
    }
    sinGuardar = true;
    const porPar = {};
    marcasTocadas().forEach((m) => (porPar[m.clave] = m));
    guardarBorrador(CLAVE, porPar);
    resumen();
    filtrar();
    pintarEstado(incompletas() ? `Falta el motivo de ${incompletas()} justificación(es)` : 'Sin guardar', 'aviso-texto');
    if (!puedeEditar) return;
    clearTimeout(reloj);
    reloj = setTimeout(() => { if (sinGuardar) guardar(true); }, 3000);
  };

  const pintarFila = (li) => {
    const boton = li.querySelector('.pl-b.on');
    const estado = boton ? boton.dataset.estado : null;
    const just = li.querySelector('.pl-just');
    just.hidden = estado !== 'Justificado';
    const motivo = li.querySelector('.pl-motivo').value;
    li.querySelector('.pl-detalle').hidden = !CON_DETALLE.includes(motivo);
    li.classList.toggle('marcado', !!estado);
    li.dataset.estado = estado || '';
  };

  /*
   * Lo que hace andar una fila. Aparte, porque hay filas que nacen después:
   * las visitas se agregan con la lista ya en pantalla, y si esto se quedara
   * escrito adentro del recorrido de abajo, sus botones no harían nada.
   */
  const engancharFila = (li) => {
    li.querySelectorAll('.pl-b').forEach((b) => {
      b.addEventListener('click', () => {
        const yaEstaba = b.classList.contains('on');
        li.querySelectorAll('.pl-b').forEach((x) => x.classList.remove('on'));
        if (!yaEstaba) b.classList.add('on'); // volver a pulsarlo la desmarca
        pintarFila(li);
        cambio(li);
      });
    });
    const motivo = li.querySelector('.pl-motivo');
    if (motivo) motivo.addEventListener('change', () => { pintarFila(li); cambio(li); });
    const detalle = li.querySelector('.pl-detalle');
    if (detalle) detalle.addEventListener('input', () => cambio(li));
  };
  filas().forEach(engancharFila);

  const btnTodos = document.getElementById('plTodos');
  if (btnTodos) {
    btnTodos.addEventListener('click', () => {
      // Solo a quienes están a la vista y sin marcar: no pisa lo ya decidido.
      // Y nunca a las visitas: cada una se anotó a mano, con su estado.
      const aLaVista = filas().filter((li) => !li.hidden && li.dataset.visita !== '1');
      const pendientes = aLaVista.filter((li) => !li.querySelector('.pl-b.on'));
      const objetivo = pendientes.length ? pendientes : aLaVista;
      objetivo.forEach((li) => {
        li.querySelectorAll('.pl-b').forEach((x) => x.classList.toggle('on', x.dataset.estado === 'Presente'));
        pintarFila(li);
      });
      cambio(objetivo);
    });
  }

  const btnVisita = document.getElementById('plVisita');
  if (btnVisita) {
    btnVisita.addEventListener('click', () => abrirVisita(asistenciaId, (quien) => {
      /*
       * La visita entra como una fila más, marcada presente y tocada, y se va
       * por el mismo camino de guardado que todas las demás: un camino solo
       * para las visitas se separaría del otro el día que algo cambie.
       */
      const yaEsta = filas().find((li) => li.dataset.clave === `${quien.clave}:${quien.cuerpo_id}`);
      if (yaEsta) { toast('Esa persona ya está en la lista.', true); return; }
      const li = document.createElement('div');
      li.innerHTML = fila({
        clave: `${quien.clave}:${quien.cuerpo_id}`,
        persona_tipo: quien.persona_tipo,
        miembro_id: quien.miembro_id,
        no_miembro_id: quien.no_miembro_id,
        nombre: quien.nombre,
        rut: quien.rut,
        cuerpo_id: quien.cuerpo_id,
        cuerpo: quien.cuerpo,
        visita: true,
        estado: 'Presente',
      });
      const nueva = li.firstElementChild;
      lista.appendChild(nueva);
      engancharFila(nueva);
      pintarFila(nueva);
      cambio(nueva);
      filtrar();
      nueva.scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast(`${quien.nombre} quedó anotada como visita. No cuenta en el porcentaje del cuerpo.`);
    }));
  }

  const btnGuardar = document.getElementById('plGuardar');
  if (btnGuardar) btnGuardar.addEventListener('click', () => guardar(false));

  // Buscador y filtros: dar con una persona entre muchas sin desplazarse
  function filtrar() {
    const texto = textoBuscable((document.getElementById('plBuscar') || {}).value || '');
    const activo = contenedor.querySelector('.pl-chips .chip.on');
    const filtro = activo ? activo.dataset.filtro : 'todos';
    const cuerpo = (document.getElementById('plCuerpo') || {}).value || '';
    let visibles = 0;
    filas().forEach((li) => {
      const calza = !texto || texto.split(/\s+/).every((t) => li.dataset.buscar.includes(t));
      const marcado = li.querySelector('.pl-b.on');
      const estado = marcado ? marcado.dataset.estado : '';
      const porEstado = filtro === 'todos' || (filtro === 'sin' ? !estado : estado === filtro);
      const delCuerpo = esDelCuerpo(li, cuerpo);
      const mostrar = calza && porEstado && delCuerpo;
      li.hidden = !mostrar;
      if (mostrar) visibles++;
    });
    const vacio = contenedor.querySelector('.pl-sinresultados');
    if (vacio) vacio.hidden = visibles > 0;
  }
  const buscador = document.getElementById('plBuscar');
  if (buscador) buscador.addEventListener('input', filtrar);
  const selCuerpo = document.getElementById('plCuerpo');
  if (selCuerpo) {
    selCuerpo.addEventListener('change', () => {
      filtrar();
      resumen(); // el avance pasa a ser el de ese cuerpo, no el de toda la actividad
    });
  }
  contenedor.querySelectorAll('.pl-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      contenedor.querySelectorAll('.pl-chips .chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
      filtrar();
    });
  });

  filas().forEach(pintarFila);
  if (cuerpoElegido) filtrar(); // se abre mostrando solo el cuerpo con el que se venía trabajando
  resumen();
  if (recuperadas || propuestas) pintarEstado('Sin guardar', 'aviso-texto');
}

/** Estado de una cuenta de tesorería: saldo, totales y últimos movimientos. */
async function renderEstadoCuenta(cuentaId, contenedor) {
  const modMov = MOD['tesoreria'];
  try {
    const e = await api('GET', `/cuentas_tesoreria/${cuentaId}/estado`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>💰 Estado de la cuenta</b>
          <span class="spacer"></span>
          ${modMov && modMov.perms.create && e.estado !== 'Cerrada'
            ? `<button class="btn sm" id="btnMovNuevo">➕ Registrar movimiento</button>`
            : e.estado === 'Cerrada' ? '<span class="badge red">Cuenta cerrada</span>' : ''}
          ${modMov ? `<button class="btn sm secondary" id="btnVerMovs">Ver todos los movimientos</button>` : ''}
          ${modMov ? `<button class="btn sm secondary" id="btnCartola">🧾 Cartola</button>` : ''}
        </div>
        ${sinCifras(e) ? `<div style="padding:0 18px 6px">${AVISO_SIN_CIFRAS}</div>` : `
        <div class="fin-cards" style="padding:0 18px 6px">
          <div class="fin slate"><div class="lbl">Saldo inicial</div><div class="num">${fmtMoney(e.saldo_inicial)}</div></div>
          <div class="fin green"><div class="lbl">Ingresos</div><div class="num">${fmtMoney(e.ingresos)}</div></div>
          <div class="fin red"><div class="lbl">Egresos</div><div class="num">${fmtMoney(e.egresos)}</div></div>
          <div class="fin blue"><div class="lbl">Saldo actual</div><div class="num ${e.saldo < 0 ? 'saldo-negativo' : ''}">${fmtMoney(e.saldo)}</div></div>
          <!-- Lo ya anotado con fecha de más adelante: todavía no está en la caja,
               así que no suma al saldo, pero tampoco puede quedar invisible. Solo
               se muestra cuando lo hay (ver server/saldos.js). -->
          ${Number(e.agendado) ? `
            <div class="fin slate">
              <div class="lbl">Agendado${e.agendado_desde ? ` · desde el ${fechaCorta(e.agendado_desde)}` : ''}</div>
              <div class="num">${fmtMoney(e.agendado)}</div>
            </div>` : ''}
        </div>`}
        ${Number(e.agendado) ? `
          <p class="mut" style="padding:0 18px 4px;margin:0">
            El saldo es lo que hay hoy. Además hay ${fmtNumero(e.movimientos_agendados)}
            ${e.movimientos_agendados === 1 ? 'movimiento anotado' : 'movimientos anotados'}
            con fecha de más adelante, que entrarán al saldo el día que les corresponda.
          </p>` : ''}
        ${e.ultimos.length ? `<ul class="mini-list mov-list">
          ${e.ultimos.map((m) => `
            <li data-ir="#/m/tesoreria/edit/${m.id}">
              <span>${fechaCorta(m.fecha)} · ${esc(m.concepto)} <span class="mut">— ${esc(m.categoria || '')}</span></span>
              <b class="${m.tipo === 'Egreso' ? 'monto-egreso' : 'monto-ingreso'}">${
                sinCifras(e) ? esc(m.tipo) : `${m.tipo === 'Egreso' ? '−' : '+'} ${fmtMoney(m.monto)}`}</b>
            </li>`).join('')}
        </ul>` : '<div class="empty-state" style="padding:26px">Esta cuenta todavía no tiene movimientos.</div>'}
      </div>`;

    const bn = document.getElementById('btnMovNuevo');
    if (bn) bn.addEventListener('click', () => (location.hash = `#/m/tesoreria/new?cuenta_id=${cuentaId}`));
    const bv = document.getElementById('btnVerMovs');
    if (bv) bv.addEventListener('click', () => (location.hash = `#/m/tesoreria?f_cuenta_id=${cuentaId}`));
    const bc = document.getElementById('btnCartola');
    if (bc) bc.addEventListener('click', () => (location.hash = `#/cuentas_tesoreria/cartola/${cuentaId}`));
  } catch (err) {
    contenedor.innerHTML = '';
  }
}

/**
 * Acceso al sistema de un miembro: si ya tiene usuario, se muestra y se puede
 * abrir; si no, el administrador puede designarlo con un botón, y el sistema
 * entrega una contraseña provisoria para pasarle a la persona.
 */
async function renderAccesoMiembro(miembroId, contenedor) {
  let d;
  try {
    d = await api('GET', `/miembros/${miembroId}/usuario`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }
  if (!d.usuario && !d.puede_designar) {
    contenedor.innerHTML = '';
    return;
  }

  const rol = (v) => (ROLES.find((r) => r.value === v) || {}).label || v;
  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🔐 Acceso al sistema</b>
        <span class="spacer"></span>
        ${d.usuario && MOD['usuarios']
          ? `<button class="btn sm secondary" id="verUsuario">Abrir su usuario</button>`
          : d.puede_designar
            ? `<button class="btn sm" id="crearUsuario" ${d.tiene_rut ? '' : 'disabled'}>➕ Designarlo como usuario</button>`
            : ''}
      </div>
      <div style="padding:14px 18px;font-size:13.5px" id="accesoCuerpo">
        ${d.usuario
          ? `<span class="badge ${d.usuario.activo ? 'green' : 'red'}">${d.usuario.activo ? 'Con acceso' : 'Acceso desactivado'}</span>
             Entra con su RUT <b>${esc(rutFormatear(d.usuario.rut || ''))}</b> — rol: <b>${esc(rol(d.usuario.rol))}</b>.
             <div class="mut" style="margin-top:6px">El RUT, el nombre, el correo y el teléfono se mantienen iguales en los dos módulos.</div>`
          : d.tiene_rut
            ? `Esta persona todavía no tiene acceso al sistema. Al designarla se crea su usuario con estos mismos datos
               y una contraseña provisoria para entregarle.`
            : `<span class="badge red">Falta el RUT</span>
               Para entrar al sistema se necesita el RUT, porque es el usuario de acceso. Complételo arriba y guarde.`}
      </div>
    </div>`;

  const ver = document.getElementById('verUsuario');
  if (ver) ver.addEventListener('click', () => (location.hash = `#/m/usuarios/edit/${d.usuario.id}`));

  const crear = document.getElementById('crearUsuario');
  if (crear) {
    crear.addEventListener('click', async () => {
      crear.disabled = true;
      try {
        const r = await api('POST', `/miembros/${miembroId}/usuario`);
        if (r.password) {
          document.getElementById('accesoCuerpo').innerHTML = `
            <span class="badge green">Usuario creado</span>
            <div style="margin-top:10px">Entregue estos datos a la persona; la contraseña se muestra <b>una sola vez</b>:</div>
            <div class="clave-provisoria">
              <div><span class="mut">Usuario (RUT)</span><b>${esc(rutFormatear(r.rut || ''))}</b></div>
              <div><span class="mut">Contraseña provisoria</span><b>${esc(r.password)}</b></div>
            </div>
            <div class="mut" style="margin-top:8px">Queda con rol «Solo consulta»; ajústelo en su ficha de usuario.</div>`;
          toast('Usuario creado');
        } else {
          toast('Ya tenía usuario: quedó enlazado');
          renderAccesoMiembro(miembroId, contenedor);
        }
      } catch (e) {
        toast(e.message, true);
        crear.disabled = false;
      }
    });
  }
}

/** Documentos adjuntos de un miembro (carnet, fichas, certificados…). */
/**
 * Fichas que llevan documentos e historial propios, y con qué módulo los
 * guardan. Esos módulos no están en el menú: se manejan desde aquí.
 */
const PANEL_DOCUMENTOS = {
  miembros: { modulo: 'documentos_miembros', campo: 'miembro_id', titulo: '🗂️ Documentos del miembro' },
  iglesias: { modulo: 'documentos_iglesias', campo: 'iglesia_id', titulo: '🗂️ Documentos de la iglesia' },
  pastores: { modulo: 'documentos_pastores', campo: 'pastor_id', titulo: '🗂️ Documentos del pastor / guía' },
  solicitudes: { modulo: 'documentos_solicitudes', campo: 'solicitud_id', titulo: '🗂️ Documentos de la solicitud' },
};
const PANEL_HISTORIAL = {
  miembros: { modulo: 'bitacora', campo: 'miembro_id', titulo: '🗒️ Historial del miembro' },
  iglesias: { modulo: 'historial_iglesias', campo: 'iglesia_id', titulo: '🗒️ Historial de la iglesia' },
  pastores: { modulo: 'historial_pastores', campo: 'pastor_id', titulo: '🗒️ Historial del pastor / guía' },
  // El historial de una solicitud es su seguimiento: se ordena de lo más
  // reciente a lo más antiguo por `id` y no por fecha, porque en un mismo día
  // pasan varias cosas y lo que importa es en qué orden pasaron.
  // `automaticasFijas` dice que lo que anotó el sistema no se toca. En el
  // seguimiento de una solicitud es así, y el servidor lo rechaza; ofrecer los
  // botones sería ofrecer algo que no va a funcionar. Los otros historiales no
  // lo declaran porque ahí sí se pueden corregir.
  solicitudes: {
    modulo: 'historial_solicitudes', campo: 'solicitud_id',
    titulo: '🗒️ Seguimiento de la solicitud', ordenPor: 'id', automaticasFijas: true,
  },
};

/*
 * Cuántos papeles trae la pestaña de una vez.
 *
 * Menos que el historial —que trae 50— porque cada uno ocupa mucho más: una
 * fila con su miniatura mide 99 px, contra los 40 y tantos de una línea de
 * historial. Con 24 la pestaña cabe en menos de tres pantallas y el resto se
 * pide cuando hace falta.
 */
const DOCUMENTOS_DE_A = 24;

/**
 * Documentos adjuntos a una ficha (de un miembro, de una iglesia, de un pastor).
 *
 * Con tres papeles esta pestaña estaba bien resuelta. El problema aparece con
 * los años, que es lo que una carpeta acumula. Medido sobre una ficha con 118:
 * el encabezado decía «118 documento(s)», la pestaña mostraba 100, los otros 18
 * no se veían y nada lo decía, y el conjunto medía 7.959 px —8,8 pantallas— sin
 * buscador ni filtro.
 *
 * Es el mismo hueco que tenía la pestaña del historial y se arregló igual
 * (1.185.0): se trae un tramo, se dice cuántos hay, se ofrecen los que faltan, y
 * el buscador y el filtro los resuelve el SERVIDOR —en el navegador solo
 * alcanzarían el tramo cargado, y buscar un papel de hace quince años no lo
 * encontraría nunca—.
 *
 * El tramo es de 24 y no de 50 como el del historial. No es por el alto: la fila
 * de un documento mide 79 px y la línea del historial 85 px, casi lo mismo. Es
 * por lo que cada fila trae: la del documento descarga el escaneo entero para
 * mostrarlo en miniatura, y la del historial no descarga nada. Medido sobre una
 * carpeta de escaneos de 180 KB cada uno, el tramo de 24 pesa 4,2 MB; uno de 50
 * pesaría cerca de 8,8 MB antes de mostrar el primer papel, y eso lo paga la
 * secretaria con el teléfono en la mano.
 */
async function renderDocumentos(panel, id, contenedor, estado) {
  const modDocs = MOD[panel.modulo];
  if (!modDocs) return;
  const st = { q: '', tipo: '', cuantas: DOCUMENTOS_DE_A, deTodas: undefined, foco: false, ...(estado || {}) };
  const esImagen = (a) => /\.(jpe?g|png|webp|gif)$/i.test(a || '');
  const tipos = (modDocs.fields.find((f) => f.name === 'tipo') || {}).options || [];
  try {
    const datos = await api('GET', `/${panel.modulo}?f_${panel.campo}=${id}&limit=${st.cuantas}`
      + `&sort=fecha&dir=desc${st.q ? `&q=${encodeURIComponent(st.q)}` : ''}`
      + `${st.tipo ? `&f_tipo=${encodeURIComponent(st.tipo)}` : ''}`);
    // El total sin acotar se arrastra, para no volver a preguntarlo en cada tecla
    const acotado = !!(st.q || st.tipo);
    if (!acotado) st.deTodas = datos.total;
    const deTodas = st.deTodas === undefined ? datos.total : st.deTodas;
    const rehacer = (cambios) => renderDocumentos(panel, id, contenedor, { ...st, ...cambios });

    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>${esc(panel.titulo)}</b>
          <span style="color:var(--muted);font-size:13px">${acotado
            ? `${datos.total} de ${deTodas}`
            : `${datos.total} documento(s)`}</span>
          <span class="spacer"></span>
          <input type="search" id="docBuscar" placeholder="Buscar en los documentos…"
                 value="${esc(st.q)}" aria-label="Buscar en los documentos" />
          <select id="docTipo" aria-label="Filtrar por tipo de documento">
            <option value="">— Todos los tipos —</option>
            ${tipos.map((o) => {
              const v = typeof o === 'object' ? o.value : o;
              return `<option value="${esc(v)}" ${String(v) === String(st.tipo) ? 'selected' : ''}>${esc(v)}</option>`;
            }).join('')}
          </select>
          ${modDocs.perms.create ? `<button class="btn sm" id="btnDocNuevo">➕ Agregar documento</button>` : ''}
        </div>
        ${datos.rows.length ? `<ul class="documentos">
          ${datos.rows.map((d) => `
            <li data-id="${d.id}">
              <div class="dm">${esImagen(d.archivo)
                ? `<img src="/uploads/${esc(d.archivo)}" alt="" />`
                : '<span class="dico">📄</span>'}</div>
              <div class="dd">
                <b>${esc(d.nombre || '')}</b>
                <span class="badge ${badgeClass(d.tipo)}">${esc(d.tipo || '')}</span>
                <div class="dfe">${d.fecha ? fechaCorta(d.fecha) : ''}${d.observaciones ? ' — ' + esc(d.observaciones) : ''}</div>
              </div>
              <div class="da">
                ${d.archivo ? `<a class="btn sm secondary" href="/uploads/${esc(d.archivo)}" target="_blank">Ver</a>` : ''}
              </div>
            </li>`).join('')}
        </ul>` : `<div class="empty-state" style="padding:26px">${acotado
          ? 'Ningún documento coincide con lo que buscó.'
          : 'Todavía no se ha adjuntado ningún documento.'}</div>`}
        ${datos.rows.length < datos.total ? `
          <div class="hist-mas">
            <span>Mostrando ${datos.rows.length} de ${datos.total}.</span>
            <button class="btn sm secondary" id="docMas">Ver ${Math.min(DOCUMENTOS_DE_A, datos.total - datos.rows.length)} más</button>
          </div>` : ''}
      </div>`;

    const btn = document.getElementById('btnDocNuevo');
    if (btn) btn.addEventListener('click', () => (location.hash = `#/m/${panel.modulo}/new?${panel.campo}=${id}`));

    const mas = document.getElementById('docMas');
    if (mas) mas.addEventListener('click', () => rehacer({ cuantas: st.cuantas + DOCUMENTOS_DE_A }));

    // Al buscar o filtrar se vuelve al primer tramo: pedir «los 100 primeros»
    // de una búsqueda recién escrita no tiene sentido
    const porTipo = document.getElementById('docTipo');
    if (porTipo) porTipo.addEventListener('change', () => rehacer({ tipo: porTipo.value, cuantas: DOCUMENTOS_DE_A }));

    const caja = document.getElementById('docBuscar');
    if (caja) {
      if (st.foco) {
        caja.focus();
        caja.setSelectionRange(caja.value.length, caja.value.length);
      }
      let espera;
      caja.addEventListener('input', () => {
        clearTimeout(espera);
        espera = setTimeout(() => rehacer({ q: caja.value.trim(), cuantas: DOCUMENTOS_DE_A, foco: true }), 280);
      });
    }

    contenedor.querySelectorAll('ul.documentos li').forEach((li) => {
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return; // "Ver" abre el archivo
        location.hash = `#/m/${panel.modulo}/edit/${li.dataset.id}`;
      });
    });
  } catch (e) {
    contenedor.innerHTML = '';
  }
}

/**
 * La tramitación de una solicitud: quién la tiene y a quién se le pasa.
 *
 * El traslado no es un campo que se edita: es un acto. Por eso va acá, con su
 * botón y su motivo, y no como un desplegable más del formulario. Quien lo usa
 * está diciendo «esto ya no me toca a mí, le toca a fulano, por esto», y eso es
 * lo que queda escrito en el seguimiento.
 *
 * Solo lo ve quien puede hacerlo: el responsable actual y el administrador. A
 * los demás se les dice quién la tiene, que es lo que necesitan saber.
 */
/**
 * El paso siguiente de una solicitud aprobada, ofrecido y no hecho.
 *
 * Aprobar una solicitud de certificado no emite el certificado: eso es un
 * documento que se firma y se entrega, y decidirlo es de una persona. Lo que sí
 * puede hacer el sistema es no obligar a copiar a mano lo que ya está escrito.
 * Así que acá va un botón que abre el formulario de destino con lo que la
 * solicitud ya sabe, y —cuando el paso ya se dio— el enlace a lo que salió.
 */
async function pintarPasoSiguiente(id, contenedor) {
  let p;
  try {
    p = await api('GET', `/solicitudes/${id}/paso-siguiente`);
  } catch (e) {
    return;
  }
  if (!p || !p.modulo || !MOD[p.modulo]) return;

  // Ya se dio: se dice qué salió y se lleva hasta ahí
  if (p.hecho) {
    contenedor.insertAdjacentHTML('beforeend', `
      <div class="card paso-sig hecho" style="margin-top:14px">
        <div class="toolbar">
          <b>${esc(p.icono)} De esta solicitud salió ${esc(p.que)}</b>
          <span class="spacer"></span>
          <a class="btn secondary sm" href="#/m/${esc(p.modulo)}/ficha/${p.hecho.id}">Ver ${esc(p.hecho.nombre || 'lo emitido')}</a>
        </div>
      </div>`);
    return;
  }

  // La ayuda social nace sola: no hay botón que ofrecer, solo decirlo
  if (p.automatico) {
    if (!p.concedida) {
      contenedor.insertAdjacentHTML('beforeend', `
        <div class="card paso-sig" style="margin-top:14px">
          <div class="respaldo">
            <p><b>${esc(p.icono)} Al aprobarla, la ayuda se registra sola</b></p>
            <p class="mut">Con lo que dice esta solicitud, y las dos quedan enlazadas.</p>
          </div>
        </div>`);
    }
    return;
  }

  // Todavía no está aprobada: se anuncia, sin ofrecer el botón
  if (!p.concedida) {
    contenedor.insertAdjacentHTML('beforeend', `
      <div class="card paso-sig" style="margin-top:14px">
        <div class="respaldo">
          <p><b>${esc(p.icono)} El paso siguiente será ${esc(p.que)}</b></p>
          <p class="mut">Se ofrece en cuanto la solicitud quede aprobada.</p>
        </div>
      </div>`);
    return;
  }

  if (!MOD[p.modulo].perms.create && !p.abreLaFicha) return;

  // Aprobada y sin dar: el botón, con lo que la solicitud ya sabe
  const campos = { ...(p.precarga || {}) };
  const adonde = p.abreLaFicha
    ? `#/m/${p.modulo}/ficha/${campos.id}`
    : `#/m/${p.modulo}/new?${new URLSearchParams({ ...campos, solicitud_id: String(id) })}`;

  contenedor.insertAdjacentHTML('beforeend', `
    <div class="card paso-sig" style="margin-top:14px">
      <div class="toolbar">
        <b>${esc(p.icono)} Paso siguiente</b>
        <span class="spacer"></span>
        <a class="btn" href="${esc(adonde)}">${esc(p.label)}</a>
      </div>
      <div class="respaldo">
        <p class="mut">${p.abreLaFicha
          ? 'El traslado se hace en la ficha de la persona, en el registro oficial: acá solo se llega hasta ella.'
          : 'Se abre con lo que esta solicitud ya sabe —el titular, la iglesia—, para no volver a escribirlo. '
            + 'Lo que se emita queda enlazado, y en el seguimiento queda anotado qué salió de acá.'}</p>
      </div>
    </div>`);
}

async function renderTramitacionSolicitud(id, row, contenedor) {
  const mod = MOD['solicitudes'];
  const cerradas = ['Aprobada', 'Rechazada', 'Completada', 'Anulada'];
  const estaCerrada = cerradas.includes(row.estado);
  const suya = Number(row.responsable_id) === Number(USER.id);
  /*
   * Quién puede moverla lo dice la LLAVE, no el rol.
   *
   * El servidor ya preguntaba por «solicitudes_tramitar» (ver el módulo), pero
   * acá seguía escrito «o es administrador». El resultado: a quien se le
   * concedía la llave —justamente para que coordinara solicitudes sin hacerlo
   * administrador de todo— el servidor le habría dejado trasladar, pero el
   * botón no le aparecía nunca. Un permiso que se puede dar y no sirve de nada
   * es peor que no tenerlo: parece concedido y no lo está.
   */
  const puedeTramitarLasDeOtros = tieneLlave('solicitudes_tramitar');
  const puedeTrasladar = mod.perms.edit && !estaCerrada && (suya || puedeTramitarLasDeOtros);

  const quien = row.responsable_id_label || (row.responsable_id ? `usuario ${row.responsable_id}` : null);

  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🔁 Tramitación</b>
        <span class="badge ${badgeClass(row.estado)}">${esc(row.estado || '')}</span>
        <span class="spacer"></span>
        ${puedeTrasladar ? '<button class="btn" id="solTrasladar">↪️ Trasladar a otro usuario</button>' : ''}
      </div>
      <div class="respaldo">
        <p><b>N.º ${esc(row.numero || 'sin número')}</b> · ingresada el ${row.fecha ? fechaLarga(row.fecha) : '—'}</p>
        <p>${quien
          ? `A cargo de <b>${esc(quien)}</b>${suya ? ' — es usted' : ''}.`
          : 'Nadie figura a cargo de esta solicitud.'}</p>
        ${estaCerrada
          ? `<p class="mut">La solicitud está <b>${esc(row.estado.toLowerCase())}</b>${row.fecha_respuesta ? ` desde el ${fechaLarga(row.fecha_respuesta)}` : ''}: ya no se traslada.</p>`
          : puedeTrasladar
            ? '<p class="mut">Al trasladarla, el motivo queda escrito en el seguimiento junto con quién la pasó y a quién.</p>'
            : '<p class="mut">Solo puede trasladarla quien la tiene a cargo, o el administrador.</p>'}
        ${row.respuesta ? `<p><b>Respuesta:</b> ${esc(row.respuesta)}</p>` : ''}
      </div>
    </div>`;

  // Y lo que viene después de aprobarla, si su tipo lleva a alguna parte
  await pintarPasoSiguiente(id, contenedor);

  const btn = document.getElementById('solTrasladar');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    // La misma lista que el campo Responsable: solo nombres, sin el RUT ni
    // el correo que entrega /usuarios/options.
    const usuarios = await getOptions('/solicitudes/responsables').catch(() => []);
    const seguro = await preguntarEnDialogo({
      titulo: '↪️ Trasladar la solicitud',
      cuerpo: `
        <p>La solicitud pasa a manos de otro usuario, que queda a cargo de responderla.
        No cambia de estado: sigue donde está.</p>
        <div class="fld full">
          <label for="solDestino">Pasa a</label>
          <select id="solDestino">
            <option value="">— Elija al usuario —</option>
            ${usuarios
              .filter((u) => Number(u.id) !== Number(row.responsable_id))
              .map((u) => `<option value="${u.id}">${esc(u.label)}</option>`).join('')}
          </select>
        </div>
        <div class="fld full">
          <label for="solMotivo">Por qué se traslada</label>
          <textarea id="solMotivo" rows="3" placeholder="Le corresponde a tesorería, es un tema de su cuerpo, me pidieron que lo viera…"></textarea>
        </div>`,
      aceptar: 'Trasladarla',
    });
    if (!seguro) return;
    try {
      const r = await api('POST', `/solicitudes/${id}/trasladar`, {
        responsable_id: Number(seguro.solDestino),
        motivo: (seguro.solMotivo || '').trim(),
      });
      toast(`Solicitud trasladada a ${r.responsable}`);
      route();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

/**
 * Las personas que involucra una solicitud.
 *
 * Una solicitud rara vez es de una sola persona: un traslado involucra al que
 * se va y a quien lo recibe, una ayuda social al que la pide y a su grupo
 * familiar. Cada una sale del registro de Miembros o del de No Miembros, y
 * desde acá se abre su ficha.
 */
async function renderPersonasSolicitud(id, contenedor) {
  const mod = MOD['personas_solicitud'];
  if (!mod) return;
  try {
    const datos = await api('GET', `/personas_solicitud?f_solicitud_id=${id}&limit=200&sort=id&dir=asc`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🧑‍🤝‍🧑 Personas que involucra</b>
          <span style="color:var(--muted);font-size:13px">${datos.total} persona(s)</span>
          <span class="spacer"></span>
          ${mod.perms.create ? '<button class="btn sm" id="btnPersonaSol">➕ Sumar una persona</button>' : ''}
        </div>
        ${datos.rows.length ? `<ul class="documentos personas-solicitud">
          ${datos.rows.map((r) => `
            <li data-id="${r.id}" data-ficha="${r.miembro_id ? `miembros/${r.miembro_id}` : r.no_miembro_id ? `no_miembros/${r.no_miembro_id}` : ''}">
              <div class="dm"><span class="dico">${r.persona_tipo === 'Miembro' ? '🧍' : '👤'}</span></div>
              <div class="dd">
                <b>${esc(r.persona || '')}</b>
                <span class="badge ${r.persona_tipo === 'Miembro' ? 'green' : 'blue'}">${esc(r.persona_tipo || '')}</span>
                <div class="dfe">${esc(r.relacion || '')}${r.observaciones ? ' — ' + esc(r.observaciones) : ''}</div>
              </div>
              <div class="da">
                <button class="btn sm secondary" data-abrir="1">Ver su ficha</button>
              </div>
            </li>`).join('')}
        </ul>` : '<div class="empty-state" style="padding:26px">Todavía no se ha sumado a nadie. El solicitante sale arriba, en la pestaña de datos.</div>'}
      </div>`;

    const btn = document.getElementById('btnPersonaSol');
    if (btn) btn.addEventListener('click', () => (location.hash = `#/m/personas_solicitud/new?solicitud_id=${id}`));
    contenedor.querySelectorAll('ul.personas-solicitud li').forEach((li) => {
      li.addEventListener('click', (ev) => {
        // El botón abre la ficha de la persona; el resto de la fila, la de su
        // participación en esta solicitud, que es lo que se corrige más seguido.
        if (ev.target.closest('[data-abrir]')) {
          if (li.dataset.ficha) location.hash = `#/m/${li.dataset.ficha.replace('/', '/ficha/')}`;
          return;
        }
        location.hash = `#/m/personas_solicitud/edit/${li.dataset.id}`;
      });
    });
  } catch (e) {
    contenedor.innerHTML = '';
  }
}

/** Historial de una ficha (de un miembro, de una iglesia, de un pastor). */
/**
 * Cuántas anotaciones trae la pestaña de una vez.
 *
 * Antes traía 200 y ahí terminaba: una ficha con 211 decía «211 registro(s)»
 * en su encabezado, mostraba 200 y las once más antiguas no se veían ni había
 * nada que lo dijera. Y las 200 medían 17.109 px, o sea diecinueve pantallas
 * de desplazamiento en las que había que ir leyendo a ojo hasta topar con lo
 * que se buscaba, porque la pestaña no tenía ni buscador ni filtro.
 *
 * Ahora trae de a cincuenta —cuatro pantallas— y, cuando hay más, lo dice y
 * ofrece traerlas. Con catorce anotaciones, que es el caso corriente, no
 * cambia nada: se ven las catorce, como siempre.
 */
const HISTORIAL_DE_A = 50;

async function renderHistorial(panel, id, contenedor, estado) {
  const modHist = MOD[panel.modulo];
  if (!modHist) return;
  const st = estado || { q: '', tipo: '', cuantas: HISTORIAL_DE_A };
  try {
    // Casi todos los historiales se leen por fecha; el de una solicitud, por
    // orden de anotación: en un mismo día pasan varias cosas y lo que importa
    // es en qué orden pasaron.
    const orden = panel.ordenPor || 'fecha';
    /** ¿Esta anotación la dejó el sistema y no se puede corregir? */
    const intocable = (r) => !!panel.automaticasFijas && r.origen === 'Automático';
    const acota = `${st.q ? `&q=${encodeURIComponent(st.q)}` : ''}${st.tipo ? `&f_tipo=${encodeURIComponent(st.tipo)}` : ''}`;
    const datos = await api(
      'GET', `/${panel.modulo}?f_${panel.campo}=${id}&limit=${st.cuantas}&sort=${orden}&dir=desc${acota}`
    );
    /*
     * Cuántas tiene en total, sin acotar. La primera pintada viene sin filtros
     * puestos, así que ese total es este mismo; después se arrastra, para poder
     * decir «12 de 211» sin volver a preguntarlo en cada tecla.
     */
    const acotado = !!(st.q || st.tipo);
    if (!acotado) st.deTodas = datos.total;
    const deTodas = st.deTodas === undefined ? datos.total : st.deTodas;
    const tipos = (modHist.fields.find((f) => f.name === 'tipo') || {}).options || [];
    const rehacer = (cambios) => renderHistorial(panel, id, contenedor, { ...st, ...cambios });

    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>${esc(panel.titulo)}</b>
          <span style="color:var(--muted);font-size:13px">${acotado
            ? `${datos.total} de ${deTodas}`
            : `${datos.total} registro(s)`}</span>
          <span class="spacer"></span>
          <input type="search" id="histBuscar" placeholder="Buscar en el historial…"
                 value="${esc(st.q)}" aria-label="Buscar en el historial" />
          <select id="histTipo" aria-label="Filtrar por tipo de registro">
            <option value="">— Todos los tipos —</option>
            ${tipos.map((o) => {
              const v = typeof o === 'object' ? o.value : o;
              return `<option value="${esc(v)}" ${String(v) === String(st.tipo) ? 'selected' : ''}>${esc(v)}</option>`;
            }).join('')}
          </select>
          ${modHist.perms.create ? `<button class="btn sm" id="btnAnotar">➕ Agregar anotación</button>` : ''}
        </div>
        <div id="histLista">
          ${datos.rows.length ? `<ul class="historial">
            ${datos.rows.map((r) => {
              /*
               * Una anotación del sistema que alguien corrigió a mano seguía
               * diciendo «⚙️ automático» y nada más, con un texto que no era el
               * que el sistema escribió y sin dónde ir a leer el que sí. Ahora
               * lo dice y lo muestra: es la constancia de lo que pasó.
               */
              const corregida = !!r.texto_original;
              const editado = !corregida && r.created_at && r.updated_at && r.created_at !== r.updated_at;
              /*
               * «Automático» dice CÓMO se escribió la línea, no quién la
               * provocó. Detrás de cada anotación automática hay una persona
               * que guardó una ficha: quien cambió el estado a Inactivo, quien
               * la sacó del cuerpo, quien aprobó la solicitud. El sistema
               * guarda su nombre en la misma fila y la pantalla lo tapaba con
               * un engranaje —mientras que en una nota escrita a mano sí lo
               * mostraba—, así que se veía quién escribió una nota y no quién
               * movió una ficha.
               *
               * «Sistema» es el nombre que se anota cuando no hubo nadie
               * —un aviso del día, una tarea sola—, y ahí no se repite: decir
               * «automático · por Sistema» es decir dos veces lo mismo.
               */
              const loHizo = r.registrado_por && r.registrado_por !== 'Sistema' ? esc(r.registrado_por) : '';
              const quien = r.origen === 'Automático'
                ? `⚙️ automático${loHizo ? ' · por ' + loHizo : ''}`
                : '✍️ ' + esc(r.registrado_por || '');
              return `
              <li class="${r.origen === 'Automático' ? 'auto' : 'manual'}">
                <div class="hf">${fechaCorta(r.fecha)}</div>
                <div class="hc">
                  <span class="badge ${badgeClass(r.tipo)}">${esc(r.tipo)}</span>
                  <div class="hd">${esc(r.descripcion)}</div>
                  <div class="hm">${quien}${editado ? ' · ✏️ editado' : ''}${corregida
                    ? ` · ✏️ corregida a mano${r.corregido_por ? ' por ' + esc(r.corregido_por) : ''}${r.updated_at ? ' el ' + fechaCorta(String(r.updated_at).slice(0, 10)) : ''}`
                    : ''}</div>
                  ${r.adjunto ? `<div class="hadj"><a href="/uploads/${esc(r.adjunto)}" target="_blank">📎 ${esc(nombreArchivo(r.adjunto))}</a></div>` : ''}
                  ${corregida ? `<details class="corregida">
                    <summary>Ver lo que había anotado el sistema</summary>
                    <div class="antes">${esc(r.texto_original)}</div>
                  </details>` : ''}
                </div>
                <div class="ha">
                  ${intocable(r) ? '<span class="ico mut" title="Lo anotó el sistema: es la constancia de lo que pasó">🔒</span>' : `
                    ${modHist.perms.edit ? `<button class="ico" data-editar="${r.id}" title="Editar este registro">✏️</button>` : ''}
                    ${modHist.perms.delete && tieneLlave('datos_borrar') ? `<button class="ico" data-borrar="${r.id}" title="Eliminar este registro">🗑️</button>` : ''}`}
                </div>
              </li>`;
            }).join('')}
          </ul>` : `<div class="empty-state" style="padding:26px">${acotado
            ? 'Ninguna anotación coincide con lo que buscó.'
            : 'Sin registros en el historial todavía.'}</div>`}
        </div>
        ${datos.rows.length < datos.total ? `
          <div class="hist-mas">
            <span>Mostrando ${datos.rows.length} de ${datos.total}.</span>
            <button class="btn sm secondary" id="histMas">Ver ${Math.min(HISTORIAL_DE_A, datos.total - datos.rows.length)} más</button>
          </div>` : ''}
      </div>`;

    // Al buscar o filtrar se vuelve al primer tramo: pedir «las 150 primeras»
    // de una búsqueda recién escrita no tiene sentido
    const recargar = () => renderHistorial(panel, id, contenedor, { ...st, deTodas: undefined });
    const btn = document.getElementById('btnAnotar');
    if (btn) btn.addEventListener('click', () => abrirAnotacion(panel, id, recargar));

    const mas = document.getElementById('histMas');
    if (mas) mas.addEventListener('click', () => rehacer({ cuantas: st.cuantas + HISTORIAL_DE_A }));

    const porTipo = document.getElementById('histTipo');
    if (porTipo) porTipo.addEventListener('change', () => rehacer({ tipo: porTipo.value, cuantas: HISTORIAL_DE_A }));

    /*
     * Se espera a que deje de teclear, como el buscador del listado: buscar en
     * cada tecla sería una consulta por letra, y acá cada una mira además el
     * texto de todas sus anotaciones.
     */
    const caja = document.getElementById('histBuscar');
    if (caja) {
      if (st.foco) {
        caja.focus();
        caja.setSelectionRange(caja.value.length, caja.value.length);
      }
      let espera;
      caja.addEventListener('input', () => {
        clearTimeout(espera);
        espera = setTimeout(() => rehacer({ q: caja.value.trim(), cuantas: HISTORIAL_DE_A, foco: true }), 280);
      });
    }

    // Editar un registro del historial
    contenedor.querySelectorAll('[data-editar]').forEach((b) => {
      b.addEventListener('click', () => {
        const registro = datos.rows.find((r) => String(r.id) === b.dataset.editar);
        if (registro) abrirAnotacion(panel, id, recargar, registro);
      });
    });

    // Eliminar un registro del historial
    contenedor.querySelectorAll('[data-borrar]').forEach((b) => {
      b.addEventListener('click', async () => {
        const registro = datos.rows.find((r) => String(r.id) === b.dataset.borrar);
        if (!registro) return;
        const aviso = registro.origen === 'Automático'
          ? '\n\nOjo: este registro lo generó el sistema al ocurrir el hecho.'
          : '';
        if (!confirm(`¿Eliminar este registro del historial?\n\n"${registro.descripcion}"${aviso}\n\nEsta acción no se puede deshacer.`)) return;
        try {
          await api('DELETE', `/${panel.modulo}/${registro.id}`);
          toast('Registro eliminado');
          recargar();
        } catch (e) {
          toast(e.message, true);
        }
      });
    });
  } catch (e) {
    contenedor.innerHTML = '';
  }
}

/**
 * Ventana para escribir una anotación en un historial.
 * Si se le pasa un registro, edita ese en vez de crear uno nuevo.
 */
function abrirAnotacion(panel, id, alGuardar, registro) {
  const tipos = (MOD[panel.modulo].fields.find((f) => f.name === 'tipo').options || []).map((o) => (typeof o === 'object' ? o.value : o));
  /*
   * El documento se adjunta donde se anota.
   *
   * Quien anota una disciplina, un acuerdo o un permiso tiene el papel en la
   * mano o la foto en el teléfono, y ese es el momento en que lo va a
   * adjuntar. La ventana ofrecía Fecha, Tipo y Descripción, y para el
   * documento mandaba a otra parte: guardar, volver a buscar la anotación,
   * abrirla en su ficha completa y guardar otra vez. Cuatro pasos y dos
   * guardados para lo que iba en uno, y el resultado previsible es que el
   * documento no se adjunta.
   *
   * El campo sale del propio módulo, no de una lista escrita acá: los tres
   * historiales que lo tienen lo muestran, y el de una solicitud —que no lo
   * tiene— no muestra nada, en vez de prometer un adjunto que no existe.
   */
  const campoAdjunto = MOD[panel.modulo].fields.find((f) => f.name === 'adjunto' && f.type === 'file');
  const editando = !!registro;
  const valor = (campo, porDefecto) => (editando && registro[campo] != null ? registro[campo] : porDefecto);
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>${editando ? '✏️ Editar registro del historial' : '➕ Nueva anotación'}</h3><button class="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="modal-body">
        ${editando && registro.origen === 'Automático'
          ? `<div class="aviso-auto">⚙️ Este registro lo generó el sistema al ocurrir el hecho. Se puede corregir su
               texto: lo que decía queda guardado y a la vista, con el nombre de quien lo corrigió.
               ${registro.texto_original
                 ? `<div class="antes" style="margin-top:8px"><b>Ya se corrigió antes.</b> El sistema había anotado:
                      «${esc(registro.texto_original)}»</div>`
                 : ''}</div>`
          : ''}
        <div class="fld"><label>Fecha</label><input type="date" id="anFecha" value="${esc(fechaISO(valor('fecha', new Date().toISOString().slice(0, 10))))}" /></div>
        <div class="fld" style="margin-top:12px"><label>Tipo</label>
          <select id="anTipo">${tipos.map((t) => `<option value="${esc(t)}" ${t === valor('tipo', 'Anotación') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </div>
        <div class="fld" style="margin-top:12px"><label>Descripción</label><textarea id="anDesc" placeholder="Qué se quiere dejar registrado…">${esc(valor('descripcion', ''))}</textarea></div>
        ${campoAdjunto ? `
          <div class="fld" style="margin-top:12px"><label>${esc(campoAdjunto.label)}</label>
            <div class="filefld" id="ff_anAdjunto">
              <input type="hidden" name="anAdjunto" value="${esc(valor('adjunto', ''))}" />
              <input type="file" id="file_anAdjunto" class="oculto-de-verdad" ${campoAdjunto.accept ? `accept="${esc(campoAdjunto.accept)}"` : ''} />
              <label class="btn secondary sm" for="file_anAdjunto">📎 Elegir archivo</label>
              <span class="fname" id="fname_anAdjunto">${valor('adjunto', '')
                ? `<a href="/uploads/${esc(valor('adjunto', ''))}" target="_blank">📎 ${esc(nombreArchivo(valor('adjunto', '')))}</a>`
                : '<span class="sin-archivo">Ningún archivo elegido</span>'}</span>
            </div>
          </div>` : ''}
        <div class="form-error" id="anError" style="padding:0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="anCancelar">Cancelar</button>
        <button class="btn" id="anGuardar">💾 Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  // El archivo se sube apenas se elige y deja su nombre en el campo oculto,
  // igual que en el formulario de una ficha: es la misma función.
  if (campoAdjunto) initFileField({ name: 'anAdjunto' });
  const cerrar = () => fondo.remove();
  fondo.querySelector('.cerrar').addEventListener('click', cerrar);
  fondo.querySelector('#anCancelar').addEventListener('click', cerrar);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });

  fondo.querySelector('#anGuardar').addEventListener('click', async () => {
    const descripcion = fondo.querySelector('#anDesc').value.trim();
    if (!descripcion) {
      fondo.querySelector('#anError').textContent = 'Escriba la descripción.';
      return;
    }
    const datos = {
      [panel.campo]: id,
      fecha: fondo.querySelector('#anFecha').value,
      tipo: fondo.querySelector('#anTipo').value,
      descripcion,
    };
    if (campoAdjunto) datos.adjunto = fondo.querySelector('#ff_anAdjunto input[type=hidden]').value;
    try {
      if (editando) await api('PUT', `/${panel.modulo}/${registro.id}`, datos);
      else await api('POST', `/${panel.modulo}`, datos);
      toast(editando ? 'Registro actualizado' : 'Anotación guardada');
      cerrar();
      if (alGuardar) alGuardar();
    } catch (e) {
      fondo.querySelector('#anError').textContent = e.message;
    }
  });
}


/* =====================================================================
 * Ficha del cuerpo: estado de cumplimiento e histórico de directivas
 * ===================================================================== */
/**
 * Todo lo que cuelga de la ficha de un cuerpo: su cumplimiento, su gente, sus
 * cuotas, su tesorería, sus directivas y sus actas. Cada panel se dibuja por
 * su cuenta y se refresca solo cuando cambia algo suyo.
 */
async function renderPanelesCuerpo(cuerpoId, contenedor) {
  contenedor.innerHTML = `
    <div id="cpCumplimiento"></div>
    <div id="cpIntegrantes"></div>
    <div id="cpCuotas"></div>
    <div id="cpTesoreria"></div>
    <div id="cpDirectivas"></div>
    <div id="cpActas"></div>`;

  renderCumplimientoCuerpo(cuerpoId, contenedor.querySelector('#cpCumplimiento'));
  renderIntegrantesCuerpo(cuerpoId, contenedor.querySelector('#cpIntegrantes'));
  renderCuotasCuerpo(cuerpoId, contenedor.querySelector('#cpCuotas'));
  renderTesoreriaCuerpo(cuerpoId, contenedor.querySelector('#cpTesoreria'));
  renderDirectivasCuerpo(cuerpoId, contenedor.querySelector('#cpDirectivas'));
  renderActasCuerpo(cuerpoId, contenedor.querySelector('#cpActas'));
}

/** Los requisitos formales del cuerpo: reglamento, directiva y estado. */
async function renderCumplimientoCuerpo(cuerpoId, caja) {
  const c = await api('GET', `/cuerpos/${cuerpoId}/cumplimiento`).catch(() => null);
  if (!c || !c.items.length) return;
  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>✅ Estado de cumplimiento</b>
        <span class="badge ${nivelClase(c.nivel)}">${esc(c.texto)}</span>
      </div>
      <ul class="cumplimiento">
        ${c.items.map((i) => `
          <li class="${i.ok ? 'ok' : 'falta'}">
            <span class="mk">${i.ok ? '✓' : '✗'}</span>
            <div><b>${esc(i.texto)}</b><span>${esc(i.detalle)}</span></div>
          </li>`).join('')}
      </ul>
    </div>`;
}

/** Cómo se ve el estado de cada integrante. */
const ESTADO_INTEGRANTE = {
  Activo: { clase: 'green', texto: 'Activo' },
  'En prueba': { clase: 'yellow', texto: 'En prueba' },
  Retirado: { clase: '', texto: 'Retirado' },
};

/**
 * La gente del cuerpo: quién está activo, quién en prueba y quién se retiró,
 * con el aviso de a quién se le venció el período de prueba.
 */
async function renderIntegrantesCuerpo(cuerpoId, caja, filtro) {
  // Este panel es Integrantes de Cuerpos: si a esta persona se le quitó ese
  // permiso, no se le muestra ni se pregunta al servidor por él
  if (!MOD['integrantes_cuerpo']) return;
  const d = await api('GET', `/cuerpos/${cuerpoId}/integrantes`).catch(() => null);
  if (!d) return;
  const ver = filtro || (caja.dataset.filtro || 'vigentes');
  caja.dataset.filtro = ver;

  const visibles = d.integrantes.filter((g) => {
    if (ver === 'todos') return true;
    if (ver === 'vigentes') return g.estado !== 'Retirado';
    if (ver === 'prueba') return g.estado === 'En prueba';
    if (ver === 'retirados') return g.estado === 'Retirado';
    return true;
  });

  const chip = (clave, texto, n) =>
    `<button class="chip ${ver === clave ? 'on' : ''}" data-ver="${clave}">${texto} (${fmtNumero(n)})</button>`;

  const aviso = d.resumen.prueba_vencida
    ? `<div class="aviso importante" style="margin:0 14px 12px">
         <b>⏰ Períodos de prueba vencidos</b>
         <span>A ${fmtNumero(d.resumen.prueba_vencida)} integrante(s) ya se les cumplió el plazo y falta evaluar su informe.</span>
       </div>`
    : '';

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🧑‍🤝‍🧑 Integrantes</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(d.resumen.activos)} activo(s) · ${fmtNumero(d.resumen.en_prueba)} en prueba${
          d.resumen.no_inscritos ? ` · ${fmtNumero(d.resumen.no_inscritos)} sin inscribir` : ''}</span>
        <span class="spacer"></span>
        ${d.puede_agregar
          ? `<a class="btn sm" href="#/m/integrantes_cuerpo/new?cuerpo_id=${cuerpoId}">➕ Sumar integrante</a>`
          : ''}
        ${d.puede_agregar && d.admite_no_inscritos
          ? `<a class="btn secondary sm" href="#/m/integrantes_cuerpo/new?cuerpo_id=${cuerpoId}&persona_tipo=No%20miembro"
                title="Para el hermano o la hermana que sirve en este grupo sin estar inscrito en la membresía">
               ➕ Sumar a alguien no inscrito
             </a>`
          : ''}
      </div>
      ${aviso}
      <div class="pl-chips" style="padding:0 14px 10px">
        ${chip('vigentes', 'En el cuerpo', d.resumen.activos + d.resumen.en_prueba)}
        ${chip('prueba', 'En prueba', d.resumen.en_prueba)}
        ${chip('retirados', 'Retirados', d.resumen.retirados)}
        ${chip('todos', 'Todos', d.integrantes.length)}
      </div>
      ${visibles.length ? `<ul class="integrantes">
        ${visibles.map((g) => {
          const e = ESTADO_INTEGRANTE[g.estado] || { clase: '', texto: g.estado };
          const detalle = g.estado === 'En prueba'
            ? (g.fecha_fin_prueba
                ? `${g.prueba_vencida ? '⏰ Se le venció el' : 'Hasta el'} ${fechaCorta(g.fecha_fin_prueba)}`
                : 'Sin plazo definido')
            : g.estado === 'Retirado'
              ? `Se retiró el ${fechaCorta(g.fecha_retiro)}${g.motivo_retiro ? ` · ${esc(g.motivo_retiro)}` : ''}`
              : g.fecha_ingreso ? `Desde el ${fechaCorta(g.fecha_ingreso)}` : '';
          return `
            <li class="${g.prueba_vencida ? 'vencida' : ''}">
              <span class="av">${g.foto
                ? `<img src="/uploads/${esc(g.foto)}" alt="" />`
                : esc((g.nombre || '?').trim().charAt(0).toUpperCase())}</span>
              <div class="dt">
                <b>${esc(g.nombre)}</b>
                <span class="mut">${detalle}</span>
              </div>
              <div class="marcas">
                ${g.lidera ? '<span class="badge blue">Lidera</span>' : ''}
                ${g.persona_tipo === 'No miembro'
                  ? '<span class="badge" title="Sirve en este grupo sin estar inscrito(a) en el registro de miembros">No inscrito(a)</span>'
                  : ''}
                ${g.exento_cuota ? `<span class="badge" title="${esc(g.exento_motivo || '')}">Exento de cuota</span>` : ''}
                <span class="badge ${e.clase}">${esc(e.texto)}</span>
              </div>
              <div class="acciones">
                ${g.estado === 'En prueba' && d.puede_editar
                  ? `<a class="btn secondary sm" href="#/m/evaluaciones_integrantes/new?integrante_id=${g.id}">📋 Evaluar</a>`
                  : ''}
                ${g.persona_tipo === 'No miembro'
                  ? `<a class="btn secondary sm" href="#/m/no_miembros/ficha/${g.no_miembro_id}" title="Ver su ficha">👤</a>`
                  : `<a class="btn secondary sm" href="#/m/miembros/ficha/${g.miembro_id}" title="Ver su ficha">👤</a>`}
                ${d.puede_editar ? `<a class="btn secondary sm" href="#/m/integrantes_cuerpo/edit/${g.id}" title="Editar su pertenencia">✏️</a>` : ''}
              </div>
            </li>`;
        }).join('')}
      </ul>` : '<div class="empty-state" style="padding:26px">No hay integrantes que mostrar acá.</div>'}
    </div>`;

  caja.querySelectorAll('.pl-chips .chip').forEach((b) =>
    b.addEventListener('click', () => renderIntegrantesCuerpo(cuerpoId, caja, b.dataset.ver)));
}

/** La planilla de cuotas del año: quién pagó cada mes. */
async function renderCuotasCuerpo(cuerpoId, caja, anio) {
  // Las cuotas son plata del cuerpo: hacen falta su módulo y la llave
  if (!MOD['cuotas_cuerpo'] || !tieneLlave('tesoreria_cuerpo')) return;
  const cual = anio || Number(caja.dataset.anio) || new Date().getFullYear();
  caja.dataset.anio = cual;
  const d = await api('GET', `/cuerpos/${cuerpoId}/cuotas?anio=${cual}`).catch(() => null);
  if (!d) return;

  if (!d.cobra_cuota) {
    caja.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar"><b>🎟️ Cuotas mensuales</b></div>
        <div class="empty-state" style="padding:26px">
          Este cuerpo no cobra cuota mensual.<br>
          <span class="mut">Se activa en su ficha, en «Cuota mensual».</span>
        </div>
      </div>`;
    return;
  }

  const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const mesesDelAnio = MESES_CORTOS.map((n, i) => ({ n, valor: String(i + 1).padStart(2, '0') }));

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🎟️ Cuotas mensuales</b>
        <span style="color:var(--muted);font-size:13px">
          ${d.cuota_mensual ? `${fmtMoney(d.cuota_mensual)} al mes` : 'sin monto definido'} ·
          recaudado ${fmtMoney(d.total_recaudado)}
        </span>
        <span class="spacer"></span>
        <button class="btn secondary sm" id="cuAntes">← ${cual - 1}</button>
        <b style="font-size:14px">${cual}</b>
        <button class="btn secondary sm" id="cuDespues">${cual + 1} →</button>
      </div>
      ${d.cuota_mensual ? '' : `
        <div class="aviso" style="margin:0 14px 12px">
          <b>Falta el monto</b>
          <span>Escriba cuánto es la cuota en la ficha del cuerpo y podrá marcar los pagos con un toque.</span>
        </div>`}
      <div class="table-scroll">
        <table class="grid cuotas">
          <thead><tr>
            <th>Integrante</th>
            ${mesesDelAnio.map((m) => `<th class="mes">${m.n}</th>`).join('')}
            <th class="num">Pagado</th>
          </tr></thead>
          <tbody>
            ${d.filas.map((f) => `
              <tr>
                <td class="quien">${esc(f.nombre)}${f.exento
                  ? `<span class="badge" title="${esc(f.exento_motivo || '')}">Exento</span>` : ''}</td>
                ${mesesDelAnio.map((m) => {
                  const pago = f.meses[m.valor];
                  if (f.exento) return '<td class="mes exento">—</td>';
                  if (pago) {
                    return `<td class="mes pagado" title="${esc(fmtMoney(pago.monto))} · ${esc(fechaCorta(pago.fecha))}"
                                data-integrante="${f.id}" data-mes="${m.valor}">✓</td>`;
                  }
                  return `<td class="mes debe${d.puede_cobrar && d.cuota_mensual ? ' se-puede' : ''}"
                              data-integrante="${f.id}" data-mes="${m.valor}"
                              title="${d.puede_cobrar && d.cuota_mensual ? 'Marcar como pagada' : 'Sin pagar'}"></td>`;
                }).join('')}
                <td class="num cifra">${f.exento ? '—' : fmtMoney(f.total)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  caja.querySelector('#cuAntes').addEventListener('click', () => renderCuotasCuerpo(cuerpoId, caja, cual - 1));
  caja.querySelector('#cuDespues').addEventListener('click', () => renderCuotasCuerpo(cuerpoId, caja, cual + 1));

  if (!d.puede_cobrar || !d.cuota_mensual) return;
  caja.querySelectorAll('td.mes.se-puede').forEach((celda) =>
    celda.addEventListener('click', async () => {
      celda.textContent = '…';
      try {
        await api('POST', `/cuerpos/${cuerpoId}/cuotas`, {
          integrante_id: Number(celda.dataset.integrante),
          anio: cual,
          mes: celda.dataset.mes,
        });
        toast('Cuota registrada');
        renderCuotasCuerpo(cuerpoId, caja, cual);
        const tes = document.getElementById('cpTesoreria');
        if (tes) renderTesoreriaCuerpo(cuerpoId, tes);
      } catch (e) {
        celda.textContent = '';
        toast(e.message, true);
      }
    }));
}

/** Las cuentas del cuerpo con su saldo, y sus últimos movimientos. */
async function renderTesoreriaCuerpo(cuerpoId, caja) {
  // La plata del cuerpo es un permiso aparte del de la iglesia: quien no lo
  // tenga no ve este panel (ver LLAVES en server/permissions.js)
  if (!MOD['cuentas_tesoreria'] || !tieneLlave('tesoreria_cuerpo')) return;
  const [cuentas, movimientos] = await Promise.all([
    api('GET', `/cuentas_tesoreria?f_cuerpo_id=${cuerpoId}&limit=50`).catch(() => null),
    MOD['tesoreria']
      ? api('GET', `/tesoreria?f_cuerpo_id=${cuerpoId}&sort=fecha&dir=desc&limit=8`).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!cuentas) return;

  /*
   * El total de las cuentas del cuerpo, salvo que las cifras sean reservadas.
   *
   * El saldo viene recortado de la fila —no llega en cero, no llega—, así que
   * sumarlo daba «saldo total $ 0» a quien no alcanza la llave de los montos:
   * un cero inventado, y de los peores, porque se lee como que el cuerpo no
   * tiene un peso (ver estaReservado, y server/sensibles.js).
   */
  const reservado = cuentas.rows.some((c) => (c.reservado_oculto || []).includes('tesoreria_montos'));
  const saldo = cuentas.rows.reduce((t, c) => t + (Number(c.saldo) || 0), 0);
  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>💰 Tesorería del cuerpo</b>
        <span style="color:var(--muted);font-size:13px">${
          reservado ? '🔒 saldos reservados' : `saldo total ${fmtMoney(saldo)}`}</span>
        <span class="spacer"></span>
        ${MOD['cuentas_tesoreria'].perms.create
          ? `<a class="btn sm" href="#/m/cuentas_tesoreria/new?cuerpo_id=${cuerpoId}">➕ Nueva cuenta</a>`
          : ''}
      </div>
      ${cuentas.rows.length ? `<ul class="mini-list">
        <!-- El mismo clic que en Tesorería: el saldo lleva a la cartola de esa
             cuenta, no a su formulario. Es el mismo defecto y merece el mismo
             arreglo; editarla sigue a un clic desde ahí. -->
        ${cuentas.rows.map((c) => `
          <li data-ir="#/cuentas_tesoreria/cartola/${c.id}" title="Ver la cartola de esta cuenta">
            <span>${esc(c.nombre)}
              <span class="badge ${c.tipo === 'General' ? 'blue' : ''}">${esc(c.tipo)}</span>
              ${c.estado === 'Cerrada' ? '<span class="badge">Cerrada</span>' : ''}</span>
            <span class="mut cifra">${reservado ? '—' : fmtMoney(c.saldo)}</span>
          </li>`).join('')}
      </ul>` : '<div class="empty-state" style="padding:22px">Este cuerpo todavía no tiene cuentas.</div>'}
      ${movimientos && movimientos.rows.length ? `
        <div class="toolbar" style="border-top:1px solid var(--border)">
          <b style="font-size:13.5px">Últimos movimientos</b>
          <span class="spacer"></span>
          <a class="btn secondary sm" href="#/m/tesoreria?f_cuerpo_id=${cuerpoId}">Ver todos</a>
        </div>
        <ul class="mov-list">
          ${movimientos.rows.map((m) => `
            <li data-ir="#/m/tesoreria/edit/${m.id}">
              <span>${esc(fechaCorta(m.fecha))} · ${esc(m.concepto)}</span>
              <span class="${m.tipo === 'Ingreso' ? 'monto-ingreso' : 'monto-egreso'}">
                ${m.tipo === 'Ingreso' ? '+' : '−'} ${fmtMoney(m.monto)}</span>
            </li>`).join('')}
        </ul>` : ''}
    </div>`;
}

/**
 * LO QUE LA IGLESIA ES, arriba de su ficha y sin abrir nada.
 *
 * La ficha de una iglesia mostraba cinco datos —nombre, tipo, código, ciudad,
 * estado— y nueve campos en blanco. Mientras tanto el sistema sabía de ella
 * 600 miembros, 13 cuerpos, 28 cuentas, 3.001 movimientos y 150 actividades, y
 * no decía ninguna de esas cifras: para saber cuánta gente tiene una
 * congregación había que ir a Miembros y filtrar; para saber cuánto tiene en
 * caja, a Cuentas de Tesorería y filtrar. La ficha del cuerpo más chico de la
 * organización decía más de sí mismo que la de la congregación entera.
 *
 * VA ARRIBA Y NO EN UNA PESTAÑA. Es lo que se mira ANTES de decidir algo, y lo
 * que está detrás de una pestaña no se mira: quien abre la ficha de una
 * iglesia a resolver algo no va a ir a buscarlo.
 *
 * Se pide aparte y llega después: la ficha no se queda esperando por esto, y si
 * no llega se ve igual que siempre. Cada cifra la manda el servidor solo si esa
 * persona puede verla, así que acá no se decide nada de permisos: lo que no
 * viene, no se dibuja.
 */
async function renderResumenDeIglesia(id, caja) {
  const d = await api('GET', `/iglesias/${id}/resumen`).catch(() => null);
  if (!d || !caja) return;

  const fichas = [];
  const suma = (ic, num, lbl, adonde, apunte) =>
    fichas.push(`<div class="stat"${adonde ? ` data-ir="${esc(adonde)}"` : ''}>
        <div class="num">${esc(num)}</div><div class="lbl">${esc(lbl)}</div><div class="ic">${ic}</div>
        ${apunte ? `<div class="apunte">${esc(apunte)}</div>` : ''}
      </div>`);

  /*
   * El número grande es el de los que SIGUEN AHÍ, y el apunte dice cuántos se
   * fueron. Al revés —el total arriba— la cifra que se lee de un vistazo sería
   * la que incluye a los trasladados y a los fallecidos, que no es la que nadie
   * pregunta al abrir la ficha de una congregación.
   */
  const losQueSeFueron = (c, palabra) =>
    c.total > c.activos ? `y ${fmtNumero(c.total - c.activos)} ${palabra}` : '';

  if (d.miembros) {
    suma('🧍', fmtNumero(d.miembros.activos), 'Miembros', `#/m/miembros?f_iglesia_id=${id}`,
      losQueSeFueron(d.miembros, 'que ya no están'));
  }
  if (d.cuerpos) {
    suma('👥', fmtNumero(d.cuerpos.activos), 'Cuerpos y grupos', `#/m/cuerpos?f_iglesia_id=${id}`,
      losQueSeFueron(d.cuerpos, 'inactivos'));
  }
  if (d.pastores) {
    suma('🧑‍💼', fmtNumero(d.pastores.activos), 'Pastores / guías', `#/m/pastores?f_iglesia_id=${id}`,
      losQueSeFueron(d.pastores, 'que ya no sirven acá'));
  }
  if (d.tesoreria) {
    /*
     * Lo suyo y lo de sus cuerpos van separados, con la misma regla que el
     * inventario: la caja de la iglesia y las cajas de sus cuerpos son plata
     * de dos dueños distintos, y una sola cifra que las sume no contesta
     * ninguna de las dos preguntas.
     */
    const t = d.tesoreria;
    const enCuerpos = t.cuentas_de_cuerpos
      ? `y ${fmtNumero(t.cuentas_de_cuerpos)} de sus cuerpos${
          t.reservado ? '' : `, con ${fmtMoney(t.saldo_de_cuerpos)}`}`
      : '';
    suma('💰', t.reservado ? '🔒' : fmtMoney(t.saldo),
      t.reservado ? `${fmtNumero(t.cuentas)} caja(s) · saldos reservados` : 'En sus propias cajas',
      `#/m/cuentas_tesoreria?f_iglesia_id=${id}`, enCuerpos);
  }
  if (d.asistencia) {
    suma('✅', fmtNumero(d.asistencia.este_ano), 'Actividades este año',
      `#/m/asistencias?f_iglesia_id=${id}`,
      d.asistencia.ultima ? `la última, el ${fechaCorta(d.asistencia.ultima)}` : 'ninguna todavía');
  }
  // Las solicitudes solo cuando hay: un cero permanente ocupa el lugar de algo
  // que sí importa, y esta fila se lee de un vistazo o no se lee
  if (d.solicitudes && d.solicitudes.abiertas) {
    suma('📨', fmtNumero(d.solicitudes.abiertas), 'Solicitudes en trámite',
      `#/m/solicitudes?f_iglesia_id=${id}`);
  }

  if (!fichas.length) return;
  caja.innerHTML = `<div class="stats">${fichas.join('')}</div>`;
}

/**
 * Un listado corto de lo que cuelga de la iglesia, con el enlace al completo.
 *
 * Los tres paneles nuevos —Miembros, Cuerpos, Pastores— son la misma cosa con
 * otro módulo adentro, así que se escriben una vez. Piden el listado de siempre
 * con el filtro de la iglesia puesto, y eso importa: el alcance, los permisos y
 * los datos reservados los aplica el motor en esa ruta como en cualquier otra,
 * y no hay una segunda consulta escrita a mano que pueda quedarse atrás.
 */
async function renderLoDeLaIglesia({ modulo, id, icono, titulo, cuantos = 12, sort, comoSeLee, vacio }, caja) {
  if (!MOD[modulo]) return;
  const q = new URLSearchParams({ f_iglesia_id: String(id), limit: String(cuantos) });
  if (sort) { q.set('sort', sort); q.set('dir', 'asc'); }
  const d = await api('GET', `/${modulo}?${q.toString()}`).catch(() => null);
  if (!d) return;

  const hay = d.rows.length;
  const faltan = (d.total || 0) - hay;
  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>${icono} ${esc(titulo)}</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(d.total || 0)}</span>
        <span class="spacer"></span>
        ${MOD[modulo].perms.create
          ? `<a class="btn sm" href="#/m/${modulo}/new?iglesia_id=${id}">➕ ${esc(nuevoDe(MOD[modulo]))}</a>` : ''}
        <a class="btn secondary sm" href="#/m/${modulo}?f_iglesia_id=${id}">Ver todos</a>
      </div>
      ${hay ? `<ul class="mini-list">
        ${d.rows.map((f) => {
          const { texto, apunte, estado } = comoSeLee(f);
          return `<li data-ir="#/m/${modulo}/${CON_FICHA.includes(modulo) ? 'ficha' : 'edit'}/${f.id}">
            <span>${esc(texto)}${estado ? ` <span class="badge ${badgeClass(estado)}">${esc(estado)}</span>` : ''}</span>
            <span class="mut">${esc(apunte || '')}</span>
          </li>`;
        }).join('')}
      </ul>` : `<div class="empty-state" style="padding:22px">${esc(vacio)}</div>`}
      ${faltan > 0
        ? `<div class="card-body" style="color:var(--muted);font-size:13px;border-top:1px solid var(--border)">
             y ${fmtNumero(faltan)} más — <a href="#/m/${modulo}?f_iglesia_id=${id}">verlos todos</a></div>` : ''}
    </div>`;
}

/**
 * La tesorería de la iglesia, en su ficha.
 *
 * SUS PROPIAS CAJAS, no las de sus cuerpos: cada cuerpo tiene la suya en su
 * ficha desde la 1.113.0, y mezclarlas acá haría que un mismo peso se contara
 * en dos lugares. Es la misma separación que el inventario de la 1.231.0.
 */
async function renderTesoreriaDeLaIglesia(iglesiaId, caja) {
  if (!MOD['cuentas_tesoreria']) return;
  const [cuentas, movimientos] = await Promise.all([
    api('GET', `/cuentas_tesoreria?f_iglesia_id=${iglesiaId}&limit=100`).catch(() => null),
    MOD['tesoreria']
      ? api('GET', `/tesoreria?f_iglesia_id=${iglesiaId}&sort=fecha&dir=desc&limit=8`).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (!cuentas) return;

  const propias = cuentas.rows.filter((c) => !c.cuerpo_id);
  const deCuerpos = cuentas.rows.length - propias.length;
  /*
   * El saldo viene recortado de la fila para quien no alcanza la llave de los
   * montos —no llega en cero, no llega—, así que sumarlo daría «saldo total
   * $ 0»: un cero inventado, y de los peores, porque se lee como que la
   * iglesia no tiene un peso (ver server/sensibles.js).
   */
  const reservado = propias.some((c) => (c.reservado_oculto || []).includes('tesoreria_montos'));
  const saldo = propias.reduce((t, c) => t + (Number(c.saldo) || 0), 0);

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>💰 Tesorería de la iglesia</b>
        <span style="color:var(--muted);font-size:13px">${
          reservado ? '🔒 saldos reservados' : `saldo total ${fmtMoney(saldo)}`}</span>
        <span class="spacer"></span>
        ${MOD['cuentas_tesoreria'].perms.create
          ? `<a class="btn sm" href="#/m/cuentas_tesoreria/new?iglesia_id=${iglesiaId}">➕ Nueva cuenta</a>` : ''}
      </div>
      ${propias.length ? `<ul class="mini-list">
        ${propias.map((c) => `
          <li data-ir="#/cuentas_tesoreria/cartola/${c.id}" title="Ver la cartola de esta cuenta">
            <span>${esc(c.nombre)}
              <span class="badge ${c.tipo === 'General' ? 'blue' : ''}">${esc(c.tipo)}</span>
              ${c.estado === 'Cerrada' ? '<span class="badge">Cerrada</span>' : ''}</span>
            <span class="mut cifra">${reservado ? '—' : fmtMoney(c.saldo)}</span>
          </li>`).join('')}
      </ul>` : '<div class="empty-state" style="padding:22px">Esta iglesia todavía no tiene cajas propias.</div>'}
      ${deCuerpos ? `
        <div class="card-body" style="color:var(--muted);font-size:13px;border-top:1px solid var(--border)">
          Sus cuerpos y grupos tienen además ${fmtNumero(deCuerpos)} caja(s) propia(s), que se ven
          en la ficha de cada uno: esa plata tiene otro dueño y no se suma acá.
        </div>` : ''}
      ${movimientos && movimientos.rows.length ? `
        <div class="toolbar" style="border-top:1px solid var(--border)">
          <b style="font-size:13.5px">Últimos movimientos</b>
          <span class="spacer"></span>
          <a class="btn secondary sm" href="#/m/tesoreria?f_iglesia_id=${iglesiaId}">Ver todos</a>
        </div>
        <ul class="mov-list">
          ${movimientos.rows.map((m) => `
            <li data-ir="#/m/tesoreria/edit/${m.id}">
              <span>${esc(fechaCorta(m.fecha))} · ${esc(m.concepto)}</span>
              <span class="${m.tipo === 'Ingreso' ? 'monto-ingreso' : 'monto-egreso'}">
                ${m.tipo === 'Ingreso' ? '+' : '−'} ${fmtMoney(m.monto)}</span>
            </li>`).join('')}
        </ul>` : ''}
    </div>`;
}

/**
 * EL INVENTARIO DE UN NIVEL, en la ficha de su cuerpo o de su iglesia.
 *
 * «El inventario de este cuerpo» no se podía pedir: la ficha del cuerpo tenía
 * pestaña de integrantes, cuotas, tesorería, directivas y actas, y el
 * inventario era lo único suyo que se quedaba fuera. La de la iglesia tampoco
 * lo mostraba, y el listado no se dejaba filtrar por cuerpo. Había que ir al
 * listado general y buscarlo a ojo.
 *
 * LOS TOTALES VAN SEPARADOS, que es de lo que se trata: lo de la iglesia por un
 * lado y lo ajeno —prestado y en depósito— por otro. Sumarlos juntos no sirve
 * para ninguna de las dos preguntas: ni «cuánto tiene» ni «cuánto está
 * cuidando de otros». Los cuenta el servidor, en la misma ruta que arma la
 * hoja, para que la pantalla y el papel no puedan discrepar.
 */
async function renderInventarioDeNivel({ ambito, cuerpoId, iglesiaId, titulo }, caja) {
  if (!MOD['inventarios']) return;
  const q = new URLSearchParams({ ambito });
  if (cuerpoId) q.set('cuerpo_id', cuerpoId);
  if (iglesiaId) q.set('iglesia_id', iglesiaId);
  const d = await api('GET', '/inventarios/de-nivel?' + q.toString()).catch(() => null);
  if (!d) return;

  const nuevo = new URLSearchParams({ ambito });
  if (cuerpoId) nuevo.set('cuerpo_id', cuerpoId);
  if (iglesiaId) nuevo.set('iglesia_id', iglesiaId);
  const enPie = d.filas.filter((f) => !f.fecha_devuelto);

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>📦 ${esc(titulo)}</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(enPie.length)} artículo(s)</span>
        <span class="spacer"></span>
        <a class="btn secondary sm" href="#/inventarios/hoja/${cuerpoId ? `cuerpo/${cuerpoId}` : iglesiaId ? `iglesia/${iglesiaId}` : 'corporacion'}">🖨️ Hoja del inventario</a>
        ${MOD['inventarios'].perms.create
          ? `<a class="btn sm" href="#/m/inventarios/new?${nuevo.toString()}">➕ Nuevo artículo</a>`
          : ''}
      </div>
      ${totalesDelInventario(d.totales, d.ambito)}
      ${enPie.length ? `<ul class="mini-list">
        ${enPie.map((f) => `
          <li data-ir="#/m/inventarios/ficha/${f.id}">
            <span>${esc(f.articulo)}
              ${f.cantidad > 1 ? `<span class="mut">× ${fmtNumero(f.cantidad)}</span>` : ''}
              ${f.regimen !== 'Propio' ? `<span class="badge">${esc(f.regimen)}${f.dueno ? ` · ${esc(f.dueno)}` : ''}</span>` : ''}</span>
            <span class="mut cifra">${f.valor_estimado ? fmtMoney(f.cantidad * f.valor_estimado) : ''}</span>
          </li>`).join('')}
      </ul>` : '<div class="empty-state" style="padding:22px">Todavía no hay nada inventariado acá.</div>'}
      ${d.totales.devueltos.articulos ? `
        <div class="toolbar" style="border-top:1px solid var(--border)">
          <span class="mut" style="font-size:13px">Además, ${fmtNumero(d.totales.devueltos.articulos)}
            artículo(s) que estuvieron acá y ya se devolvieron a su dueño.</span>
        </div>` : ''}
    </div>`;
}

/**
 * Los totales de un inventario, con lo propio y lo ajeno por separado.
 *
 * Se usa igual en la pestaña de la ficha y en la hoja que se imprime: es la
 * misma pregunta y tiene que dar la misma respuesta en los dos lugares. Las
 * filas que valen cero no se dibujan —una iglesia sin nada prestado no necesita
 * una línea que diga «$ 0 prestado»—, salvo la de lo propio, que es la razón
 * de que exista la tabla.
 */
/** De quién es lo propio, según el nivel que se está mirando. */
const DUENO_DEL_NIVEL = {
  'Corporación': 'de la corporación',
  'Iglesia local': 'de la iglesia',
  'Cuerpo / Grupo': 'del cuerpo o grupo',
};

function totalesDelInventario(t, ambito) {
  // Nombrar el nivel importa: la hoja de la corporación decía «De la iglesia»
  // sobre la camioneta de la organización, y la de un cuerpo sobre su teclado
  const suyo = DUENO_DEL_NIVEL[ambito] || 'de la organización';
  const fila = (etiqueta, cual, { siempre = false, clase = '' } = {}) =>
    (!cual.articulos && !siempre ? '' : `
    <div class="ln${clase ? ` ${clase}` : ''}">
      <span class="q">${esc(etiqueta)}</span>
      <span class="mut">${fmtNumero(cual.articulos)} artículo(s) · ${fmtNumero(cual.unidades)} unidad(es)</span>
      <span class="v cifra">${cual.valor ? fmtMoney(cual.valor) : '—'}</span>
    </div>`);
  return `
    <div class="inv-totales">
      ${fila(`Propio, ${suyo}`, t.propio, { siempre: true })}
      ${fila('Prestado, hay que devolverlo', t.prestado)}
      ${fila('En depósito, de su dueño', t.deposito)}
      ${fila(`No es ${suyo}, en total`, t.ajeno, { clase: 'total' })}
    </div>`;
}

/** Las directivas del cuerpo, período por período. */
async function renderDirectivasCuerpo(cuerpoId, caja) {
  if (!MOD['directivas']) return;
  const directivas = await api('GET', `/directivas?f_cuerpo_id=${cuerpoId}&sort=fecha_inicio&dir=desc&limit=50`)
    .catch(() => null);
  if (!directivas) return;
  const cargo = (d, campo, etiqueta) =>
    d[campo + '_label'] ? `<span class="cargo"><i>${etiqueta}:</i> ${esc(d[campo + '_label'])}</span>` : '';

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🏅 Directivas</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(directivas.total)} período(s)</span>
        <span class="spacer"></span>
        ${MOD['directivas'].perms.create
          ? `<a class="btn sm" href="#/m/directivas/new?cuerpo_id=${cuerpoId}">➕ Nueva directiva</a>`
          : ''}
      </div>
      ${directivas.rows.length ? `<ul class="directivas">
        ${directivas.rows.map((d) => `
          <li class="${d.estado === 'Vigente' ? 'vigente' : ''}" data-ir="#/m/directivas/edit/${d.id}">
            <div class="dp">
              <b>${esc(d.periodo)}</b>
              <span class="badge ${d.estado === 'Vigente' ? 'green' : ''}">${esc(d.estado)}</span>
            </div>
            <div class="df">${fechaCorta(d.fecha_inicio)}${d.fecha_termino ? ' — ' + fechaCorta(d.fecha_termino) : ''}</div>
            <div class="dc">
              ${cargo(d, 'oficial_supervisor_id', 'Oficial supervisor(a)')}
              ${cargo(d, 'primer_jefe_id', 'Primer jefe/a')}
              ${cargo(d, 'segundo_jefe_id', 'Segundo jefe/a')}
              ${cargo(d, 'secretario_id', 'Secretario(a)')}
              ${cargo(d, 'tesorero_id', 'Tesorero(a)')}
              ${cargo(d, 'consejero_id', 'Consejero(a)')}
              ${d.otros_cargos ? `<span class="cargo">${esc(d.otros_cargos)}</span>` : ''}
            </div>
          </li>`).join('')}
      </ul>` : '<div class="empty-state" style="padding:26px">Todavía no hay directivas registradas.</div>'}
    </div>`;
}

/** Las actas de las reuniones administrativas del cuerpo. */
/**
 * Baja el acta completa como PDF.
 *
 * Se arma en el servidor y no con el diálogo de impresión del navegador: así
 * sale igual en cualquier aparato —el teléfono incluido, donde «guardar como
 * PDF» es un trámite— y con el membrete, la asistencia y el pie que
 * corresponden (ver server/pdf/acta.js).
 */
async function descargarActaEnPdf(id, boton) {
  const decia = boton ? boton.textContent : '';
  if (boton) { boton.disabled = true; boton.textContent = 'Preparando…'; }
  try {
    const nombre = await bajarArchivoConSesion(`/api/actas_reuniones/${id}/pdf`, `Acta ${id}.pdf`);
    toast(`Se descargó «${nombre}»`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = decia; }
  }
}

/**
 * Las dos ayudas del acta: traer el texto del adjunto y ver a quién enlaza.
 *
 * Un acta se registra de dos maneras —escribiéndola acá o adjuntando el
 * documento firmado—, y hasta ahora eran dos caminos que no se cruzaban: lo
 * adjunto quedaba como un archivo cerrado que no se busca ni se lee sin
 * bajarlo. Estas dos cosas los juntan.
 */
/**
 * Hay hojas que van SIEMPRE a lo ancho, y en ellas no se elige la orientación.
 *
 * No es una preferencia. La de presentación de niños reparte el nombre del
 * niño, la frase con los espacios, los padres y las dos parejas de padrinos a
 * lo ancho; la de matrimonio nombra a los dos cónyuges en una sola línea. De
 * pie, esas mismas filas se parten en dos y la hoja deja de ser la que la
 * iglesia usa en papel.
 *
 * Así que al elegir una de esas dos disposiciones la orientación se pone en
 * horizontal, se apaga el selector y se dice por qué. El servidor la corrige
 * igual al guardar: lo que la pantalla no ofrece hay que rechazarlo de todas
 * maneras.
 */
const CERT_SIEMPRE_APAISADAS = ['Presentación de niños', 'Matrimonio'];

function prepararElFormato() {
  const como = document.querySelector('#recForm [name="disposicion"]');
  const hacia = document.querySelector('#recForm [name="orientacion"]');
  if (!como || !hacia) return;

  const nota = document.createElement('div');
  nota.className = 'mut';
  nota.style.cssText = 'font-size:12px;margin-top:4px';
  nota.hidden = true;
  nota.textContent = 'Esta hoja va siempre a lo ancho: está hecha así.';
  hacia.parentElement.appendChild(nota);

  const mirar = () => {
    const apaisada = CERT_SIEMPRE_APAISADAS.includes(como.value);
    nota.hidden = !apaisada;
    hacia.disabled = apaisada;
    if (apaisada && hacia.value !== 'Horizontal') {
      hacia.value = 'Horizontal';
      hacia.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  como.addEventListener('change', mirar);
  mirar();
}

/**
 * Cada tipo de certificado pide los datos que su hoja necesita.
 *
 * No todos piden lo mismo: uno de membresía se resuelve con el nombre y la
 * fecha; uno de PRESENTACIÓN DE NIÑOS dice cuándo nació el niño, quiénes son
 * sus padres y sus padrinos; uno de MATRIMONIO nombra a los dos cónyuges. Qué
 * forma tiene la hoja lo dice la DISPOSICIÓN del formato elegido, y de ella
 * cuelgan esos campos por la vía normal del motor (showIf).
 *
 * Acá solo se mantiene al día ese campo: al cambiar el tipo se busca su
 * disposición en la lista que ya trajo el selector —no hace falta preguntar de
 * nuevo al servidor— y se avisa del cambio, que es lo que hace aparecer o
 * desaparecer los bloques. El servidor la vuelve a resolver al guardar y
 * comprueba que estén los datos: lo que decide la pantalla no basta para
 * emitir un documento que se firma y se entrega.
 */
function prepararElCertificado() {
  const tipo = document.querySelector('#recForm [name="tipo"]');
  const como = document.querySelector('#recForm [name="disposicion"]');
  if (!tipo || !como) return;

  const mirar = () => {
    const lista = optionsCache['/formatos_certificado/opciones'] || [];
    const suyo = lista.find((o) => String(o.id) === String(tipo.value));
    const nueva = (suyo && suyo.disposicion) || 'Clásica';
    if (como.value === nueva) return;
    como.value = nueva;
    como.dispatchEvent(new Event('change', { bubbles: true }));
  };

  tipo.addEventListener('change', mirar);
  mirar();
}

/**
 * Las dos cosas en que un grupo no se parece a un cuerpo, en la pantalla.
 *
 *   · QUIÉN LO DIRIGE. A un cuerpo lo dirige un miembro inscrito. A un grupo
 *     lo puede dirigir alguien del registro aparte, así que la opción se
 *     ofrece solo cuando el tipo es Grupo.
 *   · LA CUOTA. Un cuerpo nace cobrando y un grupo no, porque casi ningún
 *     grupo cobra y hasta ahora nacían cobrando igual: si nadie se acordaba
 *     de apagarlo, su gente quedaba con una deuda que nunca existió.
 *
 * La casilla de la cuota sigue al tipo SOLO mientras nadie la haya tocado. En
 * cuanto la persona la marca o la desmarca, manda ella: cambiar el tipo
 * después no puede deshacer lo que acaba de decidir.
 */
function prepararElCuerpo(isNew) {
  const tipo = document.querySelector('#recForm [name="tipo"]');
  if (!tipo) return;

  // --- Quién lo dirige ---
  const liderTipo = document.querySelector('#recForm [name="lider_tipo"]');
  const sueltaEl = liderTipo && [...liderTipo.options].find((o) => o.value === 'No miembro');
  let nota = null;
  if (sueltaEl) {
    nota = document.createElement('div');
    nota.className = 'mut';
    nota.style.cssText = 'font-size:12px;margin-top:4px';
    nota.hidden = true;
    nota.textContent = 'Un cuerpo lo dirige un miembro inscrito. Para otra cosa, el tipo tiene que ser Grupo.';
    liderTipo.parentElement.appendChild(nota);
  }

  // --- La cuota ---
  const cuota = document.querySelector('#recForm [name="cobra_cuota"]');
  let laTocaron = false;
  if (cuota) cuota.addEventListener('change', () => { laTocaron = true; });

  const seguirAlTipo = () => {
    const esGrupo = tipo.value === 'Grupo';
    if (sueltaEl) {
      sueltaEl.disabled = !esGrupo;
      nota.hidden = esGrupo;
      if (!esGrupo && liderTipo.value === 'No miembro') {
        liderTipo.value = 'Miembro';
        liderTipo.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    // Solo al crear: en una ficha que ya existe, lo guardado manda
    if (cuota && isNew && !laTocaron) cuota.checked = !esGrupo;
  };

  tipo.addEventListener('change', seguirAlTipo);
  seguirAlTipo();
}

/**
 * En un CUERPO solo entran miembros inscritos; en un GRUPO, cualquiera.
 *
 * Es la distinción de siempre entre las dos cosas: el cuerpo es formal —tiene
 * reglamento, deberes y derechos, y su directiva sale de sus integrantes— y el
 * grupo es una agrupación de servicio, donde sirve gente que no necesariamente
 * está inscrita en la membresía.
 *
 * Acá se apaga la opción cuando el destino elegido es un cuerpo, y se dice por
 * qué. No es la comprobación de verdad —esa la hace el servidor al guardar,
 * porque lo que la pantalla no ofrece hay que rechazarlo igual—, es para no
 * dejar elegir algo que va a terminar en un error.
 */
function prepararElIntegrante() {
  const tipo = document.querySelector('#recForm [name="persona_tipo"]');
  const cuerpo = document.querySelector('#recForm [name="cuerpo_id"]');
  if (!tipo || !cuerpo) return;

  const opcionSuelta = [...tipo.options].find((o) => o.value === 'No miembro');
  if (!opcionSuelta) return;

  const nota = document.createElement('div');
  nota.className = 'mut';
  nota.style.cssText = 'font-size:12px;margin-top:4px';
  nota.hidden = true;
  nota.textContent = 'Este es un cuerpo, no un grupo: se compone de miembros inscritos.';
  tipo.parentElement.appendChild(nota);

  const mirar = async () => {
    const id = Number(cuerpo.value);
    if (!id) { opcionSuelta.disabled = false; nota.hidden = true; return; }
    const fila = await api('GET', `/cuerpos/${id}`).catch(() => null);
    const esGrupo = !fila || fila.tipo === 'Grupo';
    opcionSuelta.disabled = !esGrupo;
    nota.hidden = esGrupo;
    // Si venía elegida y el cuerpo no la admite, se vuelve a lo normal
    if (!esGrupo && tipo.value === 'No miembro') {
      tipo.value = 'Miembro';
      tipo.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  cuerpo.addEventListener('change', mirar);
  mirar();
}

/**
 * POR DÓNDE PUEDE SEGUIR UNA SOLICITUD.
 *
 * Es la misma tabla que tiene el servidor (SIGUIENTES, en
 * server/modules/solicitudes.js), escrita acá para que el formulario no
 * ofrezca un estado que después va a ser rechazado. Una prueba del motor
 * compara las dos y falla si se separan.
 *
 * Se lee así: entre los tres estados abiertos se anda libremente; desde
 * cualquiera de ellos se cierra de las cuatro maneras; y desde uno cerrado
 * solo se puede REABRIR, salvo que lo aprobado se complete, que es el final
 * natural de una solicitud concedida. Para pasar de un cierre a otro hay que
 * reabrirla primero, y esa decisión queda escrita en su historial.
 */
const SOL_SIGUIENTES = {
  Pendiente: ['Pendiente', 'En revisión', 'En espera de antecedentes', 'Aprobada', 'Rechazada', 'Completada', 'Anulada'],
  'En revisión': ['Pendiente', 'En revisión', 'En espera de antecedentes', 'Aprobada', 'Rechazada', 'Completada', 'Anulada'],
  'En espera de antecedentes': ['Pendiente', 'En revisión', 'En espera de antecedentes', 'Aprobada', 'Rechazada', 'Completada', 'Anulada'],
  Aprobada: ['Pendiente', 'En revisión', 'En espera de antecedentes', 'Completada'],
  Rechazada: ['Pendiente', 'En revisión', 'En espera de antecedentes'],
  Completada: ['Pendiente', 'En revisión', 'En espera de antecedentes'],
  Anulada: ['Pendiente', 'En revisión', 'En espera de antecedentes'],
};

/** Los cuatro con los que la solicitud ya no está en trámite. */
const SOL_CERRADOS = ['Aprobada', 'Rechazada', 'Completada', 'Anulada'];

/**
 * La ficha de una solicitud, con su recorrido a la vista.
 *
 * Dos cosas, y las dos son para no dejar elegir algo que el servidor va a
 * rechazar. La comprobación de verdad la hace él al guardar: lo que la
 * pantalla no ofrece hay que rechazarlo de todas maneras.
 *
 *   · LOS ESTADOS QUE NO SIGUEN se apagan, y se dice por qué. Estando anulada,
 *     «Completada» no está: primero se reabre.
 *   · LA RESOLUCIÓN SE PIDE al cerrar. Se marca el campo como obligatorio en
 *     cuanto el estado elegido es uno de cierre, y se deja de pedir si ya
 *     venía escrita —lo aprobado que ahora se completa— o si la solicitud
 *     vuelve a quedar abierta.
 */
function prepararLaSolicitud(row, isNew) {
  // Con siete opciones el estado es un desplegable normal, no uno con buscador
  // (ese deja un campo oculto sin lista que apagar). Si algún día pasara a
  // serlo, esto se hace a un lado en vez de romper la ficha entera.
  const estado = document.querySelector('#recForm [name="estado"]');
  if (!estado || !estado.options) return;

  const respuesta = document.querySelector('#recForm [name="respuesta"]');
  const desde = isNew ? null : row.estado;
  const yaEstaba = String((row && row.respuesta) || '').trim() !== '';

  // --- Los estados a los que sí puede pasar ---
  const nota = document.createElement('div');
  nota.className = 'mut';
  nota.style.cssText = 'font-size:12px;margin-top:4px';
  nota.hidden = true;
  estado.parentElement.appendChild(nota);

  if (desde) {
    const siguen = SOL_SIGUIENTES[desde] || [];
    let apagados = 0;
    [...estado.options].forEach((o) => {
      if (!o.value || o.value === desde) return;
      o.disabled = !siguen.includes(o.value);
      if (o.disabled) apagados++;
    });
    if (apagados) {
      nota.hidden = false;
      nota.textContent = SOL_CERRADOS.includes(desde)
        ? `Esta solicitud está ${desde.toLowerCase()}. Para cerrarla de otra manera, primero vuelva a `
          + 'ponerla en trámite; el cambio queda anotado en su historial.'
        : 'Desde este estado no se puede pasar a los que aparecen apagados.';
    }
  }

  // --- La resolución hace falta para cerrar ---
  if (!respuesta) return;
  const pedirla = () => {
    const cierra = SOL_CERRADOS.includes(estado.value);
    respuesta.required = cierra && !yaEstaba;
  };
  estado.addEventListener('change', pedirla);
  pedirla();
}

function prepararElActa(id, row, isNew) {
  ponerBotonDeTranscribir(id, row, isNew);
  ponerPanelDeAsistencia(row);
  ponerBotonDePdf(id, isNew);
  proponerElNumeroDeActa(isNew, {
    ruta: '/actas_reuniones/proximo-numero',
    // Cada cuerpo lleva su propio libro, y el año lo pone la fecha del acta
    depende: ['cuerpo_id', 'fecha'],
    clave: 'cuerpo_id',
  });
}

/**
 * Propone el número que le toca a la próxima acta, y lo deja cambiar.
 *
 * SOLO PROPONE. El número se escribe en el campo como cualquier otro valor y
 * la persona lo puede corregir: hay actas que llegan con su número ya puesto
 * y libros que vienen de antes y no empiezan en 001.
 *
 * Y solo pisa lo que él mismo escribió. Si uno cambia el cuerpo, el número que
 * el sistema había propuesto deja de valer y se propone el del libro nuevo;
 * pero si uno escribió el suyo, no se lo tocan más, ni cambiando el cuerpo
 * diez veces. Sin esa distinción, el sistema le borraría a alguien lo que
 * acaba de escribir, que es la peor manera de ayudar.
 */
function proponerElNumeroDeActa(isNew, { ruta, depende, clave, campo: cual = 'numero_acta' }) {
  if (!isNew) return; // lo ya guardado conserva el número que tenga
  const form = document.getElementById('recForm');
  if (!form) return;
  const campo = form.querySelector(`[name="${cual}"]`);
  if (!campo) return;

  let loQuePropuso = null;
  const valorDe = (nombre) => {
    const el = form.querySelector(`[name="${nombre}"]`);
    return el ? el.value : '';
  };

  const proponer = async () => {
    // Lo escrito por la persona manda: solo se reemplaza lo vacío o lo que
    // propuso el propio sistema y todavía nadie tocó.
    const escrito = campo.value.trim();
    if (escrito && escrito !== loQuePropuso) return;

    const dentroDe = valorDe(clave);
    if (!dentroDe) return;
    const partes = depende.map((n) => `${n}=${encodeURIComponent(valorDe(n))}`).join('&');
    let r;
    try {
      r = await api('GET', `${ruta}?${partes}`);
    } catch (e) {
      return; // sin propuesta se escribe a mano, como antes
    }
    if (!r || !r.numero) {
      /*
       * Sin propuesta —se vació el cuerpo, o el flujo elegido no lleva
       * correlativo— se retira la que el propio sistema había puesto. Dejarla
       * a la vista sería ofrecer un número que al guardar se descarta, y quien
       * lo vio anotado en su cuaderno lo daría por asignado.
       */
      if (loQuePropuso && campo.value.trim() === loQuePropuso) {
        campo.value = '';
        loQuePropuso = null;
      }
      return;
    }
    campo.value = r.numero;
    loQuePropuso = r.numero;
  };

  proponer();
  // Se oye el formulario y no cada campo, por lo mismo que arriba: un campo de
  // referencia con muchas opciones avisa desde su caja de búsqueda y no desde
  // el campo oculto que lleva el nombre.
  form.addEventListener('change', (e) => {
    if (!e.target || !e.target.closest) return;
    const suyo = e.target.closest('.fld');
    if (!suyo) return;
    const nombres = [...suyo.querySelectorAll('[name]')].map((el) => el.name);
    if (nombres.some((n) => depende.includes(n))) proponer();
  });
}

/**
 * «Descargar PDF» en la ficha del acta, al lado de «Imprimir».
 *
 * En un acta que no se ha guardado no se ofrece: no hay nada que bajar
 * todavía, y un botón que solo sabe fallar es peor que no tenerlo.
 */
function ponerBotonDePdf(id, isNew) {
  if (isNew || !tieneLlave('datos_impresion')) return;
  const acciones = content().querySelector('.page-head .actions');
  if (!acciones || document.getElementById('actaPDF')) return;
  acciones.insertAdjacentHTML('afterbegin',
    '<button class="btn secondary" id="actaPDF">⬇️ Descargar PDF</button>');
  const boton = document.getElementById('actaPDF');
  boton.addEventListener('click', () => descargarActaEnPdf(id, boton));
}

/**
 * «Traer el texto del documento», al lado del editor.
 *
 * Solo aparece cuando hay algo que traer: un acta ya guardada y con documento
 * adjunto. En una recién creada no se ofrece porque el archivo todavía no está
 * en el servidor —se sube al guardar—, y un botón que solo sabe fallar es peor
 * que no tenerlo.
 */
function ponerBotonDeTranscribir(id, row, isNew) {
  if (isNew || !row.documento) return;
  const barra = document.querySelector('#rico_desarrollo .rico-barra');
  if (!barra || document.getElementById('actaTranscribir')) return;

  barra.insertAdjacentHTML('beforeend',
    '<span class="sep"></span>'
    + '<button type="button" id="actaTranscribir" title="Copiar acá el texto del documento adjunto">'
    + '📄 Traer el texto del documento</button>');

  document.getElementById('actaTranscribir').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const hoja = document.getElementById('ricoh_desarrollo');
    const oculto = document.querySelector('#rico_desarrollo input[type=hidden]');
    if (!hoja || !oculto) return;

    // Reemplazar lo escrito es una decisión de quien redacta, no algo que deba
    // pasarle por encima: si ya hay texto, se pregunta.
    if (hoja.textContent.trim() && !confirm(
      'El desarrollo ya tiene texto escrito.\n\n'
      + 'Traer el del documento lo REEMPLAZA por completo.\n\n'
      + '¿Seguir?'
    )) return;

    const decia = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Leyendo el documento…';
    try {
      const r = await api('POST', `/actas_reuniones/${id}/transcribir`);
      hoja.innerHTML = r.texto;
      oculto.value = r.texto;
      hoja.dispatchEvent(new Event('input'));
      toast(`Se trajeron ${fmtNumero(r.palabras)} palabras de ${r.de}. Revise y guarde.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      boton.disabled = false;
      boton.textContent = decia;
    }
  });
}

/**
 * Debajo del formulario, quiénes estuvieron en la reunión que se enlazó.
 *
 * Se pinta apenas se elige la actividad, ANTES de guardar: enlazar la reunión
 * equivocada es fácil —dos ensayos de la misma semana— y verlo después de
 * guardar no sirve de nada.
 */
function ponerPanelDeAsistencia(row) {
  if (!MOD['asistencias']) return;
  const form = document.getElementById('recForm');
  if (!form) return;

  const zona = document.createElement('div');
  content().appendChild(zona);

  const cual = () => ({
    actividad: (form.querySelector('[name="asistencia_id"]') || {}).value || '',
    cuerpo: (form.querySelector('[name="cuerpo_id"]') || {}).value || '',
  });

  let ultimo = '';
  const pintar = async () => {
    const { actividad, cuerpo } = cual();
    const clave = `${actividad}|${cuerpo}`;
    if (clave === ultimo) return;
    ultimo = clave;

    if (!actividad || !cuerpo) { zona.innerHTML = ''; return; }
    zona.innerHTML = '<div class="card" style="margin-top:18px"><div class="card-body">Buscando la lista…</div></div>';

    let d;
    try {
      d = await api('GET', `/asistencias/${actividad}/por-cuerpo?cuerpo_id=${encodeURIComponent(cuerpo)}`);
    } catch (e) {
      zona.innerHTML = `<div class="card" style="margin-top:18px"><div class="card-body">
        <span class="mut">No se pudo mirar esa asistencia: ${esc(e.message)}</span></div></div>`;
      return;
    }

    const grupo = (titulo, gente, clase, conMotivo) => `
      <div class="asis-grupo">
        <b class="asis-tit ${clase}">${titulo} · ${fmtNumero(gente.length)}</b>
        ${gente.length ? `<ul class="mini-list">${gente.map((p) => `
          <li><span>${esc(p.nombre)}</span>${conMotivo && p.motivo
            ? `<span class="mut">${esc(p.motivo)}${p.detalle ? `: ${esc(p.detalle)}` : ''}</span>` : ''}</li>`).join('')}
        </ul>` : '<div class="mut" style="padding:8px 2px">Ninguno.</div>'}
      </div>`;

    zona.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🖐️ La lista de esa reunión</b>
          <span class="spacer"></span>
          <a class="btn secondary sm" href="#/asistencia?actividad=${esc(d.actividad.id)}">Ver la actividad</a>
        </div>
        <div class="card-body">
          <p style="margin:0 0 14px;color:var(--muted);font-size:13.5px">
            ${esc(d.actividad.tipo || 'Actividad')} del ${esc(fechaCorta(d.actividad.fecha))}${d.actividad.lugar ? ` · ${esc(d.actividad.lugar)}` : ''}.
            ${d.actividad.cuantos_cuerpos > 1
              ? `Convocó a ${fmtNumero(d.actividad.cuantos_cuerpos)} cuerpos; acá salen solo los de <b>${esc(d.cuerpo.nombre)}</b>.`
              : ''}
          </p>
          ${!d.convocado ? `<div class="resultado warn" style="margin-bottom:14px">
            <b>${esc(d.cuerpo.nombre)} no estaba convocado a esa actividad.</b>
            Revise si es la reunión que corresponde.</div>` : ''}
          ${d.sin_marcar ? `<div class="empty-state" style="padding:22px">
              De esa actividad todavía no se pasó lista para este cuerpo.
            </div>` : `<div class="asis-tres">
              ${grupo('Asistieron', d.presentes, 'asis-fue')}
              ${grupo('Se justificaron', d.justificados, 'asis-excusa', true)}
              ${grupo('No asistieron', d.ausentes, 'asis-falto')}
            </div>`}
        </div>
      </div>`;
  };

  pintar();
  // El selector de la actividad puede ser un buscador, así que se escucha todo
  // el formulario en vez de un solo control.
  form.addEventListener('change', pintar);
  form.addEventListener('input', pintar);
}

async function renderActasCuerpo(cuerpoId, caja) {
  if (!MOD['actas_reuniones']) return;
  const actas = await api('GET', `/actas_reuniones?f_cuerpo_id=${cuerpoId}&sort=fecha&dir=desc&limit=30`)
    .catch(() => null);
  if (!actas) return;

  caja.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>📝 Actas de reuniones</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(actas.total)} acta(s)</span>
        <span class="spacer"></span>
        ${MOD['actas_reuniones'].perms.create
          ? `<a class="btn sm" href="#/m/actas_reuniones/new?cuerpo_id=${cuerpoId}">➕ Nueva acta</a>`
          : ''}
      </div>
      ${actas.rows.length ? `<ul class="mini-list">
        ${actas.rows.map((a) => `
          <li data-ir="#/m/actas_reuniones/edit/${a.id}">
            <span><b>Acta ${esc(a.numero_acta)}</b>
              <span class="mut">${esc(fechaCorta(a.fecha))}${a.presidida_por ? ` · ${esc(a.presidida_por)}` : ''}</span></span>
            <span class="mut">
              ${a.documento ? '📎 ' : ''}<span class="badge ${a.estado === 'Firmada' ? 'green' : a.estado === 'Aprobada' ? 'blue' : ''}">${esc(a.estado || 'Borrador')}</span>
            </span>
          </li>`).join('')}
      </ul>` : `<div class="empty-state" style="padding:26px">
          Todavía no hay actas de este cuerpo.<br>
          <span class="mut">Se pueden adjuntar como documento o escribir acá mismo.</span>
        </div>`}
    </div>`;
}

/**
 * Quiénes tienen puesto un perfil de permisos, al pie de su ficha.
 *
 * Desde acá se le pone a varios de una vez y se le saca a quien corresponda,
 * que es como se trabaja de verdad: se arma el perfil una vez y después se
 * reparte. Como el perfil queda enlazado, lo que se cambie arriba les cambia
 * a todos los que aparecen en esta lista.
 */
async function renderUsuariosDelPerfil(perfilId, contenedor) {
  const d = await api('GET', `/perfiles_permisos/${perfilId}/usuarios`).catch(() => null);
  if (!d) return;
  const puedeAsignar = MOD['usuarios'] && MOD['usuarios'].perms.edit;

  contenedor.innerHTML = `
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>👤 Quiénes tienen este perfil</b>
        <span style="color:var(--muted);font-size:13px">${fmtNumero(d.usuarios.length)} usuario(s)</span>
      </div>
      ${d.usuarios.length ? `<ul class="mini-list">
        ${d.usuarios.map((u) => `
          <li>
            <span><b>${esc(u.nombre)}</b>
              <span class="mut">${esc(rutFormatear(u.rut))}${u.iglesia ? ` · ${esc(iglesiaDeTrabajo(u.iglesia))}` : ''}</span>
              ${u.activo ? '' : '<span class="badge">Inactivo</span>'}</span>
            <span class="mut">
              <a class="btn secondary sm" href="#/m/usuarios/edit/${u.id}">✏️ Su ficha</a>
              ${puedeAsignar ? `<button class="btn secondary sm quitar-perfil" data-usuario="${u.id}">Quitárselo</button>` : ''}
            </span>
          </li>`).join('')}
      </ul>` : `<div class="empty-state" style="padding:24px">
          Todavía no se le puso a nadie.<br>
          <span class="mut">Elíjalos abajo, o póngaselo desde la ficha de cada usuario.</span>
        </div>`}

      ${puedeAsignar && d.disponibles.length ? `
        <div class="toolbar" style="border-top:1px solid var(--border)">
          <b style="font-size:13.5px">Ponérselo a más usuarios</b>
          <span class="spacer"></span>
          <button class="btn sm" id="perfAsignar" disabled>➕ Ponérselo a los marcados</button>
        </div>
        <ul class="pasar-lista perfil-elegir">
          ${d.disponibles.map((u) => `
            <li>
              <label>
                <input type="checkbox" value="${u.id}" />
                <span><b>${esc(u.nombre)}</b> <span class="mut">${esc(rutFormatear(u.rut))} · ${esc(u.rol)}</span></span>
              </label>
            </li>`).join('')}
        </ul>` : ''}
    </div>`;

  const recargar = () => renderUsuariosDelPerfil(perfilId, contenedor);

  contenedor.querySelectorAll('.quitar-perfil').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('DELETE', `/perfiles_permisos/${perfilId}/usuarios/${b.dataset.usuario}`);
        toast('Perfil quitado');
        recargar();
      } catch (e) { toast(e.message, true); }
    }));

  const boton = contenedor.querySelector('#perfAsignar');
  if (!boton) return;
  const casillas = [...contenedor.querySelectorAll('.perfil-elegir input[type=checkbox]')];
  const revisar = () => { boton.disabled = !casillas.some((c) => c.checked); };
  casillas.forEach((c) => c.addEventListener('change', revisar));
  boton.addEventListener('click', async () => {
    const elegidos = casillas.filter((c) => c.checked).map((c) => Number(c.value));
    try {
      const r = await api('POST', `/perfiles_permisos/${perfilId}/usuarios`, { usuarios: elegidos });
      toast(`Perfil puesto a ${fmtNumero(r.puestos)} usuario(s)`);
      recargar();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- el ayudante y la falta de señal ---------------- */
/**
 * Deja al ayudante instalado desde que se abre el sistema.
 *
 * Antes se registraba solo al activar los avisos, dentro de ese botón. Tenía
 * sentido cuando lo único que hacía era recibirlos, pero ahora también es lo
 * que permite que la aplicación abra sin señal, y eso lo necesita todo el
 * mundo —no solo quien quiso avisos—. Sin esto, a la mayoría le seguiría
 * saliendo la pantalla de error del navegador.
 *
 * Si falla, no se dice nada: es una mejora, no un requisito. El sistema
 * funciona igual sin ayudante, solo que necesitando señal.
 */
function dejarElAyudanteInstalado() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/avisos-sw.js', { scope: '/' }).catch((e) => {
      console.warn('No se pudo dejar instalado el ayudante:', e.message);
    });
  });
}

/**
 * La cinta de «sin conexión».
 *
 * Cuando no hay señal el sistema abre igual, pero no puede traer ni guardar
 * datos. Sin decirlo, la persona ve listas vacías y errores sueltos y cree que
 * el sistema se echó a perder. Con la cinta sabe qué pasa y que lo que ve
 * puede no estar al día.
 */
function avisarCuandoNoHaySenal() {
  const pintar = () => {
    const hay = navigator.onLine;
    let cinta = document.getElementById('sinSenal');
    if (hay) {
      if (cinta) cinta.remove();
      return;
    }
    if (cinta) return;
    cinta = document.createElement('div');
    cinta.id = 'sinSenal';
    cinta.className = 'sin-senal';
    cinta.setAttribute('role', 'status');
    cinta.innerHTML =
      '📡 <b>Sin conexión.</b> Puede mirar lo que ya está abierto, pero no se ' +
      'traen ni se guardan datos hasta que vuelva la señal.';
    document.body.prepend(cinta);
  };
  window.addEventListener('online', pintar);
  window.addEventListener('offline', pintar);
  pintar();
}

/* ---------------- inicio ---------------- */
dejarElAyudanteInstalado();
avisarCuandoNoHaySenal();
vigilarQueLosCamposTenganNombre();
boot();
