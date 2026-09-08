import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Construye el APK de Android.
 *
 * Tres pasos: construir la web del telefono, meterla dentro del proyecto de
 * Android, y pedirle a Gradle el paquete. El resultado sale en `dist-apk/`.
 *
 *     npm run apk
 *
 * Para firmarlo con una clave propia en vez de la de depuracion, define
 * `ORUKA_APK_KEYSTORE` (y su contrasena) antes de llamar. La clave vive fuera
 * del repositorio, igual que la que firma las actualizaciones del escritorio.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const ANDROID = join(RAIZ, 'android')
const WEB_DENTRO = join(ANDROID, 'app', 'src', 'main', 'assets', 'web')
const SALIDA = join(RAIZ, 'dist-apk')

/**
 * Busca Gradle sin obligar a instalarlo.
 *
 * Android Studio deja una copia en el almacen de Gradle. Usarla evita meter el
 * «wrapper» —un binario— dentro de un repositorio que se enorgullece de no
 * llevar binarios.
 */
function buscarGradle() {
  const nombre = process.platform === 'win32' ? 'gradle.bat' : 'gradle'

  if (process.env.GRADLE_HOME) {
    const candidato = join(process.env.GRADLE_HOME, 'bin', nombre)
    if (existsSync(candidato)) return candidato
  }

  const almacen = join(homedir(), '.gradle', 'wrapper', 'dists')
  if (!existsSync(almacen)) return null

  // La version mas alta que haya, que es la que trae el Android Studio actual.
  const versiones = readdirSync(almacen)
    .filter((n) => n.startsWith('gradle-'))
    .sort()
    .reverse()

  for (const version of versiones) {
    const carpeta = join(almacen, version)
    const suelto = version.replace(/-(all|bin)$/, '')
    for (const hash of readdirSync(carpeta)) {
      const candidato = join(carpeta, hash, suelto, 'bin', nombre)
      if (existsSync(candidato)) return candidato
    }
  }
  return null
}

function paso(texto) {
  console.log(`\n== ${texto}`)
}

const gradle = buscarGradle()
if (!gradle) {
  console.error(
    'No encuentro Gradle. Instala Android Studio, o define GRADLE_HOME apuntando a una copia.',
  )
  process.exit(1)
}

if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  console.error('Falta ANDROID_HOME. Sin el SDK de Android no hay APK que construir.')
  process.exit(1)
}

paso('Construyendo la web del teléfono')
execFileSync('npm', ['run', 'mobile:build'], { cwd: RAIZ, stdio: 'inherit', shell: true })

paso('Metiéndola dentro de la app')
// Se borra antes de copiar: si no, un archivo que ya no existe en la web
// seguiria viajando dentro del APK para siempre.
rmSync(WEB_DENTRO, { recursive: true, force: true })
mkdirSync(WEB_DENTRO, { recursive: true })
cpSync(join(RAIZ, 'dist-mobile'), WEB_DENTRO, { recursive: true })

paso('Empaquetando con Gradle')
execFileSync(gradle, ['assembleRelease', '--console=plain'], {
  cwd: ANDROID,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

paso('Recogiendo el APK')
const construido = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!existsSync(construido)) {
  console.error(`Gradle terminó pero no encuentro el APK en ${construido}`)
  process.exit(1)
}
mkdirSync(SALIDA, { recursive: true })
const destino = join(SALIDA, 'oruka.apk')
cpSync(construido, destino)

console.log(`\nListo: ${destino}`)
if (!process.env.ORUKA_APK_KEYSTORE) {
  console.log(
    'Aviso: firmado con la clave de depuración. Se instala bien, pero no sirve\n' +
      'para actualizar sobre un APK firmado con una clave propia.',
  )
}
