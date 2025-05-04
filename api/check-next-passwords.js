// api/check-next-passwords.js
import {
    passwords,
    COOLDOWN_SECONDS,
    getRequestIp,
    checkCooldown,
    setCooldown,
    clearCooldown,
    runMiddleware,
    cors
} from './_utils.js';

export default async function handler(req, res) {
    // 应用 CORS
    await runMiddleware(req, res, cors);

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 只允许 POST 请求
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ message: '方法不允许 (Method Not Allowed)' });
    }

    // 从请求体获取两个密码
    const { password_1, password_2 } = req.body;
    // 获取 IP
    const ip = getRequestIp(req);

    // --- 预先检查冷却状态 (与主页面共享同一个冷却逻辑) ---
    if (ip) {
         try {
            const cooldownStatus = await checkCooldown(ip);
            if (cooldownStatus.cooldown) {
                console.log(`[${ip}] 访问被拒绝 (check-next-passwords)。冷却中，剩余 ${cooldownStatus.remaining} 秒。`);
                return res.status(429).json({
                    correct: false,
                    cooldown: true,
                    remaining: cooldownStatus.remaining,
                    message: `请求过于频繁，请等待 ${cooldownStatus.remaining} 秒后再试。`
                });
            }
        } catch (error) {
             console.error(`[${ip}] next.html 密码检查前检查冷却状态出错:`, error);
        }
    } else {
         console.warn("无法确定用于 next.html 密码检查的 IP。跳过冷却逻辑。");
    }

    // --- 密码校验 ---
    // 从共享配置获取 next.html 的正确密码
    const correctPassword1 = passwords.next1;
    const correctPassword2 = passwords.next2;

    // 检查密码是否在环境变量中定义
    if (correctPassword1 === undefined) {
        console.error("配置错误：环境变量 NEXT_PASS_1 或 NEXT_PASS_2 未设置。");
        return res.status(500).json({ correct: false, message: '服务器配置错误' });
    }

    // 比较两个密码
    if (password_1 === correctPassword1) {
        // --- 密码都正确 ---
        console.log(`[${ip || '未知 IP'}] next.html 密码正确！`);
        // 如果有 IP，尝试清除冷却记录
        if (ip) {
            try {
                await clearCooldown(ip);
            } catch (error) {
                 console.error(`[${ip}] next.html 密码正确后清除冷却时出错:`, error);
            }
        }
        // 返回成功响应
        return res.status(200).json({ correct: true });

    } else {
        // --- 至少一个密码错误 ---
        console.log(`[${ip || '未知 IP'}] next.html 密码错误！`);
        // 如果有 IP，设置冷却
        if (ip) {
            try {
                await setCooldown(ip);
                // 返回错误响应，包含冷却信息 (状态码 429)
                return res.status(429).json({
                    correct: false,
                    cooldown: true,
                    remaining: COOLDOWN_SECONDS,
                    message: `密码错误！请等待 ${COOLDOWN_SECONDS} 秒...`
                });
            } catch (error) {
                 console.error(`[${ip}] next.html 密码错误后设置冷却时出错:`, error);
                 // 设置冷却失败则返回普通未授权错误
                 return res.status(401).json({ correct: false, message: '密码错误 (冷却设置失败)' });
            }
        } else {
            // 没有 IP，返回普通未授权错误
            return res.status(401).json({ correct: false, message: '密码错误' });
        }
    }
}