/**
 * Bing Rewards 自动抓取 (Loon 专用精简版) [DEBUG + 防抖版]
 * 核心逻辑: 仅在访问 Bing App 个人中心时触发
 */

const $ = {
    getdata: (k) => $persistentStore.read(k),
    getArgument: (k) => (typeof $argument !== 'undefined' && $argument ? $argument[k] : undefined),
    setdata: (v, k) => $persistentStore.write(v, k),
    msg: (t, s, m) => {
        $notification.post(t, s, m);
        if ($ && $.log) $.log(`🔔 ${s} ${m}`);
    },
    log: (m) => console.log(`[BingCapture] ${m}`),
    http: {
        get: (opts) => new Promise((resolve, reject) => {
            $httpClient.get(opts, (err, resp, body) => {
                if (err) reject(err);
                else resolve({ body, status: resp.status });
            });
        }),
        post: (opts) => new Promise((resolve, reject) => {
            $httpClient.post(opts, (err, resp, body) => {
                if (err) reject(err);
                else resolve({ body, status: resp.status });
            });
        }),
        put: (opts) => new Promise((resolve, reject) => {
            $httpClient.put(opts, (err, resp, body) => {
                if (err) reject(err);
                else resolve({ body, status: resp.status });
            });
        })
    }
};

function parseCookieMap(cookieStr) {
    const map = {};
    if (!cookieStr) return map;
    const parts = cookieStr.split(';');
    for (const p of parts) {
        const idx = p.indexOf('=');
        if (idx <= 0) continue;
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (!k) continue;
        map[k] = v;
    }
    return map;
}

function buildCookieFingerprint(cookieStr, stableKeys) {
    const map = parseCookieMap(cookieStr);
    const pairs = [];
    for (const k of stableKeys) {
        if (map[k]) pairs.push(`${k}=${map[k]}`);
    }
    return pairs.join('&');
}

