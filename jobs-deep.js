// Vercel Serverless Function — DERİN / İÇERİK araması
// Arbeitsagentur'un /jobs aramasındaki `was` sadece başlık/meslek eşler.
// İlan METNİNİN içinde kelime aramak için her ilanın detayını ayrı çekmek gerekir.
// Bu fonksiyon: geniş arama → her ilanın detayı → metinde kelime filtresi → eşleşenler.
//
// Çağrı örneği:
//   /api/jobs-deep?was=Tischler&wo=München&umkreis=100&enthalten=CNC,Holz,5-Achs&modus=any

export const config = { maxDuration: 60 }; // detay çekmek zaman aldığı için

const BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const HEADERS = {
  "X-API-Key": "jobboerse-jobsuche",
  "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0)",
  Accept: "application/json",
};

const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");

async function getDetail(refnr) {
  try {
    const r = await fetch(`${BASE}/pc/v4/jobdetails/${b64(refnr)}`, { headers: HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Aynı anda en fazla `limit` istek (API'yi boğmamak için)
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function makeSnippet(text, term) {
  if (!text) return "";
  const clean = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return clean.slice(0, 160);
  const i = clean.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return clean.slice(0, 160);
  const start = Math.max(0, i - 55);
  return (start > 0 ? "… " : "") + clean.slice(start, i + term.length + 95).trim() + " …";
}

export default async function handler(req, res) {
  const {
    was = "",
    wo = "",
    umkreis = "50",
    enthalten = "",     // virgülle ayrılmış kelimeler
    modus = "any",      // any = herhangi biri (OR) | all = hepsi (AND)
    arbeitszeit = "",
    limit = "50",       // kaç ilanın metni taransın
  } = req.query;

  const terms = String(enthalten)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // 1) Geniş arama → aday ilanlar (refnr'leri lazım)
  const p = new URLSearchParams();
  if (was) p.set("was", was);
  if (wo) p.set("wo", wo);
  if (umkreis) p.set("umkreis", umkreis);
  if (arbeitszeit) p.set("arbeitszeit", arbeitszeit);
  p.set("angebotsart", "1");
  p.set("page", "1");
  p.set("size", "100");

  let base;
  try {
    const r = await fetch(`${BASE}/pc/v4/jobs?${p}`, { headers: HEADERS });
    base = await r.json();
  } catch (e) {
    return res.status(500).json({ error: "search_failed", message: String(e) });
  }

  const cap = Math.min(parseInt(limit, 10) || 50, 80);
  let jobs = (base.stellenangebote || []).slice(0, cap);

  res.setHeader("Access-Control-Allow-Origin", "*");

  // Kelime girilmemişse derin aramaya gerek yok, başlık sonuçlarını dön
  if (!terms.length) {
    return res.status(200).json({ stellenangebote: jobs, scanned: 0 });
  }

  // 2) Her ilanın detayını paralel çek
  const details = await mapPool(jobs, 8, (j) => (j.refnr ? getDetail(j.refnr) : null));

  // 3) Metinde kelimeleri filtrele
  const matched = [];
  jobs.forEach((j, idx) => {
    const d = details[idx];
    if (!d) return;
    // Sağlamlık için tüm detay JSON'unu tarıyoruz (alan adı değişse de kelime yakalanır)
    const haystack = JSON.stringify(d).toLowerCase();
    const hits = terms.filter((t) => haystack.includes(t));
    const ok = modus === "all" ? hits.length === terms.length : hits.length > 0;
    if (ok) {
      j._hits = hits;
      j._snippet = makeSnippet(d.stellenbeschreibung || "", hits[0]);
      matched.push(j);
    }
  });

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({ stellenangebote: matched, scanned: jobs.length });
}
