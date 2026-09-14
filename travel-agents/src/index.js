import { createAgentServer } from './agentRuntime.js'

const agentName = process.argv[2] || process.env.AGENT_NAME
const defaultPorts = { requirements: 3401, route: 3402, spots: 3403, budget: 3404, synthesis: 3405, candidates: 3406 }
const port = Number(process.argv[3] || process.env.AGENT_PORT || defaultPorts[agentName])

if (!agentName || !port) {
  console.error('用法：node src/index.js <requirements|route|spots|budget|synthesis|candidates> [port]')
  process.exit(1)
}

process.env.AGENT_NAME = agentName
const server = createAgentServer(agentName, port)
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
