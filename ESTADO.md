# Oruka — estado del proyecto

Última actualización: 2026-08-19

Orquestador desktop de agentes CLI. Ejecuta y supervisa varios agentes de IA
locales en distintos proyectos, con GitHub y MCP integrados, y un bloc de ideas
que absorbe la app Idearia.

---

## Cómo ejecutarlo

    npm install
    npm run app        # app de escritorio (Tauri + Vite)
    npm run build      # typecheck + bundle
    npm run lint       # incluye la frontera entre módulos
    cd src-tauri && cargo test --lib

Requisitos: Node 20+, Rust estable, WebView2 (de serie en Win11). Los CLIs de IA
se detectan solos si están en el PATH; no hace falta tenerlos todos.

**Importante:** `.env.local` con las credenciales de Supabase se lee **solo al
arrancar Vite**. Si lo creas o editas con la app corriendo, hay que reiniciarla.

---

## Estado por módulo

| Módulo | Estado |
|---|---|
| Shell | Completo: barra de módulos, pestañas, barra de estado, carga diferida |
| Quick Setup | Completo: CLIs, GitHub, MCP, y relanzable desde Ajustes |
| Login | Completo: email y contraseña, sesión de 7 días, entra sin red si ya la tenía |
| Workspace | Funcional: carpeta de trabajo, proyectos, hasta 4 agentes con PTY real, repintado al volver |
| MCP | Completo: catálogo, matriz MCP × CLI, diff previo, copia y revertir |
| Ideas | Funcional: proyectos, detalle con 2 pestañas, horario, 3 tareas de IA |
| GitHub | Funcional: repos, gestión de acceso, invitaciones y PR del proyecto activo |
| Ajustes | Parcial: CLIs y MCP reales; carpetas, GitHub y apariencia pendientes |

Medidas reales del build de release: instalador NSIS **1.1 MB**, binario 2.6 MB,
27 MB de RSS el proceso principal. Arranque JS 60 kB gzip.

40 tests en Rust, 1 ignorado a propósito.

---

## Arquitectura

    src/
      shell/          barra de módulos, pestañas, statusbar, bus, registro
      modules/
        workspace/    grid de agentes, terminales, carpeta de trabajo
        github/       (esqueleto)
        ideas/        proyectos, detalle, horario, IA
        settings/     ajustes, anclado a la derecha
      setup/          Quick Setup del primer arranque
      auth/           puerta de entrada y sesión
      shared/         componentes usados por varias superficies
      lib/            puentes con el backend y utilidades
      ui/             tokens de color y estilos base
    src-tauri/src/
      pty.rs          terminales reales (portable-pty / ConPTY)
      registry.rs     detección de CLIs desde manifiestos
      projects.rs     descubrimiento de proyectos en una raíz
      github.rs       gh: estado, repos, PR, acceso e invitaciones
      mcp/            escritores por formato + copia y reversión
      ports.rs        traits que fijan la frontera
    packages/
      adapters/       un JSON por CLI (claude, codex, agy, opencode)
      mcp/            un JSON por servidor MCP conocido

### Reglas que no se rompen

1. **Los módulos no se importan entre sí.** Para hablar entre ellos existe el bus
   (`src/shell/bus.ts`). Hay una regla de lint que **falla el build** si
   `modules/A` importa `modules/B`. Compruébalo metiendo un import a propósito.
2. **El shell no conoce los módulos.** Solo el contrato (`src/types/module.ts`) y
   el registro (`src/shell/moduleRegistry.ts`), que es el único sitio que los
   nombra, y solo para importarlos en diferido.
3. **Lo que varía es dato, no código.** CLIs y MCP son JSON en `packages/`.
   Añadir uno no recompila nada.
4. **El front no habla con procesos ni con la red.** Solo con comandos Tauri de
   superficie estrecha, definidos en `src-tauri/src/lib.rs`.
