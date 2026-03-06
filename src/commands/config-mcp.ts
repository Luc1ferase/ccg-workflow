import type { ClaudeCodeConfig, McpServerConfig } from '../utils/mcp'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { homedir } from 'node:os'
import { join } from 'pathe'
import {
  installAceTool,
  installAceToolRs,
  installContextWeaver,
  installMcpServer,
  uninstallAceTool,
  uninstallContextWeaver,
  uninstallMcpServer,
} from '../utils/installer'
import { getClaudeCodeConfigPath, readClaudeCodeConfig } from '../utils/mcp'

interface AceToolState {
  installed: boolean
  variant: 'ace-tool' | 'ace-tool-rs' | null
  baseUrl?: string
  token?: string
  configPath: string
}

interface ContextWeaverState {
  installed: boolean
  apiKey?: string
  configPath: string
  envPath: string
}

interface AuxiliaryMcpDef {
  id: string
  name: string
  desc: string
  command: string
  args: string[]
  requiresApiKey?: boolean
  apiKeyEnv?: string
}

interface AuxiliaryState {
  installed: boolean
  apiKey?: string
  configPath: string
}

const AUXILIARY_MCPS: AuxiliaryMcpDef[] = [
  { id: 'context7', name: 'Context7', desc: '获取最新库文档', command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] },
  { id: 'Playwright', name: 'Playwright', desc: '浏览器自动化/测试', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  { id: 'mcp-deepwiki', name: 'DeepWiki', desc: '知识库查询', command: 'npx', args: ['-y', 'mcp-deepwiki@latest'] },
  { id: 'exa', name: 'Exa', desc: '搜索引擎（需 API Key）', command: 'npx', args: ['-y', 'exa-mcp-server@latest'], requiresApiKey: true, apiKeyEnv: 'EXA_API_KEY' },
]

function maskSecret(value?: string): string {
  if (!value)
    return '未配置'
  if (value.length <= 12)
    return `${value.slice(0, 4)}...${value.slice(-2)}`
  return `${value.slice(0, 8)}...${value.slice(-4)}`
}

function extractFlagValue(args: string[] | undefined, flag: string): string | undefined {
  if (!args || args.length === 0)
    return undefined

  const directIndex = args.findIndex(arg => arg === flag)
  if (directIndex >= 0 && directIndex + 1 < args.length)
    return args[directIndex + 1]

  const equalsArg = args.find(arg => arg.startsWith(`${flag}=`))
  if (equalsArg)
    return equalsArg.slice(flag.length + 1)

  return undefined
}

async function readContextWeaverEnv(): Promise<Record<string, string>> {
  const envPath = join(homedir(), '.contextweaver', '.env')
  if (!(await fs.pathExists(envPath)))
    return {}

  const content = await fs.readFile(envPath, 'utf-8')
  const env: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#'))
      continue

    const index = line.indexOf('=')
    if (index === -1)
      continue

    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    env[key] = value
  }

  return env
}

async function getClaudeMcpConfig(): Promise<ClaudeCodeConfig> {
  return await readClaudeCodeConfig() || { mcpServers: {} }
}

function getMcpServer(config: ClaudeCodeConfig, id: string): McpServerConfig | undefined {
  return config.mcpServers?.[id]
}

async function getAceToolState(): Promise<AceToolState> {
  const config = await getClaudeMcpConfig()
  const server = getMcpServer(config, 'ace-tool')
  const configPath = getClaudeCodeConfigPath()

  if (!server)
    return { installed: false, variant: null, configPath }

  const args = server.args || []
  const variant = args.includes('ace-tool-rs') ? 'ace-tool-rs' : 'ace-tool'

  return {
    installed: true,
    variant,
    baseUrl: extractFlagValue(args, '--base-url'),
    token: extractFlagValue(args, '--token'),
    configPath,
  }
}

async function getContextWeaverState(): Promise<ContextWeaverState> {
  const config = await getClaudeMcpConfig()
  const env = await readContextWeaverEnv()
  const envPath = join(homedir(), '.contextweaver', '.env')

  return {
    installed: Boolean(getMcpServer(config, 'contextweaver')),
    apiKey: env.EMBEDDINGS_API_KEY || env.RERANK_API_KEY,
    configPath: getClaudeCodeConfigPath(),
    envPath,
  }
}

