import { createClient } from "npm:@supabase/supabase-js@2";

const origins = ["https://dobbycantbefree.github.io", "https://aedos-xi.vercel.app"];
const allowedOrigin = (requestOrigin: string | null) => requestOrigin && origins.includes(requestOrigin) ? requestOrigin : "null";
const project = "ces27";
const bucket = "ados-alpha";
const maxBytes = 1024 * 1024;
const allowed = /\.(txt|md|csv)$/i;
const accountId = "6d02980db586bccad87c71428f54cc6c";
const model = "@cf/google/gemma-4-26b-a4b-it";
const encoder = new TextEncoder();
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!serviceKey || !supabaseUrl) throw new Error("Supabase service credentials unavailable");
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function response(status: number, data: unknown, requestOrigin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": allowedOrigin(requestOrigin),
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "vary": "Origin",
    },
  });
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64(s: string) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
async function sha256(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function signingKey() {
  return crypto.subtle.importKey("raw", encoder.encode(serviceKey!), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function makeToken(id: string) {
  const body = b64(encoder.encode(JSON.stringify({ id, exp: Date.now() + 12 * 3600_000 })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(body)));
  return body + "." + b64(sig);
}
async function session(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(), unb64(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(body)));
    if (!/^tester[1-4]$/.test(payload.id) || payload.exp < Date.now()) return null;
    const { data } = await db.from("ados_alpha_testers").select("active").eq("id", payload.id).single();
    return data?.active ? payload.id as string : null;
  } catch { return null; }
}
function terms(s: string) {
  return [...new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(x => x.length > 1))];
}
function passages(files: Array<{ name: string; content: string }>, question: string) {
  const query = terms(question);
  const hits: Array<{ name: string; text: string; score: number }> = [];
  for (const file of files) {
    for (const raw of file.content.split(/(?<=[.!?。])\s+|\n+/)) {
      const text = raw.trim();
      if (text.length < 7) continue;
      const haystack = (file.name + " " + text).toLowerCase();
      const score = query.filter(t => haystack.includes(t)).length;
      if (score) hits.push({ name: file.name, text: text.slice(0, 600), score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 5);
}

Deno.serve(async req => {
  const requestOrigin = req.headers.get("origin");
  if (req.method === "OPTIONS") return response(200, {}, requestOrigin);
  if (requestOrigin && !origins.includes(requestOrigin)) return response(403, { error: "Origin not allowed" }, requestOrigin);
  const pathname = new URL(req.url).pathname;
  const route = pathname.slice(pathname.indexOf("/ados-api") + "/ados-api".length);
  try {
    if (route === "/health" && req.method === "GET") return response(200, { shared: true, ai: Boolean(Deno.env.get("CLOUDFLARE_API_TOKEN")) }, requestOrigin);
    if (route === "/login" && req.method === "POST") {
      const { user, password } = await req.json();
      if (!/^tester[1-4]$/.test(String(user)) || typeof password !== "string") return response(401, { error: "Invalid credentials" }, requestOrigin);
      const { data } = await db.from("ados_alpha_testers").select("pass_hash,active").eq("id", user).single();
      if (!data?.active || data.pass_hash !== await sha256(password)) return response(401, { error: "Invalid credentials" }, requestOrigin);
      return response(200, { user, token: await makeToken(user) }, requestOrigin);
    }
    const user = await session(req);
    if (!user) return response(401, { error: "Login required" }, requestOrigin);
    if (route === "/files" && req.method === "GET") {
      const { data, error } = await db.from("ados_alpha_files").select("id,name,mime,content,uploaded_by,created_at").eq("project", project).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return response(200, { files: data?.map(f => ({ id: f.id, name: f.name, mime: f.mime, content: f.content.slice(0, 30000), tag: "Others", by: f.uploaded_by, date: f.created_at, enabled: true, remote: true })) || [] }, requestOrigin);
    }
    if (route === "/files" && req.method === "POST") {
      const b = await req.json();
      if (b.project !== project || typeof b.name !== "string" || !allowed.test(b.name) || typeof b.base64 !== "string") return response(400, { error: "TXT, MD, CSV files only" }, requestOrigin);
      const bytes = unb64(b.base64);
      if (!bytes.length || bytes.length > maxBytes) return response(413, { error: "Max file size: 1 MB" }, requestOrigin);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 100000); }
      catch { return response(400, { error: "UTF-8 text file required" }, requestOrigin); }
      if (!content.trim()) return response(400, { error: "Empty file" }, requestOrigin);
      const name = b.name.split(/[\\/]/).pop()!.slice(0, 120);
      const id = crypto.randomUUID();
      const extension = name.toLowerCase().match(/\.(txt|md|csv)$/)?.[1] || "txt";
      const path = project + "/" + id + "/" + id + "." + extension;
      const mime = name.toLowerCase().endsWith(".csv") ? "text/csv" : name.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain";
      const uploaded = await db.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
      if (uploaded.error) throw uploaded.error;
      const inserted = await db.from("ados_alpha_files").insert({ id, project, name, mime, storage_path: path, content, uploaded_by: user }).select("created_at").single();
      if (inserted.error) { await db.storage.from(bucket).remove([path]); throw inserted.error; }
      return response(201, { file: { id, name, mime, content: content.slice(0, 30000), tag: "Others", by: user, date: inserted.data.created_at, enabled: true, remote: true } }, requestOrigin);
    }
    if (route.startsWith("/file/") && req.method === "DELETE") {
      const id = route.slice("/file/".length);
      if (!/^[0-9a-f-]{36}$/.test(id)) return response(404, { error: "Not found" }, requestOrigin);
      const { data } = await db.from("ados_alpha_files").select("storage_path,uploaded_by").eq("id", id).eq("project", project).single();
      if (!data) return response(404, { error: "Not found" }, requestOrigin);
      if (data.uploaded_by !== user) return response(403, { error: "Only the uploader can delete this file" }, requestOrigin);
      const removed = await db.storage.from(bucket).remove([data.storage_path]);
      if (removed.error) throw removed.error;
      const deleted = await db.from("ados_alpha_files").delete().eq("id", id).eq("uploaded_by", user);
      if (deleted.error) throw deleted.error;
      return response(200, { deleted: true }, requestOrigin);
    }
    if (route.startsWith("/file/") && req.method === "GET") {
      const id = route.slice("/file/".length);
      if (!/^[0-9a-f-]{36}$/.test(id)) return response(404, { error: "Not found" }, requestOrigin);
      const { data } = await db.from("ados_alpha_files").select("name,mime,storage_path").eq("id", id).eq("project", project).single();
      if (!data) return response(404, { error: "Not found" }, requestOrigin);
      const downloaded = await db.storage.from(bucket).download(data.storage_path);
      if (downloaded.error) throw downloaded.error;
      return new Response(downloaded.data, { headers: {
        "content-type": data.mime,
        "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(data.name),
        "access-control-allow-origin": allowedOrigin(requestOrigin),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      } });
    }
    if (route === "/ask" && req.method === "POST") {
      const { project: requested, question } = await req.json();
      if (requested !== project || typeof question !== "string" || !question.trim() || question.length > 1000) return response(400, { error: "Question must be 1-1000 characters" }, requestOrigin);
      const aiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
      if (!aiToken) return response(503, { error: "AI connection not configured" }, requestOrigin);
      const { data: files, error } = await db.from("ados_alpha_files").select("name,content").eq("project", project).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const hits = passages(files || [], question);
      if (!hits.length) return response(200, { answer: "업로드된 문서에서 관련 내용을 찾지 못했습니다. TXT, MD, CSV 파일을 확인해 주세요.", sources: [], mode: "no_match" }, requestOrigin);
      const today = new Date().toISOString().slice(0, 10);
      const { data: usage } = await db.from("ados_alpha_questions").select("count").eq("tester_id", user).eq("day", today).maybeSingle();
      if ((usage?.count || 0) >= 5) return response(429, { error: "오늘의 알파테스트 질문 5회가 끝났습니다." }, requestOrigin);
      const cf = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { authorization: "Bearer " + aiToken, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Answer the user's question in Korean using only the supplied document excerpts. If the excerpts are insufficient, say so. Never invent facts. Keep the answer concise and cite source file names." },
            { role: "user", content: "Document excerpts:\n" + hits.map((h, i) => `[${i + 1}] ${h.name}: ${h.text}`).join("\n") + "\n\nQuestion: " + question },
          ],
          max_completion_tokens: 600,
          chat_template_kwargs: { enable_thinking: false },
          temperature: 0.2,
        }),
      });
      if (!cf.ok) return response(cf.status === 429 ? 429 : 502, { error: cf.status === 429 ? "무료 AI 사용량이 소진되었거나 잠시 혼잡합니다." : "AI 응답을 받지 못했습니다." }, requestOrigin);
      const payload = await cf.json();
      const rawAnswer = payload?.result?.response || payload?.response ||
        payload?.result?.choices?.[0]?.message?.content ||
        payload?.choices?.[0]?.message?.content;
      const answer = typeof rawAnswer === "string" ? rawAnswer : Array.isArray(rawAnswer) ? rawAnswer.map(part => typeof part === "string" ? part : part?.text || "").join("\n") : "";
      const finalAnswer = answer.trim() || "AI가 이번에는 문장을 만들지 못했습니다. 관련 자료 원문:\n" + hits.slice(0, 2).map(h => `- ${h.name}: ${h.text}`).join("\n");
      await db.from("ados_alpha_questions").upsert({ tester_id: user, day: today, count: (usage?.count || 0) + 1 });
      return response(200, { mode: answer.trim() ? "cloudflare_ai" : "source_excerpt", answer: finalAnswer, sources: [...new Set(hits.map(h => h.name))].map(file => ({ project: "OYF2027", file })) }, requestOrigin);
    }
    return response(404, { error: "Not found" }, requestOrigin);
  } catch (e) {
    console.error(e);
    return response(500, { error: "Server error" }, requestOrigin);
  }
});
