//! Nucleo de Oruka.
//!
//! Cada capacidad vive detras de un modulo con una superficie estrecha de
//! comandos. El front nunca habla con procesos, ficheros de configuracion ni
//! con la red: siempre a traves de uno de estos comandos.

mod browser_ext;
mod clipboard_img;
mod github;
mod mcp;
mod node;
mod ports;
mod projects;
mod pty;
pub mod registry;
mod roles;
mod router_service;
mod skills;
mod store;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use pty::{PtyManager, SharedPty};
use registry::DetectedCli;
use router_service::{RouterState, RouterStatus, SharedRouter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Actualizacion dentro de la app. Sin esto, cada version nueva obliga
        // a que alguien se entere por su cuenta y reinstale a mano, que es
        // pedirle demasiado a quien solo queria usar la herramienta.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Hace falta para reiniciar despues de aplicar la actualizacion.
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(PtyManager::default()))
        .manage(Arc::new(RouterState::default()))
        .invoke_handler(tauri::generate_handler![
            app_version,
            store_get,
            store_set,
            store_remove,
            store_seed,
            detect_clis,
            install_cli,
            node_status,
            node_install,
            github_status,
            github_install,
            github_login,
            github_repos,
            github_repo_for_path,
            github_prs,
            github_collaborators,
            github_invitations,
            github_respond_invitation,
            github_invite,
            github_remove_collaborator,
            github_sent_invitations,
            github_cancel_invitation,
            github_pr_diff,
            github_pr_checks,
            github_pr_review,
            github_pr_create,
            github_pr_merge,
            github_pr_close,
            github_issues,
            github_review_count,
            github_branch_status,
            github_open_url,
            reveal_in_explorer,
            save_prompt,
            mcp_catalog,
            mcp_missing,
            mcp_install_requirement,
            mcp_state,
            mcp_preview,
            mcp_apply,
            mcp_revert,
            skills_catalog,
            skills_state,
            skills_preview,
            skills_apply,
            skills_missing,
            skills_install_requirement,
            roles_plan,
            roles_apply,
            roles_revert,
            list_projects,
            agent_spawn,
            agent_write,
            agent_resize,
            agent_kill,
            agent_scrollback,
            clipboard_read,
            clipboard_write,
            clipboard_read_image,
            path_is_dir,
            router_status,
            router_install,
            router_start,
            router_stop,
            router_open_panel,
            open_extension_store,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Oruka");
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Estado que sobrevive al cierre: sesion, setup y carpetas de trabajo.
///
/// Va a disco y no al navegador porque `localStorage` esta indexado por origen,
/// y el de Oruka cambia entre la app de desarrollo y la empaquetada.
#[tauri::command]
async fn store_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    store::get(&app, &key)
}

#[tauri::command]
async fn store_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    store::set(&app, &key, &value)
}

#[tauri::command]
async fn store_remove(app: AppHandle, key: String) -> Result<(), String> {
    store::remove(&app, &key)
}

/// Mudanza desde el `localStorage` de una version anterior.
///
/// No pisa lo que ya haya en disco. Devuelve cuantas claves se rescataron.
#[tauri::command]
async fn store_seed(app: AppHandle, entries: Vec<(String, String)>) -> Result<u32, String> {
    store::seed(&app, entries)
}

#[tauri::command]
async fn detect_clis() -> Vec<DetectedCli> {
    registry::detect_all()
}

#[tauri::command]
async fn list_projects(root: String) -> Result<Vec<projects::ProjectEntry>, String> {
    projects::discover(&PathBuf::from(root))
}

