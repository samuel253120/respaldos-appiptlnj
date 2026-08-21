/**
 * Módulo: Iglesias (congregaciones administradas por el sistema).
 *
 * Al crear una iglesia se le crean solas sus dos cuentas de tesorería: la
 * general y el fondo donde aparta lo que le corresponde a la corporación.
 *
 * Cada iglesia lleva además su fotografía, su historial (historial_iglesias)
 * y sus documentos (documentos_iglesias), que se ven al pie de su ficha.
 *
 * La organización distingue cuatro tipos de iglesia, de mayor a menor: la
 * MATRIZ —una sola en toda la organización—, las SEDES, las LOCALES y los
 * ANEXOS. El sistema hace cumplir que la matriz sea única.
 */

/** Los tipos de iglesia, de mayor a menor. */
const TIPOS_DE_IGLESIA = ['Iglesia Matriz', 'Iglesia Sede', 'Iglesia Local', 'Iglesia Anexo'];

/** El que ocupa una sola iglesia en toda la organización. */
const TIPO_UNICO = 'Iglesia Matriz';

module.exports = {
  name: 'iglesias',
  label: 'Iglesias',
  labelSingular: 'Iglesia',
  icon: '⛪',
  group: 'Organización',
  order: 10,
  display: '{nombre}',
  searchFields: ['nombre', 'codigo', 'ciudad', 'direccion'],
  listFields: ['foto', 'nombre', 'tipo', 'codigo', 'ciudad', 'telefono', 'pastor_id', 'estado'],
  filterFields: ['tipo', 'estado'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'foto', label: 'Fotografía del templo', type: 'file', accept: 'image/*',
      recorte: 'cuadrado',
      help: 'La foto con la que se reconoce a esta iglesia. Se puede sacar con el teléfono: al subirla se ajusta sola de tamaño.',
    },
    { name: 'nombre', label: 'Nombre', type: 'text', required: true },
    {
      name: 'tipo', label: 'Tipo de iglesia', type: 'select', default: 'Iglesia Local',
      options: TIPOS_DE_IGLESIA,
      help: 'De mayor a menor. La Iglesia Matriz es una sola en toda la organización.',
    },
    { name: 'codigo', label: 'Código', type: 'text', help: 'Identificador corto, ej. IG-001' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'ciudad', label: 'Ciudad / Municipio', type: 'text' },
    { name: 'departamento', label: 'Departamento / Estado', type: 'text' },
    { name: 'pais', label: 'País', type: 'text' },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'fecha_fundacion', label: 'Fecha de fundación', type: 'date' },
    { name: 'pastor_id', label: 'Pastor principal', type: 'ref', ref: 'pastores' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activa',
      options: ['Activa', 'Inactiva', 'En formación'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { id, existing, db }) {
      // Una sola Iglesia Matriz en toda la organización
      const tipo = data.tipo !== undefined ? data.tipo : existing ? existing.tipo : null;
      if (tipo === TIPO_UNICO) {
        const otra = db
          .prepare(`SELECT nombre FROM iglesias WHERE tipo = ? AND id != ?`)
          .get(TIPO_UNICO, id || 0);
        if (otra) {
          return `Ya hay una ${TIPO_UNICO}: ${otra.nombre}. ` +
            'Cámbiele el tipo a esa antes de designar otra.';
        }
      }
      return null;
    },

    afterSave(fila, { isNew, db }) {
      if (!isNew) return;
      const crear = db.prepare(
        `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial, descripcion)
         VALUES (?, 'Iglesia local', ?, ?, 'Activa', 0, ?)`
      );
      const falta = (tipo) =>
        !db.prepare('SELECT id FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = ?').get(fila.id, tipo);
      if (falta('General')) {
        crear.run(`Tesorería general — ${fila.nombre}`, fila.id, 'General', 'Tesorería general de la iglesia local.');
      }
      if (falta('Fondo para la corporación')) {
        crear.run(
          `Fondo para la corporación — ${fila.nombre}`, fila.id, 'Fondo para la corporación',
          'Donde la iglesia aparta lo que le corresponde a la corporación, hasta traspasarlo.'
        );
      }
    },
  },
};
