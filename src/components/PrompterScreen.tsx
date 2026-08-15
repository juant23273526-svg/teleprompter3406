import { memo, useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { scrollElementToCenter, type ScrollAnimationHandle } from '../utils/smoothScroll'

interface PrompterScreenProps {
  lines: string[]
  fontSize: number
  scrollContainerRef: RefObject<HTMLDivElement>
}

/** Interlineado usado en los renglones del guion. */
const LINE_HEIGHT_RATIO = 1.5

// Máscara CSS fija (ya no depende de fontSize): 70% central totalmente
// opaco y 15% de desvanecimiento en cada borde. A tamaños de fuente típicos
// esa franja opaca alcanza ~5 líneas de texto, dando margen para leer 2-3
// frases por adelantado antes de que el scroll las desplace.
const READING_WINDOW_MASK = 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)'

// Sombra negra pronunciada, siempre presente, para que el texto blanco se
// lea con claridad sin importar qué capture la cámara de fondo.
const TEXT_SHADOW_FILTER = 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))'

/**
 * Memoizado: App.tsx re-renderiza seguido mientras graba (isRecording no
 * afecta a este árbol) o al mover sliders de filtro de video; memo evita que
 * este componente vuelva a renderizar por cambios de props ajenas a él,
 * reduciendo trabajo en el hilo principal mientras la cámara graba en paralelo.
 */
export const PrompterScreen = memo(function PrompterScreen({ lines, fontSize, scrollContainerRef }: PrompterScreenProps) {
  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([])
  const activeAnimationRef = useRef<ScrollAnimationHandle | null>(null)

  // Único modo de desplazamiento: Scroll Automático. El motor continuo (en
  // App.tsx) mueve el contenedor directamente; el único gesto propio de este
  // componente es "tocar una línea para saltar ahí", con una animación
  // propia (rAF + easing) en vez de scrollIntoView nativo, cancelando
  // cualquier animación anterior aún en curso para que nunca se pisen entre
  // sí ("saltos" bruscos).
  const handleLineClick = useCallback(
    (index: number) => {
      const container = scrollContainerRef.current
      const line = lineRefs.current[index]
      if (!container || !line) return

      activeAnimationRef.current?.cancel()
      activeAnimationRef.current = scrollElementToCenter(container, line)
    },
    [scrollContainerRef],
  )

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

          return (
            <p
              key={index}
              ref={(el) => {
                lineRefs.current[index] = el
              }}
              onClick={() => handleLineClick(index)}
              className="cursor-pointer rounded-lg px-2 py-1 text-center font-medium text-white opacity-90 transition-opacity duration-300 ease-out hover:opacity-100"
              style={{ fontSize: `${fontSize}px`, lineHeight: LINE_HEIGHT_RATIO, filter: TEXT_SHADOW_FILTER }}
            >
              {line}
            </p>
          )
        })}
      </div>
    </div>
  )
})
