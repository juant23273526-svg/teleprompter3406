import { AlertTriangle, Circle, Mic, MicOff, Play, RotateCcw, Square } from 'lucide-react'
import { memo } from 'react'
import type { ComponentType } from 'react'
import type { SpeechRecognitionStatus } from '../hooks/useSpeechRecognition'
import type { ScrollMode } from '../types'

interface ControlPanelProps {
  script: string
  onScriptChange: (value: string) => void
  fontSize: number
  onFontSizeChange: (value: number) => void
  speechStatus: SpeechRecognitionStatus
  speechError: string | null
  lastTranscript: string
  isActive: boolean
  onStart: () => void
  onStop: () => void
  onReset: () => void
  scrollMode: ScrollMode
  onScrollModeChange: (mode: ScrollMode) => void
  autoScrollSpeed: number
  onAutoScrollSpeedChange: (speed: number) => void
}

const SPEECH_STATUS_CONFIG: Record<
  SpeechRecognitionStatus,
  { label: string; className: string; Icon: ComponentType<{ className?: string }> }
> = {
  idle: { label: 'En espera', className: 'text-slate-400', Icon: Circle },
  listening: { label: 'Escuchando', className: 'text-emerald-400', Icon: Mic },
  error: { label: 'Error', className: 'text-red-400', Icon: AlertTriangle },
  unsupported: { label: 'No compatible con este navegador', className: 'text-amber-400', Icon: AlertTriangle },
}

const SCROLL_MODE_OPTIONS: Array<{ value: ScrollMode; emoji: string; label: string; description: string }> = [
  { value: 'voice', emoji: '🎙️', label: 'Voz', description: 'IA Activada' },
  { value: 'auto', emoji: '⏱️', label: 'Automático', description: 'Velocidad Constante' },
  { value: 'manual', emoji: '🖱️', label: 'Manual', description: 'Rueda/Teclas' },
]

const MIN_FONT_SIZE = 20
const MAX_FONT_SIZE = 64
const MIN_AUTO_SCROLL_SPEED = 1
const MAX_AUTO_SCROLL_SPEED = 10

/**
 * Memoizado: App.tsx re-renderiza seguido mientras el teleprónpter está
 * activo en modo voz (currentIndex cambia con cada frase reconocida), pero
 * ninguno de esos cambios afecta las props de este panel. Sin memo, cada uno
 * de esos renders recorría también este árbol entero por nada mientras la
 * cámara graba en paralelo.
 */
export const ControlPanel = memo(function ControlPanel({
  script,
  onScriptChange,
  fontSize,
  onFontSizeChange,
  speechStatus,
  speechError,
  lastTranscript,
  isActive,
  onStart,
  onStop,
  onReset,
  scrollMode,
  onScrollModeChange,
  autoScrollSpeed,
  onAutoScrollSpeedChange,
}: ControlPanelProps) {
  const status = SPEECH_STATUS_CONFIG[speechStatus]
  const StatusIcon = status.Icon
  const isVoiceMode = scrollMode === 'voice'
  // En modo manual no hay ningún proceso que iniciar/detener: el usuario
  // controla el scroll directamente con la rueda o el teclado.
  const canToggleActive = scrollMode === 'voice' || scrollMode === 'auto'

  return (
    // Contenido del drawer de ajustes: App.tsx es quien lo posiciona flotando
    // (fixed) y lo muestra/oculta con el menú de hamburguesa; este panel solo
    // necesita llenar ese contenedor con su propio scroll.
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-slate-900 p-5">
      <div>
        <h1 className="text-lg font-semibold text-white">Teleprónpter Inteligente</h1>
        <p className="text-sm text-slate-400">Reconocimiento de voz nativo del navegador</p>
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

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Modo de desplazamiento</span>
        <div role="radiogroup" aria-label="Modo de desplazamiento" className="grid grid-cols-1 gap-2">
          {SCROLL_MODE_OPTIONS.map((option) => {
            const isSelected = scrollMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onScrollModeChange(option.value)}
                className={[
                  'flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition',
                  isSelected
                    ? 'border-cyan-500 bg-cyan-500/10 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600',
                ].join(' ')}
              >
                <span className="text-lg leading-none">{option.emoji}</span>
                <span className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-slate-400">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        {scrollMode === 'auto' && (
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
            <label htmlFor="auto-scroll-speed-input" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
              <span>Velocidad de scroll</span>
              <span className="text-slate-300">{autoScrollSpeed}/10</span>
            </label>
            <input
              id="auto-scroll-speed-input"
              type="range"
              min={MIN_AUTO_SCROLL_SPEED}
              max={MAX_AUTO_SCROLL_SPEED}
              step={1}
              value={autoScrollSpeed}
              onChange={(event) => onAutoScrollSpeedChange(Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
        )}
      </div>

      <div className={`rounded-lg border border-slate-700 bg-slate-950 p-3 transition-opacity ${isVoiceMode ? '' : 'opacity-50'}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusIcon className={`h-4 w-4 ${status.className}`} />
          <span className={status.className}>Reconocimiento de voz: {status.label}</span>
        </div>
        {speechError && <p className="mt-2 text-xs text-red-400">{speechError}</p>}
        {!isVoiceMode && <p className="mt-2 text-xs text-slate-500">Cambia a modo Voz para usar el micrófono.</p>}
      </div>

      <div className={`rounded-lg border border-slate-700 bg-slate-950 p-3 transition-opacity ${isVoiceMode ? '' : 'opacity-50'}`}>
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          {speechStatus === 'listening' ? <Mic className="h-3.5 w-3.5 text-cyan-400" /> : <MicOff className="h-3.5 w-3.5" />}
          Último fragmento escuchado
        </div>
        <p className="min-h-[2.5rem] text-sm text-slate-200">
          {lastTranscript || 'Aún no se ha escuchado audio.'}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        {!isActive ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!script.trim() || !canToggleActive}
            title={canToggleActive ? undefined : 'El modo manual no requiere iniciar nada: usa la rueda o el teclado'}
            className="flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-4 w-4" />
            Iniciar Teleprónpter
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400"
          >
            <Square className="h-4 w-4" />
            Detener
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
        >
          <RotateCcw className="h-4 w-4" />
          Reiniciar posición
        </button>
      </div>
    </aside>
  )
})
