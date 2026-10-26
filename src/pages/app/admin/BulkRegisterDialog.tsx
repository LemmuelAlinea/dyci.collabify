import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Field, PasswordInput } from '../../../components/ui/Field'
import { Modal } from '../../../components/ui/Modal'
import { listAccounts, registerBulkUsers } from '../../../lib/api/accounts'
import { BULK_HEADERS, parseBulkCsv } from '../../../lib/bulkAccounts'
import type { BulkPreviewRow } from '../../../lib/bulkAccounts'
import { downloadCsv, toCsv } from '../../../lib/report'
import {
  BULK_CHUNK_SIZE,
  bulkPasswordError,
} from '../../../../supabase/functions/_shared/bulkAccounts'
import type { BulkResult } from '../../../../supabase/functions/_shared/bulkAccounts'
import { fullName, ROLE_LABEL } from '../../../lib/types'
import type { Account } from '../../../lib/types'

export function BulkRegisterDialog({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: () => Promise<void>
}) {
  const [rows, setRows] = useState<BulkPreviewRow[]>([])
  const [existing, setExisting] = useState<Map<string, Account>>(new Map())
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set())
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'preview' | 'confirm' | 'results'>('preview')
  const [busy, setBusy] = useState(false)
  const [processed, setProcessed] = useState(0)
  const [results, setResults] = useState<BulkResult[]>([])
  const valid = rows.filter((row) => row.user)
  const repeated = valid.filter((row) => existing.has(row.email))
  const creating = valid.filter((row) => !existing.has(row.email))
  const updating = repeated.filter((row) => existing.get(row.email)?.role !== 'admin' && overwrite.has(row.email))
  const selected = [...creating, ...updating].sort((a, b) => a.row - b.row)
  const skipped = rows.length - selected.length

  function close() {
    if (busy) return
    setRows([])
    setExisting(new Map())
    setOverwrite(new Set())
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
    setExisting(new Map())
    setOverwrite(new Set())
    setPassword('')
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
      const accounts = await listAccounts()
      setExisting(new Map(accounts.map((account) => [account.email.toLowerCase(), account])))
      setRows(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the CSV or check existing accounts.')
    }
  }

  async function runImport() {
    setBusy(true)
    setError(null)
    setProcessed(0)
    const outcome: BulkResult[] = rows.filter((row) => !row.user).map((row) => ({
      row: row.row, email: row.email, status: 'skipped', reason: row.error,
    }))
    outcome.push(...repeated.filter((row) => !overwrite.has(row.email) || existing.get(row.email)?.role === 'admin')
      .map((row) => ({ row: row.row, email: row.email, status: 'skipped' as const,
        reason: existing.get(row.email)?.role === 'admin' ? 'Admin accounts cannot be overwritten.' : 'Account already exists.' })))
    for (let i = 0; i < selected.length; i += BULK_CHUNK_SIZE) {
      const chunk = selected.slice(i, i + BULK_CHUNK_SIZE)
      try {
        outcome.push(...await registerBulkUsers(
          chunk.map((row) => ({ ...row.user!, row: row.row, overwrite: overwrite.has(row.email) })), password,
        ))
      } catch {
        outcome.push(...chunk.map((row) => ({
          row: row.row, email: row.email, status: 'failed' as const,
          reason: 'Could not send this group. Upload the CSV again to retry.',
        })))
      }
      setProcessed(Math.min(i + BULK_CHUNK_SIZE, selected.length))
    }
    setPassword('')
    setResults(outcome.sort((a, b) => a.row - b.row))
    setStep('results')
    setBusy(false)
    await onImported()
  }

  const counts = {
    created: results.filter((result) => result.status === 'created').length,
    updated: results.filter((result) => result.status === 'updated').length,
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
                const problem = creating.length ? bulkPasswordError(password) : null
                if (problem) setError(problem)
                else if (selected.length) { setError(null); setStep('confirm') }
              }}
              disabled={!selected.length}
            >
              Review import
            </Button>
          )}
          {step === 'confirm' && (
            <Button onClick={() => void runImport()} loading={busy}>
              Import {creating.length} · update {updating.length}
            </Button>
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
                <p className="font-medium text-ink">{creating.length} new · {updating.length} to update · {skipped} skipped</p>
                {repeated.length > 0 && (
                  <Alert>{repeated.length} already registered: {repeated.map((row) => `${fullName(existing.get(row.email)!) || row.email} (${row.email})`).join(', ')}. Select overwrite beside each eligible account you want to update.</Alert>
                )}
                <div className="max-h-64 overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[620px] text-left text-[12px]">
                    <thead className="surface-sunken text-faint"><tr><th className="p-2">Row</th><th className="p-2">CSV name</th><th className="p-2">Email</th><th className="p-2">Role / issue</th><th className="p-2">Action</th></tr></thead>
                    <tbody>{rows.map((row) => (
                      <tr key={row.row} className="border-t border-line">
                        <td className="p-2">{row.row}</td>
                        <td className="p-2 text-ink">{row.user ? `${row.user.first_name} ${row.user.middle_name ?? ''} ${row.user.last_name}` : '—'}</td>
                        <td className="p-2">{row.email || '—'}</td>
                        <td className="p-2">{row.error ?? (existing.has(row.email)
                          ? existing.get(row.email)?.role === 'admin'
                            ? `Already registered: ${fullName(existing.get(row.email)!) || row.email} · Admin account cannot be overwritten`
                            : `Current: ${fullName(existing.get(row.email)!) || row.email} · ${ROLE_LABEL[existing.get(row.email)!.role!]} → CSV: ${ROLE_LABEL[row.user!.role]}`
                          : row.user?.role)}</td>
                        <td className="p-2">{row.user && existing.has(row.email) && existing.get(row.email)?.role !== 'admin' && (
                          <label className="flex items-center gap-1.5 whitespace-nowrap text-ink">
                            <input type="checkbox" aria-label={`Overwrite ${row.email}`} checked={overwrite.has(row.email)} onChange={(event) => setOverwrite((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(row.email)
                              else next.delete(row.email)
                              return next
                            })} />
                            Overwrite
                          </label>
                        )}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {creating.length > 0 && (
                  <Field label="Temporary password" hint="For new accounts only; at least 12 characters">
                    {(id) => <PasswordInput id={id} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
                  </Field>
                )}
              </>
            )}
          </>
        )}
        {step === 'confirm' && (
          <div className="space-y-3">
            <p><strong className="text-ink">{creating.length} new accounts</strong> will be created. <strong className="text-ink">{updating.length} existing accounts</strong> will have their names and roles updated. {skipped} rows will be skipped.</p>
            {updating.length > 0 && <p>Existing passwords and account status stay as they are: {updating.map((row) => `${fullName(existing.get(row.email)!)} (${row.email})`).join(', ')}.</p>}
            {updating.some((row) => existing.get(row.email)?.role === 'member' && row.user?.role === 'student') && <p>Members changed to students lose both access switches.</p>}
            {creating.length > 0 && <p>Give new users their credentials through your existing channel. They will accept the terms and privacy policy and set a new password on first sign-in.</p>}
            {busy && <p>Processed {processed} of {selected.length} users…</p>}
            {!busy && <Button variant="ghost" size="sm" onClick={() => setStep('preview')}>Back to preview</Button>}
          </div>
        )}
        {step === 'results' && (
          <>
            <p className="font-medium text-ink">{counts.created} created · {counts.updated} updated · {counts.skipped} skipped · {counts.failed} failed</p>
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
