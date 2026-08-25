/**
 * De qué puede ser una ayuda social.
 *
 * Vive aparte porque la usan DOS módulos: Ayudas Sociales, donde se registra
 * lo entregado, y Solicitudes, donde se pide. Tienen que ofrecer exactamente
 * lo mismo: una solicitud aprobada se convierte sola en una ayuda, y si la
 * solicitud admitiera un tipo que la ayuda no conoce, la ficha nacería con un
 * valor que su propio desplegable no ofrece —imposible de corregir sin
 * borrarla y volver a empezar—.
 */
const TIPOS_DE_AYUDA = [
  'Alimentos',
  'Económica',
  'Medicamentos / Salud',
  'Ropa',
  'Vivienda',
  'Funeraria',
  'Educación',
  'Otro',
];

module.exports = { TIPOS_DE_AYUDA };
