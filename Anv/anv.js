
const BASE = "https://anv.to";

async function requestText(url) {
  const headers = {
    "Accept": "text/html,application/json,*/*",
    "Referer": BASE + "/",
    "User-Agent": "Mozilla/5.0"
  };

  let response;

  if (typeof fetchv2 === "function") {
    response = await fetchv2(url, headers, "GET", null);
  } else {
    response = await fetch(url, { headers });
  }

  // Handle the response formats used by different module runtimes.
  if (typeof response === "string") return response;

  if (response && typeof response.body === "string") {
    return response.body;
  }

  if (response && typeof response.data === "string") {
    return response.data;
  }

  if (response && typeof response.text === "function") {
    return await response.text();
  }

  if (response && response.data && typeof response.data === "object") {
    return JSON.stringify(response.data);
  }

  if (response && response.body && typeof response.body === "object") {
    return JSON.stringify(response.body);
  }

  return "";
}

function decodeText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .trim();
}

function stripTags(value) {
  return decodeText(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function absoluteUrl(url) {
  if (!url) return "";

  try {
    return new URL(decodeText(url), BASE).href;
  } catch (_) {
    return "";
  }
}

function unique(items) {
  const seen = new Set();

  return items.filter(item => {
    if (!item.href || seen.has(item.href)) return false;

    seen.add(item.href);
    return true;
  });
}

// Extract JSON-LD and common embedded JSON objects.
function extractJsonObjects(html) {
  const found = [];

  const scripts = html.match(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const type =
      (script.match(/\btype=["']([^"']+)/i) || [])[1] || "";

    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    if (/ld\+json/i.test(type)) {
      try {
        found.push(JSON.parse(body));
      } catch (_) {}
    }

    if (/__NEXT_DATA__|__NUXT__|application\/json/i.test(type + script)) {
      try {
        found.push(JSON.parse(body));
      } catch (_) {}
    }
  }

  return found;
}

function flattenObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;

  if (Array.isArray(value)) {
    for (const item of value) {
      flattenObjects(item, output);
    }
    return output;
  }

  output.push(value);

  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") {
      flattenObjects(value[key], output);
    }
  }

  return output;
}

function titleFromObject(obj) {
  return obj.title ||
    obj.name ||
    obj.englishTitle ||
    obj.english_title ||
    obj.animeTitle ||
    obj.anime_title ||
    "";
}

function urlFromObject(obj) {
  return obj.url ||
    obj.href ||
    obj.link ||
    obj.slug ||
    obj.animeUrl ||
    obj.anime_url ||
    "";
}

function imageFromObject(obj) {
  return obj.poster ||
    obj.image ||
    obj.thumbnail ||
    obj.cover ||
    obj.posterUrl ||
    obj.poster_url ||
    "";
}

function normalizeAnimeObjects(html) {
  const objects = [];

  for (const json of extractJsonObjects(html)) {
    flattenObjects(json, objects);
  }

  const results = [];

  for (const obj of objects) {
    const title = titleFromObject(obj);
    const href = absoluteUrl(urlFromObject(obj));

    if (!title || !href || !/anv\.to/i.test(href)) continue;
    if (!/\/anime\//i.test(href)) continue;

    results.push({
      title: stripTags(title),
      image: absoluteUrl(imageFromObject(obj)),
      href
    });
  }

  return unique(results);
}

async function searchResults(keyword) {
  const q = String(keyword || "").trim();

  if (!q) return JSON.stringify([]);

  // These are candidate routes, not confirmed ANV API endpoints.
  const urls = [
    BASE + "/browse?q=" + encodeURIComponent(q)
    
  ];

  const diagnostics = [];

  for (const url of urls) {
    try {
      const raw = await requestText(url);

      if (!raw) {
        diagnostics.push(url + " => empty response");
        continue;
      }

      // Capture a short response preview to identify the real failure.
      diagnostics.push(
        url + " => " +
        raw.slice(0, 180).replace(/\s+/g, " ")
      );

      // Try JSON responses.
      try {
        const data = JSON.parse(raw);

        const rows = Array.isArray(data)
          ? data
          : data.results ||
            data.data ||
            data.items ||
            data.anime ||
            data.result ||
            [];

        if (Array.isArray(rows)) {
          const results = rows.map(item => {
            const path = item.href ||
              item.url ||
              item.link ||
              item.slug ||
              item.animeUrl ||
              item.anime_url ||
              "";

            const title = item.title ||
              item.name ||
              item.englishTitle ||
              item.english_title ||
              "";

            const href = absoluteUrl(path);

            return {
              title: stripTags(title),
              image: absoluteUrl(
                item.poster ||
                item.image ||
                item.cover ||
                item.thumbnail ||
                ""
              ),
              href
            };
          }).filter(item => {
            if (!item.title || !item.href) return false;

            try {
              return new URL(item.href).hostname.endsWith("anv.to") &&
                /\/anime\//i.test(item.href);
            } catch (_) {
              return false;
            }
          });

          if (results.length) {
            return JSON.stringify(unique(results));
          }
        }
      } catch (_) {}

      // Try server-rendered HTML links.
      const results = [];

      const re =
        /<a\b[^>]*href=["']([^"']*\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

      let match;

      while ((match = re.exec(raw)) !== null) {
        const href = absoluteUrl(match[1]);
        const title = stripTags(match[2]);

        if (!href || !title || !/\/anime\//i.test(href)) continue;

        results.push({
          title,
          image: "",
          href
        });
      }

      if (results.length) {
        return JSON.stringify(unique(results));
      }
    } catch (error) {
      diagnostics.push(
        url + " => request error: " +
        String(error).slice(0, 120)
      );
    }
  }

  throw new Error(
    "ANV search diagnostic: " +
    diagnostics.join(" | ").slice(0, 700)
  );
}

async function extractDetails(url) {
  try {
    const html = await requestText(absoluteUrl(url));

    const title = stripTags(
      (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
      (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ||
      ""
    );

    const description = stripTags(
      (html.match(
        /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)/i
      ) || [])[1] ||
      (html.match(
        /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i
      ) || [])[1] ||
      ""
    );

    return JSON.stringify([{
      title,
      description,
      aliases: "",
      airdate: ""
    }]);
  } catch (_) {
    return JSON.stringify([]);
  }
}

async function extractEpisodes(url) {
  try {
    const animeUrl = absoluteUrl(url);
    const html = await requestText(animeUrl);

    const episodes = [];
    const seen = new Set();

    const re =
      /href=["']([^"']*\/anime\/[^"']*-episode-(\d+(?:\.\d+)?)[^"']*)["']/gi;

    let match;

    while ((match = re.exec(html)) !== null) {
      const href = absoluteUrl(match[1]);
      const number = Number(match[2]);

      if (!href || !Number.isFinite(number) || seen.has(href)) {
        continue;
      }

      seen.add(href);

      episodes.push({
        href,
        number,
        title: "Episode " + number
      });
    }

    // Fallback to embedded episode data.
    if (!episodes.length) {
      const objects = [];

      for (const json of extractJsonObjects(html)) {
        flattenObjects(json, objects);
      }

      for (const obj of objects) {
        const href = absoluteUrl(urlFromObject(obj));

        const number = Number(
          obj.number ||
          obj.episodeNumber ||
          obj.episode_number ||
          obj.episode ||
          ""
        );

        if (
          href &&
          /\/anime\/.*-episode-\d+/i.test(href) &&
          Number.isFinite(number) &&
          !seen.has(href)
        ) {
          seen.add(href);

          episodes.push({
            href,
            number,
            title: stripTags(obj.title || ("Episode " + number))
          });
        }
      }
    }

    episodes.sort((a, b) => a.number - b.number);

    return JSON.stringify(episodes);
  } catch (_) {
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  // No stream resolver is configured.
  // This function does not bypass player protections or extract
  // unauthorized copyrighted streams.
  return JSON.stringify({
    streams: [],
    subtitle: "",
    error: "No authorized stream resolver is configured."
  });
}
