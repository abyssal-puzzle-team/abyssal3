// ./nodejs/password.js
// 引入必要的模块
const express = require('express'); // Express 框架，用于构建 Web 应用
const dotenv = require('dotenv');   // 用于从 .env 文件加载环境变量
const cors = require('cors');       // 用于处理跨域资源共享 (CORS)
const path = require('path');       // 用于处理文件和目录路径

// 加载项目根目录下的 .env 文件
// path.resolve(__dirname, '../.env') 会构建从当前文件所在目录 (__dirname) 返回上一级再查找 .env 的绝对路径
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 创建 Express 应用实例
const app = express();
// 设置服务器端口，优先使用 .env 文件中定义的 PORT，否则使用默认端口 3000
const PORT = process.env.PORT || 3000;
// 从 .env 文件读取冷却时间（秒），如果未定义则默认为 5 秒
const COOLDOWN_SECONDS = parseInt(process.env.COOLDOWN_SECONDS || '5', 10);

// --- 后端冷却机制 ---
// 使用 Map 数据结构存储冷却信息
// 键 (Key) 是用户的 IP 地址
// 值 (Value) 是该 IP 的冷却到期时间戳 (毫秒)
const cooldowns = new Map();
// --- 冷却机制结束 ---

// --- 中间件设置 ---
// 启用 CORS，允许所有来源的请求（开发时方便，生产环境应配置具体来源）
app.use(cors());
// 启用 Express 内置的 JSON 解析中间件，用于解析请求体中的 JSON 数据
app.use(express.json());

// --- 信任代理设置 ---
// 如果你的 Node.js 服务部署在反向代理（如 Nginx, HAProxy）之后，
// 为了能正确获取到真实的用户 IP 地址 (而不是代理服务器的 IP),
// 需要根据你的代理层级设置 'trust proxy'。
// 例如: app.set('trust proxy', 1); // 信任直接连接的一层代理
// 如果不确定或没有使用代理，可以注释掉或不设置。
// app.set('trust proxy', 1);
// --- 信任代理设置结束 ---

// --- 密码存储 ---
// 从环境变量中加载各个节点的密码
// 建议将敏感信息存储在环境变量中，而不是硬编码在代码里
const passwords = {
    1: process.env.NODE1_PASS, // 主页面节点 1 密码
    2: process.env.NODE2_PASS, // 主页面节点 2 密码
    3: process.env.NODE3_PASS, // 主页面节点 3 密码
    4: process.env.NODE4_PASS, // 主页面节点 4 密码
    5: process.env.NODE5_PASS, // 主页面节点 5 密码
    6: process.env.NODE6_PASS  // 主页面中心节点密码（虽然前端不再验证）
};
// --- 密码存储结束 ---

// --- 辅助函数：获取请求 IP 地址 ---
// 考虑到可能存在的反向代理，尝试多种方式获取 IP
function getRequestIp(req) {
     // 如果 Express 配置了 'trust proxy'，req.ip 应该是最可靠的
     // 否则，尝试从 'x-forwarded-for' 头获取（取第一个 IP）
     // 最后，回退到直接连接的 remoteAddress
     const forwarded = req.headers['x-forwarded-for'];
     if (forwarded) {
         // 'x-forwarded-for' 可能包含逗号分隔的多个 IP: "client, proxy1, proxy2"
         return forwarded.split(',')[0].trim();
     }
     // 使用 Express 的 req.ip (如果 trust proxy 配置了) 或直接连接的地址
     return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
 }
// --- 辅助函数结束 ---


// === API 端点 1: 检查当前 IP 的冷却状态 (GET /check-cooldown) ===
// 这个 API 供前端在显示密码输入框之前调用，预先判断是否处于冷却
app.get('/check-cooldown', (req, res) => {
    const ip = getRequestIp(req); // 获取请求 IP

    if (!ip) {
        // 如果无法确定 IP，出于安全考虑或避免逻辑复杂化，返回非冷却状态
        console.warn("无法确定 IP 地址，跳过冷却检查。");
        return res.json({ cooldown: false, remaining: 0 });
    }

    // 检查该 IP 是否在冷却 Map 中
    if (cooldowns.has(ip)) {
        const expiryTime = cooldowns.get(ip); // 获取到期时间戳
        const now = Date.now(); // 获取当前时间戳

        // 如果当前时间还没到到期时间，说明仍在冷却期
        if (now < expiryTime) {
            const remainingSeconds = Math.ceil((expiryTime - now) / 1000); // 计算剩余秒数（向上取整）
            console.log(`[${ip}] 冷却检查：仍处于冷却，剩余 ${remainingSeconds} 秒。`);
            // 返回 JSON，告知前端处于冷却状态及剩余时间
            return res.json({
                cooldown: true,
                remaining: remainingSeconds
            });
        } else {
            // 如果当前时间已超过到期时间，说明冷却刚结束
            cooldowns.delete(ip); // 从 Map 中移除该 IP 的记录
            console.log(`[${ip}] 冷却检查：冷却已到期，记录已移除。`);
        }
    }

    // 如果 IP 不在 Map 中，或者已到期并被移除，则表示不处于冷却状态
    // console.log(`[${ip}] 冷却检查：未处于冷却状态。`); // 可以注释掉以减少日志
    res.json({
        cooldown: false,
        remaining: 0
    });
});
// === API 端点 1 结束 ===


