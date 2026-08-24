import { describe, expect, it } from 'vitest'
import { buildAnthropicRequest, COMMERCE_INTELLIGENCE_MODEL, mapAnthropicError, parseAnthropicResponse } from '@/lib/ai/anthropicRequest'

describe('buildAnthropicRequest', () => {
  it('never includes a tools field — the model is structurally never given tool/function-calling access', () => {
    const request = buildAnthropicRequest('system prompt', [{ role: 'user', content: 'hi' }])
    expect(request).not.toHaveProperty('tools')
    expect(JSON.stringify(request)).not.toContain('"tools"')
  })

  it('carries the system prompt and model exactly as supplied', () => {
    const request = buildAnthropicRequest('the rules and facts', [{ role: 'user', content: 'hi' }])
    expect(request.system).toBe('the rules and facts')
    expect(request.model).toBe(COMMERCE_INTELLIGENCE_MODEL)
  })

  it('preserves a normal alternating conversation unchanged', () => {
    const request = buildAnthropicRequest('sys', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ])
    expect(request.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ])
  })

  it('merges consecutive same-role turns rather than sending an invalid non-alternating request', () => {
    const request = buildAnthropicRequest('sys', [
      { role: 'user', content: 'part one' },
      { role: 'user', content: 'part two' },
    ])
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].content).toContain('part one')
    expect(request.messages[0].content).toContain('part two')
  })

  it('produces an empty messages array for an empty conversation without throwing', () => {
    const request = buildAnthropicRequest('sys', [])
    expect(request.messages).toEqual([])
  })
})

describe('parseAnthropicResponse', () => {
  it('extracts and joins text blocks', () => {
    const result = parseAnthropicResponse({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('Hello \nthere.')
  })

  it('ignores non-text content blocks rather than throwing', () => {
    const result = parseAnthropicResponse({ content: [{ type: 'thinking' }, { type: 'text', text: 'the answer' }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('the answer')
  })

  it('reports invalid_response for an empty/missing response rather than fabricating text', () => {
    expect(parseAnthropicResponse(null).ok).toBe(false)
    expect(parseAnthropicResponse(undefined).ok).toBe(false)
    expect(parseAnthropicResponse({ content: [] }).ok).toBe(false)
    const result = parseAnthropicResponse({ content: [{ type: 'text', text: '   ' }] })
    expect(result.ok).toBe(false)
  })
})

describe('mapAnthropicError', () => {
  it('never leaks a credential that happened to appear in an error message', () => {
    const error = new Error('Request failed: Authorization: Bearer sk-ant-secret-key-value')
    const mapped = mapAnthropicError(error)
    expect(mapped.message).not.toContain('sk-ant-secret-key-value')
    expect(mapped.message).toContain('[redacted]')
  })

  it('handles a non-Error throw without crashing', () => {
    const mapped = mapAnthropicError('a plain string throw')
    expect(mapped.kind).toBe('request_failed')
    expect(mapped.message.length).toBeGreaterThan(0)
  })
})
