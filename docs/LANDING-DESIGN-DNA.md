# Oruka landing — Design DNA

## Referencias verificadas

- Composición y movimiento: https://family.co/
- Sistema visual: https://styles.refero.design/style/1bcae895-2245-4d33-aa43-1c1e80719554
- Identidad del producto: `src/ui/tokens.css`, `src-tauri/icons/icon.png` y captura real de la aplicación de escritorio.

Browser Harness inspeccionó las referencias a 1920×1080 en ventanas físicamente maximizadas. Se capturaron estados de entrada y asentados del hero y de las transiciones principales. Las referencias aportan principios; no se reutilizaron sus personajes, textos ni activos.

## Traducción a Oruka

Oruka conserva la estructura de storybook de Family: lienzo crema, gran espacio central, tipografía utilitaria, ilustración plana concentrada en los tercios laterales, superficies definidas por bordes y color como señal semántica. El contenido y los personajes cambian a un equipo de agentes de escritorio.

### Invariantes

1. Fondo `#fbfaf9`; texto principal `#343433`; superficies `#f2f0ed`; bordes `#e5d5c3`.
2. Negro `#121212` únicamente para acciones primarias y la sección de producto.
3. Azul `#0086fc` indica acción/contexto, verde `#00c978` estado activo; naranja, amarillo, rosa y violeta son acentos ilustrativos escasos.
4. Hero centrado con personajes a ambos lados y un centro deliberadamente tranquilo.
5. Titulares grandes, compactos y de peso medio; cuerpo entre 17–18px con interlineado amplio.
6. Cards con bordes finos, radios moderados y sin glassmorphism ni gradientes.
7. La prueba de producto siempre usa una captura real de Oruka, nunca una interfaz inventada.
8. Navegación sticky, entradas suaves por `IntersectionObserver` y movimiento ambiental lento; todo se desactiva con `prefers-reduced-motion`.

## Activo generado

- Archivo: `docs/assets/oruka-family-hero.jpg`
- Generador: Agy, herramienta nativa `generate_image`; coste externo: ninguno.
- Dimensiones: 1376×768.
- Reglas: geometría storybook original, robots-agente abstractos, centro libre, paleta Family, sin texto, logos, cripto, 3D ni fotorealismo.
- El sandbox de Agy generó el JPG en su almacén local y bloqueó únicamente la copia; el mismo archivo fue trasladado al proyecto sin regeneración ni cambio de proveedor.

## Criterios de aceptación

- Hero, CTA, ilustración y propuesta visibles a 1920×1080.
- Sin overflow horizontal ni cortes del cierre a 390×844.
- Dos estados temporales por sección animada durante la verificación.
- Navegación persistente, foco visible, landmarks semánticos y cero errores de consola.
- Dos rondas correctivas obligatorias después del render inicial.
