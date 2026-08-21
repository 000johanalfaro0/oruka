//! Escritor para `~/.codex/config.toml`.
//!
//! Se usa `toml_edit`, que conserva comentarios, orden y formato. Reescribir el
//! TOML desde cero borraria las notas del usuario, y esa config ya trae varios
//! servidores suyos que no son nuestros.

use super::safe_write;
use super::McpServer;
use std::path::Path;
use toml_edit::{Array, DocumentMut, Item, Table, Value as TomlValue};

const TABLE: &str = "mcp_servers";

fn read(path: &Path) -> DocumentMut {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| s.parse::<DocumentMut>().ok())
        .unwrap_or_default()
}

/// Ids de los MCP ya configurados.
pub fn list(path: &Path) -> Vec<String> {
    read(path)
        .get(TABLE)
        .and_then(|item| item.as_table())
        .map(|t| t.iter().map(|(k, _)| k.to_string()).collect())
        .unwrap_or_default()
}

fn render(path: &Path, server: &McpServer, remove: bool) -> Result<String, String> {
    let mut doc = read(path);

    if remove {
        if let Some(table) = doc.get_mut(TABLE).and_then(|i| i.as_table_mut()) {
            table.remove(&server.id);
        }
        return Ok(doc.to_string());
    }

    // La tabla raiz se crea como tabla normal si no existe.
    if doc.get(TABLE).is_none() {
        let mut root = Table::new();
        root.set_implicit(true);
        doc[TABLE] = Item::Table(root);
    }

    let root = doc
        .get_mut(TABLE)
        .and_then(|i| i.as_table_mut())
        .ok_or("mcp_servers no es una tabla")?;
    root.set_implicit(true);

    let mut entry = Table::new();
    entry["command"] = toml_edit::value(super::resolve_command(&server.command));

    let mut args = Array::new();
    for a in &server.args {
        args.push(a.as_str());
    }
    entry["args"] = Item::Value(TomlValue::Array(args));

    if !server.requires_env.is_empty() {
        let mut env = Table::new();
        for var in &server.requires_env {
            // Referencia, nunca el valor.
            env[var.as_str()] = toml_edit::value(format!("${{{var}}}"));
        }
        entry["env"] = Item::Table(env);
    }

    root[server.id.as_str()] = Item::Table(entry);
    Ok(doc.to_string())
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

    fn server(id: &str) -> McpServer {
        McpServer {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            command: "npx".into(),
            args: vec!["-y".into(), format!("@scope/{id}")],
            requires_env: Vec::new(),
        }
    }

    fn temp(name: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("oruka-ct-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, contents).unwrap();
        p
    }

    #[test]
    fn conserva_comentarios_y_servidores_existentes() {
        // Reproduce la forma de la config real: comentarios y varios servidores.
        let original = "# MCP servers\napproval_policy = \"never\"\n\n[mcp_servers.context7]\ncommand = \"npx\"\nargs = [\"-y\", \"@upstash/context7-mcp@latest\"]\n";
        let path = temp("config.toml", original);

        apply(&path, &server("playwright"), false).unwrap();
        let after = std::fs::read_to_string(&path).unwrap();

        assert!(after.contains("# MCP servers"), "se perdio el comentario");
        assert!(after.contains("approval_policy"), "se perdio otra clave");
        assert!(after.contains("context7"), "se perdio un servidor del usuario");
        assert!(after.contains("playwright"), "no se anadio el nuevo");
    }

    #[test]
    fn actualizar_uno_existente_no_lo_duplica() {
        let original = "[mcp_servers.github]\ncommand = \"npx\"\nargs = [\"-y\", \"viejo\"]\n";
        let path = temp("config2.toml", original);

        apply(&path, &server("github"), false).unwrap();

        let ids = list(&path);
        assert_eq!(ids, vec!["github"], "no puede quedar duplicado");
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("@scope/github"), "deberia haberse actualizado");
        assert!(!after.contains("viejo"), "no deberia quedar el valor anterior");
    }

    #[test]
    fn quitar_deja_intacto_lo_demas() {
        let original = "[mcp_servers.a]\ncommand = \"x\"\n\n[mcp_servers.b]\ncommand = \"y\"\n";
        let path = temp("config3.toml", original);

        apply(&path, &server("a"), true).unwrap();
        assert_eq!(list(&path), vec!["b"]);
    }
}
