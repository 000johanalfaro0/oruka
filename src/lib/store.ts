import { invoke } from '@tauri-apps/api/core'

/**
 * Lo que Oruka recuerda entre arranques.
 *
 * Antes esto vivia en `localStorage`, y eso resulto ser un error: el navegador
 * indexa ese almacen **por origen**, y el origen de Oruka cambia segun como se
 * sirva el front (`http://localhost:1420` en desarrollo,
 * `http://tauri.localhost` en la app empaquetada). La consecuencia era que
 * abrir la version instalada pedia la sesion otra vez, repetia el Quick Setup y
 * perdia las carpetas de trabajo: no se habian borrado, es que estaban en otro
 * cajon.
 *
 * Ahora va a un archivo en el directorio de datos de la app, que no sabe nada
 * de origenes.
 */

export const storeGet = (key: string) => invoke<string | null>('store_get', { key })

export const storeSet = (key: string, value: string) => invoke<void>('store_set', { key, value })

export const storeRemove = (key: string) => invoke<void>('store_remove', { key })

/** Claves que se rescatan del navegador si vienen de una version anterior. */
const HEREDABLES = ['oruka.setup.done', 'oruka.lastActive', 'oruka.workspace']

/**
 * Sube a disco lo que quedara guardado en el navegador.
 *
 * Se ejecuta una vez al arrancar y no pisa nada: si una clave ya esta en disco,
 * gana la de disco, porque es la reciente. Las de Supabase se reconocen por su
 * prefijo, que lleva el id del proyecto y no se puede escribir a mano aqui.
 *
 * Es deliberadamente silenciosa: si falla, la app sigue y como mucho hay que
 * volver a entrar. No es motivo para no arrancar.
 */
export async function migrateFromBrowser(): Promise<void> {
  try {
    const entries: Array<[string, string]> = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const esDeSupabase = key.startsWith('sb-') && key.includes('auth-token')
      if (!HEREDABLES.includes(key) && !esDeSupabase) continue
      const value = localStorage.getItem(key)
      if (value !== null) entries.push([key, value])
    }
    if (entries.length === 0) return
    await invoke<number>('store_seed', { entries })
  } catch {
    // Sin drama: se entra otra vez y ya.
  }
}

/**
 * El almacen que se le pasa a Supabase para que guarde ahi su sesion.
 *
 * Supabase admite un almacen asincrono, que es justo lo que hace falta: al otro
 * lado hay un archivo, no memoria.
 */
export const tauriStorage = {
  getItem: (key: string) => storeGet(key),
  setItem: (key: string, value: string) => storeSet(key, value),
  removeItem: (key: string) => storeRemove(key),
}
