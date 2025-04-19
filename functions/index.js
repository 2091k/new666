addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const BASE_URL = 'http://www.cbbnb.com';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36',
  'Referer': BASE_URL + '/'
};

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword');
    const id = url.searchParams.get('id');

    if (id) {
      const detail = await crawlDetail(id);
      if (!detail) {
        return new Response(JSON.stringify({ error: '未找到对应ID的数据' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
      }
      return new Response(JSON.stringify({
        code: 1,
        msg: '数据详情',
        list: [detail]
      }, null, 2), {
        headers: { 'Content-Type': 'application/json;charset=UTF-8' }
      });
    }

    if (keyword) {
      const searchUrl = BASE_URL + '/search.php';
      const form = new URLSearchParams();
      form.set('searchword', keyword);

      const searchResp = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          ...DEFAULT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString()
      });
      const searchHtml = await searchResp.text();
      const doc = new DOMParser().parseFromString(searchHtml, 'text/html');
      const links = Array.from(doc.querySelectorAll('a[href^="/view/"]'));
      const ids = links.map(a => {
        const match = a.getAttribute('href').match(/\/view\/(\d+)\.html/);
        return match ? match[1] : null;
      }).filter(Boolean);
      const uniqueIds = Array.from(new Set(ids));

      if (uniqueIds.length === 0) {
        return new Response(JSON.stringify({
          code: 1,
          msg: '没有找到相关数据',
          page: 1,
          pagecount: 1,
          limit: '20',
          total: 0,
          list: []
        }, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
      }

      const list = await Promise.all(uniqueIds.map(async (vid) => {
        const url = `${BASE_URL}/view/${vid}.html`;
        const resp = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!resp.ok) {
          return {
            vod_id: vid,
            vod_name: '',
            vod_pic: '',
            vod_play_from: '',
            vod_play_url: ''
          };
        }
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        let title = '未知剧集';
        const titleTag = doc.querySelector('title');
        if (titleTag) {
          const raw = titleTag.textContent;
          const extracted = raw.split('《')[1]?.split('》')[0] || raw;
          title = extracted.replace(/电视剧|电影|动漫/g, '').trim();
        }

        const picEl = doc.querySelector('[data-original]');
        const vodPic = picEl ? picEl.getAttribute('data-original') : '';

        return {
          vod_id: vid,
          vod_name: title,
          vod_pic: vodPic,
          vod_play_from: '',
          vod_play_url: ''
        };
      }));

      const result = {
        code: 1,
        msg: '数据列表',
        page: 1,
        pagecount: 1,
        limit: '20',
        total: list.length,
        list
      };
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json;charset=UTF-8' }
      });
    }

    return new Response(JSON.stringify({ error: '请提供 keyword 或 id 参数。例如: ?keyword=棋士 或 ?id=36010' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  } catch (error) {
    console.error('发生未知错误:', error);
    return new Response(JSON.stringify({ error: `发生未知错误: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
}

async function crawlDetail(videoId) {
  try {
    const url = `${BASE_URL}/view/${videoId}.html`;
    const resp = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!resp.ok) return null;
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let title = '未知剧集';
    const titleTag = doc.querySelector('title');
    if (titleTag) {
      const raw = titleTag.textContent;
      const extracted = raw.split('《')[1]?.split('》')[0] || raw;
      title = extracted.replace(/电视剧|电影|动漫/g, '').trim();
    }

    const picEl = doc.querySelector('[data-original]');
    const vodPic = picEl ? picEl.getAttribute('data-original') : '';

    const sources = {};
    const tabLinks = doc.querySelectorAll('.nav-tabs li a');

    for (const tab of tabLinks) {
      const tabId = tab.getAttribute('href')?.replace('#', '');
      const sourceName = tab.textContent.trim();
      const tabContent = doc.getElementById(tabId);
      const episodes = [];

      if (tabContent) {
        const epLinks = tabContent.querySelectorAll('.playlist a');
        for (const ep of epLinks) {
          const epPath = ep.getAttribute('href');
          const epName = ep.textContent.trim();
          const realUrl = await extractRealUrl(epPath);
          episodes.push({ name: epName, url: realUrl || null });
        }
      }

      sources[sourceName] = episodes;
    }

    const vodPlayFrom = Object.keys(sources).join('|');
    const vodPlayUrl = Object.values(sources)
      .map(list => list.map(ep => `${ep.name}$${ep.url || ''}`).join('|'))
      .join('$$$');

    return {
      vod_id: videoId,
      vod_name: title,
      vod_play_from: vodPlayFrom,
      vod_play_url: vodPlayUrl,
      vod_pic: vodPic
    };
  } catch (err) {
    console.error('crawlDetail 发生错误:', err);
    return null;
  }
}

async function extractRealUrl(path) {
  try {
    const fullUrl = path.startsWith('http') ? path : BASE_URL + path;
    const resp = await fetch(fullUrl, { headers: DEFAULT_HEADERS });
    if (!resp.ok) return null;
    const text = await resp.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const iframe = doc.querySelector('#playbox iframe');
    if (!iframe) return null;
    const src = iframe.getAttribute('src');
    return src?.startsWith('http') ? src : BASE_URL + src;
  } catch (err) {
    console.error('extractRealUrl 发生错误:', err);
    return null;
  }
}
