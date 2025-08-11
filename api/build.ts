// api/build.ts — vPLAN-2 (Gemini → house plan JSON, no schema to avoid 400s)
export const config = { runtime: "edge" };

const MODEL = "gemini-1.5-flash-latest";
const TEMP = 0.15;
const MAX_OUT_TOKENS = 600;

const SYS = [
  "You are a ROBLOX level designer's planning assistant.",
  "Output ONLY compact JSON with a single top-level key: plan.",
  "The plan describes a small building (house/shed/pavilion) using studs.",
  "Keep numbers reasonable: footprint width/depth 8..60, wall height 4..16, thickness 0.3..1.5.",
  "Walls are axis-aligned rectangle perimeter. Door and windows go on walls (front/back/left/right).",
  "If prompt is short (e.g., 'stone', 'wood'), treat as theme and still return a nice small house plan.",
  "No prose, no markdown, JSON only."
].join("\n");

const EXAMPLE_USER = "small white house with flat roof and many windows";
const EXAMPLE_PLAN = {
  plan: {
    kind: "house",
    floors: 1,
    footprint: { width: 18, depth: 14 },
    wall: { height: 8, thickness: 0.6, material: "smoothplastic", color: "#EDEDED" },
    door: { wall: "front", width: 3, height: 6.5, offset: 0 },
    windows: [
      { wall: "front", bottom: 3, height: 2.5, width: 2.2, count: 2, spacing: 3, offset: -4 },
      { wall: "front", bottom: 3, height: 2.5, width: 2.2, count: 2, spacing: 3, offset:  4 },
      { wall: "left",  bottom: 3, height: 2.2, width: 2.0, count: 2, spacing: 4, offset: 0 }
    ],
    roof: { type: "flat", height: 1, overhang: 1, material: "concrete", color: "#D0D0D0" },
    palette: { glass: "#88BFFF" }
  }
};

async function callGemini(prompt: string) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ plan:null, reason:"NO_KEY" } };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    systemInstruction: { role: "system", parts: [{ text: SYS }] },
    contents: [
      { role: "user",  parts: [{ text: EXAMPLE_USER }] },
      { role: "model", parts: [{ text: JSON.stringify(EXAMPLE_PLAN) }] },
      { role: "user",  parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: TEMP,
      max_output_tokens: MAX_OUT_TOKENS,
      response_mime_type: "application/json"
    }
  };

  const r = await fetch(url, { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) return { ok:false, status:r.status, body:{ plan:null, reason:"GEMINI_FAIL", detail: txt.slice(0,400) } };

  let j:any=null; try { j = JSON.parse(txt) } catch {}
  const jsonText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return { ok:false, status:200, body:{ plan:null, reason:"NO_TEXT" } };

  let data:any=null; try { data = JSON.parse(jsonText) } catch {}
  if (!data || !data.plan) return { ok:false, status:200, body:{ plan:null, reason:"BAD_JSON", detail: jsonText.slice(0,400) } };

  // Clamp basics just in case
  const p = data.plan;
  p.floors = Math.max(1, Math.min(3, Number(p.floors || 1)));
  p.footprint = { width: Math.max(8, Math.min(60, Number(p?.footprint?.width || 18))),
                  depth: Math.max(8, Math.min(60, Number(p?.footprint?.depth || 14))) };
  const wh = Math.max(4, Math.min(16, Number(p?.wall?.height || 8)));
  const wt = Math.max(0.3, Math.min(1.5, Number(p?.wall?.thickness || 0.6)));
  p.wall = { height: wh, thickness: wt, material: String(p?.wall?.material || "smoothplastic"), color: String(p?.wall?.color || "#EDEDED") };
  p.roof = p.roof || { type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0" };
  p.door = p.door || { wall:"front", width:3, height:6, offset:0 };
  p.windows = Array.isArray(p.windows) ? p.windows : [];

  return { ok:true, status:200, body: { plan: p } };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey }, version:"vPLAN-2", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0,400).trim();
    if (!prompt) return new Response(JSON.stringify({ plan:null, reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });
    const { ok, status, body } = await callGemini(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ plan:null, reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