/// Lanza un agente en el directorio del proyecto, con el modo de permisos pedido.
#[tauri::command]
fn agent_spawn(
    app: AppHandle,
    manager: State<'_, SharedPty>,
    id: String,
    cli_id: String,
    cwd: String,
    mode: String,
    cols: u16,
    rows: u16,
    prompt: Option<String>,
    resume: Option<bool>,
) -> Result<(), String> {
    let manifest = registry::manifest(&cli_id).ok_or("CLI desconocido")?;
    let program = registry::resolve_bin(&manifest.detect.bin)
        .ok_or_else(|| format!("{} no esta instalado o no esta en el PATH", manifest.name))?;

    let cwd_path = PathBuf::from(&cwd);
    let mut args = manifest.launch.args.clone();

    // Los modos son datos del manifiesto, no ramas de codigo por CLI.
    if let Some(mode_args) = manifest.modes.get(&mode) {
        args.extend(mode_args.clone());
    }

    // Retomar la conversacion anterior, si se pide y el CLI sabe.
    //
    // Cada uno lo dice a su manera y esta en su manifiesto: `--continue` en
    // claude y agy, `resume --last` en codex, `session` en opencode. La
    // diferencia que importa es que unos son banderas y otros SUBCOMANDOS, y un
    // subcomando tiene que ir el primero o el CLI no lo reconoce. Se distingue
    // por el guion, sin nombrar a ningun CLI aqui.
    if resume.unwrap_or(false) && !manifest.resume.is_empty() {
        if manifest.resume[0].starts_with('-') {
            args.extend(manifest.resume.clone());
        } else {
            for (i, token) in manifest.resume.iter().enumerate() {
                args.insert(i, token.clone());
            }
        }
    }

    // Cada CLI recibe el directorio a su manera.
    match manifest.launch.cwd.as_str() {
        "flag" => {
            if let Some(flag) = &manifest.launch.cwd_flag {
                args.push(flag.clone());
                args.push(cwd.clone());
            }
        }
        "positional" => args.push(cwd.clone()),
        _ => {}
    }

    // El prompt inicial se entrega como diga el manifiesto. Va corto a
    // proposito: el texto largo viaja en un archivo y aqui solo se referencia,
    // porque Windows corta la linea de comandos sobre los 32 KB.
    if let (Some(text), Some(spec)) = (prompt.as_ref(), manifest.prompt.as_ref()) {
        match spec.via.as_str() {
            "arg" => {
                if let Some(flag) = &spec.flag {
                    args.push(flag.clone());
                    args.push(text.clone());
                }
            }
            "positional" => args.push(text.clone()),
            "subcommand" => {
                if let Some(sub) = &spec.subcommand {
                    args.insert(0, sub.clone());
                }
                args.push(text.clone());
            }
            _ => {}
        }
    }

    // La marca del contador es dato del manifiesto: el PTY no sabe de CLIs.
    let tokens = manifest.usage.as_ref().map(|u| u.marker.clone());
    // Donde esta la cifra respecto a la marca lo decide el manifiesto, no aqui.
    let tokens_antes = manifest
        .usage
        .as_ref()
        .map(|u| u.number == "before")
        .unwrap_or(false);
    manager.spawn(
        app,
        id,
        &program,
        &args,
        &cwd_path,
        cols,
        rows,
        tokens,
        tokens_antes,
    )
}

#[tauri::command]
fn agent_write(manager: State<'_, SharedPty>, id: String, data: String) -> Result<(), String> {
    manager.write(&id, &data)
}

