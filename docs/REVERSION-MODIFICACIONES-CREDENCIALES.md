# Cómo revertir las modificaciones al módulo de Credenciales (v1.303.0)

Este documento cumple el punto 0.4 del documento de cambios: *«Toda migración
debe ser reversible. Entregar el procedimiento de reversión.»*

Los cinco cambios se aplicaron en cinco commits separados justamente para esto:
cada uno se puede deshacer solo, sin arrastrar a los demás.

---

## Antes de nada: el respaldo

La copia que se tomó antes de tocar el esquema:

| | |
|---|---|
| Archivo | `respaldo-iglesias-2026-09-03.tar.gz` |
| Tamaño | 1.295.666 bytes |
| SHA-256 | `ae78049b832563b681467ba090a1e7547295e40d7028607f8a59915c344ee7f0` |
| Contenido | `iglesias.db` (17.993.960 B) + 6 archivos subidos |
| Cómo se tomó | Panel → Respaldo → «Bajar el respaldo» (`GET /api/respaldo`) |

Se baja uno nuevo antes de revertir, siempre: revertir también es un cambio.

---

## Reversión completa (vuelve todo a como estaba)

Con el sistema **detenido**:

```sh
# 1 · el código
git revert --no-commit de1e98b   # cambio 5 · CENTRAL → MATRIZ
git revert --no-commit a2d06b6   # cambio 4 · textos del reverso
git revert --no-commit 623c328   # cambio 3 · sellos
git revert --no-commit f7a72d1   # cambio 2 · proporciones del reverso
git revert --no-commit 5aef679   # cambio 1 · QR de 20 mm
git commit -m "Revertir las modificaciones al módulo de Credenciales"

# 2 · los datos
sqlite3 <carpeta de datos>/iglesias.db < docs/revertir-categoria-matriz.sql
```

El orden importa: los reverts se hacen del último al primero, porque el cambio
2 toca líneas que el 1 escribió.

---

## Reversión parcial

Los cambios 1 a 4 son **solo de presentación**: viven en `public/credencial.css`,
`public/app.js` y `server/credenciales/qr.js`, y no tocan ningún dato guardado.
Revertir cualquiera de ellos es revertir su commit y volver a publicar. No hay
nada que deshacer en la base.

El único que toca datos es el **cambio 5**.

### Deshacer solo el cambio 5

```sh
git revert 623c328..de1e98b --no-commit   # o solo: git revert de1e98b
sqlite3 <carpeta de datos>/iglesias.db < docs/revertir-categoria-matriz.sql
```

**Con el sistema detenido.** Si se ejecuta el SQL con el sistema andando, la
migración vuelve a correr en el siguiente arranque y deshace la reversión.

### Qué hace ese SQL, y por qué no es un UPDATE a secas

No es `UPDATE credenciales SET snap_categoria='CENTRAL' WHERE snap_categoria='MATRIZ'`.
Eso alcanzaría también a las credenciales emitidas **después** de la migración,
que nunca dijeron CENTRAL y no hay nada que devolverles.

El SQL se apoya en el rastro que la propia migración dejó: nombró en el
Registro de Cambios, una por una y con su `id`, a cada credencial que tocó.
Devuelve **esas y solo esas**, borra sus líneas de auditoría y desmarca la
migración para que pueda volver a correrse si se decide re-aplicarla.

### Comprobado, no supuesto

El procedimiento se ejecutó sobre una copia restaurada del respaldo, con dos
credenciales de categoría CENTRAL inyectadas a propósito (una emitida y un
borrador):

| | |
|---|---|
| Tablas de la base | 51 |
| Filas antes de migrar | 34.761 |
| Filas después de migrar | 34.764 (+1 en `migraciones`, +2 en `registro_cambios`) |
| Tablas con contenido distinto tras migrar | 3: `credenciales`, `migraciones`, `registro_cambios` |
| Tablas idénticas tras revertir | **50 de 51** |
| La tabla `credenciales`, tras revertir | **idéntica fila por fila y campo por campo** al respaldo |

Ninguna fila se perdió en ningún momento: los únicos cambios de conteo son las
dos líneas de auditoría y la marca de la propia migración, que es exactamente
lo que la migración debe añadir.

---

## Si hay credenciales impresas afectadas (punto 5.6)

Al cambiar la categoría guardada cambia lo que la página pública vuelve a
firmar. La consecuencia depende del modo del QR, y conviene tenerla clara:

- **Modo en línea** (el recomendado, y el de fábrica): el QR impreso lleva
  `/v/<serie>?c=<código>`, y el servidor recalcula ese código desde la ficha.
  Cambiada la categoría, **la tarjeta impresa deja de validar**.
- **Modo sin conexión**: el QR lleva su contenido adentro y se comprueba contra
  sí mismo, así que **sigue validando**. Lo que queda desalineado es el texto:
  la tarjeta dice una palabra que el registro ya no usa.

La migración no reemplaza esas credenciales por su cuenta. Las **nombra**, una
por una y con su número de serie, en el Registro de Cambios y en la consola del
arranque. Emitir el reemplazo es un acto con fecha, número de serie nuevo y una
firma detrás: lo hace una persona, desde el módulo de Credenciales. Al emitir la
nueva, la anterior queda como **Reemplazada** y se conserva —nunca se borra—.

Para encontrarlas después:

```sql
SELECT registro, detalle FROM registro_cambios
 WHERE modulo = 'Credenciales' AND accion = 'Migración'
   AND detalle LIKE '%YA ESTABA EMITIDA%';
```
