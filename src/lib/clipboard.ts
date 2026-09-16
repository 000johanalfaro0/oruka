import { invoke } from '@tauri-apps/api/core'

/**
 * Lee texto del portapapeles de forma nativa a través del backend de Oruka,
 * evitando los cuadros de diálogo de permisos de navegador de WebView2.
 */
export async function readClipboard(): Promise<string> {
  try {
    return await invoke<string>('clipboard_read')
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

/**
 * Escribe texto en el portapapeles de forma nativa a través del backend de Oruka.
 */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await invoke('clipboard_write', { text })
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Ignorar fallos si el portapapeles está bloqueado
    }
  }
}

/**
 * La imagen del portapapeles, guardada en disco, o cadena vacia si no hay.
 *
 * Una terminal solo entiende texto, pero los agentes de IA saben abrir una
 * imagen si les das su ruta. Por eso "pegar una imagen" en Oruka significa:
 * guardarla en la carpeta temporal y escribir su ruta.
 */
export async function readClipboardImagePath(): Promise<string> {
  try {
    return (await invoke<string | null>('clipboard_read_image')) ?? ''
  } catch {
    return ''
  }
}

/**
 * Una ruta lista para escribirla en la linea de comandos.
 *
 * Si lleva espacios va entre comillas; si no, el agente leeria solo el primer
 * trozo y no encontraria el archivo. Acaba en espacio para poder seguir
 * escribiendo detras.
 */
export function rutaParaTerminal(ruta: string): string {
  return (ruta.includes(' ') ? `"${ruta}"` : ruta) + ' '
}

/**
 * Lo que hay que escribir en una terminal al pegar: texto, o la ruta de una
 * imagen. Cadena vacia si el portapapeles no trae nada util.
 *
 * El texto va primero a proposito. Al copiar de una hoja de calculo o de un
 * documento, el sistema deja a la vez el texto y una foto de lo copiado; si se
 * mirara la imagen antes, pegar texto normal meteria la ruta de un PNG en vez
 * de lo que copiaste.
 */
export async function contenidoParaPegar(): Promise<string> {
  const texto = await readClipboard().catch(() => '')
  if (texto) return texto
  const imagen = await readClipboardImagePath().catch(() => '')
  return imagen ? rutaParaTerminal(imagen) : ''
}
