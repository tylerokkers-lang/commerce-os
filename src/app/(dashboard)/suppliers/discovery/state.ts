export interface CaptureFormState {
  status: 'idle' | 'ok' | 'error'
  message: string
  fieldErrors: Record<string, string>
}

export const initialCaptureState: CaptureFormState = { status: 'idle', message: '', fieldErrors: {} }

export interface QueueActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export const initialQueueActionState: QueueActionState = { status: 'idle', message: '' }

/** Milestone: real supplier connector (Phase 8). */
export interface CjDiscoveryItem {
  productRef: string
  title: string
  sku: string | null
  unitCostMinor: number
  currency: string
  inStock: boolean
}

export interface CjDiscoveryState {
  status: 'idle' | 'ok' | 'error'
  message: string
  items: readonly CjDiscoveryItem[]
}

export const initialCjDiscoveryState: CjDiscoveryState = { status: 'idle', message: '', items: [] }
