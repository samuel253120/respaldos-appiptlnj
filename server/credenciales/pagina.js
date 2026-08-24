/**
 * La página que se abre al escanear el código QR de una credencial.
 *
 * La escribe el servidor entera y llega hecha: nada de programa que se baje
 * después, nada de una segunda petición para traer los datos. Hay dos razones
 * y las dos pesan.
 *
 *   POR QUIÉN LA VA A ABRIR. Un teléfono, en la puerta de una iglesia, con la
 *   señal que haya. La página tiene que aparecer entera con lo primero que
 *   llegue: una sola petición, sin hojas de estilo aparte, sin tipografías que
 *   bajar, sin nada que espere a nada.
 *
 *   POR LO QUE NO PUEDE FILTRARSE. Si los datos vinieran de una dirección
 *   aparte que devuelve JSON, esa dirección sería otra puerta más que cuidar,
 *   y bastaría con encontrarla para consultar credenciales sin pasar por
 *   ninguna de las comprobaciones de acá. Con la página armada en el servidor
 *   hay una sola puerta, y lo que sale por ella ya viene decidido.
 *
 * Lo que se muestra y en qué orden lo fija el punto 9.3, y no se improvisa: el
 * estado grande y en color primero, porque es lo único que la tarjeta impresa
 * NO puede decir por sí sola.
 */
const { LEYENDA } = require('./verificacion');

/** Nada de lo que venga de la base entra al HTML sin pasar por acá. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** «2026-03-15» se lee mejor como «15 de marzo de 2026». */
function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/**
 * Los colores de cada estado.
 *
 * El verde y el rojo se eligieron oscuros a propósito: esta página se mira al
 * sol, en la puerta de una iglesia, en la pantalla de un teléfono barato.
 */
const PINTURA = {
  verde: { fondo: '#0F7B3C', letra: '#FFFFFF' },
  amarillo: { fondo: '#B37A00', letra: '#FFFFFF' },
  gris: { fondo: '#5A5F6B', letra: '#FFFFFF' },
  rojo: { fondo: '#B3261E', letra: '#FFFFFF' },
};