5. **Ningún componente define colores.** Todo sale de `src/ui/tokens.css`, que es
   la paleta VS Code Dark Modern.
6. **Ideas accede a datos solo por `repository.ts`.** Ningún componente llama a
   Supabase directamente.

---

## Decisiones tomadas, y por qué

| Decisión | Motivo |
|---|---|
| Tauri en vez de Electron | La app tenía que ser ligera. Salió 1.1 MB de instalador |
| Estética VS Code Dark Modern | Pedida explícitamente. Iconos Codicons sobre texto |
| Login al arrancar, 7 días | Pedido. Con sesión guardada se entra aunque no haya red |
| Mismo proyecto Supabase que Idearia | Los datos no se migran: no hay riesgo de perderlos |
| MCP escribe en la config global de cada CLI | Pedido. Por eso las cuatro protecciones de abajo |
| Oruka **no** escribe secretos | Deja la referencia `${VAR}`; un token en claro en `~/.claude.json` es justo lo que no queremos |
| Ideas y Workspace **no se hablan** | Decisión del usuario: comparten app, nada más. Se quitó un puente que lanzaba agentes desde Ideas |
| GitHub **sí** puede lanzar un agente | Estaba pedido («abrir un PR con un agente»). La decisión de arriba era sobre Ideas. Solo GitHub lo emite, y Workspace sigue decidiendo el CLI y el modo |
| GitHub pasa por `gh`, no por HTTP | `gh` ya resuelve sesión, refresco y límites. Oruka no ve el token, así que tampoco puede filtrarlo |
| Máximo 4 agentes por proyecto, proyectos ilimitados | Regla estructural del diseño |

### Las cuatro protecciones al escribir configs ajenas

Están en `src-tauri/src/mcp/safe_write.rs`, con tests:

1. Copia previa `<archivo>.oruka-backup-<timestamp>`.
2. Escritura atómica: temporal + rename, nunca truncar.
3. Idempotencia: si el servidor ya existe, se actualiza, no se duplica.
4. Diff visible antes de aplicar, y botón de revertir.

`~/.claude.json` guarda el historial de sesiones del usuario y `config.toml` sus
comentarios: romperlos deja a alguien sin su herramienta.

---

## Trampas descubiertas (cuestan horas si no se saben)

1. **Los CLIs preguntan la posición del cursor al arrancar** (`ESC[6n`) y **se
   bloquean** hasta que el terminal contesta. xterm.js responde solo; cualquier
   prueba headless tiene que contestar `ESC[1;1R` a mano o parecerá que cuelgan.
2. **Un PTY nunca da EOF** mientras el master siga abierto. Por eso `pty.rs`
   tiene un hilo vigía que espera al proceso, emite el evento de salida y quita
   la sesión: al soltar el master es cuando se desbloquea el lector.
3. **Los agentes heredaban la sesión de otro agente.** `SESSION_MARKERS` en
   `pty.rs` quita nueve variables `CLAUDE_CODE_*`. No se tocan credenciales.
4. **En Windows los CLIs de npm son shims `.cmd`**, que CreateProcess no ejecuta:
   hay que lanzarlos con `cmd.exe /C`.
5. **Cambiar de pestaña no puede desmontar las terminales.** Todos los proyectos
   abiertos se pintan a la vez y los inactivos se ocultan con CSS.
6. **Un id de sesión se lanza una sola vez.** El `Set started` de
   `AgentTerminal.tsx` lo garantiza: sin él, cada remontaje arrancaba un segundo
   proceso con el mismo id.
7. **La terminal no puede ser `position: absolute`** o se escapa del panel y tapa
   la interfaz entera.
8. **`cargo test` se cuelga si `tauri dev` tiene el lock del build.** Cierra la
   app antes, o usa otro `CARGO_TARGET_DIR`.
9. **El test del PTY está ignorado**: el harness de Windows no termina al cerrar
   ConPTY. Para probar de verdad que un CLI arranca:
   `cargo run --example spawn_check -- claude`.