async function getAuxiliaryState(mcp: AuxiliaryMcpDef): Promise<AuxiliaryState> {
  const config = await getClaudeMcpConfig()
  const server = getMcpServer(config, mcp.id)

  return {
    installed: Boolean(server),
    apiKey: mcp.apiKeyEnv ? server?.env?.[mcp.apiKeyEnv] : undefined,
    configPath: getClaudeCodeConfigPath(),
  }
}

function printSectionTitle(title: string): void {
  console.log()
  console.log(ansis.cyan.bold(`  ${title}`))
  console.log()
}

function printAceToolState(state: AceToolState): void {
  if (!state.installed) {
    console.log(ansis.gray('当前状态：未配置'))
    console.log(ansis.gray(`  配置文件: ${state.configPath}`))
    console.log()
    return
  }

  console.log(ansis.gray('当前配置:'))
  console.log(ansis.gray(`  类型: ${state.variant}`))
  console.log(ansis.gray(`  Base URL: ${state.baseUrl || '官方默认'}`))
  console.log(ansis.gray(`  Token: ${maskSecret(state.token)}`))
  console.log(ansis.gray(`  配置文件: ${state.configPath}`))
  console.log()
}

function printContextWeaverState(state: ContextWeaverState): void {
  if (!state.installed) {
    console.log(ansis.gray('当前状态：未配置'))
    console.log(ansis.gray(`  Claude 配置: ${state.configPath}`))
    console.log(ansis.gray(`  环境文件: ${state.envPath}`))
    console.log()
    return
  }

  console.log(ansis.gray('当前配置:'))
  console.log(ansis.gray(`  SiliconFlow API Key: ${maskSecret(state.apiKey)}`))
  console.log(ansis.gray(`  Claude 配置: ${state.configPath}`))
  console.log(ansis.gray(`  环境文件: ${state.envPath}`))
  console.log()
}

function printAuxiliaryState(mcp: AuxiliaryMcpDef, state: AuxiliaryState): void {
  if (!state.installed) {
    console.log(ansis.gray(`当前状态：${mcp.name} 未配置`))
    console.log(ansis.gray(`  配置文件: ${state.configPath}`))
    console.log()
    return
  }

  console.log(ansis.gray('当前配置:'))
  console.log(ansis.gray(`  工具: ${mcp.name}`))
  if (mcp.requiresApiKey)
    console.log(ansis.gray(`  API Key: ${maskSecret(state.apiKey)}`))
  else
    console.log(ansis.gray('  API Key: 不需要'))
  console.log(ansis.gray(`  配置文件: ${state.configPath}`))
  console.log()
}

async function promptBaseUrl(currentBaseUrl?: string, keepCurrent = false): Promise<string> {
  const hint = keepCurrent ? '(留空保持当前值)' : '(中转服务必填，官方留空)'
  const { baseUrl } = await inquirer.prompt([{
    type: 'input',
    name: 'baseUrl',
    message: `Base URL ${ansis.gray(hint)}`,
    default: currentBaseUrl || '',
  }])

  return baseUrl?.trim() || ''
}

async function promptToken(currentToken?: string, keepCurrent = false): Promise<string> {
  const hint = keepCurrent ? '(留空保持当前值)' : '(必填)'
  const { token } = await inquirer.prompt([{
    type: 'password',
    name: 'token',
    message: `Token ${ansis.gray(hint)}`,
    mask: '*',
    validate: (value: string) => {
      if (keepCurrent)
        return true
      return value.trim() !== '' || '请输入 Token'
    },
  }])

  return token?.trim() || currentToken || ''
}

async function promptApiKey(label: string, currentValue?: string, keepCurrent = false): Promise<string> {
  const hint = keepCurrent ? '(留空保持当前值)' : ''
  const { apiKey } = await inquirer.prompt([{
    type: 'password',
    name: 'apiKey',
    message: `${label} ${ansis.gray(hint)}`,
    mask: '*',
    validate: (value: string) => {
      if (keepCurrent)
        return true
      return value.trim() !== '' || '请输入 API Key'
    },
  }])

  return apiKey?.trim() || currentValue || ''
}

async function installAceToolVariant(tool: 'ace-tool' | 'ace-tool-rs', config: { baseUrl?: string, token: string }): Promise<void> {
  console.log()
  console.log(ansis.yellow(`⏳ 正在配置 ${tool} MCP...`))

  const result = await (tool === 'ace-tool-rs' ? installAceToolRs : installAceTool)({
    baseUrl: config.baseUrl,
    token: config.token,
  })

  console.log()
  if (result.success) {
    console.log(ansis.green(`✓ ${tool} MCP 配置成功`))
    console.log(ansis.gray('  重启 Claude Code CLI 使配置生效'))
  }
  else {
    console.log(ansis.red(`✗ ${tool} MCP 配置失败: ${result.message}`))
  }
}