#[tauri::command]
fn agent_resize(
    manager: State<'_, SharedPty>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command]
fn agent_kill(manager: State<'_, SharedPty>, id: String) -> Result<(), String> {
    manager.kill(&id)
}

/// La salida reciente de un agente, para repintarla al volver a su pestana.
///
/// `None` si la sesion no esta viva. El `seq` que acompana a la foto es lo que
/// permite al front tirar los trozos que ya venian dentro de ella.
#[tauri::command]
fn agent_scrollback(manager: State<'_, SharedPty>, id: String) -> Option<pty::Snapshot> {
    manager.scrollback(&id)
}

#[tauri::command]
async fn github_status() -> github::GithubStatus {
    github::status()
}

/// Instala `gh` con el gestor de paquetes del sistema.
#[tauri::command]
async fn github_install() -> Result<String, String> {
    github::install()
}

/// Arranca la autenticacion de GitHub dentro de la propia app.
///
/// Va por un PTY y no por un comando normal a proposito: `gh` se niega a hacer
/// el flujo del navegador si no cree estar en un terminal, y ademas asi el
/// usuario ve lo que esta pasando en vez de mirar una ventana quieta.
///
/// La sesion se llama siempre igual porque solo puede haber una: autenticarse
/// dos veces a la vez no significa nada.
#[tauri::command]
async fn github_login(app: AppHandle, manager: State<'_, SharedPty>) -> Result<(), String> {
    let program = registry::resolve_bin("gh")
        .ok_or("gh no esta instalado en este equipo")?;
    manager.spawn(
        app,
        "gh-login".into(),
        &program,
        &github::login_args(),
        &std::env::temp_dir(),
        100,
        24,
        None,
        false,
    )
}

/// Repos del usuario. `shared` son en los que solo colabora.
#[tauri::command]
async fn github_repos(shared: bool) -> Result<Vec<github::Repo>, String> {
    github::repos(shared)
}

/// A que repo apunta el `origin` de una carpeta. `None` si no apunta a GitHub.
#[tauri::command]
async fn github_repo_for_path(path: String) -> Option<String> {
    github::repo_for_path(std::path::Path::new(&path))
}

#[tauri::command]
async fn github_prs(repo: String, filter: String) -> Result<Vec<github::PullRequest>, String> {
    github::pull_requests(&repo, github::PrFilter::from_id(&filter))
}

#[tauri::command]
async fn github_collaborators(repo: String) -> Result<Vec<github::Collaborator>, String> {
    github::collaborators(&repo)
}

#[tauri::command]
async fn github_invitations() -> Result<Vec<github::Invitation>, String> {
    github::invitations()
}

/// Acepta o rechaza una invitacion. Se ve desde fuera: el front pregunta antes.
#[tauri::command]
async fn github_respond_invitation(id: u64, accept: bool) -> Result<(), String> {
    github::respond_invitation(id, accept)
}

/// Invita a alguien a colaborar, o le cambia el permiso si ya estaba.
///
/// Manda un correo a esa persona: la interfaz pregunta antes de llamar aqui.
#[tauri::command]
async fn github_invite(repo: String, login: String, permission: String) -> Result<(), String> {
    github::invite_collaborator(&repo, &login, &permission)
}

#[tauri::command]
async fn github_remove_collaborator(repo: String, login: String) -> Result<(), String> {
    github::remove_collaborator(&repo, &login)
}

/// Invitaciones enviadas desde un repo que siguen sin contestar.
#[tauri::command]
async fn github_sent_invitations(repo: String) -> Result<Vec<github::SentInvitation>, String> {
    github::sent_invitations(&repo)
}

#[tauri::command]
async fn github_cancel_invitation(repo: String, id: u64) -> Result<(), String> {
    github::cancel_invitation(&repo, id)
}

/// El diff de un pull request, para poder revisarlo sin salir de la app.
#[tauri::command]
async fn github_pr_diff(repo: String, number: u64) -> Result<String, String> {
    github::pr_diff(&repo, number)
}

/// Los checks de CI de un PR. Lista vacia = el repo no tiene CI.
#[tauri::command]
async fn github_pr_checks(repo: String, number: u64) -> Result<Vec<github::Check>, String> {
    github::pr_checks(&repo, number)
}

/// Aprueba, pide cambios o comenta. Queda publicado con tu nombre.
#[tauri::command]
async fn github_pr_review(repo: String, number: u64, action: String, body: String) -> Result<(), String> {
    github::pr_review(&repo, number, &action, &body)
}

/// Abre un PR desde la rama actual de la carpeta del proyecto.
#[tauri::command]
async fn github_pr_create(
    cwd: String,
    title: String,
    body: String,
    base: String,
) -> Result<String, String> {
    github::pr_create(std::path::Path::new(&cwd), &title, &body, &base)
}

#[tauri::command]
async fn github_pr_merge(
    repo: String,
    number: u64,
    method: String,
    delete_branch: bool,
) -> Result<(), String> {
    github::pr_merge(&repo, number, &method, delete_branch)
}

#[tauri::command]
async fn github_pr_close(repo: String, number: u64) -> Result<(), String> {
    github::pr_close(&repo, number)
}

/// Los issues abiertos que tienes asignados, de todos tus repositorios.
#[tauri::command]
async fn github_issues() -> Result<Vec<github::Issue>, String> {
    github::issues_assigned()
}

/// Cuantos PR esperan tu revision. Alimenta el aviso de la barra de estado.
#[tauri::command]
async fn github_review_count() -> Result<u32, String> {
    github::review_requested_count()
}

/// En que rama esta el proyecto y si tiene trabajo sin subir.
#[tauri::command]
async fn github_branch_status(path: String) -> Option<github::BranchStatus> {
    github::branch_status(std::path::Path::new(&path))
}

/// Abre un enlace de GitHub en el navegador del sistema.
///
/// Solo GitHub a proposito: es una superficie estrecha por la que el front pide
/// abrir cosas, y no tiene por que servir para abrir cualquier URL.
#[tauri::command]
fn github_open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("solo se abren enlaces de github.com".into());
    }
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
        // `start` es interno de cmd, y el primer argumento entre comillas seria
        // el titulo de la ventana: por eso va uno vacio antes de la URL.
        ("cmd", vec!["/C", "start", ""])
    } else if cfg!(target_os = "macos") {
        ("open", vec![])
    } else {
        ("xdg-open", vec![])
    };
    std::process::Command::new(program)
        .args(args)
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("no se pudo abrir el navegador: {e}"))
}

