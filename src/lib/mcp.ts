import { invoke } from '@tauri-apps/api/core'

/** Un servidor MCP, independiente del CLI destino. */
export interface McpServer {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  requiresEnv: string[]
}

/** Como esta un CLI respecto a MCP. */
export interface CliMcpState {
  cli_id: string
  target: string | null
  configured: string[]
  unsupported: string | null
  has_backup: boolean
}

export const mcpCatalog = () => invoke<McpServer[]>('mcp_catalog')

export const mcpState = (cliIds: string[]) => invoke<CliMcpState[]>('mcp_state', { cliIds })

/** Diff de lo que pasaria. No escribe nada. */
export const mcpPreview = (cliId: string, server: McpServer, remove: boolean) =>
  invoke<string>('mcp_preview', { cliId, server, remove })

/** Aplica el cambio. Devuelve la ruta de la copia de seguridad. */
export const mcpApply = (cliId: string, server: McpServer, remove: boolean) =>
  invoke<string>('mcp_apply', { cliId, server, remove })

export const mcpRevert = (cliId: string) => invoke<string>('mcp_revert', { cliId })
