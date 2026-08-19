//! GitHub, a traves de `gh`.
//!
//! Se reutiliza `gh` si el usuario ya lo tiene autenticado, que es lo normal en
//! una maquina de desarrollo. Si no esta, la app no se rompe: lo dice y ofrece
//! el camino del token propio.
//!
//! Aqui no se habla HTTP: todo sale de `gh`, que ya resuelve autenticacion,
//! refresco de token y limites de la API. Oruka no ve nunca el token, y por eso
//! tampoco puede filtrarlo.
//!
//! Lo que se prueba son los **parsers**: la forma del JSON de GitHub es lo que
//! puede cambiar sin avisar. Las llamadas en si necesitan red y cuenta, asi que
//! se verifican a mano.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

/// Evita que cada llamada a `gh` parpadee una consola negra en Windows.
///
/// Oruka es una app de escritorio: sin esto, cada refresco de la lista de repos
/// abriria y cerraria una ventana de consola delante del usuario.
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

#[derive(Debug, Serialize, Default)]
pub struct GithubStatus {
    /// Si el binario `gh` existe en el PATH.
    pub installed: bool,
    /// Si esa instalacion tiene una sesion valida.
    pub authenticated: bool,
    pub user: Option<String>,
    pub scopes: Vec<String>,
    pub message: Option<String>,
}

pub fn status() -> GithubStatus {
    let Some(bin) = crate::registry::resolve_bin("gh") else {
        return GithubStatus {
            installed: false,
            message: Some("gh no esta instalado".into()),
            ..Default::default()
        };
    };

    let output = Command::new(&bin).args(["auth", "status"]).output();
    let Ok(output) = output else {
        return GithubStatus {
            installed: true,
            message: Some("no se pudo consultar gh".into()),
            ..Default::default()
        };
    };

    // `gh auth status` escribe en stderr en algunas versiones.
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if !text.contains("Logged in") {
        return GithubStatus {
            installed: true,
            message: Some("gh esta instalado pero sin sesion iniciada".into()),
            ..Default::default()
        };
    }

    GithubStatus {
        installed: true,
        authenticated: true,
        user: parse_user(&text),
        scopes: parse_scopes(&text),
        message: None,
    }
}

fn parse_user(text: &str) -> Option<String> {
    let line = text.lines().find(|l| l.contains("Logged in to"))?;
    // "... Logged in to github.com account NOMBRE (keyring)"
    let after = line.split("account").nth(1)?.trim();
    Some(after.split_whitespace().next()?.to_string())
}

