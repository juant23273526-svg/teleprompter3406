import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PrompterScreen } from './components/PrompterScreen'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import type { ScrollMode } from './types'
import { findBestMatch } from './utils/fuzzyMatch'

const DEFAULT_SCRIPT = `Bienvenidos a este teleprónpter inteligente.
Este texto se desplaza automáticamente mientras hablas.
Todo el reconocimiento de voz ocurre de forma nativa en el navegador.
Puedes pegar tu propio guion en el panel de la izquierda.
Ajusta el tamaño de fuente según tu comodidad de lectura.
Presiona "Iniciar Teleprónpter" y comienza a leer con naturalidad.
El sistema seguirá tu voz y desplazará el texto automáticamente.`

const DEFAULT_AUTO_SCROLL_SPEED = 5
const MIN_AUTO_SCROLL_SPEED = 1
const MAX_AUTO_SCROLL_SPEED = 10
/** Escala fina en píxeles por segundo: nivel 1 = 15px/s, nivel 10 = 120px/s. */
const MIN_AUTO_SCROLL_PX_PER_SEC = 15
const MAX_AUTO_SCROLL_PX_PER_SEC = 120
/** Tras un gesto de scroll manual del usuario, el auto-scroll se pausa esta cantidad de ms antes de reanudar. */
const AUTO_SCROLL_RESUME_DELAY_MS = 1200

/** Convierte el nivel de velocidad (1..10) a px/s mediante interpolación lineal continua. */
function autoScrollSpeedToPixelsPerSecond(speed: number): number {
  const clampedSpeed = Math.min(MAX_AUTO_SCROLL_SPEED, Math.max(MIN_AUTO_SCROLL_SPEED, speed))
  const t = (clampedSpeed - MIN_AUTO_SCROLL_SPEED) / (MAX_AUTO_SCROLL_SPEED - MIN_AUTO_SCROLL_SPEED)
  return MIN_AUTO_SCROLL_PX_PER_SEC + t * (MAX_AUTO_SCROLL_PX_PER_SEC - MIN_AUTO_SCROLL_PX_PER_SEC)
}

