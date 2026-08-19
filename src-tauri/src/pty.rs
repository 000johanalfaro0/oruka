//! Terminales reales.
//!
//! Cada agente corre en su propio PTY (ConPTY en Windows) dentro del proceso de
//! escritorio. La salida se emite al front como eventos `pty:<id>`; el front
//! solo pinta y devuelve las teclas. Nadie fuera de aqui habla con procesos.

use portable_pty::{
    ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtyPair, PtySize, PtySystem,
};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Cuanta salida reciente se guarda por sesion para poder repintarla.
///
/// Acotado a proposito: un agente con un spinner escupe kilobytes por segundo y
/// cuatro sesiones abiertas no pueden crecer sin techo. Con este tamano cabe de
/// sobra la ultima pantalla, que es lo unico que hace falta al reengancharse.
const SCROLLBACK_BYTES: usize = 256 * 1024;

/// La salida reciente de una sesion, y cuantos bytes lleva emitidos en total.
///
/// `seq` no se reinicia nunca: es el contador que permite al front distinguir lo
/// que ya venia en la foto de lo que llego despues, y no pintarlo dos veces.
#[derive(Default)]
pub struct Scrollback {
    buf: Vec<u8>,
    seq: u64,
    /// Si se ha tirado algo por el techo. Marca que el principio esta cortado.
    truncated: bool,
}

impl Scrollback {
    /// Anade un trozo de salida y devuelve el total de bytes emitidos ya con el.
    fn push(&mut self, bytes: &[u8]) -> u64 {
        self.seq += bytes.len() as u64;
        self.buf.extend_from_slice(bytes);
        if self.buf.len() > SCROLLBACK_BYTES {
            let sobra = self.buf.len() - SCROLLBACK_BYTES;
            self.buf.drain(..sobra);
            self.truncated = true;
        }
        self.seq
    }

    /// Foto de lo guardado, lista para escribir en un terminal nuevo.
    ///
    /// Si el principio esta cortado, se avanza hasta el primer salto de linea:
    /// empezar a mitad de una secuencia de escape pinta basura en pantalla, y de
    /// paso eso deja el corte en una frontera valida de UTF-8.
    fn snapshot(&self) -> Snapshot {
        let mut desde = 0;
        if self.truncated {
            desde = match self.buf.iter().position(|b| *b == b'\n') {
                Some(i) => i + 1,
                // Sin ningun salto: mejor no arriesgarse a cortar un escape.
                None => self.buf.len(),
            };
        }
        Snapshot {
            data: String::from_utf8_lossy(&self.buf[desde..]).to_string(),
            seq: self.seq,
        }
    }
}

/// Lo que se guarda de una sesion viva, mas su salida reciente.
pub struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    scrollback: Arc<Mutex<Scrollback>>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

#[derive(Default)]
pub struct PtyManager {
    sessions: Sessions,
}

#[derive(Clone, Serialize)]
struct Chunk {
    data: String,
    /// Bytes totales emitidos por esta sesion contando ya este trozo.
    seq: u64,
}

/// La salida acumulada de una sesion en un momento dado.
#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub data: String,
    pub seq: u64,
}

#[derive(Clone, Serialize)]
struct Exit {
    code: Option<u32>,
}

impl PtyManager {
    /// Arranca un programa en un PTY nuevo bajo el id de sesion indicado.
    pub fn spawn(
        &self,
        app: AppHandle,
        id: String,
        program: &Path,
        args: &[String],
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let pair: PtyPair = NativePtySystem::default()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("no se pudo abrir el PTY: {e}"))?;

        let mut cmd = build_command(program, args);
        cmd.cwd(cwd);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("no se pudo lanzar el agente: {e}"))?;
        // El slave se suelta ya: si sigue abierto, el proceso nunca ve el cierre.
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("no se pudo leer del PTY: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("no se pudo escribir al PTY: {e}"))?;

        // Hilo lector: guarda la salida y la emite al front segun llega.
        //
        // El orden importa: primero se guarda y se coge el numero de secuencia,
        // y solo despues se emite. Asi una foto pedida a la vez o contiene ya
        // este trozo (y el front lo descarta por el seq) o es anterior a el.
        let scrollback = Arc::new(Mutex::new(Scrollback::default()));
        let reader_scrollback = scrollback.clone();
        let event = format!("pty:{id}");
        let reader_app = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let seq = reader_scrollback.lock().unwrap().push(&buf[..n]);
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        if reader_app.emit(&event, Chunk { data, seq }).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Hilo vigia: espera al proceso y limpia.
        //
        // Es imprescindible: con un PTY el lector NO recibe EOF mientras el
        // master siga abierto, asi que sin esto ni se avisaria del final ni se
        // liberaria el hilo lector. Al quitar la sesion se cierra el master, y
        // eso es justo lo que desbloquea al lector.
        let exit_event = format!("pty-exit:{id}");
        let sessions = self.sessions.clone();
        let wait_id = id.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            let _ = app.emit(&exit_event, Exit { code });
            sessions.lock().unwrap().remove(&wait_id);
        });

        self.sessions.lock().unwrap().insert(
            id,
            Session {
                writer,
                master: pair.master,
                killer,
                scrollback,
            },
        );
        Ok(())
    }

    /// Foto de la salida reciente de una sesion, para repintarla al volver.
    ///
    /// Devuelve `None` si la sesion no existe: o nunca se lanzo, o ya termino.
    pub fn scrollback(&self, id: &str) -> Option<Snapshot> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id)?;
        // El lock del scrollback se coge dentro del de sesiones y nunca al
        // reves; el hilo lector solo toca el suyo, asi que no hay abrazo mortal.
        let snapshot = session.scrollback.lock().unwrap().snapshot();
        Some(snapshot)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(id).ok_or("sesion desconocida")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(id).ok_or("sesion desconocida")?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    /// Mata el agente. El hilo vigia se encarga de quitar la sesion.
    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }
}