fn parse_scopes(text: &str) -> Vec<String> {
    let Some(line) = text.lines().find(|l| l.contains("Token scopes:")) else {
        return Vec::new();
    };
    let Some(list) = line.split("Token scopes:").nth(1) else {
        return Vec::new();
    };
    list.split(',')
        .map(|s| s.trim().trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Un repositorio, ya normalizado.
///
/// GitHub devuelve dos formas distintas segun de donde se pida: `gh repo list`
/// habla en camelCase y la API REST en snake_case. Esta es la unica forma que
/// cruza hacia el front.
#[derive(Debug, Serialize, PartialEq)]
pub struct Repo {
    pub name_with_owner: String,
    pub description: Option<String>,
    pub private: bool,
    pub fork: bool,
    pub url: String,
    pub updated_at: String,
    /// `ADMIN`, `WRITE`, `READ`... Sirve para saber que se puede hacer.
    pub permission: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub url: String,
    pub draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, o nada.
    pub review_decision: Option<String>,
    pub updated_at: String,
    pub branch: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Collaborator {
    pub login: String,
    pub url: String,
    pub permission: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Invitation {
    pub id: u64,
    pub repo: String,
    pub inviter: String,
    pub permission: String,
    pub url: String,
}

/// Ejecuta `gh` y devuelve su salida, o lo que se quejo.
///
/// El error de `gh` se pasa tal cual: dice mucho mejor que nosotros que la
/// sesion caduco, que no hay red o que falta un scope.
fn gh(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let bin = crate::registry::resolve_bin("gh").ok_or("gh no esta instalado")?;
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    hide_console(&mut cmd);

    let output = cmd.output().map_err(|e| format!("no se pudo ejecutar gh: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "gh fallo sin decir por que".into()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Texto de un campo, tratando la cadena vacia como ausencia.
///
/// GitHub manda `""` en vez de `null` para una descripcion vacia, y una tarjeta
/// con una descripcion vacia se ve distinta de una sin descripcion.
fn text(value: &serde_json::Value, key: &str) -> Option<String> {
    let s = value.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// Los repos propios, tal y como los da `gh repo list --json`.
fn parse_own_repos(json: &str) -> Result<Vec<Repo>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de repos")?;
    Ok(items
        .iter()
        .filter_map(|r| {
            Some(Repo {
                name_with_owner: text(r, "nameWithOwner")?,
                description: text(r, "description"),
                private: r.get("isPrivate").and_then(|v| v.as_bool()).unwrap_or(false),
                fork: r.get("isFork").and_then(|v| v.as_bool()).unwrap_or(false),
                url: text(r, "url").unwrap_or_default(),
                updated_at: text(r, "updatedAt").unwrap_or_default(),
                permission: text(r, "viewerPermission"),
            })
        })
        .collect())
}

/// Los repos compartidos, que vienen de la API REST y hablan otro dialecto.
fn parse_shared_repos(json: &str) -> Result<Vec<Repo>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de repos")?;
    Ok(items
        .iter()
        .filter_map(|r| {
            // `permissions` es un objeto de banderas, no un nivel. Se traduce al
            // mismo vocabulario que usa `gh repo list` para no tener dos.
            let permission = r.get("permissions").and_then(|p| {
                let flag = |k: &str| p.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
                if flag("admin") {
                    Some("ADMIN".to_string())
                } else if flag("push") {
                    Some("WRITE".to_string())
                } else if flag("pull") {
                    Some("READ".to_string())
                } else {
                    None
                }
            });
            Some(Repo {
                name_with_owner: text(r, "full_name")?,
                description: text(r, "description"),
                private: r.get("private").and_then(|v| v.as_bool()).unwrap_or(false),
                fork: r.get("fork").and_then(|v| v.as_bool()).unwrap_or(false),
                url: text(r, "html_url").unwrap_or_default(),
                updated_at: text(r, "updated_at").unwrap_or_default(),
                permission,
            })
        })
        .collect())
}

fn parse_prs(json: &str) -> Result<Vec<PullRequest>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de PR")?;
    Ok(items
        .iter()
        .filter_map(|p| {
            Some(PullRequest {
                number: p.get("number")?.as_u64()?,
                title: text(p, "title").unwrap_or_default(),
                author: p
                    .get("author")
                    .and_then(|a| text(a, "login"))
                    .unwrap_or_else(|| "?".into()),
                url: text(p, "url").unwrap_or_default(),
                draft: p.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false),
                review_decision: text(p, "reviewDecision"),
                updated_at: text(p, "updatedAt").unwrap_or_default(),
                branch: text(p, "headRefName").unwrap_or_default(),
            })
        })
        .collect())
}

fn parse_collaborators(json: &str) -> Result<Vec<Collaborator>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de personas")?;
    Ok(items
        .iter()
        .filter_map(|c| {
            let permission = c.get("permissions").and_then(|p| {
                let flag = |k: &str| p.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
                if flag("admin") {
                    Some("ADMIN".to_string())
                } else if flag("push") {
                    Some("WRITE".to_string())
                } else if flag("pull") {
                    Some("READ".to_string())
                } else {
                    None
                }
            });
            Some(Collaborator {
                login: text(c, "login")?,

                url: text(c, "html_url").unwrap_or_default(),
                permission,
            })
        })
        .collect())
}

fn parse_invitations(json: &str) -> Result<Vec<Invitation>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de invitaciones")?;
    Ok(items
        .iter()
        .filter_map(|i| {
            Some(Invitation {
                id: i.get("id")?.as_u64()?,
                repo: i
                    .get("repository")
                    .and_then(|r| text(r, "full_name"))
                    .unwrap_or_default(),
                inviter: i
                    .get("inviter")
                    .and_then(|r| text(r, "login"))
                    .unwrap_or_default(),
                permission: text(i, "permissions").unwrap_or_else(|| "read".into()),
                url: text(i, "html_url").unwrap_or_default(),
            })
        })
        .collect())
}

/// De una URL de `origin` a `duenyo/repo`.
///
/// Hay que aguantar las tres formas que escupe git —HTTPS, SSH corto y SSH con
/// esquema— porque cada maquina clona como le da la gana, y ademas hosts que no
/// son github.com: si el `origin` apunta a otro sitio, aqui no hay nada que
/// mostrar y es mejor decir que no que ensenar un repo equivocado.
fn parse_origin(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = if let Some(r) = url.strip_prefix("git@") {
        // git@github.com:duenyo/repo.git
        r.replacen(':', "/", 1)
    } else if let Some(r) = url.strip_prefix("ssh://git@") {
        r.to_string()
    } else if let Some(r) = url.strip_prefix("https://") {
        r.to_string()
    } else if let Some(r) = url.strip_prefix("http://") {
        r.to_string()
    } else {
        return None;
    };

    let rest = rest.strip_suffix(".git").unwrap_or(&rest);
    let mut parts = rest.split('/').filter(|s| !s.is_empty());
    let host = parts.next()?;
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }
    let owner = parts.next()?;
    let repo = parts.next()?;
    Some(format!("{owner}/{repo}"))
}

/// Repos del usuario. `shared` cambia de fuente, no solo de filtro.
pub fn repos(shared: bool) -> Result<Vec<Repo>, String> {
    if shared {
        // `gh repo list` solo sabe de repos propios. Para aquellos en los que
        // solo se colabora hay que bajar a la API.
        let json = gh(
            &[
                "api",
                "user/repos?affiliation=collaborator,organization_member&sort=updated&per_page=100",
            ],
            None,
        )?;
        parse_shared_repos(&json)
    } else {
        let json = gh(
            &[
                "repo",
                "list",
                "--limit",
                "100",
                "--json",
                "nameWithOwner,description,isPrivate,isFork,url,updatedAt,viewerPermission",
            ],
            None,
        )?;
        parse_own_repos(&json)
    }
}

/// El repo de GitHub al que apunta el `origin` de una carpeta, si apunta a uno.
pub fn repo_for_path(path: &Path) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args(["remote", "get-url", "origin"]).current_dir(path);
    hide_console(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_origin(&String::from_utf8_lossy(&output.stdout))
}

/// Que PR se piden. Es un enum de verdad y no una cadena suelta para que anadir
/// un filtro sea un error de compilacion en todos los sitios que hay que tocar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PrFilter {
    All,
    Mine,
    Assigned,
    ReviewRequested,
}

