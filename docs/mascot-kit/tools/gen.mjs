// Generates all mascot SVGs + Mascot.tsx. Run: node tools/gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INK='#2B1B12', ORANGE='#F07A3C', CREAM='#FFF8EC', PINK='#F2B8C6', GOLD='#F6C45E', GREEN='#7DAF63', WHITE='#FFFFFF';

function rng(seed){let a=seed*2654435761>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const f=n=>Math.round(n*10)/10;
function smooth(p,closed){
  const n=p.length;let d=`M${f(p[0][0])} ${f(p[0][1])}`;
  const g=i=>closed?p[(i+n)%n]:p[Math.max(0,Math.min(n-1,i))];
  const segs=closed?n:n-1;
  for(let i=0;i<segs;i++){const p0=g(i-1),p1=g(i),p2=g(i+1),p3=g(i+2);
    d+=`C${f(p1[0]+(p2[0]-p0[0])/6)} ${f(p1[1]+(p2[1]-p0[1])/6)} ${f(p2[0]-(p3[0]-p1[0])/6)} ${f(p2[1]-(p3[1]-p1[1])/6)} ${f(p2[0])} ${f(p2[1])}`;}
  return d+(closed?'Z':'');
}
function blob(cx,cy,rx,ry,seed,j=1,n=14){const r=rng(seed);const p=[];const off=r()*6;
  for(let i=0;i<n;i++){const a=off+i/n*Math.PI*2;p.push([cx+Math.cos(a)*(rx+(r()-.5)*2*j),cy+Math.sin(a)*(ry+(r()-.5)*2*j)]);}
  return smooth(p,true);}
function rrectPts(x,y,w,h,r,seed,j=1.4,topOnly=false){
  const R=rng(seed),J=()=>(R()-.5)*2*j,p=[];const k=r*(1-Math.SQRT1_2);
  const edge=(ax,ay,bx,by)=>{const L=Math.hypot(bx-ax,by-ay);const m=Math.max(1,Math.round(L/70));for(let i=1;i<=m;i++){const t=i/(m+1);p.push([ax+(bx-ax)*t+J(),ay+(by-ay)*t+J()]);}};
  // clockwise from top-left corner
  p.push([x+J()*.4,y+r],[x+k+J()*.4,y+k+J()*.4],[x+r,y+J()*.4]);
  edge(x+r,y,x+w-r,y);
  p.push([x+w-r,y+J()*.4],[x+w-k+J()*.4,y+k+J()*.4],[x+w+J()*.4,y+r]);
  edge(x+w,y+r,x+w,y+h-r);
  p.push([x+w+J()*.4,y+h-r],[x+w-k+J()*.4,y+h-k+J()*.4],[x+w-r,y+h+J()*.4]);
  edge(x+w-r,y+h,x+r,y+h);
  p.push([x+r,y+h+J()*.4],[x+k+J()*.4,y+h-k+J()*.4],[x+J()*.4,y+h-r]);
  edge(x,y+h-r,x,y+r);
  return p;}
const rrect=(x,y,w,h,r,s,j)=>smooth(rrectPts(x,y,w,h,r,s,j),true);
function wline(pts,seed,j=.7){const R=rng(seed);return smooth(pts.map(([x,y],i)=>(i===0||i===pts.length-1)?[x,y]:[x+(R()-.5)*2*j,y+(R()-.5)*2*j]),false);}

const SW=3.4;
const st=(w=SW)=>`stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const P=(d,fill='none',w=SW,extra='')=>`<path d="${d}" fill="${fill}" ${fill==='none'&&w===0?'':st(w)} ${extra}/>`;
const G=(id,inner,extra='')=>`<g id="${id}" class="ct-${id}" ${extra}>${inner}</g>`;
const circ=(cx,cy,r,seed,fill=WHITE,w=2.8)=>P(blob(cx,cy,r,r,seed,.6,10),fill,w);
const hand=(cx,cy,seed)=>circ(cx,cy,8.5,seed);
const sparkle=(cx,cy,s,fill=ORANGE,rot=0)=>`<path d="M${cx} ${cy-s}Q${cx+s*.18} ${cy-s*.18} ${cx+s} ${cy}Q${cx+s*.18} ${cy+s*.18} ${cx} ${cy+s}Q${cx-s*.18} ${cy+s*.18} ${cx-s} ${cy}Q${cx-s*.18} ${cy-s*.18} ${cx} ${cy-s}Z" fill="${fill}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" ${rot?`transform="rotate(${rot} ${cx} ${cy})"`:''}/>`;
const heart=(cx,cy,s)=>`<path d="M${cx} ${cy+s}C${cx-s*1.6} ${cy-s*.1} ${cx-s*.7} ${cy-s*1.1} ${cx} ${cy-s*.35}C${cx+s*.7} ${cy-s*1.1} ${cx+s*1.6} ${cy-s*.1} ${cx} ${cy+s}Z" fill="${ORANGE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;

// ---- body parts (reference coordinate space) ----
const BODY={x:60,y:158,w:275,h:220,r:26};
const bodyD=rrect(BODY.x,BODY.y,BODY.w,BODY.h,BODY.r,11,1.5);
const tabD=smooth(rrectPts(76,120,116,60,15,5,1.1),true);
const shadow=(sx=1)=>G('shadow',`<ellipse cx="195" cy="428" rx="${108*sx}" ry="9" fill="${INK}" opacity=".16"/>`);
function feet(dy=0){return G('feet',
  G('foot-left',P(wline([[150,378],[150,396+dy],[149,402+dy]],21,.5),'none')+P(blob(130,412+dy,24,11,31,1),ORANGE),'')+
  G('foot-right',P(wline([[250,378],[251,396+dy],[252,402+dy]],22,.5),'none')+P(blob(262,412+dy,24,11,32,1),ORANGE),''));}
const tab=()=>G('tab',
  `<path d="${tabD}" fill="${ORANGE}" transform="translate(7 4)"/>`+P(tabD,CREAM)+
  P(blob(100,143,7.5,7.5,41,.5,10),ORANGE,2.8)+
  P(wline([[158,133],[171,146]],42,.3),'none',2.8)+P(wline([[171,133],[158,146]],43,.3),'none',2.8));
const body=()=>G('body',`<path d="${bodyD}" fill="${ORANGE}" transform="translate(9 8)"/>`+P(bodyD,CREAM));
// face pieces
const EL={x:146,y:252,rx:28,ry:34}, ER={x:246,y:250,rx:26,ry:32};
function eyeOpen(e,seed,look=[6,5],lid=0){
  const wh=P(blob(e.x,e.y,e.rx,e.ry,seed,1.2,16),WHITE,3);
  const px=e.x+look[0],py=e.y+look[1];
  const pup=`<ellipse cx="${px}" cy="${py}" rx="12.5" ry="13.5" fill="${INK}"/><circle cx="${px-4}" cy="${py-4.5}" r="4" fill="#fff"/>`;
  return wh+pup;}
function eyeHappy(e,seed){return P(wline([[e.x-22,e.y+6],[e.x-12,e.y-8],[e.x,e.y-12],[e.x+12,e.y-8],[e.x+22,e.y+6]],seed,.5),'none',5);}
function eyeCalm(e,seed){return P(wline([[e.x-22,e.y-4],[e.x-10,e.y+6],[e.x,e.y+8],[e.x+10,e.y+6],[e.x+22,e.y-4]],seed,.5),'none',5);}
function eyeSleepy(e,seed,id){
  const lowerD=`M${e.x-e.rx} ${e.y-2}Q${e.x} ${e.y+6} ${e.x+e.rx} ${e.y-2}A${e.rx} ${e.ry} 0 0 1 ${e.x-e.rx} ${e.y-2}Z`;
  return `<clipPath id="${id}"><path d="${lowerD}"/></clipPath><path d="${lowerD}" fill="${WHITE}"/>`+
   `<g clip-path="url(#${id})"><ellipse cx="${e.x+3}" cy="${e.y+12}" rx="11" ry="12" fill="${INK}"/><circle cx="${e.x-1}" cy="${e.y+8}" r="3" fill="#fff"/></g>`+
   P(lowerD,'none',3)+P(wline([[e.x-e.rx-2,e.y-3],[e.x,e.y+4],[e.x+e.rx+2,e.y-3]],seed,.4),'none',4.5);}
const eyesG=(l,r)=>G('eyes',G('eye-left',l)+G('eye-right',r));
const brows=(lift=[0,0],tilt=0)=>G('brows',
  P(wline([[114,216+lift[0]],[142,206+lift[0]],[172,212+lift[0]+tilt]],51,.5),'none',2.6)+
  P(wline([[218,212+lift[1]],[246,205+lift[1]],[277,217+lift[1]-tilt]],52,.5),'none',2.6));
const cheeks=()=>G('cheeks',`<path d="${blob(102,306,21,11,61,1,12)}" fill="${PINK}"/><path d="${blob(291,306,21,11,62,1,12)}" fill="${PINK}"/>`);
const nose=()=>G('nose',P(blob(197,322,12,8,71,.5,10),'#F2825A',2.6));
const smileM=()=>G('mouth',P(wline([[183,336],[190,343],[197,345],[204,343],[211,336]],81,.4),'none',3.2));
const openM=()=>G('mouth',P(`M181 333Q197 336 213 333Q211 355 197 356Q183 355 181 333Z`,'#7A2E1C',3)+`<path d="M189 350Q197 344 205 350Q197 356 189 350Z" fill="${ORANGE}"/>`);
const flatM=()=>G('mouth',P(wline([[186,338],[192,335],[199,340],[207,336]],82,.3),'none',3));
const smallO=()=>G('mouth',`<ellipse cx="197" cy="340" rx="5" ry="4" fill="#7A2E1C" stroke="${INK}" stroke-width="2.6"/>`);
const stars=(extra='')=>`<g id="sparkles" class="ct-sparkles">${sparkle(42,148,13,PINK)}${sparkle(60,236,5,'#9DB88A')}${sparkle(372,312,8,'#9DB88A')}${extra}</g>`;

// arms: pts from body edge to hand center
const armL=(pts,seed=91)=>G('arm-left',P(wline(pts.slice(0,-1).concat([pts[pts.length-1]]),seed,.5),'none',SW)+hand(...pts[pts.length-1],seed+1));
const armR=(pts,seed=95,under='')=>G('arm-right',under+P(wline(pts,seed,.5),'none',SW)+hand(...pts[pts.length-1],seed+1));
const L_DOWN=[[60,296],[41,298],[32,314],[30,330]];
const R_DOWN=[[335,296],[354,298],[363,314],[365,330]];
const L_UP=[[60,292],[36,284],[22,256],[22,230]];
const R_UP=[[335,292],[359,284],[373,256],[373,230]];
const R_HOLD=[[333,282],[347,274],[356,250],[357,224]]; // hand at 357,224

const pauseSign=()=>G('pause-sign',
  P(wline([[348,152],[353,190],[357,216]],96,.4),'none',3.2)+
  `<path d="${blob(322,118,38,38,97,1,14)}" fill="${GOLD}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`+
  P(blob(322,118,29,29,98,.8,12),ORANGE,2.8)+
  `<rect x="310" y="103" width="8" height="30" rx="3" fill="#fff" stroke="${INK}" stroke-width="1.6"/><rect x="326" y="103" width="8" height="30" rx="3" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`);

const VB='6 66 388 388';
const wrap=(inner,vb=VB,title='CleanTab mascot')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${title}" fill="none"><g id="mascot" class="ct-mascot">${inner}</g></svg>\n`;
const base=(face,arms,opts={})=>`${shadow(opts.sh)}${feet(opts.fdy||0)}${tab()}${body()}${face}${arms}`;

const poses={};
poses['default']=wrap(
  shadow()+feet()+tab()+body()+
  brows()+eyesG(eyeOpen(EL,101),eyeOpen(ER,102))+cheeks()+nose()+
  armL(L_DOWN)+pauseSign()+armR(R_HOLD)+stars(),VB,'CleanTab mascot holding a pause sign');

poses['happy']=wrap(shadow(.8)+`<g id="jump" class="ct-jump" transform="translate(0 -14)">`+
  feet(-2)+tab()+body()+
  G('brows','')+eyesG(eyeHappy(EL,103),eyeHappy(ER,104))+cheeks()+nose()+openM()+
  armL(L_UP)+armR(R_UP)+`</g>`+
  `<g class="ct-sparkles" id="sparkles">${sparkle(48,120,12,ORANGE)}${sparkle(350,110,14,PINK)}${sparkle(30,330,7,'#9DB88A')}${sparkle(372,330,7,ORANGE)}</g>`,VB,'Happy CleanTab mascot');

const zz=`<g id="zzz" class="ct-zzz" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M330 150h18l-18 20h18"/><path d="M352 118h13l-13 15h13" opacity=".8"/><path d="M370 94h9l-9 10h9" opacity=".6"/></g>`;
poses['sleepy']=wrap(base(
  brows([-2,-2],0)+eyesG(eyeSleepy(EL,105,'ct-lidL'),eyeSleepy(ER,106,'ct-lidR'))+cheeks()+nose()+smallO().replace('rx="5" ry="4"','rx="4" ry="3"')+'',
  armL(L_DOWN)+armR(R_DOWN))+zz,VB,'Sleepy CleanTab mascot');

poses['encourage']=wrap(base(
  eyesG(eyeCalm(EL,107),eyeCalm(ER,108))+cheeks()+nose()+smileM(),
  armL([[60,300],[40,314],[52,338],[84,328]])+armR([[335,290],[354,282],[367,258],[366,230]],95))+
  `<g id="sparkles" class="ct-sparkles">${heart(48,190,9)}${sparkle(352,170,9,PINK)}${sparkle(30,262,5,'#9DB88A')}</g>`+
  `<g id="wave-lines" class="ct-wave-lines" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" fill="none"><path d="M385 215q6 12 0 24"/></g>`,VB,'Gently encouraging CleanTab mascot');

poses['thinking']=wrap(base(
  brows([-4,2],3)+eyesG(eyeOpen(EL,109,[8,-14]),eyeOpen(ER,110,[8,-14]))+cheeks()+nose()+flatM(),
  armL(L_DOWN)+armR([[335,292],[328,330],[296,352],[252,346]],95))+
  `<g id="thought" class="ct-thought">${circ(338,170,4.5,121,CREAM,2.4)}${circ(354,140,7,122,CREAM,2.6)}${circ(340,100,22,123,CREAM,2.8)}<g fill="${INK}"><circle cx="331" cy="100" r="2.6"/><circle cx="340" cy="100" r="2.6"/><circle cx="349" cy="100" r="2.6"/></g></g>`,VB,'Thinking CleanTab mascot');

poses['wave']=wrap(base(
  brows([-2,-2])+eyesG(eyeOpen(EL,111,[2,3]),eyeOpen(ER,112,[2,3]))+cheeks()+nose()+smileM(),
  armL(L_DOWN)+armR([[335,292],[358,286],[372,258],[370,226]],95))+
  `<g id="wave-lines" class="ct-wave-lines" stroke="${INK}" stroke-width="2.8" stroke-linecap="round" fill="none"><path d="M385 196q8 12 2 26"/><path d="M380 178q12 8 12 22" opacity=".5"/></g>`+stars(),VB,'CleanTab mascot waving hello');

const pot=(cx,cy)=>`<path d="${smooth([[cx-18,cy],[cx+18,cy],[cx+14,cy+22],[cx-14,cy+22]].map(([x,y],i)=>[x+(i%2?.4:-.4),y]),true)}" fill="${ORANGE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="${rrect(cx-21,cy-5,42,9,3,131,.4)}" fill="${ORANGE}" stroke="${INK}" stroke-width="3"/>`;
const holdBase=(prop,sparklesExtra='')=>base(
  brows()+eyesG(eyeOpen(EL,113,[7,5]),eyeOpen(ER,114,[7,5]))+cheeks()+nose()+smileM(),
  armL(L_DOWN)+G('prop',`<g transform="translate(357 224) scale(1.3) translate(-357 -224)">${prop}</g>`)+armR(R_HOLD)+'');
poses['sprout']=wrap(holdBase(
  P(wline([[357,178],[357,158],[355,142]],133,.4),'none',3.2)+
  `<path d="M355 146C338 148 328 136 330 124C346 122 356 132 355 146Z" fill="${GREEN}" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/><path d="M356 142C358 128 370 118 384 120C384 134 372 144 356 142Z" fill="${GREEN}" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/>`+
  pot(357,186))+`<g id="sparkles" class="ct-sparkles">${sparkle(42,148,13,PINK)}${sparkle(372,240,0.01)}</g>`,VB,'CleanTab mascot holding a sprout');

const cup=(cx,cy)=>`<path d="M${cx+17} ${cy+6}C${cx+34} ${cy+4} ${cx+34} ${cy+24} ${cx+15} ${cy+24}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`+
  `<path d="${smooth([[cx-20,cy],[cx+19,cy],[cx+15,cy+36],[cx-16,cy+36]].map(([x,y],i)=>[x+(i%2?.5:-.5),y]),true)}" fill="${WHITE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`+
  `<path d="M${cx-18} ${cy+12}Q${cx} ${cy+16} ${cx+17.5} ${cy+12}L${cx+16.5} ${cy+22}Q${cx} ${cy+26} ${cx-16.5} ${cy+22}Z" fill="${ORANGE}"/>`+
  `<g id="steam" class="ct-steam" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".75"><path d="M${cx-8} ${cy-6}q-6 -8 0 -14t0 -12"/><path d="M${cx+7} ${cy-6}q-6 -8 0 -14t0 -12"/></g>`;
poses['coffee']=wrap(holdBase(cup(354,186))+stars(),VB,'CleanTab mascot holding a coffee cup');
// heart on cup replaced by orange band; hand overlaps cup bottom via armR order
fs.mkdirSync(path.join(ROOT,'svg'),{recursive:true});

// peek
{
  const clip=`<clipPath id="ct-peek-clip"><rect x="0" y="0" width="400" height="346"/></clipPath>`;
  const hL=P(blob(138,346,17,13,141,.8,12),WHITE,3), hR=P(blob(258,346,17,13,142,.8,12),WHITE,3);
  const fing=(x)=>[-7,0,7].map((o,i)=>`<path d="M${x+o} 322v6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`).join('');
  poses['peek']=wrap(clip+`<g clip-path="url(#ct-peek-clip)">${tab()}${body()}${brows([-3,-3])}${eyesG(eyeOpen(EL,115,[-8,3]),eyeOpen(ER,116,[-8,3]))}${cheeks()}${nose()}</g>`+
   G('arm-left',hL)+G('arm-right',hR),'10 104 376 268','CleanTab mascot peeking');
}

// icons
function icon(small){
  const sw=small?7:5;
  const body=rrect(12,32,104,84,small?20:18,201,1.2), tabp=smooth(rrectPts(18,12,44,40,10,202,.8),true);
  const s=(w=sw)=>`stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  let o=`<path d="${tabp}" fill="${ORANGE}" transform="translate(5 4)"/><path d="${tabp}" fill="${CREAM}" ${s()}/>`+
    `<circle cx="32" cy="${small?29:28}" r="${small?6:5}" fill="${ORANGE}" ${small?'':s(3.5)}/>`+
    `<path d="${body}" fill="${ORANGE}" transform="translate(6 6)"/><path d="${body}" fill="${CREAM}" ${s()}/>`;
  if(small){
    o+=`<ellipse cx="42" cy="72" rx="9" ry="12" fill="${INK}"/><ellipse cx="86" cy="72" rx="9" ry="12" fill="${INK}"/><circle cx="39" cy="67" r="3.2" fill="#fff"/><circle cx="83" cy="67" r="3.2" fill="#fff"/>`+
      `<ellipse cx="26" cy="94" rx="8" ry="5" fill="${PINK}"/><ellipse cx="102" cy="94" rx="8" ry="5" fill="${PINK}"/>`;
  } else {
    o+=`<path d="${blob(42,70,13,16,203,.5,12)}" fill="#fff" ${s(4)}/><path d="${blob(86,70,13,16,204,.5,12)}" fill="#fff" ${s(4)}/>`+
      `<ellipse cx="45" cy="74" rx="6.5" ry="7.5" fill="${INK}"/><ellipse cx="89" cy="74" rx="6.5" ry="7.5" fill="${INK}"/><circle cx="43" cy="71" r="2.2" fill="#fff"/><circle cx="87" cy="71" r="2.2" fill="#fff"/>`+
      `<ellipse cx="25" cy="96" rx="8" ry="5" fill="${PINK}"/><ellipse cx="103" cy="96" rx="8" ry="5" fill="${PINK}"/><ellipse cx="64" cy="94" rx="5" ry="3.5" fill="${ORANGE}" ${s(2.6)}/>`;
  }
  return o;
}
poses['icon']=wrap(icon(false),'0 0 128 128','CleanTab icon');
poses['icon-small']=wrap(icon(true),'0 0 128 128','CleanTab icon');

for(const [k,v] of Object.entries(poses)) fs.writeFileSync(path.join(ROOT,'svg',`${k}.svg`),v);

// ---- Mascot.tsx ----
const strip=s=>s.replace(/ id="[^"]*"/g,m=>m).trim();
const entries=Object.entries(poses).map(([k,v])=>{
  const vb=v.match(/viewBox="([^"]+)"/)[1];
  const inner=v.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].replace(/ id="(?!ct-)[^"]*"/g,''); // keep only clipPath ids (ct-*)
  return `  ${JSON.stringify(k)}: { viewBox: ${JSON.stringify(vb)}, html: ${JSON.stringify(inner)} },`;
}).join('\n');
const tsx=`import * as React from 'react';

/**
 * CleanTab mascot. Zero dependencies, inline SVG, transparent background.
 * Generated by tools/gen.mjs. Do not edit the POSES table by hand.
 * Animate parts via the class names: .ct-mascot .ct-eyes .ct-arm-right .ct-arm-left
 * .ct-pause-sign .ct-feet .ct-shadow .ct-jump .ct-zzz .ct-steam .ct-sparkles ...
 */
export type MascotPose =
  | 'default' | 'happy' | 'sleepy' | 'encourage' | 'thinking' | 'wave'
  | 'sprout' | 'coffee' | 'peek' | 'icon' | 'icon-small';

const POSES: Record<MascotPose, { viewBox: string; html: string }> = {
${entries}
};

export interface MascotProps extends Omit<React.SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'> {
  pose?: MascotPose;
  /** Rendered width in px (height follows aspect ratio). Default 240. */
  size?: number;
  /** Accessible label. Pass title="" to mark it decorative. */
  title?: string;
}

export function Mascot({ pose = 'default', size = 240, title = 'CleanTab mascot', ...rest }: MascotProps) {
  const p = POSES[pose];
  const [, , w, h] = p.viewBox.split(' ').map(Number);
  const decorative = title === '';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={p.viewBox}
      width={size}
      height={Math.round((size * h) / w)}
      fill="none"
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      {...rest}
      dangerouslySetInnerHTML={{ __html: p.html }}
    />
  );
}

export default Mascot;
`;
fs.writeFileSync(path.join(ROOT,'Mascot.tsx'),tsx);
console.log('ok',Object.keys(poses).length);
