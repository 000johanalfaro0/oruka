//! Roles de agente escritos en el proyecto del usuario.
//!
//! Si claude y codex trabajan sobre los mismos archivos, hoy son dos
//! desconocidos que se pisan. Darle a cada uno un papel y decirle que el otro
//! existe cambia el resultado.
//!
//! El problema es donde ponerlo: cada CLI lee su propio archivo (`CLAUDE.md`,
//! `AGENTS.md`, `GEMINI.md`) y esos archivos **son del usuario**. Suelen existir
//! ya, suelen estar versionados y suelen tener contenido que no es nuestro.
//! Por eso aqui no se escribe un archivo: se mantiene un **bloque delimitado**
//! dentro de el. Todo lo que este fuera de las dos marcas no se toca nunca, y
//! revertir devuelve el archivo exactamente a como estaba.
//!
//! El reparto no es de fabrica. El manifiesto de cada CLI trae un rol por
//! defecto igual que trae sus modos, pero lo que se escribe sale de lo que el
//! usuario haya configurado, y solo para los CLIs que tiene instalados.

use crate::mcp::safe_write;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Marcas que delimitan lo nuestro. Fuera de aqui no se toca nada.
const MARK_START: &str = "<!-- oruka:roles:inicio -->";
const MARK_END: &str = "<!-- oruka:roles:fin -->";

/// Rol de fabrica que trae un manifiesto.
///
/// Es un valor por defecto, no una imposicion: el usuario lo cambia y su
/// version es la que manda. Vive en el JSON para que anadir un CLI nuevo no
/// recompile nada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleSpec {
    /// Archivo que ese CLI lee dentro del proyecto.
    pub file: String,
    /// Nombre corto del papel.
    pub role: String,
    /// Una linea explicando que le toca.
    pub brief: String,
}

/// Un agente ya resuelto: su CLI, su papel y donde se escribe.
///
/// Lo construye el front a partir de los CLIs **detectados** y de lo que el
/// usuario haya configurado. Rust no decide quien participa.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleAgent {
    pub cli_id: String,
    /// Nombre visible del CLI, para que el documento se lea.
    pub name: String,
    pub file: String,
    pub role: String,
    pub brief: String,
}

/// Lo que le pasaria a un archivo si se aplicara.
#[derive(Debug, Serialize)]
pub struct RoleChange {
    /// Ruta completa del archivo.
    pub path: String,
    /// Nombre del archivo, para ensenarlo sin la ruta entera.
    pub file: String,
    /// Diff unificado de lo que cambiaria.
    pub diff: String,
    /// Si el archivo no existe todavia y habria que crearlo.
    pub creates: bool,
}

/// El bloque que Oruka mantiene, identico en todos los archivos.
///
/// Es el mismo texto para todos a proposito: `codex` y `opencode` leen los dos
/// `AGENTS.md`, asi que un bloque por CLI se pisaria a si mismo. Ademas cada
/// agente tiene que ver la lista **entera** para saber que los otros existen,
/// que es justo lo que se busca.
pub fn block(agents: &[RoleAgent]) -> String {
    let mut out = String::new();
    out.push_str(MARK_START);
    out.push_str("\n\n## Roles de los agentes\n\n");
    out.push_str(
        "Este bloque lo mantiene Oruka. Todo lo que esté fuera de las dos marcas\n\
         es tuyo: Oruka no lo lee ni lo modifica.\n\n\
         En este proyecto puede haber varios agentes trabajando a la vez sobre\n\
         los mismos archivos. Cada uno tiene un papel. Si el tuyo aparece abajo,\n\
         cíñete a él y da por hecho que los demás existen.\n\n",
    );
    out.push_str("| Agente | Rol | Qué le toca |\n|---|---|---|\n");
    for a in agents {
        out.push_str(&format!(
            "| {} | **{}** | {} |\n",
            escape_cell(&a.name),
            escape_cell(&a.role),
            escape_cell(&a.brief)
        ));
    }
    out.push_str(
        "\nSi vas a tocar algo que claramente le toca a otro, dilo en tu\n\
         respuesta en vez de hacerlo por tu cuenta.\n\n",
    );
    out.push_str(MARK_END);
    out
}

/// Una barra vertical dentro de una celda parte la tabla en dos.
fn escape_cell(text: &str) -> String {
    text.replace('|', "\\|").replace('\n', " ")
}

/// Mete el bloque en el contenido existente sin tocar nada mas.
///
/// Si ya habia un bloque nuestro se sustituye en su sitio; si no, se anade al
/// final. Nunca se reescribe el archivo entero: lo que el usuario tenia sigue
/// donde estaba y en el mismo orden.
pub fn merge(existing: &str, block: &str) -> String {
    match bounds(existing) {
        Some((start, end)) => {
            let mut out = String::with_capacity(existing.len() + block.len());
            out.push_str(&existing[..start]);
            out.push_str(block);
            out.push_str(&existing[end..]);
            out
        }
        None if existing.trim().is_empty() => format!("{block}\n"),
        None => {
            let sep = if existing.ends_with("\n\n") {
                ""
            } else if existing.ends_with('\n') {
                "\n"
            } else {
                "\n\n"
            };
            format!("{existing}{sep}{block}\n")
        }
    }
}

