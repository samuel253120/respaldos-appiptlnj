/**
 * El ayudante del sistema: recibe los avisos y deja que la aplicación abra sin
 * señal.
 *
 * Un «service worker» es un pedazo de programa que el navegador deja andando
 * aparte de la página: sigue ahí aunque la persona haya cerrado la pestaña. Es
 * la única forma de que llegue un aviso con el sistema cerrado, y también la
 * única de que la aplicación abra cuando no hay internet.
 *
 * SE SIGUE LLAMANDO «avisos-sw» aunque ahora haga dos cosas. Cambiarle el
 * nombre reemplazaría el registro que ya tienen los navegadores de quienes
 * activaron los avisos, y con él sus suscripciones. No vale la pena por un
 * nombre.
 *
 * ── POR QUÉ ANTES NO GUARDABA NADA, Y QUÉ CAMBIÓ ──
 *
 * Este archivo decía, con razón, que guardar copias es peligroso: un ayudante
 * que guarda copias las sirve viejas después de publicar, y queda gente
 * trabajando con la versión de la semana pasada sin manera de darse cuenta.
 *
 * Pero no guardar nada tenía su propio precio, y era peor: al cerrar y volver
 * a abrir la aplicación sin señal, no aparecía el sistema sino la pantalla de
 * error del navegador. No parece «sin señal», parece que el sistema se rompió.
 *
 * La salida no es guardar todo ni no guardar nada, sino guardar cada cosa como
 * corresponde:
 *
 *   · LAS PÁGINAS se piden SIEMPRE al servidor. La copia se usa solo si la red
 *     falla. Con señal, siempre llega la última versión: el problema de servir
 *     viejo no puede volver, porque la copia jamás gana cuando hay red.
 *
 *   · LOS ARCHIVOS DEL PROGRAMA sí se sirven de la copia. Se pueden, porque el
 *     sistema los pide con la versión pegada —«app.js?v=1.87.4»—: cada versión
 *     es una dirección distinta, así que una copia vieja no puede suplantar a
 *     una nueva. Al guardar una versión se borran las anteriores del mismo
 *     archivo, para que la copia no crezca para siempre.
 *
 *   · LOS DATOS NO SE GUARDAN NUNCA. Ni «/api/», ni «/uploads/». Por dos
 *     motivos, y cualquiera de los dos bastaría: ahí van RUTs, datos de salud,
 *     fotos y documentos de personas, y una copia quedaría en el navegador
 *     después de cerrar la sesión; y una lista de miembros de ayer mostrada
 *     como si fuera de hoy es peor que no mostrar nada.
 */

/* ---------------- las copias ---------------- */

// Sube de número solo si cambia CÓMO se guarda; al activarse borra las
// anteriores. No hay que tocarlo al publicar una versión del sistema.
const BODEGA = 'iglesias-v1';

