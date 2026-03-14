// Workout Tracker — AI Conversion Worker (Cloudflare Workers AI)
// Deploy this to Cloudflare Workers.
//
// IMPORTANT: In the Cloudflare dashboard editor, make sure the worker is set to
// "ES Module" format (not "Service Worker"). The editor has a toggle — look for
// it in the top-right of the code editor. This file uses `export default {}` syntax
// which requires ES Module format. Using Service Worker format will cause a parse
// error and "Failed to fetch" on every request.
//
// Requires an AI binding named "AI":
//   Dashboard → Worker → Settings → Bindings → Add binding → Workers AI → name it "AI"

const ALLOWED_ORIGIN = 'https://nehez.github.io';

const SYSTEM_PROMPT = `You are a workout program converter. Your only job is to output valid JSON — no explanation, no markdown fences, nothing else.

Convert the workout program text the user provides into this exact JSON structure:
{"id":"unique_id","name":"Program Name","desc":"Short description","weeks":[{"week":1,"phase":1,"days":[{"label":"DAY 1 — LOWER BODY","time":"~60 min","sections":[{"label":"MAIN LIFT","exercises":[{"name":"Back Squat","sets":"5 x 5 / 2 min","note":"Optional cue"}]}]},{"label":"DAY 7 — REST","rest":true,"sections":[]}]}]}

Rules:
- id: lowercase letters and underscores only, no spaces or special chars
- phase: integer, increment every 4 weeks (use 1 for all weeks if unclear)
- Rest days must use: {"label":"DAY X — REST","rest":true,"sections":[]}
- sets format examples: "5 x 5 / 2 min", "3 x 12 / 60s", "4 x MAX / 90s", "continuous", "1x TABATA"
- Section labels: short, uppercase (e.g. "MAIN LIFT", "ACCESSORY", "CONDITIONING")
- Include ALL weeks from the program — do not truncate or summarize
- Return ONLY valid JSON. No markdown. No explanation.`;

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost' || (origin && origin.startsWith('http://localhost:')) || (origin && origin.startsWith('http://127.'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Top-level guard: always return CORS headers so the browser can read the error
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed.' }, 405, origin);
      }

      if (!env.AI) {
        return json({ error: 'AI binding not configured. Add an AI binding named "AI" in the Cloudflare dashboard.' }, 500, origin);
      }

      let text;
      try {
        const body = await request.json();
        text = body.text;
        if (!text || typeof text !== 'string' || text.trim().length < 30) {
          return json({ error: 'No usable text provided.' }, 400, origin);
        }
      } catch (e) {
        return json({ error: 'Invalid request body.' }, 400, origin);
      }

      let aiResponse;
      try {
        aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Convert this workout program to JSON:\n\n' + text.slice(0, 12000) },
          ],
          max_tokens: 8000,
        });
      } catch (e) {
        return json({ error: 'AI inference failed: ' + e.message }, 502, origin);
      }

      const raw = aiResponse && (aiResponse.response || (aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message && aiResponse.choices[0].message.content));
      if (!raw) {
        return json({ error: 'No response from AI model.' }, 502, origin);
      }

      // Strip markdown fences if the model added them despite instructions
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return json({ error: 'AI returned malformed JSON. Try a cleaner source document.' }, 502, origin);
      }

      return json({ result: parsed }, 200, origin);

    } catch (e) {
      // Catch-all: ensure CORS headers are always present so the browser can read the error
      return json({ error: 'Unexpected worker error: ' + e.message }, 500, origin);
    }
  },
};
