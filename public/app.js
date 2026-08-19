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
async function getOptions(modName, force) {
  if (!force && optionsCache[modName]) return optionsCache[modName];
  const rows = await api('GET', `/${modName}/options`);
  optionsCache[modName] = rows;
  return rows;
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
    return viewList(name);
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
    <div class="dash-cols">
      <div class="card">
        <h3>📋 Últimas asistencias</h3>
        <ul class="mini-list">
          ${d.ultimasAsistencias.length ? d.ultimasAsistencias.map((a) => `
            <li onclick="location.hash='#/m/asistencias/edit/${a.id}'">
              <span>${esc(a.tipo_reunion)}</span>
              <span class="mut">${fmtDate(a.fecha)} · ${a.total_general ?? 0} pers.</span>
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

async function viewList(name) {
  const m = MOD[name];
  const st = stateOf(name);
  const fieldsBy = {};
  m.fields.forEach((f) => (fieldsBy[f.name] = f));

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
  const filterFields = m.fields.filter((f) => f.type === 'select').slice(0, 3);
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
                  ${m.perms.delete ? `<button class="btn danger sm act-del" data-id="${r.id}" title="Eliminar">🗑️</button>` : ''}
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
            optionsCache[name] = null;
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
      el.innerHTML = `
        <div class="fin green"><div class="lbl">Ingresos (período filtrado)</div><div class="num">${fmtMoney(r.ingresos)}</div></div>
        <div class="fin red"><div class="lbl">Egresos</div><div class="num">${fmtMoney(r.egresos)}</div></div>
        <div class="fin blue"><div class="lbl">Balance</div><div class="num">${fmtMoney(r.balance)}</div></div>
        <div class="fin slate"><div class="lbl">Movimientos</div><div class="num">${r.movimientos}</div></div>`;
    } catch (e) {
      el.innerHTML = '';
    }
  }

  load();
}

function cellValue(f, row, col) {
  if (col === 'id') return row.id;
  const v = row[f.name];
  if (f.computed) {
    if (v == null || v === '') return '';
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
  const refMods = [...new Set(m.fields.filter((f) => f.ref).map((f) => f.ref))];
  await Promise.all(refMods.map((r) => getOptions(r).catch(() => [])));

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
  });

  // Campos que solo aplican según el valor de otro (showIf)
  aplicarCondiciones();

  // Cumplimiento y directivas bajo la ficha del cuerpo
  if (name === 'cuerpos' && !isNew) {
    const zona = document.createElement('div');
    content().appendChild(zona);
    renderPanelesCuerpo(Number(id), zona);
  }

  // Historial del miembro (bitácora) bajo la ficha
  if (name === 'miembros' && !isNew) {
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
      optionsCache[name] = null; // refrescar selectores que referencien este módulo
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
      const opts = (optionsCache[f.ref] || []).map((o) => `<option value="${o.id}" ${String(val) === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`);
      input = `<select name="${f.name}"><option value="">—</option>${opts.join('')}</select>`;
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
          <span class="fname" id="fname_${f.name}">${val ? `<a href="/uploads/${esc(val)}" target="_blank">📎 ${esc(val)}</a>` : ''}</span>
          ${val && /\.(jpe?g|png|gif|webp)$/i.test(val) ? `<img class="preview" src="/uploads/${esc(val)}" alt="" />` : ''}
        </div>`;
      break;
    case 'password':
      input = `<input type="password" name="${f.name}" value="" autocomplete="new-password" ${f.required && isNew ? 'required' : ''} />`;
      break;
    case 'rut':
      input = `<input type="text" name="${f.name}" value="${esc(rutFormatear(val))}" placeholder="12.345.678-5" ${f.required ? 'required' : ''} />`;
      break;
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
  return `<div class="fld${wide}"${cond}><label>${esc(f.label)} ${req}</label>${input}${help}</div>`;
}

function initMultiref(f, row) {
  const box = document.getElementById('mr_' + f.name);
  if (!box) return;
  const selected = new Set((Array.isArray(row[f.name]) ? row[f.name] : []).map(Number));
  const options = optionsCache[f.ref] || [];
  box.innerHTML = `
    <input class="mr-search" type="search" placeholder="Filtrar…" />
    <div class="mr-list"></div>
    <div class="mr-count"></div>`;
  const listEl = box.querySelector('.mr-list');
  const countEl = box.querySelector('.mr-count');
  const render = (filter) => {
    const fl = (filter || '').toLowerCase();
    listEl.innerHTML = options
      .filter((o) => !fl || o.label.toLowerCase().includes(fl))
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

function initFileField(f) {
  const fileInput = document.getElementById('file_' + f.name);
  if (!fileInput) return;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('archivo', file);
    const nameEl = document.getElementById('fname_' + f.name);
    nameEl.textContent = 'Subiendo…';
    try {
      const r = await api('POST', '/upload', fd, true);
      const hidden = document.querySelector(`#ff_${f.name} input[type=hidden]`);
      hidden.value = r.filename;
      nameEl.innerHTML = `<a href="${esc(r.url)}" target="_blank">📎 ${esc(r.original)}</a>`;
      toast('Archivo subido');
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
    }
  }
  return data;
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
      optionsCache[m.name] = null;
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
            ${datos.rows.map((r) => `
              <li class="${r.origen === 'Automático' ? 'auto' : 'manual'}">
                <div class="hf">${fmtDate(r.fecha)}</div>
                <div class="hc">
                  <span class="badge ${badgeClass(r.tipo)}">${esc(r.tipo)}</span>
                  <div class="hd">${esc(r.descripcion)}</div>
                  <div class="hm">${r.origen === 'Automático' ? '⚙️ automático' : '✍️ ' + esc(r.registrado_por || '')}</div>
                </div>
              </li>`).join('')}
          </ul>` : '<div class="empty-state" style="padding:26px">Sin registros en el historial todavía.</div>'}
        </div>
      </div>`;

    const btn = document.getElementById('btnAnotar');
    if (btn) btn.addEventListener('click', () => abrirAnotacion(miembroId, () => renderHistorialMiembro(miembroId, contenedor)));
  } catch (e) {
    contenedor.innerHTML = '';
  }
}

function abrirAnotacion(miembroId, alGuardar) {
  const tipos = (MOD['bitacora'].fields.find((f) => f.name === 'tipo').options || []).map((o) => (typeof o === 'object' ? o.value : o));
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-head"><h3>➕ Nueva anotación</h3><button class="cerrar">&times;</button></div>
      <div class="modal-body">
        <div class="fld"><label>Fecha</label><input type="date" id="anFecha" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="fld" style="margin-top:12px"><label>Tipo</label>
          <select id="anTipo">${tipos.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
        </div>
        <div class="fld" style="margin-top:12px"><label>Descripción</label><textarea id="anDesc" placeholder="Qué se quiere dejar registrado…"></textarea></div>
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
    try {
      await api('POST', '/bitacora', {
        miembro_id: miembroId,
        fecha: fondo.querySelector('#anFecha').value,
        tipo: fondo.querySelector('#anTipo').value,
        descripcion,
      });
      toast('Anotación guardada');
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
                ${cargo(d, 'presidente_id', 'Presidente(a)')}
                ${cargo(d, 'vicepresidente_id', 'Vicepresidente(a)')}
                ${cargo(d, 'secretario_id', 'Secretario(a)')}
                ${cargo(d, 'tesorero_id', 'Tesorero(a)')}
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
