// api/build.ts — v11.1: OpenAI Structured Outputs + küçük retry + düşük token
export const config = { runtime: "edge" };

const MODEL = "gpt-4o-mini";
const MAX_ACTIONS = 200;
const MAX_TOKENS = 700;

const schema = { /* aynı schema, kısalttım */ 
  name: "ai_build_actions",
  schema: {
    type: "object",
    properties: { actions: { type: "array", maxItems: MAX_ACTIONS, items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["PLACE_BLOCK","PLACE_WEDGE","PLACE_CYLINDER"] },
        pos:  { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        size: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        yaw: { type: "number" }, color: { type: "string" }, material: { type: "string" }, group: { type: "string" }
      }, required: ["type","pos","size"], additionalProperties: false
    }}}}, required: ["actions"], additionalProperties: false
};

function sysPrompt() {
  return [
    "Return ONLY JSON per schema.",
    "Units: ROBLOX studs. Origin [0,0,0]. Game offsets to player aim.",
    "Use simple blocks/wedges/cylinders. Reasonable sizes (0.1..200). Group with 'house','roof','windows', etc."
  ].join("\n");
}

async function callOpenAI(prompt: string) {
  const apiKey = (process.env as any).OPENAI_API_KEY;
  if (!apiKey) return { ok:false, status:500, body:{ actions:[], reason:"NO_KEY" } };

  const body = {
    model: MODEL, temperature: 0.2, max_tokens: MAX_TOKENS,
    messages: [{ role:"system", content: sysPrompt() }, { role:"user", content: prompt }],
    response_format: { type: "json_schema", json_schema: schema }
  };

  let lastTxt = "";
  for (let attempt=1; attempt<=2; attempt++) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    const txt = await r.text(); lastTxt = txt;

    if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
      const ra = Number(r.headers.get("retry-after") || 0);
      const backoff = ra > 0 ? ra*1000 : (300 * attempt); // 0.3s, 0.6s (edge'te kısa bekleme)
      await new Promise(res => setTimeout(res, backoff));
      continue;
    }
    if (!r.ok) return { ok:false, status:r.status, body:{ actions:[], reason:"OPENAI_FAIL", detail:txt } };

    let j:any=null; try { j = JSON.parse(txt); } catch {}
    const content = j?.choices?.[0]?.message?.content ?? "";
    let data:any=null; try { data = JSON.parse(content); } catch {}
    if (!data || !Array.isArray(data.actions)) {
      return { ok:false, status:200, body:{ actions:[], reason:"BAD_MODEL_JSON", detail: content } };
    }
    data.actions = data.actions.slice(0, MAX_ACTIONS);
    return { ok:true, status:200, body:data };
  }
  return { ok:false, status:429, body:{ actions:[], reason:"OPENAI_RATE_LIMIT", detail:lastTxt } };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).OPENAI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ OPENAI_API_KEY: hasKey }, version:"v11.1", runtime:"edge" }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 300).trim();
    if (!prompt) return new Response(JSON.stringify({ actions:[], reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });

    const { ok, status, body } = await callOpenAI(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });

  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[], reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
