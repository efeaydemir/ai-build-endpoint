// api/build.ts — vG-MEGA-2.4  (diversity seed + stairs example + higher temp)
export const config = { runtime: "edge" };

const MODEL = (process.env as any).GEMINI_MODEL || "gemini-1.5-pro-latest";
const TEMP  = 0.35;           // ↑ a little more variety
const TOK   = 900;

const SYS = [
  "You output ONLY JSON. No extra text.",
  "User text may be in ANY language.",
  "Understand units/dimensions like '20x15 ft', '10m', '6 m x 4 m'. Convert to studs (1 stud = 1 foot).",
  "If dimensions exist, map them to footprint/size.",
  "If [DIVERSITY_SEED:N] is present, allow small randomized style differences each call.",
  "Supported intents:",
  "- primitive: {shape:'block|cylinder|sphere|wedge', size:[x,y,z], yaw?, material?, color?}",
  "- terrain:   {material:'grass|sand|water|rock|mud|snow|ground', size:[x,y,z]}",
  "- structure: {plan:{kind:'house', floors, footprint:{width,depth}, wall:{height,thickness,material,color}, door:{wall,width,height,offset}, windows:[...], roof:{type,height,overhang,material,color}}}",
  "- furniture: {furniture:{type:'chair|table|bed|sofa|desk|bookshelf', count}}",
  "- lights:    {lights:{type:'lamp_post', count}}",
  "- waterfall: {waterfall:{width,height,poolDepth}}",
  "- setpiece:  {set:{type:'park|road|intersection|fence|tree_cluster|bridge|castle_gate|playground|garden|fountain|tower|arch|stairs|roundabout|parking|tree_single', scale:'small|medium|large', extra?}}",
  "Return exactly one JSON object."
].join("\n");

function normalizeUnits(src: string): string {
  return String(src || "").replace(/[xX*×]/g, "x");
}

const EXS: Array<[string, any]> = [
  ["stick", {intent:"primitive", shape:"cylinder", size:[1,6,1], material:"wood", color:"#C08A55"}],
  ["grass", {intent:"terrain", material:"grass", size:[24,2,24]}],
  ["waterfall", {intent:"waterfall", waterfall:{width:24, height:20, poolDepth:4}}],
  ["stairs 14 steps", {intent:"setpiece", set:{type:"stairs", scale:"medium", extra:{steps:14, width:6, height:7, run:1.5}}}],
  ["roundabout", {intent:"setpiece", set:{type:"roundabout", scale:"medium", extra:{radius:12}}}],
  ["parking", {intent:"setpiece", set:{type:"parking", scale:"medium", extra:{width:30, depth:20}}}],
  ["trees", {intent:"setpiece", set:{type:"tree_cluster", scale:"medium", extra:{count:12, radius:18}}}],
  ["house 30x20 ft gable", {intent:"structure", plan:{
    kind:"house", floors:1, footprint:{width:30, depth:20},
    wall:{height:8, thickness:0.6, material:"smoothplastic", color:"#EDEDED"},
    door:{wall:"front", width:3, height:6, offset:0},
    windows:[{wall:"front", bottom:3, height:2.5, width:2.2, count:3, spacing:3, offset:0}],
    roof:{type:"gable", height:2, overhang:1, material:"concrete", color:"#D0D0D0"}
  }}],
  ["house 10m x 8m flat", {intent:"structure", plan:{
    kind:"house", floors:1, footprint:{width:32.8084, depth:26.2467},
    wall:{height:8, thickness:0.6, material:"smoothplastic", color:"#EDEDED"},
    door:{wall:"front", width:3, height:6, offset:0},
    windows:[{wall:"front", bottom:3, height:2.5, width:2.2, count:3, spacing:3, offset:0}],
    roof:{type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0"}
  }}],
];

async function genIntent(prompt: string, rndSeed: number) {
  const key = (process.env as any).GEMINI_API_KEY;
  if (!key) return { ok:false, status:500, body:{ reason:"NO_KEY" } };

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const contents = [
    { role:"user",  parts:[{text: SYS}] },
    { role:"model", parts:[{text: "OK"}] },
    ...EXS.flatMap(([u, j]) => ([
      { role:"user",  parts:[{text:String(u)}] },
      { role:"model", parts:[{text: JSON.stringify(j)}] }
    ])),
    { role:"user",  parts:[{text: normalizeUnits(`[DIVERSITY_SEED:${rndSeed}] ` + prompt)}] }
  ];

  const body = { contents, generationConfig: { temperature: TEMP, maxOutputTokens: TOK, responseMimeType: "application/json" } };
  const r   = await fetch(url, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) return { ok:false, status:r.status, body:{ reason:"GEMINI_FAIL", detail: txt.slice(0,500) } };

  let j:any=null; try { j = JSON.parse(txt) } catch {}
  const jsonText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return { ok:false, status:200, body:{ reason:"NO_TEXT" } };

  let data:any=null; try { data = JSON.parse(jsonText) } catch {}
  if (!data || !data.intent) return { ok:false, status:200, body:{ reason:"BAD_JSON", detail: jsonText.slice(0,500) } };

  // clamps
  const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,Number(n||0)));
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

  return { ok:true, status:200, body:data };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    const hasKey = Boolean((process.env as any).GEMINI_API_KEY);
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey, MODEL }, version:"vG-MEGA-2.4", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }
  try {
    const { obs } = await req.json();
    const prompt  = String(obs?.prompt || "").slice(0,500).trim();
    const rnd     = Number(obs?.rnd || Math.floor(Math.random()*1e9));
    if (!prompt) return new Response(JSON.stringify({ reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });
    const { ok, status, body } = await genIntent(prompt, rnd);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
