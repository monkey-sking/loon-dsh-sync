/** 手动把已抓取凭证推到飞书中转群。触发：Safari 打开 https://www.bing.com/loon_trigger/push */
const $ = {
    getdata: (k) => $persistentStore.read(k),
    getArgument: (k) => (typeof $argument !== "undefined" && $argument ? $argument[k] : undefined),
    log: (m) => console.log(`[DSHPush] ${m}`),
    msg: (t, s, m) => $notification.post(t, s, m),
    http: {
        post: (o) => new Promise((res, rej) => $httpClient.post(o, (e, r, b) => e ? rej(e) : res({ body: b, status: r.status })))
    }
};
(async () => {
    const appId = $.getdata("FEISHU_APP_ID") || $.getArgument("FEISHU_APP_ID");
    const appSecret = $.getdata("FEISHU_APP_SECRET") || $.getArgument("FEISHU_APP_SECRET");
    const chatId = $.getdata("FEISHU_CHAT_ID") || $.getArgument("FEISHU_CHAT_ID");
    if (!appId || !appSecret || !chatId) { $.msg("DSH 推送", "配置缺失", "FEISHU_APP_ID / SECRET / CHAT_ID"); return; }
    let token;
    try {
        const r = await $.http.post({ url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) });
        token = JSON.parse(r.body).tenant_access_token;
        if (!token) throw new Error("token 获取失败");
    } catch (e) { $.msg("DSH 推送", "连接飞书失败", String(e && e.message || e)); return; }
    const keys = ["BING_APP_TOKEN","BING_COOKIES","BING_HOOK_COOKIE","TU_usersignKeyTU","JD_COOKIE","JD_WSCK","SMZDM_COOKIE","BLACKBOX_COOKIE"];
    let ok = 0, fail = 0, empty = true;
    for (const key of keys) {
        const value = $.getdata(key);
        if (!value) continue;
        empty = false;
        try {
            const payload = "DSHSYNC1 " + JSON.stringify({ v: 1, key, value, ts: Date.now(), n: Math.random().toString(36).slice(2) });
            const r = await $.http.post({ url: "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ receive_id: chatId, msg_type: "text", content: JSON.stringify({ text: payload }) }) });
            if (JSON.parse(r.body).code === 0) ok++; else fail++;
        } catch (e) { $.log(key + " 失败: " + (e && e.message || e)); fail++; }
    }
    $.msg("DSH 推送", `完成 ${ok} 成功 / ${fail} 失败`, empty ? "本地还没有已抓取的凭证，先打开 Bing App 抓一次" : "");
})().catch(e => $.log("异常: " + e)).finally(() => $done({}));
