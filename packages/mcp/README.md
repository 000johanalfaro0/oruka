# Catalogo de MCP

Igual que los CLIs, cada servidor MCP conocido es **un JSON, no codigo**. El usuario
puede anadir los suyos desde Ajustes indicando comando, argumentos y variables.

`requiresEnv` lista las variables de entorno que el servidor necesita. **Oruka no escribe
secretos** en las configuraciones: deja la referencia `${VARIABLE}` y avisa en la interfaz
de que hay que definirla en el entorno. Un token en texto plano dentro de `~/.claude.json`
es justo lo que no queremos provocar.

Un servidor puede venir **dentro de otra aplicacion** en vez de lanzarse con `npx`.
Entonces su ruta lleva la carpeta del usuario, la version instalada y el binario de su
sistema, y eso no cabe en un archivo del repositorio. Para eso el `command` admite tres
marcas: `~` al principio, `{platform}` para el sufijo del binario, y `*` en un tramo, que
se queda con la ultima coincidencia por orden alfabetico (la version mas nueva). Si nada
coincide se deja el patron tal cual: el usuario lo ve en el diff y no aplica, que es mejor
que escribirle media ruta como si fuera buena.

## Que NO entra aqui

Solo entra lo que **habla el protocolo MCP**: un proceso que se queda vivo y
responde por stdio. Una herramienta de linea de comandos no lo hace, aunque se
instale con `npx` igual que muchos servidores.

Browser Harness (`@blopai/browser-harness`) estuvo en esta carpeta y no debia:
publica una CLI. El cliente lo arrancaba, el programa imprimia su ayuda y
terminaba, y el cliente registraba «conexion cerrada» en cada arranque. Un error
permanente de algo que funciona perfectamente. Su sitio es `packages/skills/`.

La prueba antes de anadir un JSON aqui: lanza el comando y mandale una linea
`initialize` por stdin. Si contesta JSON-RPC y sigue vivo, es un servidor MCP.
Si imprime ayuda y termina, es una CLI y va en skills.
