import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')
const sharedPath = path.join(src, 'styles', 'shared-ui.css')
let remaining = fs.readFileSync(sharedPath, 'utf8')

function readBlock(css, start) {
  let i = start
  while (i < css.length && css[i] !== '{') i++
  let depth = 0
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return { text: css.slice(start, i + 1), end: i + 1 }
    }
  }
  return { text: css.slice(start), end: css.length }
}

function readRule(css, start) {
  let i = start
  while (i < css.length && css[i] !== '{') i++
  if (i >= css.length) return null
  const selector = css.slice(start, i).trim()
  let depth = 0
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return { selector, text: css.slice(start, i + 1), end: i + 1 }
    }
  }
  return null
}

function extractByClassPrefixes(css, prefixes) {
  const kept = []
  const rest = []
  let i = 0
  while (i < css.length) {
    if (/\s/.test(css[i])) {
      i++
      continue
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      rest.push(css.slice(i, end < 0 ? css.length : end + 2))
      i = end < 0 ? css.length : end + 2
      continue
    }
    if (css[i] === '@') {
      const block = readBlock(css, i)
      const match = prefixes.some((p) => block.text.includes('.' + p) || block.text.includes(p))
      ;(match ? kept : rest).push(block.text)
      i = block.end
      continue
    }
    const rule = readRule(css, i)
    if (!rule) break
    const hit = prefixes.some((p) => {
      if (p === 'btn') return /(^|[,\s])\.btn(-[a-z]+)?(\s|,|:|\)|$)/.test(rule.selector)
      if (p === 'screen') return /(^|[,\s])\.screen(\s|,|>|:|$)/.test(rule.selector)
      return rule.selector.includes('.' + p)
    })
    ;(hit ? kept : rest).push(rule.text)
    i = rule.end
  }
  const join = (arr) => arr.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  return { kept: join(kept), rest: join(rest) }
}

const chunks = [
  {
    file: path.join(src, 'components', 'DraftCard.css'),
    prefixes: ['draft-card', 'confidence'],
    header: '/* DraftCard */\n',
  },
  {
    file: path.join(src, 'components', 'MicButton.css'),
    prefixes: ['mic-button'],
    header: '/* MicButton */\n',
  },
  {
    file: path.join(src, 'components', 'AgentLabel.css'),
    prefixes: ['agent-label'],
    header: '/* AgentLabel */\n',
  },
  {
    file: path.join(src, 'components', 'SyncStatusBadge.css'),
    prefixes: ['sync-badge'],
    header: '/* SyncStatusBadge */\n',
  },
  {
    file: path.join(src, 'components', 'SourceChips.css'),
    prefixes: ['source-chip', 'source-chips', 'metric-chip'],
    header: '/* SourceChips */\n',
  },
  {
    file: path.join(src, 'screens', 'TasksHub', 'TasksHub.css'),
    prefixes: ['task-', 'tasks__', 'screen'],
    header: '/* TasksHub */\n',
  },
]

for (const c of chunks) {
  const { kept, rest } = extractByClassPrefixes(remaining, c.prefixes)
  fs.writeFileSync(c.file, c.header + kept)
  remaining = rest
  console.log(path.relative(root, c.file), kept.split('\n').length, 'lines')
}

fs.writeFileSync(sharedPath, '/* Shared UI primitives */\n' + remaining)
console.log('shared-ui remaining', remaining.split('\n').length, 'lines')

// ActivityCapture.css gets chrome content
const chromePath = path.join(src, 'styles', 'capture-opp-chrome.css')
const chrome = fs.readFileSync(chromePath, 'utf8')
fs.writeFileSync(
  path.join(src, 'screens', 'ActivityCapture', 'ActivityCapture.css'),
  chrome.replace(
    '/* Shared chrome for ActivityCapture + OpportunityDraft */',
    '/* ActivityCapture (+ shared opp list chrome) */',
  ),
)

let cap = fs.readFileSync(path.join(src, 'screens', 'ActivityCapture', 'ActivityCapture.tsx'), 'utf8')
cap = cap.replace("import '../../styles/capture-opp-chrome.css'\n", '')
fs.writeFileSync(path.join(src, 'screens', 'ActivityCapture', 'ActivityCapture.tsx'), cap)

function addImport(file, rel) {
  let c = fs.readFileSync(file, 'utf8')
  if (c.includes(`import '${rel}'`)) return
  fs.writeFileSync(file, `import '${rel}'\n` + c)
  console.log('import', path.relative(root, file), rel)
}

addImport(path.join(src, 'components', 'DraftCard.tsx'), './DraftCard.css')
addImport(path.join(src, 'components', 'MicButton.tsx'), './MicButton.css')
addImport(path.join(src, 'components', 'AgentLabel.tsx'), './AgentLabel.css')
addImport(path.join(src, 'components', 'SyncStatusBadge.tsx'), './SyncStatusBadge.css')
addImport(path.join(src, 'components', 'SourceChips.tsx'), './SourceChips.css')

console.log('done')
