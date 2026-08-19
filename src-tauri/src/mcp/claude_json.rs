//! Escritor para `~/.claude.json`.
//!
//! Ese archivo guarda mucho mas que MCP: historial, proyectos y estado de
//! sesion. Se toca **solo** la clave `mcpServers` y se conserva el orden del
//! resto tal cual estaba.

use super::safe_write;
use super::McpServer;
use serde_json::{Map, Value};
use std::path::Path;

const KEY: &str = "mcpServers";

fn read(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Value::Object(Map::new()))
}

/// Ids de los MCP ya configurados.
pub fn list(path: &Path) -> Vec<String> {
    read(path)
        .get(KEY)
        .and_then(|v| v.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default()
}

/// Como quedaria el fragmento de este servidor.
fn entry(server: &McpServer) -> Value {
    let mut obj = Map::new();
    obj.insert("command".into(), Value::String(server.command.clone()));
    obj.insert(
        "args".into(),
        Value::Array(server.args.iter().cloned().map(Value::String).collect()),
    );
    if !server.requires_env.is_empty() {
        let mut env = Map::new();
        for var in &server.requires_env {
            // Referencia, nunca el valor.
            env.insert(var.clone(), Value::String(format!("${{{var}}}")));
        }
        obj.insert("env".into(), Value::Object(env));
    }
    Value::Object(obj)
}

fn render(path: &Path, server: &McpServer, remove: bool) -> Result<String, String> {
    let mut root = read(path);
    let obj = root
        .as_object_mut()
        .ok_or("el archivo no es un objeto JSON valido")?;

    let servers = obj
        .entry(KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("la clave mcpServers no es un objeto")?;

    if remove {
        servers.remove(&server.id);
    } else {
        servers.insert(server.id.clone(), entry(server));
    }

    serde_json::to_string_pretty(&root).map_err(|e| e.to_string())
}

pub fn preview(path: &Path, server: &McpServer, remove: bool) -> Result<String, String> {
    let before = std::fs::read_to_string(path).unwrap_or_default();
    let after = render(path, server, remove)?;
    let label = path.file_name().unwrap_or_default().to_string_lossy();
    Ok(safe_write::diff(&before, &after, &label))
}

pub fn apply(path: &Path, server: &McpServer, remove: bool) -> Result<(), String> {
    let after = render(path, server, remove)?;
    safe_write::write_atomic(path, &after).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_server() -> McpServer {
        McpServer {
            id: "github".into(),
            name: "GitHub".into(),
            description: String::new(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
            requires_env: vec!["GITHUB_PERSONAL_ACCESS_TOKEN".into()],
        }
    }

    fn temp_file(name: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("oruka-cj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, contents).unwrap();
        p
    }

    #[test]
    fn conserva_el_resto_del_archivo() {
        // Simula un .claude.json con estado del usuario alrededor.
        let path = temp_file(
            "claude.json",
            "{\"numStartups\":42,\"projects\":{\"a\":1},\"userID\":\"xyz\"}",
        );
        apply(&path, &sample_server(), false).unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["numStartups"], 42, "no puede perder claves del usuario");
        assert_eq!(after["projects"]["a"], 1);
        assert_eq!(after["userID"], "xyz");
        assert_eq!(after["mcpServers"]["github"]["command"], "npx");
    }

    #[test]
    fn no_escribe_el_secreto_solo_la_referencia() {
        let path = temp_file("claude2.json", "{}");
        apply(&path, &sample_server(), false).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains("${GITHUB_PERSONAL_ACCESS_TOKEN}"),
            "deberia dejar la referencia a la variable"
        );
    }

    #[test]
    fn aplicar_dos_veces_no_duplica() {
        let path = temp_file("claude3.json", "{}");
        apply(&path, &sample_server(), false).unwrap();
        apply(&path, &sample_server(), false).unwrap();
        assert_eq!(list(&path), vec!["github"], "no puede duplicar la entrada");
    }

    #[test]
    fn puede_quitar_lo_que_puso() {
        let path = temp_file("claude4.json", "{}");
        apply(&path, &sample_server(), false).unwrap();
        apply(&path, &sample_server(), true).unwrap();
        assert!(list(&path).is_empty());
    }
}