async function run() {
    const authHeader = $request.headers['Authorization'] || $request.headers['authorization'];
    const cookieHeader = $request.headers['Cookie'] || $request.headers['cookie'];
    const url = $request.url;
    // 提取 Host，兜底处理
    const host = $request.hostname || ($request.headers['Host'] ? $request.headers['Host'] : ((url.split('/')[2]) && url.split('/')[2].split(':')[0]));

    // --- 【DEBUG】Request Trace ---
    // $.log(`🔍 Request Trace: [${$request.method}] ${url}`);

    // --- 【http-response 快速过滤】 ---
    // 若在 http-response 触发模式下，先检查状态码：401 直接丢弃，确保不存入任何脏数据
    if (typeof $response !== "undefined" && $response) {
        const respCode = $response.status || $response.statusCode || 0;
        if (respCode === 401) {
            $.log(`⚠️ 捕获到 401 Unauthorized 响应 (RPS未就绪或凭据过期)，跳过保存该 Token，等待 App 刷新新凭据...`);
            $done({});
            return;
        }
        if (respCode !== 200) {
            $.log(`⚠️ 响应状态码为 ${respCode} (非 200)，跳过保存`);
            $done({});
            return;
        }
    }

    // --- 【Fail-Fast】前置过滤 (秒级退出) ---
    // 只有满足特定条件的请求才继续往下走，否则直接退出，不打印任何日志（避免刷屏）

    // 1. 判断是否为 "Token 类型" 请求 (API)
    //    接受 Rewards App 的核心个人中心接口及任务接口 (/dapi/me, /dapi/me/activities 等所有子路径)
    const isTokenReq = /^https:\/\/prod\.rewardsplatform\.microsoft\.com\/dapi\/me/.test(url);
    const hasValidToken = authHeader && authHeader.startsWith('Bearer ');

    // 2. 判断是否为 "Cookie 类型" 请求 (Web)
    //    仅接受几个明确的个人中心/登录态补全入口，避免打开 Bing 首页时瞬间命中大量静态资源与异步请求
    const isPrimaryWebReq = /^https:\/\/(cn|www)\.bing\.com\/rewards\/panelflyout\/getuserinfo(\?|$)/.test(url);
    const isCrossDomainReq =
        /^https:\/\/login\.live\.com\/login\.srf(\?|$)/.test(url) ||
        /^https:\/\/rewards\.bing\.com(\/(dashboard|api)(\/|\?|$)|\/?$)/.test(url) ||
        /^https:\/\/account\.microsoft\.com\//.test(url);
    const isWebReq = !isTokenReq && Boolean(host) && (isPrimaryWebReq || isCrossDomainReq);
    // 严格校验: 必须包含 MSPAuth (微软登录凭证) 或特定 Cookie, 否则视为无效请求 (如静态资源)
    const hasValidCookie = cookieHeader && /MSPAuth|MSPOK|__RPSTAuth|MSCC|MUID/.test(cookieHeader);

    // [决策点] 不关心的请求 / 无效数据 -> 直接退出
    if ((!isTokenReq && !isWebReq) || (isTokenReq && !hasValidToken) || (isWebReq && !hasValidCookie)) {
        // [Verified Debug] Explain why it failed (Temporary)
        const reason = [];
        if (!isTokenReq && !isWebReq) reason.push("Not target logic (Not Token/Web)");
        if (isTokenReq && !hasValidToken) reason.push("Token req missing Bearer");
        if (isWebReq && !hasValidCookie) reason.push(`Web req missing critical cookie. HasCookie: ${Boolean(cookieHeader)}`);

        // Only log if it partially matched (e.g. is Bing but missing Auth) to reduce noise
        if (url.includes('bing') || url.includes('microsoft')) {
            $.log(`⚠️ Skip: [${url}] Reason: ${reason.join(', ')}`);
        }

        $done({});
        return;
    }

    // --- 提取用户标识 (仅在有操作价值时才提取) ---
    // 优先从 Cookie 提取 MUID, 其次尝试从 Token 解析 (这里简化处理)
    const muidMatch = cookieHeader ? cookieHeader.match(/MUID=([^;]+)/) : null;
    const userIdentifier = muidMatch ? muidMatch[1].substring(0, 8) : "default";

    // --- 逻辑分支 ---

    const hasFS = Boolean((($.getdata('FEISHU_APP_ID') || $.getArgument('FEISHU_APP_ID')) && ($.getdata('FEISHU_APP_SECRET') || $.getArgument('FEISHU_APP_SECRET')) && ($.getdata('FEISHU_CHAT_ID') || $.getArgument('FEISHU_CHAT_ID'))));
    let notifyNeeded = false;
    let syncSuccess = false;
    let shouldTriggerTasks = false;
    const updatedTypes = new Set();

    // Branch A: Token 捕获
    if (isTokenReq && hasValidToken) {
        // 自动提取并更新真实的客户端 Headers
        const reqUa = $request.headers['User-Agent'] || $request.headers['user-agent'];
        if (reqUa && reqUa.includes("BingChina")) {
            $.setdata(reqUa, 'BING_APP_UA');
            $.setdata(reqUa, 'BING_UA_MOBILE');
        }
        const reqAppId = $request.headers['x-rewards-appid'];
        if (reqAppId) $.setdata(reqAppId, 'BING_APP_ID');
        const reqPartnerId = $request.headers['x-rewards-partnerid'];
        if (reqPartnerId) $.setdata(reqPartnerId, 'BING_APP_PARTNER_ID');
        const reqCountry = $request.headers['x-rewards-country'];
        if (reqCountry) $.setdata(reqCountry, 'BING_APP_COUNTRY');

        const STORAGE_KEY = `BING_APP_TOKEN_${userIdentifier}`;
        const lastToken = $.getdata(STORAGE_KEY);

        if (authHeader !== lastToken) {
            $.log(`🔍 捕获 [Token] (${userIdentifier})，正在验证有效性...`);
            let isValid = false;

            // 如果处于 http-response 环境且状态码为 200，说明微软服务端已验证通过，100% 可用
            if (typeof $response !== "undefined" && ($response.status === 200 || $response.statusCode === 200)) {
                isValid = true;
            } else {
                try {
                    const testRes = await $.http.get({
                        url: "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=612",
                        headers: {
                            "Authorization": authHeader,
                            "User-Agent": reqUa || "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/605.1.15 BingSapphire/32.6.431215001",
                            "x-rewards-appid": reqAppId || "SAIOS/32.6.431215001",
                            "x-rewards-country": reqCountry || "cn",
                            "x-rewards-partnerid": reqPartnerId || "startapp",
                            "x-rewards-ismobile": "true",
                            "x-rewards-flights": "rwgobig"
                        }
                    });
                    const sc = testRes.status || testRes.statusCode || 0;
                    if (sc === 200) {
                        isValid = true;
                    } else if (sc === 401) {
                        $.log(`⚠️ 捕获的 Token 校验失败 (401 Unauthorized)，为 App 刚启动时的过期缓存，已忽略。等待 App 刷新后再捕获...`);
                    } else {
                        isValid = true;
                    }
                } catch (err) {
                    isValid = true;
                }
            }

            if (isValid) {
                $.log(`✅ Token 验证有效 (200)，正在保存...`);
                // 本地先落盘（不依赖青龙配置），供 launcher/任务脚本读取（默认最近一次捕获）
                $.setdata(authHeader, 'BING_APP_TOKEN');
                $.setdata(authHeader, STORAGE_KEY);
                notifyNeeded = true;
                shouldTriggerTasks = true;
                updatedTypes.add('Token');

                if (hasFS) {
                    if (await syncToFeishu('BING_APP_TOKEN', authHeader, `Loon自动抓取 - ${userIdentifier}`)) syncSuccess = true;
                }
            }
        }
        // 如果 Token 没变，什么都不做，也不打印日志 (静默)
    }

    // Branch B: Cookie 捕获 (Web)
    else if (isWebReq && hasValidCookie) {
        // B-1: 主域 Cookie (cn.bing.com / www.bing.com)
        if (host.includes('cn.bing.com') || host.includes('www.bing.com')) {
            const COOKIE_KEY = `BING_COOKIES_${userIdentifier}`;
            const COOKIE_FP_KEY = `BING_COOKIES_FP_${userIdentifier}`;
            const lastCookie = $.getdata(COOKIE_KEY);
            const lastFp = $.getdata(COOKIE_FP_KEY) || "";
            const fp = buildCookieFingerprint(cookieHeader, ['MSPAuth', 'MSPOK', '__RPSTAuth', 'MSCC', 'MUID']);
            const fpChanged = fp && fp !== lastFp;
            const rawChanged = cookieHeader !== lastCookie;

            // 始终尽量保存最新 Cookie（哪怕只是跟踪字段变化），但只在“稳定认证指纹”变化时才通知/同步
            if (rawChanged) {
                $.setdata(cookieHeader, 'BING_COOKIES');
                $.setdata(cookieHeader, COOKIE_KEY);
            }
            if (fpChanged) {
                $.log(`🔍 捕获 [Bing Cookie] (${userIdentifier}) 认证指纹变化，正在处理...`);
                $.setdata(fp, COOKIE_FP_KEY);
                notifyNeeded = true;
                shouldTriggerTasks = true;
                updatedTypes.add('Cookie');
                if (hasFS) {
                    if (await syncToFeishu('BING_COOKIES', cookieHeader, `Loon自动抓取 - ${userIdentifier}`)) syncSuccess = true;
                }
            }
        }

        // B-2: 跨域/补全 Cookie (login.live.com, rewards.bing.com 等)
        // 仅当包含强认证特征 (MSPAuth 等) 时才视为有效跨域凭证
        if (host.includes('login.live.com') || host.includes('rewards.bing.com') || host.includes('account.microsoft.com')) {
            if (/MSPAuth|MSPOK|__RPSTAuth/.test(cookieHeader)) {
                const HOOK_KEY = `BING_HOOK_COOKIE_${userIdentifier}`;
                const HOOK_FP_KEY = `BING_HOOK_COOKIE_FP_${userIdentifier}`;
                const lastHook = $.getdata(HOOK_KEY);
                const lastHookFp = $.getdata(HOOK_FP_KEY) || "";
                const hookFp = buildCookieFingerprint(cookieHeader, ['MSPAuth', 'MSPOK', '__RPSTAuth']);
                const hookFpChanged = hookFp && hookFp !== lastHookFp;
                const rawHookChanged = cookieHeader !== lastHook;

                if (rawHookChanged) {
                    $.setdata(cookieHeader, 'BING_HOOK_COOKIE');
                    $.setdata(cookieHeader, HOOK_KEY);
                }
                if (hookFpChanged) {
                    $.log(`🔍 捕获 [跨域凭证] (${host}) 认证指纹变化，正在处理...`);
                    $.setdata(hookFp, HOOK_FP_KEY);
                    notifyNeeded = true;
                    updatedTypes.add('Hook');

                    if (hasFS) {
                        if (await syncToFeishu('BING_HOOK_COOKIE', cookieHeader, `[补全] Live域凭证 - ${userIdentifier}`)) syncSuccess = true;
                    }
                }
            }
        }
    }

    // 通知：本地保存也要提示（青龙不可用场景）
    if (notifyNeeded || syncSuccess) {
        // [Deflood] 通知冷却：默认 60 秒（避免打开 Bing App 时连续弹十几条）
        const lastNotify = Number($.getdata(`BING_LAST_NOTIFY_TIME_${userIdentifier}`)) || 0;
        const now = Date.now();

        if (now - lastNotify > 60000) {
            const types = Array.from(updatedTypes);
            const typeText = types.length ? types.join('/') : '数据';
            $.msg("Bing 抓包", syncSuccess ? "同步成功" : "已更新", `账号 ${userIdentifier}：${typeText}`);
            $.setdata(String(now), `BING_LAST_NOTIFY_TIME_${userIdentifier}`);
        } else {
            $.log(`🔕 Skip Notify: Cooldown active (${now - lastNotify}ms < 60000ms)`);
        }
    }

    // 自动触发本地任务不应依赖青龙同步是否成功，也不应被通知冷却阻塞
    if (shouldTriggerTasks) {
        await triggerRetryTask();
    }

    // 结束
    $done({});
}

