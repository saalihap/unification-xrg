const { json } = require("./_lib/supabase");

const TEAM = [
  { name: "Shuaib Badat", email: "shuaib@exergydesigns.com", role: "Founder" },
  { name: "Bogdan Dirlosan", email: "bogdan@exergydesigns.com", role: "Engineer" },
  { name: "Yusuf Moola", email: "yusuf@exergydesigns.com", role: "Engineer" },
  { name: "Nkosana Sibeko", email: "nkosana@exergydesigns.com", role: "Engineer" },
  { name: "Saaliha Paruk", email: "saalihaparuk@gmail.com", role: "Engineer" },
  { name: "Essa", email: "essa@exergydesigns.com", role: "Engineer" },
  { name: "Drshika Mahabeer", email: "drshika.m@gmail.com", role: "Marketing" },
  { name: "Trent Garner", email: "trent@garner-design.com", role: "Designer" },
  { name: "Daniel P", email: "daniel@raidien.com", role: "Engineer" },
  { name: "Ismaeel Motala", email: "motalaismaeel@gmail.com", role: "Engineer" },
];

exports.handler = async () => json(TEAM);
