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

const BASE = "https://animepahe.pw";
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


async function searchResults(keyword) {
  const q = String(keyword || "").trim();
  if (!q) return JSON.stringify([]);

  const query = "?m=search&q=" + encodeURIComponent(q);
  const hosts = [
    "https://animepahe.pw"
  ];

  for (const host of hosts) {
    try {
      const response = await fetchv2(
        host + "/api" + query,
        {
          "Accept": "application/json",
          "Referer": host + "/"
        },
        "GET",
        null
      );

      let body;
      
      if (typeof response === "string") {
        body = response;
      } else if (response && typeof response.text === "function") {
        body = await response.text();
      } else if (response && typeof response.body === "string") {
        body = response.body;
      } else if (response && typeof response.data === "string") {
        body = response.data;
      } else {
        throw new Error("Unsupported fetch response shape");
      }
      
      const data = typeof body === "string"
        ? JSON.parse(body)
        : body;

      const rows = Array.isArray(data.data)
        ? data.data
        : [];

      const results = rows.map(item => ({
        title: String(item.title || item.name || "Anime"),
        image: (item.poster || item.image)
         ? absUrl(item.poster || item.image)
         : "",
        href: item.session
          ? host + "/anime/" + item.session +
            (item.id ? "/" + item.id : "")
          : ""
      })).filter(item => item.href);

      if (results.length) {
        return JSON.stringify(results);
      }
    } catch (error) {
      throw new Error(
        "AnimePahe search failed: " + String(error)
      );
    }
  }

  return JSON.stringify([]);
}



async function extractDetails(url) {
  try {
    const html = await requestText(absUrl(url));

    const descMatch = html.match(
      /<div class="anime-synopsis">([\s\S]*?)<\/div>/i
    );
    const aliasMatch = html.match(
      /<strong>Synonyms:\s*<\/strong>([\s\S]*?)<\/p>/i
    );
    const airMatch = html.match(
      /<strong>Aired:\s*<\/strong>([\s\S]*?)<\/p>/i
    );

    const description = descMatch
      ? cleanText(descMatch[1].replace(/<br\s*\/?>/gi, "\n"))
      : "";

    const aliases = aliasMatch
      ? cleanText(aliasMatch[1])
      : "";

    const airdate = airMatch
      ? cleanText(airMatch[1])
      : "";

    return JSON.stringify([{
      description,
      aliases,
      airdate
    }]);
  } catch (error) {
    return JSON.stringify([{
      description: "",
      aliases: "",
      airdate: ""
    }]);
  }
}

async function extractStreamUrl(url) {
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


