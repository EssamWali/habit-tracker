import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type State =
  | { status: 'loading' }
  | { status: 'signedIn'; session: Session }
  | { status: 'signedOut' }

/**
 * Session state, resolved from localStorage first.
 *
 * getSession() reads the persisted session synchronously from storage and does
 * not hit the network, which is what lets an offline cold start land on the
 * signed-in view. A token that cannot be refreshed while offline is still a
 * usable identity here: every read is served from the local store (V0-4), and
 * sync (V0-5) is what needs a live token, not the UI.
 */
export function useSession(): State {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setState(data.session ? { status: 'signedIn', session: data.session } : { status: 'signedOut' })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signedIn', session } : { status: 'signedOut' })
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
