import { useEffect, useState } from 'react'
import { detectClis, installCli, type DetectedCli } from '@/lib/agents'
import { githubInstall, githubLogin, githubStatus, type GithubStatus } from '@/lib/github'
import { onAgentExit, onAgentOutput } from '@/lib/agents'
import { McpMatrix } from '@/shared/McpMatrix'
import { RolesPanel } from '@/shared/RolesPanel'
import { storeGet, storeRemove, storeSet } from '@/lib/store'
import './setup.css'

const STORAGE_KEY = 'oruka.setup.done'

export async function isSetupDone(): Promise<boolean> {
  return (await storeGet(STORAGE_KEY)) === '1'
}

const STEPS = ['CLIs', 'GitHub', 'MCP', 'Roles', 'Listo'] as const

/**
 * Quick Setup del primer arranque.
 *
 * Es un atajo, no el unico camino: todo lo que se ve aqui se puede volver a
 * tocar siempre desde Ajustes. Por eso cada paso se puede saltar.
 */
export function QuickSetup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [clis, setClis] = useState<DetectedCli[] | null>(null)
  const [gh, setGh] = useState<GithubStatus | null>(null)
  /** Que CLI se esta instalando ahora, si hay alguno. */
  const [instalando, setInstalando] = useState<string | null>(null)
  /** El comando que se va a ejecutar, esperando confirmacion. */
  const [confirmar, setConfirmar] = useState<DetectedCli | null>(null)
  const [salida, setSalida] = useState<{ id: string; texto: string; mal: boolean } | null>(null)
  /** Lo que va escribiendo gh mientras autentica. */
  const [ghLog, setGhLog] = useState<string>('')
  const [ghBusy, setGhBusy] = useState<null | 'instalando' | 'conectando'>(null)

  /**
   * Instala gh y vuelve a preguntar por su estado.
   *
   * Se redetecta en vez de fiarse: es la unica forma de saber si de verdad
   * quedo instalado.
   */
  const instalarGh = async () => {
    setGhBusy('instalando')
    setGhLog('')
    try {
      await githubInstall()
      setGh(await githubStatus())
    } catch (e) {
      setGhLog(String(e).slice(-500))
    } finally {
      setGhBusy(null)
    }
  }

  /**
   * Conecta la cuenta sin salir de la app.
   *
   * gh abre el navegador y deja el codigo en el portapapeles; lo unico que
   * queda por hacer es pegarlo y aprobar. Al terminar el proceso se vuelve a
   * preguntar el estado, que es como se sabe si funciono.
   */
  const conectarGh = async () => {
    setGhBusy('conectando')
    setGhLog('')
    try {
      const off = await onAgentOutput('gh-login', (data) => {
        // Se quitan las secuencias de escape: aqui no hay terminal que las
        // entienda, y sin limpiarlas el codigo se lee entre basura.
        setGhLog((prev) => (prev + limpiar(data)).slice(-600))
      })
      const offExit = await onAgentExit('gh-login', () => {
        off()
        offExit()
        setGhBusy(null)
        void githubStatus().then(setGh)
      })
      await githubLogin()
    } catch (e) {
      setGhLog(String(e).slice(-500))
      setGhBusy(null)
    }
  }

  /**
   * Instala o actualiza un CLI y vuelve a mirar el PATH.
   *
   * Se redetecta al terminar en vez de fiarse: es la unica forma de saber si
   * de verdad quedo instalado, y de que salga su version nueva.
   */
  const instalar = async (c: DetectedCli) => {
    setConfirmar(null)
    setInstalando(c.id)
    setSalida(null)
    try {
      const texto = await installCli(c.id)
      setSalida({ id: c.id, texto: texto.trim().slice(-400) || 'Listo.', mal: false })
      setClis(await detectClis())
    } catch (e) {
      setSalida({ id: c.id, texto: String(e).slice(-400), mal: true })
    } finally {
      setInstalando(null)
    }
  }

  useEffect(() => {
    void detectClis().then(setClis)
    void githubStatus().then(setGh)
  }, [])

  const finish = () => {
    void storeSet(STORAGE_KEY, '1')
    onDone()
  }

  const found = clis?.filter((c) => c.found) ?? []

  return (
    <div className="setup">
      <div className="setup__card">
        <header className="setup__head">
          <h1 className="setup__brand">Oruka</h1>
          <ol className="setup__steps">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`setup__step${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
              >
                <span className="setup__num">{String(i + 1).padStart(2, '0')}</span>
                {label}
              </li>
            ))}
          </ol>
        </header>

        <div className="setup__body">
          {step === 0 && (
            <>
              <h2 className="setup__title">CLIs de IA en este equipo</h2>
              <p className="setup__hint">
                Oruka funciona con los que tengas. Si te falta alguno, puedes instalarlo desde
                aquí; verás el comando exacto antes de que se ejecute.
              </p>
              {!clis && <p className="setup__pending">Buscando en el PATH…</p>}
              <ul className="setup__clis">
                {clis?.map((c) => (
                  <li key={c.id} className={`setup__cli${c.found ? ' is-found' : ''}`}>
                    <i
                      className={`codicon codicon-${c.found ? 'pass-filled' : 'circle-large-outline'}`}
                      aria-hidden="true"
                    />
                    <span className="setup__cli-name">{c.name}</span>
                    <span className="setup__cli-version">{c.version ?? 'no encontrado'}</span>
                    {/* Sin comando declarado no hay boton. agy es un binario
                        nativo con instalador propio: ofrecerlo seria mentir. */}
                    {c.install && (
                      <button
                        className="setup__install"
                        disabled={instalando !== null}
                        onClick={() => setConfirmar(c)}
                      >
                        {instalando === c.id ? 'Instalando…' : c.found ? 'Actualizar' : 'Instalar'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Nada se ejecuta sin que el usuario haya leido el comando:
                  instalar algo en el equipo es mas serio que escribir en un
                  archivo de configuracion. */}
              {confirmar && (
                <div className="setup__confirm">
                  <p>Se va a ejecutar en tu equipo, y puede tardar unos minutos:</p>
                  <code>
                    {confirmar.install!.command} {confirmar.install!.args.join(' ')}
                  </code>
                  <div className="setup__confirm-acts">
                    <button className="setup__cancel" onClick={() => setConfirmar(null)}>
                      Cancelar
                    </button>
                    <button className="setup__go" onClick={() => void instalar(confirmar)}>
                      Ejecutar
                    </button>
                  </div>
                </div>
              )}

              {salida && (
                <pre className={`setup__salida${salida.mal ? ' is-mal' : ''}`}>{salida.texto}</pre>
              )}

              {clis && (
                <p className="setup__summary">
                  {found.length} de {clis.length} detectados
                </p>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="setup__title">GitHub</h2>
              <p className="setup__hint">
                Oruka trabaja con <code>gh</code>, la herramienta oficial de GitHub, y reutiliza
                su sesión: nunca ve tu token, así que tampoco puede perderlo. Por eso la sesión es
                de este equipo — <strong>entrar en Oruka no conecta GitHub</strong>.
              </p>
              {!gh && <p className="setup__pending">Comprobando…</p>}
              {gh && gh.authenticated && (
                <div className="setup__gh is-ok">
                  <i className="codicon codicon-pass-filled" aria-hidden="true" />
                  <div>
                    <strong>{gh.user}</strong>
                    <span className="setup__scopes">{gh.scopes.join(' · ')}</span>
                  </div>
                </div>
              )}
              {gh && !gh.authenticated && (
                <>
                  <div className="setup__gh">
                    <i className="codicon codicon-warning" aria-hidden="true" />
                    <div>
                      <strong>
                        {gh.installed ? 'Sin sesión en este equipo' : 'gh no está instalado'}
                      </strong>
                      <span className="setup__scopes">
                        {gh.installed
                          ? 'Conecta tu cuenta: se abre el navegador con el código ya copiado.'
                          : 'Hace falta para el módulo de GitHub. Se instala desde aquí.'}
                      </span>
                    </div>
                  </div>
                  <div className="setup__gh-acts">
                    {!gh.installed && (
                      <button
                        className="setup__go"
                        disabled={ghBusy !== null}
                        onClick={() => void instalarGh()}
                      >
                        {ghBusy === 'instalando' ? 'Instalando…' : 'Instalar gh'}
                      </button>
                    )}
                    {gh.installed && (
                      <button
                        className="setup__go"
                        disabled={ghBusy !== null}
                        onClick={() => void conectarGh()}
                      >
                        {ghBusy === 'conectando' ? 'Esperando al navegador…' : 'Conectar con GitHub'}
                      </button>
                    )}
                  </div>
                  {ghLog && <pre className="setup__salida">{ghLog}</pre>}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="setup__title">Servidores MCP</h2>
              <p className="setup__hint">
                Marca qué servidor va a qué CLI. Antes de escribir verás el cambio exacto sobre tu
                archivo, y siempre se guarda una copia previa.
              </p>
              <McpMatrix />
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="setup__title">Roles de los agentes</h2>
              <p className="setup__hint">
                Si dos agentes trabajan sobre los mismos archivos, hoy son dos desconocidos que se
                pisan. Oruka puede dejarle a cada uno un papel escrito en el archivo que ese CLI ya
                lee, y decirle que los demás existen.
              </p>
              <RolesPanel />
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="setup__title">Listo</h2>
              <p className="setup__hint">
                Lo siguiente es decirle a Oruka en qué carpeta trabaja: de ahí saldrán tus
                proyectos y, dentro de cada uno, hasta cuatro agentes.
              </p>
              <p className="setup__pending">Todo esto se puede cambiar luego en Ajustes.</p>
            </>
          )}
        </div>

        <footer className="setup__foot">
          <button className="setup__skip" onClick={finish}>
            Saltar configuración
          </button>
          <div className="setup__nav">
            {step > 0 && (
              <button className="setup__back" onClick={() => setStep((s) => s - 1)}>
                Atrás
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button className="setup__next" onClick={() => setStep((s) => s + 1)}>
                Siguiente
              </button>
            ) : (
              <button className="setup__next" onClick={finish}>
                Empezar
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Quita las secuencias de escape: aqui no hay terminal que las interprete. */
function limpiar(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
}

/** Borra la marca de configurado y recarga: el Quick Setup vuelve a salir. */
export function relaunchSetup() {
  void storeRemove(STORAGE_KEY).then(() => window.location.reload())
}
