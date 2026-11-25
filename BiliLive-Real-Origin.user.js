// ==UserScript==
// @name         BiliLive真原画
// @version      2026.11.25.6
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
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_info
// @description
// ==/UserScript==

/** 加载 CN01 节点记录，并在直播播放器所在的页面安装请求拦截和控制台接口。 */
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
    const cn01GotchaPattern = /^[cd][01]--cn-gotcha01\.bilivideo\.com$/;
    const cn01RegionPattern = /cn(?:-[a-z]+){2}(?:-\d+){2}/;
    const specialStreamNames = new Map();
    const playInfoPath = '/xlive/web-room/v2/index/getRoomPlayInfo';
    // undefined 表示还未发出首次播放请求，null 表示首次请求缺少 room_id。
    let roomId;
    // 当前标签页只保存最终用于请求的原画流名和有效 sk。
    const stream = { streamName: null, sk: null };
    const scriptVersion = GM_info.script.version;
    let cn01Host = loadCn01Host();
    GM_addValueChangeListener('cdnHostMap', (_key, _oldValue, value, remote) => {
        if (remote) cn01Host = validHost(value?.Bili) ? value.Bili : null;
    });

    /** 检查主机字符串能否直接用于构造 HTTPS 媒体地址。 */
    function validHost(host) {
        if (typeof host !== 'string' || !host) return false;
        try {
            return new URL(`https://${host}`).host === host;
        } catch {
            return false;
        }
    }

    /** 读取已保存的 CN01，空记录返回 null，版本不匹配时先清空 GM 存储。 */
    function loadCn01Host() {
        try {
            if (GM_getValue('version', null) !== scriptVersion) {
                for (const key of GM_listValues()) {
                    GM_deleteValue(key);
                }
                GM_setValue('version', scriptVersion);
                return null;
            }
            const host = GM_getValue('cdnHostMap', null)?.Bili;
            return validHost(host) ? host : null;
        } catch (error) {
            console.log('[BiliLive真原画] 加载 CN01 节点失败', error);
            return null;
        }
    }

    /** 更新本页的 CN01 主机，值发生变化时同步写入节点记录。 */
    function setCn01Host(host) {
        if (cn01Host === host) return;
        try {
            GM_setValue('cdnHostMap', { Bili: host });
            cn01Host = host;
        } catch (error) {
            console.log('[BiliLive真原画] 保存 CN01 节点失败', error);
        }
    }

    /** CN01 包括 gotcha01 的四种主机前缀和 Bili 地区节点。 */
    function isCn01Host(host) {
        return cn01GotchaPattern.test(host) || cn01RegionPattern.test(host);
    }

    /** GM 没有已保存的主机时，从实际媒体来源学习 CN01。 */
    function learnCn01Host(host) {
        if (!isCn01Host(host)) return;
        // 其他标签页可能刚写入，变更通知尚未到达。
        try {
            const stored = GM_getValue('cdnHostMap', null)?.Bili;
            if (validHost(stored)) cn01Host = stored;
            else setCn01Host(host);
        } catch (error) {
            console.log('[BiliLive真原画] 读取 CN01 节点失败', error);
        }
    }

    /** 先归一化来源主机，再按累计百分比选路。只有选中腾讯路线才抽取节点后缀。 */
    function chooseCdnHost(host) {
        host = host.replace(/ov-gotcha([23]\d{2})(?!\d)/, 'cn-gotcha$1')
            .replace(/[cd][01]--cn-gotcha([23]\d{2})(?!\d)b?/g, 'd1--cn-gotcha$1');
        const routeRoll = Math.random() * 100;
        // 按累计上界从小到大判断。腾讯上界从 0 改为 10 即占 10%。
        if (routeRoll < 30) {
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
        } else if (routeRoll < 50) {
            return CdnHost.Baidu;
        } else if (routeRoll < 70) {
            return CdnHost.Huawei;
        } else if (routeRoll < 90) {
            return CdnHost.Aliyun;
        } else if (routeRoll < 101) {
            return cn01Host ?? CdnHost.Bili;
        }
        return host;
    }

    /** 固定 Bili 路线与百度分片使用请求 ID，查询参数从播放记录取值。 */
    function buildStreamUrl(host, mediaPath, useFixedBili) {
        const id = useFixedBili || /gotcha207b?\./i.test(host) ? requestId : '';
        const url = `https://${host}/live-bvc/${id}/${mediaPath}`;
        return stream.sk === null ? url : `${url}?sk=${encodeURIComponent(stream.sk)}`;
    }

    /** 按实际请求主机记录分片从发起到传输结束的耗时，包括重试的独立请求。 */
    function logSegmentTimings(list) {
        for (const entry of list.getEntries()) {
            if (entry.initiatorType !== 'fetch' || !entry.name.includes('/live-bvc/')) continue;
            const url = new URL(entry.name);
            const file = /^\/live-bvc\/(?:000000)?\/live_[^/]+\/([^/]+\.m4s)$/i.exec(url.pathname)?.[1];
            if (!file) continue;
            const status = entry.responseStatus ? ` HTTP ${entry.responseStatus}` : '';
            const cached = entry.deliveryType === 'cache' ? '（缓存）' : '';
            console.log(`[BiliLive真原画] ${file} <- ${url.host} ${Math.round(entry.duration)}ms${status}${cached}`);
        }
    }
    const timingSetting = 'segmentTimingEnabled';
    let timingObserver = null;
    let timingMenuId;

    /** 启停完整分片计时，并将同一菜单项更新为下一次可执行的操作。 */
    function setSegmentTiming(enabled) {
        if (enabled && !timingObserver) {
            timingObserver = new PerformanceObserver(logSegmentTimings);
            timingObserver.observe({ entryTypes: ['resource'] });
        } else if (!enabled && timingObserver) {
            timingObserver.disconnect();
            timingObserver = null;
        }
        const label = enabled ? '关闭分片耗时统计' : '开启分片耗时统计';
        timingMenuId = GM_registerMenuCommand(label, () => GM_setValue(timingSetting, !enabled), { id: timingMenuId });
    }

    GM_addValueChangeListener(timingSetting, (_key, _oldValue, value) => setSegmentTiming(value === true));
    setSegmentTiming(GM_getValue(timingSetting, false) === true);

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
    /** 调整播放格式，按 live-bvc 媒体请求选路，跟随重定向后按最终状态决定是否重试。 */
    unsafeWindow.fetch = async function (input, init) {
        let url;
        try {
            url = new URL(input?.url ?? input, document.baseURI);
        } catch {
            return originalFetch.apply(this, arguments);
        }

        /** 替换目标 URL，并将原 Request 的选项和调用方的 init 传给原生 fetch。 */
        const fetchAt = (targetUrl, options = init) => {
            const target = typeof input?.url === 'string' ? new unsafeWindow.Request(targetUrl, input) : targetUrl;
            return originalFetch.call(this, target, options);
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
        if (cn01Host === null) learnCn01Host(url.hostname);
        stream.streamName ??= getOriginStreamName(url);
        const sk = url.searchParams.get('sk');
        if (sk && /^[0-9a-z]{32}$/.test(sk)) stream.sk = sk;
        const mediaPath = `${stream.streamName}/${file}`;
        const useFixedBili = isPlaylist || /^h\d+\.m4s$/.test(file);
        const host = useFixedBili ? CdnHost.Bili : chooseCdnHost(url.hostname);
        // 继承调用方的 RequestInit，仅覆盖媒体请求的重定向模式。
        const mediaInit = Object.create(init ?? null, { redirect: { value: 'follow' } });
        const response = await fetchAt(buildStreamUrl(host, mediaPath, useFixedBili), mediaInit);
        // 可跟随的重定向已由 fetch 处理；原样返回 2xx 及没有下一跳的 3xx。
        if (response.status >= 200 && response.status < 400) return response;

        response.body?.cancel().catch(console.debug);
        const retryHost = useFixedBili ? CdnHost.Bili : (cn01Host ?? CdnHost.Bili);
        if (!isPlaylist) {
            console.log(`[BiliLive真原画] ${file} <- ${host} HTTP ${response.status}，重试 ${retryHost}`);
        }
        return fetchAt(buildStreamUrl(retryHost, mediaPath, useFixedBili), mediaInit);
    };

    unsafeWindow.BiliLiveCDN = {
        /** 返回当前节点配置的副本，Bili 字段为当前 CN01 主机。 */
        getCdnConfig: () => ({ ...CdnHost, Bili: cn01Host ?? CdnHost.Bili }),
        /** 将自定义或学习到的 CN01 主机重置为内置默认值。 */
        resetCdnConfig() {
            setCn01Host(null);
            return { ...CdnHost };
        },
        /** 手动设置并保存 CN01 主机，返回是否接受该设置。 */
        setCdnHost(type, host) {
            if (type !== 'Bili' || !validHost(host)) return false;
            setCn01Host(host);
            return true;
        },
    };
})();
