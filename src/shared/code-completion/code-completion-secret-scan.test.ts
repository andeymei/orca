import { describe, expect, it } from 'vitest'
import {
  findCodeCompletionSecret,
  findCodeCompletionSecretAround
} from './code-completion-secret-scan'

describe('the code completion secret scan', () => {
  it('finds a private key', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----'

    expect(findCodeCompletionSecret(text)).toBe('private key')
  })

  it('finds an AWS access key', () => {
    expect(findCodeCompletionSecret('const id = "AKIAIOSFODNN7EXAMPLE"')).toBe('AWS access key')
  })

  it('finds an API key', () => {
    expect(findCodeCompletionSecret('const key = "sk-ant-api03-abcdefghijklmnop"')).toBe(
      'API key (sk-)'
    )
  })

  it('finds a JSON web token', () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'

    expect(findCodeCompletionSecret(`const token = '${token}'`)).toBe('JSON web token')
  })

  it('finds a password in an address', () => {
    expect(findCodeCompletionSecret('const url = "postgres://admin:hunter2@db.local"')).toBe(
      'password in a URL'
    )
  })

  it('finds a secret assigned a long value', () => {
    expect(findCodeCompletionSecret('const apiKey = "9f8b7c6d5e4f3a2b1c0d"')).toBe(
      'secret assigned in code'
    )
  })

  it('leaves a placeholder alone', () => {
    expect(findCodeCompletionSecret('const apiKey = "your-api-key-here"')).toBeNull()
    expect(findCodeCompletionSecret('const password = "changeme"')).toBeNull()
  })

  it('leaves ordinary code alone', () => {
    const code = 'export function add(a: number, b: number): number {\n  return a + b\n}'

    expect(findCodeCompletionSecret(code)).toBeNull()
  })

  it('finds a secret the cursor sits inside', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

    expect(findCodeCompletionSecretAround(token.slice(0, 10), token.slice(10))).toBe('GitHub token')
  })

  it('finds a secret the cursor cuts in two', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

    expect(findCodeCompletionSecretAround(token.slice(0, 20), token.slice(20))).toBe('GitHub token')
  })
})
