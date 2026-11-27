// The error the panel can act on.
//
// The host reads the code off the error, and an error without a known code reaches the panel as
// `action_failed`: the person would see that something went wrong and nothing about what.

/**
 * An error the panel reads: the code it knows, and the words a person reads.
 */
export function requestError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}
