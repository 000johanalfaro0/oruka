#!/usr/bin/env node
/**
 * Publica una version: firma, construye el manifiesto y sube la release.
 *
 * Hacerlo a mano son seis pasos y dos de ellos se olvidan solos. Si falta el
 * `latest.json`, o su firma no corresponde al instalador que se subio, la
 * comprobacion de actualizacion **falla en silencio**: nadie se entera de que
 * hay version nueva y no hay ningun error que lo delate. Por eso esto es un
 * script y no una lista en un documento.
 *
 *     npm run publicar -- 0.1.3 "Lo que cambia, en una linea"
 *
 * La clave privada vive fuera del repositorio. Sin ella no se firma, y sin
 * firma la actualizacion no sirve: se para antes de construir nada.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO = '000johanalfaro0/oruka'
const CLAVE = join(homedir(), '.oruka-updater.key')

function salir(msg) {
  console.error('\n' + msg + '\n')
  process.exit(1)
}

function corre(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    ...opts,
  })
}

const [version, notas] = process.argv.slice(2)
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  salir(
    'Uso: npm run publicar -- <version> "<notas>"\n' +
      'Ejemplo: npm run publicar -- 0.1.3 "Arregla el boton de instalar"',
  )
}

// 1. La clave. Se comprueba antes de construir nada: descubrir que falta
//    despues de dos minutos de compilacion es tiempo tirado.
if (!existsSync(CLAVE)) {
  salir(
    `No encuentro la clave de firma en ${CLAVE}.\n` +
      'Sin ella la version se construye pero nadie puede actualizarse a ella.\n' +
      'Si la perdiste no hay forma de recuperarla: habria que generar otra, y\n' +
      'quien tenga una version anterior se queda sin actualizaciones para siempre.',
  )
}

// 2. Que el arbol este limpio. Publicar con cambios sin commitear deja una
//    version que no corresponde a ningun commit, y luego no se sabe que lleva.
const sucio = corre('git', ['status', '--porcelain']).trim()
if (sucio) salir('Hay cambios sin commitear:\n' + sucio + '\nCommitealos antes de publicar.')

// 3. La version, en los tres sitios que tienen que coincidir.
for (const archivo of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']) {
  const antes = readFileSync(archivo, 'utf8')
  const nuevo = archivo.endsWith('.toml')
    ? antes.replace(/^version = "[^"]+"/m, `version = "${version}"`)
    : antes.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)
  if (antes === nuevo) salir(`No pude poner la version en ${archivo}`)
  writeFileSync(archivo, nuevo, 'utf8')
}
console.log(`Version ${version} puesta en los tres archivos.`)

// 4. Comprobaciones. No se publica algo que no pasa lo minimo.
console.log('Comprobando…')
corre('npm', ['run', 'lint'], { shell: true })
corre('npm', ['run', 'build'], { shell: true })
corre('cargo', ['test', '--lib'], { cwd: 'src-tauri', shell: true })

// 5. Construir firmado.
console.log('Construyendo y firmando…')
corre('npm', ['run', 'app:build'], {
  shell: true,
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(CLAVE, 'utf8'),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.ORUKA_KEY_PASSWORD ?? '',
  },
})

const base = 'src-tauri/target/release/bundle'
const exe = `${base}/nsis/Oruka_${version}_x64-setup.exe`
const sig = `${exe}.sig`
const msi = `${base}/msi/Oruka_${version}_x64_en-US.msi`
for (const f of [exe, sig]) if (!existsSync(f)) salir(`No se construyo ${f}`)

// 6. El manifiesto. La firma tiene que ser la de ESTE instalador: una de otro
//    build hace que la app rechace la actualizacion sin decir por que.
const manifiesto = {
  version,
  notes: notas || `Version ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(sig, 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/Oruka_${version}_x64-setup.exe`,
    },
  },
}
const latest = `${base}/latest.json`
writeFileSync(latest, JSON.stringify(manifiesto, null, 2) + '\n', 'utf8')

const mb = (readFileSync(exe).length / 1048576).toFixed(2).replace('.', ',')
console.log(`Instalador: ${mb} MB`)

// 7. Subir. El commit de la version va primero: la release apunta a un commit
//    que tiene que existir.
corre('git', ['add', '-A'])
corre('git', ['commit', '-q', '-m', `chore: version ${version}`])
corre('git', ['push', '-q', 'origin', 'main'])

corre('gh', [
  'release',
  'create',
  `v${version}`,
  exe,
  sig,
  msi,
  latest,
  '--repo',
  REPO,
  '--title',
  `Oruka ${version}`,
  '--notes',
  `${manifiesto.notes}\n\nInstalador de ${mb} MB. Windows 10 u 11.`,
])

console.log(
  `\nPublicada v${version}. Quien tenga 0.1.2 o posterior recibira el aviso al abrir la app.`,
)