// === API 端点 2: 检查主页面密码 (POST /check-password) ===
app.post('/check-password', (req, res) => {
    const { nodeIndex, password } = req.body; // 从请求体中获取节点索引和密码
    const ip = getRequestIp(req); // 获取请求 IP

    if (!ip) {
        console.warn("无法确定 IP 地址，本次密码检查将跳过冷却逻辑。");
    } else {
        console.log(`[${ip}] 收到节点 ${nodeIndex} 的密码检查请求。`);
        // --- 检查 IP 是否已处于冷却状态 ---
        if (cooldowns.has(ip)) {
            const expiryTime = cooldowns.get(ip);
            const now = Date.now();
            if (now < expiryTime) {
                const remainingSeconds = Math.ceil((expiryTime - now) / 1000);
                console.log(`[${ip}] 访问被拒绝 (提交密码)。冷却中，剩余 ${remainingSeconds} 秒。`);
                // 返回 429 状态码和冷却信息
                return res.status(429).json({
                    correct: false, cooldown: true, remaining: remainingSeconds,
                    message: `请求过于频繁，请等待 ${remainingSeconds} 秒后再试。`
                });
            } else {
                cooldowns.delete(ip); console.log(`[${ip}] 冷却已到期 (提交密码)。`);
            }
        }
        // --- 冷却检查结束 ---
    }

    // 基本参数验证
    if (nodeIndex === undefined || password === undefined) {
        return res.status(400).json({ correct: false, message: '请求缺少必要参数' });
    }
    const index = parseInt(nodeIndex, 10); // 将节点索引转为数字

    // 验证节点索引是否有效 (主页面只验证 1-5)
    if (isNaN(index) || index < 1 || index > 5) {
         return res.status(400).json({ correct: false, message: '无效的节点索引' });
    }

    // 从环境变量获取该节点的正确密码
    const correctPassword = passwords[index];

    // 检查密码是否已在 .env 文件中定义
    if (correctPassword === undefined) {
        console.error(`错误：节点 ${index} 的密码 (NODE${index}_PASS) 未在 .env 文件中定义`);
        return res.status(500).json({ correct: false, message: '服务器配置错误' });
    }

    // 比较用户输入的密码和正确的密码
    if (password === correctPassword) {
        // --- 密码正确 ---
        console.log(`[${ip || '未知 IP'}] 节点 ${index} 密码正确！`);
        if (ip && cooldowns.has(ip)) { // 如果该 IP 之前因错误尝试被冷却，现在清除记录
            cooldowns.delete(ip); console.log(`[${ip}] 冷却记录已清除。`);
        }
        res.json({ correct: true }); // 返回成功响应

    } else {
        // --- 密码错误 ---
        console.log(`[${ip || '未知 IP'}] 节点 ${index} 密码错误！`);
        if (ip) { // 只有在获取到 IP 的情况下才设置冷却
            // --- 设置冷却计时器 ---
            const expiryTime = Date.now() + COOLDOWN_SECONDS * 1000; // 计算到期时间
            cooldowns.set(ip, expiryTime); // 将 IP 和到期时间存入 Map
            console.log(`[${ip}] 设置冷却时间 ${COOLDOWN_SECONDS} 秒。`);
            // --- 返回包含冷却信息的错误响应 ---
            // 使用 429 状态码表示请求受限
            res.status(429).json({
                correct: false,               // 密码本身是错的
                cooldown: true,               // 明确告知进入冷却状态
                remaining: COOLDOWN_SECONDS,  // 告知初始的完整冷却时间
                message: `密码错误！请等待 ${COOLDOWN_SECONDS} 秒...` // 错误消息也提示冷却
            });
        } else {
            // 如果无法获取 IP，只返回普通的密码错误响应
             res.status(401).json({ correct: false, message: '密码错误' });
        }
    }
});
// === API 端点 2 结束 ===


