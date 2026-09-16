//! Traducir la imagen cruda del portapapeles de Windows a un PNG.
//!
//! Windows no guarda un PNG cuando haces una captura: guarda un "DIB", que es
//! el mapa de bits en bruto con una cabecera delante. Los CLIs de IA solo leen
//! formatos de imagen normales, asi que hay que convertirlo antes de dejarlo
//! en disco.
//!
//! Este modulo no toca el portapapeles ni el sistema: entra un bloque de bytes
//! y sale otro. Asi se puede probar en cualquier maquina.

/// Sin compresion: los bytes van tal cual, en orden azul-verde-rojo.
const BI_RGB: u32 = 0;
/// Con mascaras: la cabecera dice que bits de cada pixel son de cada color.
const BI_BITFIELDS: u32 = 3;

/// Tamano de la cabecera antigua. Las modernas (V4 y V5) son mas largas y
/// llevan las mascaras de color dentro.
const CABECERA_CORTA: u32 = 40;

/// Tope de seguridad. Una imagen mayor que esto no es un pegado, es un error.
const MAX_PIXELES: u64 = 64_000_000;

/// Una imagen ya descifrada: ancho, alto y los pixeles en rojo-verde-azul-alfa.
pub struct Imagen {
    pub ancho: u32,
    pub alto: u32,
    pub rgba: Vec<u8>,
}

