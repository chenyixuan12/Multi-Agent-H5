import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const port = process.env.MCP_PORT || '8124'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '12306-mcp')
const child = spawn(process.execPath, [join(root, 'build', 'index.js'), '--port', port], {
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', (code) => process.exit(code ?? 0))
