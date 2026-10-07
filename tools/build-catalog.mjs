/* =====================================================================
   Construit un catalogue LÉGER à partir d'Atelier Stock (Firestore) :
   - catalog.json : seulement les pièces en stock (nom, prix, couleur…)
   - img/*.webp   : photos compressées (miniature + grande), nommées par
                    empreinte → une photo inchangée n'est jamais refaite.
   La page charge ce petit fichier au lieu de toute la base (photos en
   pleine taille incluses), donc elle s'affiche beaucoup plus vite.
   Lancé toutes les 5 min par .github/workflows/build-catalog.yml
   ===================================================================== */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const PROJECT = 'aa-inventaire';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const IMG_DIR = 'img';

function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return null;
}
function fields(f) { const o = {}; for (const k in f) o[k] = val(f[k]); return o; }

async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${path}: ${r.status}`);
  return fields((await r.json()).fields || {});
}
async function getProducts() {
  const out = []; let tok = '';
  do {
    const r = await fetch(`${BASE}/products?pageSize=50&key=${KEY}` + (tok ? `&pageToken=${encodeURIComponent(tok)}` : ''));
    if (!r.ok) throw new Error('Firestore products: ' + r.status);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push(fields(d.fields || {})));
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}

const used = new Set();
async function images(dataUrl, sizes) {
  const m = String(dataUrl || '').match(/^data:image\/[a-z+]+;base64,(.*)$/s);
  if (!m) return null;
  const h = createHash('sha1').update(m[1]).digest('hex').slice(0, 14);
  const buf = Buffer.from(m[1], 'base64');
  const out = {};
  for (const [tag, w, q] of sizes) {
    const file = `${IMG_DIR}/${h}-${tag}.webp`;
    used.add(file);
    if (!existsSync(file)) {
      await sharp(buf).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: q }).toFile(file);
    }
    out[tag] = file;
  }
  return out;
}

async function main() {
  mkdirSync(IMG_DIR, { recursive: true });
  const [products, cats, settings] = await Promise.all([getProducts(), getDoc('meta/categories'), getDoc('meta/settings')]);
  if (!products.length) throw new Error('Aucun produit lu — catalogue non modifié par sécurité');

  const models = [];
  for (const p of products.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    if (!p || !p.id) continue;
    const raw = [{ img: p.img, qty: p.qty, price: p.price, code: p.code, color: p.colorName || '' }];
    (p.colors || []).forEach((c, i) => {
      if (!c) return;
      raw.push({ img: c.img, qty: c.qty, price: (c.price != null && c.price !== '') ? c.price : p.price,
        code: c.code || `${p.id}-${i + 1}`, color: c.name || '' });
    });
    const pieces = [];
    for (const pc of raw) {
      if (!pc.img || (Number(pc.qty) || 0) <= 0) continue;
      const im = await images(pc.img, [['t', 480, 70], ['f', 1080, 80]]);
      if (!im) continue;
      pieces.push({ t: im.t, f: im.f, color: pc.color || `لون ${pieces.length + 1}`,
        price: Number(pc.price) || 0, qty: Number(pc.qty) || 0, code: String(pc.code || '') });
    }
    if (!pieces.length) continue;
    models.push({ id: p.id, cat: p.cat || '', order: p.order || 0, name: p.name || '', pieces });
  }

  let logo = '';
  if (settings && settings.logoUrl) {
    const im = await images(settings.logoUrl, [['logo', 300, 85]]);
    if (im) logo = im.logo;
  }

  const catalog = { cats: (cats && Array.isArray(cats.list)) ? cats.list : [], logo, models };
  const json = JSON.stringify(catalog);
  const prev = existsSync('catalog.json') ? readFileSync('catalog.json', 'utf8') : '';
  if (json !== prev) writeFileSync('catalog.json', json);

  // supprime les photos qui ne servent plus (pièce vendue, photo changée)
  for (const f of readdirSync(IMG_DIR)) {
    const path = `${IMG_DIR}/${f}`;
    if (f.endsWith('.webp') && !used.has(path)) unlinkSync(path);
  }
  console.log(`${models.length} modèles, ${models.reduce((t, m) => t + m.pieces.length, 0)} pièces en stock, ${json === prev ? 'aucun changement' : 'catalogue mis à jour'}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