#[tauri::command]
fn mcp_catalog() -> Vec<mcp::McpServer> {
    mcp::catalog()
}

#[tauri::command]
async fn mcp_state(cli_ids: Vec<String>) -> Vec<mcp::CliMcpState> {
    mcp::state(&cli_ids)
}

/// Diff de lo que pasaria. No toca nada.
#[tauri::command]
async fn mcp_preview(cli_id: String, server: mcp::McpServer, remove: bool) -> Result<String, String> {
    mcp::preview(&cli_id, &server, remove)
}

/// Aplica el cambio. Devuelve la ruta de la copia de seguridad.
#[tauri::command]
async fn mcp_apply(cli_id: String, server: mcp::McpServer, remove: bool) -> Result<String, String> {
    mcp::apply(&cli_id, &server, remove)
}

#[tauri::command]
async fn mcp_revert(cli_id: String) -> Result<String, String> {
    mcp::revert(&cli_id)
}

/// Que servidores del catalogo no pueden arrancar en este equipo.
#[tauri::command]
async fn mcp_missing() -> Vec<mcp::MissingRequirement> {
    mcp::missing()
}

/// Instala el programa base que le falta a un servidor.
#[tauri::command]
async fn mcp_install_requirement(server_id: String) -> Result<String, String> {
    mcp::install_requirement(&server_id)
}

#[tauri::command]
fn skills_catalog() -> Vec<skills::Skill> { skills::catalog() }

#[tauri::command]
fn skills_state(cli_ids: Vec<String>) -> Vec<skills::CliSkillState> { skills::state(&cli_ids) }

#[tauri::command]
fn skills_preview(cli_id: String, skill: skills::Skill, remove: bool) -> Result<String, String> {
    skills::preview(&cli_id, &skill, remove)
}

#[tauri::command]
fn skills_apply(cli_id: String, skill: skills::Skill, remove: bool) -> Result<String, String> {
    skills::apply(&cli_id, &skill, remove)
}

/// Skills cuyo programa base no esta en este equipo.
///
/// Una skill se escribe siempre bien, asi que sin esto parece instalada y
/// util. El fallo aparecia despues, cuando el agente ejecutaba lo que la skill
/// le manda y no existia.
#[tauri::command]
async fn skills_missing() -> Vec<mcp::MissingRequirement> {
    skills::missing()
}

#[tauri::command]
async fn skills_install_requirement(skill_id: String) -> Result<String, String> {
    skills::install_requirement(&skill_id)
}

/// Instala o actualiza un CLI con el comando que declare su manifiesto.
///
/// Es el mismo comando para las dos cosas: `npm install -g` trae la ultima
/// version tanto si no habia nada como si habia una vieja. Por eso no hay dos
/// comandos ni dos campos, solo dos etiquetas en la interfaz.
///
/// Async porque lanza un proceso y espera: un comando sincrono corre en el hilo
/// de la interfaz y congelaria la ventana entera mientras npm baja paquetes.
#[tauri::command]
async fn install_cli(cli_id: String) -> Result<String, String> {
    registry::install(&cli_id)
}

/// Estado del servicio 9Router: instalado, corriendo, en que puerto.
#[tauri::command]
async fn router_status(state: State<'_, SharedRouter>) -> Result<RouterStatus, String> {
    Ok(router_service::status(&state))
}

