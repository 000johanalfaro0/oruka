//! Por que un agente sale en blanco y negro.
//!
//! Responde dos preguntas por separado, porque tienen arreglos distintos:
//!
//!   1. Llegan `TERM` y `COLORTERM` al proceso hijo?
//!   2. Emite color el CLI, o sea, salen secuencias de escape por el PTY?
//!
//! Si (1) es que si y (2) es que no, el CLI no se guia por `TERM` y hay que
//! buscar otra senal. Se ejecuta a mano:
//!
//!     cargo run --example color_check
//!     cargo run --example color_check -- claude

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// Lanza algo en un PTY y devuelve lo que escupa en el tiempo dado.
fn run_in_pty(cmd: CommandBuilder, segundos: u64) -> String {
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);

    let mut writer = pair.master.take_writer().expect("writer");
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            // Los CLIs preguntan la posicion del cursor nada mas arrancar y se
            // QUEDAN BLOQUEADOS hasta que alguien conteste. xterm.js responde
            // solo; aqui hay que hacerlo a mano o parece que no hacen nada y se
            // mide una salida de cuatro bytes que no significa nada.
            if buf[..n].windows(4).any(|w| w == b"\x1b[6n") {
                let _ = writer.write_all(b"\x1b[1;1R");
                let _ = writer.flush();
            }
            if tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let mut out: Vec<u8> = Vec::new();
    let limite = std::time::Instant::now() + Duration::from_secs(segundos);
    let mut silencios = 0;
    while std::time::Instant::now() < limite {
        match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(trozo) => {
                out.extend_from_slice(&trozo);
                silencios = 0;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if out.is_empty() {
                    continue;
                }
                // Un solo silencio no basta: lo primero que manda un CLI son los
                // cuatro bytes de la consulta del cursor, y luego calla mientras
                // espera respuesta. Cortar ahi seria medir solo esa consulta.
                silencios += 1;
                if silencios >= 5 {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    String::from_utf8_lossy(&out).to_string()
}

/// Si hay color de verdad, no solo secuencias de escape.
///
/// Buscar `ESC[` a secas no sirve: la consulta de posicion del cursor (`ESC[6n`)
/// tambien lo cumple, y la manda **todo** CLI al arrancar. El color son
/// secuencias SGR, que son las que terminan en `m`.
fn tiene_color(salida: &str) -> bool {
    let bytes = salida.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == 0x1b && bytes[i + 1] == b'[' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b';') {
                j += 1;
            }
            // `ESC[...m` con al menos un parametro: eso es color o estilo.
            if j < bytes.len() && bytes[j] == b'm' && j > i + 2 {
                return true;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    false
}

/// Lo mismo que hace `pty.rs`: shims por `cmd.exe` y declarar el terminal.
fn build(program: &Path, args: &[&str]) -> CommandBuilder {
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
    for a in args {
        cmd.arg(a);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    cmd.cwd(std::env::temp_dir());
    cmd
}

fn main() {
    println!("== 1. Que variables ve el hijo ==");
    let mut set = CommandBuilder::new("cmd.exe");
    set.arg("/C");
    set.arg("echo TERM=%TERM% COLORTERM=%COLORTERM% NO_COLOR=[%NO_COLOR%] FORCE_COLOR=[%FORCE_COLOR%]");
    set.env("TERM", "xterm-256color");
    set.env("COLORTERM", "truecolor");
    set.cwd(std::env::temp_dir());
    let visto = run_in_pty(set, 5);
    for linea in visto.lines().filter(|l| l.contains("TERM=") && !l.contains("echo")) {
        println!("   {}", linea.trim());
    }

    println!("\n== 2. El PTY deja pasar el color ==");
    let mut ansi = CommandBuilder::new("cmd.exe");
    ansi.arg("/C");
    // El `echo` de cmd no interpreta escapes; se usa PowerShell para emitirlos.
    ansi.arg("powershell -NoProfile -Command \"Write-Host ([char]27 + '[31m' + 'ROJO' + [char]27 + '[0m')\"");
    ansi.cwd(std::env::temp_dir());
    let salida = run_in_pty(ansi, 10);
    println!(
        "   escapes en la salida: {}",
        if tiene_color(&salida) { "SI" } else { "NO" }
    );

    println!("\n== 3. Que hace cada CLI ==");
    let clis: Vec<String> = {
        let args: Vec<String> = std::env::args().skip(1).collect();
        if args.is_empty() {
            ["claude", "codex", "agy", "opencode"]
                .iter()
                .map(|s| s.to_string())
                .collect()
        } else {
            args
        }
    };

    for cli in clis {
        let Some(program) = oruka_lib::registry::resolve_bin(&cli) else {
            println!("   {cli:<10} no esta en el PATH");
            continue;
        };
        let ayuda = run_in_pty(build(&program, &["--help"]), 12);
        // Lo que de verdad importa es la sesion interactiva: es la que se ve en
        // la app. El `--help` de muchos CLIs es texto plano aunque su interfaz
        // vaya a todo color, asi que medirlo solo a el engana.
        let interactiva = run_in_pty(build(&program, &[]), 12);
        println!(
            "   {cli:<10} --help: {:<10} interactivo: {:<10} ({} bytes)",
            if tiene_color(&ayuda) { "COLOR" } else { "plano" },
            if tiene_color(&interactiva) { "COLOR" } else { "SIN COLOR" },
            interactiva.len()
        );
    }

    println!("\nSi (1) muestra TERM y (2) dice SI pero un CLI dice «sin color»,");
    println!("ese CLI no decide por TERM: mira si es TTY o usa otra senal.");
}
