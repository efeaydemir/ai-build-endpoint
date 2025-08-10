export const config = { runtime: "edge" };

const MODEL = "llama-3.1-8b-instant";
const SYSTEM = `
You create a SMALL BUILD PLAN for a player's private Roblox plot.
Return STRICT JSON:
{
  "theme": "space|medieval|nature|city|ocean|lava|candy|desert",
  "palette": ["#RRGGBB", "..."],
  "modules": [
    {"type":"plaza","size":16},
    {"type":"tower","floors":3,"radius":4},
    {"type":"roadgrid","w":20,"h":20,"gap":10}
  ],
  "label": "2-3 words"
}
No prose. No code. Only valid JSON.
`;

export default async (req: Request) => {
  try {
    const { obs } = await req.json();
    const userPrompt = String(obs?.prompt || "").slice(0, 200);

    const llm = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY!}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `PROMPT: ${userPrompt}` }
        ]
      })
    });

    if (!llm.ok) {
      const t = await llm.text();
      return new Response(JSON.stringify({ actions:[{type:"LABEL",text:"AI busy",pos:[0,4,0]}], reason:"groq error", detail:t }), { status: 200 });
    }
    const comp = await llm.json();
    const plan = JSON.parse(comp.choices?.[0]?.message?.content || "{}");

    const actions:any[] = [];
    const palette = Array.isArray(plan.palette) ? plan.palette : ["#D0D0D0","#8A8FFF","#6CE1FF","#555555"];
    const clamp = (n:number, lo:number, hi:number)=>Math.max(lo, Math.min(hi, n));

    const plazaSize = clamp(plan.modules?.[0]?.size ?? 16, 12, 28);
    actions.push({ type:"PLACE_BLOCK", block:"Concrete", pos:[0,1,0], size:[plazaSize,1,plazaSize], color: palette[0] });
    actions.push({ type:"LABEL", text: plan.label || "AI Plaza", pos:[0,4,0] });

    for (const m of (plan.modules||[])) {
      if (m.type === "plaza") {
        const k = plazaSize/2 - 2;
        for (const [x,z] of [[k,k],[-k,k],[k,-k],[-k,-k]]) {
          actions.push({ type:"PLACE_MODEL", key:"StreetLamp", pos:[x,1,z], yaw:0 });
        }
        actions.push({ type:"PLACE_MODEL", key:"Bench", pos:[-3,1,-3], yaw:0 });
        actions.push({ type:"PLACE_MODEL", key:"Bench", pos:[3,1,3], yaw:180 });
      }
      if (m.type === "tower") {
        const floors = clamp(m.floors||3, 1, 6);
        const r = clamp(m.radius||4, 2, 8);
        for (let f=1; f<=floors; f++){
          const y = f*2;
          const count = 24;
          for (let i=0;i<count;i++){
            const a = (i/count)*Math.PI*2;
            const x = Math.cos(a)*r, z = Math.sin(a)*r;
            actions.push({ type:"PLACE_BLOCK", block:"Neon", pos:[x,y,z], size:[2,2,2], color: palette[1] });
          }
          actions.push({ type:"PLACE_BLOCK", block:"Neon", pos:[0,y+1,0], size:[2,2,2], color: palette[2] });
        }
      }
      if (m.type === "roadgrid") {
        const w = clamp(m.w||20, 8, 40), h = clamp(m.h||20, 8, 40);
        const gap = clamp(m.gap||10, 6, 20);
        for (let x=-w; x<=w; x+=gap){
          for (let z=-h; z<=h; z+=gap){
            actions.push({ type:"PLACE_BLOCK", block:"Slate", pos:[x,1,z], size:[2,0.4,2], color: palette[3] });
          }
        }
      }
    }

    if (actions.length === 0) {
      actions.push({ type:"PLACE_BLOCK", block:"Concrete", pos:[0,1,0], size:[16,1,16], color:"#D0D0D0" });
      actions.push({ type:"LABEL", text:"AI Plaza", pos:[0,4,0] });
    }

    return new Response(JSON.stringify({ actions, reason:"plan->expand" }), { status: 200 });
  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[{type:"LABEL",text:"AI error",pos:[0,4,0]}], reason:"exception", detail:String(e) }), { status: 200 });
  }
};
