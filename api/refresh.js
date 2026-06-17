import { clearCache } from "./ _lib/config";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  clearCache();
  return res.status(200).json({ ok: true, message: "Cache cleared, next request reads fresh Supabase config." });
}
