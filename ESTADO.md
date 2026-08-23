# Oruka — estado del proyecto

Última actualización: 2026-08-22

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
| Shell | Completo: barra de módulos, pestañas, barra de estado, carga diferida, versión y aviso de actualización |
| Quick Setup | Completo: instala los CLIs que falten, instala y conecta GitHub, MCP, roles, y relanzable desde Ajustes |
| Login | Completo: email y contraseña, sesión de 7 días, entra sin red si ya la tenía |
| Workspace | Funcional: 4 agentes con PTY real (pintado por GPU), repintado al volver, sesiones que sobreviven al cierre, estado real de cada agente, gasto por CLI en la barra de estado |
| MCP | Completo: catálogo, matriz MCP × CLI, diff previo, copia y revertir |
| Ideas | Funcional: proyectos con renombrar y borrar, detalle con 2 pestañas, horario, 3 tareas de IA |
| GitHub | Completo: repos, acceso, invitaciones, PR con diff/checks/revisión/fusión, issues y aviso de revisiones |
| Ajustes | Parcial: CLIs, MCP, GitHub y Roles reales; **carpetas y apariencia pendientes** |

Medidas reales del build de release: instalador NSIS **2,03 MB**, binario 3,2 MB,
27 MB de RSS el proceso principal. Arranque JS 60 kB gzip.

88 tests en Rust, 1 ignorado a propósito.

**Versión publicada: 0.1.15.** La app se actualiza sola desde la 0.1.2. Publicar es `npm run publicar -- <version>
"<notas>"`: firma, arma el manifiesto y sube la release en un paso. Hacerlo a mano
son seis, y si falta el `latest.json` la comprobación falla **en silencio**.

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

    **Y hay una tercera categoría, que mordió el 2026-08-22.** Un aviso caduca;
    un **estado**, no. `workspace.projectChanged` iba por `emit`, así que
    GitHub —que no está en memoria hasta que lo abres— nunca se enteraba de la
    carpeta ya abierta: el panel decía «PR sin proyecto activo» y solo se
    arreglaba cambiando de carpeta **con GitHub delante**. Por eso el bus tiene
    ahora `RETAINED`: el último valor se guarda y se entrega a cada nueva
    suscripción, **sin consumirlo** —a diferencia de `parked`—, porque el shell
    desmonta el módulo inactivo (trampa 18) y cada montaje lo necesita otra vez.
    Encima había un segundo agujero: restaurar la pestaña al arrancar no emitía
    nada. Funciona en todos los arranques porque Workspace es el primer módulo
    del registro y siempre se monta; si algún día deja de serlo, esto vuelve.
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
    de tokens, `ESC[2m`, `ESC[0m` o `ESC[79C` colaban cifras falsas o partían
    la marca si había un cambio de estilo en medio (lo que rompía codex).
    `TokenScan` limpia las secuencias de escape enteras (`sin_escapes`) antes
    de buscar la marca tanto hacia delante como hacia atrás.
22. **La marca del contador puede venir partida entre dos lecturas del PTY.**
    Por eso `TokenScan` guarda una cola del trozo anterior.
23. **Git Bash reescribe los argumentos que empiezan por `/`** y los convierte
    en rutas de disco: `gh api /user/repos` acaba pidiendo
    `C:/Program Files/Git/user/repos`. Solo afecta al probar a mano desde esa
    shell; Rust llama al binario sin shell. Sin la barra inicial funciona.
24. **`codex` y `opencode` leen el mismo `AGENTS.md`.** Un bloque de roles por
    CLI ahí sería una escritura y un borrado. Por eso el bloque es **uno solo
    con la lista entera** y los destinos se agrupan por nombre de archivo, no
    por CLI. De paso es lo que se quería: cada agente ve a los demás.
