'use client'

import { useEffect } from 'react'

/**
 * A copy button on every code block of a rendered document. Added after
 * mount: the blocks come from Markdown rendered on the server, and a page
 * without JavaScript still shows them, just without the button.
 */
export function CodeCopy() {
  useEffect(() => {
    const blocks = [...document.querySelectorAll<HTMLPreElement>('.prose pre')]
    const buttons: HTMLButtonElement[] = []
    for (const pre of blocks) {
      if (pre.querySelector('.copy-btn')) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'copy-btn code-copy'
      button.textContent = 'Copy'
      button.setAttribute('aria-label', `Copy ${pre.getAttribute('aria-label') ?? 'code'}`)
      button.addEventListener('click', async () => {
        const code = pre.querySelector('code')
        try {
          await navigator.clipboard.writeText((code ?? pre).textContent ?? '')
          button.textContent = 'Copied'
        } catch {
          button.textContent = 'Select to copy'
        }
        window.setTimeout(() => (button.textContent = 'Copy'), 1800)
      })
      pre.appendChild(button)
      buttons.push(button)
    }
    return () => buttons.forEach((button) => button.remove())
  }, [])
  return null
}
