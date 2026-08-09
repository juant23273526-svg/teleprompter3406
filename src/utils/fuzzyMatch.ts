/**
 * Motor de alineación por similitud de palabras clave (fuzzy matching).
 *
 * Compara el fragmento transcrito por la Web Speech API contra las líneas del guion
 * usando la distancia de Levenshtein a nivel de palabra, lo que tolera
 * errores de reconocimiento de voz (plurales, acentos, palabras a medias)
 * sin exigir una coincidencia exacta de cadenas.
 */

export interface MatchResult {
  index: number
  score: number
}

const DEFAULT_THRESHOLD = 0.35
/**
 * La búsqueda es estrictamente hacia adelante: nunca vuelve a una línea
 * anterior a currentIndex (evita el "brinco" hacia atrás cuando una palabra
 * del fragmento coincide, por casualidad, con algo ya leído).
 */
const LOOK_AHEAD = 2
/** Por debajo de esta similitud, dos palabras no se consideran la "misma" palabra clave. */
const WORD_MATCH_THRESHOLD = 0.75
/** Fragmentos más cortos que esto son demasiado ambiguos para mover la posición con confianza. */
const MIN_TRANSCRIPT_WORDS = 3

/** Distancia de Levenshtein entre dos cadenas cortas (palabras), con una sola fila de DP. */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j

  for (let i = 1; i <= m; i++) {
    let prevDiagonal = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prevDiagonal : 1 + Math.min(prevDiagonal, dp[j], dp[j - 1])
      prevDiagonal = temp
    }
  }

  return dp[n]
}

function wordSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/** Códigos Unicode de las marcas diacríticas combinantes (acentos, tildes, diéresis). */
const COMBINING_MARK_START = 0x0300
const COMBINING_MARK_END = 0x036f

function stripDiacritics(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= COMBINING_MARK_START && code <= COMBINING_MARK_END) continue
    result += char
  }
  return result
}

function normalize(text: string): string {
  return stripDiacritics(text.toLowerCase().normalize('NFD'))
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
}

function toWords(text: string): string[] {
  const normalized = normalize(text)
  return normalized ? normalized.split(/\s+/) : []
}

/**
 * Calcula qué proporción de las palabras clave del fragmento transcrito
 * aparece (de forma difusa) en la línea del guion. Devuelve un valor 0..1.
 */
export function similarity(transcript: string, line: string): number {
  const transcriptWords = toWords(transcript)
  const lineWords = toWords(line)

  if (transcriptWords.length === 0 || lineWords.length === 0) return 0

  let matched = 0
  for (const tWord of transcriptWords) {
    let bestScore = 0
    for (const lWord of lineWords) {
      const score = wordSimilarity(tWord, lWord)
      if (score > bestScore) bestScore = score
      if (bestScore === 1) break
    }
    if (bestScore >= WORD_MATCH_THRESHOLD) matched++
  }

  return matched / transcriptWords.length
}

/**
 * Busca la línea del guion que mejor coincide con el fragmento transcrito,
 * limitando la búsqueda a una ventana estrictamente hacia adelante desde el
 * índice actual (currentIndex .. currentIndex + 2). El resultado nunca es
 * menor que currentIndex, y fragmentos de menos de 3 palabras se ignoran por
 * ser demasiado ambiguos para mover la posición con confianza.
 */
export function findBestMatch(
  transcript: string,
  lines: string[],
  currentIndex: number,
  threshold = DEFAULT_THRESHOLD,
): MatchResult | null {
  if (!transcript.trim() || lines.length === 0) return null
  if (toWords(transcript).length < MIN_TRANSCRIPT_WORDS) return null

  const from = Math.max(0, currentIndex)
  const to = Math.min(lines.length - 1, currentIndex + LOOK_AHEAD)

  let best: MatchResult | null = null

  for (let index = from; index <= to; index++) {
    const line = lines[index]
    if (!line || !line.trim()) continue

    const score = similarity(transcript, line)
    if (!best || score > best.score) {
      best = { index, score }
    }
  }

  if (best && best.score >= threshold) return best
  return null
}
