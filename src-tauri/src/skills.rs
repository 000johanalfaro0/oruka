//! Reparto seguro de skills globales entre los CLIs soportados.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::mcp::{safe_write, MissingRequirement, Requires};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub description: String,
    pub content: String,
    /// El programa que la skill le dice al agente que use, si necesita uno.
    ///
    /// Una skill es texto: se escribe siempre bien y nunca falla al instalar.
    /// Si ese texto manda ejecutar algo que no esta en el equipo, el fallo
    /// aparece mucho despues, en mitad de una tarea. Declararlo permite avisar
    /// antes y ofrecer la instalacion, igual que hace el catalogo de MCP.
    #[serde(default)]
    pub requires: Option<Requires>,
}

#[derive(Debug, Serialize)]
pub struct CliSkillState {
    pub cli_id: String,
    pub target: Option<String>,
    pub installed: Vec<String>,
    pub unsupported: Option<String>,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Lo que Browser Harness necesita en el PATH para que su skill sirva.
///
/// El paquete publica una CLI, no un servidor MCP. Por eso vive aqui y no en
/// el catalogo de MCP: alli el cliente lo arrancaba, recibia su ayuda por
/// salida y cerraba la conexion, y el usuario leia «servidor caido» de algo
/// que funcionaba.
fn browser_harness_requires() -> Requires {
    Requires {
        bin: "blop-browser".into(),
        name: "Browser Harness (blop-browser)".into(),
        winget: None,
        brew: None,
        npm: Some("@blopai/browser-harness".into()),
        url: "https://github.com/blop-oss/blop-browser".into(),
    }
}

pub fn catalog() -> Vec<Skill> {
    [
        (
            "design-loop",
            include_str!("../../packages/skills/design-loop/SKILL.md"),
            None,
        ),
        (
            "design-dna",
            include_str!("../../packages/skills/design-dna/SKILL.md"),
            Some(browser_harness_requires()),
        ),
        (
            "visual-assets",
            include_str!("../../packages/skills/visual-assets/SKILL.md"),
            None,
        ),
        (
            "visual-reference-research",
            include_str!("../../packages/skills/visual-reference-research/SKILL.md"),
            Some(browser_harness_requires()),
        ),
        (
            "browser-harness",
            include_str!("../../packages/skills/browser-harness/SKILL.md"),
            Some(browser_harness_requires()),
        ),
    ]
    .into_iter()
    .map(|(id, content, requires)| Skill {
        id: id.into(),
        description: content
            .lines()
            .find_map(|l| l.strip_prefix("description: "))
            .unwrap_or("")
            .into(),
        content: content.into(),
        requires,
    })
    .collect()
}

/// Lo que le falta al catalogo de skills para funcionar en este equipo.
pub fn missing() -> Vec<MissingRequirement> {
    catalog()
        .into_iter()
        .filter_map(|s| crate::mcp::missing_for(&s.id, &s.requires))
        .collect()
}

/// Instala el programa base que le falta a una skill.
pub fn install_requirement(skill_id: &str) -> Result<String, String> {
    let s = catalog()
        .into_iter()
        .find(|s| s.id == skill_id)
        .ok_or_else(|| format!("no hay ninguna skill {skill_id}"))?;
    let r = s
        .requires
        .ok_or_else(|| format!("{} no depende de nada que instalar", s.id))?;
    crate::mcp::install_bin(&r)
}

fn target_root(cli_id: &str) -> Result<PathBuf, String> {
    match cli_id {
        "codex" => Ok(home().join(".codex/skills")),
        "claude" => Ok(home().join(".claude/skills")),
        "opencode" => Ok(home().join(".config/opencode/skills")),
        "agy" => Ok(home().join(".gemini/skills")),
        _ => Err("CLI sin soporte de skills en Oruka".into()),
    }
}

fn skill_path(root: &Path, id: &str) -> PathBuf {
    root.join(id).join("SKILL.md")
}

pub fn state(cli_ids: &[String]) -> Vec<CliSkillState> {
    cli_ids
        .iter()
        .map(|id| match target_root(id) {
            Ok(root) => CliSkillState {
                cli_id: id.clone(),
                installed: catalog()
                    .into_iter()
                    .filter(|s| {
                        std::fs::read_to_string(skill_path(&root, &s.id))
                            .map(|current| current == s.content)
                            .unwrap_or(false)
                    })
                    .map(|s| s.id)
                    .collect(),
                target: Some(root.to_string_lossy().into()),
                unsupported: None,
            },
            Err(reason) => CliSkillState {
                cli_id: id.clone(),
                target: None,
                installed: vec![],
                unsupported: Some(reason),
            },
        })
        .collect()
}

pub fn preview(cli_id: &str, skill: &Skill, remove: bool) -> Result<String, String> {
    let path = skill_path(&target_root(cli_id)?, &skill.id);
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let after = if remove { "" } else { &skill.content };
    Ok(safe_write::diff(&before, after, &path.to_string_lossy()))
}

pub fn apply(cli_id: &str, skill: &Skill, remove: bool) -> Result<String, String> {
    if !catalog()
        .iter()
        .any(|s| s.id == skill.id && s.content == skill.content)
    {
        return Err("la skill no coincide con el catalogo de Oruka".into());
    }
    let path = skill_path(&target_root(cli_id)?, &skill.id);
    let backup = safe_write::backup(&path).map_err(|e| e.to_string())?;
    if remove {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    } else {
        safe_write::write_atomic(&path, &skill.content).map_err(|e| e.to_string())?;
    }
    Ok(backup
        .map(|p| p.to_string_lossy().into())
        .unwrap_or_else(|| "sin archivo previo".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalogo_portable_y_valido() {
        for skill in catalog() {
            assert!(skill.content.starts_with("---\nname: "));
            assert!(skill.content.contains(&format!("name: {}", skill.id)));
            assert!(!skill.description.is_empty());
        }
    }

    #[test]
    fn browser_harness_esta_aqui_y_no_en_mcp() {
        // No habla MCP: publica una CLI. Su sitio es este, y el aviso de que
        // falta el binario es lo unico que separa «instalada» de «sirve».
        let s = catalog()
            .into_iter()
            .find(|s| s.id == "browser-harness")
            .expect("browser-harness deberia estar en el catalogo de skills");
        let r = s.requires.expect("sin binario declarado no se puede avisar");
        assert_eq!(r.bin, "blop-browser");
        assert!(r.npm.is_some(), "npm es como se instala en los tres sistemas");
    }

    #[test]
    fn quien_manda_ejecutar_algo_lo_declara() {
        // Una skill se escribe siempre bien; lo que falla es el programa que
        // manda usar. Si el texto lo nombra, la ficha tiene que declararlo.
        for skill in catalog() {
            if skill.content.contains("blop-browser") {
                assert!(
                    skill.requires.is_some(),
                    "{} usa blop-browser y no lo declara",
                    skill.id
                );
            }
        }
    }
}
