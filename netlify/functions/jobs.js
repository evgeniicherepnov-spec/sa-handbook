const HH_RSS = 'https://hh.ru/search/vacancy/rss';

const ROLE_TEXT = {
  sa: 'системный аналитик',
  ba: 'бизнес-аналитик',
  fs: 'fullstack разработчик',
};

const HH_AREA = { all: '113', moscow: '1', spb: '2' };

function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title   = tag(block, 'title');
    const link    = tag(block, 'link') || cdata(block, 'link');
    const pubDate = tag(block, 'pubDate');
    const desc    = cdata(block, 'description') || tag(block, 'description');

    // из description вытаскиваем компанию, зарплату, город, сниппет
    const stripped = desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const salary   = extractSalary(stripped);
    const lines    = desc.split(/<br\s*\/?>/i).map(l => l.replace(/<[^>]+>/g,'').trim()).filter(Boolean);

    items.push({
      title:   title.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'),
      url:     link.trim(),
      company: lines[0] || '',
      city:    lines[1] || '',
      salary:  salary,
      snippet: stripped.slice(0, 280),
      pubDate,
    });
  }
  return items;
}

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}

function cdata(s, name) {
  const m = s.match(new RegExp(`<${name}>[^<]*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>[^<]*</${name}>`));
  return m ? m[1] : '';
}

function extractSalary(text) {
  const m = text.match(/(\d[\d\s]*)\s*[–—-]\s*(\d[\d\s]*)\s*руб/i)
    || text.match(/от\s*(\d[\d\s]*)\s*руб/i)
    || text.match(/до\s*(\d[\d\s]*)\s*руб/i)
    || text.match(/(\d[\d\s]+)\s*руб/i);
  if (!m) return null;
  return m[0].replace(/\s+/g,' ').trim();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  const params = event.queryStringParameters || {};
  const role = params.role || 'sa';
  const city = params.city || 'all';

  const text = ROLE_TEXT[role] || 'системный аналитик';
  const area = HH_AREA[city] || '113';

  const qs = new URLSearchParams({
    text,
    area,
    per_page: '20',
    order_by: 'publication_time',
  });
  if (city === 'remote') qs.set('schedule', 'remote');

  try {
    const res = await fetch(`${HH_RSS}?${qs}`, {
      headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
    });

    if (!res.ok) throw new Error(`HH.ru RSS ${res.status}`);
    const xml = await res.text();
    const items = parseRSS(xml);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({ items, total: items.length }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
