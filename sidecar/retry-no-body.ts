function isTransient(message = '') {
  return (
    /\(no body\)/i.test(message) ||
    /no body\s*$/i.test(message) ||
    /empty\s+response\s+body/i.test(message) ||
    /stream_read_error/i.test(message) ||
    /unexpected EOF/i.test(message) ||
    /GOAWAY/i.test(message) ||
    /模型服务暂时不可用/.test(message)
  )
}

export function createRetryExtension() {
  return {
    name: 'pi-desktop-retry-no-body',
    factory: (pi: { on: (event: string, handler: (payload: { message?: { errorMessage?: string } }) => void) => void }) => {
      pi.on('message_end', (event) => {
        const error = event.message?.errorMessage
        if (!error || !isTransient(error)) return
        event.message.errorMessage = `${error} (connection error)`
      })
    }
  }
}
