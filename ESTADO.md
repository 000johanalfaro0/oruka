# Oruka — estado del proyecto

Última actualización: 2026-08-20

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
| Workspace | Funcional: 4 agentes con PTY real, repintado al volver, sesiones que sobreviven al cierre, gasto por agente |
| MCP | Completo: catálogo, matriz MCP × CLI, diff previo, copia y revertir |
| Ideas | Funcional: proyectos, detalle con 2 pestañas, horario, 3 tareas de IA |
| GitHub | Completo: repos, acceso, invitaciones, PR con diff/checks/revisión/fusión, issues y aviso de revisiones |
| Ajustes | Parcial: CLIs y MCP reales; carpetas, GitHub y apariencia pendientes |

Medidas reales del build de release: instalador NSIS **1,35 MB**, binario 3,2 MB,
27 MB de RSS el proceso principal. Arranque JS 60 kB gzip.

61 tests en Rust, 1 ignorado a propósito.

---

## Arquitectura

    src/
      shell/          barra de módulos, pestañas, statusbar, bus, registro
      modules/
        workspace/    grid de agentes, terminales, carpeta de trabajo
        github/       repos, acceso, invitaciones y PR
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
19. **Un comando síncrono de Tauri corre en el hilo de la interfaz.** Detectar
    CLIs lanza cinco procesos y esperarlos congelaba la ventana entera. Todo
    lo que lance procesos o toque la red tiene que ser `async fn`.
20. **`CREATE_NO_WINDOW` hay que ponerlo en CADA sitio que lance procesos.**
    Se puso en `github.rs` y se olvidó en `registry.rs`, así que entrar en
    Ajustes abría una consola por cada CLI detectado.
21. **Las secuencias de escape llevan dígitos dentro.** Al buscar el contador
    de tokens, `ESC[2m` colaba un «2» como si fuera la cifra. Hay que saltar
    los escapes enteros, hasta la letra que los cierra.
22. **La marca del contador puede venir partida entre dos lecturas del PTY.**
    Por eso `TokenScan` guarda una cola del trozo anterior.
23. **Git Bash reescribe los argumentos que empiezan por `/`** y los convierte
    en rutas de disco: `gh api /user/repos` acaba pidiendo
    `C:/Program Files/Git/user/repos`. Solo afecta al probar a mano desde esa
    shell; Rust llama al binario sin shell. Sin la barra inicial funciona.

---

## Entorno local

Las rutas de los CLIs de esta máquina, sus archivos de configuración MCP, el
proyecto de Supabase y la cuenta de GitHub viven en `ENTORNO.local.md`, que no
se sube: es información de una máquina concreta y no le sirve a nadie más.

---

## Hacia dónde va la app

Lo que Oruka quiere llegar a ser, más allá de la lista de tareas. Está aquí para
que quien retome el proyecto sepa **por qué** se construye cada cosa.

**Un sitio donde supervisar varios agentes a la vez, no donde lanzarlos.** Cuatro
por proyecto, cada uno en su terminal real, y proyectos ilimitados. El límite de
cuatro es de diseño: más allá se deja de supervisar y se empieza a rezar.

**Que el equipo quepa dentro.** GitHub no está para consultar, está para
trabajar: revisar un PR con su diff y su CI, aprobar o pedir cambios, abrir un
PR, ver los issues que te tocan y enterarte de que alguien espera tu revisión sin
salir de la app. Si algo obliga a abrir el navegador, falta.

**Que los agentes se conozcan entre ellos.** La idea a explorar son los roles: si
claude y codex trabajan sobre los mismos archivos, hoy son dos desconocidos que
se pisan. Darle a cada uno un papel y decirle que el otro existe cambia el
resultado. Cuidado: si eso acaba en archivos `.md` dentro del proyecto del
usuario, se aplican las cuatro protecciones de escritura; la vía sin riesgo es
pasar el rol en el prompt inicial, que no toca nada.

**Que no se acaben los tokens.** Ver lo que gasta cada agente (hecho) y, más
adelante, enrutar por **0router** para caer en cascada de la suscripción a
modelos baratos y luego gratis.

**Que se pueda instalar y compartir.** Un instalador de 1,35 MB, sin cuenta ni
servicios de fondo, que se actualice solo cuando salga una versión nueva.

---

## Qué falta, por orden

### Bloqueando

**La app se cae al cerrar un agente** (visto con opencode). **Sin diagnosticar.**
No hay panic a la vista porque release lleva `panic = "abort"` y `strip`, así que
el proceso muere en seco. Para verlo hay que reproducirlo en desarrollo:

    RUST_BACKTRACE=1 npm run app 2>&1 | tee ~/oruka-dev.log

Sospecha sin confirmar: `kill()` mata solo el proceso directo, y opencode y codex
son shims `.cmd` lanzados con `cmd.exe /C`, así que muere `cmd.exe` y el `node`
nieto sobrevive agarrado al PTY.

### Sin verificar a mano (escrito y en verde, nunca probado en la app)

Pesa más que lo que falta por hacer: hay mucho código nuevo que nadie ha visto
funcionar contra datos reales.

- **Todo el módulo GitHub.** Las escrituras —invitar, cambiar permiso, quitar
  acceso, aprobar, pedir cambios, crear PR, fusionar, cerrar— **no se han
  ejecutado nunca**. Son públicas e irreversibles.
- Que las sesiones vuelvan al reabrir, con su modo, y que el agente retome la
  conversación.
- La casilla «continuar la última conversación» al lanzar un agente.
- Las barras de gasto por agente.
- Que ya no salga la consola negra al entrar en Ajustes, ni se congele.
- El repintado de la terminal al volver a una pestaña.

