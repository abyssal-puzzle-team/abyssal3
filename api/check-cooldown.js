// api/check-cooldown.js
import { getRequestIp, checkCooldown, runMiddleware, cors } from './_utils.js';

// Vercel Serverless Function 的默认导出处理器
export default async function handler(req, res) {
    // --- 在所有逻辑之前添加日志 ---
    console.log(`---> /api/check-cooldown Received: Method=${req.method}, URL=${req.url}, IP=${getRequestIp(req) || 'unknown'}`);
    // ----------------------------- (日志可以移到这里，只记录一次)

    // 应用 CORS 中间件
    await runMiddleware(req, res, cors);

    // 对于 CORS 预检请求 (OPTIONS)，Vercel 通常会自动处理，但显式处理更健壮
     if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 只允许 GET 请求
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET', 'OPTIONS']); // 告知客户端允许的方法
        return res.status(405).json({ message: '方法不允许 (Method Not Allowed)' });
    }

    // 获取请求 IP
    const ip = getRequestIp(req); // 注意：日志里也用了，这里再获取一次没问题

    if (!ip) {
        console.warn("无法确定用于冷却检查的 IP 地址。");
        // 决定行为：视为未冷却，还是返回错误？
        // 这里为简单起见，将其视为未冷却。
        return res.status(200).json({ cooldown: false, remaining: 0 });
    }

    try {
        // 调用共享函数检查冷却状态
        const { cooldown, remaining } = await checkCooldown(ip);
        console.log(`[${ip}] 冷却检查结果: ${cooldown}, 剩余: ${remaining} 秒`);
        // 返回 JSON 响应
        res.status(200).json({ cooldown, remaining });
    } catch (error) {
        console.error(`[${ip}] 检查冷却状态时出错:`, error);
        // 返回服务器错误响应
        res.status(500).json({ message: "服务器检查冷却状态时出错。" });
    }
}