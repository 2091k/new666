import cheerio from 'cheerio';

async function extractRealVideoUrl(session, episodePath) {
    const fullUrl = `http://www.cbbnb.com${episodePath}`;
    try {
        const response = await session.get(fullUrl);
        if (response.status !== 200) {
            return null;
        }
        const $ = cheerio.load(await response.text());
        const iframe = $('#playbox iframe');
        return iframe.attr('src') || null;
    } catch (error) {
        console.error('提取视频地址异常:', error);
        return null;
    }
}

async function fetchVideoInfo(videoId) {
    const session = {
        get: async (url) => {
            return fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'http://www.cbbnb.com/'
                }
            });
        }
    };

    const url = `http://www.cbbnb.com/view/${videoId}.html`;
    const response = await session.get(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // 提取标题
    let title = $('title').text().split('《').pop().split('》')[0];
    ['电视剧', '电影', '动漫'].forEach(kw => title = title.replace(kw, ''));

    // 提取封面
    const vodPic = $('img[data-original]').attr('data-original') || '';

    // 处理播放源
    const sources = {};
    $('ul.nav.nav-tabs.pull-right li').each((i, tab) => {
        const sourceName = $(tab).text().trim();
        const targetId = $(tab).find('a').attr('href').replace('#', '');
        const container = $(`#${targetId}`);
        if (container.length) {
            const episodes = [];
            container.find('ul.stui-content__playlist a').each(async (j, a) => {
                const episodePath = $(a).attr('href');
                episodes.push({
                    name: $(a).text().trim(),
                    path: episodePath
                });
            });
            sources[sourceName] = episodes;
        }
    });

    // 处理异步获取真实视频地址
    for (const [sourceName, episodes] of Object.entries(sources)) {
        const episodesWithUrl = await Promise.all(
            episodes.map(async ep => ({
                ...ep,
                url: await extractRealVideoUrl(session, ep.path)
            }))
        );
        sources[sourceName] = episodesWithUrl.filter(ep => ep.url);
    }

    // 构建结果对象
    const vod = {
        vod_id: videoId,
        vod_name: title,
        vod_play_from: Object.keys(sources).join('|'),
        vod_play_url: Object.values(sources).map(episodes => 
            episodes.map(ep => `${ep.name}$${ep.url}`).join('|')
        ).join('$$$'),
        vod_pic: vodPic
    };

    return vod;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const videoId = url.searchParams.get('id');
        
        if (!videoId) {
            return new Response(JSON.stringify({
                code: 0,
                msg: '缺少视频ID参数'
            }), { 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        try {
            const vod = await fetchVideoInfo(videoId);
            const result = {
                code: 1,
                msg: "数据列表",
                page: 1,
                pagecount: 1,
                limit: "20",
                total: 1,
                list: [vod]
            };
            
            return new Response(JSON.stringify(result, null, 2), {
                headers: { 
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*' 
                }
            });
        } catch (error) {
            console.error('处理请求时出错:', error);
            return new Response(JSON.stringify({
                code: 0,
                msg: '获取视频信息失败'
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' } 
            });
        }
    }
};
