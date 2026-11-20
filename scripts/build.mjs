import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const tempDir = path.join(projectRoot, '.esbuild-tmp')

await mkdir(tempDir, { recursive: true })

const buildEnv = {
  ...process.env,
  TEMP: tempDir,
  TMP: tempDir,
  TMPDIR: tempDir,
}

function runNodeModule(entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: projectRoot,
      env: buildEnv,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(signal ? `Build stopped by ${signal}` : `Build exited with code ${code}`))
    })
  })
}

await runNodeModule(path.join(projectRoot, 'node_modules/typescript/bin/tsc'), ['-b'])
await runNodeModule(path.join(projectRoot, 'node_modules/vite/bin/vite.js'), ['build'])