fn u32_en(b: &[u8], o: usize) -> Result<u32, String> {
    let s = b
        .get(o..o + 4)
        .ok_or("la imagen del portapapeles esta cortada")?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn i32_en(b: &[u8], o: usize) -> Result<i32, String> {
    u32_en(b, o).map(|v| v as i32)
}

fn u16_en(b: &[u8], o: usize) -> Result<u16, String> {
    let s = b
        .get(o..o + 2)
        .ok_or("la imagen del portapapeles esta cortada")?;
    Ok(u16::from_le_bytes([s[0], s[1]]))
}

/// Cuantos bits hay que desplazar y cuantos ocupa un color dentro de su
/// mascara. Por ejemplo, la mascara 0x00FF0000 saca el byte que esta a 16 bits.
fn desplazamiento(mascara: u32) -> (u32, u32) {
    if mascara == 0 {
        return (0, 0);
    }
    let shift = mascara.trailing_zeros();
    let ancho = (mascara >> shift).count_ones();
    (shift, ancho)
}

fn extraer(pixel: u32, mascara: u32) -> u8 {
    let (shift, ancho) = desplazamiento(mascara);
    if ancho == 0 {
        return 0;
    }
    let bruto = (pixel & mascara) >> shift;
    let maximo = (1u32 << ancho) - 1;
    ((bruto * 255 + maximo / 2) / maximo) as u8
}

/// Descifra un DIB de 24 o 32 bits por pixel, que es lo que dejan en el
/// portapapeles las capturas de pantalla y los navegadores.
pub fn dib_a_rgba(dib: &[u8]) -> Result<Imagen, String> {
    let tam_cabecera = u32_en(dib, 0)?;
    if tam_cabecera < CABECERA_CORTA {
        return Err("formato de imagen no reconocido".into());
    }
    let ancho = i32_en(dib, 4)?;
    let alto_bruto = i32_en(dib, 8)?;
    let bits = u16_en(dib, 14)?;
    let compresion = u32_en(dib, 16)?;

    if ancho <= 0 || alto_bruto == 0 {
        return Err("la imagen del portapapeles no tiene tamano".into());
    }
    // Alto negativo significa que las filas van de arriba abajo en vez de al
    // reves, que es lo habitual en este formato.
    let de_arriba_abajo = alto_bruto < 0;
    let alto = alto_bruto.unsigned_abs();
    let ancho = ancho as u32;

    if u64::from(ancho) * u64::from(alto) > MAX_PIXELES {
        return Err("la imagen del portapapeles es demasiado grande".into());
    }
    if bits != 24 && bits != 32 {
        return Err(format!("imagen de {bits} bits: no se puede pegar"));
    }
    if compresion != BI_RGB && compresion != BI_BITFIELDS {
        return Err("imagen comprimida: no se puede pegar".into());
    }

    // Mascaras de color. Con la cabecera corta van justo detras de ella; con
    // las modernas ya vienen dentro, a partir del byte 40.
    let (m_rojo, m_verde, m_azul, m_alfa, extra) = if compresion == BI_BITFIELDS {
        let corta = tam_cabecera == CABECERA_CORTA;
        let base = 40usize;
        let extra = if corta { 12 } else { 0 };
        let alfa = if tam_cabecera >= 108 {
            u32_en(dib, 52).unwrap_or(0)
        } else {
            0
        };
        (
            u32_en(dib, base)?,
            u32_en(dib, base + 4)?,
            u32_en(dib, base + 8)?,
            alfa,
            extra,
        )
    } else if bits == 32 {
        (0x00FF_0000, 0x0000_FF00, 0x0000_00FF, 0xFF00_0000, 0)
    } else {
        (0, 0, 0, 0, 0)
    };

    let inicio = tam_cabecera as usize + extra;
    let bytes_pixel = (bits / 8) as usize;
    // Cada fila se rellena hasta un multiplo de 4 bytes.
    let paso = ((ancho as usize * bytes_pixel) + 3) / 4 * 4;
    let necesario = inicio + paso * alto as usize;
    if dib.len() < necesario {
        return Err("la imagen del portapapeles esta cortada".into());
    }

    let mut rgba = vec![0u8; ancho as usize * alto as usize * 4];
    // Si todo el canal de transparencia viene a cero, no es transparencia: es
    // un canal sin rellenar. Se detecta al vuelo y la imagen sale opaca.
    let mut hay_alfa = false;

    for fila in 0..alto as usize {
        let origen = if de_arriba_abajo {
            fila
        } else {
            alto as usize - 1 - fila
        };
        let base = inicio + origen * paso;
        for col in 0..ancho as usize {
            let p = base + col * bytes_pixel;
            let destino = (fila * ancho as usize + col) * 4;
            if bits == 24 {
                rgba[destino] = dib[p + 2];
                rgba[destino + 1] = dib[p + 1];
                rgba[destino + 2] = dib[p];
                rgba[destino + 3] = 255;
            } else {
                let pixel = u32::from_le_bytes([dib[p], dib[p + 1], dib[p + 2], dib[p + 3]]);
                rgba[destino] = extraer(pixel, m_rojo);
                rgba[destino + 1] = extraer(pixel, m_verde);
                rgba[destino + 2] = extraer(pixel, m_azul);
                let a = if m_alfa == 0 {
                    255
                } else {
                    extraer(pixel, m_alfa)
                };
                if a != 0 {
                    hay_alfa = true;
                }
                rgba[destino + 3] = a;
            }
        }
    }

    if bits == 32 && !hay_alfa {
        for i in (3..rgba.len()).step_by(4) {
            rgba[i] = 255;
        }
    }

    Ok(Imagen { ancho, alto, rgba })
}

/// El DIB del portapapeles, ya como archivo PNG listo para escribir en disco.
pub fn dib_a_png(dib: &[u8]) -> Result<Vec<u8>, String> {
    let img = dib_a_rgba(dib)?;
    rgba_a_png(&img)
}

fn rgba_a_png(img: &Imagen) -> Result<Vec<u8>, String> {
    let mut salida = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut salida, img.ancho, img.alto);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("no se pudo crear el PNG: {e}"))?;
        writer
            .write_image_data(&img.rgba)
            .map_err(|e| format!("no se pudo escribir el PNG: {e}"))?;
    }
    Ok(salida)
}

