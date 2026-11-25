// ==UserScript==
// @name         BiliLive真原画
// @version      2026.11.25
// @author       AsakiSama
// @match        https://live.bilibili.com/*
// @match        https://www.bilibili.com/blackboard/live/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_info
// @description
// ==/UserScript==

/** 加载 Bili 节点记录，并在直播播放器所在的页面安装请求拦截和控制台接口。 */
(() => {
    const CdnHost = Object.freeze({
        Bili: 'd0--cn-gotcha01.bilivideo.com',
        Tencent: 'd1--cn-gotcha204.bilivideo.com',
        Baidu: 'd1--cn-gotcha207.bilivideo.com',
        Huawei: 'd1--cn-gotcha208.bilivideo.com',
        Aliyun: 'd1--cn-gotcha209.bilivideo.com',
    });
    const requestId = '000000';
    const biliGotcha01Pattern = /^[cd][01]--cn-gotcha01\.bilivideo\.com$/;
    const biliRegionPattern = /cn(?:-[a-z]+){2}(?:-\d+){2}/;
    const specialStreamNames = new Map();
    // 此页面实例的播放记录，刷新时随脚本一起重建。
    const playingStreams = [];
    const scriptVersion = GM_info.script.version;
    let biliHost = loadBiliHost();
    let learnedBiliHost = false;

    /** 检查主机字符串能否直接用于构造 HTTPS 媒体地址。 */
    function validHost(host) {
        if (typeof host !== 'string' || !host) return false;
        try {
            return new URL(`https://${host}`).host === host;
        } catch {
            return false;
        }
    }

    /** 一次写入脚本版本和 Bili 主机，null 表示使用内置默认值。 */
    function saveBiliHost(host) {
        try {
            GM_setValue('cdnHostMap', { version: scriptVersion, Bili: host });
        } catch (error) {
            console.log('[BiliLive真原画] 保存 Bili 节点失败', error);
        }
    }

    /** 升级时清空无版本号的记录，保留带版本号的有效节点。 */
    function loadBiliHost() {
        try {
            const stored = GM_getValue('cdnHostMap', null);
            const host = stored?.version && validHost(stored.Bili) ? stored.Bili : null;
            if (stored?.version !== scriptVersion || stored?.Bili !== host) {
                saveBiliHost(host);
            }
            return host ?? CdnHost.Bili;
        } catch (error) {
            console.log('[BiliLive真原画] 加载 Bili 节点失败', error);
            return CdnHost.Bili;
        }
    }

    /** 更新本页的 Bili 主机，值发生变化时同步写入节点记录。 */
    function setBiliHost(host) {
        if (biliHost !== host) {
            biliHost = host;
            saveBiliHost(host === CdnHost.Bili ? null : host);
        }
    }

    /** CN01 包括 gotcha01 的四种主机前缀和 Bili 地区节点。 */
    function isCn01Host(host) {
        return biliGotcha01Pattern.test(host) || biliRegionPattern.test(host);
    }

    /** 从改写前的请求学习本页遇到的首个 CN01 节点。 */
    function learnBiliHost(host) {
        if (!learnedBiliHost && isCn01Host(host)) {
            learnedBiliHost = true;
            setBiliHost(host);
        }
    }

    /** 先归一化来源主机，再按累计百分比选路。只有选中腾讯路线才抽取节点后缀。 */
    function chooseCdnHost(host) {
        host = host.replace(/ov-gotcha([23]\d{2})(?!\d)/, 'cn-gotcha$1')
            .replace(/[cd][01]--cn-gotcha([23]\d{2})(?!\d)b?/g, 'd1--cn-gotcha$1');
        const routeRoll = Math.random() * 100;
        // 按累计上界从小到大判断。腾讯上界从 0 改为 10 即占 10%。
        if (routeRoll < 0) {
            const suffixRoll = Math.random() * 100;
            let suffix;
            if (suffixRoll < 20) {
                suffix = '-1';
            } else if (suffixRoll < 40) {
                suffix = '-2';
            } else if (suffixRoll < 60) {
                suffix = '-3';
            } else if (suffixRoll < 80) {
                suffix = '-4';
            } else {
                suffix = '';
            }
            return CdnHost.Tencent.replace(/gotcha204(?:-\d+|b)?(?=\.bilivideo\.com$)/i, `gotcha204${suffix}`);
        } else if (routeRoll < 25) {
            return CdnHost.Baidu;
        } else if (routeRoll < 50) {
            return CdnHost.Huawei;
        } else if (isCn01Host(host)) {
            return biliHost;
        } else {
            return host;
        }
    }

    /** 按目标节点生成媒体地址，仅在播放记录中已有 sk 时追加查询参数。 */
    function buildStreamUrl(host, mediaPath, isPlaylist, stream) {
        const id = isPlaylist || /gotcha207b?\./i.test(host) ? requestId : '';
        const url = `https://${host}/live-bvc/${id}/${mediaPath}`;
        return stream.sk === null ? url : `${url}?sk=${encodeURIComponent(stream.sk)}`;
    }

    /** 普通房间页维护当前房间的播放记录，活动页按媒体路径中的流名区分播放器。 */
    function resolveStream(roomId, rawName, params) {
        let stream = pageRoom ? playingStreams[0] : playingStreams.find(item =>
            (item.rawName === rawName || item.name === rawName) &&
            !(roomId && item.roomId && roomId !== item.roomId));
        if (!stream) {
            stream = { roomId, rawName, name: rawName, sk: null };
            playingStreams.push(stream);
        } else if (rawName !== stream.rawName && rawName !== stream.name) {
            stream.rawName = rawName;
            stream.name = rawName;
        }
        if (roomId) stream.roomId = roomId;
        const special = specialStreamNames.get(roomId);
        const suffix = params.get('suffix');
        if (special) stream.name = special;
        else if (stream.name === rawName && suffix && !['origin', 'uhd', 'maxhevc', 'maxhdr'].includes(suffix)) {
            stream.name = rawName.replace(`_${suffix}`, '');
        }
        stream.sk = params.get('sk') || stream.sk;
        return stream;
    }

    const pageRoom = location.hostname === 'live.bilibili.com'
        && /^\/(?:blanc\/)?(\d+)(?:\/|$)/.exec(location.pathname)?.[1];
    // Event Page：活动页本身和嵌入的直播播放器都可能发起媒体请求。
    // const isEventPage = location.hostname === 'www.bilibili.com' && location.pathname.startsWith('/blackboard/live/');
    const isEventPage = false;
    const isLiveFrame = location.hostname === 'live.bilibili.com' && unsafeWindow.top !== unsafeWindow;

    if (pageRoom || isEventPage || isLiveFrame) {
        const originalFetch = unsafeWindow.fetch;
        /** 调整播放格式，按 live-bvc 媒体请求选路，并为非 200 响应重试一次。 */
        unsafeWindow.fetch = async function (input, init) {
            let url;
            try {
                url = new URL(input?.url ?? input, document.baseURI);
            } catch {
                return originalFetch.apply(this, arguments);
            }

            /** 替换目标 URL，并将原 Request 的选项和调用方的 init 传给原生 fetch。 */
            const fetchAt = (targetUrl) => {
                const target = typeof input?.url === 'string' ? new unsafeWindow.Request(targetUrl, input) : targetUrl;
                return originalFetch.call(this, target, init);
            };

            if (url.pathname === '/xlive/web-room/v2/index/getRoomPlayInfo') {
                const target = url.href.replace(/([?&])format=0(?:,|%2c)1(?:,|%2c)2(?=[&#]|$)/i, '$1format=0,2');
                return fetchAt(target);
            }

            const media = /\.(m3u8|m4s)$/i.exec(url.pathname);
            if (!media || !url.hostname.endsWith('.bilivideo.com')) return originalFetch.apply(this, arguments);

            const rawName = /^\/live-bvc\/(?:\d*\/)?(live_[^./]+)/.exec(url.pathname)?.[1];
            if (!rawName) return originalFetch.apply(this, arguments);
            // Event Page：沿用媒体 URL 上显式的房间参数。后续获取 roomId 的方式待确定。
            const room = pageRoom || url.searchParams.get('room_id') || url.searchParams.get('roomid');
            learnBiliHost(url.hostname);
            const stream = resolveStream(room, rawName, url.searchParams);
            const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
            const mediaPath = `${stream.name}/${file}`;
            const isPlaylist = media[1].toLowerCase() === 'm3u8';
            const host = isPlaylist ? CdnHost.Bili : chooseCdnHost(url.hostname);
            const response = await fetchAt(buildStreamUrl(host, mediaPath, isPlaylist, stream));
            if (!isPlaylist) {
                console.log(`[BiliLive真原画] ${file} <- ${host} HTTP ${response.status}`);
            }
            if (response.status !== 200) {
                // 重试会丢弃本次响应，及时停止下载剩余内容。
                response.body?.cancel().catch(console.debug);
                const retryHost = isPlaylist ? CdnHost.Bili : biliHost;
                return fetchAt(buildStreamUrl(retryHost, mediaPath, isPlaylist, stream));
            }
            return response;
        };
    }

    unsafeWindow.BiliLiveCDN = {
        /** 返回当前节点配置的副本，包含实际配置的 Bili 主机。 */
        getCdnConfig: () => ({ ...CdnHost, Bili: biliHost }),
        /** 将自定义或学习到的 Bili 主机重置为内置默认值。 */
        resetCdnConfig() {
            setBiliHost(CdnHost.Bili);
            return { ...CdnHost };
        },
        /** 手动设置并保存 Bili 主机，返回是否接受该设置。 */
        setCdnHost(type, host) {
            if (type !== 'Bili' || !validHost(host)) return false;
            setBiliHost(host);
            return true;
        },
    };
})();