25. **Los agentes no publican tokens: publican porcentajes, y de cosas
    distintas.** claude dice cuánto llevas de tu **límite semanal** (sube al
    gastar); codex, cuánta **memoria le queda a la conversación** (baja al
    gastar). No son comparables y no se suman. Por eso cada uno lleva en su
    manifiesto su marca, su unidad, su etiqueta y su sentido, y por eso la
    cifra puede ir **delante** de la marca y no solo detrás.
26. **La cuota es de la cuenta, no de la ventana.** Dos agentes del mismo CLI
    comparten límite: una sola barra. Indexar el gasto por sesión en vez de por
    CLI enseñaría la misma cifra repetida como si fueran dos consumos.
27. **Escuchar el gasto dentro de un componente no vale.** El shell desmonta el
    módulo inactivo (trampa 18), así que la barra del pie se congelaría en
    cuanto miraras GitHub. La suscripción vive en el almacén, fuera de React.
28. **Pencil escribe en los mismos archivos que Oruka, y sin red.** Su
    extensión se configura sola en `~/.claude.json`, `~/.codex/config.toml` y
    la config de opencode —los tres que toca el módulo MCP— sin copia previa ni
    diff. No hace nada malo, pero dos escritores con criterios distintos sobre
    el mismo archivo es justo el escenario para el que existen las cuatro
    protecciones. Si algo aparece o desaparece de la matriz de MCP sin que
    nadie lo haya tocado desde Oruka, mirar ahí antes de buscar un fallo.
29. **El servidor de Pencil no es autónomo.** Su `--app` es el nombre de la
    aplicación a la que se conecta (`visual_studio_code` para VS Code), así que
    **necesita el editor abierto con Pencil dentro**. Lanzado suelto responde
    «app connection is required» y se acabó. La ficha del catálogo asume
    VS Code; con otro editor hay que cambiar ese argumento.
30. **La clave que firma las actualizaciones no puede perderse ni filtrarse.**
    Vive en `~/.oruka-updater.key`, **fuera del repositorio**, que es público.
    Si se pierde, no hay forma de volver a actualizar a nadie: la app solo
    acepta lo firmado con esa clave. Si se filtra, cualquiera puede publicar
    una actualización falsa que se instalaría sin sospecha. Hoy **no tiene
    contraseña**; ponerle una es la mejora pendiente más barata.
31. **El aviso de actualización no puede existir en una versión que no lo
    lleva.** El mecanismo va dentro de la app, así que la primera vez hay que
    instalar a mano; de la 0.1.2 en adelante avisa sola. Es la razón de que no
    sirva de nada publicarlo sin que la gente reinstale una vez.
32. **Publicar una release ya no es solo subir el .exe.** Hay que firmarla y
    subir además `latest.json`, que es el archivo que la app consulta. Sin él,
    o con la firma de otro build, la comprobación falla en silencio y nadie se
    entera de que hay versión nueva. Se construye con
    `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.oruka-updater.key)" npm run app:build`.
33. **No se puede publicar con Oruka abierta.** El build tiene que reemplazar
    `target/release/oruka.exe`, y Windows no deja borrar un ejecutable en
    marcha: sale «Acceso denegado (os error 5)». Es la trampa 8 en versión
    instalador. Cierra la Oruka **construida desde el proyecto** (la instalada
    vive en otra carpeta y no estorba) antes de `npm run publicar`. Pendiente:
    que el script lo detecte y lo diga con una frase clara, o que construya en
    otro `CARGO_TARGET_DIR`.
34. **En Windows el PATH que hereda la app puede estar caducado.** El
    Explorador se queda con su copia desde que inicias sesión, así que lo que
    instales después existe pero la app no lo ve: `winget` dice «ya está
    instalado» y Oruka insiste en que falta. Por eso `resolve_bin` consulta el
    registro cuando algo no aparece en el PATH heredado, y **no cachea** el
    resultado: cachearlo reintroduce el fallo en cuanto instalas algo con la
    app abierta.
