/*
 * AnimePahe custom module — experimental first pass.
 *
 * Uses the four async functions documented by Sora:
 * searchResults(keyword), extractDetails(url),
 * extractEpisodes(url), extractStreamUrl(url).
 *
 * Important: AnimePahe changes domains, API responses, and anti-bot rules.
 * This code is a testable starting point, not a claim of verified playback.
 */

const BASE = "https://animepahe.si";
const API = BASE + "/api";
const DEFAULT_HEADERS = {
  "Accept": "application/json, text/html, */*",
  "Referer": BASE + "/",
  "User-Agent": "Mozilla/5.0"
};

async function requestText(url, headers = DEFAULT_HEADERS) {
  // Prefer Sora's network bridge when the runtime exposes it.
  if (typeof fetchv2 === "function") {
    const response = await fetchv2(url, headers, "GET", null);
    if (typeof response === "string") return response;
    if (response && typeof response.body === "string") return response.body;
    if (response && typeof response.text === "function") return await response.text();
    return JSON.stringify(response);
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return await response.text();
}

async function requestJson(url, headers = DEFAULT_HEADERS) {
  const text = await requestText(url, headers);
  return JSON.parse(text);
}

function absUrl(url) {
  try { return new URL(url, BASE).href; } catch (_) { return url; }
}
function htmlDecode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
function cleanText(s) {
  return htmlDecode(String(s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function pathParts(url) {
  try { return new URL(url, BASE).pathname.split("/").filter(Boolean); }
  catch (_) { return String(url || "").split("?")[0].split("/").filter(Boolean); }
}
function extractAnimeSession(url) {
  const p = pathParts(url);
  return p[0] === "anime" ? (p[1] || "") : "";
}
function extractAnimeId(url) {
  const p = pathParts(url);
  for (let i = p.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(p[i])) return p[i];
  }
  return "";
}
function getAttr(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*(['\"])([\\s\\S]*?)\\1", "i");
  const m = String(tag || "").match(re);
  return m ? htmlDecode(m[2]) : "";
}

export async function searchResults(keyword) {
  try {
    const q = String(keyword || "").trim();
    if (!q) return JSON.stringify([]);
    const data = await requestJson(API + "?m=search&q=" + encodeURIComponent(q));
    const rows = Array.isArray(data.data) ? data.data : [];
    return JSON.stringify(rows.map(item => {
      const session = String(item.session || "");
      const id = String(item.id || "");
      const title = String(item.title || item.name || "Anime");
      return {
        title: item.type ? title + " (" + item.type + ")" : title,
        image: item.poster || item.image || "",
        href: session ? BASE + "/anime/" + session + (id ? "/" + id : "") : ""
      };
    }).filter(item => item.href));
  } catch (_) {
    return JSON.stringify([]);
  }
}

export async function extractDetails(url) {
  try {
    const html = await requestText(absUrl(url));
    const descMatch =
      html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const yearMatch = html.match(/\b(19\d{2}|20\d{2})\b/);
    return JSON.stringify({
      description: descMatch ? cleanText(descMatch[1]) : "",
      aliases: titleMatch ? cleanText(titleMatch[1]) : "",
      airdate: yearMatch ? yearMatch[1] : ""
    });
  } catch (_) {
    return JSON.stringify({ description: "", aliases: "", airdate: "" });
  }
}

export async function extractEpisodes(url) {
  try {
    const session = extractAnimeSession(url);
    const id = extractAnimeId(url);
    if (!session || !id) return JSON.stringify([]);
    const episodes = [];
    let page = 1;
    let lastPage = 1;
    do {
      const data = await requestJson(
        API + "?m=release&id=" + encodeURIComponent(id) +
        "&sort=episode_asc&page=" + page
      );
      const rows = Array.isArray(data.data) ? data.data : [];
      for (const ep of rows) {
        if (!ep || !ep.session) continue;
        const rawNumber = ep.episode ?? ep.number ?? (episodes.length + 1);
        const number = Number(rawNumber);
        episodes.push({
          href: BASE + "/play/" + session + "/" + String(ep.session),
          number: Number.isFinite(number) ? number : episodes.length + 1
        });
      }
      lastPage = Number(data.last_page || page);
      page++;
    } while (page <= lastPage && page <= 100);
    return JSON.stringify(episodes);
  } catch (_) {
    return JSON.stringify([]);
  }
}

export async function extractStreamUrl(url) {
  try {
    const html = await requestText(absUrl(url), {
      ...DEFAULT_HEADERS,
      "Referer": BASE + "/"
    });
    const streams = [];
    const seen = new Set();
    const tagRe = /<(?:a|button)\b[^>]*>/gi;
    let match;
    while ((match = tagRe.exec(html)) !== null) {
      const tag = match[0];
      const raw = getAttr(tag, "data-src") || getAttr(tag, "href");
      if (!raw) continue;
      const link = absUrl(raw);
      if (!/^https?:\/\//i.test(link) || seen.has(link)) continue;
      if (!/kwik|stream|play|pahe/i.test(link)) continue;
      seen.add(link);
      const quality = getAttr(tag, "data-resolution");
      streams.push({
        title: quality ? quality + "p" : "Server " + (streams.length + 1),
        streamUrl: link,
        headers: { "Referer": BASE + "/" }
      });
    }
    if (streams.length) return JSON.stringify({ streams });
    const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframe) {
      return JSON.stringify({
        streams: [{
          title: "Server 1",
          streamUrl: absUrl(htmlDecode(iframe[1])),
          headers: { "Referer": BASE + "/" }
        }]
      });
    }
    return JSON.stringify(null);
  } catch (_) {
    return JSON.stringify(null);
  }
}


