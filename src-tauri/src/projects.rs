//! Descubrimiento de proyectos dentro de una carpeta de trabajo.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ProjectEntry {
    pub name: String,
    pub path: String,
    /// Si tiene `.git`, es un repo y GitHub podra vincularlo por su `origin`.
    pub is_git: bool,
}

/// Lista las carpetas de primer nivel de una raiz, ignorando las ocultas y las
/// que nunca son proyectos.
pub fn discover(root: &Path) -> Result<Vec<ProjectEntry>, String> {
    const IGNORED: [&str; 6] = [
        "node_modules",
        "target",
        "dist",
        "build",
        "__pycache__",
        "venv",
    ];

    let mut out = Vec::new();
    let entries = std::fs::read_dir(root).map_err(|e| format!("no se pudo leer la carpeta: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') || IGNORED.contains(&name) {
            continue;
        }
        out.push(ProjectEntry {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            is_git: path.join(".git").exists(),
        });
    }

    // Los repos primero, y dentro de cada grupo por nombre.
    out.sort_by(|a, b| b.is_git.cmp(&a.is_git).then(a.name.cmp(&b.name)));
    Ok(out)
}
