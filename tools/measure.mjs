// Mesure ponctuelle (lecture seule) : poids des produits et des photos dans Firestore
const KEY='AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const BASE='https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
let tok='',docs=[];
do{const r=await fetch(`${BASE}/products?pageSize=50&key=${KEY}`+(tok?`&pageToken=${encodeURIComponent(tok)}`:''));const j=await r.json();docs.push(...(j.documents||[]));tok=j.nextPageToken||'';}while(tok);
let total=0,imgs=0,imgBytes=0,max=0,maxName='';const rows=[];
for(const d of docs){const f=d.fields||{};const s=JSON.stringify(d).length;total+=s;
  let n=0,b=0;const add=v=>{const x=v&&v.stringValue;if(x&&x.startsWith('data:image')){n++;b+=x.length;}};
  add(f.img);(f.colors&&f.colors.arrayValue&&f.colors.arrayValue.values||[]).forEach(c=>add(c.mapValue&&c.mapValue.fields&&c.mapValue.fields.img));
  imgs+=n;imgBytes+=b;if(s>max){max=s;maxName=f.name&&f.name.stringValue;}rows.push([s,n,f.name&&f.name.stringValue]);}
rows.sort((a,b)=>b[0]-a[0]);
const kb=x=>Math.round(x/1024)+' KB';
const out=[`produits: ${docs.length}`,`taille totale: ${kb(total)}`,`photos: ${imgs}, poids photos: ${kb(imgBytes)} (moyenne ${kb(imgBytes/Math.max(imgs,1))})`,`plus gros produit: ${maxName} ${kb(max)}`,'top 10:',...rows.slice(0,10).map(r=>`  ${kb(r[0])}  ${r[1]} photos  ${r[2]}`)].join('\n');
console.log(out);
import {writeFileSync,mkdirSync} from 'node:fs';mkdirSync('reports',{recursive:true});writeFileSync('reports/size.txt',out+'\n');
