// Vercel Serverless Function — Arbeitsagentur (Bundesagentur für Arbeit) proxy
// Tarayıcı doğrudan arbeitsagentur.de'ye istek atınca CORS'a takılır.
// Bu fonksiyon araya girip isteği yapar, sonucu temiz JSON olarak döner.
//
// Çağrı örneği (frontend'den):
//   /api/jobs?was=CNC-Programmierer&wo=München&umkreis=100&size=50

export default async function handler(req, res) {
  const {
    was = "",          // anahtar kelime / meslek
    wo = "",           // şehir
    umkreis = "50",    // km yarıçap
    page = "1",
    size = "50",
    arbeitszeit = "",  // vz=tam zaman, tz=yarı zaman, ho=home office, mj=minijob (; ile çoklu)
  } = req.query;

  const params = new URLSearchParams();
  if (was) params.set("was", was);
  if (wo) params.set("wo", wo);
  if (umkreis) params.set("umkreis", umkreis);
  if (arbeitszeit) params.set("arbeitszeit", arbeitszeit);
  params.set("angebotsart", "1"); // 1 = normal iş ilanı (Ausbildung/staj değil)
  params.set("page", page);
  params.set("size", size);

  const url =
    "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs?" +
    params.toString();

  try {
    const upstream = await fetch(url, {
      headers: {
        "X-API-Key": "jobboerse-jobsuche",
        "User-Agent":
          "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0)",
        Accept: "application/json",
      },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: "upstream_error", status: upstream.status });
    }

    const data = await upstream.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    // Aynı aramayı 5 dk Vercel cache'le (API'yi yormamak için)
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    return res
      .status(500)
      .json({ error: "fetch_failed", message: String(err) });
  }
}
