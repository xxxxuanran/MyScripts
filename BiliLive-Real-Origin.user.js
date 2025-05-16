// ==UserScript==
// @name         BiliLive真原画
// @version      2025.05.15
// @author       AsakiSama
// @match        https://live.bilibili.com/*
// @run-at       document-body
// @grant        unsafeWindow
// @description
// ==/UserScript==

// Create cache storage
const streamNameCache = new Map();

const playUrlPattern = /\/live-bvc\/(\d+)\/(live_[^\/\.]+)/;
const CN01Host = 'cn-gddg-cm-01-22.bilivideo.com';
const biliVideoPattern = /([a-z0-9\-]+\.bilivideo\.com)/;
const hlsPattern = /\.(m4s|m3u8)/;
const suffixPattern = /suffix=([^&]+)/;

if (location.href.startsWith('https://live.bilibili.com/')) {
    const oldFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async function (url) {
        try {
            // 检查 url 类型并标准化
            const urlString = typeof url === 'string' ? url : url.toString();

            const isGetRoomPlayInfo = urlString.includes('/xlive/web-room/v2/index/getRoomPlayInfo');
            if (isGetRoomPlayInfo) {
                arguments[0] = urlString.replace(`&protocol=0,1`, '&protocol=0,1').replace('&format=0,1,2', '&format=0,2')
            }

            // 首先检查是否是 bilivideo.com 的请求
            const biliVideoMatch = urlString.match(biliVideoPattern);
            if (!biliVideoMatch) return oldFetch.apply(this, arguments);
            // 不修改 HLS-TS
            if (/gotcha10\d/.test(urlString)) return oldFetch.apply(this, arguments);

            // 检查是否匹配 playUrl 模式
            const playUrlMatch = urlString.match(playUrlPattern);
            if (!playUrlMatch) return oldFetch.apply(this, arguments);

            // 检查是否是 .m4s 或 .m3u8 文件
            if (!hlsPattern.test(urlString)) return oldFetch.apply(this, arguments);

            const roomId = location.href.match(/(\d+)/)[1];
            const isM3U8 = /\.m3u8/.test(urlString);

            // get from cache
            if ( isM3U8 && streamNameCache.has(roomId) ) {
                let m3u8Url = `https://${CN01Host}/live-bvc/${streamNameCache.get(roomId)}/index.m3u8`
                arguments[0] = m3u8Url;
                return oldFetch.apply(this, arguments);
            }

            // host
            let urlHost = biliVideoMatch[1];

            // OV2CN
            const isOverSea = /ov-gotcha20\d/.test(urlHost);
            if ( isOverSea ) {
                urlHost = urlHost.replace('ov-gotcha20', 'cn-gotcha20');
            }

            // c1/c0/d0 to d1, backup to main
            const isMainNode = /d1--cn-gotcha20\d\./.test(urlHost);
            if ( !isMainNode ) {
                urlHost = urlHost.replace(/(?:c1|c0|d0|d1)--cn-gotcha20(\d)b?/g, 'd1--cn-gotcha20$1');
            }

            const [, requestId, streamName] = playUrlMatch;
            const requestFile = urlString.split(streamName)[1].split('?')[0].split('/')[1];

            const isHeader = /h\d+\.m4s/.test(requestFile);
            const isCN01 = /cn(\-[a-z]+){2}(\-\d+){2}/.test(urlHost);
            const isTencent = /gotcha204(b|-[1234])?\./.test(urlHost);
            const isBaidu = /gotcha207b?\./.test(urlHost);
            const isHuawei = /gotcha208b?\./.test(urlHost);
            const isAliyun = /gotcha209b?\./.test(urlHost);
            const CNBaiduHost = 'd1--cn-gotcha207.bilivideo.com'

            // m4s 直接从缓存取 stream_name
            const canSkip = !isM3U8 && streamNameCache.has(roomId);
            if ( canSkip ) {
                arguments[0] = `https://${isHeader ? CN01Host : urlHost}/live-bvc/000000/${streamNameCache.get(roomId)}/${requestFile}`
                const promise = oldFetch.apply(this, arguments);
                return promise.then(async response => {
                    const clonedResponse = response.clone();
                    if ([404].includes(clonedResponse.status)) {
                        // 替换 404 请求到 CN01
                        const retryUrl = `https://${CN01Host}/live-bvc/000000/${streamNameCache.get(roomId)}/${requestFile}`
                        return await oldFetch(retryUrl);
                    }
                    return clonedResponse;
                });
            }

            // 获取二压后缀名
            const suffixMatch = urlString.match(suffixPattern);
            const suffix = suffixMatch ? suffixMatch[1] : null;
            let originStreamName = streamName
            if ( suffix && suffix !== 'origin' ) {
                originStreamName = originStreamName.replace(`_${suffix}`, '');
            }
            if ( !streamNameCache.has(roomId) ) {
                streamNameCache.set(roomId, originStreamName)
            }

            let newUrl = `https://${CN01Host}/live-bvc/000000/${streamNameCache.get(roomId)}/${requestFile}`

            arguments[0] = newUrl;
            return oldFetch.apply(this, arguments);
        } catch (e) {
            console.log("原画=========", e)
            return oldFetch.apply(this, arguments);
        }
    }
}