/// Instala 9Router por npm. Async por lo mismo que `install_cli`.
#[tauri::command]
async fn router_install() -> Result<String, String> {
    router_service::install()
}

/// Arranca el servicio. Devuelve la contrasena inicial la primera vez, para
/// que el usuario entre al panel web sin tener que ir a buscarla a mano.
#[tauri::command]
async fn router_start(app: AppHandle, state: State<'_, SharedRouter>) -> Result<String, String> {
    router_service::start(&app, &state)?;
    router_service::initial_password(&app)
}

#[tauri::command]
async fn router_stop(app: AppHandle, state: State<'_, SharedRouter>) -> Result<(), String> {
    router_service::stop(&app, &state)
}

#[tauri::command]
async fn router_open_panel() -> Result<(), String> {
    router_service::open_panel()
}

/// Abre la ficha de una extension de navegador oficial en su tienda.
#[tauri::command]
async fn open_extension_store(url: String) -> Result<(), String> {
    browser_ext::open_store(&url)
}

/// Estado de Node.js / npm en este equipo.
#[tauri::command]
async fn node_status() -> Result<node::NodeStatus, String> {
    Ok(node::status())
}

/// Instala Node.js LTS mediante el gestor del sistema (winget/brew).
#[tauri::command]
async fn node_install() -> Result<String, String> {
    node::install()
}

/// Que archivos de rol cambiarian en este proyecto, sin escribir nada.
///
/// El front manda la lista de agentes ya resuelta: quien participa lo decide
/// el usuario con los CLIs que tiene instalados, no este modulo.
#[tauri::command]
async fn roles_plan(
    project: String,
    agents: Vec<roles::RoleAgent>,
) -> Result<Vec<roles::RoleChange>, String> {
    Ok(roles::plan(std::path::Path::new(&project), &agents))
}

/// Escribe el reparto de roles. Devuelve los archivos tocados.
#[tauri::command]
async fn roles_apply(
    project: String,
    agents: Vec<roles::RoleAgent>,
) -> Result<Vec<String>, String> {
    roles::apply(std::path::Path::new(&project), &agents)
}

/// Quita el bloque de roles y deja los archivos como estaban.
#[tauri::command]
async fn roles_revert(
    project: String,
    agents: Vec<roles::RoleAgent>,
) -> Result<Vec<String>, String> {
    roles::revert(std::path::Path::new(&project), &agents)
}

/// Abre una carpeta en el explorador de archivos del sistema.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("no se pudo abrir el explorador: {e}"))
}

