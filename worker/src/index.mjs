// Dispatchr status — Cloudflare Worker.
// A 1-minute cron probes each site and appends to KV; the fetch handler
// serves status.capturly.app from that data. Replaces the Upptime Actions
// crons (~17k billed CI minutes/month) with $0 Workers compute.

const SITES = [
  { id: "web", name: "Website", url: "https://dispatchr.social" },
  // /api/health pings Postgres (and reports Redis), so this catches a DB
  // outage, not just a down web tier.
  { id: "api", name: "API", url: "https://dispatchr.social/api/health" },
];

const HISTORY_DAYS = 90; // shown on the page
const PRUNE_DAYS = 100; // kept in KV
const TIMEOUT_MS = 10_000;

async function probeOnce(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "dispatchr-status/1.0 (+https://status.dispatchr.social)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtl: 0 },
    });
    return { ok: res.status < 400, status: res.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}

// One retry after 2s so a single blip doesn't mark a site down.
async function probe(site) {
  let r = await probeOnce(site.url);
  if (!r.ok) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    r = await probeOnce(site.url);
  }
  return { id: site.id, name: site.name, url: site.url, ...r };
}

async function runChecks(env) {
  const results = await Promise.all(SITES.map(probe));
  const now = new Date();

  await env.HISTORY.put(
    "latest",
    JSON.stringify({ checkedAt: now.toISOString(), sites: results })
  );

  // Single rolling document of per-day aggregates: one read + one write per
  // cron run, and the page needs exactly two KV reads.
  const days = JSON.parse((await env.HISTORY.get("days")) || "{}");
  const dayKey = now.toISOString().slice(0, 10);
  const day = (days[dayKey] ||= {});
  for (const r of results) {
    const d = (day[r.id] ||= { up: 0, total: 0, ms: 0 });
    d.total += 1;
    if (r.ok) d.up += 1;
    d.ms += r.ms;
  }
  const cutoff = new Date(now.getTime() - PRUNE_DAYS * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  await env.HISTORY.put("days", JSON.stringify(days));
}

function uptimePercent(days, siteId, windowDays) {
  const keys = Object.keys(days).sort().slice(-windowDays);
  let up = 0;
  let total = 0;
  for (const k of keys) {
    const d = days[k]?.[siteId];
    if (d) {
      up += d.up;
      total += d.total;
    }
  }
  return total === 0 ? null : (100 * up) / total;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function dayCells(days, siteId) {
  const keys = Object.keys(days).sort().slice(-HISTORY_DAYS);
  const all = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const d = keys.includes(date) ? days[date]?.[siteId] : null;
    let cls = "nodata";
    let title = `${date}: no data`;
    if (d && d.total > 0) {
      const pct = (100 * d.up) / d.total;
      cls = pct >= 99.5 ? "up" : pct >= 95 ? "part" : "down";
      title = `${date}: ${pct.toFixed(2)}% (${d.up}/${d.total} checks)`;
    }
    all.push(`<i class="${cls}" title="${esc(title)}"></i>`);
  }
  return all.join("");
}

function renderPage(latest, days) {
  const sites = latest?.sites ?? SITES.map((s) => ({ ...s, ok: null, ms: null }));
  const allUp = sites.every((s) => s.ok === true);
  const anyDown = sites.some((s) => s.ok === false);
  const banner = allUp
    ? { cls: "ok", text: "All systems operational" }
    : anyDown
      ? { cls: "down", text: "Some systems are having trouble" }
      : { cls: "part", text: "Collecting first checks…" };

  const rows = sites
    .map((s) => {
      const pct = uptimePercent(days, s.id, HISTORY_DAYS);
      const state = s.ok === true ? "up" : s.ok === false ? "down" : "nodata";
      const stateText = s.ok === true ? "Operational" : s.ok === false ? "Down" : "Pending";
      return `<section class="site">
        <div class="head">
          <span class="dot ${state}"></span>
          <h2>${esc(s.name)}</h2>
          <span class="ms">${s.ms != null ? `${s.ms} ms` : ""}</span>
          <span class="state ${state}">${stateText}</span>
        </div>
        <div class="bar" aria-label="last ${HISTORY_DAYS} days">${dayCells(days, s.id)}</div>
        <div class="foot"><span>${HISTORY_DAYS} days ago</span><span>${
          pct == null ? "collecting data" : `${pct.toFixed(2)}% uptime`
        }</span><span>today</span></div>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Dispatchr Status</title>
<link rel="icon" href="https://dispatchr.social/favicon-32x32.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap">
<style>
  :root { --bg:#1a1a2e; --card:#232340; --line:#32325a; --text:#ecebf4; --muted:#9a99b5;
          --brand:#9b6fff; --ok:#2fbf71; --down:#f0574a; --part:#d8a75a; --nodata:#3a3a5c; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font-family:Outfit, system-ui, -apple-system, sans-serif; line-height:1.5; }
  main { max-width:720px; margin:0 auto; padding:40px 20px 80px; }
  header { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  header img { height:32px; width:auto }
  header span { font-size:20px; font-weight:600 }
  .banner { border-radius:10px; padding:14px 18px; font-weight:600; margin:20px 0 28px;
            background:var(--card); border:1px solid var(--line); }
  .banner.ok { border-color:var(--ok); color:var(--ok) }
  .banner.down { border-color:var(--down); color:var(--down) }
  .banner.part { border-color:var(--part); color:var(--part) }
  .site { background:var(--card); border:1px solid var(--line); border-radius:10px;
          padding:16px 18px; margin:14px 0; }
  .head { display:flex; align-items:center; gap:10px }
  .head h2 { font-size:15px; font-weight:600; margin:0; flex:1 }
  .ms { color:var(--muted); font-size:13px; font-variant-numeric:tabular-nums }
  .state { font-size:13px; font-weight:600 }
  .state.up { color:var(--ok) } .state.down { color:var(--down) } .state.nodata { color:var(--muted) }
  .dot { width:10px; height:10px; border-radius:50%; background:var(--nodata) }
  .dot.up { background:var(--ok) } .dot.down { background:var(--down) }
  .bar { display:flex; gap:2px; margin:12px 0 6px }
  .bar i { flex:1; height:26px; border-radius:2px; background:var(--nodata) }
  .bar i.up { background:var(--ok) } .bar i.part { background:var(--part) } .bar i.down { background:var(--down) }
  .foot { display:flex; justify-content:space-between; color:var(--muted); font-size:12px }
  footer { margin-top:28px; color:var(--muted); font-size:13px }
  footer a { color:var(--brand); text-decoration:none }
</style>
</head>
<body>
<main>
  <header><img src="https://dispatchr.social/logo.png" alt=""><span>Dispatchr Status</span></header>
  <div class="banner ${banner.cls}">${banner.text}</div>
  ${rows}
  <footer>
    Checked every minute from Cloudflare's edge. Last check:
    ${latest ? esc(new Date(latest.checkedAt).toUTCString()) : "pending"} ·
    <a href="https://dispatchr.social">dispatchr.social</a> ·
    <a href="https://dispatchr.social/contact">Support</a> ·
    <a href="/api/status">JSON</a>
  </footer>
</main>
</body>
</html>`;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const [latestRaw, daysRaw] = await Promise.all([
      env.HISTORY.get("latest"),
      env.HISTORY.get("days"),
    ]);
    const latest = latestRaw ? JSON.parse(latestRaw) : null;
    const days = daysRaw ? JSON.parse(daysRaw) : {};

    if (pathname === "/api/status") {
      const body = {
        checkedAt: latest?.checkedAt ?? null,
        sites: (latest?.sites ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          ok: s.ok,
          status: s.status,
          ms: s.ms,
          uptime90d: uptimePercent(days, s.id, HISTORY_DAYS),
        })),
      };
      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=30",
          "access-control-allow-origin": "*",
        },
      });
    }

    if (pathname !== "/") return new Response("Not found", { status: 404 });

    return new Response(renderPage(latest, days), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=30",
      },
    });
  },
};
