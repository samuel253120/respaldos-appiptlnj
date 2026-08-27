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

const { REGIONES } = require('../regiones');

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
  order: 50,
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
    {
      name: 'codigo', label: 'Código', type: 'text', required: true, unique: true,
      help: 'Identificador corto de esta iglesia, ej. CENTRAL o IG-001. Va dentro del número de cada '
        + 'solicitud —SOL-CENTRAL-0001-2026— para que se sepa de qué iglesia es, así que no puede repetirse. '
        + 'Se escribe en mayúsculas, sin tildes ni espacios; lo que se escriba se ajusta solo.',
    },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'ciudad', label: 'Ciudad', type: 'text' },
    {
      name: 'departamento', label: 'Región', type: 'select', options: REGIONES, buscador: true,
      help: 'Las dieciséis regiones del país, de norte a sur.',
    },
    { name: 'pais', label: 'País', type: 'text' },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'fecha_fundacion', label: 'Fecha de fundación', type: 'date' },
    {
      name: 'pastor_id', label: 'Pastor principal', type: 'ref', ref: 'pastores',
      // Al elegirlo se ve también a su cónyuge: de una iglesia responden los dos
      optionsRoute: '/pastores/con-conyuge',
      help: 'Al buscarlo aparece junto a su cónyuge, que es con quien está a cargo de la iglesia.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activa',
      options: ['Activa', 'Inactiva', 'En formación'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  computed: [
    {
      name: 'responsables', label: 'A cargo de la iglesia', type: 'texto',
      help: 'El pastor principal y su cónyuge: de la iglesia responden los dos.',
      calc: (fila, { db }) => {
        if (!fila.pastor_id) return '';
        const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(fila.pastor_id);
        if (!pastor) return '';
        const trato = require('../tratamiento');
        const nombres = require('../nombres');
        const suyo = pastor.miembro_id
          ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.miembro_id)
          : null;
        const el = suyo
          ? trato.conTratamiento(suyo, db)
          : nombres.paraMostrar(pastor.nombres, pastor.apellidos);
        if (!pastor.conyuge_id) return el;
        const ella = db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.conyuge_id);
        return ella ? `${el} y ${trato.conTratamiento(ella, db)}` : el;
      },
    },
  ],
  hooks: {
    beforeSave(data, { id, existing, db }) {
      /*
       * EL CÓDIGO SE AJUSTA SOLO, porque ya no es un dato de adorno.
       *
       * Va dentro del número de cada solicitud, y ahí tiene que poder
       * escribirse en un acta, dictarse por teléfono y buscarse en el sistema.
       * Así que lo que se escriba —«Iglesia Ñuñoa», «ig 001»— se guarda como
       * IGLESIA-NUNO o IG-001. Corregirlo al guardar es mejor que rechazarlo:
       * lo que la persona quiso decir se entiende igual.
       *
       * Que no se repita lo comprueba el motor, porque el campo está declarado
       * único; acá solo se deja normalizado ANTES de esa comprobación, o dos
       * códigos que se escriben distinto y valen lo mismo pasarían los dos.
       */
      if (data.codigo !== undefined) {
        const codigos = require('../codigo-iglesia');
        data.codigo = codigos.normalizar(data.codigo);
        if (!data.codigo) {
          return 'Escriba el código de esta iglesia: es lo que la identifica dentro del número de cada '
            + 'solicitud. Sirve algo corto y propio, como CENTRAL o IG-001.';
        }
        // El largo se avisa, no se recorta: cortarlo en silencio puede dejar
        // dos códigos distintos convertidos en el mismo
        if (data.codigo.length > codigos.LARGO_MAXIMO) {
          return `El código «${data.codigo}» es muy largo: hasta ${codigos.LARGO_MAXIMO} caracteres. `
            + 'Va dentro del número de cada solicitud —SOL-CENTRAL-0001-2026—, que se dicta por teléfono '
            + 'y se escribe en un acta, así que tiene que ser corto.';
        }
      }

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