pub type SharedPty = Arc<PtyManager>;

/// Variables que marcan "estas dentro de una sesion de agente".
///
/// Un agente lanzado por Oruka tiene que arrancar limpio. Si Oruka se abre
/// desde dentro de otro agente, estas variables se heredan y el CLI hijo cree
/// que es una subsesion del padre: deja de guardar su transcripcion y lo avisa
/// por pantalla. No se tocan credenciales ni configuracion del usuario, solo
/// las marcas de sesion.
const SESSION_MARKERS: [&str; 9] = [
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
];

/// Quita del entorno heredado las marcas de sesion de otro agente.
fn clear_session_markers(cmd: &mut CommandBuilder) {
    for var in SESSION_MARKERS {
        cmd.env_remove(var);
    }
}

/// Le dice al agente en que clase de terminal esta.
///
/// Sin esto los CLIs salen **en blanco y negro**: miran `TERM` para decidir si
/// pueden usar color y, al no encontrarlo, lo desactivan. Oruka es una app de
/// escritorio, asi que en Windows no hereda ninguna de las dos variables, y
/// portable-pty tampoco las pone. Se declaran aqui porque describen la verdad:
/// al otro lado del PTY hay un xterm.js, que emula xterm con 256 colores y
/// entiende color de 24 bits.
fn declare_terminal(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Medido con `cargo run --example color_check`: con solo TERM, `claude`
    // devolvia 70 bytes; con esto, 16331. No todos los CLIs se fian de TERM en
    // Windows, y esta es la palanca que respetan casi todos. Aqui ademas es
    // cierta: al otro lado hay un xterm.js con color de 24 bits.
    cmd.env("FORCE_COLOR", "1");
}