35. **`gh auth login` es interactivo y no hay flag que lo evite.** Si ya hay
    sesión pregunta si quieres reautenticarte. Enseñar su salida sin poder
    contestarle deja la pantalla colgada para siempre: por eso la pantalla de
    GitHub tiene un campo para responder y un botón para cancelar.
36. **El acelerador por GPU de la terminal hay que cargarlo a mano.** El addon
    de WebGL estaba en las dependencias desde el principio y no se cargaba: se
    pagaba el renderizador por DOM sin motivo, y en un equipo modesto eso hunde
    la app. Va con red doble: si no hay aceleración, se deja el camino lento; y
    si se pierde el contexto (al suspender el portátil) se descarta el addon.
37. **Un check de CI no tiene por qué venir de un workflow.** El token de `gh`
    no tiene el scope `workflow` y GitHub rechaza subir nada bajo
    `.github/workflows/` (responde 404), así que montar el CI del repo de
    pruebas parecía bloqueado. No lo está: `gh pr checks` lee el
    `statusCheckRollup`, que **junta los check-runs de Actions con los commit
    statuses clásicos**, y esos se publican con
    `gh api --method POST repos/OWNER/REPO/statuses/SHA -f state=... -f context=...`,
    que solo pide `repo`. Oruka no distingue unos de otros: le llegan iguales
    por `parse_checks`. Sirve para poblar el panel de comprobaciones sin tocar
    el scope ni el navegador. Lo que **no** da es una ejecución real: no hay
    logs ni reintento, solo el punto de color.

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

**Que se pueda instalar y compartir.** Un instalador de 2,00 MB, sin cuenta ni
servicios de fondo, que se actualice solo cuando salga una versión nueva.

---

## Qué falta, por orden

### Sin verificar a mano (escrito y en verde, nunca probado en la app)

Pesa más que lo que falta por hacer: hay mucho código nuevo que nadie ha visto
funcionar contra datos reales.

- **El módulo GitHub, a medias (2026-08-22).** Probado en la app contra
  `oruka-pruebas`:
  - **Verificado leyendo:** issues, lista de repos, lista de PR, diff y el panel
    de comprobaciones con su verde y su rojo.
  - **Verificado escribiendo:** comentar un PR (llega a GitHub y avisa), y el
    rechazo de GitHub al pedir cambios sobre un PR propio (se explica en
    castellano en vez de soltar el error crudo).
  - **Sigue sin ejecutarse nunca:** invitar, cambiar permiso, quitar acceso,
    crear PR, **fusionar** y **cerrar**. Fusionar es la que más importa: es la
    que tiene que avisar de la comprobación en rojo.
  - **No se puede probar sin una segunda cuenta:** aprobar y pedir cambios
    —GitHub los bloquea sobre tu propio PR—, y las invitaciones recibidas.
- Que las sesiones vuelvan al reabrir, con su modo, y que el agente retome la
  conversación.
- La casilla «continuar la última conversación» al lanzar un agente.
- **Verificado en la app (2026-08-21):** el aviso de versión nueva sale abajo a la
  derecha y se maneja desde ahí. Queda por confirmar que descargar y reiniciar
  aplican la versión.
- Las barras de gasto, ahora **en la barra de estado y por CLI**, no por agente:
  - **Codex (arreglado y probado con tests):** `codex.json` tiene `marker: "% context left"` con `number: "before"`. El parser hacia atrás (`numero_hacia_atras`) fallaba al encontrarse secuencias de escape ANSI intercaladas (`ESC[2m`, `ESC[79C`, `ESC[0m`, `ESC[22m`), confundiendo los números del código de escape o partiendo la marca. Se corrigió limpiando escapes (`sin_escapes`) antes del escaneo.
  - **Claude (comportamiento normal):** solo imprime `You've used N% of your weekly limit` cuando se acerca al límite semanal; antes no emite texto de cuota y la UI honestamente no muestra barra en vez de inventar un 0%.
  - **Agy (verificado lanzando el CLI):** no publica cuota ni uso en la terminal; se deja sin bloque `usage` en `agy.json`.
