# Oracle Planner — Handover Document

**Prepared for:** Saaliha Paruk (Engineer, Exergy Designs)
**Date:** 15 April 2026
**Prepared by:** Shuaib Badat

---

## 1. What is Oracle Planner?

Oracle Planner is an internal tool that automatically pulls meeting data from Fireflies.ai, extracts action items for each team member, and provides an AI assistant (Claude) that knows your project context.

**Why it exists:** Exergy Designs runs 10+ projects with 10+ team members across South Africa and Romania. Meetings happen daily. Without this tool, action items get lost in transcripts and nobody knows what they're supposed to be doing next.

**What it does:**
- Shows each person **only their meetings** (filtered by email)
- Extracts **action items assigned to them** from Fireflies transcripts
- Generates **AI daily plans** prioritized by urgency
- Provides an **AI chat** that knows about all projects and meetings

---

## 2. How to Use It

### Login
1. Open the app URL in your browser
2. You'll see a grid of team members — **click your name**
3. Your browser is now locked to your profile (tied to a device fingerprint)
4. Next time you open it, you'll be logged in automatically

### Dashboard
- **Your Meetings** — meetings where your email appears as participant or organizer
- **Your Tasks** — action items extracted from those meetings, assigned to you by name
- **Sync info** — shows when data was last pulled from Fireflies
- Click **"Sync Meetings"** to manually pull the latest meetings
- Click **"Refresh"** to reload your dashboard data

### To-Do List
- Shows all your outstanding action items
- **Click an item** to mark it done (saves to database)
- Badges show urgency:
  - **OVERDUE** (red) — from meetings more than 3 days ago
  - **TODAY** (yellow) — from today or yesterday
  - **THIS WEEK** (blue) — from the last few days

### Daily Plan
- Click **"Generate Plan"** — AI reads your meetings + tasks and produces a prioritized schedule
- Takes ~10 seconds to generate
- Includes time blocks, priority ordering, and delegated items to monitor
- Saved to the database for reference

### AI Assistant
- Chat with Claude about any project
- It knows your meeting history, action items, and team context
- Example prompts:
  - *"What did we decide about the Sensify API in the last meeting?"*
  - *"Summarize this week's action items for me"*
  - *"What's overdue?"*
  - *"Help me plan my day"*

---

## 3. Technical Architecture

```
Browser (index.html)
    ↓ fetch('/api/...')
Netlify Functions (9 serverless endpoints)
    ↓ Supabase SDK
PostgreSQL (Supabase — project: Oracle Tracker)
    ↑ scheduled sync
Fireflies.ai (GraphQL API)
    ↑ captures meetings
Google Meet / Zoom
```

### Components
| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Single HTML file, vanilla JS | Team picker, dashboard, to-do, plan, chat |
| Backend | Netlify Functions (Node.js) | 9 API endpoints under `/api/*` |
| Database | Supabase PostgreSQL | Meetings, action items, chat history, plans |
| AI | Anthropic Claude Sonnet 4.6 | Plan generation + chat |
| Meetings | Fireflies.ai GraphQL API | Auto-syncs daily at 08:00 SAST |

### Database Tables (all prefixed `op_`)
| Table | Rows | Purpose |
|-------|------|---------|
| `op_meetings` | 323+ | Synced from Fireflies — title, date, participants, summary, action items |
| `op_action_items` | 2565+ | Extracted tasks — person, email, task, completed status |
| `op_chat_sessions` | growing | Saved chat conversations per user |
| `op_plans` | growing | Generated daily plans per user |
| `op_sync_meta` | 2 | Last sync timestamps |
| `device_registrations` | per device | Device lock records |

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth-check` | POST | Check if device is registered |
| `/api/auth-register` | POST | Lock device to a user |
| `/api/auth-request-change` | POST | Request profile switch |
| `/api/auth-team` | GET | Get team roster |
| `/api/load-dashboard` | POST | Fetch meetings + action items for user |
| `/api/generate-plan` | POST | Generate AI daily plan |
| `/api/chat` | POST | AI chat (streaming) |
| `/api/sync-fireflies` | POST | Sync meetings from Fireflies |
| `/api/toggle-action-item` | POST | Mark task done/undone |

---

## 4. Admin Tasks

### Add a New Team Member
1. Edit `netlify/functions/auth-team.js`
2. Add their entry to the TEAM array:
   ```js
   { name: "Full Name", email: "their@email.com", role: "Engineer" },
   ```
3. Also add them to `TEAM_MAP` in `netlify/functions/sync-fireflies.js`:
   ```js
   firstname: "their@email.com",
   ```
4. Push to git → Netlify auto-deploys

### Approve a Device Change Request
Someone clicked "Request Profile Change" and needs to switch. Run this in **Supabase SQL Editor** (project: Oracle Tracker):

```sql
-- See pending requests
SELECT machine_id, user_name, user_email, change_reason, registered_at
FROM device_registrations
WHERE change_requested = true;

