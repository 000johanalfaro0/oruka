//! Escritura segura sobre archivos de configuracion ajenos.
//!
//! Estos archivos no son nuestros: `~/.claude.json` guarda el historial de
//! sesiones del usuario y `~/.codex/config.toml` sus servidores y comentarios.
//! Romper uno deja al usuario sin su herramienta, asi que ninguna escritura
//! ocurre sin copia previa y ninguna se hace truncando el original.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const BACKUP_MARK: &str = ".oruka-backup-";

/// Copia el archivo antes de tocarlo. Devuelve la ruta de la copia.
///
/// Si el archivo no existe todavia no hay nada que salvar: es una creacion.
pub fn backup(path: &Path) -> std::io::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = format!(
        "{}{}{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        BACKUP_MARK,
        stamp
    );
    let dest = path.with_file_name(name);
    fs::copy(path, &dest)?;
    Ok(Some(dest))
}

/// Escribe sin truncar el original: primero un temporal, luego un rename.
///
/// Si algo falla a mitad, el archivo bueno sigue intacto. Truncar y escribir
/// encima es lo que convierte un fallo en perdida de datos.
pub fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}.oruka-tmp",
        path.extension().unwrap_or_default().to_string_lossy()
    ));
    fs::write(&tmp, contents)?;
    // En Windows rename falla si el destino existe: se quita antes.
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// La copia mas reciente de un archivo, si existe alguna.
pub fn latest_backup(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?;
    let prefix = format!(
        "{}{}",
        path.file_name()?.to_string_lossy(),
        BACKUP_MARK
    );
    let mut candidates: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_string_lossy().to_string();
            let stamp = name.strip_prefix(&prefix)?.parse::<u64>().ok()?;
            Some((stamp, p))
        })
        .collect();
    candidates.sort_by_key(|(stamp, _)| *stamp);
    candidates.pop().map(|(_, p)| p)
}

/// Restaura la copia mas reciente sobre el archivo original.
pub fn revert(path: &Path) -> Result<PathBuf, String> {
    let backup = latest_backup(path).ok_or("no hay ninguna copia de seguridad que restaurar")?;
    let contents = fs::read_to_string(&backup).map_err(|e| e.to_string())?;
    write_atomic(path, &contents).map_err(|e| e.to_string())?;
    Ok(backup)
}

/// Diff unificado entre lo que hay y lo que quedaria.
pub fn diff(before: &str, after: &str, label: &str) -> String {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(before, after);
    let mut out = format!("--- {label} (actual)\n+++ {label} (propuesto)\n");
    for group in diff.grouped_ops(3) {
        for op in group {
            for change in diff.iter_changes(&op) {
                let sign = match change.tag() {
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                    ChangeTag::Equal => ' ',
                };
                out.push(sign);
                out.push_str(change.value());
                if !change.value().ends_with('\n') {
                    out.push('\n');
                }
            }
        }
        out.push_str("...\n");
    }
    if out.lines().count() <= 2 {
        out.push_str("(sin cambios)\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_escritura_atomica_no_deja_el_original_a_medias() {
        let dir = std::env::temp_dir().join(format!("oruka-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config.json");

        write_atomic(&file, "{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":1}");

        // No quedan temporales sueltos.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("oruka-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "quedo un temporal sin limpiar");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn revertir_devuelve_el_archivo_tal_y_como_estaba() {
        let dir = std::env::temp_dir().join(format!("oruka-rev-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config.toml");

        let original = "# comentario del usuario\nkey = 1\n";
        fs::write(&file, original).unwrap();

        backup(&file).unwrap().expect("deberia haber copia");
        write_atomic(&file, "destrozado").unwrap();
        assert_ne!(fs::read_to_string(&file).unwrap(), original);

        revert(&file).unwrap();
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            original,
            "revertir tiene que dejarlo byte a byte igual"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sin_archivo_previo_no_hay_copia_pero_no_falla() {
        let path = std::env::temp_dir().join("oruka-no-existe-jamas.json");
        let _ = fs::remove_file(&path);
        assert!(backup(&path).unwrap().is_none());
    }
}
