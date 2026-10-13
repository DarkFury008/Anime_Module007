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
  const match = String(url || "").match(/\/anime\/([^/?#]+)/i);
  return match ? match[1] : "";
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



async function getAlternatePoster(title) {
  try {
    const host = "https://animepahetv.to";

    const normalize = s => cleanText(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const queries = [title];

    // Search using an alternate title only for poster matching.
    if (
      normalize(title).includes("frieren") &&
      normalize(title).includes("beyond journey s end")
    ) {
      queries.push("Sousou no Frieren");
    }

    for (const searchTitle of queries) {
      const url = host + "/search?q=" +
        encodeURIComponent(searchTitle);

      const html = await requestText(url, {
        "Referer": host + "/",
        "User-Agent": "Mozilla/5.0"
      });

      const wanted = normalize(searchTitle);

      const blocks = html.split(
        /<div\b[^>]*class=["'][^"']*\banime-item\b[^"']*["'][^>]*>/i
      );

      const candidates = [];

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        const titleMatch = block.match(
          /<div\b[^>]*class=["'][^"']*\banime-name\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i
        );

        if (!titleMatch) continue;

        const imageTags = block.match(/<img\b[^>]*>/gi) || [];
        let image = "";

        for (const tag of imageTags) {
          for (const attr of [
            "data-src",
            "data-original",
            "data-lazy-src",
            "data-srcset",
            "src",
            "srcset"
          ]) {
            const raw = getAttr(tag, attr);
            if (!raw) continue;

            const firstUrl = raw
              .split(",")[0]
              .trim()
              .split(/\s+/)[0];

            if (
              !firstUrl ||
              firstUrl.startsWith("data:") ||
              firstUrl.includes("placeholder")
            ) continue;

            try {
              image = new URL(firstUrl, host).href;
              break;
            } catch (_) {}
          }

          if (image) break;
        }

        if (!image) continue;

        candidates.push({
          title: normalize(titleMatch[1]),
          image
        });
      }

      const exact = candidates.find(
        item => item.title === wanted
      );

      if (exact) return exact.image;

      const partial = candidates.find(item =>
        item.title.length >= 8 &&
        wanted.length >= 8 &&
        (
          item.title.includes(wanted) ||
          wanted.includes(item.title)
        )
      );

      if (partial) return partial.image;
    }

    return "";
  } catch (error) {
    console.log(
      "[AnimePaheCustom] Alternate poster lookup failed: " + error
    );
    return "";
  }
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

      const results = await Promise.all(rows.map(async item => {
       const originalPoster = (item.poster || item.image)
        ? absUrl(item.poster || item.image)
        : "";
        
       const alternatePoster = await getAlternatePoster(
        String(item.title || item.name || "")
       );
       return{
        title: String(item.title || item.name || "Anime"),
        image: alternatePoster || originalPoster,
        href: item.session
         ? host + "/anime/" + item.session +
           (item.id ? "/" + item.id : "")
         : ""
 };
})).then(items => items.filter(item => item.href));


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



async function extractEpisodes(url) {
  const session = extractAnimeSession(url);

  if (!session) {
    throw new Error("Could not read anime session from: " + url);
  }

  const apiUrl =
    API + "?m=release&id=" + encodeURIComponent(session) +
    "&sort=episode_asc&page=1";

  const raw = await requestText(apiUrl, {
    ...DEFAULT_HEADERS,
    "Referer": BASE + "/"
  });

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "Release API returned non-JSON: " + raw.slice(0, 180)
    );
  }

  if (!Array.isArray(data.data)) {
    throw new Error(
      "Unexpected release API response: " + raw.slice(0, 180)
    );
  }

  return JSON.stringify(
    data.data
      .filter(ep => ep && ep.session)
      .map((ep, index) => ({
        href: BASE + "/play/" + session + "/" + ep.session,
        number: Number(ep.episode ?? ep.number ?? index + 1)
      }))
  );
}






async function extractStreamUrl(url) {
    try {
        console.log("[AnimePaheCustom] Fetching episode page: " + url);

        const ddosInterceptor = new DdosGuardInterceptor();
        const responseText = await ddosInterceptor.fetchWithBypass(url);
        const dataText = await responseText.text();

        const buttonRegex = /<button[^>]*data-src="([^"]+)"[^>]*data-fansub="([^"]+)"[^>]*data-resolution="([^"]+)"[^>]*data-audio="([^"]+)"[^>]*>/g;
        const buttons = [];
        let match;

        while ((match = buttonRegex.exec(dataText)) !== null) {
            buttons.push({
                src: match[1],
                fansub: match[2],
                resolution: match[3],
                audio: match[4]
            });
        }

        console.log("[AnimePaheCustom] Resolution buttons: " + buttons.length);

        if (buttons.length === 0) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const subButtons = buttons.filter(btn => btn.audio === "jpn");

        if (subButtons.length === 0) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const deepUnpack = source => {
            let decoded = source;
            let safety = 0;

            while (/eval\(function\(p,a,c,k,e,d\)/.test(decoded) && safety < 5) {
                try {
                    decoded = unpack(decoded);
                    safety++;
                } catch (e) {
                    console.warn("[AnimePaheCustom] Unpack error: " + e.message);
                    break;
                }
            }

            return decoded;
        };

        const streamPromises = subButtons.map(async btn => {
            const kwikUrl = btn.src;
            const title = btn.resolution === "auto" || btn.resolution === "master"
                ? "Auto"
                : btn.resolution + "p";

            try {
                const headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                    "Referer": "https://animepahe.pw/",
                    "Origin": "https://kwik.cx",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                };

                const resp = await fetchv2(kwikUrl, headers);
                const html = await resp.text();

                const evalRegex = /eval\(function\(p,a,c,k,e,d\)\{[^}]*\}\('[^']*',\d+,\d+,'[^']*'\.split\('\|'\)[^)]*\)/g;
                const evalBlocks = [...html.matchAll(evalRegex)].map(m => m[0]);

                let hlsUrl = null;

                for (const block of evalBlocks) {
                    try {
                        const unpacked = deepUnpack(block);

                        const sourceMatch = unpacked.match(
                            /(?:source\s*=\s*['"]([^'"]+\.m3u8)['"])/i
                        );

                        if (sourceMatch) {
                            hlsUrl = sourceMatch[1];
                            break;
                        }

                        const directMatch = unpacked.match(
                            /https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*/i
                        );

                        if (directMatch) {
                            hlsUrl = directMatch[0];
                            break;
                        }
                    } catch (e) {
                        console.warn("[AnimePaheCustom] Unpack failed: " + e.message);
                    }
                }

                if (!hlsUrl) {
                    const scriptMatch = html.match(/<script>(.*?)<\/script>/s);

                    if (scriptMatch) {
                        let unpacked = null;
                        const scriptContent = scriptMatch[1];

                        if (scriptContent.includes("));eval(")) {
                            const parts = scriptContent.split("));eval(");

                            if (parts.length === 2) {
                                const layer2Packed = parts[1].substring(
                                    0,
                                    parts[1].length - 1
                                );

                                try {
                                    unpacked = unpack(layer2Packed);
                                } catch (_) {}
                            }
                        } else {
                            try {
                                unpacked = unpack(scriptContent);
                            } catch (_) {}
                        }

                        if (unpacked) {
                            const urlMatch =
                                unpacked.match(/const source=\\?['"]([^'"]+)['"]/) ||
                                unpacked.match(/https:\/\/[^\s'";]+\.m3u8/);

                            if (urlMatch) {
                                hlsUrl = urlMatch[1] || urlMatch[0];
                            }
                        }
                    }
                }

                if (!hlsUrl) return null;

                hlsUrl = hlsUrl.replace(/\\+$/, "");
                hlsUrl = hlsUrl
                    .replace("/stream/", "/hls/")
                    .replace("uwu.m3u8", "owo.m3u8");

                return {
                    title,
                    streamUrl: hlsUrl,
                    headers: {
                        "Referer": "https://kwik.cx/",
                        "Origin": "https://kwik.cx"
                    }
                };
            } catch (e) {
                console.warn("[AnimePaheCustom] Kwik error: " + e.message);
                return null;
            }
        });

        const results = await Promise.allSettled(streamPromises);

        const streams = results
            .filter(r => r.status === "fulfilled" && r.value)
            .map(r => r.value);

        streams.sort((a, b) => {
            const aRes = parseInt(a.title.match(/(\d+)p/)?.[1] || 0);
            const bRes = parseInt(b.title.match(/(\d+)p/)?.[1] || 0);
            return bRes - aRes;
        });

        const bestStream = streams.length > 0 ? [streams[0]] : [];

        return JSON.stringify({
            streams: bestStream,
            subtitle: ""
        });
    } catch (err) {
        console.log("[AnimePaheCustom] Stream extraction failed: " + err);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// DDoS-Guard bypass helper
class DdosGuardInterceptor {
    constructor() {
        this.errorCodes = [403];
        this.cookieStore = {};
    }

    async fetchWithBypass(url, options = {}) {
        let response = await this.fetchWithCookies(url, options);
        let responseText = null;

        if (this.errorCodes.includes(response.status)) {
            const newCookie = await this.getNewCookie(url);
            if (newCookie || this.cookieStore["__ddg2_"]) {
                return this.fetchWithCookies(url, options);
            }
            return response;
        }

        try {
            responseText = await response.text();
        } catch (e) {
            return response;
        }

        const isBlocked =
            responseText.includes("ddos-guard/js-challenge") ||
            responseText.includes("DDoS-Guard") ||
            responseText.includes("data-ddg-origin");

        if (!isBlocked) {
            response.text = async () => responseText;
            return response;
        }

        if (this.cookieStore["__ddg2_"]) {
            return this.fetchWithCookies(url, options);
        }

        const newCookie = await this.getNewCookie(url);

        if (!newCookie) {
            response.text = async () => responseText;
            return response;
        }

        return this.fetchWithCookies(url, options);
    }

    async fetchWithCookies(url, options = {}) {
        const cookieHeader = this.getCookieHeader();
        const headers = options.headers || {};

        if (cookieHeader) headers.Cookie = cookieHeader;

        const response = await fetchv2(url, headers);

        try {
            const setCookieHeader = response.headers
                ? response.headers["Set-Cookie"] || response.headers["set-cookie"]
                : null;

            if (setCookieHeader) this.storeCookies(setCookieHeader);
        } catch (e) {}

        return response;
    }

    storeCookies(setCookieString) {
        const cookies = Array.isArray(setCookieString)
            ? setCookieString
            : [setCookieString];

        cookies.forEach(cookieHeader => {
            const parts = cookieHeader.split(";");
            if (parts.length > 0) {
                const [key, value] = parts[0].split("=");

                if (key) {
                    this.cookieStore[key.trim()] = value?.trim() || "";
                }
            }
        });
    }

    getCookieHeader() {
        return Object.entries(this.cookieStore)
            .map(([key, value]) => `${key}=${value}`)
            .join("; ");
    }

    async getNewCookie(targetUrl) {
        try {
            const wellKnownResponse = await fetchv2(
                "https://check.ddos-guard.net/check.js"
            );
            const wellKnownText = await wellKnownResponse.text();

            const paths = wellKnownText.match(
                /['"](\/\.well-known\/ddos-guard\/[^'"]+)['"]/g
            );
            const checkPaths = wellKnownText.match(
                /['"]https:\/\/check\.ddos-guard\.net\/[^'"]+['"]/g
            );

            if (!paths || paths.length === 0) return null;

            const localPath = paths[0].replace(/['"]/g, "");
            const match = targetUrl.match(/^(https?:\/\/[^/]+)/);

            if (!match) return null;

            const baseUrl = match[1];
            const localUrl = `${baseUrl}${localPath}`;

            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Referer": targetUrl
            };

            const localResponse = await fetchv2(localUrl, { headers });
            let setCookie = localResponse.headers
                ? localResponse.headers["set-cookie"] || localResponse.headers["Set-Cookie"]
                : null;

            if (setCookie) this.storeCookies(setCookie);

            if (checkPaths && checkPaths.length > 0) {
                const checkUrl = checkPaths[0].replace(/['"]/g, "");
                const checkResponse = await fetchv2(checkUrl, { headers });

                setCookie = checkResponse.headers
                    ? checkResponse.headers["set-cookie"] || checkResponse.headers["Set-Cookie"]
                    : null;

                if (setCookie) this.storeCookies(setCookie);
            }

            return this.cookieStore["__ddg2_"] || null;
        } catch (error) {
            return null;
        }
    }
}

// Encoded-script unpacking helpers
class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
        };

        this.dictionary = {};
        this.base = base;

        if (36 < base && base < 62) {
            this.ALPHABET[base] =
                this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
        }

        if (2 <= base && base <= 36) {
            this.unbase = value => parseInt(value, base);
        } else {
            if (!this.ALPHABET[base]) {
                throw Error("Unsupported base encoding.");
            }

            [...this.ALPHABET[base]].forEach((cipher, index) => {
                this.dictionary[cipher] = index;
            });

            this.unbase = this._dictunbaser;
        }
    }

    _dictunbaser(value) {
        let ret = 0;

        [...value].reverse().forEach((cipher, index) => {
            ret += Math.pow(this.base, index) * this.dictionary[cipher];
        });

        return ret;
    }
}

function unpack(source) {
    function filterArgs(source) {
        const patterns = [
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
        ];

        for (const pattern of patterns) {
            const args = pattern.exec(source);

            if (args) {
                return {
                    payload: args[1],
                    symtab: args[4].split("|"),
                    radix: parseInt(args[2]),
                    count: parseInt(args[3])
                };
            }
        }

        throw Error("Could not parse encoded player script.");
    }

    const { payload, symtab, radix, count } = filterArgs(source);

    if (count !== symtab.length) {
        throw Error("Malformed encoded player script.");
    }

    const unbaser = new Unbaser(radix);

    function lookup(match) {
        let word;

        if (radix === 1) {
            word = symtab[parseInt(match)];
        } else {
            word = symtab[unbaser.unbase(match)];
        }

        return word || match;
    }

    return payload.replace(/\b\w+\b/g, lookup);
}


