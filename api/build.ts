// api/build.ts — v4: özgür DSL + genişletme + limitler
export const config = { runtime: "edge" };

const MODEL = "llama-3.1-8b-instant";

// LLM'e sadece bir "program" yazdırıyoruz (sıkı JSON). Çok sayıda OP var.
const SYSTEM = `
You output a STRICT JSON "program" for a Roblox world builder.
Return ONLY:
{
  "label":"2-3 words",
  "palette":["#RRGGBB","#RRGGBB","#RRGGBB"],
  "program":[
    {"op":"PLAZA","size":18,"color":"#2D2F5F"},
    {"op":"ROADGRID","w":22,"h":18,"gap":8,"width":2},
    {"op":"TOWER","floors":3,"radius":4},
    {"op":"MODEL","key":"StreetLamp","pos":[8,1,-8],"yaw":0},
    {"op":"LINE","from":[-10,0],"to":[10,0],"height":1,"width":2,"block":"Slate","color":"#666666"}
  ]
}
Allowed ops:
- PLAZA {size,color}
- ROADGRID {w,h,gap,width}
- RIVER {length,width}
- BRIDGE {length,width,arch}
- TOWER {floors,radius}
- PYRAMID {base,levels}
- DOME {radius}
- HOUSES {rows,cols,minH,maxH}
- TREES {count,ringR}
- LINE {from:[x,z], to:[x,z], width, height, block, color}
- RING {r, height, step, block, color}
- DISC {r, thickness, block, color}
- SPIRAL {r, turns, step, height, block, color}
- MODEL {key, pos:[x,y,z], yaw}
- LABEL {text}

Allowed MODEL keys: StreetLamp, Bench  (more can be added later).
Keep counts small (program <= 30 steps). No prose, no extra keys.

Examples:

USER: "orta çağ şehir kapısı, duvar, birkaç ev"
PROGRAM: {"label":"Old Gate","palette":["#C2B280","#8A7B66","#6B6B6B"],"program":[
  {"op":"PLAZA","size":18,"color":"#C2B280"},
  {"op":"ROADGRID","w":20,"h":16,"gap":8,"width":2},
  {"op":"LINE","from":[-12,-8],"to":[12,-8],"width":2,"height":6,"block":"Rock","color":"#6B6B6B"},
  {"op":"GATE","width":10,"height":9,"thickness":2},
  {"op":"HOUSES","rows":2,"cols":4,"minH":2,"maxH":4},
  {"op":"LABEL","text":"Old Gate"}
]}

USER: "doğa parkı, büyük göl ve köprü"
PROGRAM: {"label":"Green Park","palette":["#98C379","#2C6E49","#6B8E23"],"program":[
  {"op":"PLAZA","size":16,"color":"#98C379"},
  {"op":"RIVER","length":46,"width":10},
  {"op":"BRIDGE","length":12,"width":3,"arch":2},
  {"op":"TREES","count":20,"ringR":16},
  {"op":"LABEL","text":"Green Park"}
]}

USER: "uzay temalı kubbe şehir"
PROGRAM: {"label":"Lunar Dome","palette":["#2D2F5F","#7F89FF","#6CE1FF"],"program":[
  {"op":"PLAZA","size":18,"color":"#2D2F5F"},
  {"op":"ROADGRID","w":22,"h":18,"gap":8,"width":2},
  {"op":"DOME","radius":8},
  {"op":"RING","r":10,"height":2,"step":3,"block":"Neon","color":"#7F89FF"},
  {"op":"LABEL","text":"Lunar Dome"}
]}
`;

const clamp = (n:number, lo:number, hi:number)=>Math.max(lo, Math.min(hi, n));
const palDefault = ["#D0D0D0","#8A8FFF","#6CE1FF"];
const safeColor = (s?:string)=> /^#?[0-9a-fA-F]{6}$/.test(String(s||"")) ? (s![0]==="#"?s:"#"+s) : "#D0D0D0";

type Act = { type:string; [k:string]:any };
const MAX_ACTIONS = 400;

