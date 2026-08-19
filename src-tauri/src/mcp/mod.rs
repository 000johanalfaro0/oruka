//! Reparto de servidores MCP a los CLIs.
//!
//! Un MCP en Oruka es un registro independiente del destino; cada CLI tiene su
//! propio formato y este modulo traduce. Nada se escribe sin copia previa,
//! escritura atomica y un diff que el usuario haya podido ver antes.

mod claude_json;
mod codex_toml;
mod opencode_json;
pub mod safe_write;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Un servidor MCP, tal y como lo guarda Oruka.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Variables que el servidor necesita. Oruka escribe la referencia
    /// `${VAR}`, nunca el valor: un token en claro en la config del usuario es
    /// justo lo que no queremos provocar.
    #[serde(rename = "requiresEnv", default)]
    pub requires_env: Vec<String>,
}

/// Como queda un CLI respecto a MCP.
#[derive(Debug, Serialize)]
pub struct CliMcpState {
    pub cli_id: String,
    /// Ruta del archivo que se tocaria, si el CLI soporta MCP.
    pub target: Option<String>,
    /// Ids de los MCP ya configurados ahi.
    pub configured: Vec<String>,
    /// Motivo por el que no se puede gestionar, si aplica.
    pub unsupported: Option<String>,
    /// Si hay una copia de seguridad que se podria restaurar.
    pub has_backup: bool,
}

/// Catalogo de fabrica.
pub fn catalog() -> Vec<McpServer> {
    const SOURCES: [&str; 5] = [
        include_str!("../../../packages/mcp/github.json"),
        include_str!("../../../packages/mcp/context7.json"),
        include_str!("../../../packages/mcp/playwright.json"),
        include_str!("../../../packages/mcp/filesystem.json"),
        include_str!("../../../packages/mcp/memory.json"),
    ];
    SOURCES
        .iter()
        .filter_map(|s| serde_json::from_str::<McpServer>(s).ok())
        .collect()
}

/// Lo que hay que saber de un CLI para escribirle MCP.
enum Target {
    /// Formato `{ "mcpServers": { ... } }`. Lo usan claude y agy.
    McpServersJson(PathBuf),
    CodexToml(PathBuf),
    OpencodeJson(PathBuf),
    Unsupported(&'static str),
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn target_for(cli_id: &str) -> Target {
    match cli_id {
        "claude" => Target::McpServersJson(home().join(".claude.json")),
        "codex" => Target::CodexToml(home().join(".codex").join("config.toml")),
        // agy es la CLI de Antigravity y comparte formato con claude.
        "agy" => Target::McpServersJson(home().join(".gemini").join("config").join("mcp_config.json")),
        "opencode" => Target::OpencodeJson(home().join(".config").join("opencode").join("opencode.jsonc")),
        _ => Target::Unsupported("CLI sin soporte de MCP en Oruka"),
    }
}

/// Estado actual de todos los CLIs.
pub fn state(cli_ids: &[String]) -> Vec<CliMcpState> {
    cli_ids
        .iter()
        .map(|cli_id| match target_for(cli_id) {
            Target::McpServersJson(path) => CliMcpState {
                cli_id: cli_id.clone(),
                configured: claude_json::list(&path),
                has_backup: safe_write::latest_backup(&path).is_some(),
                target: Some(path.to_string_lossy().to_string()),
                unsupported: None,
            },
            Target::OpencodeJson(path) => CliMcpState {
                cli_id: cli_id.clone(),
                configured: opencode_json::list(&path),
                has_backup: safe_write::latest_backup(&path).is_some(),
                target: Some(path.to_string_lossy().to_string()),
                unsupported: None,
            },
            Target::CodexToml(path) => CliMcpState {
                cli_id: cli_id.clone(),
                configured: codex_toml::list(&path),
                has_backup: safe_write::latest_backup(&path).is_some(),
                target: Some(path.to_string_lossy().to_string()),
                unsupported: None,
            },
            Target::Unsupported(reason) => CliMcpState {
                cli_id: cli_id.clone(),
                target: None,
                configured: Vec::new(),
                unsupported: Some(reason.to_string()),
                has_backup: false,
            },
        })
        .collect()
}

/// Diff de lo que pasaria, sin tocar nada.
pub fn preview(cli_id: &str, server: &McpServer, remove: bool) -> Result<String, String> {
    match target_for(cli_id) {
        Target::McpServersJson(path) => claude_json::preview(&path, server, remove),
        Target::CodexToml(path) => codex_toml::preview(&path, server, remove),
        Target::OpencodeJson(path) => opencode_json::preview(&path, server, remove),
        Target::Unsupported(reason) => Err(reason.to_string()),
    }
}

/// Aplica el cambio, siempre con copia previa.
pub fn apply(cli_id: &str, server: &McpServer, remove: bool) -> Result<String, String> {
    let path = match target_for(cli_id) {
        Target::McpServersJson(p) | Target::CodexToml(p) | Target::OpencodeJson(p) => p,
        Target::Unsupported(reason) => return Err(reason.to_string()),
    };

    let backup = safe_write::backup(&path).map_err(|e| format!("no se pudo copiar antes: {e}"))?;

    match target_for(cli_id) {
        Target::McpServersJson(p) => claude_json::apply(&p, server, remove)?,
        Target::CodexToml(p) => codex_toml::apply(&p, server, remove)?,
        Target::OpencodeJson(p) => opencode_json::apply(&p, server, remove)?,
        Target::Unsupported(reason) => return Err(reason.to_string()),
    }

    Ok(backup
        .map(|b| b.to_string_lossy().to_string())
        .unwrap_or_else(|| "archivo creado, no habia nada que copiar".into()))
}

/// Restaura la ultima copia del archivo de ese CLI.
pub fn revert(cli_id: &str) -> Result<String, String> {
    match target_for(cli_id) {
        Target::McpServersJson(p) | Target::CodexToml(p) | Target::OpencodeJson(p) => {
            safe_write::revert(&p).map(|b| b.to_string_lossy().to_string())
        }
        Target::Unsupported(reason) => Err(reason.to_string()),
    }
}
