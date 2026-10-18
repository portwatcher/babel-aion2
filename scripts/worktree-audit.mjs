import { execFileSync } from 'node:child_process'

// Read-only inventory. Managed creation and cleanup use the Codex app tools.
const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
  encoding: 'utf8',
})
const remotes = execFileSync('git', ['remote'], { encoding: 'utf8' }).trim()
console.log(worktrees.trim())
if (!remotes) {
  console.log(
    '\nNo remote configured. Preserve task worktrees until remote integration can be verified.',
  )
}