async function handleAceTool(tool: 'ace-tool' | 'ace-tool-rs'): Promise<void> {
  const state = await getAceToolState()
  printSectionTitle(`配置 ${tool} MCP`)
  printAceToolState(state)

  if (!state.installed) {
    console.log(ansis.cyan(`📖 获取 ${tool} 访问方式：`))
    console.log(`   ${ansis.gray('•')} ${ansis.cyan('官方服务')}: ${ansis.underline('https://augmentcode.com/')}`)
    console.log(`   ${ansis.gray('•')} ${ansis.cyan('中转服务')} ${ansis.yellow('(无需注册)')}: ${ansis.underline('https://linux.do/t/topic/1291730')}`)
    console.log()

    const baseUrl = await promptBaseUrl(undefined, false)
    const token = await promptToken(undefined, false)
    await installAceToolVariant(tool, { baseUrl: baseUrl || undefined, token })
    return
  }

  const sameVariant = state.variant === tool
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: sameVariant ? '选择操作' : `当前已配置 ${state.variant}，选择操作`,
    default: 'keep',
    choices: sameVariant
      ? [
          { name: `${ansis.green('✓')} 保持当前配置并返回 ${ansis.gray('(推荐)')}`, value: 'keep' },
          { name: `${ansis.cyan('➜')} 修改 Base URL`, value: 'edit-url' },
          { name: `${ansis.cyan('➜')} 修改 Token`, value: 'edit-token' },
          { name: `${ansis.cyan('➜')} 同时修改 Base URL 和 Token`, value: 'edit-both' },
          { name: `${ansis.yellow('◌')} 清除 Base URL`, value: 'clear-url' },
          { name: `${ansis.red('✕')} 卸载 ${tool}`, value: 'uninstall' },
        ]
      : [
          { name: `${ansis.green('✓')} 保持当前配置并返回 ${ansis.gray('(推荐)')}`, value: 'keep' },
          { name: `${ansis.cyan('➜')} 切换到 ${tool}（沿用当前 URL / Token）`, value: 'switch-keep' },
          { name: `${ansis.cyan('➜')} 切换到 ${tool} 并修改 Base URL`, value: 'switch-edit-url' },
          { name: `${ansis.cyan('➜')} 切换到 ${tool} 并修改 Token`, value: 'switch-edit-token' },
          { name: `${ansis.cyan('➜')} 切换到 ${tool} 并修改 URL / Token`, value: 'switch-edit-both' },
          { name: `${ansis.red('✕')} 卸载当前 ace-tool 配置`, value: 'uninstall' },
        ],
  }])

  if (action === 'keep') {
    console.log(ansis.gray('未修改配置'))
    return
  }

  if (action === 'uninstall') {
    const result = await uninstallAceTool()
    console.log()
    if (result.success)
      console.log(ansis.green('✓ ace-tool MCP 已卸载'))
    else
      console.log(ansis.red(`✗ 卸载失败: ${result.message}`))
    return
  }

  let baseUrl = state.baseUrl || ''
  let token = state.token || ''

  if (action === 'clear-url') {
    baseUrl = ''
  }
  if (action === 'edit-url' || action === 'switch-edit-url' || action === 'edit-both' || action === 'switch-edit-both') {
    baseUrl = await promptBaseUrl(state.baseUrl, true)
  }
  if (action === 'edit-token' || action === 'switch-edit-token' || action === 'edit-both' || action === 'switch-edit-both') {
    token = await promptToken(state.token, true)
  }

  if (!token) {
    token = await promptToken(undefined, false)
  }

  await installAceToolVariant(tool, { baseUrl: baseUrl || undefined, token })
}

