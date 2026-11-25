// ==UserScript==
// @name         BiliLive Lite Version
// @version      2026.11.25
// @author       AsakiSama
// @description  设置直播播放器使用 Fetch，并通过统计 SDK 配置关闭 /log/web 上报。
// @match        https://live.bilibili.com/*
// @match        https://www.bilibili.com/blackboard/live/*
// @exclude      /^https:\/\/live\.bilibili\.com\/(?:[?#].*)?$/
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

/** 在播放器和直播间统计 SDK 初始化前设置播放模式与上报开关。 */
(() => {
    if (location.hostname === 'live.bilibili.com' && location.pathname === '/') return;

    const queryParamOverrides = {
        wpdP2PType: '-1', // HLS_NOT_P2P
        liteVersion: true, // Lite_Version
        spmid_source: 'client' // 来源客户端
    };
    const queryParams = unsafeWindow.URLSearchParams.prototype;
    const originalGet = queryParams.get;
    /** 优先读取配置的覆盖值，其余查询参数交给原方法。 */
    queryParams.get = function (key) {
        if (Object.hasOwn(queryParamOverrides, key)) return queryParamOverrides[key];
        return originalGet.apply(this, arguments);
    };

    // 直播统计 SDK 在初始化时根据这些开关加载上报模块。
    const disabledTrackers = {
        loadBase: false, loadPV: false, loadEvent: false,
        loadPerform: false, loadSpecial: false, loadError: false,
    };
    let statsConfig = { ...unsafeWindow.__statisObserverConfig, ...disabledTrackers };
    Object.defineProperty(unsafeWindow, '__statisObserverConfig', {
        configurable: true,
        get() { return statsConfig; },
        /** 页面在启动时写入自己的配置，保留其余字段并关闭上报模块。 */
        set(config) { statsConfig = { ...config, ...disabledTrackers }; },
    });

    /** 保留已关闭模块的链式调用语义，不创建事件、队列或定时器。 */
    function skipReport() { return this; }
    Object.defineProperty(unsafeWindow, '__statisObserver', {
        configurable: true,
        /** SDK 创建 observer 时补齐关闭模块的接口，然后交回普通可写属性。 */
        set(observer) {
            if (!observer) return;
            for (const method of [
                'setPVLogId', 'setPVSendStatus', 'sendPV',
                'setEventLogId', 'setEventSendStatus', 'setAttrName', 'addLegalContainer',
                'removeLegalContainer', 'addSelfDefineMsg', 'removeSelfDefineMsg', 'startPoolListen',
                'stopPoolListen', 'addClickTracker', 'forceCommit', 'sendClickEvent',
                'setPerformLogId', 'sendPerform', 'sendCustomMetrics',
                'setSpecialLogId', 'sendSpecial', 'setSpecialInterval', 'setSpecialFirstLoop',
                'startSpecialLoop', 'stopSpecialLoop', 'setErrorLogId', 'setErrorInterval', 'sendError',
            ]) {
                observer[method] ??= skipReport;
            }
            Object.defineProperty(unsafeWindow, '__statisObserver', {
                value: observer, writable: true, configurable: true, enumerable: true,
            });
        },
    });
})();