impl PrFilter {
    /// El filtro tal y como lo escribe `gh`.
    fn args(self) -> Vec<&'static str> {
        match self {
            PrFilter::All => vec![],
            PrFilter::Mine => vec!["--author", "@me"],
            PrFilter::Assigned => vec!["--assignee", "@me"],
            // Este no tiene bandera propia: va por la sintaxis de busqueda.
            PrFilter::ReviewRequested => vec!["--search", "review-requested:@me"],
        }
    }

    pub fn from_id(id: &str) -> PrFilter {
        match id {
            "mine" => PrFilter::Mine,
            "assigned" => PrFilter::Assigned,
            "review" => PrFilter::ReviewRequested,
            _ => PrFilter::All,
        }
    }
}

pub fn pull_requests(repo: &str, filter: PrFilter) -> Result<Vec<PullRequest>, String> {
    let mut args = vec![
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,author,url,isDraft,reviewDecision,updatedAt,headRefName",
    ];
    args.extend(filter.args());
    let json = gh(&args, None)?;
    parse_prs(&json)
}

pub fn collaborators(repo: &str) -> Result<Vec<Collaborator>, String> {
    let json = gh(&["api", &format!("repos/{repo}/collaborators?per_page=100")], None)?;
    parse_collaborators(&json)
}

