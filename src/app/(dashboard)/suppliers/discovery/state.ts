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
