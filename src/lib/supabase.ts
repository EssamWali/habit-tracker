import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // The session lives in localStorage so a cold start can restore it without
    // touching the network — V0-3's acceptance criterion.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