10. **Los heredocs de bash fallan** con contenido muy largo y se comen las barras
    invertidas. Para archivos grandes, usar la herramienta de escritura.
11. **Repintar al volver duplica salida si no se lleva la cuenta.** Entre pedir
    la foto del scrollback y recibirla siguen llegando eventos, y esos trozos
    van dentro de la foto *y* en directo. Por eso cada trozo lleva un `seq` con
    los bytes emitidos hasta él: el front encola lo que llega mientras espera y
    luego tira lo que no pase del `seq` de la foto. El orden en Rust también
    importa: primero se guarda en el buffer y se coge el `seq`, y solo después
    se emite.
12. **El scrollback recortado no puede empezar en cualquier byte.** Arrancar a
    mitad de una secuencia de escape pinta basura, y a mitad de un carácter
    rompe el UTF-8. Al recortar se avanza hasta el primer salto de línea, que
    resuelve las dos cosas de una vez.
13. **Sin `TERM` los agentes salen en blanco y negro.** Los CLIs miran esa
    variable para decidir si hay color; una app de escritorio en Windows no la
    hereda y portable-pty tampoco la pone. `pty.rs` declara
    `TERM=xterm-256color` y `COLORTERM=truecolor`, que además es la verdad: al
    otro lado hay un xterm.js.
14. **Un `emit` normal se pierde si el módulo que escucha aún no está cargado.**
    Todos van en diferido, así que el Workspace no existe en memoria hasta que
    se abre por primera vez. Para lo que tiene que ocurrir sí o sí está
    `bus.request`, que aparca la petición hasta que alguien se suscriba.
15. **`gh` abre una consola negra en cada llamada** si no se lanza con
    `CREATE_NO_WINDOW`. En una app de escritorio se ve parpadear.
16. **Un proyecto por día, y lo impone la base.** `projects` tiene un índice
    único parcial `(user_id, scheduled_date) WHERE scheduled_date IS NOT NULL`.
    Cualquier pantalla que asigne fechas tiene que contar con ello: soltar en un
    día ocupado no puede escribir sin sacar antes al que estaba, y el paso
    intermedio también tiene que cumplir la regla (por eso se aparca en `null`
    primero, y solo después se le da la fecha del otro).
17. **La CSP solo se aplica en la app empaquetada.** En desarrollo sirve Vite,
    que no manda esa cabecera, así que un recurso bloqueado **no se ve hasta
    compilar en release**. Ya ha mordido dos veces: los avatares (`img-src`) y
    Supabase entero (`connect-src`, que faltaba y heredaba `default-src 'self'`).
    Lint, build y tests pasan en verde sin enterarse: hay que abrir la release.
18. **El shell desmonta el módulo que no está activo.** Todo lo que viva en
    `useState` se pierde al cambiar de ventana, y al volver se relanza. En
    GitHub eso eran varios procesos `gh` por visita. Lo que deba sobrevivir va
    fuera de React: `src/modules/github/cache.ts`.
19. **Git Bash reescribe los argumentos que empiezan por `/`** y los convierte
    en rutas de disco: `gh api /user/repos` acaba pidiendo
    `C:/Program Files/Git/user/repos`. Solo afecta al probar a mano desde esa
    shell; Rust llama al binario sin shell. Sin la barra inicial funciona.

---

## Entorno de esta máquina

CLIs detectados y verificados arrancando dentro del PTY:

| CLI | Ruta | Modo permisivo |
|---|---|---|
| claude | `~/.local/bin/claude.exe` | `--dangerously-skip-permissions` |
| codex | shim npm `.cmd` | `--dangerously-bypass-approvals-and-sandbox` |
| agy | `%LOCALAPPDATA%\agy\bin` | `--dangerously-skip-permissions` |
| opencode | shim npm `.cmd` | (sin confirmar) |