/// Quita el bloque y deja el archivo como estaba antes de que existiera.
pub fn strip(existing: &str) -> String {
    match bounds(existing) {
        Some((start, end)) => {
            let mut out = String::with_capacity(existing.len());
            out.push_str(&existing[..start]);
            out.push_str(existing[end..].trim_start_matches('\n'));
            let limpio = out.trim_end().to_string();
            if limpio.is_empty() {
                limpio
            } else {
                limpio + "\n"
            }
        }
        None => existing.to_string(),
    }
}

/// Donde empieza y acaba nuestro bloque dentro del texto.
fn bounds(text: &str) -> Option<(usize, usize)> {
    let start = text.find(MARK_START)?;
    let end = text[start..].find(MARK_END)? + start + MARK_END.len();
    Some((start, end))
}

/// Los archivos distintos que tocaria este reparto, con sus rutas.
///
/// Se agrupa por nombre de archivo porque dos CLIs pueden compartirlo: `codex`
/// y `opencode` leen los dos `AGENTS.md`. Escribir dos veces ahi seria escribir
/// una vez y borrarla.
fn targets(project: &Path, agents: &[RoleAgent]) -> Vec<(PathBuf, String)> {
    let mut files: Vec<String> = Vec::new();
    for a in agents {
        let name = a.file.trim();
        // Un manifiesto de terceros no puede mandarnos a escribir fuera del
        // proyecto: se acepta un nombre de archivo, no una ruta.
        if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
            continue;
        }
        if !files.iter().any(|f| f == name) {
            files.push(name.to_string());
        }
    }
    files.into_iter().map(|f| (project.join(&f), f)).collect()
}

/// Que cambiaria, sin escribir nada.
///
/// Un archivo que ya esta al dia no sale en la lista: es la idempotencia, y es
/// lo que evita dejar una copia de seguridad nueva cada vez que se abre el
/// proyecto.
pub fn plan(project: &Path, agents: &[RoleAgent]) -> Vec<RoleChange> {
    if agents.is_empty() {
        return Vec::new();
    }
    let block = block(agents);
    targets(project, agents)
        .into_iter()
        .filter_map(|(path, file)| {
            let before = std::fs::read_to_string(&path).unwrap_or_default();
            let creates = !path.exists();
            let after = merge(&before, &block);
            if after == before {
                return None;
            }
            Some(RoleChange {
                path: path.to_string_lossy().to_string(),
                diff: safe_write::diff(&before, &after, &file),
                file,
                creates,
            })
        })
        .collect()
}

/// Aplica el reparto. Devuelve los archivos escritos.
///
/// Cada escritura lleva copia previa y rename atomico, igual que las configs
/// de MCP: el archivo puede ser el `CLAUDE.md` del equipo, no un borrador.
pub fn apply(project: &Path, agents: &[RoleAgent]) -> Result<Vec<String>, String> {
    if !project.is_dir() {
        return Err(format!("no existe la carpeta {}", project.display()));
    }
    let block = block(agents);
    let mut written = Vec::new();
    for (path, file) in targets(project, agents) {
        let before = std::fs::read_to_string(&path).unwrap_or_default();
        let after = merge(&before, &block);
        if after == before {
            continue;
        }
        safe_write::backup(&path).map_err(|e| format!("no se pudo copiar {file}: {e}"))?;
        safe_write::write_atomic(&path, &after)
            .map_err(|e| format!("no se pudo escribir {file}: {e}"))?;
        written.push(path.to_string_lossy().to_string());
    }
    Ok(written)
}