// --- 飞书中转（国内可达，无需公网入口） ---
async function syncToFeishu(key, value, remarks) {
    const appId = $.getdata('FEISHU_APP_ID') || $.getArgument('FEISHU_APP_ID');
    const appSecret = $.getdata('FEISHU_APP_SECRET') || $.getArgument('FEISHU_APP_SECRET');
    const chatId = $.getdata('FEISHU_CHAT_ID') || $.getArgument('FEISHU_CHAT_ID');
    if (!appId || !appSecret || !chatId) {
        $.log(`⚠️ 未配置飞书同步参数 (FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID)`);
        return false;
    }
    try {
        const tokRes = await $.http.post({
            url: 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret })
        });
        const token = JSON.parse(tokRes.body).tenant_access_token;
        if (!token) throw new Error('飞书 tenant_access_token 获取失败');
        const payload = 'DSHSYNC1 ' + JSON.stringify({ v: 1, key, value, ts: Date.now(), n: Math.random().toString(36).slice(2) });
        const sendRes = await $.http.post({
            url: 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: payload }) })
        });
        const j = JSON.parse(sendRes.body);
        if (j.code !== 0) throw new Error(j.msg || ('code=' + j.code));
        $.log(`✅ [飞书同步] ${key} 已发送`);
        return true;
    } catch (e) {
        $.log(`❌ [飞书同步] ${key} 失败: ${e && e.message || e}`);
        return false;
    }
}