export default function App() {
  const [script, setScript] = useState(DEFAULT_SCRIPT)
  const [fontSize, setFontSize] = useState(36)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [lastTranscript, setLastTranscript] = useState('')
  const [scrollMode, setScrollMode] = useState<ScrollMode>('voice')
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(DEFAULT_AUTO_SCROLL_SPEED)
  // Único estado de "encendido" del teleprónpter, válido tanto para el modo
  // voz (micrófono escuchando) como para el modo automático (motor de
  // scroll corriendo). En modo manual no se usa: no hay proceso que iniciar.
  const [isActive, setIsActive] = useState(false)

  const lines = useMemo(() => script.split('\n'), [script])

  // Refs para leer el estado más reciente dentro de callbacks del
  // reconocimiento de voz sin tener que recrear ese listener en cada render.
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex
  const linesRef = useRef(lines)
  linesRef.current = lines

  const handleSpeechResult = useCallback((text: string) => {
    setLastTranscript(text)

    const match = findBestMatch(text, linesRef.current, currentIndexRef.current)
    if (match) {
      setCurrentIndex(match.index)
    }
  }, [])

  const {
    status: speechStatus,
    errorMessage: speechError,
    start: startSpeech,
    stop: stopSpeech,
    reset: resetSpeech,
  } = useSpeechRecognition({ onResult: handleSpeechResult, lang: 'es-MX' })

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const handleStart = useCallback(() => {
    setCurrentIndex(0)
    currentIndexRef.current = 0
    setLastTranscript('')

    if (scrollMode === 'voice') {
      startSpeech()
    }
    setIsActive(true)
  }, [scrollMode, startSpeech])

  const handleStop = useCallback(() => {
    // Frena de inmediato el micrófono (si estaba escuchando) y desactiva el
    // motor de scroll automático; el efecto de abajo cancela cualquier
    // requestAnimationFrame pendiente al ver isActive en false.
    stopSpeech()
    setIsActive(false)
  }, [stopSpeech])

  // Cambiar de modo detiene de forma explícita e inmediata lo que estuviera
  // activo, en vez de depender de un efecto reactivo (esa era la causa del
  // bucle de controles deshabilitados al alternar modos).
  const handleScrollModeChange = useCallback(
    (mode: ScrollMode) => {
      if (isActive) {
        stopSpeech()
        setIsActive(false)
      }
      setScrollMode(mode)
    },
    [isActive, stopSpeech],
  )

  const handleReset = useCallback(() => {
    setCurrentIndex(0)
    currentIndexRef.current = 0
    setLastTranscript('')
    resetSpeech()
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [resetSpeech])

  const handleLineClick = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  // Al desmontar el componente, asegurar que el micrófono quede apagado.
  useEffect(() => {
    return () => {
      stopSpeech()
    }
  }, [stopSpeech])

  // Motor de scroll automático continuo: avanza el contenedor a una
  // velocidad constante (derivada de autoScrollSpeed) mientras el modo sea
  // 'auto' y el teleprónpter esté activo. Un gesto de scroll manual del
  // usuario (rueda/touch) pausa el avance automático brevemente y luego lo
  // reanuda desde la nueva posición.
  const autoScrollSpeedRef = useRef(autoScrollSpeed)
  autoScrollSpeedRef.current = autoScrollSpeed

  useEffect(() => {
    if (scrollMode !== 'auto' || !isActive) return

    const container = scrollContainerRef.current
    if (!container) return

    let animationFrameId: number
    let lastFrameTime: number | null = null
    let lastUserInteractionAt = 0

    const markUserInteraction = () => {
      lastUserInteractionAt = performance.now()
    }

    container.addEventListener('wheel', markUserInteraction, { passive: true })
    container.addEventListener('touchmove', markUserInteraction, { passive: true })
    container.addEventListener('pointerdown', markUserInteraction, { passive: true })

    // dt se calcula con performance.now() (no con frames fijos) para que el
    // avance sea perfectamente fluido sin importar la frecuencia de refresco
    // del monitor (60Hz, 120Hz, etc.) ni pequeños tirones puntuales.
    const step = () => {
      const now = performance.now()
      if (lastFrameTime === null) lastFrameTime = now
      const deltaSeconds = (now - lastFrameTime) / 1000
      lastFrameTime = now

      const isPausedByUser = now - lastUserInteractionAt < AUTO_SCROLL_RESUME_DELAY_MS
      if (!isPausedByUser) {
        const pixelsPerSecond = autoScrollSpeedToPixelsPerSecond(autoScrollSpeedRef.current)
        container.scrollTop += pixelsPerSecond * deltaSeconds
      }

      animationFrameId = requestAnimationFrame(step)
    }

    animationFrameId = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(animationFrameId)
      container.removeEventListener('wheel', markUserInteraction)
      container.removeEventListener('touchmove', markUserInteraction)
      container.removeEventListener('pointerdown', markUserInteraction)
    }
  }, [scrollMode, isActive])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100 md:flex-row">
      <ControlPanel
        script={script}
        onScriptChange={setScript}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        speechStatus={speechStatus}
        speechError={speechError}
        lastTranscript={lastTranscript}
        isActive={isActive}
        onStart={handleStart}
        onStop={handleStop}
        onReset={handleReset}
        scrollMode={scrollMode}
        onScrollModeChange={handleScrollModeChange}
        autoScrollSpeed={autoScrollSpeed}
        onAutoScrollSpeedChange={setAutoScrollSpeed}
      />
      <PrompterScreen
        lines={lines}
        currentIndex={currentIndex}
        fontSize={fontSize}
        onLineClick={handleLineClick}
        scrollMode={scrollMode}
        scrollContainerRef={scrollContainerRef}
      />
    </div>
  )
}