- Que ya no salga la consola negra al entrar en Ajustes, ni se congele.
- El repintado de la terminal al volver a una pestaña.
- El reparto de roles: que al abrir una carpeta aparezcan los `.md` con el
  bloque, que abrirla otra vez no cambie nada, y que revertir deje el archivo
  exactamente como estaba. **Escribe en el repositorio del usuario**: es lo que
  más cuidado merece de todo lo de esta lista.

**Color de los agentes: sin cerrar.** Se declaran `TERM`, `COLORTERM` y
`FORCE_COLOR`, y `cargo run --example color_check` demuestra que codex, agy y
claude **sí emiten color** por este mismo PTY en sesión interactiva. Aun así se
reportaron codex y agy en gris. Si se repite con el build actual, el fallo está
entre Rust y xterm.js, no en los CLIs.

### Entorno de pruebas de GitHub (completado y limpiado)

- Repositorio de pruebas `oruka-pruebas` limpiado: Issue **#1** cerrado, PR **#2** cerrado, rama `prueba-diff` eliminada y carpeta local eliminada del sistema.
- Se verificaron en la app la lectura de issues, lista de repos, lista de PRs, diff y comprobaciones en verde/rojo.


### Decisiones tomadas hoy que aún no son código

**El registro de pushes** (pedido, diseñado, sin empezar). Cada vez que se
suba algo, anotar fecha, rama, cuántos commits y **qué agentes estaban en
marcha**. Va a un archivo aparte **sin versionar** (`.oruka/historial.md`), no
al bloque de roles: escribir en un archivo versionado deja el árbol sucio justo
después de subir, y esa línea entra en el commit siguiente, que provoca otro
push. Se muerde la cola. El bloque de roles llevaría una línea diciéndole a los
agentes que lean ese archivo. Detectarlo es viable: `github::branch_status` ya
da los commits por delante del remoto, y pasar de N a 0 es un push.

**Carpetas de trabajo en Ajustes está bloqueado por la regla 1**, no por
pereza. Las carpetas viven en el almacén del Workspace y Ajustes no puede
importar de otro módulo: hay lint que rompe el build. Tres salidas: sacarlas a
un sitio común fuera de ambos (lo limpio, es refactor de la persistencia, que
hoy guarda carpetas y pestañas juntas), hablar por el bus con `bus.request`
(menos código, más indirección), o **quitar la sección**, ya que las carpetas
se gestionan desde el Workspace, que es donde se usan. Dejar un cartel de
«Pendiente» es la peor de las tres.

**El tope de 5000 caracteres por idea no está en el código.** Es una
restricción de la base de datos de producción, compartida con Idearia. Subirlo
es una migración de Supabase y necesita permiso explícito.
### Pedido y sin empezar

| Qué | Estado |
|---|---|
| **0router** | Investigado, sin empezar. Es un **servidor local** al que apuntan los CLIs, no un agente: no va en `packages/adapters/`. Su sitio es una sección propia que lo detecte, lo arranque y configure a los CLIs, reutilizando la escritura segura de MCP. Falta confirmar **CLI por CLI** cómo se le indica un servidor propio. No está instalado en el equipo. |
| **Auto-actualización** | **Hecha y verificada.** Aviso en la barra de estado, con comprobación manual pulsando la versión. |
| **Roles entre agentes** | **Hecho, y configurable desde Ajustes.** Cada CLI recibe su papel en el archivo que ya lee (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), como un **bloque delimitado**: lo que está fuera de las marcas no se toca nunca. Viene **apagado**: esos archivos son del usuario. Se dispara al abrir una carpeta. **Sin verificar en la app.** |
| **Marcas de gasto** | **Corregido y verificado.** Lanzado `token_check` para los CLIs: codex emite `N% context left` pero venía envuelto en escapes ANSI que rompían el escaneo hacia atrás (reparado con `sin_escapes` y test en Rust). claude solo avisa cuando se acerca al límite semanal (diseño honesto: sin dato no hay barra). agy no publica cuota (comprobado en 25 s, sin bloque `usage`). |
| **Skills de ECC en agy** | Diagnosticado y **no es del proyecto**: codex tiene 209 skills en `~/.codex/skills` y su `ecc-install-state.json`; agy solo una en `~/.gemini/skills` y ningún estado de instalación. ECC nunca se instaló para agy. |
| **Captura real con agentes** | La landing usa una recreación generada con codex, etiquetada como tal. Falta lanzar dos o tres agentes de verdad y capturar. |
| **Repositorio público** | **Hecho.** `oruka` es público desde el 2026-08-21; historial revisado, sin secretos. **`folio` tambien quedo publico por error** y está pendiente de decidir si se cierra. |
| **Rotar el token de Supabase** | El `refresh_token` quedó visible en un transcript. Cerrar sesión en la app y volver a entrar lo revoca. |

