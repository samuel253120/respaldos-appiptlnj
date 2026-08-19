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
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
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
    if (meta.ajustes) AJUSTES = { ...AJUSTES, ...meta.ajustes };
    renderShell();
    route();
  } catch (e) {
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
    if (parts[2] === 'edit' && parts[3]) return viewForm(name, parts[3]);
    return viewList(name, precarga);
  }
  if (parts[0] === 'informes' && parts[1] === 'asistencia' && MOD['asistencias']) {
    const il = document.querySelector('.side-link[data-mod="_infoasis"]');
    if (il) il.classList.add('active');
    return viewInformeAsistencia(precarga);
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
function renderShell() {
  const groups = {};
  for (const m of MODULES) {
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
          <div class="group-title">Informes</div>
          <a class="side-link" data-mod="_infoasis" href="#/informes/asistencia"><span class="ic">📈</span> Informes de Asistencia</a>
        </div>` : ''}
        ${USER.rol === 'admin' ? `
        <div class="side-group">
          <div class="group-title">Sistema</div>
          <a class="side-link" data-mod="_config" href="#/config"><span class="ic">⚙️</span> Configuración</a>
        </div>` : ''}
        <div class="side-footer">Conectado como <b>${esc(USER.nombre)}</b><br>Rol: ${esc(USER.rol)}</div>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle">☰</button>
          <div class="iglesia-local" title="Iglesia en la que está trabajando">
            <span class="ic">⛪</span>
            <span class="nm">${esc(USER.iglesia_nombre || 'Todas las iglesias')}</span>
          </div>
          <div class="who"><span class="avatar">${esc(initials)}</span> <span><b>${esc(USER.nombre)}</b><br>${esc(USER.rut ? rutFormatear(USER.rut) : USER.email || '')}</span></div>
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
            <li class="${c.dias === 0 ? 'hoy' : ''}" onclick="location.hash='#/m/miembros/edit/${c.id}'">
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
            <li onclick="location.hash='#/m/asistencias/edit/${a.id}'">
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
  const filterFields = (m.filterFields || [])
    .map((n) => fieldsBy[n])
    .filter((f) => f && (f.type === 'select' || f.type === 'ref'));
  const iglesiaField = fieldsBy['iglesia_id'] && !USER.iglesia_id ? fieldsBy['iglesia_id'] : null;

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

    const cols = m.listFields.filter((c) => fieldsBy[c] || c === 'id');
    const wrap = document.getElementById('tableWrap');
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">${m.icon}</div>No hay registros${st.q || Object.values(st.filters).some(Boolean) ? ' con los filtros aplicados' : ''}.</div>`;
    } else {
      wrap.innerHTML = `
        <table class="grid">
          <thead><tr>
            ${cols.map((c) => {
              const f = fieldsBy[c];
              const lbl = c === 'id' ? 'ID' : f.label;
              if (f && f.computed) return `<th class="no-sort" style="cursor:default">${esc(lbl)}</th>`;
              const arrow = st.sort === c ? `<span class="arrow">${st.dir === 'asc' ? '▲' : '▼'}</span>` : '';
              return `<th data-col="${c}">${esc(lbl)} ${arrow}</th>`;
            }).join('')}
            <th class="no-sort"></th>
          </tr></thead>
          <tbody>
            ${data.rows.map((r) => `
              <tr data-id="${r.id}">
                ${cols.map((c) => `<td>${cellValue(fieldsBy[c], r, c)}</td>`).join('')}
                <td style="white-space:nowrap;text-align:right">
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
          location.hash = `#/m/${name}/edit/${tr.dataset.id}`;
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

/* ---------------- formulario genérico ---------------- */
async function viewForm(name, id, precarga) {
  const m = MOD[name];
  const isNew = !id;
  if (isNew && !m.perms.create) return (location.hash = `#/m/${name}`);
  const canEdit = isNew ? m.perms.create : m.perms.edit;

  content().innerHTML = `
    <div class="page-head">
      <h2>${m.icon} ${isNew ? 'Nuevo' : canEdit ? 'Editar' : 'Ver'} ${esc(m.labelSingular.toLowerCase())}</h2>
      <div class="actions"><button class="btn secondary" id="btnBack">← Volver</button></div>
    </div>
    <div class="card"><form id="recForm"><div class="form-grid" id="formGrid"><p>Cargando…</p></div>
    <div class="form-error" id="formError"></div>
    <div class="form-foot" id="formFoot"></div></form></div>`;
  document.getElementById('btnBack').addEventListener('click', () => (location.hash = `#/m/${name}`));

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

  const grid = document.getElementById('formGrid');
  grid.innerHTML = m.fields.filter((f) => !f.computed).map((f) => fieldHtml(f, row, isNew)).join('');

  // Comportamientos de widgets
  m.fields.filter((f) => !f.computed).forEach((f) => {
    if (f.type === 'multiref') initMultiref(f, row);
    if (f.type === 'file') initFileField(f);
    if (f.type === 'rut') {
      const el = document.querySelector(`#recForm [name="${f.name}"]`);
      if (el) el.addEventListener('blur', () => { if (el.value) el.value = rutFormatear(el.value); });
    }
    if (f.type === 'permisos') initPermisos(f, row, row.rol);
    if (f.type === 'persona') initPersona(f, row);
    if (f.type === 'ref') initRefBuscador(f, row);
    if (f.mostrarEdad) initEdad(f);
  });
  initCalculados(m);
  initSelectoresDependientes(m, row, isNew);

  // Campos que solo aplican según el valor de otro (showIf)
  aplicarCondiciones();

  // Al traspasar, se muestra cuánto hay en la cuenta de origen
  if (name === 'traspasos') mostrarSaldoOrigen();

  // Pasar lista bajo la ficha de la actividad
  if (name === 'asistencias' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderPasarLista(Number(id), zona);
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

  // Documentos e historial del miembro, bajo la ficha
  if (name === 'miembros' && !isNew) {
    const zonaDocs = document.createElement('div');
    content().appendChild(zonaDocs);
    renderDocumentosMiembro(Number(id), zonaDocs);
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderHistorialMiembro(Number(id), zona);
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
      location.hash = `#/m/${name}`;
    } catch (err) {
      errEl.textContent = err.message;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
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
      const esperados = String(div.dataset.showifValor).split('|');
      div.style.display = esperados.includes(actual) ? '' : 'none';
    });
  };

  const controles = new Set();
  condicionales.forEach((div) => controles.add(div.dataset.showifField));
  controles.forEach((nombre) => {
    const control = form.querySelector(`[name="${nombre}"]`);
    if (control) control.addEventListener('change', evaluar);
  });
  evaluar();
}

/** Marca un control como de solo lectura (campos que se calculan solos). */
function marcarSoloLectura(html) {
  return html.replace(/<(input|textarea|select)\b/g, '<$1 readonly disabled data-solo-lectura="1"');
}

function fieldHtml(f, row, isNew) {
  const val = row[f.name] != null ? row[f.name] : isNew && f.default != null ? f.default : '';
  const req = f.required ? '<span class="req">*</span>' : '';
  const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
  const wide = f.type === 'textarea' || f.type === 'multiref' || f.type === 'permisos' ? ' full' : '';
  let input = '';
  switch (f.type) {
    case 'textarea':
      input = `<textarea name="${f.name}">${esc(val)}</textarea>`;
      break;
    case 'select': {
      const opts = (f.options || []).map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
      });
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
      return `<div class="fld check${wide}"${f.showIf ? ` data-showif-field="${esc(f.showIf.field)}" data-showif-valor="${esc(f.showIf.equals !== undefined ? f.showIf.equals : (f.showIf.in || []).join('|'))}"` : ''}><input type="checkbox" id="chk_${f.name}" name="${f.name}" ${val ? 'checked' : ''} /><label for="chk_${f.name}">${esc(f.label)}</label>${help}</div>`;
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
      // Se puede elegir de la lista (queda enlazado al registro) o escribir un
      // nombre cualquiera, para quien no está registrado.
      const enlace = row[f.name + '_id'] || '';
      input = `
        <div class="personafld" id="pf_${f.name}">
          <input type="text" name="${f.name}" list="dlp_${f.name}" value="${esc(val)}" autocomplete="off"
                 placeholder="Escriba el nombre o elíjalo de la lista" ${f.required ? 'required' : ''} />
          <datalist id="dlp_${f.name}"></datalist>
          <input type="hidden" name="${f.name}_id" value="${esc(enlace)}" />
          <span class="persona-estado" id="pe_${f.name}"></span>
        </div>`;
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
      input = `<input type="text" name="${f.name}" value="${esc(val)}" ${f.required ? 'required' : ''} />`;
  }
  const cond = f.showIf
    ? ` data-showif-field="${esc(f.showIf.field)}" data-showif-valor="${esc(f.showIf.equals !== undefined ? f.showIf.equals : (f.showIf.in || []).join('|'))}"`
    : '';
  if (f.readonly) input = marcarSoloLectura(input);
  return `<div class="fld${wide}${f.readonly ? ' calculado' : ''}"${cond}><label>${esc(f.label)} ${req}</label>${input}${help}</div>`;
}

/**
 * Campo de persona: sugiere los registros del módulo referenciado, pero deja
 * escribir cualquier nombre. Si lo escrito coincide con un registro, se guarda
 * el enlace; si no, queda como nombre suelto.
 */
function initPersona(f, row) {
  const caja = document.getElementById('pf_' + f.name);
  if (!caja) return;
  const texto = caja.querySelector(`input[name="${f.name}"]`);
  const enlace = caja.querySelector(`input[name="${f.name}_id"]`);
  const estado = document.getElementById('pe_' + f.name);
  const lista = optionsCache[rutaOpciones(f)] || [];
  caja.querySelector('datalist').innerHTML = lista.map((o) => `<option value="${esc(o.label)}"></option>`).join('');

  const revisar = () => {
    const valor = (texto.value || '').trim().toLowerCase();
    const coincidencias = lista.filter((o) => o.label.toLowerCase() === valor);
    if (coincidencias.length === 1) {
      enlace.value = coincidencias[0].id;
      estado.className = 'persona-estado enlazado';
      estado.textContent = '✓ registrado';
    } else {
      enlace.value = '';
      estado.className = 'persona-estado libre';
      estado.textContent = texto.value.trim() ? 'no está en el registro' : '';
    }
  };
  texto.addEventListener('input', revisar);
  texto.addEventListener('change', revisar);
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
async function viewInformeAsistencia(precarga) {
  const st = {
    tipo: (precarga && precarga.tipo) || 'general',
    cuerpo_id: (precarga && precarga.cuerpo_id) || '',
    miembro_id: (precarga && precarga.miembro_id) || '',
    desde: (precarga && precarga.desde) || '',
    hasta: (precarga && precarga.hasta) || '',
  };

  content().innerHTML = `
    <div class="page-head">
      <div>
        <h2>📈 Informes de Asistencia</h2>
        <p class="sub-iglesia">${esc(USER.iglesia_nombre || 'Todas las iglesias')}</p>
      </div>
      <div class="actions"><button class="btn secondary" id="btnImprimirInf">🖨️ Imprimir</button></div>
    </div>
    <div class="card">
      <div class="toolbar" id="infFiltros"></div>
    </div>
    <div id="infResultado"><p style="padding:18px">Cargando…</p></div>`;

  document.getElementById('btnImprimirInf').addEventListener('click', () => window.print());
  await getOptions('cuerpos').catch(() => []);
  await getOptions('miembros').catch(() => []);
  const cuerpos = optionsCache['cuerpos'] || [];

  const filtros = document.getElementById('infFiltros');
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
    const caja = document.getElementById('infResultado');
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
        location.hash = `#/informes/asistencia?tipo=persona&miembro_id=${tr.dataset.ver}` +
          (st.desde ? `&desde=${st.desde}` : '') + (st.hasta ? `&hasta=${st.hasta}` : '');
      });
    });
  }

  cargar();
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
    <div id="cfgEstado"></div>`;

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
    } catch (e) {
      toast(e.message, true);
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
 * Pasar lista: los integrantes del cuerpo con sus tres botones —Presente,
 * Ausente, Justificado—, el motivo cuando se justifica y el detalle cuando el
 * motivo lo exige. Se guardan todas las marcas de una vez.
 */
async function renderPasarLista(asistenciaId, contenedor) {
  let datos;
  try {
    datos = await api('GET', `/asistencias/${asistenciaId}/lista`);
  } catch (e) {
    contenedor.innerHTML = '';
    return;
  }
  // Pasar lista depende del permiso de "Toma de Asistencia", no del de crear
  // actividades: el servidor lo resuelve y lo dice aquí.
  const puedeEditar = !!datos.puede_marcar;
  const MOTIVOS = (MOD['asistencia_detalle']
    ? (MOD['asistencia_detalle'].fields.find((f) => f.name === 'motivo') || {}).options
    : null) || ['Trabajo', 'Enfermedad', 'Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];
  const CON_DETALLE = datos.motivos_con_detalle || [];

  const fila = (p) => `
    <li data-id="${p.miembro_id}" class="${p.estado ? 'marcado' : ''}">
      <div class="pl-quien">
        <b>${esc(p.nombre)}</b>
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
    <div class="card" style="margin-top:18px">
      <div class="toolbar">
        <b>🖐️ Pasar lista</b>
        <span style="color:var(--muted);font-size:13px">${esc((datos.actividad.cuerpos || []).map((c) => c.nombre).join(' + ') || 'sin cuerpos')} · ${fmtDate(datos.actividad.fecha)}</span>
        <span class="spacer"></span>
        ${puedeEditar && datos.personas.length ? `
          <button class="btn secondary sm" id="plTodos">Todos presentes</button>
          <button class="btn sm" id="plGuardar">💾 Guardar lista</button>` : ''}
      </div>
      ${datos.personas.length
        ? `<ul class="pasar-lista">${(() => {
            // Agrupadas por cuerpo, con su encabezado cuando hay más de uno
            const variosCuerpos = new Set(datos.personas.map((p) => p.cuerpo || '')).size > 1;
            let cuerpoActual = null;
            return datos.personas.map((p) => {
              let cabecera = '';
              if (variosCuerpos && p.cuerpo !== cuerpoActual) {
                cuerpoActual = p.cuerpo;
                cabecera = `<li class="pl-cuerpo">${esc(p.cuerpo || 'Sin cuerpo')}</li>`;
              }
              return cabecera + fila(p);
            }).join('');
          })()}</ul>
           <div class="pl-resumen" id="plResumen"></div>`
        : `<div class="empty-state" style="padding:26px">
             Los cuerpos convocados todavía no tienen integrantes. Agréguelos en Cuerpos / Grupos y vuelva a pasar lista.
           </div>`}
    </div>`;

  const lista = contenedor.querySelector('ul.pasar-lista');
  if (!lista) return;

  const resumen = () => {
    const cuenta = { Presente: 0, Ausente: 0, Justificado: 0, sin: 0 };
    lista.querySelectorAll('li[data-id]').forEach((li) => {
      const on = li.querySelector('.pl-b.on');
      if (on) cuenta[on.dataset.estado]++;
      else cuenta.sin++;
    });
    document.getElementById('plResumen').innerHTML =
      `<span class="badge green">${cuenta.Presente} presentes</span>
       <span class="badge red">${cuenta.Ausente} ausentes</span>
       <span class="badge blue">${cuenta.Justificado} justificados</span>
       ${cuenta.sin ? `<span class="badge">${cuenta.sin} sin marcar</span>` : ''}`;
  };

  const pintarFila = (li) => {
    const estado = (li.querySelector('.pl-b.on') || {}).dataset ? li.querySelector('.pl-b.on').dataset.estado : null;
    const just = li.querySelector('.pl-just');
    just.hidden = estado !== 'Justificado';
    const motivo = li.querySelector('.pl-motivo').value;
    li.querySelector('.pl-detalle').hidden = !CON_DETALLE.includes(motivo);
    li.classList.toggle('marcado', !!estado);
  };

  lista.querySelectorAll('.pl-b').forEach((b) => {
    b.addEventListener('click', () => {
      const li = b.closest('li');
      const yaEstaba = b.classList.contains('on');
      li.querySelectorAll('.pl-b').forEach((x) => x.classList.remove('on'));
      if (!yaEstaba) b.classList.add('on'); // volver a pulsarlo la desmarca
      pintarFila(li);
      resumen();
    });
  });
  lista.querySelectorAll('.pl-motivo').forEach((sel) => {
    sel.addEventListener('change', () => pintarFila(sel.closest('li')));
  });

  const btnTodos = document.getElementById('plTodos');
  if (btnTodos) {
    btnTodos.addEventListener('click', () => {
      lista.querySelectorAll('li[data-id]').forEach((li) => {
        li.querySelectorAll('.pl-b').forEach((x) => x.classList.toggle('on', x.dataset.estado === 'Presente'));
        pintarFila(li);
      });
      resumen();
    });
  }

  const btnGuardar = document.getElementById('plGuardar');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', async () => {
      const marcas = [...lista.querySelectorAll('li[data-id]')].map((li) => {
        const on = li.querySelector('.pl-b.on');
        return {
          miembro_id: Number(li.dataset.id),
          estado: on ? on.dataset.estado : null,
          motivo: li.querySelector('.pl-motivo').value || null,
          detalle: li.querySelector('.pl-detalle').value || null,
        };
      });
      btnGuardar.disabled = true;
      try {
        const r = await api('POST', `/asistencias/${asistenciaId}/lista`, { marcas });
        toast(`Lista guardada: ${r.presentes} presentes, ${r.ausentes} ausentes, ${r.justificados} justificados`);
        renderPasarLista(asistenciaId, contenedor);
      } catch (e) {
        toast(e.message, true);
        btnGuardar.disabled = false;
      }
    });
  }

  resumen();
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

/** Documentos adjuntos de un miembro (carnet, fichas, certificados…). */
async function renderDocumentosMiembro(miembroId, contenedor) {
  const modDocs = MOD['documentos_miembros'];
  if (!modDocs) return;
  const esImagen = (a) => /\.(jpe?g|png|webp|gif)$/i.test(a || '');
  try {
    const datos = await api('GET', `/documentos_miembros?f_miembro_id=${miembroId}&limit=100&sort=fecha&dir=desc`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🗂️ Documentos del miembro</b>
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
    if (btn) btn.addEventListener('click', () => (location.hash = `#/m/documentos_miembros/new?miembro_id=${miembroId}`));
    contenedor.querySelectorAll('ul.documentos li').forEach((li) => {
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return; // "Ver" abre el archivo
        location.hash = `#/m/documentos_miembros/edit/${li.dataset.id}`;
      });
    });
  } catch (e) {
    contenedor.innerHTML = '';
  }
}

