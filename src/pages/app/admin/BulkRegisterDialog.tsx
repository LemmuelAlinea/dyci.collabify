import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Field, PasswordInput } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { registerBulkUsers } from '../../../lib/api/accounts'
import { BULK_HEADERS, parseBulkCsv } from '../../../lib/bulkAccounts'
import type { BulkPreviewRow } from '../../../lib/bulkAccounts'
import { downloadCsv, toCsv } from '../../../lib/report'
import {
  BULK_CHUNK_SIZE,
  bulkPasswordError,
} from '../../../../supabase/functions/_shared/bulkAccounts'
import type { BulkResult } from '../../../../supabase/functions/_shared/bulkAccounts'

export function BulkRegisterDialog({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: () => Promise<void>
}) {
  const [rows, setRows] = useState<BulkPreviewRow[]>([])
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'preview' | 'confirm' | 'results'>('preview')
  const [busy, setBusy] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [results, setResults] = useState<BulkResult[]>([])
  const valid = rows.filter((row) => row.user)
  const skipped = rows.length - valid.length

  function close() {
    if (busy) return
    setRows([])
    setPassword('')
    setError(null)
    setStep('preview')
    setProcessed(0)
    setResults([])
    onClose()
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setRows([])
    setResults([])
    setStep('preview')
    setError(null)
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 100_000) {
      setError('Choose a CSV file under 100 KB.')
      return
    }
    try {
      const parsed = parseBulkCsv(await file.text())
      if (!parsed.length) throw new Error('The CSV has no users.')
      setRows(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the CSV.')
    }
  }

  async function runImport() {
    setBusy(true)
    setError(null)
    setProcessed(0)
    const outcome: BulkResult[] = rows.filter((row) => !row.user).map((row) => ({
      row: row.row, email: row.email, status: 'skipped', reason: row.error,
    }))
    for (let i = 0; i < valid.length; i += BULK_CHUNK_SIZE) {
      const chunk = valid.slice(i, i + BULK_CHUNK_SIZE)
      try {
        outcome.push(...await registerBulkUsers(
          chunk.map((row) => ({ ...row.user!, row: row.row })), password,
        ))
      } catch {
        outcome.push(...chunk.map((row) => ({
          row: row.row, email: row.email, status: 'failed' as const,
          reason: 'Could not send this group. Upload the CSV again to retry.',
        })))
      }
      setProcessed(Math.min(i + BULK_CHUNK_SIZE, valid.length))
    }
    setPassword('')
    setResults(outcome.sort((a, b) => a.row - b.row))
    setStep('results')
    setBusy(false)
    await onImported()
  }

  const counts = {
    created: results.filter((result) => result.status === 'created').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bulk register users"
      description="Upload a CSV for student and member accounts. Only @dyci.edu.ph addresses are accepted."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>{step === 'results' ? 'Close' : 'Cancel'}</Button>
          {step === 'preview' && (
            <Button
              onClick={() => {
                const problem = bulkPasswordError(password)
                if (problem) setError(problem)
                else if (valid.length) { setError(null); setStep('confirm') }
              }}
              disabled={!valid.length}
            >
              Review import
            </Button>
          )}
          {step === 'confirm' && (
            <Button onClick={() => void runImport()} loading={busy}>Import {valid.length} users</Button>
          )}
        </>
      }
    >
      <div className="space-y-5 text-[13px] text-muted">
        {error && <Alert tone="error">{error}</Alert>}
        {step === 'preview' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => downloadCsv('collabify-bulk-users.csv', toCsv([...BULK_HEADERS], []))}>
                Download CSV template
              </Button>
              <label className="cursor-pointer rounded-xl border border-line px-4 py-2 font-medium text-ink hover:border-line-strong focus-within:ring-2 focus-within:ring-[var(--ring)]">
                Choose CSV
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void pickFile(event)} />
              </label>
            </div>
            <p>Columns: first_name, middle_name (optional), last_name, email, role. Use student or member for role. At most 100 users.</p>
            {rows.length > 0 && (
              <>
                <p className="font-medium text-ink">{valid.length} ready · {skipped} skipped</p>
                <div className="max-h-64 overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[540px] text-left text-[12px]">
                    <thead className="surface-sunken text-faint"><tr><th className="p-2">Row</th><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Role / issue</th></tr></thead>
                    <tbody>{rows.map((row) => (
                      <tr key={row.row} className="border-t border-line">
                        <td className="p-2">{row.row}</td>
                        <td className="p-2 text-ink">{row.user ? `${row.user.first_name} ${row.user.middle_name ?? ''} ${row.user.last_name}` : '—'}</td>
                        <td className="p-2">{row.email || '—'}</td>
                        <td className="p-2">{row.error ?? row.user?.role}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <Field label="Temporary password" hint="One password for this batch; at least 12 characters">
                  {(id) => <PasswordInput id={id} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
                </Field>
              </>
            )}
          </>
        )}
        {step === 'confirm' && (
          <div className="space-y-3">
            <p><strong className="text-ink">{valid.length} accounts</strong> will be created with the temporary password. {skipped} invalid or repeated rows will be skipped.</p>
            <p>Give users their credentials through your existing channel. They will accept the terms and privacy policy and set a new password on first sign-in.</p>
            {busy && <p>Processed {processed} of {valid.length} users…</p>}
            {!busy && <Button variant="ghost" size="sm" onClick={() => setStep('preview')}>Back to preview</Button>}
          </div>
        )}
        {step === 'results' && (
          <>
            <p className="font-medium text-ink">{counts.created} created · {counts.skipped} skipped · {counts.failed} failed</p>
            <div className="max-h-72 space-y-1 overflow-auto">
              {results.map((result) => (
                <p key={result.row} className="rounded-lg surface-sunken px-3 py-2">
                  Row {result.row} · {result.email || 'No email'} · {result.status}{result.reason ? `: ${result.reason}` : ''}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
