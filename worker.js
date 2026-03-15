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

const VERSION = 'v1.3.9';
const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const ALLOWED_ORIGIN = 'https://nehez.github.io';

const SYSTEM_PROMPT = `You are being asked to convert a workout program into a JSON file for a personal workout tracking app. Follow these instructions exactly.

CRITICAL — READ BEFORE STARTING:
- If the program shows one "template week" meant to repeat (e.g. "do this for 8 weeks"), you MUST output ALL weeks as separate week objects (week 1 through 8). Never output just one week for a multi-week program.
- If the program rotates (Week A / Week B over N weeks), output every week in sequence explicitly.
- Count the total number of weeks the program prescribes and verify your output has exactly that many week objects before finishing.

Your Output: Return raw JSON only — no markdown code fences, no explanation, no preamble, no whitespace between tokens. Output must be a single compact line with no newlines or extra spaces. The entire response must be parseable as JSON.

Top-Level Structure:
{"id":"unique_id","name":"Program Display Name","desc":"One-sentence description","weeks":[...]}
- id: lowercase, no spaces, no special characters except underscores (e.g. "wendler_531", "nsuns_4day")
- name: short human-readable name shown in the app dropdown
- desc: one sentence describing the program (intensity, focus, style)
- weeks: array of week objects. Only include weeks that exist in the program. Do not pad with empty weeks.

Week Objects:
{"week":1,"phase":1,"days":[...]}
- week: sequential week number starting at 1
- phase: training phase number if the program has named phases/blocks; if not, set phase:1 for all weeks
- days: array of day objects. Only include days that exist in the program. Do not pad to 7 days.

Day Objects — Training day:
{"day":1,"label":"MON — UPPER","time":"~60 min","sections":[...]}
- day: sequential day number within the week, starting at 1
- label: format "DAY_ABBREV — FOCUS" e.g. "MON — LOWER", "WED — PUSH", "DAY 1 — UPPER"
- time: estimated duration if provided; omit if not given (or use "~60 min" as fallback)
- sections: array of section objects

Rest day (only if explicitly scheduled in the program):
{"day":4,"label":"THU — REST","rest":true,"sections":[]}

Section Objects:
{"label":"MAIN LIFT","exercises":[...]}
- label: section heading in ALL CAPS e.g. "MAIN LIFT", "ACCESSORIES", "CONDITIONING", "WARM-UP"

Exercise Objects:
{"name":"Back Squat","sets":"5 x 5 / 3 min","mod":false,"subFor":"","note":""}
- name: exercise name as written in the program
- sets: sets/reps string with rest time appended using ONLY these exact formats: / 45s, / 60s, / 90s, / 2 min, / 3 min, / 4 min, / 5 min, / 2-3 min (range). If no rest time given, omit the rest portion entirely. Round unusual rest times to nearest option.
- mod: always false
- subFor: always ""
- note: coaching note from the program, or "" if none. Use this for week-specific loading info (e.g. "Week 1: 65% 1RM").

Supersets: append "(superset)" to the sets string of each exercise in the group.
e.g. "3 x 12 / 60s (superset)"

Critical rules — do not impose structure the program does not have:
- Output exactly as many weeks as the program contains
- Output exactly as many days per week as the program prescribes
- If the program is a template week meant to repeat N times, output all N weeks explicitly
- If the program rotates (Week A / Week B), output each week in sequence explicitly
- If loading varies by week but structure is identical, put the percentage/loading in the note field, not sets
- Include deload weeks as normal week objects
- For 1RM test days use section label "1RM TEST" or "MAX EFFORT"

Validation before responding:
1. JSON is valid and parseable — no trailing commas, no missing brackets
2. Every week has week number, phase number, and days array
3. Every day has day number, label, and sections array (or rest:true and empty sections)
4. Every exercise has name, sets, mod, subFor, and note
5. Rest times use only the approved formats listed above
6. id contains no spaces or special characters
7. You have not added weeks or days that do not exist in the source program`;

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost' || (origin && origin.startsWith('http://localhost:')) || (origin && origin.startsWith('http://127.'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  const payload = { ...body, _version: VERSION, _model: MODEL };
  if (payload.error) payload.error = payload.error + ' [worker ' + VERSION + ']';
  return new Response(JSON.stringify(payload), {
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
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI call timed out after 5 minutes. Try a shorter document.')), 300000)
        );
        aiResponse = await Promise.race([
          env.AI.run(MODEL, {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: 'Convert this workout program to JSON:\n\n' + text.slice(0, 12000) },
            ],
            max_tokens: 8192,
          }),
          timeout,
        ]);
      } catch (e) {
        return json({ error: 'AI inference failed: ' + e.message }, 502, origin);
      }

      const raw = aiResponse && (aiResponse.response || (aiResponse.choices && aiResponse.choices[0] && aiResponse.choices[0].message && aiResponse.choices[0].message.content));
      if (!raw) {
        return json({ error: 'No response from AI model.' }, 502, origin);
      }

      // Some models return an already-parsed object; others return a string
      let parsed;
      if (typeof raw === 'object') {
        parsed = raw;
      } else {
        const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        // Extract the JSON object even if the model added surrounding text
        const jStart = cleaned.indexOf('{');
        const jEnd = cleaned.lastIndexOf('}');
        const jsonStr = jStart !== -1 && jEnd > jStart ? cleaned.slice(jStart, jEnd + 1) : cleaned;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          return json({ error: 'AI returned malformed JSON — the output may have been truncated. Try a shorter document.' }, 502, origin);
        }
      }

      return json({ result: parsed }, 200, origin);

    } catch (e) {
      // Catch-all: ensure CORS headers are always present so the browser can read the error
      return json({ error: 'Unexpected worker error: ' + e.message }, 500, origin);
    }
  },
};
