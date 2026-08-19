import { useState } from 'react'
import { ProjectList } from './ProjectList'
import { ProjectDetail } from './ProjectDetail'
import { Schedule } from './Schedule'
import type { Project } from './types'
import './ideas.css'

type View = 'ideas' | 'horario'

/**
 * Modulo Ideas. Absorbe Idearia contra la misma base de datos.
 *
 * Dos ventanas propias: Ideas (el que) y Horario (el cuando, construido sobre
 * scheduled_date). Todo el acceso a datos pasa por repository.ts.
 */
export default function IdeasModule() {
  const [view, setView] = useState<View>('ideas')
  const [open, setOpen] = useState<Project | null>(null)

  return (
    <div className="ideas">
      <div className="ideas__switch" role="tablist" aria-label="Vistas de Ideas">
        {(['ideas', 'horario'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`ideas__switch-item${view === v ? ' is-active' : ''}`}
            onClick={() => {
              setView(v)
              setOpen(null)
            }}
          >
            {v === 'ideas' ? 'Ideas' : 'Horario'}
          </button>
        ))}
      </div>

      <div className="ideas__body">
        {view === 'horario' ? (
          <Schedule
            onOpen={(p) => {
              setView('ideas')
              setOpen(p)
            }}
          />
        ) : open ? (
          <ProjectDetail project={open} onBack={() => setOpen(null)} />
        ) : (
          <ProjectList onOpen={setOpen} />
        )}
      </div>
    </div>
  )
}
