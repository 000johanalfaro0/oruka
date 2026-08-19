/**
 * Utilidades de rutas compartidas.
 *
 * Vive fuera de `modules/` a proposito: es capa comun, no un modulo, asi que
 * cualquiera puede importarla sin romper la frontera entre modulos.
 */

const SEPARATOR = /[/\\]/

/** Ultimo segmento de una ruta, sirva de Windows o de POSIX. */
export function baseName(path: string): string {
  const parts = path.split(SEPARATOR).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
