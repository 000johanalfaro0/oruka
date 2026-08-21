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

/**
 * Un servidor que no puede arrancar porque le falta su programa base.
 *
 * Repartir uno asi seria peor que no ofrecerlo: quedaria escrito en la config
 * del CLI y el usuario creeria tenerlo, cuando en realidad falla al arrancar.
 */
export interface MissingRequirement {
  server_id: string
  name: string
  bin: string
  url: string
  /** Si Oruka sabe instalarlo en este sistema, o solo puede enseñar la web. */
  installable: boolean
}

export const mcpMissing = () => invoke<MissingRequirement[]>('mcp_missing')

export const mcpInstallRequirement = (serverId: string) =>
  invoke<string>('mcp_install_requirement', { serverId })

export const mcpState = (cliIds: string[]) => invoke<CliMcpState[]>('mcp_state', { cliIds })

/** Diff de lo que pasaria. No escribe nada. */
export const mcpPreview = (cliId: string, server: McpServer, remove: boolean) =>
  invoke<string>('mcp_preview', { cliId, server, remove })

/** Aplica el cambio. Devuelve la ruta de la copia de seguridad. */
export const mcpApply = (cliId: string, server: McpServer, remove: boolean) =>
  invoke<string>('mcp_apply', { cliId, server, remove })

export const mcpRevert = (cliId: string) => invoke<string>('mcp_revert', { cliId })
