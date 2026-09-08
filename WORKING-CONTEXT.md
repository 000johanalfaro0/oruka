# Retomar aquí — módulo Móvil de Oruka

**Checkpoint:** 2026-09-01, sobre `2eb11ad`. Nada está confirmado en git: hay 46
archivos sin guardar, y el trabajo de hoy está entre ellos.

Antes de nada, lee **[.claude/plans/oruka-mobile.plan.md](.claude/plans/oruka-mobile.plan.md)**:
tiene el plan entero, las decisiones y por qué se tomaron.

---

## Qué se hizo

Una forma de ver y manejar los agentes de Oruka desde el teléfono.

```
MÓVIL (APK)            SUPABASE                  PC (Oruka)

escribo "sigue"  ──►  remote_input   ──►   el puente lo recoge
                                                  │
                                            agent_write(sesión)
                                                  │
                                                PTY real
                                                  │
leo la respuesta ◄──  remote_output   ◄──   salida limpia y troceada
veo proyectos    ◄──  remote_hosts    ◄──   estado del workspace
vinculo con QR   ◄──  remote_pairings ◄──   código de un solo uso
```

| Pieza | Dónde | Estado |
|---|---|---|
| 4 tablas + 1 función en Supabase | `supabase/migrations/` | **Aplicadas y verificadas** en `pkkofllpzmmvzjlfhhoa` |
| Transporte | `src/lib/relay.ts` | Escrito |
| Puente del PC | `src/modules/workspace/remoteBridge.ts` | Escrito |
| Módulo Móvil (3 pasos + QR) | `src/modules/mobile/` | Escrito |
| Aviso rojo en el pie | `src/modules/workspace/UsageBar.tsx` | Escrito |
| Web del teléfono | `mobile/` | Escrita y compila |
| APK | `android/` + `scripts/apk.mjs` | **Construido: `dist-apk/oruka.apk`, 1,5 MB** |

Comprobaciones al cerrar: `npm run lint` ✅, `npx tsc --noEmit` ✅,
`npm run build` ✅, `npm run mobile:build` ✅, `cargo test --lib` 92 ✅,
`npm run apk` ✅.

---

## Lo que falta, por orden

### 1. Probarlo a mano (nada de esto se ha visto funcionar)

1. `npm run app` → pestaña **Móvil** → botón **Conectar**.
   Debe salir el aviso rojo «Móvil» abajo a la derecha, y una fila en
   `remote_hosts` con `online = true`.
2. Abrir un proyecto con un agente y comprobar que llegan filas a
   `remote_output`.
3. Pulsar **Generar código** y comprobar que sale el QR con su cuenta atrás.
4. Instalar `dist-apk/oruka.apk` en el teléfono, pulsar **Escanear**, apuntar al
   QR de la pantalla, y ver que entra sin escribir contraseña.
5. Escribirle a un agente desde el móvil y ver que la terminal del PC lo teclea.
6. Repetirlo con la app **compilada en release**: la CSP solo se aplica ahí
   (trampa 17), y esto habla por `wss` con Supabase.

### 2. Publicar el APK

El módulo Móvil enseña un QR que apunta a
`https://github.com/000johanalfaro0/oruka/releases/latest/download/oruka.apk`.
**Ese archivo todavía no existe.** Hay que subir `dist-apk/oruka.apk` como
archivo adjunto de la release `latest`. Hasta entonces, ese QR da 404.

### 3. Deuda conocida

- **`eslint.config.js` no tiene `mobile` en su lista de módulos**, así que la
  regla «un módulo no importa a otro» no vigila el módulo nuevo. El código la
  respeta —solo habla por el bus— pero nadie lo comprueba. Editar ese archivo
  está bloqueado por el hook de protección de configuraciones: hay que
  desactivarlo un momento y añadir `'mobile'` a `MODULES`.
- **El APK va firmado con la clave de depuración.** Se instala bien, pero no
  sirve para actualizar sobre uno firmado con clave propia. Para eso, definir
  `ORUKA_APK_KEYSTORE` (y su contraseña) antes de `npm run apk`. La clave debe
  vivir fuera del repositorio, como la de las actualizaciones.
- **`versionCode` del APK está fijo en 1** (`android/app/build.gradle.kts`). Al
  publicar una segunda versión hay que subirlo o Android no dejará actualizar.
- Ningún commit. Decidir qué entra: hay 46 archivos tocados y muchos venían de
  antes de esta sesión.

---

## Los dos riesgos que no hay que olvidar

1. **Conectado, el teléfono hace que el PC ejecute cosas.** Un agente en modo
   yolo obedece sin preguntar. Por eso viene desconectado, hay que conectarlo a
   mano, y mientras lo esté hay un aviso rojo latiendo en el pie que también
   sirve para apagarlo.
2. **Lo que sale en la terminal viaja a la nube.** Es la nube del propio
   usuario, con candado por cuenta y borrado a las 24 horas, pero una
   herramienta puede imprimir una clave en pantalla.

---

## Comandos

    npm run app          # el escritorio
    npm run mobile       # la web del teléfono, en el puerto 1421
    npm run apk          # construye dist-apk/oruka.apk
    npm run lint
    npm run build
    cd src-tauri && cargo test --lib
