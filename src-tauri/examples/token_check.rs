//! Que escribe cada agente cuando dice lo que lleva gastado.
//!
//! Oruka no tiene ninguna via para preguntarle a un agente su consumo: solo ve
//! el texto que pinta en la terminal. Asi que para cada uno hay que saber la
//! **marca** que aparece justo antes de la cifra, y eso se declara en su
//! manifiesto. Hoy solo codex la tiene ("tokens used"); los otros tres gastan a
//! ciegas y por eso sus barras de gasto no se mueven.
//!
//! Esta prueba lanza el agente de verdad, le manda un mensaje minimo, espera su
//! respuesta y enseña las lineas donde aparece algo de gasto, ya sin las
//! secuencias de escape que ensucian la busqueda.
//!
//! **Consume cuota real.** Un mensaje corto por agente. Se ejecuta a mano:
//!
//!     cargo run --example token_check
//!     cargo run --example token_check -- claude
//!     cargo run --example token_check -- claude 60

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// Lanza el agente, le habla y devuelve todo lo que haya escrito.
///
/// Dos esperas distintas a proposito: primero se le deja levantar su interfaz,
/// y solo despues se escribe. Mandar el mensaje antes de que este listo hace
/// que se pierda y parezca que el agente no contesta.
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

    // El PTY solo entrega UN escritor, y aqui escriben dos: el hilo lector para
    // contestar a la consulta del cursor, y el principal para mandar el mensaje.
    // Por eso va compartido.
    let writer = std::sync::Arc::new(std::sync::Mutex::new(
        pair.master.take_writer().expect("writer"),
    ));
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    // El hilo lector contesta solo a la consulta de posicion del cursor: sin
    // eso el agente se queda bloqueado nada mas arrancar y no escribe nunca.
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

    // Fase 2: hablarle.
    if let Ok(mut w) = writer.lock() {
        let _ = w.write_all(mensaje.as_bytes());
        let _ = w.write_all(b"\r");
        let _ = w.flush();
    }

    // Fase 3: escuchar la respuesta entera.
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

/// Quita las secuencias de escape enteras, hasta la letra que las cierra.
///
/// Buscar la cifra sin hacer esto es lo que ya mordio una vez: `ESC[2m` colaba
/// un «2» como si fuera el numero de tokens.
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

/// Palabras que suelen acompañar a una cifra de gasto.
const PISTAS: [&str; 6] = ["token", "Token", "context", "Context", "ctx", "%"];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cuales: Vec<String> = if args.is_empty() || args[0].parse::<u64>().is_ok() {
        ["claude", "codex", "agy", "opencode"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![args[0].clone()]
    };
    let espera: u64 = args.iter().find_map(|a| a.parse::<u64>().ok()).unwrap_or(45);

    for cli in cuales {
        println!("\n===================== {cli} =====================");
        let Some(program) = oruka_lib::registry::resolve_bin(&cli) else {
            println!("no esta en el PATH, se salta");
            continue;
        };

        let salida = preguntar(
            construir(&program),
            "responde solo con la palabra hola",
            espera,
        );
        let limpio = sin_escapes(&salida);

        let interesantes: Vec<&str> = limpio
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && PISTAS.iter().any(|p| l.contains(p)))
            .collect();

        if interesantes.is_empty() {
            println!("NADA sobre gasto en {espera}s. Ultimas lineas por si acaso:");
            for l in limpio.lines().rev().filter(|l| !l.trim().is_empty()).take(8) {
                println!("   | {}", l.trim());
            }
        } else {
            println!("Lineas con pinta de gasto:");
            for l in interesantes.iter().take(25) {
                println!("   > {l}");
            }
        }
    }
}

/// Lo mismo que hace la app: shims por `cmd.exe` y declarar el terminal.
fn construir(program: &Path) -> CommandBuilder {
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
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    // En una carpeta temporal, codex se queda pidiendo permiso para confiar en
    // el directorio y nunca llega a haber sesion. Desde una carpeta de trabajo
    // de verdad arranca directo.
    cmd.cwd(std::env::current_dir().unwrap_or_else(|_| std::env::temp_dir()));
    cmd
}
