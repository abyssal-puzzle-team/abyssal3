// api/_utils.js
import { kv } from '@vercel/kv'; // 导入 Vercel KV 客户端
import Cors from 'cors';        // 导入 CORS 中间件

// --- 配置 ---
// 从环境变量读取（在 Vercel 仪表板中设置）
const passwords = {
    1: process.env.NODE1_PASS,  // 节点 1 密码
    2: process.env.NODE2_PASS,  // 节点 2 密码
    3: process.env.NODE3_PASS,  // 节点 3 密码
    4: process.env.NODE4_PASS,  // 节点 4 密码
    5: process.env.NODE5_PASS,  // 节点 5 密码
    6: process.env.CENTER_PASS, // <-- 新增：中心节点密码
    next1: process.env.NEXT_PASS_1, // next.html 密码 1 (保留，以防他用)
    next2: process.env.NEXT_PASS_2, // next.html 密码 2 (保留，以防他用)
};

// 冷却时间（秒），从环境变量读取，默认为 5 秒
const COOLDOWN_SECONDS = parseInt(process.env.COOLDOWN_SECONDS || '5', 10);

// --- 辅助函数 ---

// 获取客户端 IP 地址的函数
function getRequestIp(req) {
    // 当部署在 Vercel 代理后面时，Vercel 会自动在 'x-forwarded-for' 中提供正确的 IP
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // 'x-forwarded-for' 可能包含多个 IP: "client, proxy1, proxy2"
        // 我们取第一个 IP，即真实的客户端 IP
        return forwarded.split(',')[0].trim();
    }
    // 为本地开发或直接连接提供备用方案
    // Vercel 环境下通常用不到下面这个，但保留作为健壮性措施
    return req.socket?.remoteAddress || null; // 如果无法确定 IP 则返回 null
}

// CORS 中间件初始化
const cors = Cors({
    methods: ['GET', 'POST', 'HEAD', 'OPTIONS'], // 根据需要调整允许的方法
    origin: '*', // 允许所有来源 - 注意：生产环境中应严格限制来源！
    // 例如，在生产环境中限制来源:
    // origin: process.env.ALLOWED_ORIGIN || 'https://your-frontend-domain.com',
});

// 运行中间件的辅助函数 (用于在 Vercel 函数中应用 CORS)
function runMiddleware(req, res, fn) {
    return new Promise((resolve, reject) => {
        fn(req, res, (result) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
}

// --- 冷却逻辑 (使用 Vercel KV) ---

// 检查 IP 是否处于冷却状态
async function checkCooldown(ip) {
    if (!ip) return { cooldown: false, remaining: 0 }; // 没有 IP 地址，则不进行冷却处理

    const key = `cooldown:${ip}`; // 定义在 KV 中存储冷却信息的键名
    const expiryTime = await kv.get(key); // 从 KV 获取该 IP 的冷却到期时间戳

    if (expiryTime) {
        const now = Date.now(); // 获取当前时间戳
        if (now < expiryTime) {
            // 当前时间小于到期时间，说明仍在冷却期
            const remainingSeconds = Math.ceil((expiryTime - now) / 1000); // 计算剩余秒数（向上取整）
            return { cooldown: true, remaining: remainingSeconds };
        } else {
            // 冷却时间已过，虽然键可能还存在一小段时间。
            // 我们不需要主动删除，KV 的 TTL 会自动处理过期。
            return { cooldown: false, remaining: 0 };
        }
    }
    // 如果 KV 中没有该 IP 的记录，则表示未处于冷却状态
    return { cooldown: false, remaining: 0 };
}

// 为指定 IP 设置冷却
async function setCooldown(ip) {
    if (!ip) return; // 没有 IP 地址，无法设置冷却

    const key = `cooldown:${ip}`;
    const expiryTime = Date.now() + COOLDOWN_SECONDS * 1000; // 计算到期时间戳

    // 在 KV 中设置键值对，并指定过期时间 (TTL)
    // 'ex' 选项设置以秒为单位的生存时间 (Time To Live)
    await kv.set(key, expiryTime, { ex: COOLDOWN_SECONDS });
    console.log(`[${ip}] 在 KV 中为 IP 设置了 ${COOLDOWN_SECONDS} 秒的冷却。`);
}

// 清除指定 IP 的冷却记录 (例如，在密码正确后)
async function clearCooldown(ip) {
    if (!ip) return; // 没有 IP 地址，无法清除

    const key = `cooldown:${ip}`;
    await kv.del(key); // 从 KV 中删除该键
    console.log(`[${ip}] 从 KV 中清除了冷却记录。`);
}

// --- 导出共享内容 ---
export {
    passwords,           // 密码对象 (已更新)
    COOLDOWN_SECONDS,    // 冷却时间
    getRequestIp,        // 获取 IP 的函数
    checkCooldown,       // 检查冷却状态的函数
    setCooldown,         // 设置冷却的函数
    clearCooldown,       // 清除冷却的函数
    runMiddleware,       // 运行中间件的辅助函数
    cors,                // CORS 中间件实例
    kv                   // 导出 kv 实例
};