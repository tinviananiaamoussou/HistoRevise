// Edge Function "grade-qcm"
// Corrige un QCM déjà généré : compare les réponses de l'étudiant à la grille
// stockée en base (jamais envoyée au client avant correction), renvoie le détail
// complet par proposition + le score.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  try {
    const { attempt_id, answers } = await req.json();
    // answers: { [questionId]: { [label]: boolean } }
    if (!attempt_id || !answers) {
      return new Response(JSON.stringify({ error: "attempt_id et answers sont requis" }), {
        status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: attempt, error: fetchErr } = await sb
      .from("qcm_attempts")
      .select("id, questions, chapter, session_id")
      .eq("id", attempt_id)
      .single();
    if (fetchErr || !attempt) {
      return new Response(JSON.stringify({ error: "QCM introuvable" }), {
        status: 404, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    let fullyCorrectCount = 0;
    const corrected = (attempt.questions as any[]).map((q) => {
      const studentAnswer = answers[q.id] || {};
      let questionFullyCorrect = true;
      const propositions = q.propositions.map((p: any) => {
        const studentSaidTrue = !!studentAnswer[p.label];
        const isRight = studentSaidTrue === !!p.correct;
        if (!isRight) questionFullyCorrect = false;
        return {
          label: p.label,
          text: p.text,
          correct: p.correct,
          student_said_true: studentSaidTrue,
          is_right: isRight,
          justification: p.justification,
          trap: p.trap || "",
          concept_recall: p.concept_recall,
        };
      });
      if (questionFullyCorrect) fullyCorrectCount++;
      return { id: q.id, statement: q.statement, concept: q.concept, propositions, fully_correct: questionFullyCorrect };
    });

    await sb.from("qcm_attempts").update({
      student_answers: answers,
      score: fullyCorrectCount,
      completed_at: new Date().toISOString(),
    }).eq("id", attempt_id);

    // Flashcards de révision espacée pour chaque proposition ratée.
    // En cas d'erreur répétée sur la même proposition, l'intervalle repart à 1 jour (régression).
    const missedCards = [];
    for (const q of corrected) {
      for (const p of q.propositions) {
        if (!p.is_right) {
          missedCards.push({
            session_id: attempt.session_id,
            chapter: attempt.chapter,
            concept: q.concept,
            question_statement: q.statement,
            proposition_label: p.label,
            proposition_text: p.text,
            justification: p.justification,
            interval_days: 1,
            next_review_at: new Date().toISOString(),
          });
        }
      }
    }
    if (missedCards.length > 0) {
      await sb.from("flashcards").upsert(missedCards, { onConflict: "session_id,question_statement,proposition_label" });
    }

    return new Response(JSON.stringify({
      score: fullyCorrectCount,
      total: corrected.length,
      chapter: attempt.chapter,
      questions: corrected,
    }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
