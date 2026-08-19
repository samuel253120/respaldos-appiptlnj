/**
 * Registro de módulos.
 *
 * Cada archivo en server/modules/ define un módulo del sistema (esquema de
 * campos, etiquetas, permisos de listado, etc.). Este registro los carga y
 * los expone al resto del sistema: la base de datos crea/migra sus tablas,
 * el CRUD genérico publica su API REST y el frontend genera su interfaz.
 *
 * Un módulo puede declarar `computed`: campos que no se guardan en la base,
 * sino que se calculan al leer cada registro (p. ej. un estado de
 * cumplimiento). Se pueden mostrar en los listados como cualquier otro campo.
 *
 * Un campo puede declarar `showIf: { field, equals | in }` para mostrarse solo
 * cuando otro campo tenga cierto valor (p. ej. datos que solo aplican a los
 * cuerpos formales y no a los grupos de servicio).
 *
 * Un campo de tipo `ref` puede declarar `optionsRoute` para que su selector se
 * llene desde una ruta propia del módulo (definida en `extraRoutes`) en vez de
 * ofrecer todos los registros referenciados: sirve para acotar la lista a los
 * que corresponden (p. ej. solo los integrantes del cuerpo de oficiales).
 *
 * Un campo de tipo `persona` guarda el nombre de alguien que puede o no estar
 * registrado: se busca en el módulo indicado en `ref` (normalmente miembros),
 * pero también admite un nombre escrito a mano. Se guarda en dos columnas: el
 * nombre en `<campo>` y, cuando la persona sí está registrada, su enlace en
 * `<campo>_id` (columna que este registro agrega sola).
 *
 * Un campo puede declarar `calcula` para obtener su valor de otros campos al
 * guardar: `{ tipo: 'suma' | 'resta', campos: [...] }` o
 * `{ tipo: 'porcentaje', campo, porcentaje | opcion }` (donde `opcion` es una
 * clave de Configuración). Conviene marcarlos también como `readonly`.
 *
 * PARA AGREGAR UN MÓDULO NUEVO: crear un archivo en server/modules/ que
 * exporte la definición (ver cualquier módulo existente como plantilla) y
 * reiniciar el servidor. Tabla, API e interfaz se generan automáticamente.
 */
const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, 'modules');

const modules = {};

for (const file of fs.readdirSync(MODULES_DIR).sort()) {
  if (!file.endsWith('.js')) continue;
  const def = require(path.join(MODULES_DIR, file));
  if (!def || !def.name) continue;
  normalize(def);
  modules[def.name] = def;
}

function normalize(def) {
  def.label = def.label || def.name;
  def.labelSingular = def.labelSingular || def.label;
  def.icon = def.icon || '📄';
  def.group = def.group || 'General';
  def.order = def.order == null ? 100 : def.order;
  def.fields = def.fields || [];
  // Los campos "persona" necesitan una columna extra para enlazar al registro
  // cuando esa persona sí está en el sistema. Se agrega sola, oculta: no se
  // muestra como un campo más, la maneja el propio campo persona.
  const conCompaneros = [];
  for (const f of def.fields) {
    conCompaneros.push(f);
    if (f.type !== 'persona') continue;
    const enlace = `${f.name}_id`;
    if (def.fields.some((o) => o.name === enlace)) continue;
    conCompaneros.push({
      name: enlace,
      label: `${f.label || f.name} (registro enlazado)`,
      type: 'ref',
      ref: f.ref || 'miembros',
      oculto: true,
      companeroDe: f.name,
    });
  }
  def.fields = conCompaneros;
  def.computed = (def.computed || []).map((c) => ({
    ...c,
    label: c.label || c.name,
    type: c.type || 'badge',
    computed: true,
  }));
  def.searchFields = def.searchFields || def.fields.filter((f) => f.type === 'text' && !f.oculto).slice(0, 3).map((f) => f.name);
  def.listFields = def.listFields || def.fields.filter((f) => !f.oculto).slice(0, 5).map((f) => f.name);
  def.display = def.display || '{' + (def.fields[0] ? def.fields[0].name : 'id') + '}';
  def.defaultSort = def.defaultSort || { field: 'id', dir: 'desc' };
  for (const f of def.fields) {
    f.label = f.label || f.name;
    f.type = f.type || 'text';
  }
}

/** Texto de presentación de una fila según la plantilla display del módulo. */
function displayOf(def, row) {
  if (!row) return '';
  return def.display.replace(/\{(\w+)\}/g, (_, k) => (row[k] == null ? '' : String(row[k]))).trim() || `#${row.id}`;
}

function getModule(name) {
  return modules[name] || null;
}

function allModules() {
  return Object.values(modules).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

module.exports = { modules, getModule, allModules, displayOf };
