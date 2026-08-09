import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import type { ScrollMode } from '../types'
import { scrollElementToCenter, type ScrollAnimationHandle } from '../utils/smoothScroll'

interface PrompterScreenProps {
  lines: string[]
  currentIndex: number
  fontSize: number
  onLineClick: (index: number) => void
  scrollMode: ScrollMode
  scrollContainerRef: RefObject<HTMLDivElement>
}

/** Interlineado usado tanto en los renglones como en el cálculo de la ventana de lectura. */
const LINE_HEIGHT_RATIO = 1.5
const VISIBLE_LINES = 2
/** Zona de desvanecimiento (px) a cada lado de la ventana de 2 líneas antes de llegar a opacidad 0. */
const FADE_MARGIN_PX = 36

export function PrompterScreen({
  lines,
  currentIndex,
  fontSize,
  onLineClick,
  scrollMode,
  scrollContainerRef,
}: PrompterScreenProps) {
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([])
  const activeAnimationRef = useRef<ScrollAnimationHandle | null>(null)

  // Centra el renglón indicado con una animación propia (rAF + easing) en
  // vez de scrollIntoView nativo, cancelando cualquier animación anterior
  // aún en curso para que nunca se pisen entre sí ("saltos" bruscos). Como
  // scrollElementToCenter usa container.clientHeight (no un valor fijo),
  // centra correctamente sin importar si el contenedor mide 50vh o 40vh.
  const scrollLineIntoView = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current
      const line = lineRefs.current[index]
      if (!container || !line) return

      activeAnimationRef.current?.cancel()
      activeAnimationRef.current = scrollElementToCenter(container, line)
    },
    [scrollContainerRef],
  )

  // El centrado automático sobre currentIndex solo aplica en modo voz: en
  // 'auto' el motor de scroll continuo mueve el contenedor directamente, y en
  // 'manual' el usuario controla el scroll nativo sin interferencias.
  useEffect(() => {
    if (scrollMode !== 'voice') return
    scrollLineIntoView(currentIndex)
  }, [currentIndex, scrollMode, scrollLineIntoView])

  useEffect(() => {
    return () => {
      activeAnimationRef.current?.cancel()
    }
  }, [])

  const handleLineClick = (index: number) => {
    onLineClick(index)
    // Saltar directamente al renglón elegido, sin importar el modo activo.
    scrollLineIntoView(index)
  }

  // Máscara CSS que deja opaca solo una franja central de 2 líneas de alto
  // (según el fontSize elegido) y desvanece el resto del contenedor
  // flotante hacia los bordes, para que las frases entren y salgan de forma
  // suave conforme avanza el scroll automático o el de voz.
  const readingWindowMask = useMemo(() => {
    const halfWindow = (fontSize * LINE_HEIGHT_RATIO * VISIBLE_LINES) / 2
    const opaqueStart = `calc(50% - ${halfWindow}px)`
    const opaqueEnd = `calc(50% + ${halfWindow}px)`
    const transparentStart = `calc(50% - ${halfWindow + FADE_MARGIN_PX}px)`
    const transparentEnd = `calc(50% + ${halfWindow + FADE_MARGIN_PX}px)`
    return [
      'linear-gradient(to bottom,',
      'transparent 0%,',
      `transparent ${transparentStart},`,
      `black ${opaqueStart},`,
      `black ${opaqueEnd},`,
      `transparent ${transparentEnd},`,
      'transparent 100%)',
    ].join(' ')
  }, [fontSize])

  return (
    // Overlay del teleprónpter: llena por completo (absolute inset-0, w-full,
    // h-full) el recuadro del <video> de cámara (z-0) dentro del stage que
    // arma App.tsx, con fondo 100% transparente — sin tarjeta, blur ni bg
    // oscuro — para máxima visibilidad de la cámara detrás del texto.
    <div
      ref={scrollContainerRef}
      tabIndex={0}
      className="absolute inset-0 z-10 h-full w-full overflow-y-auto bg-transparent outline-none will-change-transform"
      style={{
        WebkitMaskImage: readingWindowMask,
        maskImage: readingWindowMask,
        // translateZ(0) aísla este contenedor en su propia capa de
        // composición (aceleración por hardware) para que el scroll continuo
        // no compita por el hilo principal con la captura de MediaRecorder
        // en Safari/iOS, evitando el congelamiento de fotogramas de cámara.
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
      }}
    >
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-[50vh] md:px-10">
        {lines.map((line, index) => {
          if (!line.trim()) {
            return <div key={index} aria-hidden className="h-4" />
          }

          const isActive = scrollMode === 'voice' && index === currentIndex
          const isPast = scrollMode === 'voice' && index < currentIndex

          // Sombra negra pronunciada siempre presente (legibilidad del texto
          // blanco sobre cualquier tono que capture la cámara de fondo); el
          // renglón activo suma además el resplandor cian, encadenando un
          // segundo drop-shadow en el mismo filter.
          const textShadowFilter = isActive
            ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.8)) drop-shadow(0 0 18px rgba(34,211,238,0.45))'
            : 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))'

          return (
            <p
              key={index}
              ref={(el) => {
                lineRefs.current[index] = el
              }}
              onClick={() => handleLineClick(index)}
              className={[
                'cursor-pointer rounded-lg px-2 py-1 text-center font-medium text-white transition-all duration-300 ease-out',
                isActive ? 'scale-105 opacity-100' : isPast ? 'opacity-35 hover:opacity-60' : 'opacity-70 hover:opacity-90',
              ].join(' ')}
              style={{ fontSize: `${fontSize}px`, lineHeight: LINE_HEIGHT_RATIO, filter: textShadowFilter }}
            >
              {line}
            </p>
          )
        })}
      </div>
    </div>
  )
}
