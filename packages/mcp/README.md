# Catalogo de MCP

Igual que los CLIs, cada servidor MCP conocido es **un JSON, no codigo**. El usuario
puede anadir los suyos desde Ajustes indicando comando, argumentos y variables.

`requiresEnv` lista las variables de entorno que el servidor necesita. **Oruka no escribe
secretos** en las configuraciones: deja la referencia `${VARIABLE}` y avisa en la interfaz
de que hay que definirla en el entorno. Un token en texto plano dentro de `~/.claude.json`
es justo lo que no queremos provocar.
