import type { ComponentType, LazyExoticComponent } from 'react'

/**
 * Contrato de modulo.
 *
 * El shell solo conoce esta forma. No importa nada de workspace, github, ideas
 * ni ajustes: los descubre por el registro. Anadir un modulo es anadir una
 * entrada; quitarlo es borrar la entrada y su carpeta.
 */
export interface OrukaModule {
  /** Identificador estable. Se usa en rutas, ajustes y telemetria. */
  id: string
  /** Nombre visible en la barra de modulos. */
  label: string
  /** Nombre de icono de Codicons, sin el prefijo `codicon-`. */
  icon: string
  /** Vista principal, siempre diferida: un modulo cerrado no pesa. */
  view: LazyExoticComponent<ComponentType>
  /**
   * Tira de pestanas propia del modulo, si la necesita. El shell reserva el
   * hueco y la pinta, pero no sabe que hay dentro: para el son pestanas, no
   * proyectos.
   */
  tabs?: LazyExoticComponent<ComponentType>
  /** Lo que el modulo aporta a la barra de estado, si aporta algo. */
  statusBar?: ComponentType
  /** Comandos que el modulo expone a la paleta y a los atajos. */
  commands?: ModuleCommand[]
  /** Feature flag. Si devuelve false el modulo no se registra ni se carga. */
  enabled?: () => boolean
  /**
   * Lado de la barra donde vive. Ajustes va a la derecha, separado del trabajo
   * diario, para que no compita con los modulos que se usan a todas horas.
   */
  align?: 'left' | 'right'
  /** Solo icono, sin etiqueta. Para entradas secundarias como Ajustes. */
  iconOnly?: boolean
}

export interface ModuleCommand {
  id: string
  title: string
  keybinding?: string
  run: () => void | Promise<void>
}
