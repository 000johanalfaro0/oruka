//! Servicio 9Router.
//!
//! No es un CLI interactivo como los que gestiona `pty.rs`: es un servidor
//! local con su propio panel web, que se prende y se apaga como cualquier
//! programa de fondo. Oruka lo instala, lo arranca, lo para, y abre su panel
//! -no reconstruye esa pantalla aqui dentro.
//!
//! Los otros 4 CLIs (Claude, Codex, Gemini/Agy, Opencode) **no** hablan
//! todavia a traves de este servicio: eso pide una variable de entorno nueva
//! por manifiesto que hoy no existe, y queda para un plan aparte.

use crate::registry::{build_command, resolve_bin};
use crate::store;
use rand::Rng;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const BIN: &str = "9router";
const PORT: u16 = 20128;
/// Cuantas lineas de log se guardan. Basta para ver un fallo de arranque sin
/// que crezca sin techo mientras el servicio lleva horas corriendo.
const LOG_LINES: usize = 200;

struct Running {
    child: Child,
    log: Arc<Mutex<Vec<String>>>,
}

#[derive(Default)]
pub struct RouterState(Mutex<Option<Running>>);
pub type SharedRouter = Arc<RouterState>;

#[derive(Serialize, Clone)]
pub struct RouterStatus {
    pub installed: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub log: Vec<String>,
}

pub fn status(state: &SharedRouter) -> RouterStatus {
    let installed = resolve_bin(BIN).is_some();
    let guard = state.0.lock().unwrap();
    match &*guard {
        Some(r) => RouterStatus {
            installed,
            running: true,
            port: Some(PORT),
            log: r.log.lock().unwrap().clone(),
        },
        None => RouterStatus {
            installed,
            running: false,
            port: None,
            log: vec![],
        },
    }
}

/// Instala 9Router por npm. Mismo trato que `registry::install`: la ruta se
/// resuelve antes de lanzar nada, nunca se confia en el PATH heredado a
/// medio configurar.
pub fn install() -> Result<String, String> {
    let ruta =
        resolve_bin("npm").ok_or_else(|| "no se encontro «npm» en este equipo".to_string())?;
    let args = ["install".to_string(), "-g".to_string(), "9router".to_string()];
    let salida = build_command(&ruta, &args)
        .output()
        .map_err(|e| format!("no se pudo lanzar npm: {e}"))?;
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

fn random_secret(len: usize) -> String {
    const ALFABETO: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| ALFABETO[rng.gen_range(0..ALFABETO.len())] as char)
        .collect()
}

/// La llave del servidor y la contrasena inicial, generadas una sola vez.
///
/// Se guardan en el mismo almacen que el resto de Oruka (`store.rs`) y quedan
/// fijas para siempre: regenerarlas dejaria fuera a quien ya hubiera iniciado
/// sesion en el panel de 9Router con la contrasena anterior.
fn credentials(app: &AppHandle) -> Result<(String, String), String> {
    const JWT_KEY: &str = "oruka.router.jwt";
    const PASSWORD_KEY: &str = "oruka.router.password";

    let jwt = match store::get(app, JWT_KEY)? {
        Some(v) => v,
        None => {
            let v = random_secret(48);
            store::set(app, JWT_KEY, &v)?;
            v
        }
    };
    let password = match store::get(app, PASSWORD_KEY)? {
        Some(v) => v,
        None => {
            let v = random_secret(16);
            store::set(app, PASSWORD_KEY, &v)?;
            v
        }
    };
    Ok((jwt, password))
}

/// La contrasena inicial guardada, para ensenarsela al usuario en la interfaz
/// la primera vez que instala el servicio. No hay forma de recuperarla si se
/// pierde -no es un secreto que Oruka pueda mostrar dos veces con confianza
/// despues de que el usuario ya la haya cambiado dentro del propio 9Router.
pub fn initial_password(app: &AppHandle) -> Result<String, String> {
    Ok(credentials(app)?.1)
}

pub fn start(app: &AppHandle, state: &SharedRouter) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }

    let ruta = resolve_bin(BIN).ok_or_else(|| "9Router no esta instalado".to_string())?;
    let (jwt, password) = credentials(app)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sin directorio de datos: {e}"))?
        .join("9router");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("no se pudo crear {data_dir:?}: {e}"))?;

    let mut cmd = build_command(&ruta, &[]);
    cmd.env("JWT_SECRET", &jwt)
        .env("INITIAL_PASSWORD", &password)
        .env("DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PORT", PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("NEXT_PUBLIC_BASE_URL", format!("http://127.0.0.1:{PORT}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("no se pudo arrancar 9Router: {e}"))?;
    let log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let pid = child.id();

    // Un hilo por canal: sin leerlos, un proceso que escribe mucho se bloquea
    // esperando a que alguien vacie la tuberia.
    let streams: [Option<Box<dyn Read + Send>>; 2] = [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
    ];
    for stream in streams.into_iter().flatten() {
        let log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let mut buf = log.lock().unwrap();
                buf.push(line);
                if buf.len() > LOG_LINES {
                    let sobra = buf.len() - LOG_LINES;
                    buf.drain(..sobra);
                }
            }
        });
    }

    // Hilo vigia: si el proceso muere solo (puerto ocupado, fallo de arranque),
    // hay que enterarse y avisar al front. Mismo papel que el vigia de cada
    // sesion PTY, sin nada de terminal.
    let app_evt = app.clone();
    let state_watch: SharedRouter = state.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut guard = state_watch.0.lock().unwrap();
        let sigue_este = match &mut *guard {
            Some(r) if r.child.id() == pid => matches!(r.child.try_wait(), Ok(None)),
            _ => false,
        };
        if !sigue_este {
            if matches!(&*guard, Some(r) if r.child.id() == pid) {
                *guard = None;
            }
            drop(guard);
            let _ = app_evt.emit("router-status-changed", ());
            break;
        }
    });

    *guard = Some(Running { child, log });
    drop(guard);
    let _ = app.emit("router-status-changed", ());
    Ok(())
}

/// Abre el panel web de 9Router en el navegador del sistema.
///
/// Sin parametro de URL desde el front a proposito: la direccion es fija
/// (nuestro propio puerto local), asi que no hay nada que validar ni que
/// pueda usarse para abrir otra cosa.
pub fn open_panel() -> Result<(), String> {
    let url = format!("http://127.0.0.1:{PORT}");
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
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

pub fn stop(app: &AppHandle, state: &SharedRouter) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut running) = guard.take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
    drop(guard);
    let _ = app.emit("router-status-changed", ());
    Ok(())
}