/** Lo que nunca se guarda, pase lo que pase. */
const PROHIBIDO = [/^\/api\//, /^\/uploads\//];

/** Lo que sí conviene tener guardado para que la aplicación abra sin señal. */
const DEL_PROGRAMA = [/^\/app\.js$/, /^\/styles\.css$/, /^\/credencial\.css$/,
  /^\/icons\//, /^\/img\//, /^\/favicon\.ico$/, /^\/manifest\.webmanifest$/];

const calza = (lista, ruta) => lista.some((r) => r.test(ruta));

/** La pantalla del último recurso: sin señal y sin copia de la aplicación. */
const SIN_SENAL = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f6fb;
color:#16265c;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
div{max-width:22rem}h1{font-size:1.25rem;margin:.5rem 0}p{color:#5a6684;line-height:1.5}
button{margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:8px;background:#16265c;color:#fff;
font-size:1rem}</style></head><body><div><div style="font-size:3rem">📡</div>
<h1>Sin conexión</h1><p>No se pudo llegar al sistema. Revise su señal o su wifi
e intente de nuevo.</p><button onclick="location.reload()">Reintentar</button></div></body></html>`;

/**
 * Guarda una copia y borra las versiones anteriores del mismo archivo.
 *
 * Sin esto, cada publicación dejaría un «app.js» más en la bodega y la copia
 * crecería sin tope en el teléfono de cada persona.
 */
async function guardar(peticion, respuesta) {
  const bodega = await caches.open(BODEGA);
  const suya = new URL(peticion.url).pathname;
  for (const vieja of await bodega.keys()) {
    if (new URL(vieja.url).pathname === suya && vieja.url !== peticion.url) {
      await bodega.delete(vieja);
    }
  }
  await bodega.put(peticion, respuesta);
}

const sirve = (r) => r && r.status === 200 && r.type === 'basic';

self.addEventListener('fetch', (ev) => {
  const peticion = ev.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (calza(PROHIBIDO, url.pathname)) return; // los datos no pasan por acá

  // Las páginas: primero la red, la copia solo si falla.
  if (peticion.mode === 'navigate') {
    ev.respondWith(
      fetch(peticion)
        .then((r) => {
          if (sirve(r)) guardar(peticion, r.clone());
          return r;
        })
        .catch(async () =>
          (await caches.match(peticion)) ||
          (await caches.match('/')) ||
          new Response(SIN_SENAL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        )
    );
    return;
  }

  // Los archivos del programa: primero la copia, que lleva la versión pegada.
  if (calza(DEL_PROGRAMA, url.pathname)) {
    ev.respondWith(
      caches.match(peticion).then(
        (guardada) =>
          guardada ||
          fetch(peticion).then((r) => {
            if (sirve(r)) guardar(peticion, r.clone());
            return r;
          })
      )
    );
  }
});

/**
 * Al instalarse, guarda la aplicación completa de una vez.
 *
 * HACE FALTA, aunque el manejador de más abajo ya guarde lo que va pasando: un
 * ayudante recién instalado toma el control DESPUÉS de que la página cargó sus
 * archivos, así que en la primera visita no alcanza a ver ni uno. Quien
 * instalara el sistema y se quedara sin señal antes de volver a abrirlo se
 * encontraría con la bodega vacía, que es justo el caso que esto viene a
 * resolver.
 *
 * Las direcciones de los archivos no se pueden escribir acá, porque llevan la
 * versión pegada y cambian en cada publicación. Se sacan leyendo la propia
 * página, que es quien los nombra: así nunca se guarda una lista equivocada.
 */
async function guardarLaAplicacion() {
  const bodega = await caches.open(BODEGA);
  const pagina = await fetch('/', { cache: 'reload' });
  if (!sirve(pagina)) return;

  const html = await pagina.clone().text();
  await bodega.put('/', pagina);

  const suyos = new Set();
  for (const encontrado of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    if (calza(DEL_PROGRAMA, encontrado[1].split('?')[0])) suyos.add(encontrado[1]);
  }
  await Promise.all(
    [...suyos].map(async (donde) => {
      try {
        const r = await fetch(donde, { cache: 'reload' });
        if (sirve(r)) await bodega.put(donde, r);
      } catch (e) {
        // Que falte uno no puede impedir la instalación: el resto igual sirve.
      }
    })
  );
}

/** Toma el control apenas se instala, sin esperar a que se cierren pestañas. */
self.addEventListener('install', (ev) =>
  ev.waitUntil(guardarLaAplicacion().catch(() => {}).then(() => self.skipWaiting()))
);
self.addEventListener('activate', (ev) =>
  ev.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n !== BODEGA).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  )
);

/** Llegó un aviso: se muestra. */
self.addEventListener('push', (ev) => {
  let d = {};
  try {
    d = ev.data ? ev.data.json() : {};
  } catch (e) {
    d = { titulo: 'Aviso del sistema' };
  }
  ev.waitUntil(
    self.registration.showNotification(d.titulo || 'Aviso del sistema', {
      body: d.cuerpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'es',
      // La etiqueta hace que un aviso del mismo asunto REEMPLACE al anterior
      // en vez de apilarse: si el resumen del día se manda dos veces, se ve
      // uno solo y no dos iguales.
      tag: d.etiqueta || 'aviso',
      data: { enlace: d.enlace || '/' },
    })
  );
});

/**
 * Tocaron el aviso: se abre el sistema en lo que el aviso apuntaba.
 *
 * Si ya hay una ventana del sistema abierta se la trae al frente y se la lleva
 * ahí, en vez de abrir una segunda: nadie quiere terminar con seis pestañas
 * del mismo sistema por haber tocado seis avisos.
 */
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const enlace = (ev.notification.data && ev.notification.data.enlace) || '/';
  const destino = new URL(enlace.startsWith('#') ? `/${enlace}` : enlace, self.location.origin).href;

  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abiertas) => {
      for (const v of abiertas) {
        if (v.url.startsWith(self.location.origin)) {
          return v.focus().then((f) => (f && f.navigate ? f.navigate(destino) : f));
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
