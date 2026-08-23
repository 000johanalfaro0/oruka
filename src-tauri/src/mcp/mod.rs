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
    /// El programa que este servidor necesita para arrancar, si no es `npx`.
    ///
    /// Casi todo el catalogo va con `npx`, que viene con Node y siempre esta.
    /// Pero uno puede necesitar otra cosa —Browser Use necesita `uv`— y sin
    /// ella el reparto escribe una configuracion que no arranca nunca. Peor que
    /// no repartirlo: el usuario cree que lo tiene.
    #[serde(default)]
    pub requires: Option<Requires>,
}

/// De que depende un servidor para poder arrancar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Requires {
    /// El ejecutable que tiene que estar en el PATH.
    pub bin: String,
    /// Como se llama para una persona.
    pub name: String,
    /// Id del paquete en cada gestor. Sin el, solo queda enseñar la web.
    #[serde(default)]
    pub winget: Option<String>,
    #[serde(default)]
    pub brew: Option<String>,
    pub url: String,
}

/// Si a un servidor le falta su programa base en este equipo.
///
/// Se mira el PATH, que es la unica verdad: que el JSON lo declare no significa
/// que este instalado.
#[derive(Debug, Serialize)]
pub struct MissingRequirement {
    pub server_id: String,
    pub name: String,
    pub bin: String,
    pub url: String,
    /// Si Oruka sabe instalarlo en este sistema.
    pub installable: bool,
}

/// Lo que le falta al catalogo para funcionar en este equipo.
pub fn missing() -> Vec<MissingRequirement> {
    catalog()
        .into_iter()
        .filter_map(|s| {
            let r = s.requires?;
            if crate::registry::resolve_bin(&r.bin).is_some() {
                return None;
            }
            let installable = if cfg!(windows) {
                r.winget.is_some()
            } else if cfg!(target_os = "macos") {
                r.brew.is_some()
            } else {
                false
            };
            Some(MissingRequirement {
                server_id: s.id,
                name: r.name,
                bin: r.bin,
                url: r.url,
                installable,
            })
        })
        .collect()
}

/// Instala el programa base que le falta a un servidor.
pub fn install_requirement(server_id: &str) -> Result<String, String> {
    let s = catalog()
        .into_iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| format!("no hay ningun servidor {server_id}"))?;
    let r = s
        .requires
        .ok_or_else(|| format!("{} no depende de nada que instalar", s.name))?;

    let (bin, args): (&str, Vec<String>) = if cfg!(windows) {
        let id = r.winget.ok_or_else(|| {
            format!("{} hay que instalarlo a mano: {}", r.name, r.url)
        })?;
        (
            "winget",
            vec![
                "install".into(),
                "--id".into(),
                id,
                "-e".into(),
                "--accept-source-agreements".into(),
                "--accept-package-agreements".into(),
            ],
        )
    } else if cfg!(target_os = "macos") {
        let id = r.brew.ok_or_else(|| {
            format!("{} hay que instalarlo a mano: {}", r.name, r.url)
        })?;
        ("brew", vec!["install".into(), id])
    } else {
        return Err(format!("{} hay que instalarlo a mano: {}", r.name, r.url));
    };

    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(bin);
        c
    } else {
        std::process::Command::new(bin)
    };
    cmd.args(&args);
    crate::registry::hide_console(&mut cmd);

    let salida = cmd
        .output()
        .map_err(|e| format!("no se pudo lanzar {bin}: {e}"))?;
    let texto = format!(
        "{}{}",
        String::from_utf8_lossy(&salida.stdout),
        String::from_utf8_lossy(&salida.stderr)
    );
    if salida.status.success() {
        Ok(texto)
    } else {
        Err(if texto.trim().is_empty() {
            format!("fallo con codigo {:?}", salida.status.code())
        } else {
            texto
        })
    }
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
    const SOURCES: [&str; 7] = [
        include_str!("../../../packages/mcp/github.json"),
        include_str!("../../../packages/mcp/context7.json"),
        include_str!("../../../packages/mcp/browser-harness.json"),
        include_str!("../../../packages/mcp/playwright.json"),
        include_str!("../../../packages/mcp/filesystem.json"),
        include_str!("../../../packages/mcp/memory.json"),
        include_str!("../../../packages/mcp/pencil.json"),
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

/// El sufijo del binario de este sistema, como lo nombran quienes publican uno
/// por plataforma.
fn platform_suffix() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "aarch64") => "-windows-arm64.exe",
        ("windows", _) => "-windows-x64.exe",
        ("macos", "aarch64") => "-darwin-arm64",
        ("macos", _) => "-darwin-x64",
        ("linux", "aarch64") => "-linux-arm64",
        ("linux", _) => "-linux-x64",
        _ => "",
    }
}

