const MANIFEST_SHAPE =
  '{"proposals":[{"id":"p1","title":"…","rationale":"…","files":["src/foo.ts"]}]}'

/**
 * The agent never pastes code or JSON into its answer: it writes files and an index. The system
 * text therefore names every path it may touch, because the write gate is what enforces it.
 */
export function buildRefactorPrompt(input: {
  relativePath: string
  sourceRelativePath: string
  scratchRelativeRoot: string
  instruction?: string
}): { system: string; user: string } {
  const { relativePath, sourceRelativePath, scratchRelativeRoot, instruction } = input
  const system = [
    '你是一个重构顾问。你的任务是对一个文件提出重构建议。',
    '',
    `目标文件的当前内容以 \`${sourceRelativePath}\` 为准（用户可能有未保存的修改，那个副本才是权威内容）；磁盘上的版本可能过期。`,
    '',
    `你只能读工作区里的文件，只能写 \`${scratchRelativeRoot}/\` 目录下的文件。`,
    '',
    `每个方案一个子目录：\`${scratchRelativeRoot}/<proposalId>/<相对路径>\`，其中 <相对路径> 与被改动的文件在工作区里的相对路径一致。`,
    '',
    `必须把方案索引写到 \`${scratchRelativeRoot}/manifest.json\`，形状是：`,
    MANIFEST_SHAPE,
    '',
    '`rationale` 说清为什么这么改，不是改了什么。',
    '',
    '最多 5 个方案，每个方案最多 5 个文件；两个方案不能改同一个文件。',
    '',
    '不要在回答里贴文件内容或 JSON，一切通过写文件产出。'
  ].join('\n')
  const user = [
    `目标文件：${relativePath}`,
    `暂存根：${scratchRelativeRoot}`,
    ...(instruction && instruction.length > 0 ? ['用户指令：', instruction] : [])
  ].join('\n')
  return { system, user }
}
