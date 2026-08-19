import { create } from 'zustand'
import { activeModules } from './moduleRegistry'

interface ShellState {
  activeModuleId: string
  setActiveModule: (id: string) => void
}

export const useShellStore = create<ShellState>((set) => ({
  activeModuleId: activeModules[0]?.id ?? '',
  setActiveModule: (id) => set({ activeModuleId: id }),
}))
