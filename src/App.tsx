import { Menu, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PrompterScreen } from './components/PrompterScreen'
import { VideoPreviewModal } from './components/VideoPreviewModal'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useVideoRecorder } from './hooks/useVideoRecorder'
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
  // Panel de configuración (guion, controles, grabadora): en escritorio
  // siempre visible como sidebar; en iPhone/móvil se puede ocultar con el
  // botón flotante para que la cámara y el texto ocupen el 100% del viewport.
  const [isPanelOpen, setIsPanelOpen] = useState(true)

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

  // Grabadora de video independiente del teleprónpter: su propio ciclo de
  // vida (cámara, MediaRecorder, blob en vista previa) no depende del guion
  // ni del modo de desplazamiento. Vive en App porque el preview de cámara
  // se usa como fondo de pantalla completa detrás del teleprónpter.
  const {
    status: recorderStatus,
    errorMessage: recorderError,
    videoPreviewRef,
    previewBlob,
    previewMimeType,
    start: startRecording,
    stop: stopRecording,
    confirmDownload,
    discardPreview,
  } = useVideoRecorder()
  const isRecording = recorderStatus === 'recording'

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
    // 'touchstart' se registra además de 'touchmove': en iPhone/iOS el dedo
    // puede tocar y mantenerse quieto un instante antes de mover, y sin este
    // listener el auto-scroll seguía avanzando durante ese primer contacto.
    container.addEventListener('touchstart', markUserInteraction, { passive: true })
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
      container.removeEventListener('touchstart', markUserInteraction)
      container.removeEventListener('touchmove', markUserInteraction)
      container.removeEventListener('pointerdown', markUserInteraction)
    }
  }, [scrollMode, isActive])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Fondo de cámara a pantalla completa: solo se monta mientras se está
          grabando. MediaRecorder captura el MediaStream de getUserMedia
          directamente, así que el archivo grabado siempre queda limpio (cámara
          + mic) sin esta capa de teleprónpter, sin importar lo que se vea aquí. */}
      {isRecording && (
        <video
          ref={videoPreviewRef}
          muted
          playsInline
          autoPlay
          className="fixed inset-0 z-0 h-full w-full object-cover"
        />
      )}

      {/* Contenido de la app (panel + teleprónpter): flota por encima del
          fondo de cámara. */}
      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden md:flex-row">
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
          isRecording={isRecording}
          recorderError={recorderError}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          isPanelOpen={isPanelOpen}
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

      {/* Toggle flotante solo en móvil/iPhone: oculta el panel para que la
          cámara y el texto del teleprónpter ocupen el 100% del viewport. */}
      <button
        type="button"
        onClick={() => setIsPanelOpen((open) => !open)}
        aria-label={isPanelOpen ? 'Ocultar panel de configuración' : 'Mostrar panel de configuración'}
        className="fixed right-4 top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 shadow-lg backdrop-blur transition hover:bg-slate-800 md:hidden"
      >
        {isPanelOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {previewBlob && previewMimeType && (
        <VideoPreviewModal blob={previewBlob} mimeType={previewMimeType} onSave={confirmDownload} onDiscard={discardPreview} />
      )}
    </div>
  )
}
