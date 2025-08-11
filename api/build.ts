// api/build.ts — vG-1.2 (Gemini 1.5 Flash, structured JSON — no additionalProperties)
export const config = { runtime: "edge" };

const MODEL = "gemini-1.5-flash-latest";
const MAX_ACTIONS = 200;
const MAX_OUT_TOKENS = 700;
const TEMP = 0.2;

const schema = {
  type: "object",
  required: ["actions"],
  properties: {
    actions: {
      type: "array",
      minItems: 0,
      maxItems: MAX_ACTIONS,
      items: {
        type: "object",
        required: ["type","pos","size"],
        properties: {
          type:     { type: "string", enum: ["PLACE_BLOCK","PLACE_WEDGE","PLACE_CYLINDER"] },
          pos:      { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } },
          size:     { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } },
          yaw:      { type: "number" },
          color:    { type: "string" },
          material: { type: "string" },
          group:    { type: "string" }
        }
      }
    }
  }
} as const;

const SYS =
  "You are a ROBLOX level designer. Return ONLY JSON per schema.\n" +
  "Units: ROBLOX studs. Origin [0,0,0]; game offsets to player aim.\n" +
  "Keep sizes in 0.1..200. Use blocks for floors/walls/roof, wedges for slopes, cylinders for pillars.\n" +
  "Group parts with short names (e.g., 'house','roof','windows').";

async function callGeminiJSON(prompt: string) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ actions:[], reason:"NO_KEY" } };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    systemInstruction: { role: "system", parts: [{ text: SYS }] },
    generationConfig: {
      temperature: TEMP,
      max_output_tokens: MAX_OUT_TOKENS,
      response_mime_type: "application/json",
      response_schema: schema
    }
  };

  let lastTxt = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    lastTxt = txt;

    if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
      const ra = Number(r.headers.get("retry-after") || 0);
      await new Promise(res => setTimeout(res, ra > 0 ? ra*1000 : 400*attempt));
      continue;
    }
    if (!r.ok) {
      return { ok:false, status:r.status, body:{ actions:[], reason:"GEMINI_FAIL", detail: txt.slice(0,400) } };
    }

    let j:any=null; try { j = JSON.parse(txt); } catch {}
    const part = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!part) return { ok:false, status:200, body:{ actions:[], reason:"NO_TEXT", detail: txt.slice(0,400) } };

    let data:any=null; try { data = JSON.parse(part); } catch {}
    if (!data || !Array.isArray(data.actions)) {
      return { ok:false, status:200, body:{ actions:[], reason:"BAD_MODEL_JSON", detail: part.slice(0,400) } };
    }
    data.actions = data.actions.slice(0, MAX_ACTIONS);
    return { ok:true, status:200, body:data };
  }
  return { ok:false, status:429, body:{ actions:[], reason:"RATE_LIMIT", detail:lastTxt.slice(0,400) } };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey }, version:"vG-1.2", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }

  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0,400).trim();
    if (!prompt) return new Response(JSON.stringify({ actions:[], reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });

    const { ok, status, body } = await callGeminiJSON(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[], reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