-- Approve: delete the registration so they can re-register
DELETE FROM device_registrations WHERE machine_id = '<paste machine_id here>';
```

### Check Who Is Registered
```sql
SELECT user_name, user_email, hostname, registered_at, locked, change_requested
FROM device_registrations
ORDER BY registered_at DESC;
```

### Force Sync Meetings
Either wait for the daily 08:00 SAST auto-sync, or trigger manually:
```
POST https://<your-netlify-site>.netlify.app/api/sync-fireflies
Body: {"daysBack": 30}
```

### Check Sync Status
```sql
SELECT * FROM op_sync_meta;
```

### View Anyone's Tasks
```sql
-- Your tasks
SELECT task, meeting_title, meeting_date, completed
FROM op_action_items
WHERE person ILIKE '%Saaliha%' AND completed = false
ORDER BY meeting_date DESC;

-- All unfinished tasks across team
SELECT person, COUNT(*) as tasks
FROM op_action_items
WHERE completed = false
GROUP BY person
ORDER BY tasks DESC;
```

### Check Total Meeting & Action Item Counts
```sql
SELECT COUNT(*) as meetings FROM op_meetings;
SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE completed = false) as open FROM op_action_items;
```

---

## 5. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| No team members on login | `auth-team.js` not deployed | Check Netlify deployment status |
| No meetings showing | Fireflies hasn't synced | Click "Sync Meetings" or check `FIREFLIES_API_KEY` in Netlify env vars |
| AI chat not working | API key issue | Check `ANTHROPIC_API_KEY` in Netlify env vars. Check Netlify function logs |
| Device locked to wrong person | Already registered | Run the DELETE query above in Supabase, then refresh the page |
| Action items missing | Fireflies mislabeled the speaker | The system matches by first name — if Fireflies wrote "Shahla" instead of "Saaliha", those items go to nobody. Fix manually in `op_action_items` |
| "Sync Meetings" takes long | Fetching many days | Normal for first sync. Subsequent syncs are incremental (only new meetings) |
| Plan generation fails | Claude API error | Check Netlify function logs. Usually a rate limit — wait and retry |

---

## 6. Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — UI, CSS, JS in one file |
| `netlify.toml` | Routing config + scheduled sync schedule |
| `netlify/functions/_lib/supabase.js` | Shared Supabase client |
| `netlify/functions/auth-*.js` | Device lock authentication (4 files) |
| `netlify/functions/load-dashboard.js` | Dashboard data loading |
| `netlify/functions/generate-plan.js` | Claude AI plan generation |
| `netlify/functions/chat.js` | Claude AI streaming chat |
| `netlify/functions/sync-fireflies.js` | Fireflies meeting sync (scheduled + manual) |
| `netlify/functions/toggle-action-item.js` | Mark tasks done/undone |
| `migrate-to-supabase.js` | One-time data migration script (already run) |

---

## 7. Environment Variables (Netlify)

These are set in **Netlify > Site Settings > Environment Variables** (never in the code):

| Variable | What it is |
|----------|-----------|
| `SUPABASE_URL` | Oracle Tracker Supabase URL |
| `SUPABASE_ANON_KEY` | Supabase public key |
| `ANTHROPIC_API_KEY` | Claude AI key for chat + plans |
| `FIREFLIES_API_KEY` | Fireflies.ai API key for meeting sync |

---

*Questions? Message Shuaib on WhatsApp or check the Netlify function logs for errors.*
