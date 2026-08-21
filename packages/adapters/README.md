# Manifiestos de CLI

Cada CLI de IA que Oruka sabe lanzar es **un JSON de estos, no codigo**. Anadir uno nuevo no
recompila nada: el Quick Setup escribe un manifiesto igual que estos cuando anades un CLI
propio.

## Campos

| Campo | Que significa |
|---|---|
| `detect` | Como encontrarlo en el PATH y como preguntarle su version |
| `launch.cwd` | Como se le indica el directorio: `process` (heredado), `flag` o `positional` |
| `modes` | Perfiles de permisos. `yolo` es el que salta las confirmaciones |
| `resume` | Argumentos para reanudar la ultima sesion |
| `prompt` | Como se le entrega un prompt inicial. Es lo que permite "Idea -> Agente" |
| `mcp` | Formato y destino de su configuracion MCP, o `unsupported` |
| `roles` | Archivo que ese CLI lee dentro del proyecto y su papel por defecto frente a los demas agentes. Es un valor de fabrica, como los modos: el usuario lo cambia desde el Quick Setup. Un manifiesto sin este campo no participa en el reparto |

## Estado

Los flags de `claude`, `codex` y `agy` estan verificados contra su `--help` real. Los de
`opencode` estan a medias: falta confirmar su flag de permisos y la ruta de su config global.
`agy` no tiene mecanismo de MCP conocido y esta marcado como `unsupported` a proposito.