/// Guarda un prompt largo en un archivo temporal y devuelve su ruta.
///
/// El bloc de notas de un proyecto puede pasar de 40 KB, demasiado para la
/// linea de comandos de Windows. Se escribe a disco y al agente solo se le
/// pasa la ruta.
#[tauri::command]
fn save_prompt(content: String) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("oruka-prompt-{stamp}.md"));
    std::fs::write(&path, content).map_err(|e| format!("no se pudo guardar el prompt: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
mod win_clipboard {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::ptr::null_mut;

    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut std::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(uFormat: u32) -> *mut std::ffi::c_void;
        fn SetClipboardData(uFormat: u32, hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> *mut std::ffi::c_void;
        fn GlobalLock(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalUnlock(hMem: *mut std::ffi::c_void) -> i32;
        fn GlobalSize(hMem: *mut std::ffi::c_void) -> usize;
        fn IsClipboardFormatAvailable(uFormat: u32) -> i32;
        fn RegisterClipboardFormatW(lpszFormat: *const u16) -> u32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(
            hDrop: *mut std::ffi::c_void,
            iFile: u32,
            lpszFile: *mut u16,
            cch: u32,
        ) -> u32;
    }

    const CF_UNICODETEXT: u32 = 13;
    /// Archivos copiados desde el explorador.
    const CF_HDROP: u32 = 15;
    /// El mapa de bits crudo de una captura de pantalla.
    const CF_DIB: u32 = 8;
    /// La version moderna del anterior, con mas datos de color.
    const CF_DIBV5: u32 = 17;
    const GMEM_MOVEABLE: u32 = 0x0002;

    pub fn read_text() -> Result<String, String> {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                return Ok(String::new());
            }
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let ptr = GlobalLock(handle) as *const u16;
            if ptr.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let text = OsString::from_wide(slice).to_string_lossy().into_owned();
            GlobalUnlock(handle);
            CloseClipboard();
            Ok(text)
        }
    }

    /// Lo que hay en el portapapeles cuando es una imagen.
    pub enum Pegado {
        /// Un archivo que ya existe en disco: se usa su ruta tal cual.
        Ruta(String),
        /// Una imagen suelta, ya convertida a PNG, que hay que guardar.
        Png(Vec<u8>),
    }

    /// Copia a un Vec el contenido de un bloque del portapapeles.
    unsafe fn bytes_de(handle: *mut std::ffi::c_void) -> Option<Vec<u8>> {
        let tam = GlobalSize(handle);
        if tam == 0 {
            return None;
        }
        let ptr = GlobalLock(handle) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let datos = std::slice::from_raw_parts(ptr, tam).to_vec();
        GlobalUnlock(handle);
        Some(datos)
    }

    /// Lee la imagen del portapapeles, si la hay.
    ///
    /// Prueba tres sitios, de mas fiable a menos:
    ///
    /// 1. Un archivo copiado en el explorador: ya esta en disco, no hay nada
    ///    que convertir.
    /// 2. El formato "PNG" que dejan los navegadores: son bytes ya listos.
    /// 3. El mapa de bits crudo de una captura de pantalla, que hay que
    ///    traducir a PNG.
    pub fn read_image() -> Result<Option<Pegado>, String> {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                return Ok(None);
            }
            let resultado = leer_imagen_abierto();
            CloseClipboard();
            Ok(resultado)
        }
    }

    /// El cuerpo de `read_image`, con el portapapeles ya abierto.
    unsafe fn leer_imagen_abierto() -> Option<Pegado> {
        if IsClipboardFormatAvailable(CF_HDROP) != 0 {
            let handle = GetClipboardData(CF_HDROP);
            if !handle.is_null() {
                // Solo el primer archivo, y solo si es una imagen.
                let largo = DragQueryFileW(handle, 0, null_mut(), 0);
                if largo > 0 {
                    let mut buf = vec![0u16; largo as usize + 1];
                    let escrito = DragQueryFileW(handle, 0, buf.as_mut_ptr(), largo + 1);
                    if escrito > 0 {
                        buf.truncate(escrito as usize);
                        let ruta = OsString::from_wide(&buf).to_string_lossy().into_owned();
                        if crate::clipboard_img::es_imagen_por_extension(&ruta) {
                            return Some(Pegado::Ruta(ruta));
                        }
                    }
                }
            }
        }

        let formato_png = {
            let nombre: Vec<u16> = OsStr::new("PNG").encode_wide().chain(Some(0)).collect();
            RegisterClipboardFormatW(nombre.as_ptr())
        };
        if formato_png != 0 && IsClipboardFormatAvailable(formato_png) != 0 {
            let handle = GetClipboardData(formato_png);
            if !handle.is_null() {
                if let Some(datos) = bytes_de(handle) {
                    return Some(Pegado::Png(datos));
                }
            }
        }

        for formato in [CF_DIBV5, CF_DIB] {
            if IsClipboardFormatAvailable(formato) == 0 {
                continue;
            }
            let handle = GetClipboardData(formato);
            if handle.is_null() {
                continue;
            }
            if let Some(datos) = bytes_de(handle) {
                if let Ok(png) = crate::clipboard_img::dib_a_png(&datos) {
                    return Some(Pegado::Png(png));
                }
            }
        }

        None
    }

    pub fn write_text(text: &str) -> Result<(), String> {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                return Err("No se pudo abrir el portapapeles".into());
            }
            EmptyClipboard();
            let wide: Vec<u16> = OsStr::new(text).encode_wide().chain(Some(0)).collect();
            let bytes = wide.len() * std::mem::size_of::<u16>();
            let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if hmem.is_null() {
                CloseClipboard();
                return Err("Fallo de asignación de memoria".into());
            }
            let ptr = GlobalLock(hmem) as *mut u16;
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
                GlobalUnlock(hmem);
                SetClipboardData(CF_UNICODETEXT, hmem);
            }
            CloseClipboard();
            Ok(())
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_clipboard {
    pub enum Pegado {
        Ruta(String),
        Png(Vec<u8>),
    }
    pub fn read_text() -> Result<String, String> { Ok(String::new()) }
    pub fn write_text(_text: &str) -> Result<(), String> { Ok(()) }
    pub fn read_image() -> Result<Option<Pegado>, String> { Ok(None) }
}

