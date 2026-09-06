// Daily reminder sender (V2-6).
//
// Deliberately thin. Every decision about *who* is due lives in SQL, in
// migration 0004, so it is versioned and inspectable with a plain SELECT. This
// function's only job is to turn rows into pushes.
//
// It holds no notion of a Scheduled Day, a cadence or a quota. The client
// writes profiles.last_clear_day using the same R5 that draws the aggregate
// heatmap, and due_reminders() compares dates. That is the whole reason there
// is no second rules engine here to drift from the one in src/lib/rules.ts.
//
// Deploy:   supabase functions deploy daily-reminder
// Schedule: see docs/reminders-setup.md

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

interface DueRow {
  user_id: string
  local_day: string
  endpoint: string
  p256dh: string
  auth: string
}

const required = (name: string): string => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}

Deno.serve(async req => {
  // The scheduler is the only intended caller. Without this the endpoint is a
  // public "notify everyone" button.
  const secret = Deno.env.get('REMINDER_SECRET')
  if (secret && req.headers.get('x-reminder-secret') !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  const supabase = createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )

  webpush.setVapidDetails(
    required('VAPID_SUBJECT'),          // mailto: or https: identifying the sender
    required('VAPID_PUBLIC_KEY'),
    required('VAPID_PRIVATE_KEY'),
  )

  const { data, error } = await supabase.rpc('due_reminders')
  if (error) {
    console.error('due_reminders failed', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as DueRow[]
  const payload = JSON.stringify({
    title: 'Habit Tracker',
    body: 'Still something left for today.',
    url: '/',
  })

  let sent = 0
  let retired = 0
  const failed: string[] = []

  // A user may hold several endpoints (phone and laptop). Each is delivered
  // independently, and one dead endpoint must not cost the others their nudge.
  const delivered = new Set<string>()

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
      )
      sent++
      delivered.add(`${row.user_id}|${row.local_day}`)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode

      // 404/410 mean the browser threw the subscription away — the user cleared
      // site data, or uninstalled. Retiring it stops us retrying forever.
      if (status === 404 || status === 410) {
        await supabase.rpc('retire_subscription', { p_endpoint: row.endpoint })
        retired++
      } else {
        console.error('push failed', status, err)
        failed.push(row.endpoint)
      }
    }
  }

  // Marked only after a send actually succeeded. Marking first would turn a
  // transient push-service outage into a silently skipped day, and a missed
  // nudge is worse here than a duplicate one.
  for (const key of delivered) {
    const [user_id, day] = key.split('|')
    const { error: markError } = await supabase.rpc('mark_reminded', { p_user_id: user_id, p_day: day })
    if (markError) console.error('mark_reminded failed', user_id, markError)
  }

  return Response.json({ due: rows.length, sent, retired, failed: failed.length })
})
