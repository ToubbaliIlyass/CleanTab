// node tools/render.mjs          -> PNG exports + contact sheet
// node tools/render.mjs compare  -> side-by-side compare.png (reference | redraw)
// Needs `sharp`; resolved from SHARP_FROM (a package.json path) or the CleanTab-Landing project.
import {createRequire} from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(process.env.SHARP_FROM||'/Users/ilyasstoubbaliilyass/Documents/Work/CleanTab-Landing/package.json');
const sharp=require('sharp');
const svg=n=>fs.readFileSync(path.join(ROOT,'svg',n+'.svg'));
const render=(n,w)=>sharp(svg(n),{density:Math.max(72,Math.round(72*w/388*2))}).resize({width:w}).png().toBuffer();
const main=['default','happy','sleepy','encourage','thinking','wave','sprout','coffee','peek'];
if(process.argv[2]==='compare'){
  const bg={r:225,g:225,b:195,alpha:1};
  const mine=await sharp(await render('default',500)).flatten({background:bg}).toBuffer();
  const refB=await sharp(path.join(ROOT,'reference.png')).resize({width:500}).toBuffer();
  const rm=await sharp(refB).metadata();const mm=await sharp(mine).metadata();
  const H=Math.max(rm.height,mm.height);
  await sharp({create:{width:1000,height:H,channels:3,background:bg}}).composite([{input:refB,left:0,top:0},{input:mine,left:500,top:0}]).png().toFile(path.join(process.env.OUT||ROOT,'compare.png'));
  process.exit(0);
}
for(const n of main){for(const s of [1,2]) fs.writeFileSync(path.join(ROOT,'png',`${n}${s===1?'':'@2x'}.png`),await render(n,400*s));}
const icon=(n,s)=>sharp(svg(n),{density:Math.max(72,Math.round(72*s/128*2))}).resize(s,s).png().toBuffer();
for(const s of [16,32]) fs.writeFileSync(path.join(ROOT,'png',`icon-${s}.png`),await icon('icon-small',s));
for(const s of [48,128]) fs.writeFileSync(path.join(ROOT,'png',`icon-${s}.png`),await icon('icon',s));
await sharp({create:{width:180,height:180,channels:3,background:'#FBE3C4'}}).composite([{input:await icon('icon',130),left:25,top:27}]).png().toFile(path.join(ROOT,'png','apple-icon-180.png'));
// contact sheet
const items=[...main,'icon','icon-small'];const cw=300,ch=330,cols=4,rows=Math.ceil(items.length/cols);
const comps=[];let labels='';
for(let i=0;i<items.length;i++){const x=(i%cols)*cw,y=Math.floor(i/cols)*ch;
  const isI=items[i].startsWith('icon');
  const buf=isI?await icon(items[i],200):await render(items[i],260);
  const m=await sharp(buf).metadata();
  comps.push({input:buf,left:x+Math.round((cw-m.width)/2),top:y+10+Math.round((260-m.height)/2)});
  labels+=`<text x="${x+cw/2}" y="${y+300}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#2B1B12">${items[i]}</text>`;}
const W=cw*cols,H=ch*rows;
await sharp({create:{width:W,height:H,channels:4,background:'#F3EAD8'}}).composite([...comps,{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}</svg>`),left:0,top:0}]).png().toFile(path.join(ROOT,'contact-sheet.png'));
console.log('done');
