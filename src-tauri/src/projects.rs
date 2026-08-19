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

/// Senales de que una carpeta **ya es** un proyecto, y no un cajon de proyectos.
///
/// No hace falta acertar siempre: basta con reconocer lo evidente. Si algo trae
/// un `.git` o el manifiesto de su lenguaje, es el proyecto en si.
const PROJECT_MARKERS: [&str; 9] = [
    ".git",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "composer.json",
    "pubspec.yaml",
];

fn is_project(dir: &Path) -> bool {
    PROJECT_MARKERS.iter().any(|m| dir.join(m).exists())
}

fn entry_for(path: &Path) -> Option<ProjectEntry> {
    let name = path.file_name().and_then(|n| n.to_str())?;
    Some(ProjectEntry {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        is_git: path.join(".git").exists(),
    })
}

/// Lista las carpetas de primer nivel de una raiz, ignorando las ocultas y las
/// que nunca son proyectos.
///
/// Con una excepcion que importa: **si la raiz ya es un proyecto, el proyecto es
/// ella**. Anadir `.../Proyectos/mugen` como carpeta de trabajo listaba `bin`,
/// `src` y `tests` como si fueran proyectos, que es justo lo que no son.
pub fn discover(root: &Path) -> Result<Vec<ProjectEntry>, String> {
    if is_project(root) {
        return Ok(entry_for(root).into_iter().collect());
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(nombre: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("oruka-projects-tests").join(nombre);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Una carpeta con proyectos dentro se lista por sus subcarpetas.
    #[test]
    fn un_cajon_de_proyectos_lista_lo_que_tiene_dentro() {
        let raiz = temp("cajon");
        for p in ["alfa", "beta"] {
            fs::create_dir_all(raiz.join(p)).unwrap();
        }
        fs::create_dir_all(raiz.join("node_modules")).unwrap();
        fs::create_dir_all(raiz.join(".oculta")).unwrap();

        let found = discover(&raiz).expect("descubre");
        let nombres: Vec<_> = found.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(nombres, vec!["alfa", "beta"], "ni ocultas ni node_modules");
    }

    /// Y una carpeta que YA es un proyecto se lista a si misma, no sus tripas.
    /// Sin esto, anadir un repo como carpeta de trabajo ensenaba `src` y `tests`
    /// como si fueran proyectos.
    #[test]
    fn un_proyecto_no_es_un_cajon_de_proyectos() {
        let raiz = temp("mugen");
        fs::create_dir_all(raiz.join("src")).unwrap();
        fs::create_dir_all(raiz.join("tests")).unwrap();
        fs::create_dir_all(raiz.join("bin")).unwrap();
        fs::write(raiz.join("Cargo.toml"), "[package]").unwrap();

        let found = discover(&raiz).expect("descubre");
        assert_eq!(found.len(), 1, "el proyecto es la raiz, no sus carpetas");
        assert_eq!(found[0].name, "mugen");
    }

    /// El `.git` vale igual que un manifiesto para reconocerlo.
    #[test]
    fn un_repo_se_reconoce_por_su_git() {
        let raiz = temp("repo");
        fs::create_dir_all(raiz.join(".git")).unwrap();
        fs::create_dir_all(raiz.join("src")).unwrap();

        let found = discover(&raiz).expect("descubre");
        assert_eq!(found.len(), 1);
        assert!(found[0].is_git);
    }
}
