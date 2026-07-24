import {
  evaluateAgentRegression,
  type AgentRegressionSummary,
  type EvaluateAgentRegressionOptions,
} from 'src/apps/agent/observability/evaluation/agent-evaluation-runner'
import { evaluateRetrievalPilot } from 'src/apps/agent/retrieval/retrieval-evaluation'

export { evaluateAgentRegression, type AgentRegressionSummary }

function cliOptions(argv: string[]): EvaluateAgentRegressionOptions {
  return Object.fromEntries(
    argv
      .filter((item) => item.startsWith('--') && item.includes('='))
      .map((item) => item.slice(2).split('=', 2) as [string, string]),
  )
}

if (require.main === module) {
  const options = cliOptions(process.argv.slice(2))
  const summary =
    options.suite === 'retrieval'
      ? evaluateRetrievalPilot(process.cwd(), options.dataset ?? 'retrieval-v1')
      : evaluateAgentRegression(process.cwd(), options)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if ('valid' in summary ? !summary.valid : !summary.pass) process.exitCode = 1
}
