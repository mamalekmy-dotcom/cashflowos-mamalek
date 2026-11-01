'use client'
import { useState, useTransition } from 'react'
import { uploadColmo } from '@/app/actions'

type Result = { ok: boolean; message: string }

export default function UploadSales() {
  const [result, setResult] = useState<Result | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="admin-card">
      <p className="rowlabel">Upload Colmo sales</p>
      <p className="cap" style={{ margin: '0 0 10px' }}>
        X Reading Report Excel files. Pick several to load past months. Uploading a month again replaces it.
      </p>
      <input
        type="file"
        accept=".xlsx"
        multiple
        aria-label="Colmo Excel files"
        onChange={e => {
          const form = new FormData()
          for (const file of Array.from(e.target.files ?? [])) form.append('files', file)
          start(async () => setResult(await uploadColmo(form)))
          e.target.value = ''
        }}
      />
      {pending ? <p className="cap" style={{ margin: '10px 0 0' }}>Reading…</p> : null}
      {result ? <p className={result.ok ? 'cap' : 'login-error'} style={{ margin: '10px 0 0' }}>{result.message}</p> : null}
    </div>
  )
}
