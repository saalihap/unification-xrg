const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { id, completed } = JSON.parse(event.body);
  if (!id) return err("id required");

  const sb = getSupabase();
  const { error } = await sb
    .from("op_action_items")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return err(error.message, 500);
  return json({ success: true });
};