Configuración MCP de cada uno:

| CLI | Archivo | Clave |
|---|---|---|
| claude | `~/.claude.json` | `mcpServers` |
| codex | `~/.codex/config.toml` | `[mcp_servers.*]` |
| agy | `~/.gemini/config/mcp_config.json` | `mcpServers` |
| opencode | `~/.config/opencode/opencode.jsonc` | `mcp` (formato propio) |

**Supabase** `pkkofllpzmmvzjlfhhoa` (sa-east-1, PG 17), compartido con Idearia:
tablas `projects`, `ideas`, `user_entitlements`, las tres con RLS, y la edge
function `idearia-ai` sobre Gemini con cuatro tareas (`organize`,
`transcribe_image`, `ascii_mockup`, `format_chat`). La clave de Gemini vive en el
servidor y nunca sale de ahí.

**GitHub**: `gh` autenticado con scopes `repo`, `read:org`, `gist`.

---

## Qué falta, por orden

### Defectos conocidos
- **La app se cae al cerrar un agente** (visto con opencode), sin panic a la
  vista porque release lleva `panic = "abort"` y `strip`. **Sin confirmar.**
  Sospecha: `kill()` mata solo el proceso directo, y opencode y codex son shims
  `.cmd` lanzados con `cmd.exe /C`, así que el que muere es `cmd.exe` y el
  `node` nieto sobrevive agarrado al PTY. Para verlo de verdad hay que
  reproducirlo en dev, donde el panic sí se imprime:
  `RUST_BACKTRACE=1 npm run app 2>&1 | tee ~/oruka-dev.log`
- Los agentes **mueren al cerrar la app**; no se restauran.
- No hay CI que ejecute lint, tests y el presupuesto de peso.

### Sin verificar a mano (código escrito y en verde, pero no probado en la app)
- Repintado de la terminal al volver a una pestaña.
- Que los agentes salgan en color tras declarar `TERM`.
- Todo el módulo GitHub. Las escrituras (invitar, cambiar permiso, quitar
  acceso) **no se han ejecutado nunca**: se ven desde fuera y no se prueban
  contra la cuenta real de nadie sin querer hacerlo.

### GitHub (hecho, sin probar a mano)
Todo el bloque está escrito y en verde. Falta verlo con datos reales: esta
cuenta no tiene repos compartidos, ni invitaciones, ni PR abiertos, así que esas
tres pantallas solo se han visto vacías.

Quedó fuera a propósito: transferir un repo, equipos de organización, y gestionar
el acceso de un repo donde no eres administrador (GitHub lo rechazaría, así que
ni se ofrece el botón).

### Ideas (rematar)
- Imagen: transcripción y mockup ASCII. Están en `ai.ts` pero sin interfaz.
  Prioridad baja: de 86 ideas reales, **ninguna** es de imagen.
- Subir el tope de 5000 caracteres por idea, que ya se está tocando.
- Editar descripción del proyecto y borrar proyecto.

### Workspace
Selector de layout manual, estado real del agente (idle/working/waiting/error),
divisores arrastrables, buscar dentro de la terminal.

### MCP
Formulario para añadir un MCP propio, credenciales en el gestor del sistema, y
soportar `opencode.jsonc` con comentarios en vez de negarse.

### Cierre
Restaurar sesiones al reabrir, auto-actualización, empaquetado para macOS y
Linux, recortar la app Flutter a **Oruka Capture** y apagar la web de Idearia.

---

## Cómo verificar que sigue sano

    npm run lint      # la frontera entre módulos
    npm run build     # typecheck y tamaño de los chunks
    cd src-tauri && cargo test --lib
    cargo run --example spawn_check -- claude

Y a mano: añadir carpeta de trabajo, abrir un proyecto, lanzar dos agentes,
cambiar de pestaña y volver comprobando que siguen vivos, y entrar en Ideas para
ver los proyectos reales de la cuenta.
