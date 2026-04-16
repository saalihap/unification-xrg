const Anthropic = require("@anthropic-ai/sdk");
const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err("ANTHROPIC_API_KEY not set", 500);

  const { extraContext, userName, userEmail } = JSON.parse(event.body);
  const sb = getSupabase();
  const firstName = userName ? userName.split(" ")[0] : null;

  // Fetch user's meetings
  let meetings = [];
  if (userEmail) {
    const { data: p } = await sb.from("op_meetings").select("*").contains("participants", [userEmail]).order("date", { ascending: false }).limit(20);
    const { data: o } = await sb.from("op_meetings").select("*").eq("organizer_email", userEmail).order("date", { ascending: false }).limit(20);
    const map = new Map();
    for (const m of [...(p || []), ...(o || [])]) map.set(m.id, m);
    meetings = Array.from(map.values()).sort((a, b) => (b.date_ms || 0) - (a.date_ms || 0));
  }

  // Fetch action items
  let actionsQuery = sb.from("op_action_items").select("*").eq("completed", false).order("meeting_date", { ascending: false }).limit(50);
  if (userEmail) actionsQuery = actionsQuery.eq("person_email", userEmail);
  else if (firstName) actionsQuery = actionsQuery.ilike("person", `%${firstName}%`);
  const { data: actionItems } = await actionsQuery;

  const actionText = (actionItems || []).map((a) => `- ${a.task} (from: ${a.meeting_title}, ${a.meeting_date ? new Date(a.meeting_date).toLocaleDateString() : "?"})`).join("\n");
  const meetText = meetings.slice(0, 20).map((m) => `- ${m.title} (${m.date ? new Date(m.date).toLocaleDateString() : "?"}, ${m.duration}min): ${(m.summary || "").substring(0, 300)}`).join("\n");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: `You are Oracle Planner, an AI assistant for ${userName || "the user"} at Exergy Designs — an engineering consulting firm. Generate a practical daily plan. Prioritize: client deadlines > team management > internal tools > strategy. Use markdown with [URGENT], [TODAY], [THIS WEEK] tags.`,
    messages: [{
      role: "user",
      content: `Generate my daily plan and to-do list.\n\n## My Action Items\n${actionText || "None found"}\n\n## My Recent Meetings (${meetings.length})\n${meetText || "None"}\n\n${extraContext || ""}`,
    }],
  });

  let plan = "";
  for (const block of response.content) {
    if (block.type === "text") plan += block.text;
  }

  // Save to database
  await sb.from("op_plans").insert({ user_email: userEmail, user_name: userName, plan_md: plan });

  return json({ plan });
};
