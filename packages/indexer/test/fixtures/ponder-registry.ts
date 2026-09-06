/**
 * A stand-in for `ponder:registry`, the virtual module the Ponder runtime provides.
 *
 * The poller is registered rather than exported - `ponder.on('Poll:block', handler)` - so there is
 * no way to call it from a test without something to register against. This captures the handler
 * instead of scheduling it, which is what lets the poll be replayed against a doubled chain and a
 * doubled store. `ponder:schema` is already aliased the same way for the outbox tests.
 */
type Handler = (args: { event: unknown; context: unknown }) => Promise<void>

const handlers = new Map<string, Handler>()

export const ponder = {
  on(name: string, handler: Handler) {
    handlers.set(name, handler)
  },
}

/** The handler registered under `name`, or a failure that names what was registered instead. */
export function registeredHandler(name: string): Handler {
  const handler = handlers.get(name)
  if (!handler) throw new Error(`no handler registered for ${name}; have: ${[...handlers.keys()].join(', ') || 'none'}`)
  return handler
}
