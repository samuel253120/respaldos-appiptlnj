-- ─────────────────────────────────────────────────────────────────────────
-- REVERSIÓN de la migración «la categoría central de las credenciales ahora
-- es matriz» (cambio 5 de las modificaciones al módulo de Credenciales).
--
-- Deja la base exactamente como estaba antes de migrar. Se ejecuta con el
-- sistema DETENIDO; si no, la migración vuelve a correr en el siguiente
-- arranque y deshace la reversión.
--
--   sqlite3 <carpeta de datos>/iglesias.db < docs/revertir-categoria-matriz.sql
--
-- POR QUÉ NO ES UN «UPDATE ... WHERE snap_categoria = 'MATRIZ'» A SECAS: eso
-- alcanzaría también a las credenciales emitidas DESPUÉS de la migración, que
-- nunca dijeron CENTRAL y no hay nada que devolverles. Se usa el rastro que la
-- propia migración dejó: nombró en el Registro de Cambios, una por una y con
-- su id, a cada credencial que tocó. Se devuelven ESAS y solo esas.
--
-- Esto revierte los DATOS. Para revertir el CÓDIGO —que la credencial vuelva a
-- imprimir «CENTRAL»— hay que revertir además el commit del cambio 5.
-- ─────────────────────────────────────────────────────────────────────────
BEGIN IMMEDIATE;

UPDATE credenciales SET snap_categoria = 'CENTRAL'
 WHERE id IN (SELECT registro_id FROM registro_cambios
               WHERE modulo = 'Credenciales' AND accion = 'Migración'
                 AND detalle LIKE '%«CENTRAL» a «MATRIZ»%'
                 AND registro_id IS NOT NULL);

DELETE FROM registro_cambios
 WHERE modulo = 'Credenciales' AND accion = 'Migración'
   AND detalle LIKE '%«CENTRAL» a «MATRIZ»%';

DELETE FROM migraciones
 WHERE nombre = 'la categoría central de las credenciales ahora es matriz';

COMMIT;
