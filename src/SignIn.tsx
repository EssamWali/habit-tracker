import { useState } from 'react'
import { supabase } from './lib/supabase'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setStatus(error ? { kind: 'error', message: error.message } : { kind: 'sent' })
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setStatus({ kind: 'error', message: error.message })
  }

  if (status.kind === 'sent') {
    return (
      <div className="card">
        <h2>Check your email</h2>
        <p className="muted">A sign-in link is on its way to {email}. It opens this app directly.</p>
        <button className="btn btn--quiet" onClick={() => setStatus({ kind: 'idle' })}>
          Use a different address
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Sign in</h2>

      <button className="btn" onClick={signInWithGoogle}>Continue with Google</button>

      <div className="divider"><span>or</span></div>

      <form onSubmit={sendMagicLink}>
        <input
          className="input"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
        />
        <button className="btn btn--quiet" type="submit" disabled={status.kind === 'sending'}>
          {status.kind === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>

      {status.kind === 'error' && <p className="error">{status.message}</p>}
    </div>
  )
}