/// Deshace el reparto: quita el bloque de cada archivo.
///
/// No se restaura la copia de seguridad: podria ser de hace tres cambios del
/// usuario. Como solo hemos tocado lo que hay entre las marcas, quitarlo deja
/// el archivo exactamente como estaba. Si el archivo se queda vacio es que lo
/// creamos nosotros, y entonces se borra.
pub fn revert(project: &Path, agents: &[RoleAgent]) -> Result<Vec<String>, String> {
    let mut touched = Vec::new();
    for (path, file) in targets(project, agents) {
        let Ok(before) = std::fs::read_to_string(&path) else {
            continue;
        };
        if bounds(&before).is_none() {
            continue;
        }
        let after = strip(&before);
        if after.trim().is_empty() {
            std::fs::remove_file(&path).map_err(|e| format!("no se pudo borrar {file}: {e}"))?;
        } else {
            safe_write::write_atomic(&path, &after)
                .map_err(|e| format!("no se pudo escribir {file}: {e}"))?;
        }
        touched.push(path.to_string_lossy().to_string());
    }
    Ok(touched)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agentes() -> Vec<RoleAgent> {
        vec![
            RoleAgent {
                cli_id: "claude".into(),
                name: "Claude Code".into(),
                file: "CLAUDE.md".into(),
                role: "Arquitecto".into(),
                brief: "Disena y revisa.".into(),
            },
            RoleAgent {
                cli_id: "codex".into(),
                name: "Codex CLI".into(),
                file: "AGENTS.md".into(),
                role: "Implementador".into(),
                brief: "Escribe el codigo.".into(),
            },
        ]
    }

    #[test]
    fn el_bloque_nombra_a_todos_los_agentes() {
        // Cada agente tiene que ver la lista entera: de eso va la idea.
        let b = block(&agentes());
        assert!(b.contains("Claude Code"));
        assert!(b.contains("Codex CLI"));
        assert!(b.starts_with(MARK_START));
        assert!(b.ends_with(MARK_END));
    }

    #[test]
    fn no_se_toca_nada_fuera_de_las_marcas() {
        let mio = "# Mi proyecto\n\nInstrucciones del equipo que no son de Oruka.\n";
        let out = merge(mio, &block(&agentes()));
        assert!(out.starts_with(mio), "el contenido del usuario se movio");
        assert!(out.contains("Arquitecto"));
    }

    #[test]
    fn aplicar_dos_veces_deja_el_mismo_archivo() {
        // Idempotencia: abrir el proyecto cada dia no puede ir acumulando
        // bloques ni copias de seguridad.
        let b = block(&agentes());
        let una = merge("# Hola\n", &b);
        let dos = merge(&una, &b);
        assert_eq!(una, dos);
    }

    #[test]
    fn cambiar_el_rol_sustituye_el_bloque_en_su_sitio() {
        let b1 = block(&agentes());
        let mut otros = agentes();
        otros[0].role = "Revisor".into();
        let b2 = block(&otros);

        let una = merge("# Hola\n\nTexto mio.\n", &b1);
        let dos = merge(&una, &b2);
        assert!(dos.contains("Revisor"));
        assert!(!dos.contains("Arquitecto"), "quedo el bloque viejo");
        assert_eq!(dos.matches(MARK_START).count(), 1, "se duplico el bloque");
        assert!(dos.contains("Texto mio."));
    }

    #[test]
    fn revertir_devuelve_el_archivo_a_como_estaba() {
        let mio = "# Mi proyecto\n\nLo mio.\n";
        let con = merge(mio, &block(&agentes()));
        assert_eq!(strip(&con).trim_end(), mio.trim_end());
    }

    #[test]
    fn dos_clis_que_comparten_archivo_lo_escriben_una_vez() {
        // codex y opencode leen los dos AGENTS.md. Dos escrituras ahi serian
        // una escritura y un borrado.
        let mut lista = agentes();
        lista.push(RoleAgent {
            cli_id: "opencode".into(),
            name: "OpenCode".into(),
            file: "AGENTS.md".into(),
            role: "Verificador".into(),
            brief: "Prueba.".into(),
        });
        let t = targets(Path::new("/proyecto"), &lista);
        assert_eq!(t.len(), 2, "AGENTS.md tendria que salir una sola vez");
    }

    #[test]
    fn un_manifiesto_no_puede_escribir_fuera_del_proyecto() {
        let malos = vec![
            RoleAgent {
                cli_id: "x".into(),
                name: "X".into(),
                file: "../../.bashrc".into(),
                role: "R".into(),
                brief: "B".into(),
            },
            RoleAgent {
                cli_id: "y".into(),
                name: "Y".into(),
                file: "/etc/passwd".into(),
                role: "R".into(),
                brief: "B".into(),
            },
        ];
        assert!(targets(Path::new("/proyecto"), &malos).is_empty());
    }

    #[test]
    fn una_barra_en_el_rol_no_rompe_la_tabla() {
        let mut lista = agentes();
        lista[0].brief = "Hace A | hace B".into();
        let b = block(&lista);
        let fila = b.lines().find(|l| l.contains("Claude Code")).unwrap();
        assert_eq!(fila.matches(" | ").count(), 2, "la tabla tiene 3 columnas");
    }

    #[test]
    fn sin_agentes_no_hay_nada_que_escribir() {
        assert!(plan(Path::new("/proyecto"), &[]).is_empty());
    }

    #[test]
    fn escribe_y_revierte_de_verdad_en_disco() {
        let dir = std::env::temp_dir().join(format!(
            "oruka-roles-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let claude = dir.join("CLAUDE.md");
        std::fs::write(&claude, "# Del equipo\n").unwrap();

        let escritos = apply(&dir, &agentes()).unwrap();
        assert_eq!(escritos.len(), 2, "CLAUDE.md y AGENTS.md");
        assert!(std::fs::read_to_string(&claude)
            .unwrap()
            .contains("Arquitecto"));

        // Segunda pasada: nada que hacer.
        assert!(apply(&dir, &agentes()).unwrap().is_empty());
        assert!(plan(&dir, &agentes()).is_empty());

        revert(&dir, &agentes()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&claude).unwrap().trim(),
            "# Del equipo"
        );
        // AGENTS.md lo creamos nosotros: al revertir desaparece.
        assert!(!dir.join("AGENTS.md").exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
