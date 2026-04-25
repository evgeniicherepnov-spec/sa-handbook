const TAVILY_API = 'https://api.tavily.com/search';

const ROLE_TEXT = {
  sa: 'системный аналитик',
  ba: 'бизнес-аналитик',
  fs: 'fullstack разработчик',
};

// Ключевые слова для проверки релевантности
const ROLE_KEYWORDS = {
  sa: ['системный аналитик', 'system analyst', 'sa '],
  ba: ['бизнес-аналитик', 'business analyst', 'ba '],
  fs: ['fullstack', 'full stack', 'full-stack'],
};

const CITY_TEXT = {
  all:    'Россия',
  moscow: 'Москва',
  spb:    'Санкт-Петербург',
  remote: 'удалённо',
};

const DOMAIN_LABEL = {
  'hh.ru':           'HH.ru',
  'superjob.ru':     'SuperJob',
  'career.habr.com': 'Habr Career',
  'avito.ru':        'Авито',
};

// Только URL конкретных вакансий, не страниц поиска
function isVacancyUrl(url) {
  return /hh\.ru\/vacancy\/\d+/.test(url)
    || /career\.habr\.com\/vacancies\/\d+/.test(url)
    || /superjob\.ru\/vakansii\/[^?#]+\d/.test(url)
    || /avito\.ru\/.+\/vakansii\/.+_\d+/.test(url);
}

function domainLabel(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    for (const [d, label] of Object.entries(DOMAIN_LABEL)) {
      if (host.includes(d)) return label;
    }
    return host;
  } catch { return 'Вакансия'; }
}

function extractSalary(text) {
  const m = text.match(/(\d[\d\s]{2,})\s*[–—-]\s*(\d[\d\s]{2,})\s*(?:руб|₽)/i)
    || text.match(/от\s*(\d[\d\s]{2,})\s*(?:руб|₽)/i)
    || text.match(/до\s*(\d[\d\s]{2,})\s*(?:руб|₽)/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function isRelevant(title, role) {
  const t = title.toLowerCase();
  const keywords = ROLE_KEYWORDS[role] || [ROLE_TEXT[role]];
  return keywords.some(kw => t.includes(kw.toLowerCase()));
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

  // Два параллельных запроса: HH.ru + остальные площадки
  const queries = [
    {
      query: `"${roleText}" вакансия ${cityText} требования обязанности`,
      domains: ['hh.ru'],
    },
    {
      query: `"${roleText}" вакансия ${cityText}`,
      domains: ['career.habr.com', 'superjob.ru'],
    },
  ];

  try {
    const results = await Promise.all(queries.map(q =>
      fetch(TAVILY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key:         apiKey,
          query:           q.query,
          search_depth:    'basic',
          max_results:     10,
          include_domains: q.domains,
        }),
      }).then(r => r.json()).catch(() => ({ results: [] }))
    ));

    const allResults = results.flatMap(r => r.results || []);

    const items = allResults
      .filter(r => isVacancyUrl(r.url))
      .filter(r => isRelevant(r.title, role))
      .map(r => ({
        title:   r.title,
        url:     r.url,
        source:  domainLabel(r.url),
        salary:  extractSalary(r.content || ''),
        snippet: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      }));

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
