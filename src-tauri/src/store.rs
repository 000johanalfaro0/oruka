//! Lo que Oruka tiene que recordar entre arranques.
//!
//! Vive en disco, en el directorio de datos de la app, y **no** en el
//! `localStorage` del navegador. El motivo es concreto: `localStorage` esta
//! indexado por origen web, y el origen de Oruka cambia segun como se sirva el
//! front (`http://localhost:1420` en desarrollo, `http://tauri.localhost` en la
//! app empaquetada). Guardar ahi la sesion, el setup y las carpetas de trabajo
//! hacia que dependieran de un detalle de implementacion: cambiar de build, o
//! que Tauri cambiara de esquema, los borraba de golpe.
//!
//! El unico secreto que pasa por aqui es el token de sesion que la libreria de
//! Supabase ya guardaba por su cuenta. El archivo es del usuario, esta en su
//! perfil y no sale de la maquina.

use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Un unico archivo para todo. Son cuatro claves, no hace falta una base.
const FILE: &str = "store.json";

/// Serializa a los escritores entre si.
///
/// Varias partes de la interfaz pueden guardar a la vez; sin esto, dos
/// escrituras solapadas podrian perder una de las dos.
static LOCK: Mutex<()> = Mutex::new(());

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sin directorio de datos: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear {dir:?}: {e}"))?;
    Ok(dir.join(FILE))
}

fn read(file: &Path) -> Map<String, Value> {
    let Ok(text) = fs::read_to_string(file) else {
        return Map::new();
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => map,
        // Un archivo roto no puede dejar la app sin arrancar: se empieza de
        // cero, que es justo lo que pasaba antes con el navegador.
        _ => Map::new(),
    }
}

/// Escribe el archivo entero sin dejarlo nunca a medias.
///
/// Temporal y `rename`, igual que al tocar configuraciones ajenas: si se corta
/// la luz a mitad, el archivo de antes sigue intacto en vez de quedar truncado.
fn write(file: &Path, map: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("no se pudo escribir: {e}"))?;
        f.write_all(text.as_bytes())
            .map_err(|e| format!("no se pudo escribir: {e}"))?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, file).map_err(|e| format!("no se pudo reemplazar: {e}"))
}

pub fn get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let file = path(app)?;
    Ok(read(&file)
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

pub fn set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "almacen bloqueado")?;
    let file = path(app)?;
    let mut map = read(&file);
    map.insert(key.to_string(), Value::String(value.to_string()));
    write(&file, &map)
}

pub fn remove(app: &AppHandle, key: &str) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "almacen bloqueado")?;
    let file = path(app)?;
    let mut map = read(&file);
    map.remove(key);
    write(&file, &map)
}

/// Mete varias claves de golpe, sin pisar las que ya estuvieran.
///
/// Es para la mudanza desde el navegador: lo que ya esta en disco manda, porque
/// es mas reciente que lo que quedo en un `localStorage` viejo.
pub fn seed(app: &AppHandle, entries: Vec<(String, String)>) -> Result<u32, String> {
    let _guard = LOCK.lock().map_err(|_| "almacen bloqueado")?;
    let file = path(app)?;
    let mut map = read(&file);
    let mut nuevas = 0;
    for (k, v) in entries {
        if !map.contains_key(&k) {
            map.insert(k, Value::String(v));
            nuevas += 1;
        }
    }
    if nuevas > 0 {
        write(&file, &map)?;
    }
    Ok(nuevas)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Las funciones publicas piden un `AppHandle`, que no existe en un test.
    /// Lo que si se prueba es el trato con el archivo, que es donde estan los
    /// riesgos: corrupcion y escrituras a medias.
    fn temp_file(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("oruka-store-tests");
        fs::create_dir_all(&dir).unwrap();
        dir.join(nombre)
    }

    #[test]
    fn guarda_y_recupera() {
        let file = temp_file("basico.json");
        let _ = fs::remove_file(&file);

        let mut map = Map::new();
        map.insert("oruka.setup.done".into(), Value::String("1".into()));
        write(&file, &map).expect("escribe");

        let leido = read(&file);
        assert_eq!(leido.get("oruka.setup.done").unwrap().as_str(), Some("1"));
    }

    /// Un archivo roto no puede impedir que la app arranque.
    #[test]
    fn un_archivo_corrupto_no_tumba_el_arranque() {
        let file = temp_file("roto.json");
        fs::write(&file, "{esto no es json").unwrap();
        assert!(read(&file).is_empty(), "deberia empezar de cero, no reventar");

        let file = temp_file("no-es-objeto.json");
        fs::write(&file, "[1,2,3]").unwrap();
        assert!(read(&file).is_empty());
    }

    /// Si aun no existe, leer devuelve vacio sin quejarse.
    #[test]
    fn sin_archivo_previo_no_falla() {
        let file = temp_file("no-existe.json");
        let _ = fs::remove_file(&file);
        assert!(read(&file).is_empty());
    }

    /// Escribir no puede dejar el archivo truncado ni un temporal suelto.
    #[test]
    fn la_escritura_es_atomica_y_no_deja_basura() {
        let file = temp_file("atomica.json");
        let mut map = Map::new();
        map.insert("a".into(), Value::String("1".into()));
        write(&file, &map).expect("primera");

        map.insert("b".into(), Value::String("2".into()));
        write(&file, &map).expect("segunda");

        let leido = read(&file);
        assert_eq!(leido.len(), 2);
        assert!(
            !file.with_extension("json.tmp").exists(),
            "quedo un temporal sin limpiar"
        );
    }

    /// La mudanza no puede pisar lo que ya hay: el disco es mas reciente.
    #[test]
    fn la_mudanza_respeta_lo_que_ya_estaba() {
        let file = temp_file("mudanza.json");
        let mut map = Map::new();
        map.insert("token".into(), Value::String("el-bueno".into()));
        write(&file, &map).expect("escribe");

        // Lo mismo que hace `seed` sobre un archivo ya poblado.
        let mut actual = read(&file);
        let mut nuevas = 0;
        for (k, v) in [
            ("token".to_string(), "el-viejo".to_string()),
            ("otra".to_string(), "nueva".to_string()),
        ] {
            if !actual.contains_key(&k) {
                actual.insert(k, Value::String(v));
                nuevas += 1;
            }
        }
        write(&file, &actual).expect("reescribe");

        assert_eq!(nuevas, 1, "solo la que faltaba");
        let leido = read(&file);
        assert_eq!(leido.get("token").unwrap().as_str(), Some("el-bueno"));
        assert_eq!(leido.get("otra").unwrap().as_str(), Some("nueva"));
    }
}
