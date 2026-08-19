# Oruka

Orquestador desktop de agentes CLI. Ejecuta, coordina y supervisa varios agentes de IA
locales en distintos proyectos, con GitHub y MCP integrados, y un bloc de ideas que alimenta
a esos agentes.

    idea  ->  proyecto  ->  agente  ->  PR

## Modulos

| Modulo | Que hace |
|---|---|
| Workspace | Carpeta de trabajo, proyectos en pestanas, hasta 4 agentes por proyecto |
| GitHub | Repos propios y compartidos, colaboradores y PR del proyecto activo |
| Ideas | Bloc de ideas y horario; el prompt de un proyecto se manda a un agente |
| Ajustes | Todo lo del Quick Setup, editable siempre |

## Requisitos

- Node 20 o superior
- Rust estable (`rustup`)
- En Windows: WebView2 (viene de serie en Windows 11)
- Opcional: `gh` autenticado, para el modulo GitHub

Los CLIs de IA (`claude`, `codex`, `agy`, `opencode`, u otros) se detectan solos si estan en
el PATH. No hace falta tenerlos todos.

## Desarrollo

    npm install
    npm run app        # arranca la app de escritorio
    npm run dev        # solo el front, en el navegador

## Comprobaciones

    npm run build      # typecheck + bundle
    npm run lint       # incluye la frontera entre modulos

`npm run lint` falla a proposito si un modulo importa a otro. Es la barandilla que mantiene
la arquitectura: para hablar entre modulos se usa el bus (`src/shell/bus.ts`).

## Arquitectura en una frase

El shell no conoce a los modulos: los carga desde `src/shell/moduleRegistry.ts` a traves de
un contrato (`src/types/module.ts`), en diferido. Lo que varia -- CLIs, MCPs, colores -- es
dato, no codigo.
