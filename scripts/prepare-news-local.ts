import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { prepareNewsLocalConfig } from '../src/apps/news/nonfunctional/news-local-config'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const envFileArgument = readArgument(args, '--env-file') ?? '.env'
const envPath = resolve(process.cwd(), envFileArgument)

if (!existsSync(envPath)) throw new Error(`本地环境文件不存在：${basename(envPath)}`)
const current = readFileSync(envPath, 'utf8')
if (process.env.NODE_ENV === 'production' || /^NODE_ENV=production$/m.test(current)) {
  throw new Error('news:local:prepare 只允许本地非生产环境')
}

const prepared = prepareNewsLocalConfig(current)
const changed = prepared.evidence.changedKeys.length > 0
if (!checkOnly && changed) writeAtomically(envPath, prepared.content)
if (!checkOnly) chmodSync(envPath, 0o600)

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    mode: checkOnly ? 'CHECK' : 'APPLY',
    envFile: basename(envPath),
    changed,
    ...prepared.evidence,
  })}\n`,
)
if (checkOnly && changed) process.exitCode = 1

function readArgument(input: string[], name: string): string | undefined {
  const index = input.indexOf(name)
  if (index < 0) return undefined
  const value = input[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少文件路径`)
  return value
}

function writeAtomically(target: string, content: string): void {
  const temporary = `${target}.news-prepare-${process.pid}`
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, target)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}
