//! Registro de CLIs de IA.
//!
//! Cada CLI es un manifiesto JSON incrustado en el binario, no codigo. Anadir
//! uno nuevo es anadir un JSON; el usuario puede cargar los suyos desde disco.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

/// Manifiesto tal y como viene en el JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliManifest {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub detect: Detect,
    pub launch: Launch,
    pub modes: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub resume: Vec<String>,
    #[serde(default)]
    pub prompt: Option<PromptSpec>,
    /// Como reconocer en su salida lo que lleva gastado.
    #[serde(default)]
    pub usage: Option<UsageSpec>,
    /// Rol de fabrica frente a los demas agentes.
    ///
    /// Es un valor por defecto, igual que los modos: el usuario lo cambia y su
    /// version es la que se escribe. Un manifiesto sin este campo no participa
    /// en el reparto, que es lo correcto para un CLI propio recien anadido.
    #[serde(default)]
    pub roles: Option<crate::roles::RoleSpec>,
    /// Como se instala este CLI, si sabemos hacerlo.
    ///
    /// Es dato y no codigo a proposito: cada uno se instala distinto (npm,
    /// instalador propio, binario nativo) y adivinarlo seria peor que no
    /// ofrecerlo. **Un manifiesto sin este campo no ofrece instalarse**, que es
    /// lo honesto cuando no sabemos el comando.
    #[serde(default)]
    pub install: Option<InstallSpec>,
}

/// El comando exacto que instala un CLI.
///
/// El usuario lo ve entero antes de que se ejecute: instalar algo en el equipo
/// es mas serio que escribir en un archivo de configuracion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// Donde mirar para saber el gasto de una sesion.
///
/// Oruka solo ve el texto que el CLI pinta: no hay ninguna API que le diga el
/// consumo. Asi que se declara la **marca** que precede al numero y el resto lo
/// hace un escaner generico. Es dato y no codigo a proposito: si un CLI cambia
/// su formato, se corrige un JSON y no se recompila nada.
///
/// No se usa una expresion regular para no arrastrar esa dependencia por algo
/// tan simple: con la marca y el primer numero que venga detras basta.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSpec {
    /// Texto literal que acompaña a la cifra.
    pub marker: String,
    /// Donde esta la cifra respecto a la marca: "after" o "before".
    ///
    /// Hacen falta las dos. claude escribe "You've used 82% of your weekly
    /// limit", con la cifra detras; codex escribe "100% context left", con la
    /// cifra delante. Suponer solo una de las dos deja fuera a la mitad.
    pub number: String,
    /// "percent" o "tokens". Cambia como se pinta, no como se busca.
    pub unit: String,
    /// Que es esa cifra, en cristiano. Va junto a la barra.
    pub label: String,
    /// "used" si sube al gastar, "left" si baja.
    ///
    /// No es cosmetico: con "left" la barra se llena al reves, y el aviso de
    /// que queda poco salta en el extremo contrario.
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Detect {
    pub bin: String,
    #[serde(default)]
    pub version_args: Option<Vec<String>>,
    #[serde(rename = "versionArgs", default)]
    pub version_args_camel: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Launch {
    #[serde(default)]
    pub args: Vec<String>,
    /// Como se le pasa el directorio: "process", "flag" o "positional".
    pub cwd: String,
    #[serde(rename = "cwdFlag", default)]
    pub cwd_flag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSpec {
    pub via: String,
    #[serde(default)]
    pub flag: Option<String>,
    #[serde(default)]
    pub subcommand: Option<String>,
}

/// Un CLI ya resuelto contra el sistema.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedCli {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub modes: Vec<String>,
    /// Si sabe retomar una conversacion anterior.
    ///
    /// Lo necesita la interfaz para no ofrecer «continuar» a un CLI que no
    /// puede: un boton que siempre falla es peor que no tener boton.
    pub can_resume: bool,
    /// Rol de fabrica, si el manifiesto lo trae.
    ///
    /// Lo necesita el front para proponer un reparto sin inventarselo. Un CLI
    /// sin rol declarado no sale en la pantalla de roles.
    pub role: Option<crate::roles::RoleSpec>,
    /// Como lee este CLI su propio gasto, si lo publica.
    ///
    /// Lo necesita el front para pintar la barra con su etiqueta y su sentido.
    /// Un CLI que no diga nada no tiene barra, en vez de tener una a cero.
    pub usage: Option<UsageSpec>,
    /// El comando que lo instalaria, si se sabe. La interfaz lo enseña antes
    /// de ejecutarlo y no ofrece boton a quien no lo declare.
    pub install: Option<InstallSpec>,
}

/// Manifiestos de fabrica.
fn builtin_manifests() -> Vec<CliManifest> {
    const SOURCES: [&str; 4] = [
        include_str!("../../packages/adapters/claude.json"),
        include_str!("../../packages/adapters/codex.json"),
        include_str!("../../packages/adapters/agy.json"),
        include_str!("../../packages/adapters/opencode.json"),
    ];
    SOURCES
        .iter()
        .filter_map(|s| match serde_json::from_str::<CliManifest>(s) {
            Ok(m) => Some(m),
            Err(e) => {
                eprintln!("manifiesto invalido, se ignora: {e}");
                None
            }
        })
        .collect()
}

impl CliManifest {
    fn version_args(&self) -> Vec<String> {
        self.detect
            .version_args_camel
            .clone()
            .or_else(|| self.detect.version_args.clone())
            .unwrap_or_else(|| vec!["--version".into()])
    }
}

/// Las carpetas del PATH **de verdad**, no solo las heredadas.
///
/// En Windows un programa hereda una copia del PATH de quien lo lanzo, y el
/// Explorador se queda con la suya desde que inicias sesion. Si instalas algo
/// despues —`gh`, `uv`, un agente— queda en el PATH del sistema pero **no en el
/// de la app**, que sigue con la foto vieja. El sintoma es desconcertante:
/// winget dice "ya esta instalado" y Oruka insiste en que falta.
///
/// Por eso se consulta el registro, que es donde vive el PATH real. Se lee en
/// cada llamada a proposito: cachearlo reintroduce el mismo problema en cuanto
/// el usuario instala algo con la app abierta, que es justo el caso que se
/// quiere cubrir.
#[cfg(windows)]
fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for (raiz, clave) in [
        ("HKLM", r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        ("HKCU", "Environment"),
    ] {
        let mut cmd = Command::new("reg");
        cmd.args(["query", &format!("{raiz}\\{clave}"), "/v", "Path"]);
        hide_console(&mut cmd);
        let Ok(salida) = cmd.output() else { continue };
        let texto = String::from_utf8_lossy(&salida.stdout);
        // La linea es "    Path    REG_EXPAND_SZ    C:algo;C:otro"
        let Some(linea) = texto.lines().find(|l| l.trim_start().starts_with("Path")) else {
            continue;
        };
        let Some(valor) = linea.split_whitespace().nth(2).map(|_| {
            let mut partes = linea.trim().splitn(3, char::is_whitespace);
            partes.nth(2).unwrap_or("").trim().to_string()
        }) else {
            continue;
        };
        for tramo in valor.split(';') {
            let tramo = tramo.trim();
            if tramo.is_empty() {
                continue;
            }
            // Los valores REG_EXPAND_SZ traen %VARIABLES% sin expandir.
            let expandido = expandir(tramo);
            let ruta = PathBuf::from(&expandido);
            if ruta.is_dir() && !dirs.contains(&ruta) {
                dirs.push(ruta);
            }
        }
    }
    dirs
}

/// Sustituye `%VAR%` por su valor. Lo que no exista se deja tal cual.
#[cfg(windows)]
fn expandir(texto: &str) -> String {
    let mut out = String::with_capacity(texto.len());
    let mut resto = texto;
    while let Some(i) = resto.find('%') {
        out.push_str(&resto[..i]);
        let tras = &resto[i + 1..];
        match tras.find('%') {
            Some(j) => {
                let nombre = &tras[..j];
                match std::env::var(nombre) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(nombre);
                        out.push('%');
                    }
                }
                resto = &tras[j + 1..];
            }
            None => {
                out.push('%');
                resto = tras;
                break;
            }
        }
    }
    out.push_str(resto);
    out
}