/// Invitaciones a colaborar que le han llegado al usuario.
pub fn invitations() -> Result<Vec<Invitation>, String> {
    let json = gh(&["api", "user/repository_invitations"], None)?;
    parse_invitations(&json)
}

/// Acepta o rechaza una invitacion recibida.
///
/// Se ve desde fuera: quien invito se entera. La interfaz pregunta antes.
pub fn respond_invitation(id: u64, accept: bool) -> Result<(), String> {
    let endpoint = format!("user/repository_invitations/{id}");
    let method = if accept { "PATCH" } else { "DELETE" };
    gh(&["api", "--method", method, &endpoint], None)?;
    Ok(())
}

/// Una invitacion que el usuario ha enviado y sigue sin contestar.
#[derive(Debug, Serialize, PartialEq)]
pub struct SentInvitation {
    pub id: u64,
    pub invitee: String,
    pub permission: String,
    pub created_at: String,
    pub url: String,
}

fn parse_sent_invitations(json: &str) -> Result<Vec<SentInvitation>, String> {
    let items: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let items = items.as_array().ok_or("se esperaba una lista de invitaciones")?;
    Ok(items
        .iter()
        .filter_map(|i| {
            Some(SentInvitation {
                id: i.get("id")?.as_u64()?,
                invitee: i.get("invitee").and_then(|p| text(p, "login"))?,
                permission: text(i, "permissions").unwrap_or_else(|| "read".into()),
                created_at: text(i, "created_at").unwrap_or_default(),
                url: text(i, "html_url").unwrap_or_default(),
            })
        })
        .collect())
}

/// Los permisos que GitHub acepta al dar acceso a alguien.
///
/// Se valida contra esta lista en vez de pasar lo que llegue: el valor acaba en
/// el cuerpo de una peticion que cambia quien puede tocar el repo.
const PERMISOS: [&str; 5] = ["pull", "triage", "push", "maintain", "admin"];

fn valid_permission(permission: &str) -> bool {
    PERMISOS.contains(&permission)
}

/// Comprueba que un nombre de usuario es de verdad un nombre de usuario.
///
/// Importa mas de lo que parece: este texto se pega dentro de la **ruta** de la
/// peticion. Un valor con barras o puntos podria apuntar a otro sitio del que
/// se pretendia, asi que se acepta solo lo que GitHub admite como login: letras,
/// numeros y guiones, sin empezar ni acabar en guion, y 39 caracteres de tope.
fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && !login.starts_with('-')
        && !login.ends_with('-')
        && login.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Igual para `duenyo/repo`, que tambien viaja dentro de la ruta.
fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    valid_login(owner)
        && !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Invita a alguien a colaborar, o le cambia el permiso si ya estaba.
///
/// GitHub no distingue las dos cosas: el mismo PUT sirve para ambas, y crea una
/// invitacion que la otra persona tiene que aceptar. Manda un correo, o sea que
/// se nota fuera de esta maquina: la interfaz pregunta antes.
pub fn invite_collaborator(repo: &str, login: &str, permission: &str) -> Result<(), String> {
    if !valid_repo(repo) {
        return Err(format!("«{repo}» no tiene forma de repositorio"));
    }
    if !valid_login(login) {
        return Err(format!("«{login}» no es un nombre de usuario de GitHub"));
    }
    if !valid_permission(permission) {
        return Err(format!("permiso desconocido: {permission}"));
    }
    gh(
        &[
            "api",
            "--method",
            "PUT",
            &format!("repos/{repo}/collaborators/{login}"),
            "-f",
            &format!("permission={permission}"),
        ],
        None,
    )?;
    Ok(())
}

