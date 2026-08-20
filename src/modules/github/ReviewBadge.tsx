import { useEffect, useState } from 'react'
import { githubReviewCount } from '@/lib/github'
import { bus } from '@/shell/bus'

/**
 * Cuantos pull requests esperan tu revision.
 *
 * Vive en la barra de estado y no dentro del modulo a proposito: enterarte de
 * que te toca revisar algo solo sirve **mientras estas haciendo otra cosa**. Si
 * hubiera que abrir GitHub para verlo, ya habrias ido a mirar.
 *
 * Este archivo se carga en el arranque —la barra de estado no es diferida— asi
 * que se mantiene minusculo y sin mas dependencias que el puente.
 */

/** Cada diez minutos. Que te pidan revisar algo no es una carrera. */
const CADA = 10 * 60 * 1000

export function ReviewBadge() {
  const [cuantos, setCuantos] = useState(0)

  useEffect(() => {
    let vivo = true
    const mirar = () =>
      githubReviewCount()
        .then((n) => {
          if (vivo) setCuantos(n)
        })
        // Sin `gh`, sin sesion o sin red no se dice nada: un error permanente
        // en la barra de estado es ruido que nadie puede accionar.
        .catch(() => {
          if (vivo) setCuantos(0)
        })

    void mirar()
    const t = setInterval(() => void mirar(), CADA)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [])

  if (cuantos === 0) return null

  return (
    <button
      className="statusbar__item statusbar__item--action"
      onClick={() => bus.emit('shell.activateModule', { moduleId: 'github' })}
      title="Ir a GitHub"
    >
      <i className="codicon codicon-git-pull-request" aria-hidden="true" />
      {cuantos === 1 ? '1 PR espera tu revisión' : `${cuantos} PR esperan tu revisión`}
    </button>
  )
}