/// Extensiones que un CLI de IA sabe leer. Un archivo copiado desde el
/// explorador solo se pega si es una imagen de verdad.
pub fn es_imagen_por_extension(ruta: &str) -> bool {
    let bajo = ruta.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
        .iter()
        .any(|ext| bajo.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Arma un DIB de 24 bits, de abajo arriba, como el que deja Windows.
    fn dib24(ancho: u32, alto: u32, pixeles_bgr: &[[u8; 3]]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&40u32.to_le_bytes());
        v.extend_from_slice(&(ancho as i32).to_le_bytes());
        v.extend_from_slice(&(alto as i32).to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&24u16.to_le_bytes());
        v.extend_from_slice(&BI_RGB.to_le_bytes());
        v.extend_from_slice(&[0u8; 20]);
        let paso = ((ancho as usize * 3) + 3) / 4 * 4;
        // Las filas se escriben al reves: la ultima de la imagen va primero.
        for fila in (0..alto as usize).rev() {
            let mut linea = Vec::new();
            for col in 0..ancho as usize {
                linea.extend_from_slice(&pixeles_bgr[fila * ancho as usize + col]);
            }
            linea.resize(paso, 0);
            v.extend_from_slice(&linea);
        }
        v
    }

    #[test]
    fn descifra_un_dib_de_24_bits_y_endereza_las_filas() {
        // Arriba rojo, abajo azul. Dentro del archivo van al reves.
        let rojo = [0u8, 0, 255];
        let azul = [255u8, 0, 0];
        let dib = dib24(2, 2, &[rojo, rojo, azul, azul]);

        let img = dib_a_rgba(&dib).expect("deberia descifrarse");

        assert_eq!((img.ancho, img.alto), (2, 2));
        assert_eq!(
            &img.rgba[0..4],
            &[255, 0, 0, 255],
            "la fila de arriba es roja"
        );
        assert_eq!(&img.rgba[8..12], &[0, 0, 255, 255], "la de abajo es azul");
    }

    #[test]
    fn un_dib_de_32_bits_sin_transparencia_sale_opaco() {
        let mut v = Vec::new();
        v.extend_from_slice(&40u32.to_le_bytes());
        v.extend_from_slice(&1i32.to_le_bytes());
        v.extend_from_slice(&1i32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&32u16.to_le_bytes());
        v.extend_from_slice(&BI_RGB.to_le_bytes());
        v.extend_from_slice(&[0u8; 20]);
        // Verde con el canal de transparencia a cero, que es lo que suele
        // llegar de una captura de pantalla.
        v.extend_from_slice(&[0, 255, 0, 0]);

        let img = dib_a_rgba(&v).expect("deberia descifrarse");

        assert_eq!(&img.rgba[0..4], &[0, 255, 0, 255], "opaco, no invisible");
    }

    #[test]
    fn produce_un_png_de_verdad() {
        let dib = dib24(2, 2, &[[0, 0, 0]; 4]);

        let png = dib_a_png(&dib).expect("deberia dar un PNG");

        assert_eq!(&png[0..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn rechaza_una_imagen_cortada_en_vez_de_reventar() {
        let mut dib = dib24(4, 4, &[[1, 2, 3]; 16]);
        dib.truncate(50);

        assert!(dib_a_rgba(&dib).is_err());
    }

    #[test]
    fn rechaza_un_formato_que_no_sabe_leer() {
        let mut v = Vec::new();
        v.extend_from_slice(&40u32.to_le_bytes());
        v.extend_from_slice(&2i32.to_le_bytes());
        v.extend_from_slice(&2i32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&4u16.to_le_bytes()); // 4 bits: no soportado
        v.extend_from_slice(&BI_RGB.to_le_bytes());
        v.extend_from_slice(&[0u8; 20]);

        assert!(dib_a_rgba(&v).is_err());
    }

    #[test]
    fn solo_acepta_archivos_que_son_imagenes() {
        assert!(es_imagen_por_extension("C:\\fotos\\Captura.PNG"));
        assert!(es_imagen_por_extension("/tmp/a.jpeg"));
        assert!(!es_imagen_por_extension("C:\\notas\\plan.txt"));
        assert!(!es_imagen_por_extension("pngs"));
    }
}
