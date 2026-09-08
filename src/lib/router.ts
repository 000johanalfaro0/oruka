import { invoke } from '@tauri-apps/api/core'

/**
 * Puente con el servicio 9Router.
 *
 * No es un CLI: es un servidor de fondo con su propio panel web. Estos cuatro
 * comandos son todo lo que Oruka sabe hacer con el -instalar, prender, apagar,
 * preguntar como esta- y nada mas. Configurar proveedores pasa por su panel,
 * no por aqui.
 */
export interface RouterStatus {
  installed: boolean
  running: boolean
  port: number | null
  log: string[]
}

export const routerStatus = () => invoke<RouterStatus>('router_status')

export const routerInstall = () => invoke<string>('router_install')

/** Arranca el servicio. Devuelve la contraseña inicial del panel. */
export const routerStart = () => invoke<string>('router_start')

export const routerStop = () => invoke<void>('router_stop')

export const routerOpenPanel = () => invoke<void>('router_open_panel')
