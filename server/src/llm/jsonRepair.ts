/**
 * Lenient JSON helpers for LLM outputs that are *almost* valid.
 * Handles fences, trailing commas, smart quotes, raw control chars,
 * and unescaped " inside string values (common with Chinese prose).
 */

function stripFences(text: string) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

/** Extract the first balanced `{...}` object; tolerates leading/trailing prose. */
export function extractJsonObject(text: string) {
  const stripped = stripFences(text)
  const start = stripped.indexOf('{')
  if (start < 0) return stripped
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < stripped.length; i += 1) {
    const char = stripped[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return stripped.slice(start, i + 1)
    }
  }
  return stripped.slice(start)
}

function looksLikeStringTerminator(json: string, quoteIndex: number) {
  let j = quoteIndex + 1
  while (j < json.length && /\s/.test(json[j]!)) j += 1
  if (j >= json.length) return true
  return ',}]:'.includes(json[j]!)
}

/**
 * Walk the text and escape raw controls / suspicious quotes while inside strings.
 * Does not attempt to invent structure — only makes common LLM slips parseable.
 */
export function sanitizeJsonStrings(json: string) {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < json.length; i += 1) {
    const char = json[i]!

    if (!inString) {
      if (char === '"') inString = true
      out += char
      continue
    }

    if (escaped) {
      out += char
      escaped = false
      continue
    }

    if (char === '\\') {
      out += char
      escaped = true
      continue
    }

    if (char === '"') {
      if (looksLikeStringTerminator(json, i)) {
        inString = false
        out += char
      } else {
        out += '\\"'
      }
      continue
    }

    if (char === '\n') {
      out += '\\n'
      continue
    }
    if (char === '\r') {
      out += '\\r'
      continue
    }
    if (char === '\t') {
      out += '\\t'
      continue
    }
    // Other ASCII controls → space
    if (char.charCodeAt(0) < 0x20) {
      out += ' '
      continue
    }

    out += char
  }

  return out
}

export function softenJsonText(raw: string) {
  let text = extractJsonObject(raw)
  // Normalize curly / fullwidth quotes that models often emit.
  text = text
    .replace(/[\u201C\u201D\uFF02]/g, '"')
    .replace(/[\u2018\u2019\uFF07]/g, "'")
  // Trailing commas before ] or }
  text = text.replace(/,\s*([\]}])/g, '$1')
  text = sanitizeJsonStrings(text)
  // Trailing commas may reappear conceptually after sanitize; strip again.
  text = text.replace(/,\s*([\]}])/g, '$1')
  return text
}

/** Parse LLM JSON with progressive softening. Throws last SyntaxError on failure. */
export function parseJsonLenient(raw: string): unknown {
  const attempts = [
    () => JSON.parse(stripFences(raw)),
    () => JSON.parse(extractJsonObject(raw)),
    () => JSON.parse(softenJsonText(raw)),
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      return attempt()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('JSON parse failed')
}
