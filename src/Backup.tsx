import { useRef, useState } from 'react'
import { applyImport, buildExport, ImportError, toCsv } from './lib/backup'

type Status =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; message: string }
  | { state: 'error'; message: string }

/** Hand the browser a file. The object URL is revoked once the click is spent. */
function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const stamp = () => new Date().toISOString().slice(0, 10)

/**
 * Export and import.
 *
 * Export is the escape hatch that makes ADR 0001's lock-in acceptable, so it is
 * offered plainly rather than buried: two buttons, no confirmation, always
 * available. Import is the one that can overwrite, so it reports exactly what it
 * did afterwards.
 */
export default function Backup({ userId }: { userId: string }) {
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  async function exportJson() {
    setStatus({ state: 'working' })
    try {
      const file = await buildExport(userId)
      download(`habit-tracker-${stamp()}.json`, 'application/json', JSON.stringify(file, null, 2))
      const entries = file.day_entries.filter(e => e.deleted_at === null).length
      setStatus({ state: 'done', message: `Exported ${file.habits.length} habits and ${entries} marks.` })
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function exportCsv() {
    setStatus({ state: 'working' })
    try {
      download(`habit-tracker-${stamp()}.csv`, 'text/csv', toCsv(await buildExport(userId)))
      setStatus({ state: 'done', message: 'Exported your marks as CSV.' })
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function importJson(file: File) {
    setStatus({ state: 'working' })
    try {
      const { applied, skipped } = await applyImport(userId, JSON.parse(await file.text()))
      setStatus({
        state: 'done',
        message: applied === 0
          ? `Nothing to restore — all ${skipped} rows were already up to date.`
          : `Restored ${applied} rows. ${skipped} were already up to date.`,
      })
    } catch (err) {
      setStatus({
        state: 'error',
        message: err instanceof ImportError ? err.message
          : err instanceof SyntaxError ? 'That file is not valid JSON.'
          : err instanceof Error ? err.message
          : String(err),
      })
    } finally {
      // Let the same file be chosen twice in a row.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="card">
      <h2>Your data</h2>

      <div className="setting">
        <span className="setting-label">Export</span>
        <div className="row-actions">
          <button className="btn btn--quiet" onClick={exportJson} disabled={status.state === 'working'}>
            Download JSON
          </button>
          <button className="btn btn--quiet" onClick={exportCsv} disabled={status.state === 'working'}>
            Download CSV
          </button>
        </div>
        <p className="muted note">
          The JSON file holds everything — habits, schedules, marks, notes and settings —
          and is what an import reads. The CSV is your marks in a form a spreadsheet
          understands, for reading rather than restoring.
        </p>
      </div>

      <div className="setting">
        <span className="setting-label">Import</span>
        <div className="row-actions">
          <button className="btn btn--quiet" onClick={() => fileInput.current?.click()} disabled={status.state === 'working'}>
            Choose a JSON export
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f) }}
          />
        </div>
        <p className="muted note">
          Restoring merges rather than replaces: anything newer than what is in the
          file is left alone, and importing the same file twice changes nothing.
        </p>
      </div>

      {status.state === 'done' && <p className="muted note">{status.message}</p>}
      {status.state === 'error' && <p className="error note">{status.message}</p>}
    </div>
  )
}
