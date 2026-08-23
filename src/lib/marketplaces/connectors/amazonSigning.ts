import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, implemented from the published algorithm.
 *
 * The Amazon Selling Partner API is called over plain HTTPS but still
 * requires every request to be signed as if it were a direct AWS API call,
 * because SP-API sits behind AWS API Gateway with IAM authorization. There is
 * no supported way around this: it is part of the documented SP-API request
 * signing requirement, not an implementation choice.
 *
 * Kept as pure, dependency-free functions (no AWS SDK) so the canonical
 * request construction — the part that is easy to get subtly wrong — can be
 * unit tested against fixed inputs without any network access or real
 * credentials, which is exactly what `tests/amazon-signing.test.ts` does.
 */

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
}

export interface SigningRequest {
  method: string
  host: string
  path: string
  queryParams: Readonly<Record<string, string>>
  headers: Readonly<Record<string, string>>
  body: string
  /** Injected for testability; defaults to the real clock. */
  now?: Date
}

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest()

function amzDateParts(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

function canonicalQueryString(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

function canonicalHeaders(headers: Readonly<Record<string, string>>): {
  canonical: string
  signedHeaderNames: string
} {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))

  const canonical = entries.map(([key, value]) => `${key}:${value}\n`).join('')
  const signedHeaderNames = entries.map(([key]) => key).join(';')
  return { canonical, signedHeaderNames }
}

/** Derives the SigV4 signing key for one date, region and service. */
function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

export interface SignedRequest {
  headers: Record<string, string>
  canonicalRequest: string
  stringToSign: string
}

/**
 * Produces the headers SP-API requires, including `Authorization` and
 * `x-amz-date`. Follows the four documented steps exactly: build the
 * canonical request, build the string to sign, derive the signing key, sign.
 */
export function signAwsRequestV4(request: SigningRequest, credentials: AwsCredentials): SignedRequest {
  const { amzDate, dateStamp } = amzDateParts(request.now ?? new Date())
  const headersWithDate = { ...request.headers, host: request.host, 'x-amz-date': amzDate }

  const { canonical: canonicalHeadersBlock, signedHeaderNames } = canonicalHeaders(headersWithDate)
  const payloadHash = hash(request.body)

  const canonicalRequest = [
    request.method.toUpperCase(),
    request.path,
    canonicalQueryString(request.queryParams),
    canonicalHeadersBlock,
    signedHeaderNames,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n')

  const key = signingKey(credentials.secretAccessKey, dateStamp, credentials.region, credentials.service)
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaderNames}, Signature=${signature}`

  return {
    headers: { ...headersWithDate, Authorization: authorization },
    canonicalRequest,
    stringToSign,
  }
}
