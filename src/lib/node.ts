import { invoke } from '@tauri-apps/api/core'

export interface NodeStatus {
  installed: boolean
  version: string | null
}

export const nodeStatus = () => invoke<NodeStatus>('node_status')
export const nodeInstall = () => invoke<string>('node_install')