/// Resuelve un comando que depende de la maquina.
///
/// Casi todo el catalogo se lanza con `npx` y no necesita nada de esto. Pero un
/// servidor puede venir **dentro de otra aplicacion**, y entonces su ruta lleva
/// la carpeta del usuario, la version instalada y el binario de su sistema. Eso
/// no se puede escribir en el catalogo: es un archivo del repositorio y viaja a
/// otras maquinas.
///
/// Tres marcas, ninguna atada a un servidor concreto:
///
/// - `~` al principio: la carpeta del usuario.
/// - `{platform}`: el sufijo del binario de este sistema.
/// - `*` en un tramo: se queda con la ultima coincidencia por orden
///   alfabetico, que en una carpeta de versiones es la mas nueva.
///
/// Si no hay ninguna coincidencia se devuelve lo que habia. Escribir una ruta
/// a medio resolver seria peor: el usuario ve en el diff que no cuadra y no
/// aplica, en vez de creerse que quedo bien.
pub fn resolve_command(raw: &str) -> String {
    let con_home = match raw.strip_prefix("~/") {
        Some(resto) => home().join(resto).to_string_lossy().replace('\\', "/"),
        None => raw.to_string(),
    };
    let con_plataforma = con_home.replace("{platform}", platform_suffix());
    if !con_plataforma.contains('*') {
        return con_plataforma;
    }

    // El tramo con el comodin parte la ruta en tres: lo de antes (una carpeta
    // que existe), el patron, y lo de despues.
    let partes: Vec<&str> = con_plataforma.split('/').collect();
    let Some(i) = partes.iter().position(|t| t.contains('*')) else {
        return con_plataforma;
    };
    let base: PathBuf = partes[..i].join("/").into();
    let (pre, post) = match partes[i].split_once('*') {
        Some(par) => par,
        None => return con_plataforma,
    };

    let Ok(entradas) = std::fs::read_dir(&base) else {
        return con_plataforma;
    };
    let mut nombres: Vec<String> = entradas
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            (n.starts_with(pre) && n.ends_with(post) && n.len() >= pre.len() + post.len())
                .then_some(n)
        })
        .collect();
    nombres.sort();
    match nombres.pop() {
        Some(elegido) => {
            let mut ruta = base.join(elegido);
            for tramo in &partes[i + 1..] {
                ruta = ruta.join(tramo);
            }
            ruta.to_string_lossy().replace('\\', "/")
        }
        None => con_plataforma,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quien_necesita_algo_lo_declara_y_quien_no_no() {
        // La mayoria va con npx, que viene con Node y siempre esta. Declarar
        // una dependencia que no existe llenaria la pantalla de avisos falsos.
        let cat = catalog();
        for s in &cat {
            if let Some(r) = &s.requires {
                assert!(!r.bin.is_empty(), "{} declara una dependencia sin binario", s.id);
                assert!(r.url.starts_with("http"), "{} necesita una web donde mirar", s.id);
            }
            if s.command == "npx" {
                assert!(s.requires.is_none(), "{} va con npx y no necesita nada", s.id);
            }
        }
    }

    #[test]
    fn solo_falta_lo_que_no_esta_en_el_path() {
        // missing() mira el PATH de verdad. Lo que se comprueba aqui es que no
        // se cuela nada que si este instalado: un aviso falso hace que el
        // usuario deje de leerlos.
        for m in missing() {
            assert!(
                crate::registry::resolve_bin(&m.bin).is_none(),
                "{} dice faltar pero esta en el PATH",
                m.bin
            );
        }
    }

    #[test]
    fn un_comando_normal_no_se_toca() {
        // Casi todo el catalogo es `npx`: si esto cambiara algo, la resolucion
        // estaria metiendose donde no la llaman.
        assert_eq!(resolve_command("npx"), "npx");
        assert_eq!(resolve_command("/usr/bin/algo"), "/usr/bin/algo");
    }

    #[test]
    fn la_virgulilla_se_convierte_en_la_carpeta_del_usuario() {
        let salida = resolve_command("~/cosa");
        assert!(!salida.starts_with('~'), "quedo sin resolver: {salida}");
        assert!(salida.ends_with("/cosa"));
    }

    #[test]
    fn el_comodin_elige_la_version_mas_nueva() {
        let dir = std::env::temp_dir().join(format!(
            "oruka-cmd-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for v in ["app-0.6.9", "app-0.6.67", "app-0.7.1"] {
            std::fs::create_dir_all(dir.join(v).join("out")).unwrap();
        }
        let patron = format!("{}/app-*/out/bin", dir.to_string_lossy().replace('\\', "/"));
        let salida = resolve_command(&patron);
        assert!(salida.contains("app-0.7.1"), "eligio mal: {salida}");
        assert!(!salida.contains('*'));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sin_coincidencia_se_devuelve_lo_que_habia() {
        // Escribir una ruta a medio resolver seria peor: asi el usuario ve en
        // el diff que no cuadra y no aplica.
        let patron = "/no/existe/nada-*/bin";
        assert_eq!(resolve_command(patron), patron);
    }

    #[test]
    fn la_plataforma_se_sustituye_por_la_de_este_sistema() {
        let salida = resolve_command("/x/mcp-server{platform}");
        assert!(!salida.contains("{platform}"), "quedo sin sustituir");
        assert!(salida.starts_with("/x/mcp-server"));
    }

    #[test]
    fn la_ficha_de_pencil_resuelve_en_esta_maquina() {
        // Si Pencil no esta instalado, la ruta se queda con el comodin y la
        // interfaz lo ensena tal cual. Lo que no puede pasar es que se cuele
        // media ruta como si fuera buena.
        let p = catalog()
            .into_iter()
            .find(|s| s.id == "pencil")
            .expect("pencil deberia estar en el catalogo");
        let salida = resolve_command(&p.command);
        assert!(!salida.contains("{platform}"));
        assert!(
            !salida.contains('*') || !std::path::Path::new(&salida).exists(),
            "resolvio a algo que no existe"
        );
    }
}