/// En Windows los CLIs de npm son shims `.cmd`, que CreateProcess no ejecuta
/// directamente: hay que pasarlos por el interprete de comandos.
fn build_command(program: &Path, args: &[String]) -> CommandBuilder {
    let is_script = program
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);

    let mut cmd = if cfg!(windows) && is_script {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/C");
        cmd.arg(program);
        cmd
    } else {
        CommandBuilder::new(program)
    };

    for a in args {
        cmd.arg(a);
    }
    clear_session_markers(&mut cmd);
    declare_terminal(&mut cmd);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// Lo guardado se devuelve tal cual, y el contador cuenta bytes, no trozos.
    #[test]
    fn el_scrollback_devuelve_lo_escrito_y_lleva_la_cuenta() {
        let mut s = Scrollback::default();
        assert_eq!(s.push(b"hola "), 5);
        assert_eq!(s.push(b"mundo"), 10);

        let foto = s.snapshot();
        assert_eq!(foto.data, "hola mundo");
        assert_eq!(foto.seq, 10, "el seq son bytes emitidos, no llamadas");
    }

    /// El buffer no puede crecer sin techo por mucho que escupa el agente.
    #[test]
    fn el_scrollback_no_pasa_del_techo() {
        let mut s = Scrollback::default();
        let linea = b"una linea cualquiera de salida\n";
        for _ in 0..(SCROLLBACK_BYTES / linea.len() + 100) {
            s.push(linea);
        }

        assert!(
            s.buf.len() <= SCROLLBACK_BYTES,
            "el buffer se paso del techo: {} bytes",
            s.buf.len()
        );
        assert!(s.truncated, "deberia constar que se tiro lo viejo");
        assert!(
            s.seq > SCROLLBACK_BYTES as u64,
            "el contador no se reinicia al recortar"
        );
    }

    /// Al recortar se empieza en un salto de linea: arrancar a mitad de una
    /// secuencia de escape pintaria basura, y ademas partiria un caracter.
    #[test]
    fn al_recortar_empieza_en_una_linea_entera() {
        let mut s = Scrollback::default();
        s.push(&vec![b'x'; SCROLLBACK_BYTES]);
        s.push("\nlinea sana con acentuacion: canon\n".as_bytes());

        let foto = s.snapshot();
        assert!(
            foto.data.starts_with("linea sana"),
            "la foto tenia que empezar en la linea siguiente al corte: {:?}",
            &foto.data[..foto.data.len().min(40)]
        );
    }

    /// Un caracter multibyte cortado por el techo no puede romper la foto.
    #[test]
    fn el_recorte_no_parte_un_caracter_a_medias() {
        let mut s = Scrollback::default();
        // Deja el techo justo en mitad de un caracter de dos bytes.
        s.push(&vec![b'x'; SCROLLBACK_BYTES - 1]);
        s.push("ñ\nfinal\n".as_bytes());

        let foto = s.snapshot();
        assert!(foto.data.ends_with("final\n"));
        assert!(!foto.data.contains('\u{fffd}'), "quedo un caracter partido");
    }

    /// Un agente tiene que salir en color. Si no se le dice en que terminal
    /// esta, lo desactiva y se ve en blanco y negro.
    #[test]
    fn le_dice_al_agente_que_hay_un_terminal_con_color() {
        let cmd = build_command(Path::new("cualquiera.exe"), &[]);

        assert_eq!(
            cmd.get_env("TERM").and_then(|v| v.to_str()),
            Some("xterm-256color"),
            "sin TERM el CLI da por hecho que no hay color"
        );
        assert_eq!(
            cmd.get_env("COLORTERM").and_then(|v| v.to_str()),
            Some("truecolor")
        );
    }

    /// Un agente lanzado por Oruka no puede heredar la sesion de otro agente,
    /// pero tampoco puede perder las credenciales del usuario.
    #[test]
    fn quita_las_marcas_de_sesion_y_conserva_las_credenciales() {
        std::env::set_var("CLAUDE_CODE_CHILD_SESSION", "1");
        std::env::set_var("CLAUDECODE", "1");
        std::env::set_var("CODEX_GITHUB_PERSONAL_ACCESS_TOKEN", "secreto-de-prueba");
        std::env::set_var("PATH_DE_PRUEBA_ORUKA", "conservar");

        let cmd = build_command(Path::new("cualquiera.exe"), &[]);

        for marker in SESSION_MARKERS {
            assert!(
                cmd.get_env(marker).is_none(),
                "{marker} deberia haberse quitado del entorno del agente"
            );
        }
        assert!(
            cmd.get_env("CODEX_GITHUB_PERSONAL_ACCESS_TOKEN").is_some(),
            "no se pueden tirar las credenciales del usuario"
        );
        assert!(cmd.get_env("PATH_DE_PRUEBA_ORUKA").is_some());

        std::env::remove_var("CLAUDE_CODE_CHILD_SESSION");
        std::env::remove_var("CLAUDECODE");
        std::env::remove_var("CODEX_GITHUB_PERSONAL_ACCESS_TOKEN");
        std::env::remove_var("PATH_DE_PRUEBA_ORUKA");
    }

    /// El PTY tiene que ejecutar de verdad y devolver la salida del proceso.
    /// En Windows esto ejercita ConPTY y el paso por `cmd.exe`.
    ///
    /// Se lee en un hilo con limite de tiempo: un PTY no da EOF por su cuenta,
    /// asi que un test sin reloj se colgaria para siempre.
    ///
    /// IGNORADO a proposito: en Windows el proceso de test no termina aunque el
    /// cuerpo acabe, porque al soltar el master de ConPTY el harness se queda
    /// esperando a conhost. La ruta que cubre este test se verifica en la app
    /// real lanzando un agente; ejecutalo a mano con:
    ///     cargo test --lib -- --ignored --nocapture
    #[ignore = "cuelga el harness de test en Windows por el cierre de ConPTY"]
    #[test]
    fn el_pty_ejecuta_y_devuelve_salida() {
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = if cfg!(windows) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("echo");
            c.arg("oruka-ok");
            c
        } else {
            let mut c = CommandBuilder::new("echo");
            c.arg("oruka-ok");
            c
        };
        cmd.cwd(std::env::temp_dir());

        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("reader");
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx
                            .send(String::from_utf8_lossy(&buf[..n]).to_string())
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        let mut out = String::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while std::time::Instant::now() < deadline && !out.contains("oruka-ok") {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(chunk) => out.push_str(&chunk),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let _ = child.wait();

        assert!(
            out.contains("oruka-ok"),
            "la salida del PTY no contenia la marca. Recibido: {out:?}"
        );
    }
}
