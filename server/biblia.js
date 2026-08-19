/**
 * Libros de la Biblia, Reina-Valera 1960.
 *
 * Se usan como opciones en los campos que citan un pasaje (el salmo leído,
 * el mensaje predicado, etc.). Están en el orden del canon, primero el
 * Antiguo Testamento y después el Nuevo.
 */
const ANTIGUO_TESTAMENTO = [
  'Génesis', 'Éxodo', 'Levítico', 'Números', 'Deuteronomio',
  'Josué', 'Jueces', 'Rut', '1 Samuel', '2 Samuel',
  '1 Reyes', '2 Reyes', '1 Crónicas', '2 Crónicas', 'Esdras',
  'Nehemías', 'Ester', 'Job', 'Salmos', 'Proverbios',
  'Eclesiastés', 'Cantares', 'Isaías', 'Jeremías', 'Lamentaciones',
  'Ezequiel', 'Daniel', 'Oseas', 'Joel', 'Amós',
  'Abdías', 'Jonás', 'Miqueas', 'Nahúm', 'Habacuc',
  'Sofonías', 'Hageo', 'Zacarías', 'Malaquías',
];

const NUEVO_TESTAMENTO = [
  'Mateo', 'Marcos', 'Lucas', 'Juan', 'Hechos',
  'Romanos', '1 Corintios', '2 Corintios', 'Gálatas', 'Efesios',
  'Filipenses', 'Colosenses', '1 Tesalonicenses', '2 Tesalonicenses', '1 Timoteo',
  '2 Timoteo', 'Tito', 'Filemón', 'Hebreos', 'Santiago',
  '1 Pedro', '2 Pedro', '1 Juan', '2 Juan', '3 Juan',
  'Judas', 'Apocalipsis',
];

const LIBROS = [...ANTIGUO_TESTAMENTO, ...NUEVO_TESTAMENTO];

/**
 * Arma la cita de un pasaje: "Salmos 23:1-6", "Juan 3:16", "Romanos 8".
 * Devuelve cadena vacía si no hay libro.
 */
function cita(libro, capitulo, versiculoInicial, versiculoFinal) {
  if (!libro) return '';
  let texto = String(libro);
  if (capitulo == null || capitulo === '') return texto;
  texto += ` ${capitulo}`;
  if (versiculoInicial == null || versiculoInicial === '') return texto;
  texto += `:${versiculoInicial}`;
  if (versiculoFinal != null && versiculoFinal !== '' && Number(versiculoFinal) !== Number(versiculoInicial)) {
    texto += `-${versiculoFinal}`;
  }
  return texto;
}

module.exports = { LIBROS, ANTIGUO_TESTAMENTO, NUEVO_TESTAMENTO, cita };
