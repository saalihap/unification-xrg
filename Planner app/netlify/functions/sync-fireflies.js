const https = require("https");
const { getSupabase, json, err } = require("./_lib/supabase");

// Team roster for resolving names to emails
const TEAM_MAP = {
  shuaib: "shuaib@exergydesigns.com",
  bogdan: "bogdan@exergydesigns.com",
  yusuf: "yusuf@exergydesigns.com",
  nkosana: "nkosana@exergydesigns.com",
  saaliha: "saalihaparuk@gmail.com",
  essa: "essa@exergydesigns.com",
  drshika: "drshika.m@gmail.com",
  trent: "trent@garner-design.com",
  daniel: "daniel@raidien.com",
  ismaeel: "motalaismaeel@gmail.com",
};

function resolveEmail(personName) {
  const lower = personName.toLowerCase();
  for (const [key, email] of Object.entries(TEAM_MAP)) {
    if (lower.includes(key)) return email;
  }
  return null;
}

function gqlRequest(apiKey, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const p = JSON.parse(data);
          if (p.errors) reject(new Error(p.errors[0].message));
          else resolve(p.data);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function fetchMeetings(apiKey, daysBack) {
  const cutoff = Date.now() - daysBack * 86400000;
  const all = [];
  let skip = 0;
  while (true) {
    const data = await gqlRequest(apiKey, `{ transcripts(limit:50, skip:${skip}) { id title date duration organizer_email participants summary { short_summary keywords action_items } } }`);
    const batch = data.transcripts || [];
    if (!batch.length) break;
    let done = false;
    for (const t of batch) {
      const dateMs = typeof t.date === "number" ? t.date : parseInt(t.date, 10);
      if (dateMs && dateMs < cutoff) { done = true; continue; }
      all.push({
        id: t.id, title: t.title, date: dateMs ? new Date(dateMs).toISOString() : null, date_ms: dateMs,
        duration: t.duration, organizer_email: t.organizer_email || "", participants: t.participants || [],
        summary: t.summary?.short_summary || "", keywords: t.summary?.keywords || [],
        action_items: t.summary?.action_items || "",
      });
    }
    if (done || batch.length < 50) break;
    skip += 50;
  }
  return all;
}

function extractActionItems(meetings) {
  const items = [];
  for (const m of meetings) {
    if (!m.action_items) continue;
    let person = "";
    for (const line of m.action_items.split("\n")) {
      const t = line.trim();
      if (t.startsWith("**") && t.endsWith("**")) { person = t.replace(/\*\*/g, "").trim(); continue; }
      if (t && person) {
        items.push({
          meeting_id: m.id,
          task: t.replace(/^\d+\.\s*/, "").replace(/\(\d+:\d+\)\s*$/, "").trim(),
          meeting_title: m.title,
          meeting_date: m.date,
          person,
          person_email: resolveEmail(person),
        });
      }
    }
  }
  return items;
}

exports.handler = async (event) => {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) return err("FIREFLIES_API_KEY not set", 500);

  const sb = getSupabase();
  let daysBack = 7;

  // Check body for manual trigger
  if (event.body) {
    try { daysBack = JSON.parse(event.body).daysBack || 7; } catch {}
  }

  // Smart sync: check last sync time
  const { data: metaRow } = await sb.from("op_sync_meta").select("value").eq("key", "lastFireflySync").single();
  if (metaRow?.value?.timestamp) {
    const lastMs = new Date(metaRow.value.timestamp).getTime();
    const calculated = Math.max(1, Math.ceil((Date.now() - lastMs) / 86400000) + 1);
    if (!event.body) daysBack = calculated; // Only use smart sync for scheduled runs
  } else {
    daysBack = 90; // First ever sync
  }

  console.log(`[Sync] Fetching ${daysBack} days of meetings`);
  const meetings = await fetchMeetings(apiKey, daysBack);
  console.log(`[Sync] Got ${meetings.length} meetings`);

  // Upsert meetings
  if (meetings.length) {
    const { error: mErr } = await sb.from("op_meetings").upsert(meetings, { onConflict: "id" });
    if (mErr) console.error("Meeting upsert error:", mErr.message);
  }

  // Re-extract ALL action items from synced meetings
  const actionItems = extractActionItems(meetings);
  if (actionItems.length) {
    // Delete old items for these meetings, then re-insert
    const meetingIds = [...new Set(meetings.map((m) => m.id))];
    for (let i = 0; i < meetingIds.length; i += 50) {
      await sb.from("op_action_items").delete().in("meeting_id", meetingIds.slice(i, i + 50));
    }
    // Batch insert
    for (let i = 0; i < actionItems.length; i += 500) {
      await sb.from("op_action_items").insert(actionItems.slice(i, i + 500));
    }
  }

  // Update sync meta
  await sb.from("op_sync_meta").upsert({ key: "lastFireflySync", value: { timestamp: new Date().toISOString(), meetingsSynced: meetings.length }, updated_at: new Date().toISOString() }, { onConflict: "key" });

  const { count } = await sb.from("op_meetings").select("*", { count: "exact", head: true });
  return json({ success: true, meetingsSynced: meetings.length, totalMeetings: count });
};
