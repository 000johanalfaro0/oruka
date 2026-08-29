//! Reparto seguro de skills globales entre los CLIs soportados.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::mcp::safe_write;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub description: String,
    pub content: String,
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

pub fn catalog() -> Vec<Skill> {
    [
        (
            "design-loop",
            include_str!("../../packages/skills/design-loop/SKILL.md"),
        ),
        (
            "design-dna",
            include_str!("../../packages/skills/design-dna/SKILL.md"),
        ),
        (
            "visual-assets",
            include_str!("../../packages/skills/visual-assets/SKILL.md"),
        ),
        (
            "visual-reference-research",
            include_str!("../../packages/skills/visual-reference-research/SKILL.md"),
        ),
    ]
    .into_iter()
    .map(|(id, content)| Skill {
        id: id.into(),
        description: content
            .lines()
            .find_map(|l| l.strip_prefix("description: "))
            .unwrap_or("")
            .into(),
        content: content.into(),
    })
    .collect()
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
}
