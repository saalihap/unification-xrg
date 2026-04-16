// One-time migration: local data → Supabase
// Usage: node migrate-to-supabase.js

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "oracle-planner", "data");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TEAM_MAP = {
  shuaib: "shuaib@exergydesigns.com", bogdan: "bogdan@exergydesigns.com",
  yusuf: "yusuf@exergydesigns.com", nkosana: "nkosana@exergydesigns.com",
  saaliha: "saalihaparuk@gmail.com", essa: "essa@exergydesigns.com",
  drshika: "drshika.m@gmail.com", trent: "trent@garner-design.com",
  daniel: "daniel@raidien.com", ismaeel: "motalaismaeel@gmail.com",
};

function resolveEmail(name) {
  const lower = name.toLowerCase();
  for (const [key, email] of Object.entries(TEAM_MAP)) {
    if (lower.includes(key)) return email;
  }
  return null;
}

async function run() {
  console.log("=== Oracle Planner: Migrate to Supabase ===\n");

  // 1. Migrate meetings
  const meetDir = path.join(DATA_DIR, "meetings");
  const files = fs.readdirSync(meetDir).filter((f) => f.endsWith(".json"));
  console.log(`[Meetings] Found ${files.length} files`);

  const meetings = files.map((f) => {
    const m = JSON.parse(fs.readFileSync(path.join(meetDir, f), "utf8"));
    return {
      id: m.id,
      title: m.title,
      date: m.date,
      date_ms: m.dateMs || null,
      duration: m.duration,
      organizer_email: m.organizerEmail || "",
      participants: m.participants || [],
      summary: m.summary || "",
      keywords: m.keywords || [],
      action_items: m.actionItems || "",
    };
  });

  // Batch upsert (500 at a time)
  for (let i = 0; i < meetings.length; i += 500) {
    const batch = meetings.slice(i, i + 500);
    const { error } = await sb.from("op_meetings").upsert(batch, { onConflict: "id" });
    if (error) console.error(`  Batch ${i} error:`, error.message);
    else console.log(`  Upserted ${i + batch.length}/${meetings.length}`);
  }

  // 2. Extract and migrate action items
  const allItems = [];
  for (const m of meetings) {
    if (!m.action_items) continue;
    let person = "";
    for (const line of m.action_items.split("\n")) {
      const t = line.trim();
      if (t.startsWith("**") && t.endsWith("**")) { person = t.replace(/\*\*/g, "").trim(); continue; }
      if (t && person) {
        allItems.push({
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

  console.log(`[Action Items] Extracted ${allItems.length}`);
  for (let i = 0; i < allItems.length; i += 500) {
    const batch = allItems.slice(i, i + 500);
    const { error } = await sb.from("op_action_items").insert(batch);
    if (error) console.error(`  Batch ${i} error:`, error.message);
    else console.log(`  Inserted ${i + batch.length}/${allItems.length}`);
  }

  // 3. Set sync meta
  await sb.from("op_sync_meta").upsert([
    { key: "lastFireflySync", value: { timestamp: new Date().toISOString(), source: "migration" }, updated_at: new Date().toISOString() },
    { key: "migration", value: { completedAt: new Date().toISOString(), meetings: meetings.length, actionItems: allItems.length }, updated_at: new Date().toISOString() },
  ], { onConflict: "key" });

  // Verify
  const { count: mc } = await sb.from("op_meetings").select("*", { count: "exact", head: true });
  const { count: ac } = await sb.from("op_action_items").select("*", { count: "exact", head: true });
  console.log(`\n=== Migration Complete ===`);
  console.log(`  Meetings in Supabase: ${mc}`);
  console.log(`  Action items in Supabase: ${ac}`);
}

run().catch(console.error);
