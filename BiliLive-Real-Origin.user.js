// ==UserScript==
// @name         BiliLive真原画
// @version      2026.11.25.3
// @author       AsakiSama
// @match        https://live.bilibili.com/*
// @match        https://www.bilibili.com/blackboard/live/*
// @exclude      /^https:\/\/live\.bilibili\.com\/(?:[?#].*)?$/
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_info
// @description
// ==/UserScript==

/** 加载 Bili 节点记录，并在直播播放器所在的页面安装请求拦截和控制台接口。 */
(() => {
    if (location.hostname === 'live.bilibili.com' && location.pathname === '/') return;

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
    const playInfoPath = '/xlive/web-room/v2/index/getRoomPlayInfo';
    // undefined 表示还未发出首次播放请求，null 表示首次请求缺少 room_id。
    let roomId;
    // 当前标签页只保存最终用于请求的原画流名和有效 sk。
    const stream = { streamName: null, sk: null };
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

    /** 顶层版本一致时加载节点，否则清空本脚本的 GM 存储并使用默认节点。 */
    function loadBiliHost() {
        try {
            if (GM_getValue('version', null) !== scriptVersion) {
                for (const key of GM_listValues()) {
                    GM_deleteValue(key);
                }
                GM_setValue('version', scriptVersion);
                return CdnHost.Bili;
            }
            const host = GM_getValue('cdnHostMap', null)?.Bili;
            return validHost(host) ? host : CdnHost.Bili;
        } catch (error) {
            console.log('[BiliLive真原画] 加载 Bili 节点失败', error);
            return CdnHost.Bili;
        }
    }

    /** 更新本页的 Bili 主机，值发生变化时同步写入节点记录。 */
    function setBiliHost(host) {
        if (biliHost === host) return;
        biliHost = host;
        try {
            GM_setValue('cdnHostMap', { Bili: host === CdnHost.Bili ? null : host });
        } catch (error) {
            console.log('[BiliLive真原画] 保存 Bili 节点失败', error);
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

    /** 固定 Bili 路线与百度分片使用请求 ID，查询参数从播放记录取值。 */
    function buildStreamUrl(host, mediaPath, useFixedBili) {
        const id = useFixedBili || /gotcha207b?\./i.test(host) ? requestId : '';
        const url = `https://${host}/live-bvc/${id}/${mediaPath}`;
        return stream.sk === null ? url : `${url}?sk=${encodeURIComponent(stream.sk)}`;
    }

    /** 从首次播放信息请求锁定房间号，并应用该房间的显式流名配置。 */
    function readRoomId(url) {
        roomId = url.searchParams.get('room_id');
        const specialStreamName = specialStreamNames.get(roomId);
        if (specialStreamName) stream.streamName = specialStreamName;
    }

    /** 从首次合格媒体请求取得原画流名，四种原画后缀保留，转码后缀从末尾移除。 */
    function getOriginStreamName(url) {
        const streamName = /\/(live_[^./]+)/.exec(url.pathname)[1];
        const suffix = url.searchParams.get('suffix');
        if (!suffix || ['origin', 'uhd', 'maxhevc', 'maxhdr'].includes(suffix)) return streamName;
        const ending = `_${suffix}`;
        return streamName.endsWith(ending) ? streamName.slice(0, -ending.length) : streamName;
    }

    // XHR 的 open 可以重复调用，以实际 send 的顺序确定首次播放请求。
    if (unsafeWindow.XMLHttpRequest) {
        const prototype = unsafeWindow.XMLHttpRequest.prototype;
        const originalOpen = prototype.open;
        const originalSend = prototype.send;
        const pendingPlayInfo = new WeakMap();
        /** 记录本次 open 的播放接口地址，复用 XHR 时替换上一次的地址。 */
        prototype.open = function (method, input) {
            const result = originalOpen.apply(this, arguments);
            if (roomId === undefined) {
                pendingPlayInfo.delete(this);
                if (String(input).includes('getRoomPlayInfo')) {
                    const url = new URL(input, document.baseURI);
                    if (url.pathname === playInfoPath) pendingPlayInfo.set(this, url);
                }
            }
            return result;
        };
        /** 仅在首次发出播放信息请求时读取 room_id。 */
        prototype.send = function () {
            if (roomId === undefined && pendingPlayInfo.has(this)) {
                readRoomId(pendingPlayInfo.get(this));
            }
            return originalSend.apply(this, arguments);
        };
    }

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

        if (url.pathname === playInfoPath) {
            if (roomId === undefined) readRoomId(url);
            const target = url.href.replace(/([?&])format=0(?:,|%2c)1(?:,|%2c)2(?=[&#]|$)/i, '$1format=0,2');
            return fetchAt(target);
        }

        const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
        const isPlaylist = file === 'index.m3u8';
        if (!url.hostname.endsWith('.bilivideo.com') || (!isPlaylist && !/\.m4s$/i.test(file))) {
            return originalFetch.apply(this, arguments);
        }

        if (!/^\/live-bvc\/(?:\d*\/)?live_[^./]/.test(url.pathname)) return originalFetch.apply(this, arguments);
        learnBiliHost(url.hostname);
        stream.streamName ??= getOriginStreamName(url);
        const sk = url.searchParams.get('sk');
        if (sk && /^[0-9a-z]{32}$/.test(sk)) stream.sk = sk;
        const mediaPath = `${stream.streamName}/${file}`;
        const useFixedBili = isPlaylist || /^h\d+\.m4s$/.test(file);
        const host = useFixedBili ? CdnHost.Bili : chooseCdnHost(url.hostname);
        const response = await fetchAt(buildStreamUrl(host, mediaPath, useFixedBili));
        if (!isPlaylist) {
            console.log(`[BiliLive真原画] ${file} <- ${host} HTTP ${response.status}`);
        }
        if (response.status !== 200) {
            // 重试会丢弃本次响应，及时停止下载剩余内容。
            response.body?.cancel().catch(console.debug);
            const retryHost = useFixedBili ? CdnHost.Bili : biliHost;
            return fetchAt(buildStreamUrl(retryHost, mediaPath, useFixedBili));
        }
        return response;
    };

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
