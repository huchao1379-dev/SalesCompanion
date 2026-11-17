/**
 * One-shot refactor: split App.css by screen and move screens into folders.
 * Run from repo root: node scripts/split-app-css.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')
const appCssPath = path.join(src, 'App.css')
const lines = fs.readFileSync(appCssPath, 'utf8').split(/\r?\n/)

/** Inclusive 1-based line slice. */
function slice(start, end) {
  return lines.slice(start - 1, end).join('\n').replace(/\s+$/, '') + '\n'
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function write(file, content) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, content, 'utf8')
  console.log('wrote', path.relative(root, file), `(${content.split(/\n/).length} lines)`)
}

function rewriteTsxImports(content) {
  return content
    .replace(/from '\.\.\/agents\//g, "from '../../agents/")
    .replace(/from '\.\.\/api\//g, "from '../../api/")
    .replace(/from '\.\.\/components\//g, "from '../../components/")
    .replace(/from '\.\.\/data\//g, "from '../../data/")
    .replace(/from '\.\.\/speech\//g, "from '../../speech/")
    .replace(/from '\.\.\/theme\//g, "from '../../theme/")
    .replace(/from '\.\.\/app\//g, "from '../../app/")
}

function addCssImport(file, cssRel) {
  let c = fs.readFileSync(file, 'utf8')
  if (c.includes(`import '${cssRel}'`) || c.includes(`import "./${cssRel.replace('./', '')}"`)) return
  if (c.includes(`import './${cssRel.replace('./', '')}'`)) return
  const importBlock = c.match(/^(?:import .+\n)+/)
  if (importBlock) {
    c = c.replace(importBlock[0], `${importBlock[0]}import '${cssRel}'\n`)
  } else {
    c = `import '${cssRel}'\n${c}`
  }
  write(file, c)
}

const screens = [
  'HomeDashboard',
  'ActivityCapture',
  'ActivityDetails',
  'BriefMe',
  'CopilotChat',
  'OpportunityDetail',
  'OpportunityDraft',
  'TasksHub',
  'AccountInsight',
]

// ── Move screen TSX into folders ───────────────────────────────────────────
for (const name of screens) {
  const from = path.join(src, 'screens', `${name}.tsx`)
  const dir = path.join(src, 'screens', name)
  const to = path.join(dir, `${name}.tsx`)
  if (!fs.existsSync(from)) {
    if (fs.existsSync(to)) {
      console.log('already moved', name)
      continue
    }
    throw new Error(`Missing screen: ${from}`)
  }
  ensureDir(dir)
  let content = fs.readFileSync(from, 'utf8')
  content = rewriteTsxImports(content)
  if (!content.includes(`import './${name}.css'`)) {
    const importBlock = content.match(/^(?:import .+\n)+/)
    if (importBlock) {
      content = content.replace(importBlock[0], `${importBlock[0]}import './${name}.css'\n`)
    } else {
      content = `import './${name}.css'\n${content}`
    }
  }
  write(to, content)
  fs.unlinkSync(from)
}

// Capture/opp shared chrome (combined selectors) — both screens import it
const captureOppChrome = slice(1786, 2501) // stop before visually-hidden

// ── Page / component CSS ───────────────────────────────────────────────────
write(
  path.join(src, 'screens', 'HomeDashboard', 'HomeDashboard.css'),
  `/* HomeDashboard */\n` + slice(210, 835),
)

write(
  path.join(src, 'screens', 'ActivityDetails', 'ActivityDetails.css'),
  `/* ActivityDetails */\n` + slice(866, 882) + slice(1162, 1534),
)

write(path.join(src, 'components', 'LocationSheet.css'), `/* LocationSheet */\n` + slice(883, 1161))

write(path.join(src, 'screens', 'BriefMe', 'BriefMe.css'), `/* BriefMe */\n` + slice(1535, 1785))

write(
  path.join(src, 'styles', 'capture-opp-chrome.css'),
  `/* Shared chrome for ActivityCapture + OpportunityDraft */\n` + captureOppChrome,
)

write(
  path.join(src, 'screens', 'ActivityCapture', 'ActivityCapture.css'),
  `/* ActivityCapture page overrides (chrome in styles/capture-opp-chrome.css) */\n`,
)

write(
  path.join(src, 'screens', 'OpportunityDraft', 'OpportunityDraft.css'),
  `/* OpportunityDraft */\n` + slice(2503, 3060),
)

write(
  path.join(src, 'screens', 'OpportunityDetail', 'OpportunityDetail.css'),
  `/* OpportunityDetail */\n` + slice(3061, 3907),
)

// Shared screens block: buttons, draft-card, mic, tasks, chips, etc.
write(path.join(src, 'styles', 'shared-ui.css'), `/* Shared UI */\n` + slice(2491, 2501) + slice(3908, 4545))

write(path.join(src, 'screens', 'CopilotChat', 'CopilotChat.css'), `/* CopilotChat */\n` + slice(4546, 4858))

write(path.join(src, 'screens', 'TasksHub', 'TasksHub.css'), `/* TasksHub — layout uses shared-ui task-* rules */\n`)

write(
  path.join(src, 'screens', 'AccountInsight', 'AccountInsight.css'),
  `/* AccountInsight */\n` + slice(5253, lines.length),
)

// Narrow + dark overrides stay with shell/shared so specificity order is preserved
const responsiveAndDark = slice(4989, 5252)

const appCssKeep =
  slice(1, 209) +
  `\n` +
  slice(838, 864) +
  `\n` +
  slice(4859, 4988) +
  `\n` +
  responsiveAndDark

write(appCssPath, appCssKeep)

// Screen CSS imports for shared chrome
for (const name of ['ActivityCapture', 'OpportunityDraft']) {
  const file = path.join(src, 'screens', name, `${name}.tsx`)
  let c = fs.readFileSync(file, 'utf8')
  if (!c.includes("capture-opp-chrome.css")) {
    c = c.replace(`import './${name}.css'\n`, `import '../../styles/capture-opp-chrome.css'\nimport './${name}.css'\n`)
    write(file, c)
  }
}

// Component CSS imports
addCssImport(path.join(src, 'components', 'LocationSheet.tsx'), './LocationSheet.css')

// App.tsx
{
  const appTsx = path.join(src, 'App.tsx')
  let c = fs.readFileSync(appTsx, 'utf8')
  if (!c.includes("import './styles/shared-ui.css'")) {
    c = c.replace("import './App.css'", "import './App.css'\nimport './styles/shared-ui.css'")
    write(appTsx, c)
  }
}

// AppShell screen import paths
{
  const shell = path.join(src, 'app', 'AppShell.tsx')
  let c = fs.readFileSync(shell, 'utf8')
  for (const name of screens) {
    c = c.replace(`from '../screens/${name}'`, `from '../screens/${name}/${name}'`)
  }
  write(shell, c)
}

console.log('\nDone.')
console.log('App.css lines:', fs.readFileSync(appCssPath, 'utf8').split(/\n/).length)
