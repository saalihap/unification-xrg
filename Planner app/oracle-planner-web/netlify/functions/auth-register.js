const { getSupabase, json, err } = require("./_lib/supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { machineId, name, email, role } = JSON.parse(event.body);
  if (!machineId || !name || !email) return err("machineId, name, email required");

  const sb = getSupabase();
  const { data, error } = await sb
    .from("device_registrations")
    .insert({
      machine_id: machineId,
      user_name: name,
      user_email: email,
      user_role: role || "Engineer",
      hostname: "web-browser",
      locked: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return err("This device is already registered", 409);
    return err(error.message, 500);
  }

  return json({ machineId, name: data.user_name, email: data.user_email, role: data.user_role, registeredAt: data.registered_at });
};
