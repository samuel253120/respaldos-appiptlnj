/**
 * El ayudante que recibe los avisos cuando el sistema está cerrado.
 *
 * Un «service worker» es un pedazo de programa que el navegador deja andando
 * aparte de la página: sigue ahí aunque la persona haya cerrado la pestaña, y
 * es la única forma de que llegue un aviso con el sistema cerrado.
 *
 * ESTE NO TOCA LAS PETICIONES, Y ESO ES A PROPÓSITO. Un service worker puede
 * además guardarse copias de los archivos y responder por su cuenta, y es lo
 * que hace la mayoría. Acá NO: el sistema ya resuelve eso pidiendo sus
 * archivos con el número de versión pegado (`app.js?v=1.86.0`), y un ayudante
 * que además guardara copias las serviría viejas después de publicar. Se
 * quedaría gente trabajando con una versión de la semana pasada sin manera de
 * darse cuenta. Acá solo escucha avisos y abre la pantalla que corresponde.
 *
 * Por eso no tiene un `fetch`: ni uno.
 */

/** Toma el control apenas se instala, sin esperar a que se cierren pestañas. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

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
