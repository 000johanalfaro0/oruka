//! Nucleo de Oruka.
//!
//! Cada capacidad vive detras de un modulo con una superficie estrecha de
//! comandos. El front nunca habla con procesos, ficheros de configuracion ni
//! con la red: siempre a traves de uno de estos comandos.

mod github;
mod mcp;
mod ports;
mod projects;
mod pty;
pub mod registry;
mod roles;
mod store;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use pty::{PtyManager, SharedPty};
use registry::DetectedCli;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(PtyManager::default()))
        .invoke_handler(tauri::generate_handler![
            app_version,
            store_get,
            store_set,
            store_remove,
            store_seed,
            detect_clis,
            github_status,
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
            mcp_state,
            mcp_preview,
            mcp_apply,
            mcp_revert,
            roles_plan,
            roles_apply,
            roles_revert,
            list_projects,
            agent_spawn,
            agent_write,
            agent_resize,
            agent_kill,
            agent_scrollback,
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
    let tokens = manifest.tokens.as_ref().map(|t| t.after.clone());
    manager.spawn(app, id, &program, &args, &cwd_path, cols, rows, tokens)
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
