import { storeGet, storeSet } from './store'

/**
 * Aviso sonoro cuando un agente termina de trabajar.
 *
 * Apagado por defecto: un sonido que nadie pidio la primera vez que se abre
 * la app seria una sorpresa desagradable. Se activa a proposito, desde
 * Ajustes.
 */

const STORAGE_KEY = 'oruka.notifications.sound'

export async function loadSoundSetting(): Promise<boolean> {
  try {
    const raw = await storeGet(STORAGE_KEY)
    return raw === '1'
  } catch {
    return false
  }
}

export const saveSoundSetting = (enabled: boolean) => storeSet(STORAGE_KEY, enabled ? '1' : '0')

let audio: HTMLAudioElement | null = null

/**
 * Reproduce el aviso si el ajuste esta activo.
 *
 * Silenciosa a proposito: un agente que termina no puede acabar en un error
 * en consola por culpa de un archivo de audio.
 */
export async function playFinishedSound(): Promise<void> {
  const enabled = await loadSoundSetting()
  if (!enabled) return
  try {
    if (!audio) audio = new Audio(new URL('../assets/agent-done.wav', import.meta.url).href)
    audio.currentTime = 0
    await audio.play()
  } catch {
    // Sin drama: el navegador puede bloquear audio sin interaccion previa.
  }
}
