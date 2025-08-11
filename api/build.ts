// api/build.ts — vG-1.4 (Gemini 1.5 Flash, minimal schema + min parts + example)
export const config = { runtime: "edge" };

const MODEL = "gemini-1.5-flash-latest";
const MAX_ACTIONS = 200;
const MAX_OUT_TOKENS = 600;
const TEMP = 0.15;

// Minimal schema (Gemini JSON mode için hafif)
const schema = {
  type: "object",
  required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        required: ["type","pos","size"],
        properties: {
          type:     { type: "string" },   // PLACE_BLOCK | PLACE_WEDGE | PLACE_CYLINDER
          pos:      { type: "array", items: { type: "number" } }, // [x,y,z]
          size:     { type: "array", items: { type: "number" } }, // [x,y,z]
          yaw:      { type: "number" },
          color:    { type: "string" },
          material: { type: "string" },
          group:    { type: "string" }
        }
      }
    }
  }
} as const;

// Sistem talimatı: minimum parça + tek kelime prompt için “küçük sahne” kuralı ve 1 örnek
const SYS = [
  "You are a ROBLOX level designer. Return ONLY JSON per schema.",
  "Units are ROBLOX studs. Origin is [0,0,0]; game offsets to player aim.",
  "Always produce at least 12 actions unless the user asks for a single primitive.",
  "If the prompt is very short (e.g., 'stone','wood'), interpret it as a theme and build a small scene:",
  "- A base plate ~[16,1,16] at y≈0.5,",
  "- 4 short pillars or some simple volumes,",
  "- Optionally a small roof (wedges) or a box.",
  "Use only simple parts: blocks (floors/walls/roof), wedges (slopes), cylinders (pillars). Keep sizes in 0.1..200.",
  "Group with short names like 'base','pillars','roof','box','house','windows'. No prose, JSON only."
].join("\n");

// Tek basit örnek (few-shot). Model buna benzer JSON döndürmeyi öğrenir.
const EXAMPLE_USER = "stone";
const EXAMPLE_JSON = JSON.stringify({
  actions: [
    { type:"PLACE_BLOCK", group:"base",   pos:[0,0.5,0],  size:[16,1,16], color:"#BEBEBE", material:"concrete" },
    { type:"PLACE_CYLINDER", group:"pillars", pos:[-6,3,-6], size:[1,6,1], material:"granite" },
    { type:"PLACE_CYLINDER", group:"pillars", pos:[ 6,3,-6], size:[1,6,1], material:"granite" },
    { type:"PLACE_CYLINDER", group:"pillars", pos:[-6,3, 6], size:[1,6,1], material:"granite" },
    { type:"PLACE_CYLINDER", group:"pillars", pos:[ 6,3, 6], size:[1,6,1], material:"granite" },
    { type:"PLACE_BLOCK", group:"box", pos:[0,3,0], size:[8,6,6], material:"smoothplastic", color:"#D0D0D0" },
    { type:"PLACE_WEDGE", group:"roof", pos:[0,7,0], size:[8,2,6], yaw:0,   material:"slate", color:"#AAAAAA" },
    { type:"PLACE_WEDGE", group:"roof", pos:[0,7,0], size:[8,2,6], yaw:180, material:"slate", color:"#AAAAAA" },
    { type:"PLACE_BLOCK", group:"details", pos:[0,1, -7.5], size:[2,2,1], material:"brick", color:"#884444" },
    { type:"PLACE_BLOCK", group:"details", pos:[0,5,  3],   size:[2,2,0.2], material:"glass", color:"#88BFFF" },
    { type:"PLACE_BLOCK", group:"details", pos:[2,5,  3],   size:[2,2,0.2], material:"glass", color:"#88BFFF" },
    { type:"PLACE_BLOCK", group:"details", pos:[-2,5, 3],   size:[2,2,0.2], material:"glass", color:"#88BFFF" }
  ]
});

async function callGeminiJSON(prompt: string) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ actions:[], reason:"NO_KEY" } };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    systemInstruction: { role: "system", parts: [{ text: SYS }] },
    contents: [
      { role: "user", parts: [{ text: EXAMPLE_USER }] },
      { role: "model", parts: [{ text: EXAMPLE_JSON }] },
      { role: "user", parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: TEMP,
      max_output_tokens: MAX_OUT_TOKENS,
      response_mime_type: "application/json",
      response_schema: schema
    }
  };

  let lastTxt = "";
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text(); lastTxt = txt;

  if (!r.ok) {
    return { ok:false, status:r.status, body:{ actions:[], reason:"GEMINI_FAIL", detail: txt.slice(0,400) } };
  }
  let j:any=null; try { j = JSON.parse(txt); } catch {}
  const textOut: string | undefined = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) return { ok:false, status:200, body:{ actions:[], reason:"NO_TEXT", detail: txt.slice(0,400) } };

  let data:any=null; try { data = JSON.parse(textOut); } catch {}
  if (!data || !Array.isArray(data.actions)) {
    return { ok:false, status:200, body:{ actions:[], reason:"BAD_MODEL_JSON", detail: textOut.slice(0,400) } };
  }

  const actions = data.actions.slice(0, MAX_ACTIONS);
  return { ok:true, status:200, body:{ actions } };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey }, version:"vG-1.4", runtime:"edge" }),
      { status:200, headers:{ "Content-Type":"application/json" } });
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
