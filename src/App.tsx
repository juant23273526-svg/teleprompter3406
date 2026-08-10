import { Menu, Pause, Play, Square, Video, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CameraView } from './components/CameraView'
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

/** Velocidad media del rango: ritmo de lectura conversacional normal. */
const DEFAULT_AUTO_SCROLL_SPEED = 2.5
const MIN_AUTO_SCROLL_SPEED = 0.2
const MAX_AUTO_SCROLL_SPEED = 5
/** Escala en píxeles por segundo en los extremos del rango (ver reshapeSensitivityCurve para el tramo medio). */
const MIN_AUTO_SCROLL_PX_PER_SEC = 8
const MAX_AUTO_SCROLL_PX_PER_SEC = 140
/** Tras un gesto de scroll manual del usuario, el auto-scroll se pausa esta cantidad de ms antes de reanudar. */
const AUTO_SCROLL_RESUME_DELAY_MS = 1200

/**
 * Curva de sensibilidad no lineal en 3 tramos sobre t∈[0,1] (posición
 * normalizada del slider). El 70% central del recorrido del control
 * (t entre 0.15 y 0.85, que en el slider real cae en la franja de velocidad
 * "conversacional") se comprime a solo el 30% del rango de salida en
 * px/s: cada paso de 0.1 del slider ahí mueve la velocidad real muy poco,
 * permitiendo micro-ajustes finos. En los extremos (muy lento / muy rápido,
 * donde la precisión importa menos) la curva es más empinada, así se
 * alcanzan rápido con menos recorrido del slider.
 */
function reshapeSensitivityCurve(t: number): number {
  if (t <= 0.15) return (t / 0.15) * 0.35
  if (t >= 0.85) return 0.65 + ((t - 0.85) / 0.15) * 0.35
  return 0.35 + ((t - 0.15) / 0.7) * 0.3
}

