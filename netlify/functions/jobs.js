const HH_RSS = 'https://hh.ru/search/vacancy/rss';

const ROLE_TEXT = {
  sa: 'системный аналитик',
  ba: 'бизнес-аналитик',
  fs: 'fullstack разработчик',
};

const HH_AREA = { all: '113', moscow: '1', spb: '2' };

// Парсим один тег из XML
function getTag(s, name) {
  const m = s.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}

// Достаём CDATA содержимое
function getCDATA(s, name) {
  const m = s.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`));
  return m ? m[1] : '';
}

// Парсим description из HH.ru RSS
// Формат: "Вакансия компании: NAME\nСоздана: DATE\nРегион: CITY\nПредполагаемый уровень...: SALARY\nОписание: ..."
function parseDesc(html) {
  const plain = html.replace(/<[^>]+>/g, '\n').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\n+/g,'\n').trim();
  const lines = plain.split('\n').map(l => l.trim()).filter(Boolean);

  let company = '', city = '', salary = null, desc = '';

  for (const line of lines) {
    if (line.startsWith('Вакансия компании:')) {
      company = line.replace('Вакансия компании:', '').trim();
    } else if (line.startsWith('Регион:')) {
      city = line.replace('Регион:', '').trim();
    } else if (line.startsWith('Предполагаемый уровень')) {
      const val = line.split(':').slice(1).join(':').trim();
      if (val && !val.toLowerCase().includes('не указан')) salary = val;
    } else if (!line.startsWith('Создана:') && company) {
      desc += (desc ? ' ' : '') + line;
    }
  }

  return { company, city, salary, desc: desc.slice(0, 250) };
}

function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title   = getCDATA(block, 'title') || getTag(block, 'title');
    const link    = getTag(block, 'link') || getCDATA(block, 'link');
    const descHtml = getCDATA(block, 'description') || getTag(block, 'description');
    const { company, city, salary, desc } = parseDesc(descHtml);

    if (!title || !link) continue;

    items.push({
      title:   title.replace(/&quot;/g,'"').replace(/&amp;/g,'&').trim(),
      url:     link.trim(),
      company, city, salary,
      snippet: desc,
    });
  }
  return items;
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

  const qs = new URLSearchParams({ text, area });
  if (city === 'remote') qs.set('schedule', 'remote');

  const url = `${HH_RSS}?${qs}`;
  console.log('Fetching RSS:', url);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    });

    console.log('RSS status:', res.status);
    if (!res.ok) throw new Error(`HH.ru RSS ${res.status}`);
    const xml = await res.text();
    console.log('XML length:', xml.length, 'items found:', (xml.match(/<item>/g) || []).length);

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
    console.error('Jobs RSS error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
