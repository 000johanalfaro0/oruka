//! Escritor para `~/.config/opencode/opencode.jsonc`.
//!
//! opencode usa una forma propia: la clave es `mcp`, el tipo va explicito y el
//! comando es un unico array con el binario y sus argumentos juntos.

use super::safe_write;
use super::McpServer;
use serde_json::{Map, Value};
use std::path::Path;

const KEY: &str = "mcp";

/// El archivo admite comentarios (JSONC). Si los tiene, `serde_json` no puede
/// leerlo y preferimos negarnos antes que reescribirlo perdiendolos.
fn read(path: &Path) -> Result<Value, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(Value::Object(Map::new()));
    };
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&text).map_err(|_| {
        "opencode.jsonc tiene comentarios y Oruka todavia no sabe conservarlos; \
         usa `opencode mcp add` o quita los comentarios"
            .to_string()
    })
}

pub fn list(path: &Path) -> Vec<String> {
    read(path)
        .ok()
        .and_then(|v| v.get(KEY).and_then(|m| m.as_object()).cloned())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default()
}

fn entry(server: &McpServer) -> Value {
    let mut obj = Map::new();
    obj.insert("type".into(), Value::String("local".into()));

    // opencode junta binario y argumentos en un solo array.
    let mut command = vec![Value::String(super::resolve_command(&server.command))];
    command.extend(server.args.iter().cloned().map(Value::String));
    obj.insert("command".into(), Value::Array(command));

    obj.insert("enabled".into(), Value::Bool(true));

    if !server.requires_env.is_empty() {
        let mut env = Map::new();
        for var in &server.requires_env {
            env.insert(var.clone(), Value::String(format!("${{{var}}}")));
        }
        obj.insert("environment".into(), Value::Object(env));
    }
    Value::Object(obj)
}

fn render(path: &Path, server: &McpServer, remove: bool) -> Result<String, String> {
    let mut root = read(path)?;
    let obj = root
        .as_object_mut()
        .ok_or("el archivo no es un objeto JSON valido")?;

    // Sin esquema el editor pierde el autocompletado, asi que se conserva.
    obj.entry("$schema".to_string())
        .or_insert_with(|| Value::String("https://opencode.ai/config.json".into()));

    let servers = obj
        .entry(KEY.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("la clave mcp no es un objeto")?;

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

    fn server() -> McpServer {
        McpServer {
            id: "github".into(),
            name: "GitHub".into(),
            description: String::new(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
            requires_env: vec!["GITHUB_PERSONAL_ACCESS_TOKEN".into()],
        }
    }

    fn temp(name: &str, contents: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("oruka-oc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, contents).unwrap();
        p
    }

    #[test]
    fn usa_la_forma_de_opencode() {
        let path = temp("oc1.jsonc", "{\"$schema\":\"https://opencode.ai/config.json\"}");
        apply(&path, &server(), false).unwrap();

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let entry = &v["mcp"]["github"];
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["command"][0], "npx", "binario y args van en un solo array");
        assert_eq!(entry["command"][2], "@modelcontextprotocol/server-github");
        assert_eq!(entry["enabled"], true);
        assert_eq!(v["$schema"], "https://opencode.ai/config.json");
    }

    #[test]
    fn tampoco_escribe_el_secreto() {
        let path = temp("oc2.jsonc", "{}");
        apply(&path, &server(), false).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("${GITHUB_PERSONAL_ACCESS_TOKEN}"));
    }

    #[test]
    fn se_niega_a_tocar_un_jsonc_con_comentarios() {
        // Reescribirlo perderia los comentarios del usuario: mejor negarse.
        let path = temp("oc3.jsonc", "{\n  // mi nota\n  \"mcp\": {}\n}");
        let err = apply(&path, &server(), false).unwrap_err();
        assert!(err.contains("comentarios"), "deberia avisar del motivo: {err}");
        assert!(
            std::fs::read_to_string(&path).unwrap().contains("// mi nota"),
            "el archivo no puede haberse tocado"
        );
    }
}