### Infraestructura

- **No hay CI** que ejecute lint, tests y el presupuesto de peso.

### Ideas

- Subir el tope de 5000 caracteres por idea. **Bloqueado:** no está en el
  código, es una restricción de la base de datos de producción. Es una
  migración de Supabase y necesita permiso explícito.
- Editar la **descripción** de un proyecto. El título y el borrado ya están
  (doble clic para renombrar; borrar avisa de cuántas ideas se pierden).
- Imagen: transcripción y mockup ASCII. Están en `ai.ts` pero sin interfaz.
  Prioridad baja: de 86 ideas reales, ninguna es de imagen.

### Workspace

- Selector de layout manual.
- ~~Estado real del agente~~ **hecho**: el punto de cada panel dice trabajando
  (late), en silencio o terminado. Solo tres y no cuatro a propósito: «inactivo»
  y «esperando» son indistinguibles desde fuera, e inventar esa diferencia sería
  decirle al usuario algo que no se sabe.
- Divisores arrastrables.
- Buscar dentro de la terminal.

### MCP

- **Plantillas de fábrica disponibles (7):** GitHub, Context7, **Browser Harness** (`@blopai/browser-harness`), Playwright, Filesystem, Memory y Pencil.
- Formulario para añadir un MCP propio.
- Credenciales en el gestor del sistema.
- Soportar `opencode.jsonc` con comentarios en vez de negarse. Hoy Oruka se
  niega porque `serde_json` no entiende comentarios y reescribir el archivo se
  los borraría. El camino: localizar el tramo del objeto `mcp` en el texto
  original y editar **solo ese tramo**, dejando intacto todo lo demás — que es
  lo que `toml_edit` hace solo para codex.

### Cierre

- Empaquetado para macOS y Linux.
- Recortar la app Flutter a **Oruka Capture**.
- Apagar la web de Idearia.

### Landing

Publicada como artefacto privado: captura de la app, arte ASCII generado con
codex y descarga apuntando a `releases/latest`, que se actualiza sola con cada
release nueva. **Su fuente ya está en el repositorio**, en `docs/landing.html`.

Lo que sí caduca es el **tamaño anunciado**: aparece cuatro veces en la página y
hay que cambiarlo a mano cuando cambie el instalador. Hoy dice 2,00 MB.

**Resuelto el 2026-08-22:** `v0.1.15` es la release `Latest`, así que
`releases/latest` ya reparte el instalador al día. Lo único que sigue
caducando a mano es el tamaño anunciado.

---

## Cómo verificar que sigue sano

    npm run lint      # la frontera entre módulos
    npm run build     # typecheck y tamaño de los chunks
    cd src-tauri && cargo test --lib
    cargo run --example spawn_check -- claude

Y a mano: añadir carpeta de trabajo, abrir un proyecto, lanzar dos agentes,
cambiar de pestaña y volver comprobando que siguen vivos, y entrar en Ideas para
ver los proyectos reales de la cuenta.
