/**
 * Que hacer con lo que alguien suelta encima de la ventana.
 *
 * Arrastrar una carpeta a Oruka tiene que significar "trabajo aqui". Pero en
 * una ventana se puede soltar cualquier cosa: varios archivos, una mezcla de
 * archivos y carpetas, o algo que ya no existe en disco. Esta parte decide
 * sola, sin tocar el disco ni la pantalla, para poder probarla.
 */

/** El resultado de mirar lo que se ha soltado. */
export interface Soltado {
  /** Las carpetas validas, sin repetir y en el orden en que llegaron. */
  carpetas: string[]
  /**
   * La que se abre en una pestana. Es la primera: soltar cinco carpetas y que
   * se abrieran cinco pestanas de golpe seria una sorpresa desagradable. Las
   * demas quedan en la lista, a un clic.
   */
  aAbrir: string | null
  /** Que decirle al usuario si no habia ninguna carpeta. Vacio si todo fue bien. */
  aviso: string
}

/**
 * Separa las carpetas del resto.
 *
 * `esCarpeta` se recibe de fuera en vez de mirar el disco aqui: asi esta
 * funcion no depende del sistema de archivos y se puede probar con casos
 * inventados.
 */
export function decidirQueAbrir(rutas: string[], esCarpeta: (ruta: string) => boolean): Soltado {
  const carpetas: string[] = []
  for (const ruta of rutas) {
    if (!esCarpeta(ruta)) continue
    if (carpetas.includes(ruta)) continue
    carpetas.push(ruta)
  }

  if (carpetas.length === 0) {
    const aviso =
      rutas.length === 0
        ? 'No se solto nada.'
        : rutas.length === 1
          ? 'Eso no es una carpeta. Arrastra la carpeta del proyecto, no un archivo suelto.'
          : 'Ahi no habia ninguna carpeta. Arrastra la carpeta del proyecto, no archivos sueltos.'
    return { carpetas: [], aAbrir: null, aviso }
  }

  return { carpetas, aAbrir: carpetas[0] ?? null, aviso: '' }
}
