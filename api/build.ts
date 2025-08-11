// api/build.ts — vG-MEGA-3.0 (Gemini open-vocab with SYNTH fallback + diversity seed)
export const config = { runtime: "edge" };

const MODEL = (process.env as any).GEMINI_MODEL || "gemini-1.5-pro-latest";
const TEMP_BASE  = 0.25;
const TOK        = 900;

function pickTemp(text: string) {
  // If looks unknown/short/single word → allow more creativity
  const wc = (text || "").trim().split(/\s+/).length;
  return wc <= 2 ? Math.min(0.45, TEMP_BASE + 0.15) : TEMP_BASE;
}

const SYS = [
  "You output ONLY JSON. No extra text.",
  "User text may be ANY language. Normalize meaning and choose ONE intent.",
  "If the concept is unknown or not directly buildable, you MUST return intent:'synth' (see schema). Never leave empty.",
  "Supported intents:",
  "- primitive: {shape:'block|cylinder|sphere|wedge', size:[x,y,z], yaw?, material?, color?}",
  "- terrain:   {material:'grass|sand|water|rock|mud|snow|ground', size:[x,y,z]}",
  "- structure: {plan:{kind:'house', floors, footprint:{width,depth}, wall:{height,thickness,material,color}, door:{wall,width,height,offset}, windows:[...], roof:{type,height,overhang,material,color}}}",
  "- furniture: {furniture:{type:'chair|table|bed|sofa|desk|bookshelf', count}}",
  "- lights:    {lights:{type:'lamp_post', count}}",
  "- waterfall: {waterfall:{width,height,poolDepth}}",
  "- setpiece:  {set:{type:'road|roundabout|tree_cluster|stairs|bridge|park|garden|fountain|pool|classroom|castle_gate|tower|arch', scale:'small|medium|large', extra?}}",
  "- synth:     {synth:{type:'symbolic_sign|text_extrude|abstract_sculpture|footprint_trail|pattern_tile|decal_field', text?, theme?, size?, length?, steps?, seed?}}",
  "DIVERSITY: The prompt may start with [DIVERSITY_SEED:N]. Use N to pick different variants deterministically:",
  "  let v = N % 7;",
  "  v=0→theme:modern, v=1→rustic, v=2→industrial, v=3→tropical, v=4→scifi, v=5→medieval, v=6→wildcard.",
  "  For synth.type choose by N%6: 0 sign, 1 text_extrude, 2 abstract_sculpture, 3 footprint_trail, 4 pattern_tile, 5 random.",
  "Always infer scale/count/color/material hints from text. Clamp sizes to reasonable Roblox studs. Return exactly one JSON object.",
  "NEVER return an empty/irrelevant stub. If wording is ambiguous (e.g., 'feet'), prefer synth types that make sense (e.g., footprint_trail).",
].join("\n");

// Few-shot short set (kept minimal; model generalizes)
const EXS: Array<[string, any]> = [
  ["stick", {intent:"primitive", shape:"cylinder", size:[1,6,1], material:"wood", color:"#C08A55"}],
  ["grass", {intent:"terrain", material:"grass", size:[24,2,24]}],
  ["stairs 12", {intent:"setpiece", set:{type:"stairs", scale:"medium", extra:{steps:12, width:6, height:6}}}],
  ["feet", {intent:"synth", synth:{type:"footprint_trail", length:24, steps:16}}]
];

function clamp(n:number,a:number,b:number){ return Math.max(a,Math.min(b,Number(n||0))); }

async function genIntent(promptRaw: string) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ reason:"NO_KEY" } };

  // Extract diversity seed if present
  const m = promptRaw.match(/\[DIVERSITY_SEED:(\d+)\]/i);
  const seed = m ? Number(m[1]) : Math.floor(Math.random()*1e9);
  const prompt = promptRaw.replace(/\[DIVERSITY_SEED:\d+\]\s*/i, "");

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const contents = [
    { role:"user",  parts:[{text: SYS}] },
    { role:"model", parts:[{text: "OK"}] },
    ...EXS.flatMap(([u, j]) => ([
      { role:"user",  parts:[{text:String(u)}] },
      { role:"model", parts:[{text: JSON.stringify(j)}] }
    ])),
    { role:"user",  parts:[{text: `[DIVERSITY_SEED:${seed}] ${prompt}`}] }
  ];

  const body = {
    contents,
    generationConfig: {
      temperature: pickTemp(prompt),
      maxOutputTokens: TOK,
      responseMimeType: "application/json"
    }
  };

  const r   = await fetch(url, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) return { ok:false, status:r.status, body:{ reason:"GEMINI_FAIL", detail: txt.slice(0,500) } };

  let j:any=null; try { j = JSON.parse(txt) } catch {}
  const jsonText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return { ok:false, status:200, body:{ reason:"NO_TEXT" } };

  let data:any=null; try { data = JSON.parse(jsonText) } catch {}
  if (!data || !data.intent) {
    // force synth if model drifted
    data = { intent:"synth", synth:{ type:"symbolic_sign", text: prompt, seed: seed } };
  }

  // Basic clamps
  if (Array.isArray(data.size)) data.size = [ clamp(data.size[0],1,250), clamp(data.size[1],1,80), clamp(data.size[2],1,250) ];
  if (data.waterfall) {
    data.waterfall.width     = clamp(data.waterfall.width,  6, 140);
    data.waterfall.height    = clamp(data.waterfall.height, 8,  90);
    data.waterfall.poolDepth = clamp(data.waterfall.poolDepth, 2, 12);
  }
  if (data.plan) {
    const p = data.plan;
    p.floors = clamp(p.floors||1, 1, 3);
    p.footprint = { width: clamp(p?.footprint?.width, 8, 80), depth: clamp(p?.footprint?.depth, 8, 80) };
    const wh = clamp(p?.wall?.height, 4, 18);
    const wt = clamp(p?.wall?.thickness, 0.3, 1.8);
    p.wall = { height:wh, thickness:wt, material:String(p?.wall?.material||"smoothplastic"), color:String(p?.wall?.color||"#EDEDED") };
    p.roof = p.roof || { type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0" };
    p.door = p.door || { wall:"front", width:3, height:6, offset:0 };
    p.windows = Array.isArray(p.windows) ? p.windows : [];
  }
  if (data.synth) {
    const s = data.synth;
    if (s.length) s.length = clamp(s.length, 6, 140);
    if (s.steps)  s.steps  = clamp(s.steps,  4, 80);
    if (Array.isArray(s.size)) s.size = [ clamp(s.size[0],6,120), clamp(s.size[1],1,40), clamp(s.size[2],6,120) ];
    if (!s.text) s.text = prompt.slice(0,40);
    s.seed = seed;
  }

  // Attach diagnostics (optional)
  (data as any)._seed = seed;

  return { ok:true, status:200, body:data };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey, MODEL }, version:"vG-MEGA-3.0", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0,600).trim();
    if (!prompt) return new Response(JSON.stringify({ reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });

    const { ok, status, body } = await genIntent(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
