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
