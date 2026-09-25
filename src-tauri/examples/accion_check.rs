//! Que escribe cada agente en pantalla cuando de verdad edita un archivo.
//!
//! Hermano de `token_check.rs`, mismo problema: Oruka no tiene forma de
//! preguntarle a un agente que archivo toco ni por que. Solo ve el texto que
//! pinta en la terminal. Este ejemplo lanza el agente en modo sin
//! confirmaciones dentro de una carpeta descartable, le pide un cambio
//! concreto y guarda **todo lo que escribio, con sus secuencias de escape**,
//! para poder mirarlo a ojo antes de programar un lector.
//!
//! **Consume cuota real** y **edita un archivo de verdad** (en la carpeta
//! descartable, nunca en este repositorio). Se ejecuta a mano:
//!
//!     cargo run --example accion_check -- claude
//!     cargo run --example accion_check -- codex
//!     cargo run --example accion_check -- claude 90

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// La carpeta descartable donde el agente va a editar de verdad.
///
/// A proposito NO es `std::env::temp_dir()`: codex se queda pidiendo permiso
/// para confiar en un directorio temporal y nunca llega a haber sesion (ver
/// `token_check.rs`). Una carpeta real, aunque sea de usar y tirar, arranca
/// directo.
fn carpeta_descartable() -> PathBuf {
    let base = dirs_desktop().join("oruka-captura-descartable");
    std::fs::create_dir_all(&base).expect("crear carpeta descartable");
    let archivo = base.join("hola.txt");
    if !archivo.exists() {
        std::fs::write(&archivo, "hola mundo\nesta es una linea de prueba\n")
            .expect("escribir hola.txt");
    }
    base
}

fn dirs_desktop() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Desktop")
}

