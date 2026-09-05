import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

interface FakeRow {
  id: string
  org_id: string
  severity: string
  category: string
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  action_url: string | null
  read_at: string | null
  dedupe_key: string | null
}

let rows: FakeRow[] = []
let nextId = 1

function buildServiceStub() {
  return {
    from(table: string) {
      if (table !== 'notifications') throw new Error(`unexpected table "${table}"`)
      return {
        insert(record: Partial<FakeRow>) {
          const dedupeKey = record.dedupe_key ?? null
          if (dedupeKey && rows.some((r) => r.org_id === record.org_id && r.dedupe_key === dedupeKey)) {
            return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
          }
          rows.push({
            id: `n-${nextId++}`,
            org_id: record.org_id!,
            severity: record.severity ?? 'info',
            category: record.category ?? 'general',
            title: record.title ?? '',
            body: record.body ?? null,
            entity_type: record.entity_type ?? null,
            entity_id: record.entity_id ?? null,
            action_url: record.action_url ?? null,
            read_at: null,
            dedupe_key: dedupeKey,
          })
          return Promise.resolve({ error: null })
        },
        update(patch: Partial<FakeRow>) {
          const chain = {
            _orgId: undefined as string | undefined,
            _id: undefined as string | undefined,
            _requireUnread: false,
            eq(column: string, value: string) {
              if (column === 'org_id') chain._orgId = value
              if (column === 'id') chain._id = value
              return chain
            },
            is(column: string) {
              if (column === 'read_at') chain._requireUnread = true
              return Promise.resolve(applyUpdate())
            },
          }
          function applyUpdate() {
            let matched = 0
            for (const r of rows) {
              if (r.org_id !== chain._orgId) continue
              if (chain._id && r.id !== chain._id) continue
              if (chain._requireUnread && r.read_at !== null) continue
              Object.assign(r, patch)
              matched++
            }
            return { error: null, count: matched }
          }
          return chain
        },
      }
    },
  }
}

const createServiceSupabaseMock = vi.fn(() => buildServiceStub())
vi.mock('@/lib/supabase/server', () => ({ createServiceSupabase: () => createServiceSupabaseMock() }))

beforeEach(() => {
  rows = []
  nextId = 1
  vi.clearAllMocks()
  createServiceSupabaseMock.mockImplementation(() => buildServiceStub())
})

describe('createNotification', () => {
  it('creates a real, readable row', async () => {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'warning', category: 'pricing', title: 'Price change rejected', body: 'The connector rejected it.' })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ org_id: 'org-1', severity: 'warning', category: 'pricing', title: 'Price change rejected', read_at: null })
  })

  it('deduplicates via dedupe_key: a second create with the same key is a safe no-op, never a duplicate row', async () => {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'success', category: 'catalogue', title: 'Paused', dedupeKey: 'action:123' })
    await createNotification({ orgId: 'org-1', severity: 'success', category: 'catalogue', title: 'Paused again?', dedupeKey: 'action:123' })

    expect(rows).toHaveLength(1)
  })

  it('the same dedupe_key for a different org is not deduplicated against — dedup is scoped per organisation', async () => {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'info', category: 'general', title: 'x', dedupeKey: 'shared-key' })
    await createNotification({ orgId: 'org-2', severity: 'info', category: 'general', title: 'x', dedupeKey: 'shared-key' })

    expect(rows).toHaveLength(2)
  })

  it('a failure/blocked action notification carries the real entity reference (source/action reference), not just a title', async () => {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'critical', category: 'pricing', title: 'Price update failed', entityType: 'channel_product', entityId: 'cp-1', actionUrl: '/products/cp-1' })

    expect(rows[0]).toMatchObject({ entity_type: 'channel_product', entity_id: 'cp-1', action_url: '/products/cp-1' })
  })

  it('an approval-required notification is distinguishable by its own severity value, never conflated with a plain warning', async () => {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'approval_required', category: 'catalogue', title: 'Approval needed', actionUrl: '/approvals' })

    expect(rows[0].severity).toBe('approval_required')
  })
})

describe('markNotificationRead / markAllNotificationsRead', () => {
  async function seed() {
    const { createNotification } = await import('@/lib/notifications/create')
    await createNotification({ orgId: 'org-1', severity: 'info', category: 'general', title: 'One' })
    await createNotification({ orgId: 'org-1', severity: 'info', category: 'general', title: 'Two' })
    await createNotification({ orgId: 'org-2', severity: 'info', category: 'general', title: 'Other org' })
  }

  it('unread: a freshly created notification starts unread (read_at null)', async () => {
    await seed()
    expect(rows.filter((r) => r.org_id === 'org-1').every((r) => r.read_at === null)).toBe(true)
  })

  it('mark one read: sets read_at on exactly that notification, none other', async () => {
    await seed()
    const { markNotificationRead } = await import('@/lib/notifications/create')
    await markNotificationRead('org-1', rows[0].id)

    expect(rows[0].read_at).not.toBeNull()
    expect(rows[1].read_at).toBeNull()
  })

  it('mark one read is scoped to org — cannot mark another organisation\'s notification read', async () => {
    await seed()
    const { markNotificationRead } = await import('@/lib/notifications/create')
    const otherOrgNotification = rows.find((r) => r.org_id === 'org-2')!
    await markNotificationRead('org-1', otherOrgNotification.id)

    expect(otherOrgNotification.read_at).toBeNull()
  })

  it('mark all read: every unread notification for that org becomes read, other orgs untouched', async () => {
    await seed()
    const { markAllNotificationsRead } = await import('@/lib/notifications/create')
    await markAllNotificationsRead('org-1')

    expect(rows.filter((r) => r.org_id === 'org-1').every((r) => r.read_at !== null)).toBe(true)
    expect(rows.find((r) => r.org_id === 'org-2')!.read_at).toBeNull()
  })

  it('marking an already-read notification again is a safe no-op', async () => {
    await seed()
    const { markNotificationRead } = await import('@/lib/notifications/create')
    await markNotificationRead('org-1', rows[0].id)
    const firstReadAt = rows[0].read_at
    await markNotificationRead('org-1', rows[0].id)

    expect(rows[0].read_at).toBe(firstReadAt)
  })
})
