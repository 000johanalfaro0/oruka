import { useEffect, useState } from 'react'
import { detectClis, type DetectedCli } from '@/lib/agents'
import { githubStatus, type GithubStatus } from '@/lib/github'
import { McpMatrix } from '@/shared/McpMatrix'
import { storeGet, storeRemove, storeSet } from '@/lib/store'
import './setup.css'

const STORAGE_KEY = 'oruka.setup.done'

export async function isSetupDone(): Promise<boolean> {
  return (await storeGet(STORAGE_KEY)) === '1'
}

const STEPS = ['CLIs', 'GitHub', 'MCP', 'Listo'] as const

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
                Oruka funciona con los que tengas. No hace falta instalar nada más.
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
                  </li>
                ))}
              </ul>
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
                Si ya usas <code>gh</code>, Oruka reutiliza esa sesión y no guarda ninguna
                credencial.
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
                <div className="setup__gh">
                  <i className="codicon codicon-warning" aria-hidden="true" />
                  <div>
                    <strong>{gh.message ?? 'sin sesión'}</strong>
                    <span className="setup__scopes">
                      {gh.installed
                        ? 'Ejecuta gh auth login y vuelve a comprobarlo desde Ajustes.'
                        : 'El módulo GitHub quedará desactivado hasta que lo configures.'}
                    </span>
                  </div>
                </div>
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

/** Borra la marca de configurado y recarga: el Quick Setup vuelve a salir. */
export function relaunchSetup() {
  void storeRemove(STORAGE_KEY).then(() => window.location.reload())
}
