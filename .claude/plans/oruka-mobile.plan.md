# Plan: Oruka Mobile (mando a distancia)

**Origen**: petición del usuario, aprobada el 2026-09-01.
**Complejidad**: Grande.

---

## 1. Qué se pide

Una Oruka para el teléfono. Desde el móvil:

1. Ver los proyectos abiertos y los agentes que trabajan en cada uno.
2. Abrir el chat de un agente y leer lo que dice.
3. Escribirle, y que ese texto entre en la sesión **real** del PC.
4. Tener también la ventana de Ideas.

El PC hace el trabajo. El móvil mira y habla.

## 2. Decisiones aprobadas

- **Conexión: por Supabase**, que ya se usa para Ideas y para entrar. No se abre
  ningún puerto en casa y funciona desde cualquier red. Coste: el texto de la
  terminal pasa por la nube del propio usuario.
- **App móvil: una web instalable (PWA)**, en el mismo repositorio, publicada en
  GitHub Pages. Sin tiendas, sin firmas, sin SDK de Android.

## 3. Cómo funciona

```
MÓVIL                 SUPABASE                    PC (Oruka)

escribo "sigue"  ──►   remote_input   ──►   el puente lo recoge
                                                    │
                                              agent_write(sesion)
                                                    │
                                                  PTY real
                                                    │
leo la respuesta ◄──   remote_output   ◄──   salida limpia y troceada
veo proyectos    ◄──   remote_state    ◄──   estado del workspace
```

Reglas del puente:

- El PC es el único que toca el PTY. El móvil nunca ejecuta nada: deja texto y
  el PC decide.
- El puente vive **fuera de React** (como `escuchas` en `workspaceStore.ts`).
  Dentro de un componente se moriría al cambiar de ventana (trampas 18 y 27).
- La salida va **sin escapes ANSI** y troceada por tiempo (~300 ms), no byte a
  byte.
- Cada trozo lleva el `seq` que ya existe: quien se reengancha pide desde su
  último `seq` y no ve nada dos veces (trampa 11).

## 4. Piezas que ya existen

| Pieza | Dónde |
|---|---|
| Sesiones con PTY, `write`, `scrollback`, eventos `pty:<id>` | `src-tauri/src/pty.rs` |
| Comando de escritura | `src-tauri/src/lib.rs:241` (`agent_write`) |
| Limpiador de escapes ANSI | `src-tauri/src/pty.rs:140` (`sin_escapes`) |
| Contador de bytes `seq` | `src-tauri/src/pty.rs` (`Scrollback`) |
| Cuenta y sesión | `src/auth/session.ts`, `src/lib/supabase.ts` |
| Ideas completo | `src/modules/ideas/repository.ts` |
| Estado de proyectos y agentes | `src/modules/workspace/workspaceStore.ts` |
| Paleta | `src/ui/tokens.css` |

## 5. Dónde vive cada cosa

Las reglas 1 y 2 del proyecto obligan a partir el puente en dos:

| Parte | Sitio | Por qué |
|---|---|---|
| Transporte con Supabase | `src/lib/relay.ts` | Fontanería, como `github.ts`. No sabe qué es un agente |
| Enganche con las sesiones | `src/modules/workspace/remoteBridge.ts` | Solo Workspace conoce los agentes |
| Espejo de Ideas | `src/modules/ideas/repository.ts` | Se reusa tal cual |

## 6. Archivos

| Archivo | Acción | Para qué |
|---|---|---|
| `supabase/migrations/<fecha>_remote.sql` | CREAR | 3 tablas + RLS por `user_id` + borrado por antigüedad |
| `src/lib/relay.ts` | CREAR | Canal, publicar, suscribirse, reconectar |
| `src/modules/workspace/remoteBridge.ts` | CREAR | Publica estado y salida; aplica la entrada del móvil |
| `src/modules/workspace/workspaceStore.ts` | EDITAR | Arranca y para el puente; expone el interruptor |
| `src/modules/workspace/index.tsx` + css | EDITAR | Interruptor «Mando a distancia» y aviso visible |
| `src-tauri/src/lib.rs` | EDITAR | Comando que limpia escapes y escribe con marca de origen |
| `mobile/` | CREAR | PWA: html, manifiesto, service worker, vite |
| `mobile/src/screens/Projects.tsx` | CREAR | Proyectos y agentes con su punto de estado |
| `mobile/src/screens/Chat.tsx` | CREAR | Lee la salida, envía texto |
| `mobile/src/screens/Ideas.tsx` | CREAR | Reusa `repository.ts` |
| `.github/workflows/pages.yml` | CREAR | Publica la PWA (ojo trampa 37: falta scope `workflow`) |
| `ESTADO.md` | EDITAR | Módulo nuevo, decisiones y trampas nuevas |