async function handleInstallContextWeaver(): Promise<void> {
  const state = await getContextWeaverState()
  printSectionTitle('配置 ContextWeaver MCP')
  printContextWeaverState(state)

  if (state.installed) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '选择操作',
      default: 'keep',
      choices: [
        { name: `${ansis.green('✓')} 保持当前配置并返回 ${ansis.gray('(推荐)')}`, value: 'keep' },
        { name: `${ansis.cyan('➜')} 修改 SiliconFlow API Key`, value: 'edit-key' },
        { name: `${ansis.red('✕')} 卸载 ContextWeaver`, value: 'uninstall' },
      ],
    }])

    if (action === 'keep') {
      console.log(ansis.gray('未修改配置'))
      return
    }

    if (action === 'uninstall') {
      const result = await uninstallContextWeaver()
      console.log()
      if (result.success)
        console.log(ansis.green('✓ ContextWeaver MCP 已卸载'))
      else
        console.log(ansis.red(`✗ 卸载失败: ${result.message}`))
      return
    }
  }

  console.log(ansis.cyan('📖 获取硅基流动 API Key：'))
  console.log(`   ${ansis.gray('1.')} 访问 ${ansis.underline('https://siliconflow.cn/')} 注册账号`)
  console.log(`   ${ansis.gray('2.')} 进入控制台 → API 密钥 → 创建密钥`)
  console.log(`   ${ansis.gray('3.')} 新用户有免费额度，Embedding + Rerank 完全够用`)
  console.log()

  const apiKey = await promptApiKey('硅基流动 API Key', state.apiKey, state.installed)

  console.log()
  console.log(ansis.yellow('⏳ 正在配置 ContextWeaver MCP...'))

  const result = await installContextWeaver({ siliconflowApiKey: apiKey })

  console.log()
  if (result.success) {
    console.log(ansis.green('✓ ContextWeaver MCP 配置成功'))
    console.log(ansis.gray('  重启 Claude Code CLI 使配置生效'))
  }
  else {
    console.log(ansis.red(`✗ ContextWeaver MCP 配置失败: ${result.message}`))
  }
}

async function handleCodeRetrieval(): Promise<void> {
  const contextWeaverState = await getContextWeaverState()
  const aceToolState = await getAceToolState()

  console.log()

  const { tool } = await inquirer.prompt([{
    type: 'list',
    name: 'tool',
    message: '选择代码检索工具',
    choices: [
      {
        name: `ContextWeaver ${ansis.green('(推荐)')} ${ansis.gray(contextWeaverState.installed ? '- 已配置' : '- 本地混合搜索')}`,
        value: 'contextweaver',
      },
      {
        name: `ace-tool ${ansis.red('(收费)')} ${ansis.gray(aceToolState.installed && aceToolState.variant === 'ace-tool' ? '- 已配置' : '- Node.js')}`,
        value: 'ace-tool',
      },
      {
        name: `ace-tool-rs ${ansis.red('(收费)')} ${ansis.gray(aceToolState.installed && aceToolState.variant === 'ace-tool-rs' ? '- 已配置' : '- Rust')}`,
        value: 'ace-tool-rs',
      },
      new inquirer.Separator(),
      { name: `${ansis.gray('返回')}`, value: 'cancel' },
    ],
  }])

  if (tool === 'cancel')
    return

  if (tool === 'contextweaver')
    await handleInstallContextWeaver()
  else
    await handleAceTool(tool)
}

async function handleAuxiliaryMcp(mcp: AuxiliaryMcpDef): Promise<void> {
  const state = await getAuxiliaryState(mcp)
  printSectionTitle(`配置 ${mcp.name} MCP`)
  printAuxiliaryState(mcp, state)

  if (!state.installed) {
    let env: Record<string, string> = {}

    if (mcp.requiresApiKey) {
      if (mcp.name === 'Exa') {
        console.log(ansis.cyan(`📖 获取 ${mcp.name} API Key：`))
        console.log(`   访问 ${ansis.underline('https://exa.ai/')} 注册获取（有免费额度）`)
        console.log()
      }

      const apiKey = await promptApiKey(`${mcp.name} API Key`, undefined, false)
      env[mcp.apiKeyEnv!] = apiKey
    }

    console.log(ansis.yellow(`⏳ 正在安装 ${mcp.name}...`))
    const result = await installMcpServer(mcp.id, mcp.command, mcp.args, env)

    console.log()
    if (result.success)
      console.log(ansis.green(`✓ ${mcp.name} 安装成功`))
    else
      console.log(ansis.red(`✗ ${mcp.name} 安装失败: ${result.message}`))
    return
  }

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '选择操作',
    default: 'keep',
    choices: mcp.requiresApiKey
      ? [
          { name: `${ansis.green('✓')} 保持当前配置并返回 ${ansis.gray('(推荐)')}`, value: 'keep' },
          { name: `${ansis.cyan('➜')} 修改 API Key`, value: 'edit-key' },
          { name: `${ansis.red('✕')} 卸载 ${mcp.name}`, value: 'uninstall' },
        ]
      : [
          { name: `${ansis.green('✓')} 保持当前配置并返回 ${ansis.gray('(推荐)')}`, value: 'keep' },
          { name: `${ansis.cyan('➜')} 重新安装 ${mcp.name}`, value: 'reinstall' },
          { name: `${ansis.red('✕')} 卸载 ${mcp.name}`, value: 'uninstall' },
        ],
  }])

  if (action === 'keep') {
    console.log(ansis.gray('未修改配置'))
    return
  }

  if (action === 'uninstall') {
    const result = await uninstallMcpServer(mcp.id)
    console.log()
    if (result.success)
      console.log(ansis.green(`✓ ${mcp.name} 已卸载`))
    else
      console.log(ansis.red(`✗ ${mcp.name} 卸载失败: ${result.message}`))
    return
  }

  let env: Record<string, string> = {}
  if (mcp.requiresApiKey) {
    const apiKey = await promptApiKey(`${mcp.name} API Key`, state.apiKey, true)
    env[mcp.apiKeyEnv!] = apiKey
  }

  console.log(ansis.yellow(`⏳ 正在安装 ${mcp.name}...`))
  const result = await installMcpServer(mcp.id, mcp.command, mcp.args, env)

  console.log()
  if (result.success)
    console.log(ansis.green(`✓ ${mcp.name} 安装成功`))
  else
    console.log(ansis.red(`✗ ${mcp.name} 安装失败: ${result.message}`))
}