function expand(program:any[], palette:string[]) {
  const acts:Act[] = [];
  const pal = palette?.length?palette:palDefault;

  const addPlaza=(size:number,color?:string)=>{
    const c = safeColor(color||pal[0]);
    acts.push({type:"PLACE_BLOCK", block:"Concrete", pos:[0,1,0], size:[size,1,size], color:c});
    const k=size/2 - 2;
    for (const [x,z] of [[k,k],[-k,k],[k,-k],[-k,-k]] as const)
      acts.push({type:"PLACE_MODEL", key:"StreetLamp", pos:[x,1,z], yaw:0});
  };

  const addRoadGrid=(w:number,h:number,gap:number,width:number)=>{
    for (let x=-w; x<=w; x+=gap) acts.push({type:"PLACE_BLOCK", block:"Slate", pos:[x,1,0], size:[width,0.4,h*2+width], color:pal[2]});
    for (let z=-h; z<=h; z+=gap) acts.push({type:"PLACE_BLOCK", block:"Slate", pos:[0,1,z], size:[w*2+width,0.4,width], color:pal[2]});
  };

  const addLine=(from:[number,number], to:[number,number], width:number, height:number, block:string, color?:string)=>{
    const p1 = {x:from[0], z:from[1]}, p2 = {x:to[0], z:to[1]};
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.max(1, Math.floor(Math.sqrt(dx*dx + dz*dz)));
    const steps = Math.ceil(len / 2);
    for (let i=0;i<=steps;i++){
      const t = i/steps; const x = p1.x + dx*t; const z = p1.z + dz*t;
      acts.push({type:"PLACE_BLOCK", block:block||"Slate", pos:[x,1,z], size:[width,height,width], color:safeColor(color||pal[1])});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addRing=(r:number, height:number, step:number, block:string, color?:string)=>{
    const count = Math.max(6, Math.floor((Math.PI*2*r)/Math.max(1,step)));
    for (let i=0;i<count;i++){
      const a = (i/count)*Math.PI*2, x=Math.cos(a)*r, z=Math.sin(a)*r;
      acts.push({type:"PLACE_BLOCK", block:block||"Neon", pos:[x,height||1,z], size:[2,2,2], color:safeColor(color||pal[1])});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addDisc=(r:number, thick:number, block:string, color?:string)=>{
    const step = 2;
    for (let x=-r; x<=r; x+=step){
      for (let z=-r; z<=r; z+=step){
        if (x*x + z*z <= r*r) {
          acts.push({type:"PLACE_BLOCK", block:block||"Concrete", pos:[x,1,z], size:[step,thick||1,step], color:safeColor(color||pal[0])});
          if (acts.length > MAX_ACTIONS) break;
        }
      }
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addSpiral=(r:number, turns:number, step:number, height:number, block:string, color?:string)=>{
    const total = Math.max(12, Math.floor(turns*360/Math.max(1,step)));
    for (let i=0;i<=total;i++){
      const t = i/total; const ang = t*turns*Math.PI*2; const rr = r*t;
      const x = Math.cos(ang)*rr, z = Math.sin(ang)*rr; const y = 1 + (height||0)*t;
      acts.push({type:"PLACE_BLOCK", block:block||"Neon", pos:[x,y,z], size:[2,2,2], color:safeColor(color||pal[1])});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addTower=(floors:number, radius:number)=>{
    for (let f=1; f<=floors; f++){
      const y=f*2; const count=24;
      for (let i=0;i<count;i++){
        const a=(i/count)*Math.PI*2, x=Math.cos(a)*radius, z=Math.sin(a)*radius;
        acts.push({type:"PLACE_BLOCK", block:"Neon", pos:[x,y,z], size:[2,2,2], color:pal[1]});
      }
      acts.push({type:"PLACE_BLOCK", block:"Neon", pos:[0,y+1,0], size:[2,2,2], color:pal[2]});
    }
  };

  const addPyramid=(base:number, levels:number)=>{
    let s=base; for (let i=0;i<levels;i++){ acts.push({type:"PLACE_BLOCK", block:"Rock", pos:[0,1+i,0], size:[s,1,s], color:"#C2B280"}); s-=2; if(s<=2)break; }
  };

  const addDome=(radius:number)=>{ addRing(radius, 2, 3, "Neon", pal[1]); addRing(Math.max(2, radius-3), 4, 3, "Neon", pal[2]); };

  const addHouses=(rows:number, cols:number, minH:number, maxH:number)=>{
    const spacing=6, startX = -((cols-1)*spacing)/2, startZ=12;
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
      const h = Math.round(clamp(minH,1,4) + (c%2)*(clamp(maxH,2,8)-clamp(minH,1,4)));
      const x = startX + c*spacing, z = startZ + r*spacing;
      acts.push({type:"PLACE_BLOCK", block:"SmoothPlastic", pos:[x,1,z], size:[4,h,4], color:pal[0]});
      acts.push({type:"PLACE_BLOCK", block:"Rock", pos:[x,h+1,z], size:[4,1,4], color:"#6B4F2A"});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addTrees=(count:number, ringR:number)=>{
    for (let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2, x=Math.cos(a)*ringR, z=Math.sin(a)*ringR;
      acts.push({type:"PLACE_BLOCK", block:"Rock", pos:[x,1,z], size:[1,3,1], color:"#6B4F2A"});
      acts.push({type:"PLACE_BLOCK", block:"Grass", pos:[x,3.5,z], size:[3,3,3], color:"#3BAA3B"});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  const addRiver=(length:number, width:number)=>{
    acts.push({type:"TERRAIN_BOX", material:"Grass", min:[-length/2,0,-width/2], max:[length/2,0.2,width/2]});
  };

  const addBridge=(len:number, w:number, arch:number)=>{
    for (let x=-Math.floor(len/2); x<=Math.floor(len/2); x+=2){
      const y = Math.max(1, Math.round(Math.sin((x/len)*Math.PI)*arch)+1);
      acts.push({type:"PLACE_BLOCK", block:"Rock", pos:[x,y,0], size:[2,1,w], color:pal[0]});
      if (acts.length > MAX_ACTIONS) break;
    }
  };

  for (const step of (program||[])) {
    if (acts.length > MAX_ACTIONS) break;
    switch (step.op) {
      case "PLAZA": addPlaza(clamp(step.size??16,12,30), step.color); break;
      case "ROADGRID": addRoadGrid(clamp(step.w??20,10,40), clamp(step.h??20,10,40), clamp(step.gap??8,6,20), clamp(step.width??2,2,6)); break;
      case "RIVER": addRiver(clamp(step.length??40,20,80), clamp(step.width??8,3,14)); break;
      case "BRIDGE": addBridge(clamp(step.length??12,6,24), clamp(step.width??3,2,6), clamp(step.arch??2,0,6)); break;
      case "TOWER": addTower(clamp(step.floors??3,1,8), clamp(step.radius??4,2,10)); break;
      case "PYRAMID": addPyramid(clamp(step.base??16,8,32), clamp(step.levels??6,3,12)); break;
      case "DOME": addDome(clamp(step.radius??6,4,14)); break;
      case "HOUSES": addHouses(clamp(step.rows??2,1,3), clamp(step.cols??4,2,8), clamp(step.minH??2,1,4), clamp(step.maxH??4,2,8)); break;
      case "TREES": addTrees(clamp(step.count??16,6,60), clamp(step.ringR??14,8,30)); break;
      case "LINE": addLine(step.from||[0,0], step.to||[0,0], clamp(step.width??2,1,8), clamp(step.height??1,1,8), step.block||"Slate", step.color); break;
      case "RING": addRing(clamp(step.r??8,2,40), clamp(step.height??1,0,20), clamp(step.step??3,1,20), step.block||"Neon", step.color); break;
      case "DISC": addDisc(clamp(step.r??8,2,30), clamp(step.thickness??1,1,6), step.block||"Concrete", step.color); break;
      case "SPIRAL": addSpiral(clamp(step.r??10,4,40), clamp(step.turns??2,1,6), clamp(step.step??6,2,20), clamp(step.height??8,0,40), step.block||"Neon", step.color); break;
      case "MODEL":
        acts.push({type:"PLACE_MODEL", key:String(step.key||"StreetLamp"), pos:Array.isArray(step.pos)?step.pos:[0,1,0], yaw: Math.floor(Number(step.yaw||0))});
        break;
      case "LABEL": acts.push({type:"LABEL", text:String(step.text||"AI World"), pos:[0,5,0]}); break;
    }
  }

  return acts;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok:true, msg:"POST { obs:{ prompt:'...' } } bekleniyor" }), { status:200, headers:{"Content-Type":"application/json"} });
  }
  try {
    const { obs } = await req.json();
    const prompt = String(obs?.prompt || "").slice(0, 250);

    // 1) LLM: program üret
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY!}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL, temperature: 0.25, response_format:{ type:"json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt }
        ]
      })
    });

    let plan:any = { label:"AI Plaza", palette: palDefault, program:[] };
    if (r.ok) {
      const j = await r.json();
      plan = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    }

    // 2) Varsayılanlar
    const program = Array.isArray(plan.program) && plan.program.length ? plan.program : [
      {op:"PLAZA", size:16, color:"#D0D0D0"},
      {op:"ROADGRID", w:20, h:18, gap:8, width:2},
      {op:"LABEL", text:"AI Plaza"}
    ];
    const palette = Array.isArray(plan.palette)&&plan.palette.length ? plan.palette : palDefault;
    const label = typeof plan.label === "string" ? plan.label.slice(0,24) : "AI World";

    // 3) Genişlet → actions
    const actions = expand(program, palette);
    actions.push({ type:"LABEL", text:label, pos:[0,5,0] });

    return new Response(JSON.stringify({ actions, reason:"v4 free-dsl expand" }), { status:200, headers:{"Content-Type":"application/json"}});
  } catch (e:any) {
    return new Response(JSON.stringify({ actions:[{type:"LABEL",text:"AI error",pos:[0,4,0]}], reason:"exception", detail:String(e)}), { status:200, headers:{"Content-Type":"application/json"}});
  }
};