## 7. Fases

### Fase 0 — Esquema en Supabase
- Tablas: `remote_state` (una fila por PC), `remote_output` (trozos con `seq`),
  `remote_input` (lo que manda el móvil).
- RLS: cada fila pertenece al `user_id` que la creó. Sin excepción.
- Borrado de la salida a las 24 h.
- **Valida**: leer desde otra cuenta devuelve cero filas.

### Fase 1 — Transporte
- `src/lib/relay.ts` con publicar, suscribirse, leer desde un `seq`, reconectar.
- **Valida**: `npm run lint && npm run build`.

### Fase 2 — El PC publica
- `remoteBridge.ts`: publica proyectos, agentes y actividad; publica la salida
  limpia y troceada.
- Interruptor apagado por defecto, con cartel de qué implica.
- Comprobar la CSP en release (trampa 17).
- **Valida**: con el interruptor puesto, las filas aparecen en Supabase.

### Fase 3 — El PC obedece
- El puente escucha `remote_input` y llama a `agent_write`.
- Cola por sesión, para que el orden se respete.
- Registro local de cada entrada remota.
- **Valida**: insertar una fila a mano en Supabase escribe en la terminal del PC.

### Fase 4 — PWA: entrar y ver
- Paquete `mobile/`, login con la misma cuenta, lista de proyectos y agentes.
- **Valida**: abrir en el móvil y ver los proyectos reales.

### Fase 5 — PWA: el chat
- Conversación con texto limpio, autoscroll, campo de escritura, Enter y Escape.
- Reenganche por `seq`.
- **Valida**: escribir desde el móvil y ver responder al agente en ambos lados.

### Fase 6 — PWA: Ideas
- Lista, detalle y crear idea. Solo lo que ya hace el escritorio.
- **Valida**: crear una idea en el móvil y verla en el escritorio.

### Fase 7 — Publicar y documentar
- GitHub Pages, icono, manifiesto, instalable. `ESTADO.md` al día.

## 8. Comprobaciones

```bash
npm run lint
npm run build
cd src-tauri && cargo test --lib
```

A mano: abrir el móvil, escribir en un agente y comprobar que la terminal del PC
recibe exactamente eso.

## 9. Riesgos

| Riesgo | Peso | Qué hacer |
|---|---|---|
| **El móvil puede hacer que el PC ejecute cosas.** Un agente en yolo obedece sin preguntar | CRÍTICO | Apagado por defecto; emparejar el móvil una vez; aviso siempre visible; se corta al cerrar la app |
| **La pantalla del agente sale a la nube.** Puede llevar código, rutas y secretos impresos por herramientas | ALTO | Nube del propio usuario con RLS; solo las sesiones marcadas; borrado a 24 h; letra clara en el interruptor |
| Trampa 17: la CSP solo muerde en release | MEDIO | Probar el build instalado, no solo `npm run app` |
| Trampa 18: el puente muere al cambiar de ventana si vive en React | MEDIO | Vive en el store |
| Trampa 11: salida duplicada al reengancharse | MEDIO | Usar el `seq` que ya existe |
| Trampa 37: no se pueden subir workflows con el token actual | BAJO | Publicar Pages a mano la primera vez |
| Límites de Supabase Realtime con salida continua | MEDIO | Trocear por tiempo; solo sesiones marcadas |
| Reglas 1 y 2 de módulos | BAJO | Transporte en `lib/`, enganche en `workspace/` |

## 10. Aceptación

- [ ] Desde el móvil veo los proyectos abiertos y sus agentes con estado real.
- [ ] Abro un agente y leo lo que dice, legible, sin basura de escapes.
- [ ] Escribo y el texto entra en esa sesión del PC.
- [ ] Veo y creo ideas.
- [ ] El mando está apagado por defecto y se ve cuando está encendido.
- [ ] `npm run lint`, `npm run build` y `cargo test --lib` en verde.
- [ ] `ESTADO.md` actualizado.

## 11. Progreso

