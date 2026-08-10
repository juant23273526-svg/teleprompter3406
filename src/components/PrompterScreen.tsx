import { memo, useCallback, useEffect, useRef } from 'react'
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

/** Interlineado usado en los renglones del guion. */
const LINE_HEIGHT_RATIO = 1.5

// Máscara CSS fija (ya no depende de fontSize): 70% central totalmente
// opaco y 15% de desvanecimiento en cada borde. A tamaños de fuente típicos
// esa franja opaca alcanza ~5 líneas de texto, dando margen para leer 2-3
// frases por adelantado antes de que el scroll las desplace.
const READING_WINDOW_MASK = 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)'

/**
 * Memoizado: en modo voz, App.tsx actualiza currentIndex con cada frase
 * reconocida, lo cual sí debe re-renderizar este componente (cambia qué
 * línea se resalta). Pero memo evita que vuelva a renderizar cuando cambian
 * props de estado ajenas a él (autoScrollSpeed, script, estado del
 * grabador, etc.), reduciendo trabajo en el hilo principal mientras la
 * cámara graba en paralelo.
 */
export const PrompterScreen = memo(function PrompterScreen({
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

  return (
    // Llena su propio módulo (la franja/columna "prompter" del grid que arma
    // App.tsx) sin superponerse al <video>: son dos elementos de DOM
    // físicamente separados, no una capa flotando encima de otra, para que
    // Safari/iOS no tenga que componerlos juntos durante grabaciones largas.
    <div
      ref={scrollContainerRef}
      tabIndex={0}
      className="h-full w-full overflow-y-auto bg-transparent outline-none will-change-transform"
      style={{
        WebkitMaskImage: READING_WINDOW_MASK,
        maskImage: READING_WINDOW_MASK,
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
})
