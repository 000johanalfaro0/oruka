import { lazy } from 'react'
import type { OrukaModule } from '@/types/module'

/**
 * Registro de modulos.
 *
 * Este es el unico sitio del codigo donde el shell nombra a los modulos, y solo
 * para importarlos de forma diferida. Todo lo demas pasa por el contrato.
 */
const modules: OrukaModule[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'terminal',
    view: lazy(() => import('@/modules/workspace')),
    tabs: lazy(() => import('@/modules/workspace/Tabs')),
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: 'github',
    view: lazy(() => import('@/modules/github')),
  },
  {
    id: 'ideas',
    label: 'Ideas',
    icon: 'lightbulb',
    view: lazy(() => import('@/modules/ideas')),
    // Desactivar este modulo debe dejar la app en pie y sin cargar Supabase.
    enabled: () => import.meta.env.VITE_ORUKA_IDEAS !== 'off',
  },
  {
    id: 'settings',
    label: 'Ajustes',
    icon: 'settings-gear',
    view: lazy(() => import('@/modules/settings')),
    align: 'right',
    iconOnly: true,
  },
]

/** Modulos activos, ya filtrados por sus feature flags. */
export const activeModules: OrukaModule[] = modules.filter(
  (m) => m.enabled?.() ?? true,
)

export function findModule(id: string): OrukaModule | undefined {
  return activeModules.find((m) => m.id === id)
}
