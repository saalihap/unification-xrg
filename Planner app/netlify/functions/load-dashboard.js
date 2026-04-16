const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { userEmail, userName } = JSON.parse(event.body);
  const sb = getSupabase();

  // Meetings where this user participated
  let meetingsQuery = sb.from("op_meetings").select("*").order("date", { ascending: false });
  if (userEmail) {
    meetingsQuery = meetingsQuery.contains("participants", [userEmail]);
  }
  const { data: allMeetings } = await meetingsQuery.limit(100);

  // Also get meetings where user is organizer
  let orgMeetings = [];
  if (userEmail) {
    const { data } = await sb.from("op_meetings").select("*").eq("organizer_email", userEmail).order("date", { ascending: false }).limit(50);
    orgMeetings = data || [];
  }

  // Merge and dedupe
  const meetingMap = new Map();
  for (const m of [...(allMeetings || []), ...orgMeetings]) meetingMap.set(m.id, m);
  const meetings = Array.from(meetingMap.values()).sort((a, b) => (b.date_ms || 0) - (a.date_ms || 0));

  // Action items for this user
  let actionsQuery = sb.from("op_action_items").select("*").eq("completed", false).order("meeting_date", { ascending: false });
  if (userEmail) {
    actionsQuery = actionsQuery.eq("person_email", userEmail);
  } else if (userName) {
    actionsQuery = actionsQuery.ilike("person", `%${userName.split(" ")[0]}%`);
  }
  const { data: actionItems } = await actionsQuery.limit(200);

  // Sync meta
  const { data: syncRows } = await sb.from("op_sync_meta").select("*");
  const syncMeta = {};
  for (const r of syncRows || []) syncMeta[r.key] = r.value;

  // Total meetings count
  const { count } = await sb.from("op_meetings").select("*", { count: "exact", head: true });

  return json({
    meetings,
    actionItems: (actionItems || []).map((a) => ({ id: a.id, task: a.task, from: a.meeting_title, date: a.meeting_date, person: a.person, completed: a.completed })),
    syncMeta,
    totalMeetingsStored: count || 0,
    hasFireflies: true,
  });
};
