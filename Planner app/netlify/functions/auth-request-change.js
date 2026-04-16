const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { machineId, reason } = JSON.parse(event.body);
  if (!machineId) return err("machineId required");

  const sb = getSupabase();
  const { error } = await sb
    .from("device_registrations")
    .update({ change_requested: true, change_reason: reason || "User requested profile change" })
    .eq("machine_id", machineId);

  if (error) return err(error.message, 500);
  return json({ success: true });
};