| Fase | Estado |
|---|---|
| 0 Esquema | **hecha** (aplicada en `pkkofllpzmmvzjlfhhoa`, RLS verificado, sin alertas nuevas). SQL en `supabase/migrations/20260901_remote.sql`. Tabla renombrada a `remote_hosts` |
| 1 Transporte | **hecha**: `src/lib/relay.ts`. El cliente de Supabase se pasa por parámetro (`createRelay`) porque el escritorio y el móvil usan clientes distintos. Lint y build en verde |
| 2 El PC publica | **escrita**: `remoteBridge.ts` + interruptor en el Workspace + aviso rojo en el pie. Sin probar en la app |
| 3 El PC obedece | **escrita**: el puente escucha `remote_input` y llama a `agent_write`. Solo escribe en sesiones que existen. Sin probar en la app |
| 4 PWA ver | **escrita**: `mobile/` con login y lista de equipos, proyectos y agentes. Sin probar en un teléfono |
| 5 PWA chat | **escrita**: lectura por `seq`, reenganche al recuperar red, envío de texto y dos teclas (Esc, Parar). Sin probar |
| 6 PWA ideas | **escrita**: reusa `repository.ts` mediante un cambio de alias en `mobile/vite.config.ts`. Sin probar |
| 7 Publicar | pendiente. Falta subir `dist-apk/oruka.apk` como archivo de una release |
| 8 Módulo Móvil (pedido después) | **escrito**: sección propia junto a Ideas con los tres pasos, QR del APK y QR de vinculación |
| 9 APK | **construido y verificado**: `npm run apk` → `dist-apk/oruka.apk`, 1,5 MB, con la web dentro |

## 14. Cambio de rumbo (mismo día)

El usuario pidió que esto no fuera una web suelta sino **una sección «Móvil»
junto a Ideas**, con la descarga del APK y la vinculación por QR. Lo anterior no
se tiró: la web del teléfono, el cartero y el puente son exactamente las mismas
piezas, ahora envueltas en un APK y con una puerta de entrada mejor.

Lo que cambió:

- **Módulo nuevo** `src/modules/mobile/`, registrado junto a Ideas. Tres pasos
  numerados: conectar, instalar, vincular.
- **El interruptor se mudó** del Workspace a ese módulo. Viaja por el bus
  (`workspace.setRemote`), porque los módulos no se importan entre sí. El estado
  vuelve por `workspace.remoteState`, que es retenido.
- **Vinculación por QR sin contraseña.** Tabla `remote_pairings` + la función
  `canjear_vinculacion`, que devuelve la sesión y borra la fila en el mismo
  paso. El QR solo lleva doce letras que caducan en 5 minutos.
- **APK de verdad**, no una web instalable: `android/` es un WebView que sirve
  `dist-mobile` por https (sin eso no hay cámara ni sesión guardada).
- **Escaneo con el lector del sistema** (`BarcodeDetector`), sin librería. Donde
  no exista, el código se escribe a mano.

## 15. Deuda conocida

- **`eslint.config.js` no incluye `mobile` en la lista de módulos**, así que la
  regla «un módulo no importa a otro» no vigila el módulo nuevo. El código la
  respeta, pero nadie lo comprueba. Editar ese archivo está bloqueado por el
  hook de protección de configuraciones.
- El APK va firmado con la clave de depuración. Se instala, pero no sirve para
  actualizar sobre uno firmado con clave propia. Para eso, definir
  `ORUKA_APK_KEYSTORE` antes de `npm run apk`.
- Nada de esto se ha visto funcionar contra un teléfono real.

## 12. Pendiente de probar a mano

Nada de lo anterior se ha visto funcionar contra datos reales. En orden:

1. `npm run app`, entrar en Workspace, encender «Mando a distancia». Debe aparecer
   el aviso rojo en el pie y una fila en `remote_hosts` con `online = true`.
2. Abrir un proyecto con un agente y comprobar que llegan filas a `remote_output`.
3. Insertar a mano una fila en `remote_input` y ver que la terminal la teclea.
4. `npm run mobile`, abrirlo desde el teléfono contra la IP de este equipo,
   entrar, ver los agentes y escribir a uno.
5. Comprobarlo con la app **compilada en release**: la CSP solo se aplica ahí
   (trampa 17), y esto habla por `wss` con Supabase.

## 13. Decisiones nuevas que no estaban en el plan

- La tabla `remote_state` se llamó al final `remote_hosts`, con una columna
  `state`: una fila es un equipo, no un estado suelto.
- El cliente de Supabase se pasa por parámetro a `createRelay` en vez de
  importarlo. El escritorio guarda su sesión en disco por Tauri y el móvil en el
  navegador: son dos clientes y el transporte no puede elegir por ellos.
- La limpieza de escapes ANSI se hace en TypeScript, no en Rust. Tocar el camino
  del PTY para esto arriesgaba lo que ya funciona en el escritorio.
- El móvil manda solo dos teclas, Esc y Parar. Un teclado entero a distancia es
  un juguete peligroso.