const ESTILO = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
    background:#EEF0F5;color:#1B1F2A;line-height:1.5;
    padding:16px;display:flex;justify-content:center;
    -webkit-text-size-adjust:100%;
  }
  .hoja{width:100%;max-width:440px}
  .marca{display:flex;align-items:center;gap:10px;margin-bottom:14px;justify-content:center;text-align:center}
  .marca img{width:38px;height:38px;object-fit:contain;flex:0 0 auto}
  .marca b{font-size:14px;font-weight:700;color:#3A4157}
  .tarjeta{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(20,30,60,.12)}
  .estado{padding:20px 16px;text-align:center}
  .estado .que{font-size:12px;letter-spacing:.16em;font-weight:700;opacity:.85}
  .estado .cual{font-size:30px;font-weight:800;letter-spacing:.02em;margin-top:4px;line-height:1.15}
  .estado .porque{font-size:13px;margin-top:8px;opacity:.95}
  .persona{display:flex;gap:14px;padding:18px 16px;align-items:flex-start;border-bottom:1px solid #E7E9F0}
  /* El recorte y la letra chica son para cuando la foto NO llega: el navegador
     escribe ahí el texto alternativo, y sin esto se desborda del recuadro y se
     come el nombre de al lado. */
  .persona img{
    width:88px;height:116px;object-fit:cover;border-radius:8px;background:#E7E9F0;flex:0 0 auto;
    overflow:hidden;font-size:10px;color:#8A90A2
  }
  .persona .sinfoto{
    width:88px;height:116px;border-radius:8px;background:#E7E9F0;flex:0 0 auto;
    display:flex;align-items:center;justify-content:center;font-size:11px;color:#8A90A2;text-align:center;padding:6px
  }
  .persona h1{font-size:20px;font-weight:800;line-height:1.25}
  .persona .grado{font-size:15px;color:#3A4157;margin-top:3px;font-weight:600}
  .persona .cargo{font-size:14px;color:#5A6072;margin-top:1px}
  dl{padding:6px 16px 14px}
  .dato{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid #F0F1F6}
  .dato:last-child{border-bottom:none}
  dt{font-size:13px;color:#5A6072;flex:0 0 auto}
  dd{font-size:14px;font-weight:600;text-align:right}
  .mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .leyenda{padding:14px 16px;background:#F7F8FB;font-size:12px;color:#5A6072;text-align:center;line-height:1.5}
  .aviso{margin-top:14px;font-size:12px;color:#5A6072;text-align:center;line-height:1.6}
  @media (max-width:360px){
    .persona{gap:10px}
    .persona img,.persona .sinfoto{width:72px;height:96px}
    .persona h1{font-size:18px}
    .estado .cual{font-size:25px}
  }
`;

/** El envoltorio común: la misma cabecera y el mismo pie para todo. */
function envolver(titulo, dentro, institucion) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#16265c">
<title>${esc(titulo)}</title>
<style>${ESTILO}</style>
</head>
<body>
<div class="hoja">
  <div class="marca">
    <img src="/api/configuracion/logo" alt="">
    <b>${esc(institucion || 'Verificación de credencial')}</b>
  </div>
  ${dentro}
</div>
</body>
</html>`;
}

/**
 * La página cuando el código no calza (punto 9.2).
 *
 * No dice por qué. No dice si esa serie existe. No muestra ningún dato. Quien
 * llegue con un número inventado y quien llegue con un número real y el código
 * cambiado ven exactamente lo mismo, y esa es la única forma de que probar
 * números no sirva para averiguar nada.
 */
function noValida(institucion) {
  const c = PINTURA.rojo;
  return envolver('Credencial no válida', `
  <div class="tarjeta">
    <div class="estado" style="background:${c.fondo};color:${c.letra}">
      <div class="que">RESULTADO DE LA VERIFICACIÓN</div>
      <div class="cual">CREDENCIAL NO VÁLIDA</div>
      <div class="porque">Este código no corresponde a ninguna credencial emitida por la institución.</div>
    </div>
    <div class="leyenda">${esc(LEYENDA)}</div>
  </div>
  <p class="aviso">
    Si escaneó una credencial y le aparece esto, la tarjeta no fue emitida por la institución
    o sus datos fueron alterados. Comuníquese con la iglesia antes de darla por buena.
  </p>`, institucion);
}

/** La página cuando se pidieron demasiadas verificaciones seguidas (punto 9.6). */
function demasiadas(segundos, institucion) {
  const c = PINTURA.amarillo;
  return envolver('Espere un momento', `
  <div class="tarjeta">
    <div class="estado" style="background:${c.fondo};color:${c.letra}">
      <div class="que">VERIFICACIÓN</div>
      <div class="cual">ESPERE UN MOMENTO</div>
      <div class="porque">Se hicieron muchas consultas seguidas desde esta conexión.
        Vuelva a intentarlo en ${esc(segundos)} segundo${segundos === 1 ? '' : 's'}.</div>
    </div>
    <div class="leyenda">${esc(LEYENDA)}</div>
  </div>`, institucion);
}

/** La página cuando la credencial es de verdad (punto 9.3). */
function valida(resultado, { institucion, direccionDeLaFoto }) {
  const d = resultado.datos;
  const c = PINTURA[resultado.color] || PINTURA.gris;
  const nombre = `${d.nombres} ${d.apellidos}`.trim();
  const iglesia = `${d.categoria} ${d.iglesia}`.trim();

  /** Una línea de la lista, solo si tiene algo que decir. */
  const linea = (rotulo, valor, clase = '') =>
    valor ? `<div class="dato"><dt>${esc(rotulo)}</dt><dd class="${clase}">${esc(valor)}</dd></div>` : '';

  const porque = {
    Vigente: 'Credencial vigente y emitida por la institución.',
    'Por vencer': 'Es válida, pero está próxima a vencer.',
    Vencida: 'Esta credencial pasó su fecha de vencimiento y ya no acredita.',
    Revocada: 'Esta credencial fue anulada por la institución y ya no vale.',
    Reemplazada: 'Se emitió otra credencial más nueva a esta persona; esta ya no es la vigente.',
  }[resultado.situacion] || '';

  return envolver(`Credencial ${d.serie}`, `
  <div class="tarjeta">
    <div class="estado" style="background:${c.fondo};color:${c.letra}">
      <div class="que">RESULTADO DE LA VERIFICACIÓN</div>
      <div class="cual">${esc(resultado.situacion.toUpperCase())}</div>
      <div class="porque">${esc(porque)}</div>
      ${d.motivo_revocacion ? `<div class="porque"><b>Motivo:</b> ${esc(d.motivo_revocacion)}</div>` : ''}
    </div>

    <div class="persona">
      ${d.hay_foto
        ? `<img src="${esc(direccionDeLaFoto)}" alt="Fotografía" width="88" height="116">`
        : '<div class="sinfoto">Sin fotografía</div>'}
      <div>
        <h1>${esc(nombre)}</h1>
        ${d.grado ? `<div class="grado">${esc(d.grado)}</div>` : ''}
        ${d.cargo ? `<div class="cargo">${esc(d.cargo)}</div>` : ''}
      </div>
    </div>

    <dl>
      ${linea('Iglesia', iglesia)}
      ${linea('Comuna', d.comuna)}
      ${linea('RUT', d.rut_tapado, 'mono')}
      ${linea('N.º de credencial', d.serie, 'mono')}
      ${linea('Entregada', fechaLarga(d.emitida))}
      ${linea('Vence', fechaLarga(d.vence))}
    </dl>

    <div class="leyenda">${esc(LEYENDA)}</div>
  </div>
  <p class="aviso">
    Del RUT se muestran solo los últimos dígitos: compárelos con los de la tarjeta que tiene a la vista.
  </p>`, institucion);
}

module.exports = { valida, noValida, demasiadas, esc, fechaLarga };