/// Si una ruta es una carpeta que existe ahora mismo.
///
/// Hace falta al soltar algo en la ventana: ahi se puede soltar cualquier cosa
/// -un archivo, un acceso directo, una carpeta que ya no esta- y solo una
/// carpeta de verdad sirve como sitio donde trabajar.
#[tauri::command]
fn path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

/// Lee el portapapeles directamente desde el sistema operativo sin disparar avisos web.
#[tauri::command]
fn clipboard_read() -> Result<String, String> {
    win_clipboard::read_text()
}

/// Escribe en el portapapeles del sistema operativo de forma nativa.
#[tauri::command]
fn clipboard_write(text: String) -> Result<(), String> {
    win_clipboard::write_text(&text)
}

/// La imagen del portapapeles, ya guardada en disco, o `None` si no hay.
///
/// Una terminal no sabe mostrar imagenes: solo texto. Pero los CLIs de IA si
/// leen una imagen si les das su ruta. Asi que al pegar una captura se guarda
/// en la carpeta temporal y lo que entra en la terminal es esa ruta.
///
/// Los archivos quedan en la carpeta temporal del sistema, que Windows limpia
/// por su cuenta; borrarlos aqui seria quitarselos al agente antes de que los
/// lea.
#[tauri::command]
fn clipboard_read_image() -> Result<Option<String>, String> {
    match win_clipboard::read_image()? {
        None => Ok(None),
        Some(win_clipboard::Pegado::Ruta(ruta)) => Ok(Some(ruta)),
        Some(win_clipboard::Pegado::Png(bytes)) => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let destino = std::env::temp_dir().join(format!("oruka-pegado-{stamp}.png"));
            std::fs::write(&destino, bytes)
                .map_err(|e| format!("no se pudo guardar la imagen pegada: {e}"))?;
            Ok(Some(destino.to_string_lossy().to_string()))
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests_portapapeles {
    /// Comprobacion de verdad contra el portapapeles de Windows.
    ///
    /// Va marcada como ignorada porque **pisa lo que el usuario tenga
    /// copiado**. Se corre a mano despues de tocar este codigo:
    ///
    ///     cargo test --lib -- --ignored --nocapture
    ///
    /// Antes de correrla, copia una imagen (por ejemplo con Win+Shift+S).
    #[test]
    #[ignore]
    fn lee_la_imagen_que_hay_copiada_ahora_mismo() {
        let resultado = super::clipboard_read_image().expect("no deberia fallar");
        let ruta = resultado.expect("copia una imagen antes de correr esta prueba");
        println!("imagen pegada en: {ruta}");

        let bytes = std::fs::read(&ruta).expect("el archivo deberia existir");
        assert!(bytes.len() > 100, "el archivo esta vacio");
        if ruta.ends_with(".png") {
            assert_eq!(
                &bytes[0..8],
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
                "deberia ser un PNG valido"
            );
        }
    }
}

#[cfg(test)]
mod tests_soltar {
    /// Lo que decide si una ruta soltada sirve como sitio de trabajo.
    #[test]
    fn distingue_una_carpeta_de_un_archivo_y_de_lo_que_no_existe() {
        let dir = std::env::temp_dir().join(format!(
            "oruka-prueba-soltar-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("deberia crearse la carpeta");
        let archivo = dir.join("suelto.txt");
        std::fs::write(&archivo, "hola").expect("deberia escribirse el archivo");

        assert!(
            super::path_is_dir(dir.to_string_lossy().to_string()),
            "una carpeta si vale"
        );
        assert!(
            !super::path_is_dir(archivo.to_string_lossy().to_string()),
            "un archivo suelto no vale"
        );
        assert!(
            !super::path_is_dir(dir.join("no-existe").to_string_lossy().to_string()),
            "lo que no existe no vale"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
