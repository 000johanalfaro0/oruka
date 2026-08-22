import { useCallback, useEffect, useState } from 'react'
import { githubInstall, githubLogin, githubStatus, type GithubStatus } from '@/lib/github'
import { onAgentExit, onAgentOutput } from '@/lib/agents'
import './github-account.css'

/**
 * La cuenta de GitHub: estado, instalar `gh` y conectar.
 *
 * Vive fuera de `modules/` porque la usan dos superficies: el Quick Setup del
 * primer arranque y Ajustes. Estaba solo en el primero, y eso dejaba a quien ya
 * hubiera pasado el asistente **sin ninguna forma de conectar la cuenta**: el
 * modulo entero de GitHub quedaba apagado y sin salida.
 *
 * Lo que no se puede automatizar es la aprobacion en el navegador: es GitHub
 * quien exige que una persona apruebe el acceso. Lo unico que puede hacer la
 * app es que no haya que teclear nada, y eso si esta.
 */
export function GithubAccount() {
  const [gh, setGh] = useState<GithubStatus | null>(null)
  const [log, setLog] = useState('')
  const [busy, setBusy] = useState<null | 'instalando' | 'conectando'>(null)

  const refrescar = useCallback(async () => {
    try {
      setGh(await githubStatus())
    } catch (e) {
      setLog(String(e).slice(-400))
    }
  }, [])

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  const instalar = async () => {
    setBusy('instalando')
    setLog('')
    try {
      await githubInstall()
      await refrescar()
    } catch (e) {
      setLog(String(e).slice(-400))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Conecta la cuenta sin salir de la app.
   *
   * `gh` abre el navegador y deja el codigo de un solo uso en el portapapeles.
   * Su salida llega por el mismo canal que la de un agente, con el id
   * `gh-login`: por eso hay que soltar las escuchas al terminar, o cada intento
   * dejaria una viva.
   */
  const conectar = async () => {
    setBusy('conectando')
    setLog('')
    try {
      const off = await onAgentOutput('gh-login', (data) => {
        setLog((prev) => (prev + limpiar(data)).slice(-600))
      })
      const offExit = await onAgentExit('gh-login', () => {
        off()
        offExit()
        setBusy(null)
        void refrescar()
      })
      await githubLogin()
    } catch (e) {
      setLog(String(e).slice(-400))
      setBusy(null)
    }
  }

  if (!gh) return <p className="gha__pending">Comprobando…</p>

  return (
    <div className="gha">
      {gh.authenticated ? (
        <div className="gha__estado is-ok">
          <i className="codicon codicon-pass-filled" aria-hidden="true" />
          <div>
            <strong>{gh.user}</strong>
            <span className="gha__scopes">{gh.scopes.join(' · ')}</span>
          </div>
          <button className="gha__secundario" onClick={() => void refrescar()}>
            Volver a comprobar
          </button>
        </div>
      ) : (
        <>
          <div className="gha__estado">
            <i className="codicon codicon-warning" aria-hidden="true" />
            <div>
              <strong>{gh.installed ? 'Sin sesión en este equipo' : 'gh no está instalado'}</strong>
              <span className="gha__scopes">
                {gh.installed
                  ? 'Se abrirá el navegador con el código ya copiado. No hay que teclear nada.'
                  : 'Sin gh, el módulo de GitHub queda apagado. Se instala desde aquí.'}
              </span>
            </div>
          </div>
          <div className="gha__acts">
            {gh.installed ? (
              <button className="gha__go" disabled={busy !== null} onClick={() => void conectar()}>
                {busy === 'conectando' ? 'Esperando al navegador…' : 'Conectar con GitHub'}
              </button>
            ) : (
              <button className="gha__go" disabled={busy !== null} onClick={() => void instalar()}>
                {busy === 'instalando' ? 'Instalando…' : 'Instalar gh'}
              </button>
            )}
          </div>
        </>
      )}

      {log && <pre className="gha__log">{log}</pre>}

      <p className="gha__nota">
        Oruka nunca ve tu token: trabaja con <code>gh</code> y reutiliza su sesión. Por eso la
        sesión es de <strong>este equipo</strong> — entrar en Oruka no conecta GitHub.
      </p>
    </div>
  )
}

/** Quita las secuencias de escape: aqui no hay terminal que las interprete. */
function limpiar(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/\[[0-9;?]*[A-Za-z]/g, '')
}
