//! Puertos: lo que Oruka necesita del sistema, expresado como traits.
//!
//! Se definen ya para fijar la frontera, aunque sus implementaciones lleguen en
//! hitos posteriores. Ningun comando del front habla con procesos, ficheros de
//! configuracion ni con la red directamente: siempre a traves de uno de estos.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Lanza un agente CLI dentro de un PTY. Implementacion en M1 con portable-pty.
pub trait AgentLauncher {
    type Session;
    fn spawn(&self, program: &str, args: &[String], cwd: &Path) -> std::io::Result<Self::Session>;
}

/// Escribe la configuracion de un MCP en el formato que entiende cada CLI.
/// Implementaciones en M4: claude (JSON), codex (TOML), opencode (JSON).
pub trait McpWriter {
    /// Ruta del fichero de configuracion que gestiona este escritor.
    fn target(&self) -> PathBuf;
    /// Diff que produciria aplicar el cambio, para ensenarlo antes de escribir.
    fn preview(&self, server: &McpServer) -> std::io::Result<String>;
    /// Aplica el cambio. Obligatorio: backup previo y escritura atomica.
    fn apply(&self, server: &McpServer) -> std::io::Result<()>;
    /// Restaura el ultimo backup.
    fn revert(&self) -> std::io::Result<()>;
}

/// Un servidor MCP tal y como lo guarda Oruka, independiente del CLI destino.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Acceso a GitHub. Implementaciones en M2: `gh` y, como respaldo, API REST.
pub trait GitHubProvider {
    fn is_available(&self) -> bool;
}

/// Persistencia local de proyectos, layout y preferencias.
pub trait Store {
    fn read(&self, key: &str) -> std::io::Result<Option<String>>;
    fn write(&self, key: &str, value: &str) -> std::io::Result<()>;
}
