/**
 * Cómo se dice acá lo que el sistema anterior decía con un código.
 *
 * Cada tabla de este archivo es una de las equivalencias que se revisaron y
 * se aprobaron antes de importar. Lo que no esté en la tabla **detiene la
 * importación**: es preferible parar y preguntar que guardar un valor que no
 * corresponde.
 */

/** Traduce un código, o explota si no se sabe traducirlo. */
function traducir(tabla, valor, donde) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const clave = String(valor).trim();
  if (!(clave in tabla)) {
    throw new Error(`No sé traducir "${clave}" en ${donde}. Revise la tabla de equivalencias antes de seguir.`);
  }
  return tabla[clave];
}

const SEXO = { male: 'Masculino', female: 'Femenino', masculino: 'Masculino', femenino: 'Femenino' };

const ESTADO_MIEMBRO = {
  active: 'Activo',
  inactive: 'Inactivo',
  // El fallecido se resuelve aparte: el motivo de baja manda sobre el estado
};

const TIPO_MIEMBRO = {
  activo: 'Miembro Activo',
  lider: 'Miembro Líder',
  nuevo: 'Miembro Nuevo',
  menor_edad: 'Miembro Menor de Edad',
  oyente: 'Miembro Oyente',
};

const FORMA_INGRESO = {
  servicio_general: 'Servicio General',
  invitacion_hermano: 'Invitación de Hermano(a)',
  redes_sociales: 'Redes Sociales',
  traslado: 'Traslado de Iglesia',
  nacido_iglesia: 'Nacido en la Iglesia',
  campana: 'Campaña Evangelística',
  otro: 'Otro',
};

const ESTADO_CIVIL = {
  soltero: 'Soltero(a)',
  matrimonio_iglesia: 'Casado(a)',   // la distinción queda en las dos fechas de matrimonio
  matrimonio_civil: 'Casado(a)',
  union_libre: 'Unión libre',
  separado: 'Separado(a)',
  viudo: 'Viudo(a)',
  divorciado: 'Divorciado(a)',
};

const TRATO = { hermano: 'Hermano', hermana: 'Hermana', oficial: 'Oficial', pastor: 'Pastor', pastora: 'Pastora' };

/** Educación: el origen la parte en dos campos y acá va en uno solo. */
const NIVEL = { basica: 'Básica', media: 'Media', tecnica: 'Técnica', universitaria: 'Universitaria' };
const CURSO = { completo: 'completa', incompleto: 'incompleta', cursando: 'en curso' };

function nivelEducacional(educacion, estado) {
  if (!educacion) return null;
  if (String(educacion).trim() === 'ninguna') return 'Sin estudios formales';
  const nivel = traducir(NIVEL, educacion, 'nivel educacional');
  if (!estado) return `${nivel} completa`; // sin estado, se asume terminada
  return `${nivel} ${traducir(CURSO, estado, 'estado de los estudios')}`;
}

const TIPO_ACTIVIDAD = {
  servicio_general: 'Servicio General',
  clase_dorcas: 'Clase de Dorcas',
  reunion_administrativa: 'Reunión Administrativa',
  oracion_domingo: 'Oración',
  salida_visitar: 'Salida a Visitar',
  ensayos: 'Ensayo',
  reunion_directivas: 'Reunión Directivas',
  estudio_biblico_cuerpo: 'Estudio Bíblico',
  estudio_biblico_general: 'Estudio Bíblico',
  servicio_vigilia: 'Servicio Vigilia',
  gira_cuerpo: 'Salida a Gira',
  salida_domingo: 'Otros',
  otro: 'Otros',
};

const ESTADO_ASISTENCIA = { present: 'Presente', absent: 'Ausente', justified: 'Justificado' };

const MOTIVO = {
  work: 'Trabajo',
  illness: 'Enfermedad',
  emergency: 'Emergencia',
  church_activity: 'Otra actividad de la iglesia',
  other: 'Otro motivo',
};

const CARGO_DIRECTIVA = {
  supervisor: 'oficial_supervisor_id',
  first_chief: 'primer_jefe_id',
  second_chief: 'segundo_jefe_id',
  secretary: 'secretario_id',
  treasurer: 'tesorero_id',
  counselor: 'consejero_id',
};

const TIPO_IGLESIA = { central: 'Iglesia Matriz', sede: 'Iglesia Sede', local: 'Iglesia Local', anexo: 'Iglesia Anexo' };

module.exports = {
  traducir, SEXO, ESTADO_MIEMBRO, TIPO_MIEMBRO, FORMA_INGRESO, ESTADO_CIVIL, TRATO,
  nivelEducacional, TIPO_ACTIVIDAD, ESTADO_ASISTENCIA, MOTIVO, CARGO_DIRECTIVA, TIPO_IGLESIA,
};
