// Vercel Serverless Function — JSearch (Google for Jobs) proxy
// Indeed, LinkedIn, Glassdoor, ZipRecruiter vb. tek API'den (Google for Jobs üzerinden).
// Türkçe sorgu destekler: language=tr veya de, country=de.
//
// GEREKLİ: Vercel → Settings → Environment Variables → RAPIDAPI_KEY ekle.
// Ücretsiz key: rapidapi.com → JSearch (OpenWeb Ninja) → Subscribe (Basic/Free).
//
// Çağrı: /api/jsearch?was=CNC&wo=München&language=de&date_posted=week

export const config = { maxDuration: 30 };

const HOST = "jsearch.p.rapidapi.com";

// JSearch sonucunu, diğer sekmelerle aynı kart şekline çeviriyoruz
function normalize(j) {
  const desc = (j.job_description || "").replace(/\s+/g, " ").trim();
  return {
    titel: j.job_title || "İlan",
    arbeitgeber: j.employer_name || "—",
    arbeitsort: { ort: j.job_city || j.job_location || "", plz: "" },
    aktuelleVeroeffentlichungsdatum: j.job_posted_at_datetime_utc || null,
    refnr: j.job_id || "",
    externeUrl: j.job_apply_link || j.job_google_link || "",
    _snippet: desc ? desc.slice(0, 170) + (desc.length > 170 ? " …" : "") : "",
    _source: j.job_publisher || "Google Jobs",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    return res.status(200).json({
      stellenangebote: [],
      error: "no_key",
      message:
        "RAPIDAPI_KEY tanımlı değil. Vercel → Settings → Environment Variables → RAPIDAPI_KEY ekleyip redeploy et.",
    });
  }

  const {
    was = "",
    wo = "",
    language = "de",         // de | tr | en
    date_posted = "all",     // all | today | 3days | week | month
  } = req.query;

  const query = [was, wo].filter(Boolean).join(" in ") || was || "Job";

  const params = new URLSearchParams({
    query,
    page: "1",
    num_pages: "1",
    country: "de",
    language,
    date_posted,
  });

  try {
    const r = await fetch(`https://${HOST}/search-v2?${params}`, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST },
    });
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ stellenangebote: [], error: "upstream", status: r.status });
    }
    const data = await r.json();
    const jobs = (data.data || []).map(normalize);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ stellenangebote: jobs });
  } catch (e) {
    return res
      .status(500)
      .json({ stellenangebote: [], error: "fetch_failed", message: String(e) });
  }
}
