// Edge Function "chat"
// Répond UNIQUEMENT à partir des documents du coffre-fort (grounding strict),
// cite le document utilisé, et refuse d'inventer si l'info n'y est pas.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CONTEXT_CHAR_BUDGET = 150000; // sécurité : reste large pour Flash (1M tokens) mais évite un prompt démesuré
const PER_DOC_CHAR_CAP = 20000;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const { session_id, message } = await req.json();
    if (!session_id || !message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "session_id et message sont requis" }), {
        status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // 1) Clé Gemini depuis le coffre de secrets (Vault)
    const { data: secretRows, error: secretErr } = await sb
      .schema("vault")
      .from("decrypted_secrets")
      .select("decrypted_secret")
      .eq("name", "gemini_api_key")
      .limit(1);
    if (secretErr || !secretRows || secretRows.length === 0) {
      console.error("Secret introuvable", secretErr);
      return new Response(JSON.stringify({ error: "Clé API non configurée" }), {
        status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
    const geminiKey = secretRows[0].decrypted_secret as string;

    // 2) Documents du coffre-fort (grounding)
    const { data: docs, error: docsErr } = await sb
      .from("documents")
      .select("title, chapter, extracted_text")
      .not("extracted_text", "is", null)
      .order("created_at", { ascending: false });
    if (docsErr) throw docsErr;

    let contextStr = "";
    let budget = CONTEXT_CHAR_BUDGET;
    for (const d of docs || []) {
      if (!d.extracted_text || budget <= 0) continue;
      const chunk = String(d.extracted_text).slice(0, PER_DOC_CHAR_CAP);
      const block = `\n### Document: "${d.title}" (chapitre: ${d.chapter})\n${chunk}\n`;
      if (block.length > budget) break;
      contextStr += block;
      budget -= block.length;
    }

    // 3) Historique récent de la session (contexte conversationnel)
    const { data: history } = await sb
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", session_id)
      .order("created_at", { ascending: false })
      .limit(10);
    const orderedHistory = (history || []).slice().reverse();

    const systemInstruction = `Tu es l'assistant de révision d'HistoRévise, pour des étudiants en médecine au Bénin (histologie et embryologie).
RÈGLES STRICTES :
- Réponds UNIQUEMENT à partir des documents fournis ci-dessous (le "coffre-fort"). N'utilise aucune autre connaissance, même si tu la connais.
- Si l'information demandée ne se trouve pas dans les documents fournis, réponds EXACTEMENT : "Je ne trouve pas cette information dans les documents." Ne complète jamais avec tes propres connaissances.
- Quand tu réponds à partir d'un document, cite-le clairement : indique le titre du document et reprends le passage pertinent (entre guillemets si c'est court).
- N'invente jamais un document, une citation, ou un fait.
- Réponds en français, de façon claire et rigoureuse (niveau concours de médecine), sans simplification excessive.

DOCUMENTS DISPONIBLES :
${contextStr || "(Aucun document avec texte extrait n'est disponible pour le moment.)"}`;

    const contents = [
      ...orderedHistory.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const geminiResp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0.2 },
        }),
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error("Erreur Gemini:", geminiResp.status, errText);
      return new Response(JSON.stringify({ error: "Erreur de l'IA, réessayez dans un instant." }), {
        status: 502, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResp.json();
    const answer =
      geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
      "Je ne trouve pas cette information dans les documents.";

    // 4) Enregistrer l'historique
    await sb.from("chat_messages").insert([
      { session_id, role: "user", content: message },
      { session_id, role: "assistant", content: answer },
    ]);

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
