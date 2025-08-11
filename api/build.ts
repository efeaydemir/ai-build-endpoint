// api/build.ts — vG-MEGA-2.0 (Gemini 1.5 Pro, geniş intent + çok dilli)
export const config = { runtime: "edge" };

const MODEL = (process.env as any).GEMINI_MODEL || "gemini-1.5-pro-latest";
const TEMP  = 0.15;
const TOK   = 900;

const SYS = [
  "You output ONLY JSON. No extra text.",
  "User text may be in ANY language (e.g., Turkish). Normalize meaning and choose ONE intent.",
  "Supported intents and minimal fields:",
  "- primitive: {shape:'block|cylinder|sphere|wedge', size:[x,y,z], yaw?, material?, color?}",
  "- terrain: {material:'grass|sand|water|rock|mud|snow|ground', size:[x,y,z]}",
  "- structure: {plan:{kind:'house', floors, footprint:{width,depth}, wall:{height,thickness,material,color}, door:{wall,width,height,offset}, windows:[...], roof:{type,height,overhang,material,color}}}",
  "- furniture: {furniture:{type:'chair|table|bed|sofa|desk', count}}",
  "- lights: {lights:{type:'lamp_post', count}}",
  "- waterfall: {waterfall:{width,height,poolDepth}}",
  "- setpiece: {set:{type:'galactic_base|classroom|pool|park|road|fence|tree_cluster|bridge|castle_gate|playground', scale:'small|medium|large', extra?}}",
  "Keep sizes reasonable (studs). Prefer simple numbers. Return exactly one JSON object."
].join("\n");

// few-shots (EN + TR)
const EXS: Array<[string, any]> = [
  ["stick", {intent:"primitive", shape:"cylinder", size:[1,6,1], material:"wood", color:"#C08A55"}],
  ["grass", {intent:"terrain", material:"grass", size:[24,2,24]}],
  ["add big water", {intent:"terrain", material:"water", size:[60,6,60]}],
  ["waterfall", {intent:"waterfall", waterfall:{width:24, height:20, poolDepth:4}}],
  ["galactic base", {intent:"setpiece", set:{type:"galactic_base", scale:"large"}}],
  ["classroom 4 rows", {intent:"setpiece", set:{type:"classroom", scale:"medium", extra:{rows:4, cols:4}}}],
  ["pool 12x8 depth 4", {intent:"setpiece", set:{type:"pool", scale:"medium", extra:{width:12, length:8, depth:4}}}],
  ["park with trees", {intent:"setpiece", set:{type:"park", scale:"medium", extra:{trees:8}}}],
  ["build a small house with flat roof", {intent:"structure", plan:{
    kind:"house", floors:1, footprint:{width:18, depth:14},
    wall:{height:8, thickness:0.6, material:"smoothplastic", color:"#EDEDED"},
    door:{wall:"front", width:3, height:6, offset:0},
    windows:[{wall:"front", bottom:3, height:2.5, width:2.2, count:3, spacing:3, offset:0}],
    roof:{type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0"}
  }}],
  ["çimen ser", {intent:"terrain", material:"grass", size:[24,2,24]}],
  ["beyaz düz çatılı küçük ev", {intent:"structure", plan:{
    kind:"house", floors:1, footprint:{width:16, depth:12},
    wall:{height:7, thickness:0.6, material:"smoothplastic", color:"#EDEDED"},
    door:{wall:"front", width:3, height:6, offset:0},
    windows:[{wall:"front", bottom:3, height:2, width:2, count:2, spacing:3, offset:0}],
    roof:{type:"flat", height:1, overhang:1, material:"concrete", color:"#D0D0D0"}
  }}],
  ["çit", {intent:"setpiece", set:{type:"fence", scale:"medium", extra:{length:24, height:4}}}],
  ["masa ve sandalye", {intent:"furniture", furniture:{type:"table", count:1}}],
];

async function genIntent(prompt: string) {
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
    { role:"user",  parts:[{text: prompt}] }
  ];

  const body = {
    contents,
    generationConfig: {
      temperature: TEMP,
      max_output_tokens: TOK,
      response_mime_type: "application/json"
    }
  };

  const r   = await fetch(url, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) return { ok:false, status:r.status, body:{ reason:"GEMINI_FAIL", detail: txt.slice(0,500) } };

  let j:any=null; try { j = JSON.parse(txt) } catch {}
  const jsonText = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return { ok:false, status:200, body:{ reason:"NO_TEXT" } };

  let data:any=null; try { data = JSON.parse(jsonText) } catch {}
  if (!data || !data.intent) return { ok:false, status:200, body:{ reason:"BAD_JSON", detail: jsonText.slice(0,500) } };

  // clamps (sunucu tarafı da ayrıca kontrol ediyor)
  const clamp = (n:number,a:number,b:number)=>Math.max(a,Math.min(b,Number(n||0)));
  if (Array.isArray(data.size)) {
    data.size = [ clamp(data.size[0],1,250), clamp(data.size[1],1,80), clamp(data.size[2],1,250) ];
  }
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
    return new Response(JSON.stringify({ ok:true, env:{ GEMINI_API_KEY: hasKey, MODEL }, version:"vG-MEGA-2.0", runtime:"edge" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0,500).trim();
    if (!prompt) return new Response(JSON.stringify({ reason:"EMPTY" }), { status:200, headers:{ "Content-Type":"application/json" } });
    const { ok, status, body } = await genIntent(prompt);
    return new Response(JSON.stringify(body), { status: ok ? 200 : status, headers:{ "Content-Type":"application/json" } });
  } catch (e:any) {
    return new Response(JSON.stringify({ reason:"exception", detail:String(e?.stack || e) }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
};
