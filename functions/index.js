import { parse } from 'node-html-parser';
import cheerio from 'cheerio';
import { request } from 'undici';

const BASE_URL = 'http://www.cbbnb.com';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36',
  'Referer': BASE_URL + '/'
};

export async function onRequest({ request }) {
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
    return new Response(JSON.stringify({ code: 1, msg: '数据详情', list: [detail] }, null, 2), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }

  if (keyword) {
    return await searchByKeyword(keyword);
  }

  return new Response(JSON.stringify({ error: '请提供 keyword 或 id 参数。例如: ?keyword=棋士 或 ?id=36010' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}

async function searchByKeyword(keyword) {
  const searchUrl = BASE_URL + '/search.php';
  const form = new URLSearchParams({ searchword: keyword });

  const searchResp = await request(searchUrl, {
    method: 'POST',
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  });
  const searchHtml = await searchResp.body.text();
  const $ = cheerio.load(searchHtml);
  const ids = [];

  $('a[href^="/view/"]').each((_, el) => {
    const href = $(el).attr('href');
    const match = href.match(/\/view\/(\d+)\.html/);
    if (match) ids.push(match[1]);
  });

  const uniqueIds = [...new Set(ids)];

  const list = await Promise.all(uniqueIds.map(async vid => {
    try {
      const resp = await request(`${BASE_URL}/view/${vid}.html`, { headers: DEFAULT_HEADERS });
      const html = await resp.body.text();
      const $ = cheerio.load(html);

      const rawTitle = $('title').text();
      const extracted = rawTitle.split('《')[1]?.split('》')[0] || rawTitle;
      const title = extracted.replace(/电视剧|电影|动漫/g, '').trim();

      const pic = $('img[data-original]').attr('data-original') || '';

      return {
        vod_id: vid,
        vod_name: title || '未知剧集',
        vod_pic: pic,
        vod_play_from: '',
        vod_play_url: ''
      };
    } catch (e) {
      return {
        vod_id: vid,
        vod_name: '',
        vod_pic: '',
        vod_play_from: '',
        vod_play_url: ''
      };
    }
  }));

  return new Response(JSON.stringify({
    code: 1,
    msg: '数据列表',
    page: 1,
    pagecount: 1,
    limit: '20',
    total: list.length,
    list
  }, null, 2), {
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
}

async function crawlDetail(videoId) {
  try {
    const resp = await request(`${BASE_URL}/view/${videoId}.html`, { headers: DEFAULT_HEADERS });
    const html = await resp.body.text();
    const $ = cheerio.load(html);

    const rawTitle = $('title').text();
    const title = rawTitle.split('《')[1]?.split('》')[0].replace(/电视剧|电影|动漫/g, '').trim();

    const vodPic = $('img[data-original]').attr('data-original') || '';

    const sources = {};
    $('ul.nav-tabs li a').each((_, el) => {
      const tabId = $(el).attr('href')?.replace('#', '');
      const sourceName = $(el).text().trim();
      const tabContent = $(`#${tabId}`);
      const episodes = [];

      tabContent.find('ul.playlist a').each((_, a) => {
        const epName = $(a).text().trim();
        const epPath = $(a).attr('href');
        episodes.push({ name: epName, url: epPath ? BASE_URL + epPath : null });
      });

      sources[sourceName] = episodes;
    });

    const vodPlayFrom = Object.keys(sources).join('|');
    const vodPlayUrl = Object.values(sources)
      .map(list => list.map(ep => `${ep.name}$${ep.url || ''}`).join('|'))
      .join('$$$');

    return {
      vod_id: videoId,
      vod_name: title || '未知剧集',
      vod_play_from: vodPlayFrom,
      vod_play_url: vodPlayUrl,
      vod_pic: vodPic
    };
  } catch (err) {
    console.error('crawlDetail 失败:', err);
    return null;
  }
}