async function handleAuxiliary(): Promise<void> {
  const states = new Map<string, AuxiliaryState>()
  for (const mcp of AUXILIARY_MCPS)
    states.set(mcp.id, await getAuxiliaryState(mcp))

  console.log()

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: '选择要管理的辅助 MCP 工具',
    choices: [
      ...AUXILIARY_MCPS.map(mcp => ({
        name: `${mcp.name} ${ansis.gray(`- ${mcp.desc}`)} ${states.get(mcp.id)?.installed ? ansis.green('(已配置)') : ''}`,
        value: mcp.id,
      })),
      new inquirer.Separator(),
      { name: `${ansis.gray('返回')}`, value: 'cancel' },
    ],
  }])

  if (selected === 'cancel')
    return

  const mcp = AUXILIARY_MCPS.find(item => item.id === selected)
  if (!mcp)
    return

  await handleAuxiliaryMcp(mcp)
}

async function handleUninstall(): Promise<void> {
  console.log()

  const allMcps = [
    { name: 'ace-tool', value: 'ace-tool' },
    { name: 'ContextWeaver', value: 'contextweaver' },
    ...AUXILIARY_MCPS.map(m => ({ name: m.name, value: m.id })),
  ]

  const { targets } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'targets',
    message: '选择要卸载的 MCP（空格选择，回车确认）',
    choices: allMcps,
  }])

  if (!targets || targets.length === 0) {
    console.log(ansis.gray('未选择任何工具'))
    return
  }

  console.log()

  for (const target of targets) {
    console.log(ansis.yellow(`⏳ 正在卸载 ${target}...`))

    let result
    if (target === 'ace-tool')
      result = await uninstallAceTool()
    else if (target === 'contextweaver')
      result = await uninstallContextWeaver()
    else
      result = await uninstallMcpServer(target)

    if (result.success)
      console.log(ansis.green(`✓ ${target} 已卸载`))
    else
      console.log(ansis.red(`✗ ${target} 卸载失败: ${result.message}`))
  }

  console.log()
}

/**
 * Configure MCP tools after installation
 */
export async function configMcp(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('  配置 MCP 工具'))
  console.log()

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '选择操作',
    choices: [
      { name: `${ansis.green('➜')} 代码检索 MCP ${ansis.gray('(ContextWeaver / ace-tool)')}`, value: 'code-retrieval' },
      { name: `${ansis.blue('➜')} 辅助工具 MCP ${ansis.gray('(context7 / Playwright / exa...)')}`, value: 'auxiliary' },
      { name: `${ansis.red('✕')} 卸载 MCP`, value: 'uninstall' },
      new inquirer.Separator(),
      { name: `${ansis.gray('返回')}`, value: 'cancel' },
    ],
  }])

  if (action === 'cancel')
    return

  if (action === 'code-retrieval')
    await handleCodeRetrieval()
  else if (action === 'auxiliary')
    await handleAuxiliary()
  else if (action === 'uninstall')
    await handleUninstall()
}