async function triggerRetryTask() {
    // 检查最后一次触发时间，避免极短时间内重复触发（Debounce）
    const lastTrigger = Number($.getdata("BING_LAST_TRIGGER_TIME")) || 0;
    const now = Date.now();

    // 如果距离上次触发小于 60 秒，则跳过
    if (now - lastTrigger < 60000) {
        $.log(`🔕 触发过快，忽略本次自动运行请求 (距离上次 ${now - lastTrigger}ms)`);
        return;
    }

    $.setdata(String(now), "BING_LAST_TRIGGER_TIME");
    $.log("⚡️ 正在 Loon 内部自动触发 Bing 任务...");

    // 通过发出特定的 HTTP 请求，并由 Loon 的 http-request 截获来运行对应的任务脚本
    const tasks = [
        "https://www.bing.com/loon_trigger/bing_checkin",
        "https://www.bing.com/loon_trigger/bing_read",
        "https://www.bing.com/loon_trigger/bing_search"
    ];

    const promises = tasks.map(url => $.http.get(url).catch(e => $.log(`触发 ${url} 失败: ${e.message}`)));
    await Promise.all(promises);

    $.log("✅ Loon 本地任务触发完毕 (如果不执行, 请确保已更新 Plugin 规则)");
}

run().catch(e => $.log(`❌ 运行异常: ${e.message}`)).finally(() => $done({}));
