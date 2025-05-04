// api/check-password.js
import {
    passwords, COOLDOWN_SECONDS, getRequestIp, checkCooldown,
    setCooldown, clearCooldown, runMiddleware, cors
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

    // 从请求体获取数据
    const { nodeIndex, password } = req.body;
    // 获取 IP
    const ip = getRequestIp(req);

    // --- 预先检查冷却状态 ---
    if (ip) {
        try {
            const cooldownStatus = await checkCooldown(ip);
            if (cooldownStatus.cooldown) {
                // 如果处于冷却状态，拒绝请求
                console.log(`[${ip}] 访问被拒绝 (check-password)。冷却中，剩余 ${cooldownStatus.remaining} 秒。`);
                return res.status(429).json({ // 429 Too Many Requests
                    correct: false,
                    cooldown: true,
                    remaining: cooldownStatus.remaining,
                    message: `请求过于频繁，请等待 ${cooldownStatus.remaining} 秒后再试。`
                });
            }
        } catch (error) {
            console.error(`[${ip}] 密码检查前检查冷却状态出错:`, error);
            // 决定是继续还是返回错误。继续可能会在出错时绕过冷却。
            // return res.status(500).json({ message: "服务器检查冷却状态出错。" });
        }
    } else {
        console.warn("无法确定用于密码检查的 IP。跳过冷却逻辑。");
    }

    // --- 参数验证 ---
    if (nodeIndex === undefined || password === undefined) {
        return res.status(400).json({ correct: false, message: '请求缺少必要参数 (nodeIndex 或 password)' });
    }
    const index = parseInt(nodeIndex, 10);
    // 验证节点索引是否在有效范围 (主页面为 1-5，现在加上中心节点 6)
    // <--- 修改验证逻辑 --->
    if (isNaN(index) || index < 1 || (index > 6)) { // 允许 1 到 6
         return res.status(400).json({ correct: false, message: '无效的节点索引' });
    }

    // --- 密码校验 ---
    const correctPassword = passwords[index]; // 现在可以获取 passwords[6]

    // 检查环境变量是否配置了该密码 (现在会检查 NODE1_PASS 到 NODE5_PASS 和 CENTER_PASS)
    if (correctPassword === undefined) {
        // <--- 更新错误消息以包含中心节点 --->
        const envVarName = index === 6 ? 'CENTER_PASS' : `NODE${index}_PASS`;
        console.error(`配置错误：环境变量 ${envVarName} 未设置。`);
        return res.status(500).json({ correct: false, message: '服务器配置错误' });
    }

    // 比较密码
    if (password === correctPassword) {
        // --- 密码正确 ---
        console.log(`[${ip || '未知 IP'}] 节点 ${index} 密码正确！`);
        // 如果有 IP，尝试清除之前的冷却记录（以防万一之前因错误尝试被阻止）
        if (ip) {
            try {
                await clearCooldown(ip);
            } catch (error) {
                 console.error(`[${ip}] 密码正确后清除冷却时出错:`, error);
                 // 即使清除失败，也应继续返回成功响应
            }
        }
        // 返回成功响应
        return res.status(200).json({ correct: true });

    } else {
        // --- 密码错误 ---
        console.log(`[${ip || '未知 IP'}] 节点 ${index} 密码错误！`);
        // 如果有 IP，则设置冷却
        if (ip) {
            try {
                await setCooldown(ip);
                // 返回错误响应，并告知处于冷却状态 (状态码 429)
                return res.status(429).json({
                    correct: false,               // 密码本身是错的
                    cooldown: true,               // 明确告知进入冷却状态
                    remaining: COOLDOWN_SECONDS,  // 告知初始的完整冷却时间
                    message: `密码错误！请等待 ${COOLDOWN_SECONDS} 秒...` // 错误消息也提示冷却
                });
            } catch (error) {
                console.error(`[${ip}] 密码错误后设置冷却时出错:`, error);
                // 如果设置冷却失败，回退到普通的未授权错误
                return res.status(401).json({ correct: false, message: '密码错误 (冷却设置失败)' });
            }
        } else {
            // 没有 IP，无法设置冷却，只返回普通的未授权错误
            return res.status(401).json({ correct: false, message: '密码错误' });
        }
    }
}