#[cfg(not(windows))]
fn extra_path_dirs() -> Vec<PathBuf> {
    Vec::new()
}

/// Busca un ejecutable en el PATH.
///
/// En Windows los CLIs instalados por npm son shims `.cmd`/`.ps1`, no `.exe`.
/// Se prefiere `.cmd` porque es lo unico que se puede lanzar de forma fiable.
pub fn resolve_bin(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(windows) {
        vec![".exe".into(), ".cmd".into(), ".bat".into(), "".into()]
    } else {
        vec!["".into()]
    };

    // Primero lo heredado, que es lo barato; y si no aparece, el PATH real del
    // sistema, que puede tener cosas instaladas despues de arrancar la app.
    let heredadas: Vec<PathBuf> = std::env::split_paths(&path).collect();
    for dir in heredadas.into_iter().chain(extra_path_dirs()) {
        for ext in &exts {
            let candidate = dir.join(format!("{bin}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn read_version(path: &PathBuf, args: &[String]) -> Option<String> {
    let output = build_command(path, args).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(line.trim().chars().take(60).collect())
}

/// Construye el comando teniendo en cuenta los shims de Windows.
fn build_command(path: &PathBuf, args: &[String]) -> Command {
    let is_script = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);

    let mut cmd = if cfg!(windows) && is_script {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(path);
        cmd
    } else {
        Command::new(path)
    };
    cmd.args(args);
    hide_console(&mut cmd);
    cmd
}

/// Evita que detectar los CLIs abra una consola por cada uno.
///
/// Sin esto, entrar en Ajustes lanzaba `--version` de cada CLI y cada uno
/// parpadeaba su propia ventana negra delante del usuario.
#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_cmd: &mut Command) {}

/// Detecta todos los CLIs conocidos en este sistema.
pub fn detect_all() -> Vec<DetectedCli> {
    builtin_manifests()
        .into_iter()
        .map(|m| {
            let path = resolve_bin(&m.detect.bin);
            let version = path.as_ref().and_then(|p| read_version(p, &m.version_args()));
            let mut modes: Vec<String> = m.modes.keys().cloned().collect();
            modes.sort();
            let role = m.roles.clone();
            let usage = m.usage.clone();
            let install = m.install.clone();
            DetectedCli {
                id: m.id,
                name: m.name,
                icon: m.icon,
                found: path.is_some(),
                path: path.map(|p| p.to_string_lossy().to_string()),
                version,
                modes,
                can_resume: !m.resume.is_empty(),
                role,
                usage,
                install,
            }
        })
        .collect()
}

/// Instala un CLI ejecutando lo que declare su manifiesto.
///
/// Devuelve la salida completa, con lo bueno y lo malo juntos: cuando una
/// instalacion falla, el motivo casi siempre esta en la salida de error, y
/// tragarsela dejaria al usuario con un "no se pudo" sin nada mas.
///
/// No inventa nada. Si el manifiesto no declara como instalarse, se dice y ya.
pub fn install(id: &str) -> Result<String, String> {
    let m = manifest(id).ok_or_else(|| format!("no hay manifiesto para {id}"))?;
    let spec = m
        .install
        .ok_or_else(|| format!("{} no declara como instalarse", m.name))?;

    // En Windows npm y npx son shims .cmd, que CreateProcess no ejecuta: hay
    // que pasar por cmd.exe. Es la misma trampa que con los CLIs de agente.
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&spec.command);
        c
    } else {
        Command::new(&spec.command)
    };
    cmd.args(&spec.args);
    hide_console(&mut cmd);

    let salida = cmd
        .output()
        .map_err(|e| format!("no se pudo lanzar {}: {e}", spec.command))?;
    let texto = format!(
        "{}{}",
        String::from_utf8_lossy(&salida.stdout),
        String::from_utf8_lossy(&salida.stderr)
    );
    if salida.status.success() {
        Ok(texto)
    } else {
        Err(if texto.trim().is_empty() {
            format!("la instalacion fallo con codigo {:?}", salida.status.code())
        } else {
            texto
        })
    }
}

/// Devuelve el manifiesto de un CLI por su id.
pub fn manifest(id: &str) -> Option<CliManifest> {
    builtin_manifests().into_iter().find(|m| m.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_manifiestos_de_fabrica_son_validos() {
        let manifests = builtin_manifests();
        assert_eq!(manifests.len(), 4, "deberian cargarse los 4 manifiestos");
        for m in &manifests {
            assert!(!m.id.is_empty());
            assert!(!m.detect.bin.is_empty());
            assert!(
                m.modes.contains_key("default"),
                "{} necesita un modo default",
                m.id
            );
        }
    }

    #[test]
    fn los_modos_yolo_llevan_flags_reales() {
        // Si un CLI declara modo yolo, tiene que traer argumentos: un yolo vacio
        // seria mentirle al usuario sobre los permisos.
        for m in builtin_manifests() {
            if let Some(args) = m.modes.get("yolo") {
                assert!(!args.is_empty(), "{} declara yolo sin flags", m.id);
            }
        }
    }

    #[test]
    fn detecta_los_clis_del_sistema() {
        let found: Vec<_> = detect_all().into_iter().filter(|c| c.found).collect();
        for cli in &found {
            println!("detectado: {} -> {:?}", cli.name, cli.path);
            assert!(cli.path.is_some());
        }
        assert!(!found.is_empty(), "no se detecto ningun CLI en este sistema");
    }
}

#[cfg(test)]
mod tests_path {
    use super::*;

    #[test]
    fn el_path_del_registro_trae_carpetas_de_verdad() {
        // En Windows tiene que devolver algo y todo tiene que existir: una
        // carpeta inventada haria que resolve_bin buscara donde no hay nada.
        let dirs = extra_path_dirs();
        if cfg!(windows) {
            assert!(!dirs.is_empty(), "el registro deberia dar alguna carpeta");
        }
        for d in &dirs {
            assert!(d.is_dir(), "{} no existe", d.display());
        }
    }

    #[cfg(windows)]
    #[test]
    fn las_variables_se_expanden_y_lo_desconocido_se_respeta() {
        // Los valores del registro traen %VARIABLES% sin resolver.
        std::env::set_var("ORUKA_PRUEBA_X", "valor");
        assert_eq!(expandir("a%ORUKA_PRUEBA_X%b"), "avalorb");
        // Lo que no existe se deja tal cual en vez de desaparecer: una ruta a
        // medias es peor que una ruta que no resuelve.
        assert_eq!(expandir("%NO_EXISTE_JAMAS%"), "%NO_EXISTE_JAMAS%");
        assert_eq!(expandir("sin variables"), "sin variables");
        assert_eq!(expandir("a%suelto"), "a%suelto");
    }
}
