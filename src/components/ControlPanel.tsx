import { Eraser } from 'lucide-react'
import { memo } from 'react'
import type { VideoFilters } from '../types'
import { FILTER_SLIDER_CONFIGS } from '../utils/videoFilters'

interface ControlPanelProps {
  script: string
  onScriptChange: (value: string) => void
  onClearScript: () => void
  fontSize: number
  onFontSizeChange: (value: number) => void
  isActive: boolean
  autoScrollSpeed: number
  onAutoScrollSpeedChange: (speed: number) => void
  videoFilters: VideoFilters
  onVideoFiltersChange: (filters: VideoFilters) => void
}

const MIN_FONT_SIZE = 20
const MAX_FONT_SIZE = 64

/** Rango decimal de alta precisión (paso 0.05): micro-ajustes ultrasuaves de velocidad, ver reshapeSensitivityCurve en App.tsx. */
const MIN_AUTO_SCROLL_SPEED = 0.05
const MAX_AUTO_SCROLL_SPEED = 5
const AUTO_SCROLL_SPEED_STEP = 0.05

/**
 * Memoizado: App.tsx re-renderiza seguido mientras el teleprónpter está
 * activo (el motor de auto-scroll no toca ninguna prop de este panel), pero
 * ninguno de esos cambios afecta las props de este panel. Sin memo, cada uno
 * de esos renders recorría también este árbol entero por nada mientras la
 * cámara graba en paralelo.
 */
export const ControlPanel = memo(function ControlPanel({
  script,
  onScriptChange,
  onClearScript,
  fontSize,
  onFontSizeChange,
  isActive,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
  videoFilters,
  onVideoFiltersChange,
}: ControlPanelProps) {
  const updateFilter = (key: keyof VideoFilters, value: number) => {
    onVideoFiltersChange({ ...videoFilters, [key]: value })
  }

  return (
    // Contenido del drawer de ajustes: App.tsx es quien lo posiciona flotando
    // (fixed) y lo muestra/oculta con el botón de engrane; este panel solo
    // necesita llenar ese contenedor con su propio scroll.
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-slate-900 p-5">
      {/* El botón de cerrar (X/engrane) vive en App.tsx, fixed en la esquina
          superior DERECHA por encima de todo (z-50). El de 'Limpiar' se
          ancla aquí, a la IZQUIERDA, en su propia capa dentro del flujo
          normal del panel (z-40 heredado del contenedor del drawer): así
          nunca comparten posición ni pueden traslaparse, sin importar el
          tamaño de pantalla o el safe-area-inset del dispositivo. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClearScript}
          disabled={!script.trim()}
          aria-label="Limpiar guion"
          title="Limpiar guion"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-300 transition hover:border-red-500/50 hover:bg-slate-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-white">Teleprónpter Inteligente</h1>
          <p className="text-sm text-slate-400">Scroll automático · filtros de video en tiempo real</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="script-input" className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Guion
        </label>
        <textarea
          id="script-input"
          value={script}
          onChange={(event) => onScriptChange(event.target.value)}
          disabled={isActive}
          rows={10}
          placeholder="Pega o escribe aquí el guion..."
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="font-size-input" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Tamaño de fuente</span>
          <span className="text-slate-300">{fontSize}px</span>
        </label>
        <input
          id="font-size-input"
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={1}
          value={fontSize}
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
          className="w-full accent-cyan-500"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <label htmlFor="auto-scroll-speed-input" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Velocidad de scroll</span>
          <span className="text-slate-300">{autoScrollSpeed.toFixed(2)}/{MAX_AUTO_SCROLL_SPEED.toFixed(2)}</span>
        </label>
        <input
          id="auto-scroll-speed-input"
          type="range"
          min={MIN_AUTO_SCROLL_SPEED}
          max={MAX_AUTO_SCROLL_SPEED}
          step={AUTO_SCROLL_SPEED_STEP}
          value={autoScrollSpeed}
          onChange={(event) => onAutoScrollSpeedChange(Number(event.target.value))}
          className="w-full accent-cyan-500"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Filtros de video en tiempo real</span>
        {FILTER_SLIDER_CONFIGS.map((filter) => (
          <div key={filter.key} className="flex flex-col gap-1">
            <label
              htmlFor={`filter-${filter.key}`}
              className="flex items-center justify-between text-xs font-medium text-slate-300"
            >
              <span>{filter.label}</span>
              <span className="text-slate-400">
                {videoFilters[filter.key].toFixed(filter.step < 1 ? 1 : 0)}
                {filter.unit}
              </span>
            </label>
            <input
              id={`filter-${filter.key}`}
              type="range"
              min={filter.min}
              max={filter.max}
              step={filter.step}
              value={videoFilters[filter.key]}
              onChange={(event) => updateFilter(filter.key, Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
            {filter.hint && <p className="text-[11px] text-slate-500">{filter.hint}</p>}
          </div>
        ))}
      </div>
    </aside>
  )
})
