export type LoginPageInput = {
  action: string
  fields: Record<string, string>
  error?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderLoginPage(input: LoginPageInput): string {
  const hidden = Object.entries(input.fields)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    )
    .join('\n')
  const error = input.error
    ? `    <p class="error">${escapeHtml(input.error)}</p>\n`
    : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Orca</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #0f1115; color: #e6e8ee; }
      form { width: min(360px, 90vw); display: grid; gap: 12px; background: #171a21; padding: 28px; border-radius: 10px; }
      h1 { font-size: 18px; margin: 0; }
      label { display: grid; gap: 6px; font-size: 13px; color: #9aa3b2; }
      input[type='email'], input[type='password'] { padding: 9px 10px; border-radius: 6px; border: 1px solid #2b313d; background: #0f1218; color: inherit; font-size: 14px; }
      button { padding: 9px 10px; border-radius: 6px; border: 0; background: #3b6ef5; color: white; font-size: 14px; cursor: pointer; }
      button.cancel { background: transparent; border: 1px solid #2b313d; color: #9aa3b2; }
      .error { color: #ff8a8a; font-size: 13px; margin: 0; }
    </style>
  </head>
  <body>
    <form method="post" action="${escapeHtml(input.action)}">
      <h1>Sign in to Orca</h1>
${error}${hidden}
      <label>Email<input type="email" name="email" autocomplete="username" required /></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required /></label>
      <button type="submit">Continue</button>
      <button type="submit" name="cancel" value="1" class="cancel">Cancel</button>
    </form>
  </body>
</html>
`
}