async function renderHistorialMiembro(miembroId, contenedor) {
  const modBitacora = MOD['bitacora'];
  if (!modBitacora) return;
  try {
    const datos = await api('GET', `/bitacora?f_miembro_id=${miembroId}&limit=100&sort=fecha&dir=desc`);
    contenedor.innerHTML = `
      <div class="card" style="margin-top:18px">
        <div class="toolbar">
          <b>🗒️ Historial del miembro</b>
          <span style="color:var(--muted);font-size:13px">${datos.total} registro(s)</span>
          <span class="spacer"></span>
          ${modBitacora.perms.create ? `<button class="btn sm" id="btnAnotar">➕ Agregar anotación</button>` : ''}
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
                  ${modBitacora.perms.edit ? `<button class="ico" data-editar="${r.id}" title="Editar este registro">✏️</button>` : ''}
                  ${modBitacora.perms.delete ? `<button class="ico" data-borrar="${r.id}" title="Eliminar este registro">🗑️</button>` : ''}
                </div>
              </li>`;
            }).join('')}
          </ul>` : '<div class="empty-state" style="padding:26px">Sin registros en el historial todavía.</div>'}
        </div>
      </div>`;

    const recargar = () => renderHistorialMiembro(miembroId, contenedor);
    const btn = document.getElementById('btnAnotar');
    if (btn) btn.addEventListener('click', () => abrirAnotacion(miembroId, recargar));

    // Editar un registro del historial
    contenedor.querySelectorAll('[data-editar]').forEach((b) => {
      b.addEventListener('click', () => {
        const registro = datos.rows.find((r) => String(r.id) === b.dataset.editar);
        if (registro) abrirAnotacion(miembroId, recargar, registro);
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
          await api('DELETE', `/bitacora/${registro.id}`);
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
 * Ventana para escribir una anotación en el historial de un miembro.
 * Si se le pasa un registro, edita ese en vez de crear uno nuevo.
 */
function abrirAnotacion(miembroId, alGuardar, registro) {
  const tipos = (MOD['bitacora'].fields.find((f) => f.name === 'tipo').options || []).map((o) => (typeof o === 'object' ? o.value : o));
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
        ${editando ? `<div class="modal-nota">Para adjuntar un documento a este registro, ábralo en <a href="#/m/bitacora/edit/${registro.id}">su ficha completa</a>.</div>` : ''}
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
      miembro_id: miembroId,
      fecha: fondo.querySelector('#anFecha').value,
      tipo: fondo.querySelector('#anTipo').value,
      descripcion,
    };
    try {
      if (editando) await api('PUT', `/bitacora/${registro.id}`, datos);
      else await api('POST', '/bitacora', datos);
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
