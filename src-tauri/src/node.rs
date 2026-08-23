//! Detección e instalación de Node.js / npm.
//!
//! Varios CLIs de IA (Claude Code, Codex CLI) se instalan a través de `npm install -g`,
//! y la mayoría de servidores MCP usan `npx`.
//! Si una máquina no tiene Node.js instalado, Oruka detecta la ausencia y ofrece
//! instalar Node.js LTS mediante el gestor del sistema (winget en Windows, brew en macOS).

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize, Default, PartialEq, Eq)]
pub struct NodeStatus {
    /// Si node o npm están disponibles en el PATH.
    pub installed: bool,
    /// Versión de Node o npm detectada.
    pub version: Option<String>,
}

/// Comprueba si node / npm están en el PATH del sistema.
pub fn status() -> NodeStatus {
    let bin = crate::registry::resolve_bin("node").or_else(|| crate::registry::resolve_bin("npm"));
    let Some(bin) = bin else {
        return NodeStatus {
            installed: false,
            version: None,
        };
    };

    let is_script = bin
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);

    let mut cmd = if cfg!(windows) && is_script {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&bin);
        c
    } else {
        Command::new(&bin)
    };
    cmd.arg("--version");
    crate::registry::hide_console(&mut cmd);

    let version = cmd.output().ok().and_then(|out| {
        let txt = String::from_utf8_lossy(&out.stdout);
        let first = txt.lines().find(|l| !l.trim().is_empty())?;
        Some(first.trim().to_string())
    });

    NodeStatus {
        installed: true,
        version,
    }
}

/// Instala Node.js LTS usando el gestor de paquetes de la plataforma.
pub fn install() -> Result<String, String> {
    let (bin, args): (&str, Vec<&str>) = if cfg!(windows) {
        (
            "winget",
            vec![
                "install",
                "--id",
                "OpenJS.NodeJS.LTS",
                "-e",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ],
        )
    } else if cfg!(target_os = "macos") {
        ("brew", vec!["install", "node"])
    } else {
        return Err("En Linux, instala Node.js a través del gestor de paquetes de tu distribución (ej. sudo apt install nodejs npm)".into());
    };

    // Por su ruta absoluta, no por el nombre: es la misma trampa 34 que al
    // instalar un CLI. Si winget se instalo despues de iniciar sesion, el PATH
    // heredado no lo tiene y la instalacion moriria diciendo que no existe.
    let ruta = crate::registry::resolve_bin(bin)
        .ok_or_else(|| format!("no se encontro «{bin}» en este equipo"))?;
    let args: Vec<String> = args.into_iter().map(String::from).collect();
    let mut cmd = crate::registry::build_command(&ruta, &args);

    let salida = cmd
        .output()
        .map_err(|e| format!("no se pudo lanzar {}: {e}", ruta.display()))?;

    let texto = format!(
        "{}{}",
        String::from_utf8_lossy(&salida.stdout),
        String::from_utf8_lossy(&salida.stderr)
    );

    if salida.status.success() {
        Ok(texto)
    } else {
        Err(if texto.trim().is_empty() {
            format!("la instalación de Node.js falló con código {:?}", salida.status.code())
        } else {
            texto
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consulta_el_estado_de_node() {
        let s = status();
        if s.installed {
            assert!(s.version.is_some(), "si esta instalado debe devolver version");
        }
    }
}
