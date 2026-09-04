// Commit and push from a process that is not GitHub Actions.
//
// The collectors that run on GitHub commit with a shell loop in their workflow.
// A process on a machine needs the same thing in code: stage, commit, push, and
// on a rejected push rebase onto whatever landed meanwhile and try again - the
// other collectors push to the same branch on their own schedules.
//
// A rebase can conflict when the remote changed the same file, which is possible
// on the capture file: the watchdog on GitHub patches its own field there. The
// only sound resolution for a file with one owner per field is to take the
// remote version and re-apply what this process knows from memory, so the caller
// passes `rewrite`, a function that writes the file again from its own state.

import { execFileSync } from 'node:child_process'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function git(args, { cwd, log = () => {} } = {}) {
  log(`$ git ${args.join(' ')}`)
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** The branch the working copy is on; a detached checkout is refused rather than guessed. */
export function currentBranch({ cwd } = {}) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  if (branch === 'HEAD') throw new Error('detached HEAD: the watcher needs a branch to push to')
  return branch
}

/**
 * Stages `paths`, commits them as `author`, and pushes, rebasing onto the remote
 * when the push is rejected. Resolves { committed: false } when nothing was staged
 * - a no-op rather than an empty commit - and throws after `attempts` failed pushes.
 */
export async function commitAndPush({
  cwd,
  paths,
  message,
  author,
  branch = currentBranch({ cwd }),
  attempts = 4,
  rewrite,
  log = () => {},
  sleepImpl = sleep,
}) {
  const run = (args) => git(args, { cwd, log })
  const stage = () => run(['add', '--', ...paths])
  const commit = () =>
    run(['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '--quiet', '-m', message])

  stage()
  try {
    run(['diff', '--cached', '--quiet', '--', ...paths])
    return { committed: false }
  } catch {
    // staged changes exist
  }
  commit()

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run(['push', '--quiet', 'origin', `HEAD:${branch}`])
      return { committed: true, sha: run(['rev-parse', '--short', 'HEAD']) }
    } catch (error) {
      log(`# push rejected (${attempt}/${attempts}): ${String(error.message).split('\n')[0]}`)
      await sleepImpl(attempt * 3000)
      run(['fetch', '--quiet', 'origin', branch])
      try {
        run(['rebase', '--quiet', `origin/${branch}`])
      } catch {
        // The same file changed on both sides. Take theirs, write ours again from
        // memory, and commit that on top: nothing this process measured is lost,
        // and nothing the other writer recorded is overwritten blindly.
        run(['rebase', '--abort'])
        run(['reset', '--quiet', '--hard', `origin/${branch}`])
        if (!rewrite) throw new Error('rebase conflict and no rewrite function to resolve it')
        await rewrite()
        stage()
        commit()
      }
    }
  }
  throw new Error(`push still rejected after ${attempts} attempts`)
}