**Color de los agentes: sin cerrar.** Se declaran `TERM`, `COLORTERM` y
`FORCE_COLOR`, y `cargo run --example color_check` demuestra que codex, agy y
claude **sí emiten color** por este mismo PTY en sesión interactiva. Aun así se
reportaron codex y agy en gris. Si se repite con el build actual, el fallo está
entre Rust y xterm.js, no en los CLIs.

### Entorno de pruebas de GitHub (montado a medias)

El plan completo está en
`~/.claude/plans/para-probar-todas-las-snuggly-babbage.md`.

**Ya creado** en la cuenta `000johanalfaro0`:

- Repositorio público desechable `oruka-pruebas`.
- Issue **#1**, asignado, para el panel de issues.
- PR **#2** (`prueba-diff` → `main`), para la lista, el diff, fusionar y cerrar.

**Falta, y sin esto no se puede terminar:**

1. **El CI**, para que el panel de comprobaciones tenga algo que enseñar. El
   token de `gh` no tiene el scope `workflow` y GitHub rechaza subir el archivo
   (responde 404). Dos caminos: completar `gh auth refresh -s workflow` **hasta
   el paso del navegador**, o crear el archivo desde la web, que usa la sesión
   del navegador y no necesita el scope:
   `https://github.com/000johanalfaro0/oruka-pruebas/new/main?filename=.github/workflows/pruebas.yml`

   Con dos trabajos, uno que pasa y otro que falla a propósito (`run: exit 0` y
   `run: exit 1`). El rojo hace falta para comprobar que la confirmación de
   fusionar avisa de las comprobaciones en rojo. Guardarlo **como pull request**,
   no directo a `main`, o el CI no colgará de ningún PR.

2. **Una segunda cuenta de GitHub.** No es opcional: **GitHub no deja aprobar tu
   propio pull request**, así que con una sola cuenta el botón «Aprobar» no se
   puede probar nunca. Hace falta que la cuenta B:
   - acepte una invitación a `oruka-pruebas` y abra un PR **pidiendo revisión**;
   - cree su propio repo público e **invite a la cuenta A**, que es lo único que
     puebla dos pantallas hoy vacías: **invitaciones recibidas** y la pestaña
     **«Compartidos conmigo»**.

3. **El instalador en una máquina limpia.** Para esto sí sirve un entorno virgen,
   y **Windows Sandbox** es la opción ligera: viene con este Windows 11 Pro, está
   disponible sin instalar y la virtualización está activa. Se borra al cerrarla,
   así que no vale para probar la persistencia entre reinicios.

Al terminar, borrar los repositorios de pruebas.

### Pedido y sin empezar

| Qué | Estado |
|---|---|
| **0router** | Investigado, sin empezar. Es un **servidor local** al que apuntan los CLIs, no un agente: no va en `packages/adapters/`. Su sitio es una sección propia que lo detecte, lo arranque y configure a los CLIs, reutilizando la escritura segura de MCP. Falta confirmar **CLI por CLI** cómo se le indica un servidor propio. No está instalado en el equipo. |
| **Auto-actualización** | Sin empezar. Con la release publicada, encaja en GitHub Releases. Es lo que hace que otra persona reciba versiones nuevas sin enterarse. |
| **Roles entre agentes** | Idea a explorar. Ver «Hacia dónde va la app». |
| **Marcas de tokens** | Solo **codex** declara la suya. Falta ver qué escriben claude, agy y opencode y añadirla a sus manifiestos. |
| **Skills de ECC en agy** | Diagnosticado y **no es del proyecto**: codex tiene 209 skills en `~/.codex/skills` y su `ecc-install-state.json`; agy solo una en `~/.gemini/skills` y ningún estado de instalación. ECC nunca se instaló para agy. |
| **Captura real con agentes** | La landing usa una recreación generada con codex, etiquetada como tal. Falta lanzar dos o tres agentes de verdad y capturar. |
| **Repositorio público** | Decisión del usuario. Mientras sea privado, la descarga de la release solo le sirve a él. Ya se comprobó que no hay secretos en el historial. |
| **Rotar el token de Supabase** | El `refresh_token` quedó visible en un transcript. Cerrar sesión en la app y volver a entrar lo revoca. |

### Infraestructura

- **No hay CI** que ejecute lint, tests y el presupuesto de peso.

### Ideas

- Subir el tope de 5000 caracteres por idea, que ya se está tocando.
- Editar la descripción de un proyecto y poder borrarlo.
- Imagen: transcripción y mockup ASCII. Están en `ai.ts` pero sin interfaz.
  Prioridad baja: de 86 ideas reales, ninguna es de imagen.

### Workspace

- Selector de layout manual.
- Estado real del agente: inactivo, trabajando, esperando, error.
- Divisores arrastrables.
- Buscar dentro de la terminal.

### MCP

- Formulario para añadir un MCP propio.
- Credenciales en el gestor del sistema.
- Soportar `opencode.jsonc` con comentarios en vez de negarse.

### Cierre

- Empaquetado para macOS y Linux.
- Recortar la app Flutter a **Oruka Capture**.
- Apagar la web de Idearia.

### Landing

Publicada como artefacto privado: captura de la app, arte ASCII generado con
codex y descarga apuntando a la release. **Su fuente vive fuera del repositorio**,
en el scratchpad de la sesión; si se quiere conservar, hay que moverla a `docs/`.

---

## Cómo verificar que sigue sano

    npm run lint      # la frontera entre módulos
    npm run build     # typecheck y tamaño de los chunks
    cd src-tauri && cargo test --lib
    cargo run --example spawn_check -- claude

Y a mano: añadir carpeta de trabajo, abrir un proyecto, lanzar dos agentes,
cambiar de pestaña y volver comprobando que siguen vivos, y entrar en Ideas para
ver los proyectos reales de la cuenta.
