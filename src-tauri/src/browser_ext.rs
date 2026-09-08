//! Deteccion de extensiones de navegador oficiales.
//!
//! Ningun programa puede instalarle una extension a un navegador desde
//! fuera -el navegador lo bloquea a proposito, mismo motivo por el que
//! Browser Harness no puede conectarse al perfil de siempre del usuario
//! (ver ESTADO.md, seccion de la sesion compartida). Esto solo comprueba si
//! ya esta puesta, leyendo el perfil en disco, y abre la pagina de la tienda
//! si no lo esta.

use std::path::PathBuf;

/// Raiz de "User Data" de cada navegador Chromium conocido en este equipo.
///
/// Solo Windows por ahora. Los tres instalan extensiones de la misma Chrome
/// Web Store con el mismo id, por eso un solo id sirve para los tres.
fn chromium_roots() -> Vec<(&'static str, PathBuf)> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return vec![];
    };
    let local = PathBuf::from(local);
    vec![
        ("Chrome", local.join("Google").join("Chrome").join("User Data")),
        ("Edge", local.join("Microsoft").join("Edge").join("User Data")),
        (
            "Brave",
            local.join("BraveSoftware").join("Brave-Browser").join("User Data"),
        ),
    ]
}

/// Busca el id de una extension entre los perfiles de cada navegador conocido.
///
/// Una extension instalada deja una carpeta con su propio nombre bajo
/// `<perfil>/Extensions/<id>/`; basta con que exista, no hace falta leer
/// nada de dentro. Devuelve en que navegador se encontro, si se encontro.
pub fn detect(extension_id: &str) -> (bool, Option<String>) {
    for (nombre, root) in chromium_roots() {
        let Ok(perfiles) = std::fs::read_dir(&root) else {
            continue;
        };
        for perfil in perfiles.flatten() {
            if !perfil.path().is_dir() {
                continue;
            }
            let candidato = perfil.path().join("Extensions").join(extension_id);
            if candidato.is_dir() {
                return (true, Some(nombre.to_string()));
            }
        }
    }
    (false, None)
}

/// Abre una pagina de tienda de extensiones en el navegador del sistema.
///
/// Restringido a las tiendas conocidas, igual que `github_open_url` solo
/// abre github.com: la URL sale del propio manifiesto de Oruka y no de lo
/// que escriba el usuario, pero se valida lo mismo, por si acaso.
pub fn open_store(url: &str) -> Result<(), String> {
    let conocida = url.starts_with("https://chromewebstore.google.com/")
        || url.starts_with("https://addons.mozilla.org/");
    if !conocida {
        return Err("solo se abren paginas de tiendas de extensiones conocidas".into());
    }
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
        ("cmd", vec!["/C", "start", ""])
    } else if cfg!(target_os = "macos") {
        ("open", vec![])
    } else {
        ("xdg-open", vec![])
    };
    std::process::Command::new(program)
        .args(args)
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("no se pudo abrir el navegador: {e}"))
}
