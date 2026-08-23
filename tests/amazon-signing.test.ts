import { describe, expect, it } from 'vitest'
import { signAwsRequestV4, type AwsCredentials, type SigningRequest } from '@/lib/marketplaces/connectors/amazonSigning'

/**
 * These tests check the structural correctness and determinism of the SigV4
 * implementation, not a specific external signature value. This codebase has
 * no internet access to fetch AWS's own published test vectors and confirm a
 * byte-exact match, so claiming "verified against AWS's test suite" would be
 * exactly the kind of unearned certainty this system exists to avoid. What
 * can be verified without a live oracle: the canonical request follows the
 * documented shape, signing is deterministic, and every input that should
 * matter to the signature actually does.
 */

const credentials: AwsCredentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'eu-west-1',
  service: 'execute-api',
}

const FIXED_DATE = new Date('2026-08-23T12:00:00.000Z')

function baseRequest(over: Partial<SigningRequest> = {}): SigningRequest {
  return {
    method: 'GET',
    host: 'sellingpartnerapi-eu.amazon.com',
    path: '/orders/v0/orders',
    queryParams: { MarketplaceIds: 'A1F83G8C2ARO7P' },
    headers: {},
    body: '',
    now: FIXED_DATE,
    ...over,
  }
}

describe('AWS SigV4 signing', () => {
  it('produces a canonical request in the documented shape: method, uri, query, headers, signed headers, payload hash', () => {
    const signed = signAwsRequestV4(baseRequest(), credentials)
    const lines = signed.canonicalRequest.split('\n')
    expect(lines[0]).toBe('GET')
    expect(lines[1]).toBe('/orders/v0/orders')
    expect(lines[2]).toBe('MarketplaceIds=A1F83G8C2ARO7P')
    // A blank line separates the header block from the signed-header list.
    expect(signed.canonicalRequest).toMatch(/\n\nhost;x-amz-date\n/)
  })

  it('hashes an empty body to the well-known SHA-256 of the empty string', () => {
    // This constant is independently verifiable (it is simply SHA-256('')),
    // not something borrowed from AWS-specific documentation.
    const signed = signAwsRequestV4(baseRequest(), credentials)
    expect(signed.canonicalRequest.endsWith(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )).toBe(true)
  })

  it('includes the Authorization header with the expected structure', () => {
    const signed = signAwsRequestV4(baseRequest(), credentials)
    expect(signed.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(signed.headers.Authorization).toMatch(/SignedHeaders=host;x-amz-date/)
    expect(signed.headers.Authorization).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('sets x-amz-date from the injected clock, not the real one', () => {
    const signed = signAwsRequestV4(baseRequest(), credentials)
    expect(signed.headers['x-amz-date']).toBe('20260823T120000Z')
  })

  it('is deterministic: identical input produces an identical signature', () => {
    const a = signAwsRequestV4(baseRequest(), credentials)
    const b = signAwsRequestV4(baseRequest(), credentials)
    expect(a.headers.Authorization).toBe(b.headers.Authorization)
  })

  it('changes the signature when the path changes', () => {
    const a = signAwsRequestV4(baseRequest({ path: '/orders/v0/orders' }), credentials)
    const b = signAwsRequestV4(baseRequest({ path: '/listings/2021-08-01/items' }), credentials)
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('changes the signature when the query parameters change', () => {
    const a = signAwsRequestV4(baseRequest({ queryParams: { MarketplaceIds: 'A1F83G8C2ARO7P' } }), credentials)
    const b = signAwsRequestV4(baseRequest({ queryParams: { MarketplaceIds: 'OTHER' } }), credentials)
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('changes the signature when the body changes', () => {
    const a = signAwsRequestV4(baseRequest({ body: '' }), credentials)
    const b = signAwsRequestV4(baseRequest({ body: '{"a":1}' }), credentials)
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('changes the signature when the date changes', () => {
    const a = signAwsRequestV4(baseRequest({ now: new Date('2026-08-23T12:00:00.000Z') }), credentials)
    const b = signAwsRequestV4(baseRequest({ now: new Date('2026-08-23T13:00:00.000Z') }), credentials)
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('changes the signature when the secret key changes', () => {
    const a = signAwsRequestV4(baseRequest(), credentials)
    const b = signAwsRequestV4(baseRequest(), { ...credentials, secretAccessKey: 'different-secret-key-value' })
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })

  it('sorts query parameters alphabetically in the canonical request', () => {
    const signed = signAwsRequestV4(
      baseRequest({ queryParams: { zeta: '1', alpha: '2' } }),
      credentials,
    )
    const queryLine = signed.canonicalRequest.split('\n')[2]
    expect(queryLine.indexOf('alpha')).toBeLessThan(queryLine.indexOf('zeta'))
  })

  it('lowercases and sorts header names in the signed headers list', () => {
    const signed = signAwsRequestV4(baseRequest({ headers: { 'X-Amz-Access-Token': 'abc' } }), credentials)
    expect(signed.headers.Authorization).toMatch(/SignedHeaders=host;x-amz-access-token;x-amz-date/)
  })
})
