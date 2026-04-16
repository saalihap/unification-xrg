const Anthropic = require("@anthropic-ai/sdk");
const { getSupabase } = require("./_lib/supabase");

// Netlify Functions v2 format for streaming
module.exports.config = { path: "/api/chat" };

module.exports.default = async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500 });

  const { messages, userName, userEmail } = await req.json();
  const sb = getSupabase();

  // Build context from Supabase
  const contextParts = [`User: ${userName} (${userEmail})`];

  // User's meetings
  if (userEmail) {
    const { data: meetings } = await sb.from("op_meetings").select("title,date,duration,summary,participants").contains("participants", [userEmail]).order("date", { ascending: false }).limit(10);
    if (meetings?.length) {
      contextParts.push(`\nMeetings ${userName} attended (${meetings.length}):`);
      for (const m of meetings) contextParts.push(`  [${m.date ? new Date(m.date).toLocaleDateString() : "?"}] ${m.title}: ${(m.summary || "").substring(0, 200)}`);
    }
  }

  // User's action items
  let aq = sb.from("op_action_items").select("task,meeting_title").eq("completed", false).limit(20);
  if (userEmail) aq = aq.eq("person_email", userEmail);
  const { data: actions } = await aq;
  if (actions?.length) {
    contextParts.push(`\nAction items for ${userName} (${actions.length}):`);
    for (const a of actions) contextParts.push(`  - ${a.task.substring(0, 150)}`);
  }

  const systemPrompt = `You are Oracle Planner, ${userName}'s AI work assistant at Exergy Designs. You know about their projects: Edge Energy CloudBoiler, Chrono Astra, Group ABR, Nomad Power, Oracle tools, Sensify. Be concise and actionable.\n\n${contextParts.join("\n")}`;

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        // Save chat session
        const fullMessages = [...messages];
        const final = await stream.finalMessage();
        const assistantText = final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        fullMessages.push({ role: "assistant", content: assistantText });
        await sb.from("op_chat_sessions").insert({ user_email: userEmail, user_name: userName, messages: fullMessages });
      } catch (e) {
        controller.enqueue(encoder.encode(`\n[Error: ${e.message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
  });
};