// === API 端点 3: 检查 next.html 页面的密码 (POST /check-next-passwords) ===
app.post('/check-next-passwords', (req, res) => {
    const { password_1, password_2 } = req.body; // 从请求体获取两个密码
    const ip = getRequestIp(req); // 获取请求 IP

    if (!ip) {
        console.warn("无法确定 IP 地址，next.html 密码检查将跳过冷却逻辑。");
    } else {
        console.log(`[${ip}] 收到 next.html 密码检查请求。`);
        // --- 检查 IP 是否已处于冷却状态 (共享同一个冷却 Map) ---
        if (cooldowns.has(ip)) {
            const expiryTime = cooldowns.get(ip);
            const now = Date.now();
            if (now < expiryTime) {
                const remainingSeconds = Math.ceil((expiryTime - now) / 1000);
                console.log(`[${ip}] 访问被拒绝 (next.html)。冷却中，剩余 ${remainingSeconds} 秒。`);
                return res.status(429).json({
                    correct: false, cooldown: true, remaining: remainingSeconds,
                    message: `请求过于频繁，请等待 ${remainingSeconds} 秒后再试。`
                });
            } else {
                cooldowns.delete(ip); console.log(`[${ip}] 冷却已到期 (next.html)。`);
            }
        }
        // --- 冷却检查结束 ---
    }

    // 基本参数验证
    if (password_1 === undefined || password_2 === undefined) {
        return res.status(400).json({ correct: false, message: '请求缺少必要参数' });
    }

    // --- 从 .env 文件获取 next.html 的正确密码 ---
    const correctPassword1 = process.env.NEXT_PASS_1;
    const correctPassword2 = process.env.NEXT_PASS_2;

    // 检查密码是否已在 .env 文件中定义
    if (correctPassword1 === undefined || correctPassword2 === undefined) {
        console.error("错误：next.html 的密码 (NEXT_PASS_1 或 NEXT_PASS_2) 未在 .env 文件中定义");
        return res.status(500).json({ correct: false, message: '服务器配置错误' });
    }

    // --- 比较密码 ---
    if (password_1 === correctPassword1 && password_2 === correctPassword2) {
        // --- 两个密码都正确 ---
        console.log(`[${ip || '未知 IP'}] next.html 密码正确！`);
        if (ip && cooldowns.has(ip)) { // 清除可能存在的旧冷却记录
            cooldowns.delete(ip); console.log(`[${ip}] 冷却记录已清除。`);
        }
        res.json({ correct: true }); // 返回成功响应

    } else {
        // --- 至少有一个密码错误 ---
        console.log(`[${ip || '未知 IP'}] next.html 密码错误！`);
        if (ip) { // 只有在能获取 IP 时才设置冷却
            // --- 设置冷却计时器 (与主页面共享) ---
            const expiryTime = Date.now() + COOLDOWN_SECONDS * 1000;
            cooldowns.set(ip, expiryTime);
            console.log(`[${ip}] 设置冷却时间 ${COOLDOWN_SECONDS} 秒。`);
            // --- 返回包含冷却信息的错误响应 ---
            res.status(429).json({
                correct: false, cooldown: true, remaining: COOLDOWN_SECONDS,
                message: `密码错误！请等待 ${COOLDOWN_SECONDS} 秒...`
            });
        } else {
            // 无法获取 IP，只返回普通错误
             res.status(401).json({ correct: false, message: '密码错误' });
        }
    }
});
// === API 端点 3 结束 ===


// --- 定期清理过期的冷却记录 ---
// 设置一个定时器，每隔一段时间检查 cooldowns Map，移除已过期的条目
// 这有助于防止 Map 无限制增长，尤其是在有大量短暂访问或攻击尝试时
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    // 遍历 Map 中的所有条目
    for (const [ip, expiryTime] of cooldowns.entries()) {
        // 如果当前时间大于等于到期时间，则删除该条目
        if (now >= expiryTime) {
            cooldowns.delete(ip);
            cleanedCount++;
        }
    }
    // (可选) 打印清理日志
    // if (cleanedCount > 0) { console.log(`[冷却清理] 移除了 ${cleanedCount} 个过期条目。`); }
}, 60 * 1000); // 每 60000 毫秒（1分钟）清理一次
// --- 清理逻辑结束 ---


// --- 优雅关闭处理 ---
// 监听进程收到的关闭信号 (如 Ctrl+C 或系统 kill)
const shutdown = () => {
    console.log('正在关闭服务器...');
    clearInterval(cleanupInterval); // 停止清理计时器
    console.log('冷却清理计时器已停止。');
    // 在这里可以添加其他的清理逻辑，比如关闭数据库连接等
    process.exit(0); // 正常退出进程
};
process.on('SIGINT', shutdown);  // 捕获 Ctrl+C
process.on('SIGTERM', shutdown); // 捕获 kill 命令
// --- 优雅关闭结束 ---


// --- 启动服务器 ---
// 让 Express 应用开始监听指定的端口
app.listen(PORT, () => {
    console.log(`密码验证后端服务 (带冷却) 已启动，运行在 http://localhost:${PORT}`);
    console.log(`冷却时间设置为: ${COOLDOWN_SECONDS} 秒`);
});
// --- 启动服务器结束 ---