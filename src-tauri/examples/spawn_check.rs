//! Comprueba que un CLI real arranca dentro de un PTY.
//!
//! Existe como ejemplo y no como test porque el harness de test de Windows se
//! queda colgado al cerrar ConPTY. Aqui el proceso termina y podemos verlo.
//!
//!     cargo run --example spawn_check -- claude

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

fn main() {
    let cli = std::env::args().nth(1).unwrap_or_else(|| "claude".into());

    let Some(program) = oruka_lib::registry::resolve_bin(&cli) else {
        println!("FALLO  {cli}: no esta en el PATH");
        std::process::exit(1);
    };
    println!("bin    {cli}: {}", program.display());

    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = build(&program, &["--version".to_string()]);
    cmd.cwd(std::env::temp_dir());

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let mut writer = pair.master.take_writer().expect("writer");
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).is_err() {
                break;
            }
        }
    });

    let mut out = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(chunk) => {
                out.push_str(&chunk);
                // Muchos CLIs preguntan la posicion del cursor al arrancar y se
                // quedan bloqueados hasta que el terminal contesta. xterm.js lo
                // hace solo; aqui hay que hacerlo a mano o parece que cuelgan.
                if chunk.contains("[6n") {
                    let _ = writer.write_all(b"[1;1R");
                    let _ = writer.flush();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Los escapes de ConPTY no cuentan: se espera texto de verdad.
                if has_real_text(&out) {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();

    let clean: String = out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");

    if !has_real_text(&out) {
        println!("FALLO  {cli}: solo escapes de terminal, el programa no imprimio nada");
        std::process::exit(1);
    }
    println!("SALIDA {cli}: {}", clean.chars().take(160).collect::<String>());
    println!("OK     {cli} arranca dentro del PTY");
}

/// Descarta los escapes ANSI y comprueba si queda texto legible.
fn has_real_text(raw: &str) -> bool {
    let mut plain = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == 0x1b as char {
            // Se salta hasta el final de la secuencia de escape.
            while let Some(n) = chars.next() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            plain.push(c);
        }
    }
    plain.chars().any(|c| c.is_alphanumeric())
}

/// Mismo criterio que la app: los shims .cmd pasan por el interprete.
fn build(program: &Path, args: &[String]) -> CommandBuilder {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);

    if cfg!(windows) && is_script {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/C");
        c.arg(program);
        for a in args {
            c.arg(a);
        }
        c
    } else {
        let mut c = CommandBuilder::new(program);
        for a in args {
            c.arg(a);
        }
        c
    }
}
