// ==UserScript==
// @name         BiliLive真原画
// @version      2025.05.25
// @author       AsakiSama
// @match        https://live.bilibili.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @description
// ==/UserScript==

const streamNameCache = new Map();

// 默认 CDN 配置
const defaultCdnHostMap = {
    Bili: 'd0--cn-gotcha01.bilivideo.com',
    Tencent: 'd1--cn-gotcha204.bilivideo.com',
    Baidu: 'd1--cn-gotcha207.bilivideo.com',
    Huawei: 'd1--cn-gotcha208.bilivideo.com',
    Aliyun: 'd1--cn-gotcha209.bilivideo.com',
}

// 从存储中加载 CDN 配置，如果没有则使用默认配置
function loadCdnHostMap() {
    try {
        const stored = GM_getValue('cdnHostMap', null);
        if (stored) {
            const parsed = JSON.parse(stored);
            // 合并默认配置和存储的配置，确保所有必要的键都存在
            return { ...defaultCdnHostMap, ...parsed };
        }
    } catch (e) {
        console.log('加载CDN配置失败:', e);
    }
    return { ...defaultCdnHostMap };
}

// 保存 CDN 配置到存储
function saveCdnHostMap(cdnHostMap) {
    try {
        GM_setValue('cdnHostMap', JSON.stringify(cdnHostMap));
        console.log('CDN配置已保存:', cdnHostMap);
    } catch (e) {
        console.log('保存CDN配置失败:', e);
    }
}

// 初始化 CDN 配置
let cdnHostMap = loadCdnHostMap();

const cdnHostPattern = {
    Any: /([a-z0-9\-]+\.bilivideo\.com)/,
    Bili: /cn(-[a-z]+){2}(-\d+){2}/,
    Tencent: /gotcha204(b|-[1234])?\./,
    Baidu: /gotcha207b?\./,
    Huawei: /gotcha208b?\./,
    Aliyun: /gotcha209b?\./,
}

function getOriginStreamName(url) {
    const suffix = /suffix=([^&]+)/.exec(url)?.[1];
    let streamName = /\/live-bvc\/\d+\/(live_[^./]+)/.exec(url)?.[1];
    if (streamName) {
        if (suffix && suffix !== 'origin') {
            streamName = streamName.replace(`_${suffix}`, '');
        }
        return streamName;
    }
    return null;
}

function getRoomId() {
    return /live\.bilibili\.com\/(?:blanc\/)?(\d+)/.exec(location.href)?.[1];
}

function buildStreamUrl(host, streamName, requestFile) {
    const path1 = cdnHostPattern.Bili.test(host) ?
        'live-bvc' :
        'live-bvc/000000';
    return `https://${host}/${path1}/${streamName}/${requestFile}`;
}

function getRequestFile(url) {
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1].split('?')[0];
}

const hlsPattern = /\.(?:m4s|m3u8)/;

if (location.href.startsWith('https://live.bilibili.com/')) {
    const oldFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function (url) {
        try {
            // 检查 url 类型并标准化
            const urlString = typeof url === 'string' ? url : String(url);

            const isGetRoomPlayInfo = urlString.includes('/xlive/web-room/v2/index/getRoomPlayInfo');
            if (isGetRoomPlayInfo) {
                // 不请求 HLS-TS
                arguments[0] = urlString.replace(`&protocol=0,1`, '&protocol=0,1').replace('&format=0,1,2', '&format=0,2')
                return oldFetch.apply(this, arguments);
            }

            // 检查是否是 .m4s 或 .m3u8 文件
            if (!hlsPattern.test(urlString)) return oldFetch.apply(this, arguments);

            const roomId = getRoomId();
            if (!roomId) return oldFetch.apply(this, arguments);

            // 获取 cdnHost
            const cdnHostMatch = cdnHostPattern.Any.exec(urlString);
            if (!cdnHostMatch) return oldFetch.apply(this, arguments);
            let cdnHost = cdnHostMatch[1]
                .replace('ov-gotcha20', 'cn-gotcha20')
                .replaceAll(/(?:c1|c0|d0|d1)--cn-gotcha20(\d)b?/g, 'd1--cn-gotcha20$1');

            // 更新内置 CN01 节点并保存
            if (cdnHostPattern.Bili.test(cdnHost) && cdnHostMap.Bili !== cdnHost) {
                cdnHostMap.Bili = cdnHost;
                saveCdnHostMap(cdnHostMap);
                console.log('更新Bili节点:', cdnHost);
            }

            // Aliyun 大概是转推，延迟多约 2s；Tencent 即便不跨省，晚高峰卡顿严重
            if (cdnHostPattern.Aliyun.test(cdnHost) || cdnHostPattern.Tencent.test(cdnHost)) {
                cdnHost = Math.random() > 0.5 ? cdnHostMap.Baidu : cdnHostMap.Huawei;
            }

            // 获取 streamName 并缓存
            const originStreamName = getOriginStreamName(urlString);
            if (!originStreamName) return oldFetch.apply(this, arguments);
            if (!streamNameCache.has(roomId)) {
                streamNameCache.set(roomId, originStreamName)
            }

            const requestFile = getRequestFile(urlString);

            // 替换请求
            if (streamNameCache.has(roomId)) {
                const host = /^\D/.test(requestFile) ? cdnHostMap.Bili : cdnHost;
                arguments[0] = buildStreamUrl(host, streamNameCache.get(roomId), requestFile)
                const promise = oldFetch.apply(this, arguments);
                return promise.then(async response => {
                    const clonedResponse = response.clone();
                    if ([404].includes(clonedResponse.status)) {
                        // 替换 404 请求到 CN01
                        const retryUrl = buildStreamUrl(cdnHostMap.Bili, streamNameCache.get(roomId), requestFile);
                        return await oldFetch(retryUrl);
                    }
                    return clonedResponse;
                });
            }

            return oldFetch.apply(this, arguments);
        } catch (e) {
            console.log("原画=========", e)
            return oldFetch.apply(this, arguments);
        }
    }
}

// 提供全局方法用于查看和重置CDN配置（可在控制台调用）
unsafeWindow.BiliLiveCDN = {
    // 查看当前CDN配置
    getCdnConfig: () => {
        console.log('当前CDN配置:', cdnHostMap);
        return cdnHostMap;
    },
    // 重置CDN配置为默认值
    resetCdnConfig: () => {
        cdnHostMap = { ...defaultCdnHostMap };
        saveCdnHostMap(cdnHostMap);
        console.log('CDN配置已重置为默认值');
        return cdnHostMap;
    },
    // 手动设置CDN节点
    setCdnHost: (type, host) => {
        if (cdnHostMap.hasOwnProperty(type)) {
            cdnHostMap[type] = host;
            saveCdnHostMap(cdnHostMap);
            console.log(`${type}节点已更新为: ${host}`);
            return true;
        } else {
            console.log('无效的CDN类型，支持的类型:', Object.keys(cdnHostMap));
            return false;
        }
    }
};