/** Convierte el nivel de velocidad (0.2..5, paso 0.1) a px/s vía la curva de sensibilidad no lineal. */
function autoScrollSpeedToPixelsPerSecond(speed: number): number {
  const clampedSpeed = Math.min(MAX_AUTO_SCROLL_SPEED, Math.max(MIN_AUTO_SCROLL_SPEED, speed))
  const t = (clampedSpeed - MIN_AUTO_SCROLL_SPEED) / (MAX_AUTO_SCROLL_SPEED - MIN_AUTO_SCROLL_SPEED)
  const shapedT = reshapeSensitivityCurve(t)
  return MIN_AUTO_SCROLL_PX_PER_SEC + shapedT * (MAX_AUTO_SCROLL_PX_PER_SEC - MIN_AUTO_SCROLL_PX_PER_SEC)
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
  // Drawer de ajustes (guion, velocidad, tamaño de letra): flotante, activado
  // por el botón de hamburguesa; nunca ocupa espacio fijo en el layout.
  const [isMenuOpen, setIsMenuOpen] = useState(false)

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
  // ni del modo de desplazamiento. Vive en App porque el <video> de cámara
  // en vivo y el modal de vista previa se renderizan a este nivel.
  const {
    status: recorderStatus,
    errorMessage: recorderError,
    videoPreviewRef,
    canvasRef: captureCanvasRef,
    previewBlob,
    previewMimeType,
    canShareFiles,
    start: startRecording,
    stop: stopRecording,
    shareVideo,
    confirmDownload,
    discardPreview,
  } = useVideoRecorder()
  const isRecording = recorderStatus === 'recording'

  // Al iniciar a grabar o al arrancar el teleprónpter, cierra el drawer de
  // ajustes automáticamente para dejar la pantalla 100% limpia (teleprónpter
  // + cámara a la vista), sin importar si se disparó desde el botón de la
  // barra de acciones o desde el propio botón dentro del drawer.
  useEffect(() => {
    if (isRecording) {
      setIsMenuOpen(false)
    }
  }, [isRecording])

  useEffect(() => {
    if (isActive) {
      setIsMenuOpen(false)
    }
  }, [isActive])

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
  // Acumulador decimal de posición: container.scrollTop redondea a entero al
  // leerlo de vuelta del DOM, así que incrementar con `container.scrollTop +=`
  // pierde la parte fraccionaria en cada frame y ese error se va acumulando
  // (tirones perceptibles en velocidades bajas). Sumando el delta sobre este
  // ref en JS puro y solo escribiendo el resultado a scrollTop, el avance
  // queda perfectamente fluido sin importar la velocidad configurada.
  const scrollAccumulatorRef = useRef(0)

  useEffect(() => {
    if (scrollMode !== 'auto' || !isActive) return

    const container = scrollContainerRef.current
    if (!container) return

    scrollAccumulatorRef.current = container.scrollTop

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
      if (isPausedByUser) {
        // Mientras el usuario interviene manualmente, mantiene el acumulador
        // sincronizado con la posición real para que el auto-scroll reanude
        // exactamente desde ahí, sin saltar a donde se había quedado antes.
        scrollAccumulatorRef.current = container.scrollTop
      } else {
        const pixelsPerSecond = autoScrollSpeedToPixelsPerSecond(autoScrollSpeedRef.current)
        scrollAccumulatorRef.current += pixelsPerSecond * deltaSeconds
        container.scrollTop = scrollAccumulatorRef.current
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

  // En modo manual no hay ningún proceso que iniciar/pausar: el usuario
  // controla el scroll directamente con la rueda o el teclado (misma regla
  // que usa ControlPanel para su propio botón de inicio).
  const canToggleActive = scrollMode === 'voice' || scrollMode === 'auto'

  return (
    // .app-grid (index.css): 3 franjas apiladas en vertical (prompter 35vh /
    // camera 55vh / actions 10vh) y 2 columnas en horizontal (prompter+actions
    // a la izquierda, camera a todo el alto a la derecha). El teleprónpter y
    // el <video> son módulos de DOM separados a propósito (nunca uno encima
    // del otro) para que Safari/iOS no tenga que componerlos en la misma capa
    // durante grabaciones largas.
    <div className="app-grid overflow-hidden bg-slate-950 text-slate-100">
      <div className="app-grid-prompter overflow-hidden rounded-b-2xl bg-slate-900">
        <PrompterScreen
          lines={lines}
          currentIndex={currentIndex}
          fontSize={fontSize}
          onLineClick={handleLineClick}
          scrollMode={scrollMode}
          scrollContainerRef={scrollContainerRef}
        />
      </div>

      {/* Módulo de cámara: contiene únicamente la vista previa limpia de la
          cámara, sin el texto del teleprónpter superpuesto. El <video> queda
          montado siempre (nunca condicionado a isRecording), así el
          MediaStream de getUserMedia nunca se degrada a solo audio por
          perder su elemento de destino. Este <video> es también la fuente
          que useVideoRecorder.ts redibuja frame a frame sobre un <canvas>
          oculto (nunca montado en el DOM) para alimentar al MediaRecorder
          vía canvas.captureStream() — ver el comentario en ese hook para el
          porqué de ese desacople. Vive en su propio componente memoizado
          (CameraView) para que los re-renders de App disparados por el
          reconocimiento de voz (currentIndex/lastTranscript cambian con
          cada frase) no lo toquen mientras graba. */}
      <CameraView videoPreviewRef={videoPreviewRef} canvasRef={captureCanvasRef} isRecording={isRecording} />

      {/* Módulo de acciones: los dos controles principales al alcance del
          pulgar, siempre a la vista sin importar si el drawer de ajustes
          está abierto o no. */}
      <div className="app-grid-actions flex flex-col items-center justify-center gap-1.5 px-4">
        {recorderError && <p className="text-center text-[11px] text-red-400">{recorderError}</p>}
        <div className="flex w-full max-w-md items-center justify-center gap-3">
          <button
            type="button"
            onClick={isActive ? handleStop : handleStart}
            disabled={!isActive && (!script.trim() || !canToggleActive)}
            title={canToggleActive ? undefined : 'El modo manual no requiere iniciar nada: usa la rueda o el teclado'}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40',
              isActive ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
            ].join(' ')}
          >
            {isActive ? (
              <>
                <Pause className="h-4 w-4" />
                Pausar Teleprónpter
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Iniciar Teleprónpter
              </>
            )}
          </button>

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={[
              'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg transition',
              isRecording ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-slate-100 text-slate-950 hover:bg-white',
            ].join(' ')}
          >
            {isRecording ? (
              <>
                <Square className="h-4 w-4" />
                Detener Grabación
              </>
            ) : (
              <>
                <Video className="h-4 w-4" />
                Iniciar Grabación
              </>
            )}
          </button>
        </div>
      </div>

      {/* Menú de hamburguesa flotante: siempre por encima de todo (z-50).
          top usa env(safe-area-inset-top) para bajar el botón por debajo del
          notch/Dynamic Island y la barra de estado en iPhone; sin esto, en
          algunos modelos el botón quedaba parcialmente tapado o pegado al
          borde superior, fuera del área táctil segura. El drawer de ajustes
          (z-40) que despliega es un overlay, nunca ocupa espacio fijo en el
          grid de arriba. */}
      <button
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        aria-label={isMenuOpen ? 'Cerrar menú de ajustes' : 'Abrir menú de ajustes'}
        className="fixed right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] z-50 flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 shadow-lg backdrop-blur transition hover:bg-slate-800"
      >
        {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/50"
          onClick={() => setIsMenuOpen(false)}
        >
          <div className="h-full w-full max-w-sm shadow-2xl" onClick={(event) => event.stopPropagation()}>
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
          </div>
        </div>
      )}

      {previewBlob && previewMimeType && (
        <VideoPreviewModal
          blob={previewBlob}
          mimeType={previewMimeType}
          canShare={canShareFiles}
          onShare={() => {
            void shareVideo()
          }}
          onDownload={confirmDownload}
          onDiscard={discardPreview}
        />
      )}
    </div>
  )
}