/// Lanza el agente en modo sin confirmaciones, le pide un cambio concreto y
/// devuelve todo lo que haya escrito, sin limpiar nada.
fn preguntar(cmd: CommandBuilder, mensaje: &str, segundos: u64) -> String {
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let writer = std::sync::Arc::new(std::sync::Mutex::new(
        pair.master.take_writer().expect("writer"),
    ));
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    let respondedor = std::sync::Arc::clone(&writer);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            if buf[..n].windows(4).any(|w| w == b"\x1b[6n") {
                if let Ok(mut w) = respondedor.lock() {
                    let _ = w.write_all(b"\x1b[1;1R");
                    let _ = w.flush();
                }
            }
            if tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let mut out: Vec<u8> = Vec::new();

    // Fase 1: dejarle montar su interfaz.
    let arranque = std::time::Instant::now() + Duration::from_secs(8);
    while std::time::Instant::now() < arranque {
        if let Ok(t) = rx.recv_timeout(Duration::from_millis(300)) {
            out.extend_from_slice(&t);
        }
    }

    // Fase 1b: la primera vez que abre una carpeta nueva, algunos agentes
    // preguntan si confias en ella con un menu de flechas, incluso en modo
    // sin confirmaciones. Sin esto se quedan ahi para siempre.
    // Ojo: `sin_escapes` quita tambien los "cursor forward" (ESC[1C) que estos
    // menus usan en vez de espacios normales entre palabras, asi que el texto
    // limpio queda pegado ("trustthisfolder"). Por eso se busca cada palabra
    // suelta, no la frase entera.
    let vista = sin_escapes(&String::from_utf8_lossy(&out)).to_lowercase();
    if (vista.contains("trust") && vista.contains("folder")) || vista.contains("confias") {
        if let Ok(mut w) = writer.lock() {
            let _ = w.write_all(b"\x1b[B"); // flecha abajo: "Yes, I trust this folder"
            let _ = w.write_all(b"\r");
            let _ = w.flush();
        }
        let espera_menu = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < espera_menu {
            if let Ok(t) = rx.recv_timeout(Duration::from_millis(300)) {
                out.extend_from_slice(&t);
            }
        }
    }

    // Fase 2: pedirle el cambio. El Enter va en una escritura aparte, con una
    // pausa antes: escrito pegado al texto, algunas interfaces lo confunden
    // con parte de un pegado multilinea y no lo tratan como "enviar".
    if let Ok(mut w) = writer.lock() {
        let _ = w.write_all(mensaje.as_bytes());
        let _ = w.flush();
    }
    std::thread::sleep(Duration::from_millis(400));
    if let Ok(mut w) = writer.lock() {
        let _ = w.write_all(b"\r");
        let _ = w.flush();
    }

    // Fase 3: escuchar mientras edita. Mas tiempo que token_check porque aqui
    // tiene que leer, escribir y confirmar, no solo contestar una palabra.
    let limite = std::time::Instant::now() + Duration::from_secs(segundos);
    while std::time::Instant::now() < limite {
        if let Ok(t) = rx.recv_timeout(Duration::from_millis(300)) {
            out.extend_from_slice(&t);
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    String::from_utf8_lossy(&out).to_string()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cuales: Vec<String> = if args.is_empty() || args[0].parse::<u64>().is_ok() {
        vec!["claude".to_string(), "codex".to_string()]
    } else {
        vec![args[0].clone()]
    };
    let espera: u64 = args.iter().find_map(|a| a.parse::<u64>().ok()).unwrap_or(90);

    let carpeta = carpeta_descartable();
    println!("Carpeta descartable: {}", carpeta.display());

    let capturas = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/capturas");
    std::fs::create_dir_all(&capturas).expect("crear tests/capturas");

    let mensaje =
        "Abre hola.txt en esta carpeta, cambia la palabra mundo por tierra, y guarda el archivo.";

    for cli in cuales {
        println!("\n===================== {cli} =====================");
        let Some(program) = oruka_lib::registry::resolve_bin(&cli) else {
            println!("no esta en el PATH, se salta");
            continue;
        };
        let Some(manifest) = oruka_lib::registry::manifest(&cli) else {
            println!("sin manifiesto, se salta");
            continue;
        };

        let salida = preguntar(construir(&program, &manifest, &carpeta), mensaje, espera);

        let fecha = ahora_como_fecha();
        let ruta = capturas.join(format!("{cli}-{fecha}.txt"));
        std::fs::write(&ruta, &salida).expect("guardar captura");
        println!("Guardado: {} ({} bytes)", ruta.display(), salida.len());

        let contiene_mundo_tierra = salida.contains("tierra");
        println!("Contiene 'tierra' en algun punto de la salida: {contiene_mundo_tierra}");
    }

    println!("\nRevisa a mano los archivos en {}", capturas.display());
    println!(
        "y el resultado real en {}",
        carpeta.join("hola.txt").display()
    );
}

/// Quita las secuencias de escape enteras, hasta la letra que las cierra.
fn sin_escapes(texto: &str) -> String {
    let bytes = texto.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            i += 1;
            if i < bytes.len() && (bytes[i] == b'[' || bytes[i] == b']') {
                let cierra_osc = bytes[i] == b']';
                i += 1;
                while i < bytes.len() {
                    let b = bytes[i];
                    if cierra_osc && (b == 0x07 || b == 0x1b) {
                        break;
                    }
                    if !cierra_osc && b.is_ascii_alphabetic() {
                        break;
                    }
                    i += 1;
                }
            }
            i += 1;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

fn ahora_como_fecha() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Lo mismo que hace la app real en `agent_spawn`: modo yolo, el directorio a
/// su manera segun el manifiesto, shims por `cmd.exe` y declarar el terminal.
fn construir(
    program: &Path,
    manifest: &oruka_lib::registry::CliManifest,
    carpeta: &Path,
) -> CommandBuilder {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);

    let mut cmd = if cfg!(windows) && is_script {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/C");
        c.arg(program);
        c
    } else {
        CommandBuilder::new(program)
    };

    let mut args = manifest.launch.args.clone();
    if let Some(mode_args) = manifest.modes.get("yolo") {
        args.extend(mode_args.clone());
    }
    let cwd_str = carpeta.to_string_lossy().to_string();
    match manifest.launch.cwd.as_str() {
        "flag" => {
            if let Some(flag) = &manifest.launch.cwd_flag {
                args.push(flag.clone());
                args.push(cwd_str.clone());
            }
        }
        "positional" => args.push(cwd_str.clone()),
        _ => {}
    }
    for a in args {
        cmd.arg(a);
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    cmd.cwd(carpeta);
    cmd
}
