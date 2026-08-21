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
