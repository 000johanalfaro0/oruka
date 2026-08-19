# Oruka

Antes de tocar nada, lee **[ESTADO.md](ESTADO.md)**: tiene el estado real del
proyecto, la arquitectura, las decisiones tomadas con su porqué, y una lista de
trampas que cuestan horas si no se conocen.

## Lo mínimo que hay que respetar

- **Los módulos de `src/modules/` no se importan entre sí.** Hay lint que rompe
  el build si lo haces. Para comunicarlos existe `src/shell/bus.ts`.
- **El shell no conoce los módulos**, solo el contrato y el registro.
- **Ningún componente define colores**: todo sale de `src/ui/tokens.css`.
- **CLIs y MCP son JSON** en `packages/`, no código.
- **Nunca escribir secretos** en las configuraciones del usuario, y nunca tocar
  un archivo suyo sin copia previa, escritura atómica y diff visible.

## Comprobaciones

    npm run lint
    npm run build
    cd src-tauri && cargo test --lib
