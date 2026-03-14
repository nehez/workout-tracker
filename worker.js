// Workout Tracker — AI Conversion Proxy
// Deploy this to Cloudflare Workers.
// Set ANTHROPIC_API_KEY as a secret in your Worker's Settings → Variables.
//
// This worker accepts the extracted document text from the app,
// calls the Anthropic API with your key (never exposed to the browser),
// and returns the converted program JSON.

const ALLOWED_ORIGIN = 'https://nehez.github.io';

const PROMPT_PREFIX = `Convert this workout program document to JSON. Return ONLY valid JSON with no explanation and no markdown code fences.

Required format:
{"id":"unique_id","name":"Program Name","desc":"Short description","weeks":[{"week":1,"phase":1,"days":[{"label":"DAY 1 — LOWER BODY","time":"~60 min","sections":[{"label":"MAIN LIFT","exercises":[{"name":"Back Squat","sets":"5 x 5 / 2 min"}]}]},{"label":"DAY 7 — REST","rest":true,"sections":[]}]}]}

Rules:
- id: lowercase letters and underscores only, no spaces
- phase: integer, increment every 4 weeks (use 1 for all weeks if unclear)
- Rest days must use: {"label":"DAY X — REST","rest":true,"sections":[]}
- sets format examples: "5 x 5 / 2 min", "3 x 12 / 60s", "4 x MAX / 90s", "continuous"
- Section labels: short, uppercase (e.g. "MAIN LIFT", "ACCESSORY", "CONDITIONING")
- Include ALL weeks from the program — do not truncate

Document:

`;

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN || origin === 'http://localhost' || (origin && origin.startsWith('http://127.'));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
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

  const prompt = PROMPT_PREFIX + text.slice(0, 14000);

  let apiResponse;
  try {
    apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    return json({ error: 'Failed to reach Anthropic API: ' + e.message }, 502, origin);
  }

  const data = await apiResponse.json();

  if (data.error) {
    return json({ error: data.error.message || 'Anthropic API error' }, 502, origin);
  }

  const raw = data.content && data.content[0] && data.content[0].text;
  if (!raw) {
    return json({ error: 'No content returned from Claude.' }, 502, origin);
  }

  // Strip markdown fences if Claude added them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return json({ error: 'Claude returned malformed JSON. Try a cleaner source document.' }, 502, origin);
  }

  return json({ result: parsed }, 200, origin);
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
