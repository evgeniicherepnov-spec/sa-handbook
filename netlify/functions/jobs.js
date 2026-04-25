/**
 * Netlify Function: /api/jobs
 * Агрегирует вакансии с HH.ru и SuperJob
 * Вызывается с фронтенда: fetch('/.netlify/functions/jobs?role=sa&level=all&city=all')
 */

const HH_API      = 'https://api.hh.ru/vacancies';
const SJ_API      = 'https://api.superjob.ru/2.0/vacancies/';

// Маппинги для HH.ru
const HH_ROLE = {
  sa:      'системный аналитик',
  ba:      'бизнес-аналитик',
  fs:      'fullstack разработчик',
};

const HH_EXP = {
  junior: 'noExperience',
  middle: 'between1And3',
  senior: 'between3And6',
};

const HH_AREA = {
  all:    113, // Россия
  moscow: 1,
  spb:    2,
};

// Маппинги для SuperJob
const SJ_TOWN = {
  all:    0,   // все города
  moscow: 4,
  spb:    14,
};

const SJ_EXP = {
  junior: 1, // без опыта
  middle: 2, // 1-3 года
  senior: 3, // 3-6 лет
};

const CURRENCY_MAP = {
  RUR: '₽', USD: '$', EUR: '€', KZT: '₸', UAH: '₴', BYR: 'Br',
};

// ─── Fetch HH.ru ────────────────────────────────────────────────────
async function fetchHH(role, level, city) {
  const params = new URLSearchParams({
    text:           HH_ROLE[role] || 'системный аналитик',
    per_page:       '20',
    page:           '0',
    order_by:       'publication_time',
  });

  // Всегда ищем по России (113), если не выбран конкретный город
  params.set('area', String(HH_AREA[city] || 113));
  if (level !== 'all' && HH_EXP[level]) params.set('experience', HH_EXP[level]);
  if (city === 'remote')                params.set('schedule', 'remote');

  const res = await fetch(`${HH_API}?${params}`, {
    headers: { 'User-Agent': 'SA-Handbook/2.0' },
  });

  console.log('HH.ru status:', res.status, 'url:', `${HH_API}?${params}`);
  if (!res.ok) throw new Error(`HH.ru error: ${res.status}`);
  const data = await res.json();
  console.log('HH.ru items:', data.items?.length, 'found:', data.found);

  return (data.items || []).map(v => {
    const s   = v.salary;
    let salary = null;
    if (s) {
      const cur = CURRENCY_MAP[s.currency] || s.currency;
      if (s.from && s.to)  salary = `${fmt(s.from)} – ${fmt(s.to)} ${cur}`;
      else if (s.from)     salary = `от ${fmt(s.from)} ${cur}`;
      else if (s.to)       salary = `до ${fmt(s.to)} ${cur}`;
    }
    return {
      id:          `hh_${v.id}`,
      source:      'hh',
      sourceName:  'HH.ru',
      title:       v.name,
      company:     v.employer?.name || '',
      logo:        v.employer?.logo_urls?.['90'] || null,
      salary,
      city:        v.area?.name || '',
      experience:  v.experience?.name || '',
      schedule:    v.schedule?.name || '',
      snippet:     cleanSnippet(v.snippet),
      url:         v.alternate_url,
      publishedAt: v.published_at,
    };
  });
}

// ─── Fetch SuperJob ──────────────────────────────────────────────────
async function fetchSJ(role, level, city) {
  const token = process.env.SUPERJOB_TOKEN;
  if (!token) return []; // токен не настроен — тихо пропускаем

  const params = new URLSearchParams({
    keyword:    HH_ROLE[role] || 'системный аналитик',
    count:      '20',
    page:       '0',
    order_field: 'date',
    order_direction: 'desc',
  });

  if (city !== 'all' && SJ_TOWN[city]) params.set('town', String(SJ_TOWN[city]));
  if (city === 'remote')               params.set('place_of_work', '2');
  if (level !== 'all' && SJ_EXP[level]) params.set('experience', String(SJ_EXP[level]));

  const res = await fetch(`${SJ_API}?${params}`, {
    headers: {
      'X-Api-App-Id': token,
      'User-Agent':   'SA-Handbook/2.0',
    },
  });

  if (!res.ok) return [];
  const data = await res.json();

  return (data.objects || []).map(v => {
    let salary = null;
    if (v.payment_from || v.payment_to) {
      const cur = v.currency === 'rub' ? '₽' : v.currency;
      if (v.payment_from && v.payment_to) salary = `${fmt(v.payment_from)} – ${fmt(v.payment_to)} ${cur}`;
      else if (v.payment_from)            salary = `от ${fmt(v.payment_from)} ${cur}`;
      else                                salary = `до ${fmt(v.payment_to)} ${cur}`;
    }
    return {
      id:          `sj_${v.id}`,
      source:      'sj',
      sourceName:  'SuperJob',
      title:       v.profession,
      company:     v.firm_name || '',
      logo:        v.logo?.['90'] || v.client?.logo?.['90'] || null,
      salary,
      city:        v.town?.title || '',
      experience:  v.experience?.title || '',
      schedule:    v.type_of_work?.title || '',
      snippet:     (v.vacancyRichText || v.work || '').replace(/<[^>]+>/g, '').slice(0, 250),
      url:         v.link,
      publishedAt: new Date(v.date_published * 1000).toISOString(),
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('ru');
}

function cleanSnippet(snippet) {
  if (!snippet) return '';
  const parts = [snippet.requirement, snippet.responsibility].filter(Boolean);
  return parts.join(' · ').replace(/<[^>]+>/g, '').slice(0, 250);
}

function mergeAndSort(hhItems, sjItems) {
  const all = [...hhItems, ...sjItems];
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all;
}

// ─── Handler ─────────────────────────────────────────────────────────
export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  const params = event.queryStringParameters || {};
  const role   = params.role   || 'sa';
  const level  = params.level  || 'all';
  const city   = params.city   || 'all';

  try {
    const [hhItems, sjItems] = await Promise.allSettled([
      fetchHH(role, level, city),
      fetchSJ(role, level, city),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

    const items = mergeAndSort(hhItems, sjItems);

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                 'application/json',
        'Access-Control-Allow-Origin':  '*',
        'Cache-Control':                'public, max-age=300', // кэш 5 минут
      },
      body: JSON.stringify({
        items,
        total:   items.length,
        sources: {
          hh: hhItems.length,
          sj: sjItems.length,
        },
      }),
    };

  } catch (err) {
    console.error('Jobs function error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
