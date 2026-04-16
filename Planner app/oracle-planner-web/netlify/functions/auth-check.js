const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { machineId } = JSON.parse(event.body);
  if (!machineId) return err("machineId required");

  const sb = getSupabase();
  const { data, error } = await sb
    .from("device_registrations")
    .select("*")
    .eq("machine_id", machineId)
    .limit(1);

  if (error) return err(error.message, 500);

  if (data && data.length > 0) {
    const reg = data[0];
    return json({
      registered: true,
      locked: reg.locked,
      changePending: reg.change_requested || false,
      machineId,
      name: reg.user_name,
      email: reg.user_email,
      role: reg.user_role,
      registeredAt: reg.registered_at,
    });
  }

  return json({ registered: false, machineId });
};
