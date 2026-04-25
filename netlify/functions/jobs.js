const TAVILY_API = 'https://api.tavily.com/search';

const ROLE_TEXT = {
  sa: 'системный аналитик',
  ba: 'бизнес-аналитик',
  fs: 'fullstack разработчик',
};

const CITY_TEXT = {
  all:    '',
  moscow: 'Москва',
  spb:    'Санкт-Петербург',
  remote: 'удалённо',
};

const DOMAIN_NAME = {
  'hh.ru':             'HH.ru',
  'superjob.ru':       'SuperJob',
  'career.habr.com':   'Habr Career',
  'avito.ru':          'Авито Работа',
};

function domainOf(url) {
  try {
    const h = new URL(url).hostname.replace('www.', '');
    for (const d of Object.keys(DOMAIN_NAME)) {
      if (h.includes(d)) return d;
    }
    return h;
  } catch { return ''; }
}

function extractSalary(text) {
  const m = text.match(/(\d[\d\s]*)\s*[–—-]\s*(\d[\d\s]*)\s*[₽руб]/i)
    || text.match(/от\s*(\d[\d\s]*)\s*[₽руб]/i)
    || text.match(/до\s*(\d[\d\s]*)\s*[₽руб]/i);
  if (!m) return null;
  return m[0].replace(/\s+/g, ' ').trim();
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

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'TAVILY_API_KEY not configured' }),
    };
  }

  const params = event.queryStringParameters || {};
  const role = params.role || 'sa';
  const city = params.city || 'all';

  const roleText = ROLE_TEXT[role] || 'системный аналитик';
  const cityText = CITY_TEXT[city] || '';
  const query = `вакансия ${roleText}${cityText ? ' ' + cityText : ''} требования зарплата`;

  try {
    const resp = await fetch(TAVILY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:      apiKey,
        query,
        search_depth: 'basic',
        max_results:  15,
        include_domains: ['hh.ru', 'superjob.ru', 'career.habr.com', 'avito.ru'],
      }),
    });

    if (!resp.ok) throw new Error(`Tavily ${resp.status}`);
    const data = await resp.json();

    const items = (data.results || []).map(r => {
      const domain = domainOf(r.url);
      return {
        title:      r.title,
        url:        r.url,
        source:     DOMAIN_NAME[domain] || domain,
        snippet:    (r.content || '').slice(0, 300),
        salary:     extractSalary(r.content || ''),
      };
    });

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
