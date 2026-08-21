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

const $app = document.getElementById('app');

/* Identidad institucional (logo y nombre de la iglesia) */
const IGLESIA = {
  nombre: 'Iglesia Pentecostal Triunfante',
  lema: '«La Nueva Jerusalén»',
  logo: '/img/logo.png',
};

/* ---------------- utilidades ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(n) {
  if (n == null || n === '') return '';
  return '$ ' + Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(s) {
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

/* ---------------- API ---------------- */
async function api(method, path, body, isForm) {
  const opts = { method, headers: {} };
  if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const res = await fetch('/api' + path, opts);
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
    throw new Error(data.error || 'Error del servidor');
  }
  return data;
}
/**
 * Ruta de la que salen las opciones de un campo de referencia. Normalmente es
 * la lista completa del módulo referenciado, salvo que el campo declare su
 * propia ruta (`optionsRoute`) para acotar la lista.
 */
function rutaOpciones(f, valores) {
  const ruta = f.optionsRoute || f.ref || 'miembros';
  if (!ruta.includes('{')) return ruta;
  // Una ruta puede depender de otro campo del formulario, como los cargos de
  // una directiva, que salen de los integrantes del cuerpo elegido:
  //   '/directivas/integrantes?cuerpo_id={cuerpo_id}'
  return ruta.replace(/\{(\w+)\}/g, (_, campo) => {
    const v = valores && valores[campo] != null ? valores[campo] : '';
    return encodeURIComponent(String(v));
  });
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
    if (valores[el.name] === undefined || el.value) valores[el.name] = el.value;
  });
  return valores;
}
async function getOptions(clave, force) {
  if (!force && optionsCache[clave]) return optionsCache[clave];
  const ruta = clave.startsWith('/') ? clave : `/${clave}/options`;
  const rows = await api('GET', ruta);
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
async function boot() {
  if (!TOKEN) return renderLogin();
  try {
    const meta = await api('GET', '/meta');
    MODULES = meta.modules;
    MOD = {};
    MODULES.forEach((m) => (MOD[m.name] = m));
    USER = meta.user;
    PERMISOS_CATALOGO = meta.permisosCatalogo || null;
    ROLES = meta.roles || [];
    if (meta.ajustes) AJUSTES = { ...AJUSTES, ...meta.ajustes };
    renderShell();
    route();
  } catch (e) {
    if (e && e.cambiarPassword) return; // ya se está mostrando esa pantalla
    renderLogin();
  }
}
function logout() {
  TOKEN = null;
  USER = null;
  localStorage.removeItem('token');
  location.hash = '';
  renderLogin();
}
window.addEventListener('hashchange', () => {
  if (TOKEN && USER) route();
});

function route() {
  const [ruta, consulta] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = ruta.split('/').filter(Boolean);
  // Valores para precargar un formulario nuevo: #/m/modulo/new?campo=valor
  const precarga = {};
  if (consulta) new URLSearchParams(consulta).forEach((v, k) => (precarga[k] = v));
  document.querySelectorAll('.side-link').forEach((el) => el.classList.remove('active'));
  const sb = document.querySelector('.sidebar');
  if (sb) sb.classList.remove('open');
  const bd = document.getElementById('backdrop');
  if (bd) bd.classList.remove('show');

  if (parts[0] === 'm' && MOD[parts[1]]) {
    const name = parts[1];
    const link = document.querySelector(`.side-link[data-mod="${name}"]`);
    if (link) link.classList.add('active');
    if (parts[2] === 'new') return viewForm(name, null, precarga);
    if (parts[2] === 'ficha' && parts[3]) return viewFicha(name, parts[3]);
    if (parts[2] === 'edit' && parts[3]) return viewForm(name, parts[3]);
    return viewList(name, precarga);
  }
  if (parts[0] === 'asistencia' && MOD['asistencias']) {
    const al = document.querySelector('.side-link[data-mod="_asistencia"]');
    if (al) al.classList.add('active');
    return viewAsistencia({ ...precarga, tab: parts[1] === 'informes' ? 'informes' : precarga.tab });
  }
  // Direcciones antiguas: llevan a la misma pantalla, que ahora reúne todo
  if (parts[0] === 'pasar-lista' && MOD['asistencias']) {
    return (location.hash = parts[1] ? `#/asistencia?actividad=${parts[1]}` : '#/asistencia');
  }
  if (parts[0] === 'informes' && parts[1] === 'asistencia' && MOD['asistencias']) {
    return (location.hash = '#/asistencia/informes');
  }
  if (parts[0] === 'cuenta' || parts[0] === 'perfil') {
    const cl = document.querySelector('.side-link[data-mod="_cuenta"]');
    if (cl) cl.classList.add('active');
    return viewMiPerfil(precarga);
  }
  if (parts[0] === 'config' && USER.rol === 'admin') {
    const cl = document.querySelector('.side-link[data-mod="_config"]');
    if (cl) cl.classList.add('active');
    return viewConfiguracion();
  }
  if (parts[0] === 'print' && MOD[parts[1]] && parts[2]) return viewPrint(parts[1], parts[2]);
  const dl = document.querySelector('.side-link[data-mod="_dash"]');
  if (dl) dl.classList.add('active');
  return viewDashboard();
}

/* ---------------- login ---------------- */
function renderLogin() {
  $app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <img class="logo" src="${IGLESIA.logo}" alt="${esc(IGLESIA.nombre)}" />
        <h1>${esc(IGLESIA.nombre)}</h1>
        <p class="lema">${esc(IGLESIA.lema)}</p>
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
      if (String(c.mantenimiento_activo) === '1') {
        const errEl = document.getElementById('loginError');
        if (errEl) {
          errEl.innerHTML = `<div class="aviso-mantenimiento">🛠️ ${esc(c.mantenimiento_mensaje || 'Sistema en mantenimiento.')}
            <span>Solo los administradores pueden ingresar.</span></div>`;
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
      await api('POST', '/auth/cambiar-password', { nueva });
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
        <div class="modal-head"><h3>🔑 Para no quedarse afuera</h3><button class="cerrar">&times;</button></div>
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
      <div class="modal-head"><h3>🔑 Recuperar la contraseña</h3><button class="cerrar">&times;</button></div>
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
  const pestana = (precarga && precarga.tab) === 'seguridad' ? 'seguridad' : 'datos';
  content().innerHTML = `
    <div class="page-head">
      <div>
        <h2>🙋 Mi perfil</h2>
        <p class="sub-iglesia">${esc(USER.nombre)} · ${esc(rutFormatear(USER.rut || ''))}</p>
      </div>
    </div>
    <div class="tabs" id="perfilTabs">
      <button data-tab="datos" class="${pestana === 'datos' ? 'on' : ''}">📝 Mis datos</button>
      <button data-tab="seguridad" class="${pestana === 'seguridad' ? 'on' : ''}">🔐 Seguridad</button>
    </div>
    <div id="tabDatos" ${pestana === 'datos' ? '' : 'hidden'}></div>
    <div id="tabSeguridad" ${pestana === 'seguridad' ? '' : 'hidden'}></div>`;

  content().querySelectorAll('#perfilTabs button').forEach((b) => {
    b.addEventListener('click', () => {
      content().querySelectorAll('#perfilTabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.getElementById('tabDatos').hidden = b.dataset.tab !== 'datos';
      document.getElementById('tabSeguridad').hidden = b.dataset.tab !== 'seguridad';
    });
  });

  renderSeguridad(document.getElementById('tabSeguridad'));
  renderMisDatos(document.getElementById('tabDatos'));
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
        ${f.fecha_bautismo ? `<div><span class="mut">Bautismo</span><b>${esc(fmtDate(f.fecha_bautismo))}</b></div>` : ''}
        <div><span class="mut">Rol en el sistema</span><b>${esc(f.rol || '')}</b></div>
      </div>
    </div>

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
      // El nombre puede haber cambiado: la barra superior tiene que reflejarlo
      const me = await api('GET', '/auth/me');
      USER = { ...USER, ...me.user };
      const quien = document.querySelector('.who b');
      if (quien) quien.textContent = USER.nombre;
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
      await api('POST', '/auth/cambiar-password', { actual: document.getElementById('mcActual').value, nueva });
      toast('Contraseña cambiada');
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

function renderShell() {
  const groups = {};
  // Los módulos que se manejan dentro de la ficha de otro (los documentos y
  // el historial de cada iglesia o pastor) no ocupan lugar en el menú.
  for (const m of MODULES.filter((x) => x.menu !== false)) {
    (groups[m.group] = groups[m.group] || []).push(m);
  }
  const groupsHtml = Object.entries(groups)
    .map(
      ([g, mods]) => `
      <div class="side-group">
        <div class="group-title">${esc(g)}</div>
        ${mods.map((m) => `<a class="side-link" data-mod="${m.name}" href="#/m/${m.name}"><span class="ic">${m.icon}</span> ${esc(m.label)}</a>`).join('')}
      </div>`
    )
    .join('');

  const initials = (USER.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  $app.innerHTML = `
    <div class="layout">
      <nav class="sidebar" id="sidebar">
        <div class="brand">
          <img class="logo" src="${IGLESIA.logo}" alt="" />
          <span class="txt"><b>${esc(IGLESIA.nombre)}</b><i>${esc(IGLESIA.lema)}</i></span>
        </div>
        <div class="side-group">
          <a class="side-link" data-mod="_dash" href="#/"><span class="ic">📊</span> Panel de control</a>
        </div>
        ${groupsHtml}
        ${MOD['asistencias'] ? `
        <div class="side-group">
          <div class="group-title">Asistencia</div>
          <a class="side-link" data-mod="_asistencia" href="#/asistencia"><span class="ic">📋</span> Asistencia</a>
        </div>` : ''}
        <div class="side-group">
          <div class="group-title">Sistema</div>
          <a class="side-link" data-mod="_cuenta" href="#/perfil"><span class="ic">🙋</span> Mi perfil</a>
          ${USER.rol === 'admin'
            ? '<a class="side-link" data-mod="_config" href="#/config"><span class="ic">⚙️</span> Configuración</a>'
            : ''}
        </div>
        <div class="side-footer">Conectado como <b>${esc(USER.nombre)}</b><br>Rol: ${esc(USER.rol)}</div>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle">☰</button>
          <div class="iglesia-local" title="Lo que tiene asignado para ver y administrar">
            <span class="ic">⛪</span>
            <span class="nm">${esc(USER.iglesia_nombre || 'Todas las iglesias')}</span>
            ${(USER.cuerpos_asignados || []).length
              ? `<span class="cuerpos-chip" title="Solo ve lo de estos cuerpos">👥 ${esc(USER.cuerpos_asignados.join(' · '))}</span>`
              : ''}
          </div>
          <a class="who" href="#/perfil" title="Mi perfil"><span class="avatar">${esc(initials)}</span> <span><b>${esc(USER.nombre)}</b><br>${esc(USER.rut ? rutFormatear(USER.rut) : USER.email || '')}</span></a>
          <button class="btn secondary sm" id="logoutBtn">Cerrar sesión</button>
        </header>
        <div class="content" id="content"></div>
      </div>
      <div class="backdrop" id="backdrop"></div>
    </div>`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('backdrop');
  document.getElementById('menuToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show', sidebar.classList.contains('open'));
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });
}
function content() {
  return document.getElementById('content');
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
    ['solicitudes', '📨', 'Solicitudes pendientes', d.counts.solicitudes_pendientes],
    ['certificados', '📜', 'Certificados', d.counts.certificados],
  ].filter(([name]) => MOD[name]);

  let finHtml = '';
  if (d.finanzas) {
    finHtml = `
      <div class="fin-cards">
        <div class="fin green"><div class="lbl">Ingresos del mes (${esc(d.finanzas.mes)})</div><div class="num">${fmtMoney(d.finanzas.ingresos_mes)}</div></div>
        <div class="fin red"><div class="lbl">Egresos del mes</div><div class="num">${fmtMoney(d.finanzas.egresos_mes)}</div></div>
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
            <li class="${c.dias === 0 ? 'hoy' : ''}" onclick="location.hash='#/m/miembros/ficha/${c.id}'">
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

  content().innerHTML = `
    <div class="page-head">
      <div>
        <h2>📊 Panel de control</h2>
        <p class="sub-iglesia">${esc(USER.iglesia_nombre || 'Todas las iglesias')}</p>
      </div>
    </div>
    <div class="stats">
      ${statDefs.map(([name, ic, lbl, num]) => `
        <div class="stat" onclick="location.hash='#/m/${name}'">
          <div class="ic">${ic}</div><div class="num">${num}</div><div class="lbl">${lbl}</div>
        </div>`).join('')}
    </div>
    ${finHtml}
    ${MOD['miembros'] ? cumpleHtml : ''}
    <div class="dash-cols">
      <div class="card">
        <h3>📋 Últimas asistencias</h3>
        <ul class="mini-list">
          ${d.ultimasAsistencias.length ? d.ultimasAsistencias.map((a) => `
            <li onclick="location.hash='#/asistencia?actividad=${a.id}'">
              <span>${esc(a.tipo_reunion)}${a.cuerpo ? ` <span class="mut">— ${esc(a.cuerpo)}</span>` : ''}</span>
              <span class="mut">${fmtDate(a.fecha)} · ${a.marcados ? `${a.presentes} de ${a.marcados}` : 'sin lista'}</span>
            </li>`).join('') : '<li class="mut">Sin registros aún</li>'}
        </ul>
      </div>
      <div class="card">
        <h3>📨 Solicitudes recientes</h3>
        <ul class="mini-list">
          ${d.solicitudesRecientes.length ? d.solicitudesRecientes.map((s) => `
            <li onclick="location.hash='#/m/solicitudes/edit/${s.id}'">
              <span>${esc(s.asunto)} <span class="mut">— ${esc(s.solicitante)}</span></span>
              <span class="badge ${badgeClass(s.estado)}">${esc(s.estado)}</span>
            </li>`).join('') : '<li class="mut">Sin registros aún</li>'}
        </ul>
      </div>
    </div>`;
}

/* ---------------- listado genérico ---------------- */
function stateOf(name) {
  if (!listState[name]) {
    const m = MOD[name];
    listState[name] = { q: '', page: 1, sort: m.defaultSort.field, dir: m.defaultSort.dir, filters: {}, desde: '', hasta: '' };
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

  content().innerHTML = `
    <div class="page-head">
      <h2>${m.icon} ${esc(m.label)}</h2>
      <div class="actions">
        ${m.perms.create ? `<button class="btn secondary" id="btnImportar">⬆️ Importar</button>` : ''}
        ${m.perms.create ? `<button class="btn" id="btnNew">➕ Nuevo ${esc(m.labelSingular.toLowerCase())}</button>` : ''}
      </div>
    </div>
    ${name === 'tesoreria' ? '<div class="treasury-summary" id="treasurySummary"></div>' : ''}
    <div class="card">
      <div class="toolbar" id="toolbar"></div>
      <div class="table-scroll"><div id="tableWrap"><p style="padding:20px">Cargando…</p></div></div>
      <div class="pager" id="pager"></div>
    </div>`;

  if (m.perms.create) {
    document.getElementById('btnNew').addEventListener('click', () => (location.hash = `#/m/${name}/new`));
    document.getElementById('btnImportar').addEventListener('click', () => abrirImportador(m, () => load()));
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

  tb.innerHTML = `
    <input type="search" id="q" placeholder="Buscar…" value="${esc(st.q)}" />
    ${iglesiaField ? `<select id="f_iglesia_id"><option value="">— Todas las iglesias —</option></select>` : ''}
    ${filterFields.map((f) => `
      <select id="f_${f.name}">
        <option value="">— ${esc(f.label)} —</option>
        ${(f.options || []).map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}" ${st.filters[f.name] === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
        }).join('')}
      </select>`).join('')}
    ${m.dateField ? `
      <label class="range">Desde <input type="date" id="fDesde" value="${esc(st.desde)}" /></label>
      <label class="range">Hasta <input type="date" id="fHasta" value="${esc(st.hasta)}" /></label>` : ''}
    <span class="spacer"></span>
    <button class="btn secondary sm" id="btnReload">⟳ Actualizar</button>`;

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
      load();
    });
  };
  // Los filtros que apuntan a otro módulo se llenan con sus registros
  filterFields.filter((f) => f.type === 'ref').forEach((f) => {
    getOptions(rutaOpciones(f)).then((opts) => {
      const sel = document.getElementById('f_' + f.name);
      if (!sel) return;
      sel.innerHTML = `<option value="">— ${esc(f.label)} —</option>` +
        opts.map((o) => `<option value="${o.id}" ${st.filters[f.name] === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    });
  });

  if (iglesiaField) bindFilter('f_iglesia_id', 'iglesia_id');
  filterFields.forEach((f) => bindFilter('f_' + f.name, f.name));
  if (m.dateField) {
    document.getElementById('fDesde').addEventListener('change', (e) => { st.desde = e.target.value; st.page = 1; load(); });
    document.getElementById('fHasta').addEventListener('change', (e) => { st.hasta = e.target.value; st.page = 1; load(); });
  }
  document.getElementById('btnReload').addEventListener('click', load);

  // ------- carga y render de la tabla -------
  async function load() {
    const params = new URLSearchParams({ page: st.page, sort: st.sort, dir: st.dir });
    if (st.q) params.set('q', st.q);
    for (const [k, v] of Object.entries(st.filters)) if (v) params.set('f_' + k, v);
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);

    let data;
    try {
      data = await api('GET', `/${name}?` + params.toString());
    } catch (e) {
      document.getElementById('tableWrap').innerHTML = `<p style="padding:20px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }

    if (name === 'tesoreria') loadTreasurySummary(params);

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
      .filter((c) => c !== 'iglesia_id' || variasIglesias);
    const wrap = document.getElementById('tableWrap');
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">${m.icon}</div>No hay registros${st.q || Object.values(st.filters).some(Boolean) ? ' con los filtros aplicados' : ''}.</div>`;
    } else {
      // En el teléfono esta tabla se dibuja como tarjetas (ver styles.css):
      // cada fila con sus datos uno bajo otro, sin desplazarse de lado.
      const etiquetaCol = (c) => (c === 'id' ? 'ID' : (fieldsBy[c] || {}).label || c);
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
              if (f && f.computed) return `<th class="no-sort" style="cursor:default">${esc(lbl)}</th>`;
              const arrow = st.sort === c ? `<span class="arrow">${st.dir === 'asc' ? '▲' : '▼'}</span>` : '';
              return `<th data-col="${c}">${esc(lbl)} ${arrow}</th>`;
            }).join('')}
            <th class="no-sort"></th>
          </tr></thead>
          <tbody>
            ${data.rows.map((r) => `
              <tr data-id="${r.id}">
                ${cols.map((c) => {
                  const f = fieldsBy[c];
                  return `<td data-col="${esc(c)}" data-label="${esc(etiquetaCol(c))}"${
                    f && f.type === 'file' ? ' class="col-mini"' : ''}>${cellValue(f, r, c)}</td>`;
                }).join('')}
                <td class="acciones" style="white-space:nowrap;text-align:right">
                  ${m.printable ? `<button class="btn secondary sm act-print" data-id="${r.id}" title="Imprimir">🖨️</button>` : ''}
                  ${m.perms.delete && !generadoPorOtroModulo(r)
                    ? `<button class="btn danger sm act-del" data-id="${r.id}" title="Eliminar">🗑️</button>`
                    : ''}
                </td>
              </tr>`).join('')}
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
            await api('DELETE', `/${name}/${b.dataset.id}`);
            toast('Registro eliminado');
            invalidarOpciones(name);
            load();
          } catch (err) {
            toast(err.message, true);
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
      btns.push(`<button class="${p === data.page ? 'cur' : ''}" data-p="${p}">${p}</button>`);
    }
    pager.innerHTML = `
      <span>${data.total} registro${data.total === 1 ? '' : 's'}</span>
      <span class="pages">
        <button data-p="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>‹</button>
        ${btns.join('')}
        <button data-p="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>›</button>
      </span>`;
    pager.querySelectorAll('button[data-p]').forEach((b) => {
      b.addEventListener('click', () => {
        st.page = Number(b.dataset.p);
        load();
      });
    });
  }

  async function loadTreasurySummary(params) {
    const el = document.getElementById('treasurySummary');
    if (!el) return;
    try {
      const r = await api('GET', '/tesoreria/resumen?' + params.toString());
      const cuentas = (r.porCuenta || []);
      el.innerHTML = `
        <div class="fin green"><div class="lbl">Ingresos (período filtrado)</div><div class="num">${fmtMoney(r.ingresos)}</div></div>
        <div class="fin red"><div class="lbl">Egresos</div><div class="num">${fmtMoney(r.egresos)}</div></div>
        <div class="fin blue"><div class="lbl">Balance</div><div class="num">${fmtMoney(r.balance)}</div></div>
        <div class="fin slate"><div class="lbl">Movimientos</div><div class="num">${r.movimientos}</div></div>
        ${cuentas.length ? `
          <div class="saldos-cuentas">
            <div class="sc-tit">Saldo de cada cuenta <span class="mut">(no depende del período filtrado)</span></div>
            <ul>
              ${cuentas.map((c) => `
                <li onclick="location.hash='#/m/cuentas_tesoreria/edit/${c.id}'">
                  <span class="sc-n">${esc(c.nombre)}
                    <span class="badge ${c.tipo === 'General' ? 'blue' : ''}">${esc(c.ambito)}</span>
                  </span>
                  <b class="${Number(c.saldo) < 0 ? 'saldo-negativo' : ''}">${fmtMoney(c.saldo)}</b>
                </li>`).join('')}
            </ul>
          </div>` : ''}`;
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

function cellValue(f, row, col) {
  if (col === 'id') return row.id;
  const v = row[f.name];
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
      return esc(row[f.name + '_label'] || '');
    case 'multiref':
      return esc((row[f.name + '_labels'] || []).slice(0, 3).join(', ')) + ((row[f.name + '_labels'] || []).length > 3 ? '…' : '');
    case 'money':
      return fmtMoney(v);
    case 'boolean':
      return v ? '<span class="badge green">Sí</span>' : '<span class="badge red">No</span>';
    case 'date':
      return fmtDate(v);
    case 'rut':
      return esc(rutFormatear(v));
    case 'persona':
      return row[f.name + '_id']
        ? `<span class="persona-chip">${esc(v || '')}</span>`
        : esc(v || '');
    case 'file':
      if (!v) return '';
      if (/\.(jpe?g|png|gif|webp)$/i.test(v)) return `<img class="thumb" src="/uploads/${esc(v)}" alt="" />`;
      return `<a href="/uploads/${esc(v)}" target="_blank" onclick="event.stopPropagation()">📎 archivo</a>`;
    case 'select':
      return v == null || v === '' ? '' : `<span class="badge ${badgeClass(v)}">${esc(selectLabel(f, v))}</span>`;
    default:
      return esc(v);
  }
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
const CON_FICHA = ['miembros', 'pastores', 'cuerpos', 'iglesias'];

/** "07-11-1973": la fecha como se lee y se dice acá. */
function fechaCorta(iso) {
  const s = String(iso || '').slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}-${m}-${y}` : s;
}

/** El teléfono en formato internacional, para llamar o escribir por WhatsApp. */
function telefonoInternacional(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('56') ? d : '56' + d;
}

/** El nombre con el que se presenta un registro, según la plantilla del módulo. */
function nombreDelRegistro(m, row) {
  const texto = String(m.display || '')
    .replace(/\{(\w+)\}/g, (_, campo) => (row[campo] == null ? '' : row[campo]))
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
      return v ? esc(row[f.name + '_label'] || `#${v}`) : '';
    case 'multiref': {
      const nombres = row[f.name + '_labels'] || [];
      return nombres.length ? nombres.map((n) => `<span class="chip">${esc(n)}</span>`).join(' ') : '';
    }
    case 'boolean':
      return v ? '<span class="badge green">Sí</span>' : '<span class="badge">No</span>';
    case 'money':
      return vacio ? '' : fmtMoney(v);
    case 'date': {
      if (vacio) return '';
      const edad = f.mostrarEdad ? edadDeFecha(v) : '';
      return `${esc(fechaCorta(v))}${edad ? ` <span class="dato-nota">${esc(edad)}</span>` : ''}`;
    }
    case 'time':
      return vacio ? '' : esc(String(v).slice(0, 5));
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

async function viewFicha(name, id) {
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
    else if (f.type === 'ref') subtitulo.push(row[f.name + '_label'] || '');
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
        ${m.printable ? `<button class="btn secondary" id="btnPrint">🖨️ Imprimir</button>` : ''}
        ${m.perms.edit ? `<button class="btn" id="btnEdit">✏️ Editar</button>` : ''}
      </div>
    </div>

    <div class="card ficha-cabecera">
      ${foto}
      <div class="fc-datos">
        <h3>${esc(conTrato)}</h3>
        ${subtitulo.filter(Boolean).length ? `<div class="fc-sub">${esc(subtitulo.filter(Boolean).join(' · '))}</div>` : ''}
        ${insignias.length ? `<div class="fc-badges">${insignias.join('')}</div>` : ''}
        ${acciones ? `<div class="fc-acciones">${acciones}</div>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="toolbar">
        <b style="font-size:14px">Datos registrados</b>
        <label class="ver-blancos"${enBlanco ? '' : ' hidden'}>
          <input type="checkbox" id="verBlancos" /> Ver los ${enBlanco} campo${enBlanco === 1 ? '' : 's'} en blanco
        </label>
      </div>
      <div class="ficha-datos" id="fichaDatos">${cuerpo}</div>
    </div>`;

  document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const be = document.getElementById('btnEdit');
  if (be) be.addEventListener('click', () => (location.hash = `#/m/${name}/edit/${id}`));
  const bp = document.getElementById('btnPrint');
  if (bp) bp.addEventListener('click', () => (location.hash = `#/print/${name}/${id}`));
  const vb = document.getElementById('verBlancos');
  if (vb) {
    vb.addEventListener('change', () => {
      document.getElementById('fichaDatos').classList.toggle('con-vacios', vb.checked);
    });
  }

  // Lo que no se puede pasar por alto de esta persona, antes de sus datos
  if (name === 'miembros') avisosDelMiembro(row);

  // Y todo lo que cuelga de la ficha: sus grupos, sus documentos, su historial
  const zona = (fn, ...args) => {
    const caja = document.createElement('div');
    content().appendChild(caja);
    fn(...args, caja);
  };
  if (name === 'miembros') zona(renderCuerposDelMiembro, Number(id));
  if (name === 'cuerpos') zona(renderPanelesCuerpo, Number(id));
  if (name === 'pastores') zona(renderFichaMiembroPastor, Number(id), row);
  if (PANEL_DOCUMENTOS[name]) zona(renderDocumentos, PANEL_DOCUMENTOS[name], Number(id));
  if (PANEL_HISTORIAL[name]) zona(renderHistorial, PANEL_HISTORIAL[name], Number(id));
  if (name === 'miembros') zona(renderAccesoMiembro, Number(id));
}

/** Los cuerpos y grupos en los que participa un miembro, bajo su ficha. */
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
            <li data-id="${c.id}">
              <span>${esc(c.nombre)}${c.lidera ? ' <span class="badge blue">Lidera</span>' : ''}</span>
              <span class="mut">${esc(c.tipo || '')}</span>
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
      <h2>${m.icon} ${isNew ? 'Nuevo' : canEdit ? 'Editar' : 'Ver'} ${esc(m.labelSingular.toLowerCase())}</h2>
      <div class="actions">
        ${!isNew && CON_FICHA.includes(name) ? `<button class="btn secondary" id="btnFicha">👁️ Ver la ficha</button>` : ''}
        <button class="btn secondary" id="btnBack">← Volver</button>
      </div>
    </div>
    <div class="card"><form id="recForm"><div class="form-grid" id="formGrid"><p>Cargando…</p></div>
    <div class="form-error" id="formError"></div>
    <div class="form-foot" id="formFoot"></div></form></div>`;
  document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const bf = document.getElementById('btnFicha');
  if (bf) bf.addEventListener('click', () => (location.hash = `#/m/${name}/ficha/${id}`));

  let row = isNew && precarga ? { ...precarga } : {};
  if (!isNew) {
    try {
      row = await api('GET', `/${name}/${id}`);
    } catch (e) {
      content().querySelector('#formGrid').innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }
  }

  // precargar opciones de todos los ref/multiref del módulo
  const listas = [...new Set(
    m.fields.filter((f) => f.ref || f.type === 'persona').map((f) => rutaOpciones(f, row))
  )];
  await Promise.all(listas.map((r) => getOptions(r).catch(() => [])));

  // Cómo se le trata a esta persona, junto al título de su ficha
  if (!isNew && row.tratamiento) {
    const titulo = content().querySelector('.page-head h2');
    if (titulo) {
      titulo.insertAdjacentHTML(
        'beforeend',
        ` <span class="trato-chip">${esc(row.tratamiento)} ${esc(`${row.nombres || ''} ${row.apellidos || ''}`.trim())}</span>`
      );
    }
  }

  // Lo que no se puede pasar por alto de esta persona, antes de sus datos
  if (!isNew && name === 'miembros') avisosDelMiembro(row);

  const grid = document.getElementById('formGrid');
  grid.innerHTML =
    // El id del registro viaja oculto: hay selectores cuya lista depende de él
    (isNew ? '' : `<input type="hidden" name="id" value="${esc(id)}" />`) +
    m.fields.filter((f) => !f.computed).map((f) => fieldHtml(f, row, isNew)).join('');

  // Comportamientos de widgets
  m.fields.filter((f) => !f.computed).forEach((f) => {
    if (f.type === 'multiref') initMultiref(f, row);
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

  // Al traspasar, se muestra cuánto hay en la cuenta de origen
  if (name === 'traspasos') mostrarSaldoOrigen();

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
  foot.innerHTML = `
    ${!isNew && m.printable ? `<button type="button" class="btn secondary left" id="btnPrint">🖨️ Imprimir</button>` : ''}
    <button type="button" class="btn secondary" id="btnCancel">Cancelar</button>
    ${canEdit ? `<button type="submit" class="btn">💾 Guardar</button>` : ''}`;
  document.getElementById('btnCancel').addEventListener('click', () => (location.hash = `#/m/${name}`));
  const bp = document.getElementById('btnPrint');
  if (bp) bp.addEventListener('click', () => (location.hash = `#/print/${name}/${id}`));

  document.getElementById('recForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const errEl = document.getElementById('formError');
    errEl.textContent = '';
    const data = collectForm(m);
    try {
      if (isNew) await api('POST', `/${name}`, data);
      else await api('PUT', `/${name}/${id}`, data);
      invalidarOpciones(name); // refrescar selectores que referencien este módulo
      toast('Guardado correctamente');
      location.hash = !isNew && CON_FICHA.includes(name) ? `#/m/${name}/ficha/${id}` : `#/m/${name}`;
    } catch (err) {
      errEl.textContent = err.message;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

/**
 * Avisos que encabezan la ficha de un miembro: su nota importante y, si es
 * menor de edad, la falta de su adulto responsable. Van arriba de todo para
 * que se vean sin buscarlos.
 */
function avisosDelMiembro(row) {
  const avisos = [];
  if (row.nota_importante) {
    avisos.push(`<div class="aviso importante"><b>⚠️ Nota importante</b><span>${esc(row.nota_importante)}</span></div>`);
  }
  const anios = aniosDeFecha(row.fecha_nacimiento);
  if (anios != null && anios < 18 && !row.responsable_nombre) {
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
    });
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

function fieldHtml(f, row, isNew) {
  const val = row[f.name] != null ? row[f.name] : isNew && f.default != null ? f.default : '';
  const req = f.required ? '<span class="req">*</span>' : '';
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  const wide = f.type === 'textarea' || f.type === 'multiref' || f.type === 'permisos' ? ' full' : '';
  // Encabezado de sección: el campo que la abre lo declara con `seccion`.
  // Lleva la misma condición que él, para que se oculten juntos.
  const seccion = f.seccion
    ? `<div class="form-seccion full"${condicionAttrs(f)}><span>${esc(f.seccion)}</span></div>`
    : '';
  let input = '';
  switch (f.type) {
    case 'textarea':
      input = `<textarea name="${f.name}">${esc(val)}</textarea>`;
      break;
    case 'select': {
      const valores = (f.options || []).map((o) => String(typeof o === 'object' ? o.value : o));

      // Con muchas opciones —los 66 libros de la Biblia— se ofrece un
      // desplegable con buscador en vez de una lista larguísima.
      if (usaBuscador(f, f.options || [])) {
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

      const opts = (f.options || []).map((o) => {
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
      if (usaBuscador(f, lista)) {
        input = `
          <div class="refbuscar" id="rb_${f.name}" data-ruta="${esc(ruta)}">
            <input type="hidden" name="${f.name}" value="${esc(val)}" />
            <input type="text" class="rb-txt" autocomplete="off" spellcheck="false"
                   value="${esc(etiquetaActual)}"
                   placeholder="Escriba el nombre, el apellido o el RUT…" ${f.required ? 'required' : ''} />
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
      return `${seccion}<div class="fld check${wide}"${condicionAttrs(f)}><input type="checkbox" id="chk_${f.name}" name="${f.name}" ${val ? 'checked' : ''} /><label for="chk_${f.name}">${esc(f.label)}</label>${help}</div>`;
    case 'file':
      input = `
        <div class="filefld" id="ff_${f.name}">
          <input type="hidden" name="${f.name}" value="${esc(val)}" />
          <input type="file" id="file_${f.name}" ${f.accept ? `accept="${esc(f.accept)}"` : ''} />
          <span class="fname" id="fname_${f.name}">${val ? `<a href="/uploads/${esc(val)}" target="_blank">📎 ${esc(nombreArchivo(val))}</a>` : ''}</span>
          ${val && /\.(jpe?g|png|gif|webp)$/i.test(val) ? `<img class="preview" src="/uploads/${esc(val)}" alt="" />` : ''}
        </div>`;
      break;
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
    case 'number':
      input = `<input type="number" step="any" name="${f.name}" value="${esc(val)}" ${f.required ? 'required' : ''} />`;
      break;
    case 'date':
      input = `<input type="date" name="${f.name}" value="${esc(fmtDate(val))}" ${f.required ? 'required' : ''} />`;
      break;
    case 'time':
      input = `<input type="time" name="${f.name}" value="${esc(val)}" />`;
      break;
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
  return `${seccion}<div class="${clases}"${condicionAttrs(f)}><label>${esc(f.label)} ${req}</label>${input}${help}</div>`;
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
    const n = Number(el ? el.value : 0);
    return Number.isFinite(n) ? n : 0;
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
      if (el && v !== null) el.value = v;
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
    }
    aplicarCondiciones();
  };

  fuentes.forEach((nombre) => {
    const el = form.querySelector(`[name="${nombre}"]`);
    if (el) el.addEventListener('change', refrescar);
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

  const elegir = (o) => {
    oculto.value = o.id;
    texto.value = o.label;
    quitar.hidden = false;
    cerrar();
    texto.dispatchEvent(new Event('change', { bubbles: true }));
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
  return Math.round(bytes / 1024) + ' KB';
}

/**
 * Reduce una foto antes de subirla: la deja con su lado mayor en el tamaño
 * configurado, conservando la proporción y el detalle a simple vista. Así una
 * foto de teléfono de varios MB sube en un instante, sin que se note.
 *
 * Si el archivo no es una imagen, o ya es pequeño, se sube tal cual.
 */
async function reducirImagen(file) {
  if (!file.type.startsWith('image/') || /svg|gif/i.test(file.type)) return { file, reducida: false };
  const lado = Number(AJUSTES.imagen_lado_maximo) || 1600;
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
    ctx.fillStyle = '#fff'; // el JPEG no tiene transparencia
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();
    const blob = await new Promise((res) => lienzo.toBlob(res, 'image/jpeg', calidad));
    if (!blob || blob.size >= file.size) return { file, reducida: false };
    const nombre = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return {
      file: new File([blob], nombre, { type: 'image/jpeg' }),
      reducida: true,
      antes: file.size, despues: blob.size, ancho, alto,
    };
  } catch (e) {
    return { file, reducida: false }; // ante cualquier problema, se sube el original
  }
}

function initFileField(f) {
  const fileInput = document.getElementById('file_' + f.name);
  if (!fileInput) return;
  fileInput.addEventListener('change', async () => {
    const original = fileInput.files[0];
    if (!original) return;
    const nameEl = document.getElementById('fname_' + f.name);
    nameEl.textContent = original.type.startsWith('image/') ? 'Preparando la imagen…' : 'Subiendo…';
    try {
      const ajustada = await reducirImagen(original);
      const fd = new FormData();
      fd.append('archivo', ajustada.file);
      nameEl.textContent = 'Subiendo…';
      const r = await api('POST', '/upload', fd, true);
      const hidden = document.querySelector(`#ff_${f.name} input[type=hidden]`);
      hidden.value = r.filename;
      const detalle = ajustada.reducida
        ? `<span class="fmeta">imagen ajustada a ${ajustada.ancho}×${ajustada.alto} — de ${tamanoLegible(ajustada.antes)} a ${tamanoLegible(ajustada.despues)}</span>`
        : `<span class="fmeta">${tamanoLegible(original.size)}</span>`;
      nameEl.innerHTML = `<a href="${esc(r.url)}" target="_blank">📎 ${esc(r.original)}</a>${detalle}`;
      // Vista previa inmediata de la imagen recién subida
      const caja = document.getElementById('ff_' + f.name);
      if (caja && /\.(jpe?g|png|webp)$/i.test(r.filename)) {
        let img = caja.querySelector('img.preview');
        if (!img) {
          img = document.createElement('img');
          img.className = 'preview';
          caja.appendChild(img);
        }
        img.src = r.url;
      }
      toast(ajustada.reducida ? 'Imagen ajustada y subida' : 'Archivo subido');
    } catch (e) {
      nameEl.textContent = '';
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
    desde: (precarga && precarga.desde) || '',
    hasta: (precarga && precarga.hasta) || '',
  };

  contenedor.innerHTML = `
    <div class="card">
      <div class="toolbar" id="infFiltros"></div>
    </div>
    <div id="infResultado"><p style="padding:18px">Cargando…</p></div>`;

  await getOptions('cuerpos').catch(() => []);
  await getOptions('miembros').catch(() => []);
  const cuerpos = optionsCache['cuerpos'] || [];

  const filtros = contenedor.querySelector('#infFiltros');
  filtros.innerHTML = `
    <select id="infTipo">
      <option value="general" ${st.tipo === 'general' ? 'selected' : ''}>Informe general</option>
      <option value="cuerpo" ${st.tipo === 'cuerpo' ? 'selected' : ''}>Informe por cuerpo</option>
      <option value="persona" ${st.tipo === 'persona' ? 'selected' : ''}>Informe por persona</option>
    </select>
    <select id="infCuerpo" ${st.tipo === 'cuerpo' ? '' : 'hidden'}>
      <option value="">— Elija el cuerpo —</option>
      ${cuerpos.map((c) => `<option value="${c.id}" ${String(st.cuerpo_id) === String(c.id) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
    </select>
    <div class="refbuscar inf-persona" id="rb_miembro_id" data-ruta="miembros" ${st.tipo === 'persona' ? '' : 'hidden'}>
      <input type="hidden" name="miembro_id" value="${esc(st.miembro_id)}" />
      <input type="text" class="rb-txt" placeholder="Busque a la persona por nombre o RUT…" autocomplete="off" />
      <button type="button" class="rb-x" title="Quitar" hidden>×</button>
      <ul class="rb-lista" hidden></ul>
    </div>
    <label class="range">Desde <input type="date" id="infDesde" value="${esc(st.desde)}" /></label>
    <label class="range">Hasta <input type="date" id="infHasta" value="${esc(st.hasta)}" /></label>
    <span class="spacer"></span>
    <button class="btn sm" id="infVer">Ver informe</button>`;

  initRefBuscador({ name: 'miembro_id' }, {});

  const sincronizar = () => {
    st.tipo = document.getElementById('infTipo').value;
    document.getElementById('infCuerpo').hidden = st.tipo !== 'cuerpo';
    document.getElementById('rb_miembro_id').hidden = st.tipo !== 'persona';
    st.cuerpo_id = document.getElementById('infCuerpo').value;
    st.miembro_id = document.querySelector('#rb_miembro_id input[type=hidden]').value;
    st.desde = document.getElementById('infDesde').value;
    st.hasta = document.getElementById('infHasta').value;
  };
  document.getElementById('infTipo').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infCuerpo').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('rb_miembro_id').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infDesde').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infHasta').addEventListener('change', () => { sincronizar(); cargar(); });
  document.getElementById('infVer').addEventListener('click', () => { sincronizar(); cargar(); });

  const pct = (n) => `${String(n).replace('.', ',')}%`;
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
      <table class="grid informe">
        <thead><tr>
          <th>${columna}</th><th>Presentes</th><th>Ausentes</th><th>Justificados</th>
          <th>Asistencia</th><th>Inasistencia</th><th>Justificación</th><th class="no-sort">Reparto</th>
        </tr></thead>
        <tbody>
          ${filas.map((f) => `
            <tr ${verMas ? `data-ver="${verMas(f)}" style="cursor:pointer"` : ''}>
              <td>${esc(f.etiqueta)}</td>
              <td>${f.presentes}</td><td>${f.ausentes}</td><td>${f.justificados}</td>
              <td><b>${pct(f.pct_presente)}</b></td><td>${pct(f.pct_ausente)}</td><td>${pct(f.pct_justificado)}</td>
              <td style="min-width:140px">${barra(f)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty-state" style="padding:22px">Sin datos en este período.</div>'}
    </div>`;

  async function cargar() {
    const caja = contenedor.querySelector('#infResultado');
    if (st.tipo === 'cuerpo' && !st.cuerpo_id) {
      caja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Elija un cuerpo para ver su informe.</div></div>';
      return;
    }
    if (st.tipo === 'persona' && !st.miembro_id) {
      caja.innerHTML = '<div class="card"><div class="empty-state" style="padding:26px">Busque a la persona para ver su informe.</div></div>';
      return;
    }
    caja.innerHTML = '<p style="padding:18px">Calculando…</p>';
    const params = new URLSearchParams({ tipo: st.tipo });
    if (st.desde) params.set('desde', st.desde);
    if (st.hasta) params.set('hasta', st.hasta);
    if (st.tipo === 'cuerpo' && st.cuerpo_id) params.set('cuerpo_id', st.cuerpo_id);
    if (st.tipo === 'persona' && st.miembro_id) params.set('miembro_id', st.miembro_id);

    let d;
    try {
      d = await api('GET', '/asistencias/informe?' + params.toString());
    } catch (e) {
      caja.innerHTML = `<p style="padding:18px;color:var(--danger)">${esc(e.message)}</p>`;
      return;
    }

    const periodo = d.desde || d.hasta
      ? `del ${d.desde ? fechaLarga(d.desde) : 'principio'} al ${d.hasta ? fechaLarga(d.hasta) : 'día de hoy'}`
      : 'de todo lo registrado';
    const g = d.general;

    const resumen = `
      <div class="stats informe-stats">
        <div class="stat"><div class="ic">📋</div><div class="num">${g.actividades}</div><div class="lbl">Actividades</div></div>
        <div class="stat"><div class="ic">🧍</div><div class="num">${g.personas}</div><div class="lbl">Personas</div></div>
        <div class="stat"><div class="ic">✅</div><div class="num">${pct(g.pct_presente)}</div><div class="lbl">Promedio de asistencia</div></div>
        <div class="stat"><div class="ic">❌</div><div class="num">${pct(g.pct_ausente)}</div><div class="lbl">Promedio de inasistencia</div></div>
        <div class="stat"><div class="ic">📝</div><div class="num">${pct(g.pct_justificado)}</div><div class="lbl">Promedio de justificación</div></div>
      </div>`;

    const motivos = d.porMotivo.length ? `
      <div class="card" style="margin-bottom:18px">
        <h3>Motivos de las justificaciones</h3>
        <ul class="mini-list">
          ${d.porMotivo.map((m) => `<li><span>${esc(m.motivo)}</span><span class="mut">${m.n} vez(ces)</span></li>`).join('')}
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
        <div class="print-only membrete">
          <img src="${IGLESIA.logo}" alt="" />
          <div><b>${esc(IGLESIA.nombre)}</b><i>${esc(IGLESIA.lema)}</i></div>
        </div>
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
              ...x, etiqueta: `${fmtDate(x.fecha)} · ${x.actividad || ''}`,
            })), 'Actividad')}
          ${tabla('Promedio por día', conEtiqueta(d.porDia.map((x) => ({
              ...x, fecha: `${fmtDate(x.fecha)}${x.actividades > 1 ? ` (${x.actividades} actividades)` : ''}`,
            })), 'fecha'), 'Fecha')}
          <div class="card" style="margin-bottom:18px">
            <h3>Detalle de sus marcas</h3>
            <div style="overflow-x:auto">
            <table class="grid informe">
              <thead><tr><th>Fecha</th><th>Cuerpo</th><th>Actividad</th><th>Estado</th><th>Motivo</th><th>Detalle</th></tr></thead>
              <tbody>
                ${d.marcas.map((m) => `
                  <tr>
                    <td>${fmtDate(m.fecha)}</td><td>${esc(m.cuerpo || '')}</td><td>${esc(m.actividad || '')}</td>
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
              ...x, fecha: `${fmtDate(x.fecha)}${x.actividades > 1 ? ` (${x.actividades} actividades)` : ''}`,
            })), 'fecha'), 'Fecha')}
          ${tabla('Actividad por actividad', d.porActividad.map((x) => ({
              ...x, etiqueta: `${fmtDate(x.fecha)} · ${x.actividad || ''}`,
            })), 'Actividad')}
          ${tabla('Promedio por miembro', conEtiqueta(d.porMiembro, 'miembro'), 'Miembro', (f) => f.miembro_id)}
          ${motivos}`}
        <div class="informe-pie mut">
          Emitido el ${fechaLarga(new Date().toISOString())} · Verde: presentes · Azul: justificados · Rojo: ausentes.<br>
          Cada actividad cuenta por separado: quien pertenece a varios cuerpos tiene una marca en cada actividad a la que
          fue convocado, y en el promedio de cada cuerpo cuenta solo lo de ese cuerpo.
        </div>
      </div>`;

    // Desde el promedio por miembro se salta a su informe personal
    caja.querySelectorAll('tr[data-ver]').forEach((tr) => {
      tr.addEventListener('click', () => {
        renderInformeAsistencia(contenedor, {
          tipo: 'persona', miembro_id: tr.dataset.ver, desde: st.desde, hasta: st.hasta,
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
function exportarInformeCSV() {
  if (!INFORME) return toast('Primero vea un informe.', true);
  const d = INFORME.datos;
  const comilla = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  // En Chile el decimal se escribe con coma; el separador de columnas es ";"
  const numero = (v) => comilla(String(v).replace('.', ','));
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
  lineas.push([comilla('Período'), comilla(INFORME.periodo)].join(';'));
  lineas.push('');
  bloque('Resumen general', 'Total', [d.general], () => 'Todo');
  bloque('Por cuerpo', 'Cuerpo / Grupo', d.porCuerpo, (f) => f.cuerpo || '—');
  bloque('Por día', 'Fecha', d.porDia, (f) => f.fecha);
  bloque('Actividad por actividad', 'Actividad', d.porActividad, (f) => `${f.fecha} ${f.actividad || ''}`.trim());
  bloque('Por miembro', 'Miembro', d.porMiembro, (f) => f.miembro || '—');
  if (d.porMotivo && d.porMotivo.length) {
    lineas.push([comilla('Motivos de las justificaciones')].join(';'));
    lineas.push([comilla('Motivo'), comilla('Veces')].join(';'));
    d.porMotivo.forEach((m) => lineas.push([comilla(m.motivo), m.n].join(';')));
  }

  // El BOM hace que Excel reconozca las tildes
  const blob = new Blob(['\ufeff' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `asistencia-${new Date().toISOString().slice(0, 10)}.csv`;
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
  let sheet;
  if (name === 'certificados') sheet = printCertificado(row);
  else if (name === 'credenciales') sheet = printCredencial(row);
  else if (name === 'actas_reuniones' || name === 'actas_asambleas') sheet = printActa(m, row, name === 'actas_asambleas');
  else if (name === 'servicios') sheet = printServicio(m, row);
  else sheet = printGenerico(m, row);

  content().innerHTML = `
    <div class="print-actions no-print">
      <button class="btn secondary" onclick="location.hash='#/m/${name}'">← Volver</button>
      <button class="btn" onclick="window.print()">🖨️ Imprimir</button>
    </div>
    ${sheet}`;
}

function certTextoEstandar(row) {
  const tipo = row.tipo || '';
  const iglesia = row.iglesia_id_label || 'la iglesia';
  const map = {
    'Bautismo': `Certifica que fue bautizado(a) en las aguas, en obediencia al mandato de nuestro Señor Jesucristo, el día ${fechaLarga(row.fecha_evento)}, en ${iglesia}.`,
    'Presentación de niños': `Certifica que fue presentado(a) al Señor el día ${fechaLarga(row.fecha_evento)}, en ${iglesia}, conforme a la enseñanza de las Sagradas Escrituras.`,
    'Matrimonio': `Certifica la celebración del matrimonio efectuado el día ${fechaLarga(row.fecha_evento)}, en ${iglesia}, delante de Dios y de los testigos presentes.`,
    'Membresía': `Certifica que es miembro en plena comunión de ${iglesia}.`,
    'Traslado': `Certifica que ha sido miembro en plena comunión de ${iglesia} y se extiende la presente para los fines de traslado a la congregación que lo(a) reciba.`,
  };
  return map[tipo] || `Se extiende el presente certificado de ${tipo.toLowerCase()} en constancia de lo actuado en ${iglesia}.`;
}

function printCertificado(row) {
  return `
    <div class="print-sheet cert-sheet">
      <div class="cert-inner">
        <img class="cert-logo" src="${IGLESIA.logo}" alt="" />
        <div class="church">${esc(IGLESIA.nombre)}<br><span class="lema">${esc(IGLESIA.lema)}</span></div>
        <div class="local">${esc(row.iglesia_id_label || '')}</div>
        <h1>Certificado de ${esc(row.tipo || '')}</h1>
        <div class="cert-no">N.º ${esc(row.numero || '')}</div>
        <div class="otorgado">Otorgado a:</div>
        <div class="titular">${esc(row.nombre_titular || '')}</div>
        <div class="texto">${esc(row.texto || certTextoEstandar(row))}</div>
        <div class="cert-firmas">
          <div class="firma">${esc(row.oficiante_id_label || 'Oficiante')}<br><span style="font-size:11px;color:#a8a29e">Firma</span></div>
          <div class="firma">Secretaría<br><span style="font-size:11px;color:#a8a29e">Firma y sello</span></div>
        </div>
        <div class="cert-fecha">Dado el ${fechaLarga(row.fecha_emision)}</div>
      </div>
    </div>`;
}

function printCredencial(row) {
  const foto = row.foto
    ? `<img src="/uploads/${esc(row.foto)}" alt="Foto" />`
    : `<div class="nofoto">👤</div>`;
  return `
    <div class="print-sheet" style="padding:30px;background:transparent;border:none;box-shadow:none">
      <div class="cred-card">
        <div class="cred-head">
          <div>
            <div class="t">${esc(IGLESIA.nombre)}</div>
            <div class="n">${esc(row.iglesia_id_label || '')} · Credencial de ${esc(row.tipo || '')}</div>
          </div>
          <img class="cred-logo" src="${IGLESIA.logo}" alt="" />
        </div>
        <div class="cred-body">
          ${foto}
          <div class="cred-data">
            <div class="nm">${esc(row.nombre_titular || '')}</div>
            <div><span class="lbl">Cargo:</span> ${esc(row.cargo || row.tipo || '')}</div>
            <div><span class="lbl">N.º:</span> ${esc(row.numero || '')}</div>
            <div><span class="lbl">Emitida:</span> ${fmtDate(row.fecha_emision)}</div>
            <div><span class="lbl">Vence:</span> ${fmtDate(row.fecha_vencimiento) || 'Indefinida'}</div>
          </div>
        </div>
        <div class="cred-foot">
          <span>Estado: ${esc(row.estado || '')}</span>
          <span>Firma autorizada: ______________</span>
        </div>
      </div>
    </div>`;
}

function printActa(m, row, esAsamblea) {
  const asistentes = (row.asistentes_labels || []).join(' · ');
  return `
    <div class="print-sheet acta-sheet">
      <div class="membrete">
        <img src="${IGLESIA.logo}" alt="" />
        <div>
          <b>${esc(IGLESIA.nombre)}</b>
          <i>${esc(IGLESIA.lema)}</i>
        </div>
      </div>
      <h1>${esAsamblea ? 'Acta de Asamblea' : 'Acta de Reunión'} N.º ${esc(row.numero_acta || '')}</h1>
      <div class="sub">${esc(row.iglesia_id_label || '')}${row.cuerpo_id_label ? ' — ' + esc(row.cuerpo_id_label) : ''}</div>
      <table class="meta-tbl">
        <tr><td class="k">Fecha</td><td>${fechaLarga(row.fecha)}</td></tr>
        ${esAsamblea ? `<tr><td class="k">Tipo de asamblea</td><td>${esc(row.tipo || '')}</td></tr>` : ''}
        <tr><td class="k">Lugar</td><td>${esc(row.lugar || '')}</td></tr>
        <tr><td class="k">Hora</td><td>${esc(row.hora_inicio || '')}${row.hora_fin ? ' a ' + esc(row.hora_fin) : ''}</td></tr>
        <tr><td class="k">Presidida por</td><td>${esc(row.presidida_por || '')}</td></tr>
        <tr><td class="k">Secretario(a)</td><td>${esc(row.secretario || '')}</td></tr>
        ${esAsamblea ? `<tr><td class="k">Asistentes / Quórum</td><td>${esc(row.total_asistentes ?? '')} asistentes — ${row.hubo_quorum ? 'hubo quórum' : 'sin quórum'}</td></tr>` : ''}
      </table>
      ${asistentes ? `<h3>Asistentes</h3><p>${esc(asistentes)}</p>` : ''}
      ${row.agenda ? `<h3>Agenda / Orden del día</h3><div class="blk">${esc(row.agenda)}</div>` : ''}
      ${row.desarrollo ? `<h3>Desarrollo</h3><div class="blk">${esc(row.desarrollo)}</div>` : ''}
      ${row.acuerdos ? `<h3>Acuerdos</h3><div class="blk">${esc(row.acuerdos)}</div>` : ''}
      <div class="acta-firmas">
        <div class="firma">${esc(row.presidida_por || 'Preside')}<br>Preside</div>
        <div class="firma">${esc(row.secretario || 'Secretario(a)')}<br>Secretario(a)</div>
      </div>
    </div>`;
}

/** Hoja de un servicio: los datos agrupados como se viven en el culto. */
function printServicio(m, row) {
  const fila = (k, v) => (v == null || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`);
  return `
    <div class="print-sheet print-generic">
      <div class="membrete">
        <img src="${IGLESIA.logo}" alt="" />
        <div><b>${esc(IGLESIA.nombre)}</b><i>${esc(IGLESIA.lema)}</i></div>
      </div>
      <h1>Registro de Servicio</h1>
      <div class="sub">${esc(row.iglesia_id_label || '')} — ${fechaLarga(row.fecha)}</div>
      <table class="meta-tbl">
        ${fila('Tipo de servicio', row.tipo)}
        ${fila('Horario', [row.hora_inicio, row.hora_termino].filter(Boolean).join(' a '))}
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
        ${fila('Tema', row.mensaje_titulo)}
        ${fila('Pasaje', row.cita_mensaje)}
      </table>

      <h3>Asistencia</h3>
      <table class="meta-tbl">
        ${fila('Adultos', row.asistencia_adultos)}
        ${fila('Niños', row.asistencia_ninos)}
        ${fila('Total general', row.asistencia_total)}
      </table>

      <h3>Ofrenda</h3>
      <table class="meta-tbl">
        ${fila('Recibida (total)', fmtMoney(row.ofrenda_total))}
        ${fila('Aparte para el fondo', fmtMoney(row.ofrenda_fondo))}
        ${fila('Queda para la iglesia', fmtMoney(row.ofrenda_iglesia))}
      </table>

      ${row.observaciones ? `<h3>Observaciones</h3><div class="blk">${esc(row.observaciones)}</div>` : ''}
      <div class="acta-firmas">
        <div class="firma">${esc(row.coordinador || 'Coordinador(a)')}<br>Coordinador(a)</div>
        <div class="firma">${esc(row.predicador || 'Predicador(a)')}<br>Predicador(a)</div>
      </div>
    </div>`;
}

function printGenerico(m, row) {
  return `
    <div class="print-sheet print-generic">
      <div class="membrete">
        <img src="${IGLESIA.logo}" alt="" />
        <div><b>${esc(IGLESIA.nombre)}</b><i>${esc(IGLESIA.lema)}</i></div>
      </div>
      <h1>${esc(m.labelSingular)}</h1>
      <div class="sub">Registro N.º ${row.id} — impreso el ${fechaLarga(new Date().toISOString())}</div>
      <table>
        ${m.fields
          .filter((f) => f.type !== 'password')
          .map((f) => {
            let v = row[f.name];
            if (f.computed && v && typeof v === 'object') v = v.texto; // p. ej. estado de cumplimiento
            if (f.type === 'ref') v = row[f.name + '_label'];
            if (f.type === 'multiref') v = (row[f.name + '_labels'] || []).join(', ');
            if (f.type === 'money') v = fmtMoney(v);
            if (f.type === 'rut') v = rutFormatear(v);
            if (f.type === 'boolean') v = v ? 'Sí' : 'No';
            if (v == null || v === '') return '';
            return `<tr><td class="k">${esc(f.label)}</td><td>${esc(v)}</td></tr>`;
          })
          .join('')}
      </table>
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
        <button class="cerrar" title="Cerrar">&times;</button>
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
async function viewConfiguracion() {
  content().innerHTML = `<div class="page-head"><h2>⚙️ Configuración del sistema</h2></div><p>Cargando…</p>`;
  let datos;
  try {
    datos = await api('GET', '/configuracion');
  } catch (e) {
    content().innerHTML = `<div class="page-head"><h2>⚙️ Configuración</h2></div><p style="color:var(--danger)">${esc(e.message)}</p>`;
    return;
  }

  const campo = (o) => {
    if (o.tipo === 'boolean') {
      return `<div class="fld check full">
        <input type="checkbox" id="cfg_${o.clave}" data-clave="${o.clave}" data-tipo="boolean" ${String(o.valor) === '1' ? 'checked' : ''} />
        <label for="cfg_${o.clave}">${esc(o.label)}</label>
        ${o.ayuda ? `<div class="help" style="flex-basis:100%">${esc(o.ayuda)}</div>` : ''}
      </div>`;
    }
    const tipo = o.tipo === 'number' ? 'number' : 'text';
    const control = o.tipo === 'textarea'
      ? `<textarea data-clave="${o.clave}" data-tipo="textarea">${esc(o.valor || '')}</textarea>`
      : `<input type="${tipo}" data-clave="${o.clave}" data-tipo="${o.tipo}" value="${esc(o.valor || '')}" />`;
    return `<div class="fld${o.tipo === 'textarea' ? ' full' : ''}">
      <label>${esc(o.label)}</label>${control}
      ${o.ayuda ? `<div class="help">${esc(o.ayuda)}</div>` : ''}
    </div>`;
  };

  content().innerHTML = `
    <div class="page-head">
      <h2>⚙️ Configuración del sistema</h2>
      <div class="actions"><button class="btn" id="cfgGuardar">💾 Guardar cambios</button></div>
    </div>
    ${datos.grupos.map((g) => `
      <div class="card" style="margin-bottom:18px">
        <div class="toolbar"><b>${esc(g.grupo)}</b></div>
        <div class="form-grid">${g.items.map(campo).join('')}</div>
      </div>`).join('')}
    <div id="cfgEstado"></div>
    <div id="cfgTraspaso"></div>`;

  // El traspaso desde el sistema anterior, al pie de la configuración
  renderTraspaso(document.getElementById('cfgTraspaso'));

  document.getElementById('cfgGuardar').addEventListener('click', async () => {
    const cambios = {};
    content().querySelectorAll('[data-clave]').forEach((el) => {
      cambios[el.dataset.clave] = el.dataset.tipo === 'boolean' ? el.checked : el.value;
    });
    const mantenimiento = cambios.mantenimiento_activo === true;
    if (mantenimiento && !confirm('¿Activar el modo mantenimiento?\n\nSolo los administradores podrán ingresar; el resto verá el aviso y se cerrará su sesión.')) return;
    try {
      await api('PUT', '/configuracion', cambios);
      toast('Configuración guardada');
      document.getElementById('cfgEstado').innerHTML = mantenimiento
        ? `<div class="resultado warn"><b>🛠️ El sistema quedó en mantenimiento.</b> Solo los administradores pueden ingresar. Desactive esta opción para volver a la normalidad.</div>`
        : '';
      // El traspaso depende del modo mantenimiento: al cambiarlo, su panel se
      // pinta de nuevo para que el botón de importar quede como corresponde
      renderTraspaso(document.getElementById('cfgTraspaso'));
    } catch (e) {
      toast(e.message, true);
    }
  });
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

async function renderTraspaso(contenedor, mostrarDespues) {
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
          <p style="color:var(--muted);margin:0">
            No encuentro el archivo con los datos del sistema anterior
            (<code>importacion/origen-v10.json</code>). Sin él no hay nada que traspasar.
          </p>
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
            <b>2 · Ensayo</b>
            <span>Hace todo el trabajo y lo deshace al final. Sirve para ver los conteos sin tocar nada.</span>
            <button class="btn secondary sm" id="tpEnsayo">🧪 Correr el ensayo</button>
          </div>
          <div class="tp">
            <b>3 · Importar de verdad</b>
            <span>
              ${estado.mantenimiento
                ? 'El sistema está en mantenimiento: se puede importar.'
                : 'Primero active el modo mantenimiento, arriba en esta misma pantalla.'}
            </span>
            <button class="btn sm" id="tpImportar" ${estado.mantenimiento && estado.ultimo_ensayo ? '' : 'disabled'}>📥 Importar</button>
          </div>
          <div class="tp">
            <b>4 · Verificar</b>
            <span>Compara las dos bases módulo por módulo y revisa que las relaciones quedaran intactas.</span>
            <button class="btn secondary sm" id="tpInforme">📋 Ver el informe</button>
          </div>
        </div>

        <div id="tpSalida"></div>`}
    </div>`;

  if (sinOrigen) return;

  const salida = document.getElementById('tpSalida');
  const pintar = (titulo, lineas, clase) => {
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
  };

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
      if (!prueba && !r.error) {
        // Los conteos de arriba cambiaron, pero lo que acaba de pasar se queda
        // en pantalla: es lo que hay que leer antes de seguir.
        renderTraspaso(contenedor, {
          titulo: `📥 Importación · ${r.segundos} segundos`,
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
      const r = await api('GET', '/importacion/informe');
      pintar('📋 Informe de la importación', r.texto.split('\n'), r.todo_cuadra ? 'bien' : 'mal');

      // Para guardarlo: el texto ya está acá, no hace falta pedirlo de nuevo
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
    } catch (err) {
      toast(err.message, true);
    } finally {
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

/* =====================================================================
 * Editor de permisos personalizados por usuario
 * ===================================================================== */
function initPermisos(f, row, rolActual) {
  const caja = document.getElementById('perm_' + f.name);
  if (!caja || !PERMISOS_CATALOGO) return;

  const asignados = row[f.name] && typeof row[f.name] === 'object' ? { ...row[f.name] } : {};
  const { acciones, modulos, porRol } = PERMISOS_CATALOGO;

  const dibujar = () => {
    const rol = document.querySelector('#recForm [name="rol"]') ? document.querySelector('#recForm [name="rol"]').value : rolActual;
    const delRol = porRol[rol] || {};
    caja.innerHTML = `
      <div class="perm-cabecera">
        <span>Los módulos sin marcar siguen el rol seleccionado. Marque uno para darle permisos propios a este usuario.</span>
        <button type="button" class="btn secondary sm" id="permLimpiar">Quitar todos los ajustes</button>
      </div>
      <div class="table-scroll">
        <table class="perm-tabla">
          <thead>
            <tr>
              <th>Módulo</th>
              <th class="c">Personalizar</th>
              ${acciones.map((a) => `<th class="c">${esc(a.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${modulos.map((m) => {
              const propio = Array.isArray(asignados[m.name]);
              const efectivos = propio ? asignados[m.name] : (delRol[m.name] || []);
              return `<tr class="${propio ? 'personalizado' : ''}">
                <td>${esc(m.label)} <span class="grp">${esc(m.group)}</span></td>
                <td class="c"><input type="checkbox" class="perm-on" data-mod="${m.name}" ${propio ? 'checked' : ''} /></td>
                ${acciones.map((a) => `
                  <td class="c">
                    <input type="checkbox" class="perm-acc" data-mod="${m.name}" data-acc="${a.value}"
                      ${efectivos.includes(a.value) ? 'checked' : ''} ${propio ? '' : 'disabled'} />
                  </td>`).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    caja.dataset.value = JSON.stringify(asignados);

    caja.querySelectorAll('.perm-on').forEach((cb) => {
      cb.addEventListener('change', () => {
        const mod = cb.dataset.mod;
        if (cb.checked) asignados[mod] = [...(delRol[mod] || [])];
        else delete asignados[mod];
        dibujar();
      });
    });
    caja.querySelectorAll('.perm-acc').forEach((cb) => {
      cb.addEventListener('change', () => {
        const mod = cb.dataset.mod;
        if (!Array.isArray(asignados[mod])) return;
        const set = new Set(asignados[mod]);
        if (cb.checked) set.add(cb.dataset.acc);
        else set.delete(cb.dataset.acc);
        asignados[mod] = [...set];
        caja.dataset.value = JSON.stringify(asignados);
      });
    });
    const limpiar = document.getElementById('permLimpiar');
    if (limpiar) limpiar.addEventListener('click', () => {
      Object.keys(asignados).forEach((k) => delete asignados[k]);
      dibujar();
    });
  };

  dibujar();
  const selRol = document.querySelector('#recForm [name="rol"]');
  if (selRol) selRol.addEventListener('change', dibujar);
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
  select.parentNode.insertBefore(marca, select.nextSibling);

  const refrescar = async () => {
    if (!select.value) {
      marca.textContent = '';
      return;
    }
    marca.textContent = 'Consultando el saldo…';
    try {
      const e = await api('GET', `/cuentas_tesoreria/${select.value}/estado`);
      marca.innerHTML = `Saldo disponible: <b class="${e.saldo < 0 ? 'saldo-negativo' : ''}">${fmtMoney(e.saldo)}</b>`;
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
    <div class="page-head">
      <div>
        <h2>📋 Asistencia</h2>
        <p class="sub-iglesia">Registro e informes · ${esc(USER.iglesia_nombre || 'Todas las iglesias')}</p>
      </div>
      <div class="actions" id="asisAcciones"></div>
    </div>
    <div class="tabs" id="asisTabs">
      <button data-tab="registrar" class="${ASIS.tab === 'registrar' ? 'on' : ''}">🖐️ Registrar</button>
      <button data-tab="informes" class="${ASIS.tab === 'informes' ? 'on' : ''}">📈 Informes</button>
    </div>
    <div id="tabRegistrar" ${ASIS.tab === 'registrar' ? '' : 'hidden'}>
      <div class="card">
        <div class="toolbar asis-filtros" id="asisFiltros"></div>
        <div id="asisAgenda"><div class="empty-state" style="padding:26px">Cargando…</div></div>
      </div>
      <div id="asisDelDia"></div>
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
  pintarAcciones();
  pintarFiltros();
  await cargarAgenda();
  if (ASIS.tab === 'informes') {
    document.getElementById('tabInformes').dataset.listo = '1';
    renderInformeAsistencia(document.getElementById('tabInformes'));
  }
}

/** Los botones de la cabecera, distintos en cada pestaña. */
function pintarAcciones() {
  const zona = document.getElementById('asisAcciones');
  if (!zona) return;
  zona.innerHTML = ASIS.tab === 'informes'
    ? `<button class="btn secondary" id="asisPDF">🖨️ PDF</button>
       <button class="btn secondary" id="asisExcel">⬇️ Excel</button>`
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
      ASIS.actividadId = null;
      cargarAgenda();
    });
  }
}

function pintarFiltros() {
  const cuerpos = optionsCache['cuerpos'] || [];
  const tipos = (MOD['asistencias'].fields.find((f) => f.name === 'tipo_reunion') || {}).options || [];
  const zona = document.getElementById('asisFiltros');
  zona.innerHTML = `
    <select id="asisCuerpo">
      <option value="">Todos los cuerpos</option>
      ${cuerpos.map((c) => `<option value="${c.id}" ${String(ASIS.cuerpo_id) === String(c.id) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
    </select>
    <select id="asisTipo">
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
      ASIS.actividadId = null;
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
    else ASIS.actividadId = null;
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
        if (!confirm(`¿Eliminar la actividad "${a.tipo_reunion}" del ${fmtDate(a.fecha)}?\n\n` +
          `Se borrarán también sus ${a.marcados} marca(s) de asistencia. Esta acción no se puede deshacer.`)) return;
        try {
          await api('DELETE', `/asistencias/${a.id}`);
          toast('Actividad eliminada');
          if (ASIS.actividadId === a.id) ASIS.actividadId = null;
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
  const tipos = (MOD['asistencias'].fields.find((f) => f.name === 'tipo_reunion') || {}).options || [];
  const cuerpos = optionsCache['cuerpos'] || [];
  const elegidos = new Set(editando ? actividad.cuerpos.map((c) => c.id) : (ASIS.cuerpo_id ? [Number(ASIS.cuerpo_id)] : []));

  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>${editando ? '✏️ Editar actividad' : '➕ Nueva actividad'}</h3><button class="cerrar">&times;</button></div>
      <div class="modal-body">
        <div class="modal-fila">
          <div class="fld"><label>Fecha <span class="req">*</span></label>
            <input type="date" id="acFecha" value="${esc(editando ? fmtDate(actividad.fecha) : ASIS.dia)}" /></div>
          <div class="fld"><label>Hora</label>
            <input type="time" id="acHora" value="${esc(editando ? actividad.hora_inicio || '' : '')}" /></div>
        </div>
        <div class="fld" style="margin-top:12px"><label>Actividad <span class="req">*</span></label>
          <select id="acTipo">${tipos.map((t) => `<option value="${esc(t)}" ${editando && actividad.tipo_reunion === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
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
      toast(editando ? 'Actividad actualizada' : 'Actividad creada');
      cerrar();
      ASIS.dia = datos.fecha;
      ASIS.mes = new Date(datos.fecha + 'T00:00:00');
      ASIS.actividadId = guardada.id;
      cargarAgenda();
    } catch (e) {
      fondo.querySelector('#acError').textContent = e.message;
    }
  });
}

/* ---------------- pasar lista ---------------- */

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
  const MOTIVOS = (MOD['asistencia_detalle']
    ? (MOD['asistencia_detalle'].fields.find((f) => f.name === 'motivo') || {}).options
    : null) || ['Trabajo', 'Enfermedad', 'Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];
  const CON_DETALLE = datos.motivos_con_detalle || [];
  const CLAVE = `pasarlista:${asistenciaId}`;

  // Lo que quedó marcado sin guardar en este teléfono manda sobre lo guardado
  const borrador = puedeEditar ? leerBorrador(CLAVE) : null;
  let recuperadas = 0;
  if (borrador) {
    for (const p of datos.personas) {
      const b = borrador[p.miembro_id];
      if (!b) continue;
      const igual = (b.estado || null) === (p.estado || null)
        && (b.motivo || null) === (p.motivo || null)
        && (b.detalle || null) === (p.detalle || null);
      if (igual) continue;
      p.estado = b.estado || null;
      p.motivo = b.motivo || null;
      p.detalle = b.detalle || null;
      recuperadas++;
    }
    if (!recuperadas) borrarBorrador(CLAVE);
  }

  const fila = (p) => `
    <li data-id="${p.miembro_id}" data-buscar="${esc(textoBuscable(`${p.nombre} ${p.rut || ''}`))}"
        class="${p.estado ? 'marcado' : ''}">
      <div class="pl-quien">
        <b>${esc(p.nombre)}</b>
        ${p.cuerpo ? `<span class="pl-cuerpo-chip">${esc(p.cuerpo)}</span>` : ''}
        ${p.rut ? `<span class="mut">${esc(rutFormatear(p.rut))}</span>` : ''}
      </div>
      <div class="pl-botones">
        ${['Presente', 'Ausente', 'Justificado'].map((e) => `
          <button type="button" class="pl-b ${e.toLowerCase()} ${p.estado === e ? 'on' : ''}" data-estado="${e}" ${puedeEditar ? '' : 'disabled'}>${e}</button>`).join('')}
      </div>
      <div class="pl-just" ${p.estado === 'Justificado' ? '' : 'hidden'}>
        <select class="pl-motivo" ${puedeEditar ? '' : 'disabled'}>
          <option value="">— Motivo —</option>
          ${MOTIVOS.map((o) => `<option value="${esc(o)}" ${p.motivo === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
        <input type="text" class="pl-detalle" placeholder="Especifique el detalle" value="${esc(p.detalle || '')}"
               ${CON_DETALLE.includes(p.motivo) ? '' : 'hidden'} ${puedeEditar ? '' : 'disabled'} />
      </div>
    </li>`;

  contenedor.innerHTML = `
    <div class="card pl-card" style="margin-top:18px">
      <div class="pl-cab">
        <div class="pl-que">
          <b>🖐️ ${esc(datos.actividad.tipo || 'Actividad')} <span class="mut">${esc(diaSemanaYMes(datos.actividad.fecha).toLowerCase())}</span></b>
          <span>${(datos.actividad.cuerpos || []).map((c) => `<span class="badge">${esc(c.nombre)}</span>`).join(' ') || 'sin cuerpos'}</span>
        </div>
        ${puedeEditar && datos.personas.length
          ? '<button class="btn secondary sm" id="plTodos">✓ Todos presentes</button>'
          : ''}
      </div>
      ${datos.personas.length ? `
        ${recuperadas ? `<div class="pl-recuperado">📵 Se recuperaron ${recuperadas} marca(s) que habían quedado sin guardar en este teléfono. Revíselas y guarde.</div>` : ''}
        <div class="pl-filtros">
          <input type="search" id="plBuscar" placeholder="🔎 Buscar miembro por nombre o RUT…" autocomplete="off" />
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
          ${puedeEditar ? '<button class="btn" id="plGuardar">💾 Guardar lista</button>' : ''}
        </div>`
      : `<div class="empty-state" style="padding:26px">
           Los cuerpos convocados todavía no tienen integrantes. Agréguelos en Cuerpos / Grupos y vuelva a pasar lista.
         </div>`}
    </div>`;

  const lista = contenedor.querySelector('ul.pasar-lista');
  if (!lista) return;

  const filas = () => [...lista.querySelectorAll('li[data-id]')];
  const marcasDe = () => filas().map((li) => {
    const on = li.querySelector('.pl-b.on');
    return {
      miembro_id: Number(li.dataset.id),
      estado: on ? on.dataset.estado : null,
      motivo: li.querySelector('.pl-motivo').value || null,
      detalle: li.querySelector('.pl-detalle').value || null,
    };
  });

  /** Justificaciones a las que todavía les falta el motivo o el detalle. */
  const incompletas = () => marcasDe().filter(
    (m) => m.estado === 'Justificado' && (!m.motivo || (CON_DETALLE.includes(m.motivo) && !String(m.detalle || '').trim()))
  ).length;

  let sinGuardar = recuperadas > 0;
  let reloj = null;

  const pintarEstado = (texto, clase) => {
    const el = document.getElementById('plEstado');
    if (el) el.innerHTML = texto ? `<span class="${clase || ''}">${esc(texto)}</span>` : '';
  };

  const resumen = () => {
    const cuenta = { Presente: 0, Ausente: 0, Justificado: 0, sin: 0 };
    filas().forEach((li) => {
      const on = li.querySelector('.pl-b.on');
      if (on) cuenta[on.dataset.estado]++;
      else cuenta.sin++;
    });
    const total = filas().length;
    const marcados = total - cuenta.sin;
    const pct = total ? Math.round((marcados / total) * 100) : 0;
    document.getElementById('plPct').textContent = `${marcados}/${total} (${pct}%)`;
    document.getElementById('plBarra').style.width = `${pct}%`;
    document.getElementById('plResumen').innerHTML =
      `<span class="badge green">${cuenta.Presente} presentes</span>
       <span class="badge red">${cuenta.Ausente} ausentes</span>
       <span class="badge blue">${cuenta.Justificado} justificados</span>
       ${cuenta.sin ? `<span class="badge">${cuenta.sin} sin marcar</span>` : ''}`;
    const chip = contenedor.querySelector('[data-filtro="sin"]');
    if (chip) chip.textContent = `Sin marcar (${cuenta.sin})`;
    return cuenta;
  };

  const guardar = async (automatico) => {
    const faltan = incompletas();
    if (faltan) {
      pintarEstado(`Falta el motivo de ${faltan} justificación(es)`, 'aviso-texto');
      if (automatico) return;
    }
    const btn = document.getElementById('plGuardar');
    if (btn) btn.disabled = true;
    pintarEstado('Guardando…');
    try {
      const r = await api('POST', `/asistencias/${asistenciaId}/lista`, { marcas: marcasDe() });
      borrarBorrador(CLAVE);
      sinGuardar = false;
      const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      pintarEstado(`Guardado a las ${hora}`, 'ok-texto');
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

  /** Cada cambio queda en el teléfono al instante y se guarda solo al ratito. */
  const cambio = () => {
    sinGuardar = true;
    const porId = {};
    marcasDe().forEach((m) => (porId[m.miembro_id] = m));
    guardarBorrador(CLAVE, porId);
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

  lista.querySelectorAll('.pl-b').forEach((b) => {
    b.addEventListener('click', () => {
      const li = b.closest('li');
      const yaEstaba = b.classList.contains('on');
      li.querySelectorAll('.pl-b').forEach((x) => x.classList.remove('on'));
      if (!yaEstaba) b.classList.add('on'); // volver a pulsarlo la desmarca
      pintarFila(li);
      cambio();
    });
  });
  lista.querySelectorAll('.pl-motivo').forEach((sel) => {
    sel.addEventListener('change', () => { pintarFila(sel.closest('li')); cambio(); });
  });
  lista.querySelectorAll('.pl-detalle').forEach((inp) => {
    inp.addEventListener('input', cambio);
  });

  const btnTodos = document.getElementById('plTodos');
  if (btnTodos) {
    btnTodos.addEventListener('click', () => {
      // Solo a quienes están a la vista y sin marcar: no pisa lo ya decidido
      const pendientes = filas().filter((li) => !li.hidden && !li.querySelector('.pl-b.on'));
      const objetivo = pendientes.length ? pendientes : filas().filter((li) => !li.hidden);
      objetivo.forEach((li) => {
        li.querySelectorAll('.pl-b').forEach((x) => x.classList.toggle('on', x.dataset.estado === 'Presente'));
        pintarFila(li);
      });
      cambio();
    });
  }

  const btnGuardar = document.getElementById('plGuardar');
  if (btnGuardar) btnGuardar.addEventListener('click', () => guardar(false));

  // Buscador y filtros: dar con una persona entre muchas sin desplazarse
  function filtrar() {
    const texto = textoBuscable((document.getElementById('plBuscar') || {}).value || '');
    const activo = contenedor.querySelector('.pl-chips .chip.on');
    const filtro = activo ? activo.dataset.filtro : 'todos';
    let visibles = 0;
    filas().forEach((li) => {
      const calza = !texto || texto.split(/\s+/).every((t) => li.dataset.buscar.includes(t));
      const marcado = li.querySelector('.pl-b.on');
      const estado = marcado ? marcado.dataset.estado : '';
      const porEstado = filtro === 'todos' || (filtro === 'sin' ? !estado : estado === filtro);
      const mostrar = calza && porEstado;
      li.hidden = !mostrar;
      if (mostrar) visibles++;
    });
    const vacio = contenedor.querySelector('.pl-sinresultados');
    if (vacio) vacio.hidden = visibles > 0;
  }
  const buscador = document.getElementById('plBuscar');
  if (buscador) buscador.addEventListener('input', filtrar);
  contenedor.querySelectorAll('.pl-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      contenedor.querySelectorAll('.pl-chips .chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
      filtrar();
    });
  });

  filas().forEach(pintarFila);
  resumen();
  if (recuperadas) pintarEstado('Sin guardar', 'aviso-texto');
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
        </div>
        <div class="fin-cards" style="padding:0 18px 6px">
          <div class="fin slate"><div class="lbl">Saldo inicial</div><div class="num">${fmtMoney(e.saldo_inicial)}</div></div>
          <div class="fin green"><div class="lbl">Ingresos</div><div class="num">${fmtMoney(e.ingresos)}</div></div>
          <div class="fin red"><div class="lbl">Egresos</div><div class="num">${fmtMoney(e.egresos)}</div></div>
          <div class="fin blue"><div class="lbl">Saldo actual</div><div class="num ${e.saldo < 0 ? 'saldo-negativo' : ''}">${fmtMoney(e.saldo)}</div></div>
        </div>
        ${e.ultimos.length ? `<ul class="mini-list mov-list">
          ${e.ultimos.map((m) => `
            <li onclick="location.hash='#/m/tesoreria/edit/${m.id}'">
              <span>${fmtDate(m.fecha)} · ${esc(m.concepto)} <span class="mut">— ${esc(m.categoria || '')}</span></span>
              <b class="${m.tipo === 'Egreso' ? 'monto-egreso' : 'monto-ingreso'}">${m.tipo === 'Egreso' ? '−' : '+'} ${fmtMoney(m.monto)}</b>
            </li>`).join('')}
        </ul>` : '<div class="empty-state" style="padding:26px">Esta cuenta todavía no tiene movimientos.</div>'}
      </div>`;

    const bn = document.getElementById('btnMovNuevo');
    if (bn) bn.addEventListener('click', () => (location.hash = `#/m/tesoreria/new?cuenta_id=${cuentaId}`));
    const bv = document.getElementById('btnVerMovs');
    if (bv) bv.addEventListener('click', () => (location.hash = `#/m/tesoreria?f_cuenta_id=${cuentaId}`));
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
};
const PANEL_HISTORIAL = {
  miembros: { modulo: 'bitacora', campo: 'miembro_id', titulo: '🗒️ Historial del miembro' },
  iglesias: { modulo: 'historial_iglesias', campo: 'iglesia_id', titulo: '🗒️ Historial de la iglesia' },
  pastores: { modulo: 'historial_pastores', campo: 'pastor_id', titulo: '🗒️ Historial del pastor / guía' },
};

/** Documentos adjuntos a una ficha (de un miembro, de una iglesia, de un pastor). */
async function renderDocumentos(panel, id, contenedor) {
  const modDocs = MOD[panel.modulo];
  if (!modDocs) return;
  const esImagen = (a) => /\.(jpe?g|png|webp|gif)$/i.test(a || '');
  try {
    const datos = await api('GET', `/${panel.modulo}?f_${panel.campo}=${id}&limit=100&sort=fecha&dir=desc`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>${esc(panel.titulo)}</b>
          <span style="color:var(--muted);font-size:13px">${datos.total} documento(s)</span>
          <span class="spacer"></span>
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
                <div class="dfe">${d.fecha ? fmtDate(d.fecha) : ''}${d.observaciones ? ' — ' + esc(d.observaciones) : ''}</div>
              </div>
              <div class="da">
                ${d.archivo ? `<a class="btn sm secondary" href="/uploads/${esc(d.archivo)}" target="_blank">Ver</a>` : ''}
              </div>
            </li>`).join('')}
        </ul>` : '<div class="empty-state" style="padding:26px">Todavía no se ha adjuntado ningún documento.</div>'}
      </div>`;

    const btn = document.getElementById('btnDocNuevo');
    if (btn) btn.addEventListener('click', () => (location.hash = `#/m/${panel.modulo}/new?${panel.campo}=${id}`));
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

/** Historial de una ficha (de un miembro, de una iglesia, de un pastor). */
async function renderHistorial(panel, id, contenedor) {
  const modHist = MOD[panel.modulo];
  if (!modHist) return;
  try {
    const datos = await api('GET', `/${panel.modulo}?f_${panel.campo}=${id}&limit=100&sort=fecha&dir=desc`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>${esc(panel.titulo)}</b>
          <span style="color:var(--muted);font-size:13px">${datos.total} registro(s)</span>
          <span class="spacer"></span>
          ${modHist.perms.create ? `<button class="btn sm" id="btnAnotar">➕ Agregar anotación</button>` : ''}
        </div>
        <div id="histLista">
          ${datos.rows.length ? `<ul class="historial">
            ${datos.rows.map((r) => {
              const editado = r.created_at && r.updated_at && r.created_at !== r.updated_at;
              return `
              <li class="${r.origen === 'Automático' ? 'auto' : 'manual'}">
                <div class="hf">${fmtDate(r.fecha)}</div>
                <div class="hc">
                  <span class="badge ${badgeClass(r.tipo)}">${esc(r.tipo)}</span>
                  <div class="hd">${esc(r.descripcion)}</div>
                  <div class="hm">${r.origen === 'Automático' ? '⚙️ automático' : '✍️ ' + esc(r.registrado_por || '')}${editado ? ' · ✏️ editado' : ''}</div>
                </div>
                <div class="ha">
                  ${modHist.perms.edit ? `<button class="ico" data-editar="${r.id}" title="Editar este registro">✏️</button>` : ''}
                  ${modHist.perms.delete ? `<button class="ico" data-borrar="${r.id}" title="Eliminar este registro">🗑️</button>` : ''}
                </div>
              </li>`;
            }).join('')}
          </ul>` : '<div class="empty-state" style="padding:26px">Sin registros en el historial todavía.</div>'}
        </div>
      </div>`;

    const recargar = () => renderHistorial(panel, id, contenedor);
    const btn = document.getElementById('btnAnotar');
    if (btn) btn.addEventListener('click', () => abrirAnotacion(panel, id, recargar));

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
  const editando = !!registro;
  const valor = (campo, porDefecto) => (editando && registro[campo] != null ? registro[campo] : porDefecto);
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>${editando ? '✏️ Editar registro del historial' : '➕ Nueva anotación'}</h3><button class="cerrar">&times;</button></div>
      <div class="modal-body">
        ${editando && registro.origen === 'Automático'
          ? '<div class="aviso-auto">⚙️ Este registro lo generó el sistema al ocurrir el hecho. Se puede corregir su texto, y quedará marcado como editado.</div>'
          : ''}
        <div class="fld"><label>Fecha</label><input type="date" id="anFecha" value="${esc(fmtDate(valor('fecha', new Date().toISOString().slice(0, 10))))}" /></div>
        <div class="fld" style="margin-top:12px"><label>Tipo</label>
          <select id="anTipo">${tipos.map((t) => `<option value="${esc(t)}" ${t === valor('tipo', 'Anotación') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </div>
        <div class="fld" style="margin-top:12px"><label>Descripción</label><textarea id="anDesc" placeholder="Qué se quiere dejar registrado…">${esc(valor('descripcion', ''))}</textarea></div>
        ${editando ? `<div class="modal-nota">Para adjuntar un documento a este registro, ábralo en <a href="#/m/${panel.modulo}/edit/${registro.id}">su ficha completa</a>.</div>` : ''}
        <div class="form-error" id="anError" style="padding:0"></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="anCancelar">Cancelar</button>
        <button class="btn" id="anGuardar">💾 Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
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
async function renderPanelesCuerpo(cuerpoId, contenedor) {
  const [cumplimiento, directivas] = await Promise.all([
    api('GET', `/cuerpos/${cuerpoId}/cumplimiento`).catch(() => null),
    MOD['directivas']
      ? api('GET', `/directivas?f_cuerpo_id=${cuerpoId}&sort=fecha_inicio&dir=desc&limit=50`).catch(() => null)
      : Promise.resolve(null),
  ]);

  let html = '';

  if (cumplimiento && cumplimiento.items.length) {
    html += `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>✅ Estado de cumplimiento</b>
          <span class="badge ${nivelClase(cumplimiento.nivel)}">${esc(cumplimiento.texto)}</span>
        </div>
        <ul class="cumplimiento">
          ${cumplimiento.items.map((i) => `
            <li class="${i.ok ? 'ok' : 'falta'}">
              <span class="mk">${i.ok ? '✓' : '✗'}</span>
              <div><b>${esc(i.texto)}</b><span>${esc(i.detalle)}</span></div>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  if (directivas) {
    const cargo = (d, campo, etiqueta) =>
      d[campo + '_label'] ? `<span class="cargo"><i>${etiqueta}:</i> ${esc(d[campo + '_label'])}</span>` : '';
    html += `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🏅 Directivas</b>
          <span style="color:var(--muted);font-size:13px">${directivas.total} período(s)</span>
          <span class="spacer"></span>
          ${MOD['directivas'].perms.create
            ? `<a class="btn sm" href="#/m/directivas/new?cuerpo_id=${cuerpoId}">➕ Nueva directiva</a>`
            : ''}
        </div>
        ${directivas.rows.length ? `<ul class="directivas">
          ${directivas.rows.map((d) => `
            <li class="${d.estado === 'Vigente' ? 'vigente' : ''}" onclick="location.hash='#/m/directivas/edit/${d.id}'">
              <div class="dp">
                <b>${esc(d.periodo)}</b>
                <span class="badge ${d.estado === 'Vigente' ? 'green' : ''}">${esc(d.estado)}</span>
              </div>
              <div class="df">${fmtDate(d.fecha_inicio)}${d.fecha_termino ? ' — ' + fmtDate(d.fecha_termino) : ''}</div>
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

  contenedor.innerHTML = html;
}

/* ---------------- inicio ---------------- */
boot();