/// Le quita el acceso a alguien.
pub fn remove_collaborator(repo: &str, login: &str) -> Result<(), String> {
    if !valid_repo(repo) || !valid_login(login) {
        return Err("repositorio o usuario con forma invalida".into());
    }
    gh(
        &[
            "api",
            "--method",
            "DELETE",
            &format!("repos/{repo}/collaborators/{login}"),
        ],
        None,
    )?;
    Ok(())
}

/// Invitaciones enviadas desde este repo que siguen sin contestar.
pub fn sent_invitations(repo: &str) -> Result<Vec<SentInvitation>, String> {
    if !valid_repo(repo) {
        return Err("repositorio con forma invalida".into());
    }
    let json = gh(&["api", &format!("repos/{repo}/invitations")], None)?;
    parse_sent_invitations(&json)
}

/// Retira una invitacion que aun no se ha aceptado.
pub fn cancel_invitation(repo: &str, id: u64) -> Result<(), String> {
    if !valid_repo(repo) {
        return Err("repositorio con forma invalida".into());
    }
    gh(
        &[
            "api",
            "--method",
            "DELETE",
            &format!("repos/{repo}/invitations/{id}"),
        ],
        None,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Muestra real de `gh repo list --json`, recortada.
    const OWN: &str = r#"[{"description":"","isFork":false,"isPrivate":true,"nameWithOwner":"alguien/appsandroid","updatedAt":"2026-08-18T00:56:14Z","url":"https://github.com/alguien/appsandroid","viewerPermission":"ADMIN"},{"description":"Un ERP","isFork":true,"isPrivate":false,"nameWithOwner":"alguien/erp","updatedAt":"2026-08-08T18:45:36Z","url":"https://github.com/alguien/erp","viewerPermission":"WRITE"}]"#;

    #[test]
    fn lee_los_repos_propios() {
        let repos = parse_own_repos(OWN).expect("parsea");
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].name_with_owner, "alguien/appsandroid");
        assert!(repos[0].private);
        assert!(!repos[0].fork);
        assert_eq!(repos[0].permission.as_deref(), Some("ADMIN"));
        assert!(repos[1].fork);
    }

    /// Una descripcion vacia no es lo mismo que no tener descripcion.
    #[test]
    fn la_descripcion_vacia_se_trata_como_ausente() {
        let repos = parse_own_repos(OWN).expect("parsea");
        assert_eq!(repos[0].description, None);
        assert_eq!(repos[1].description.as_deref(), Some("Un ERP"));
    }

    /// La API REST habla snake_case y da permisos como banderas, no como nivel.
    #[test]
    fn traduce_los_permisos_de_la_api_al_mismo_vocabulario() {
        let shared = r#"[
          {"full_name":"otra/uno","private":true,"fork":false,"html_url":"https://github.com/otra/uno","updated_at":"2026-08-01T00:00:00Z","description":null,"permissions":{"admin":false,"push":true,"pull":true}},
          {"full_name":"otra/dos","private":false,"fork":false,"html_url":"https://github.com/otra/dos","updated_at":"2026-08-02T00:00:00Z","description":"lectura","permissions":{"admin":false,"push":false,"pull":true}}
        ]"#;
        let repos = parse_shared_repos(shared).expect("parsea");
        assert_eq!(repos[0].permission.as_deref(), Some("WRITE"));
        assert_eq!(repos[1].permission.as_deref(), Some("READ"));
        assert_eq!(repos[0].description, None);
    }

    /// Las dos fuentes tienen que acabar en la misma forma.
    #[test]
    fn las_dos_fuentes_dan_la_misma_forma() {
        let propio = &parse_own_repos(OWN).expect("parsea")[0];
        let compartido = r#"[{"full_name":"alguien/appsandroid","private":true,"fork":false,"html_url":"https://github.com/alguien/appsandroid","updated_at":"2026-08-18T00:56:14Z","description":"","permissions":{"admin":true,"push":true,"pull":true}}]"#;
        let compartido = &parse_shared_repos(compartido).expect("parsea")[0];
        assert_eq!(propio, compartido, "el front no puede notar de donde vino");
    }

    #[test]
    fn lee_los_pr_con_su_autor_y_su_estado() {
        let json = r#"[{"number":7,"title":"Arreglar el login","author":{"login":"alguien"},"url":"https://github.com/o/r/pull/7","isDraft":true,"reviewDecision":"CHANGES_REQUESTED","updatedAt":"2026-08-18T10:00:00Z","headRefName":"fix/login"}]"#;
        let prs = parse_prs(json).expect("parsea");
        assert_eq!(prs[0].number, 7);
        assert_eq!(prs[0].author, "alguien");
        assert!(prs[0].draft);
        assert_eq!(prs[0].review_decision.as_deref(), Some("CHANGES_REQUESTED"));
        assert_eq!(prs[0].branch, "fix/login");
    }

    /// Un PR sin revision pedida no trae el campo: no puede romper la lista.
    #[test]
    fn un_pr_sin_revision_no_rompe() {
        let json = r#"[{"number":1,"title":"x","author":{"login":"a"},"url":"u","isDraft":false,"reviewDecision":"","updatedAt":"","headRefName":"main"}]"#;
        let prs = parse_prs(json).expect("parsea");
        assert_eq!(prs[0].review_decision, None);
    }

    #[test]
    fn lee_colaboradores_e_invitaciones() {
        let colabs = r#"[{"login":"alguien","html_url":"https://github.com/alguien","permissions":{"admin":true,"push":true,"pull":true}}]"#;
        let c = parse_collaborators(colabs).expect("parsea");
        assert_eq!(c[0].login, "alguien");
        assert_eq!(c[0].permission.as_deref(), Some("ADMIN"));

        let invs = r#"[{"id":42,"repository":{"full_name":"otra/repo"},"inviter":{"login":"jefa"},"permissions":"write","html_url":"https://github.com/otra/repo/invitations"}]"#;
        let i = parse_invitations(invs).expect("parsea");
        assert_eq!(i[0].id, 42);
        assert_eq!(i[0].repo, "otra/repo");
        assert_eq!(i[0].inviter, "jefa");
        assert_eq!(i[0].permission, "write");
    }

    /// Una lista vacia es lo normal, no un error: casi nadie tiene invitaciones.
    #[test]
    fn una_lista_vacia_no_es_un_error() {
        assert!(parse_own_repos("[]").expect("parsea").is_empty());
        assert!(parse_prs("[]").expect("parsea").is_empty());
        assert!(parse_invitations("[]").expect("parsea").is_empty());
        assert!(parse_collaborators("[]").expect("parsea").is_empty());
    }

    /// Cada maquina clona como quiere; las tres formas tienen que valer.
    #[test]
    fn reconoce_las_tres_formas_de_clonar() {
        let esperado = Some("duenyo/repo".to_string());
        assert_eq!(parse_origin("https://github.com/duenyo/repo.git"), esperado);
        assert_eq!(parse_origin("https://github.com/duenyo/repo"), esperado);
        assert_eq!(parse_origin("git@github.com:duenyo/repo.git"), esperado);
        assert_eq!(parse_origin("ssh://git@github.com/duenyo/repo.git"), esperado);
        // Con salto de linea, que es como lo devuelve git.
        assert_eq!(parse_origin("https://github.com/duenyo/repo.git\n"), esperado);
    }

    /// Si el origin no es de GitHub, mejor no ensenar nada que ensenar algo mal.
    #[test]
    fn un_origin_que_no_es_de_github_no_cuela() {
        assert_eq!(parse_origin("https://gitlab.com/duenyo/repo.git"), None);
        assert_eq!(parse_origin("git@bitbucket.org:duenyo/repo.git"), None);
        assert_eq!(parse_origin("/una/carpeta/local"), None);
        assert_eq!(parse_origin(""), None);
    }

    /// El filtro de revision no es una bandera de gh, va por la busqueda.
    #[test]
    fn cada_filtro_se_traduce_a_lo_que_entiende_gh() {
        assert!(PrFilter::All.args().is_empty());
        assert_eq!(PrFilter::Mine.args(), vec!["--author", "@me"]);
        assert_eq!(PrFilter::Assigned.args(), vec!["--assignee", "@me"]);
        assert_eq!(
            PrFilter::ReviewRequested.args(),
            vec!["--search", "review-requested:@me"]
        );
        assert_eq!(PrFilter::from_id("review"), PrFilter::ReviewRequested);
        assert_eq!(PrFilter::from_id("cualquier-cosa"), PrFilter::All);
    }

    #[test]
    fn lee_las_invitaciones_que_siguen_sin_contestar() {
        let json = r#"[{"id":9,"invitee":{"login":"alguien"},"permissions":"write","created_at":"2026-08-18T00:56:14Z","html_url":"https://github.com/o/r/invitations"}]"#;
        let list = parse_sent_invitations(json).expect("parsea");
        assert_eq!(list[0].id, 9);
        assert_eq!(list[0].invitee, "alguien");
        assert_eq!(list[0].permission, "write");
    }

    /// El login se pega dentro de la RUTA de la peticion. Si colara una barra,
    /// se podria acabar llamando a un endpoint distinto del que se cree.
    #[test]
    fn un_login_no_puede_llevar_la_peticion_a_otro_sitio() {
        assert!(valid_login("alguien"));
        assert!(valid_login("con-guion"));
        assert!(valid_login("a1b2c3"));

        assert!(!valid_login("con/barra"));
        assert!(!valid_login("../otro"));
        assert!(!valid_login("con espacio"));
        assert!(!valid_login("-empieza-en-guion"));
        assert!(!valid_login("acaba-en-guion-"));
        assert!(!valid_login(""));
        assert!(!valid_login(&"x".repeat(40)));
    }

    #[test]
    fn un_repo_tiene_que_ser_duenyo_barra_nombre() {
        assert!(valid_repo("duenyo/repo"));
        assert!(valid_repo("duenyo/repo.con.puntos"));
        assert!(valid_repo("duenyo/repo_con_guion_bajo"));

        assert!(!valid_repo("solo-nombre"));
        assert!(!valid_repo("de/mas/partes"));
        assert!(!valid_repo("duenyo/"));
        assert!(!valid_repo("/repo"));
        assert!(!valid_repo("duenyo/repo?a=1"));
    }

    /// Dar acceso es lo que mas duele si sale mal: solo el vocabulario de GitHub.
    #[test]
    fn solo_valen_los_permisos_que_entiende_github() {
        for p in ["pull", "triage", "push", "maintain", "admin"] {
            assert!(valid_permission(p), "{p} deberia valer");
        }
        assert!(!valid_permission("owner"));
        assert!(!valid_permission("ADMIN"));
        assert!(!valid_permission(""));
    }

    /// Antes de tocar la red se rechaza lo que tiene mala forma.
    #[test]
    fn no_se_llama_a_la_red_con_datos_con_mala_forma() {
        assert!(invite_collaborator("mal", "alguien", "push").is_err());
        assert!(invite_collaborator("duenyo/repo", "con/barra", "push").is_err());
        assert!(invite_collaborator("duenyo/repo", "alguien", "dios").is_err());
        assert!(remove_collaborator("duenyo/repo", "../otro").is_err());
        assert!(cancel_invitation("sin-barra", 1).is_err());
    }

    #[test]
    fn extrae_usuario_y_scopes_de_la_salida_de_gh() {
        let sample = "github.com\n  Logged in to github.com account alguien (keyring)\n  - Active account: true\n  - Token scopes: 'gist', 'read:org', 'repo'\n";
        assert_eq!(parse_user(sample).as_deref(), Some("alguien"));
        assert_eq!(parse_scopes(sample), vec!["gist", "read:org", "repo"]);
    }

    #[test]
    fn sin_sesion_no_inventa_usuario() {
        let sample = "You are not logged into any GitHub hosts.";
        assert!(parse_user(sample).is_none());
        assert!(parse_scopes(sample).is_empty());
    }
}
