import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { homedir } from 'node:os'
import { join } from 'pathe'

async function readClaudeSettings(): Promise<{ settingsPath: string, settings: Record<string, any> }> {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  let settings: Record<string, any> = {}

  if (await fs.pathExists(settingsPath)) {
    settings = await fs.readJson(settingsPath)
  }

  return { settingsPath, settings }
}

async function writeClaudeSettings(settingsPath: string, settings: Record<string, any>): Promise<void> {
  await fs.ensureDir(join(homedir(), '.claude'))
  await fs.writeJson(settingsPath, settings, { spaces: 2 })
}

function parseCodexOverrides(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  const value = raw?.trim()
  if (!value)
    return result

  const parts = value.split(/[;\r\n]+/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed)
      continue
    const index = trimmed.indexOf('=')
    if (index === -1)
      continue
    const key = trimmed.slice(0, index).trim()
    const itemValue = trimmed.slice(index + 1).trim()
    if (key)
      result[key] = itemValue
  }

  return result
}

function buildCodexOverrides(overrides: Record<string, string>): string {
  const orderedKeys = ['model_context_window', 'model_auto_compact_token_limit']
  const entries = orderedKeys
    .map(key => [key, overrides[key]] as const)
    .filter(([, value]) => value && value.trim() !== '')

  return entries.map(([key, value]) => `${key}=${value.trim()}`).join(';')
}

export async function configCodex(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('  Configure Codex args'))
  console.log()

  const { settingsPath, settings } = await readClaudeSettings()
  if (!settings.env)
    settings.env = {}

  const currentModel = settings.env.CODEX_MODEL || ''
  const parsedOverrides = parseCodexOverrides(settings.env.CODEX_CONFIG_OVERRIDES)
  const currentContextWindow = parsedOverrides.model_context_window || ''
  const currentCompactLimit = parsedOverrides.model_auto_compact_token_limit || ''
  const hasExistingConfig = Boolean(currentModel || currentContextWindow || currentCompactLimit)

  if (hasExistingConfig) {
    console.log(ansis.gray('  Current config:'))
    console.log(ansis.gray(`    Model: ${currentModel || 'unset'}`))
    console.log(ansis.gray(`    model_context_window: ${currentContextWindow || 'unset'}`))
    console.log(ansis.gray(`    model_auto_compact_token_limit: ${currentCompactLimit || 'unset'}`))
    console.log(ansis.gray(`    File: ${settingsPath}`))
    console.log()
  }

  let nextModel = currentModel
  let nextContextWindow = currentContextWindow
  let nextCompactLimit = currentCompactLimit
  let changed = false

  if (hasExistingConfig) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Choose action',
      default: 'keep',
      choices: [
        { name: `${ansis.green('✓')} Keep current config and return (Recommended)`, value: 'keep' },
        { name: `${ansis.cyan('➜')} Edit model`, value: 'edit-model' },
        { name: `${ansis.cyan('➜')} Edit window settings`, value: 'edit-overrides' },
        { name: `${ansis.cyan('➜')} Edit model and window settings`, value: 'edit-all' },
        { name: `${ansis.yellow('◌')} Clear model`, value: 'clear-model' },
        { name: `${ansis.yellow('◌')} Clear window settings`, value: 'clear-overrides' },
        { name: `${ansis.red('✕')} Clear all Codex args`, value: 'clear-all' },
      ],
    }])

    if (action === 'keep') {
      console.log(ansis.gray('No changes made'))
      return
    }

    if (action === 'clear-model' || action === 'clear-all') {
      nextModel = ''
      changed = true
    }

    if (action === 'clear-overrides' || action === 'clear-all') {
      nextContextWindow = ''
      nextCompactLimit = ''
      changed = true
    }

    if (action === 'edit-model' || action === 'edit-all') {
      const { model } = await inquirer.prompt([{
        type: 'input',
        name: 'model',
        message: 'Codex model (blank keeps current)',
        default: currentModel,
      }])
      nextModel = model?.trim() || currentModel
      changed = true
    }

    if (action === 'edit-overrides' || action === 'edit-all') {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'contextWindow',
          message: 'model_context_window (blank keeps current)',
          default: currentContextWindow,
        },
        {
          type: 'input',
          name: 'compactLimit',
          message: 'model_auto_compact_token_limit (blank keeps current)',
          default: currentCompactLimit,
        },
      ])
      nextContextWindow = answers.contextWindow?.trim() || currentContextWindow
      nextCompactLimit = answers.compactLimit?.trim() || currentCompactLimit
      changed = true
    }
  }
  else {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'model',
        message: 'Codex model (for example gpt-5.4, blank skips)',
        default: 'gpt-5.4',
      },
      {
        type: 'input',
        name: 'contextWindow',
        message: 'model_context_window (for example 1000000, blank skips)',
        default: '1000000',
      },
      {
        type: 'input',
        name: 'compactLimit',
        message: 'model_auto_compact_token_limit (for example 900000, blank skips)',
        default: '900000',
      },
    ])

    nextModel = answers.model?.trim() || ''
    nextContextWindow = answers.contextWindow?.trim() || ''
    nextCompactLimit = answers.compactLimit?.trim() || ''

    if (!nextModel && !nextContextWindow && !nextCompactLimit) {
      console.log(ansis.gray('No changes made'))
      return
    }
    changed = true
  }

  if (!changed) {
    console.log(ansis.gray('No changes made'))
    return
  }

  const nextOverrides = buildCodexOverrides({
    model_context_window: nextContextWindow,
    model_auto_compact_token_limit: nextCompactLimit,
  })

  if (nextModel)
    settings.env.CODEX_MODEL = nextModel
  else
    delete settings.env.CODEX_MODEL

  if (nextOverrides)
    settings.env.CODEX_CONFIG_OVERRIDES = nextOverrides
  else
    delete settings.env.CODEX_CONFIG_OVERRIDES

  await writeClaudeSettings(settingsPath, settings)

  console.log()
  console.log(ansis.green('✓ Codex args saved'))
  console.log(ansis.gray(`  Model: ${nextModel || 'unset'}`))
  console.log(ansis.gray(`  model_context_window: ${nextContextWindow || 'unset'}`))
  console.log(ansis.gray(`  model_auto_compact_token_limit: ${nextCompactLimit || 'unset'}`))
  console.log(ansis.gray(`  File: ${settingsPath}`))
}
