/**
 * La Web Speech API (SpeechRecognition) no forma parte de lib.dom.d.ts de
 * TypeScript por ser una API no estandarizada (implementada por navegadores
 * basados en Chromium con el prefijo `webkit`). Estas declaraciones cubren
 * únicamente la superficie que usa `useSpeechRecognition`.
 */
export {}

declare global {
  interface SpeechRecognitionResultItem {
    readonly transcript: string
    readonly confidence: number
  }

  interface SpeechRecognitionResult {
    readonly length: number
    readonly isFinal: boolean
    item(index: number): SpeechRecognitionResultItem
    [index: number]: SpeechRecognitionResultItem
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    item(index: number): SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition extends EventTarget {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    onstart: ((this: SpeechRecognition, event: Event) => void) | null
    onresult: ((this: SpeechRecognition, event: SpeechRecognitionEvent) => void) | null
    onerror: ((this: SpeechRecognition, event: SpeechRecognitionErrorEvent) => void) | null
    onend: ((this: SpeechRecognition, event: Event) => void) | null
    start(): void
    stop(): void
    abort(): void
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}
