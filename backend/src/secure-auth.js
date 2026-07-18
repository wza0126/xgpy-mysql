// ==============================================
// 安全认证中间件
// ==============================================

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class SecureAuth {
    constructor(pool) {
        this.pool = pool;
        this.SESSION_TIMEOUT_HOURS = 24;
        this.MAX_CONCURRENT_SESSIONS = 3;
    }

    // 生成安全的Token
    generateToken() {
        const timestamp = Date.now();
        const randomBytes = crypto.randomBytes(32);
        const data = `${timestamp}.${randomBytes.toString('hex')}`;
        
        const secret = process.env.TOKEN_SECRET;
        if (!secret) {
            throw new Error('TOKEN_SECRET is required');
        }

        // 创建签名
        const token = crypto
            .createHmac('sha256', secret)
            .update(data)
            .digest('hex');
        
        return {
            raw: `${timestamp}.${token}`,
            hash: crypto.createHash('sha256').update(`${timestamp}.${token}`).digest('hex')
        };
    }

    // 验证Token
    async validateToken(token) {
        try {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            
            const [sessions] = await this.pool.query(`
                SELECT ls.*, p.username, p.real_name, p.role, p.class_id, p.current_points, p.max_points
                FROM login_sessions ls
                JOIN profiles p ON ls.user_id = p.id
                WHERE ls.token = ? AND ls.is_active = TRUE AND ls.expires_at > NOW()
            `, [tokenHash]);
            
            if (sessions.length === 0) {
                return { valid: false, error: '会话无效或已过期' };
            }
            
            const session = sessions[0];
            
            // 更新最后活跃时间
            await this.pool.query(
                'UPDATE login_sessions SET last_active_at = NOW() WHERE id = ?',
                [session.id]
            );
            
            return {
                valid: true,
                session: {
                    id: session.id,
                    userId: session.user_id,
                    username: session.username,
                    realName: session.real_name,
                    role: session.role,
                    classId: session.class_id,
                    currentPoints: session.current_points,
                    maxPoints: session.max_points,
                    deviceInfo: session.device_info,
                    ipAddress: session.ip_address,
                    lastActiveAt: session.last_active_at
                }
            };
        } catch (error) {
            console.error('Token validation error:', error);
            return { valid: false, error: '验证失败' };
        }
    }

    // 安全登录
    async secureLogin(username, password, deviceInfo, ipAddress, userAgent) {
        try {
            // 1. 验证用户名密码
            const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
            
            const [users] = await this.pool.query(
                'SELECT * FROM profiles WHERE username = ? AND password_hash = ?',
                [username, passwordHash]
            );
            
            if (users.length === 0) {
                // 记录失败登录
                await this.recordFailedLogin(username, ipAddress, userAgent, 'invalid_credentials');
                return { success: false, error: '用户名或密码错误' };
            }
            
            const user = users[0];
            
            // 2. 检查用户状态
            if (user.allow_login === 0 || user.allow_login === false) {
                await this.recordFailedLogin(username, ipAddress, userAgent, 'account_disabled');
                return { success: false, error: '账号已被禁用' };
            }
            
            // 3. 获取安全设置
            const [settings] = await this.pool.query(
                'SELECT * FROM security_settings WHERE id = 1'
            );
            
            const security = settings[0] || {};
            
            // 根据用户角色确定使用的设置
            const isTeacher = user.role === 'teacher';
            const maxConcurrentSessions = isTeacher 
                ? (security.max_concurrent_sessions_teacher ?? 5)
                : (security.max_concurrent_sessions_student ?? 1);
            const allowMultipleDevices = isTeacher
                ? (security.allow_multiple_devices_teacher ?? true)
                : (security.allow_multiple_devices_student ?? false);
            const sessionTimeoutHours = security.session_timeout_hours ?? this.SESSION_TIMEOUT_HOURS;
            
            // 4. 检查并发会话限制
            const [activeSessions] = await this.pool.query(
                'SELECT id FROM login_sessions WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()',
                [user.id]
            );
            
            if (!allowMultipleDevices && activeSessions.length > 0) {
                // 不允许多设备，踢出旧会话
                await this.pool.query(
                    'UPDATE login_sessions SET is_active = FALSE WHERE user_id = ? AND is_active = TRUE',
                    [user.id]
                );
            } else if (maxConcurrentSessions > 0 && activeSessions.length >= maxConcurrentSessions) {
                // 超出限制，踢出最早的会话
                await this.pool.query(
                    'DELETE FROM login_sessions WHERE user_id = ? AND is_active = TRUE ORDER BY created_at ASC LIMIT 1',
                    [user.id]
                );
            }
            
            // 5. 生成新Token
            const { raw: token, hash: tokenHash } = this.generateToken();
            const sessionId = uuidv4();
            const expiresAt = new Date(Date.now() + sessionTimeoutHours * 60 * 60 * 1000);
            
            // 6. 创建会话
            await this.pool.query(`
                INSERT INTO login_sessions (
                    id, user_id, token, device_info, ip_address, user_agent,
                    created_at, last_active_at, expires_at, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, TRUE)
            `, [sessionId, user.id, tokenHash, deviceInfo, ipAddress, userAgent, expiresAt]);
            
            // 7. 记录登录历史
            await this.pool.query(`
                INSERT INTO login_history (
                    user_id, login_time, device_info, ip_address, user_agent, login_status
                ) VALUES (?, NOW(), ?, ?, ?, 'success')
            `, [user.id, deviceInfo, ipAddress, userAgent]);
            
            // 8. 清理过期会话
            await this.cleanExpiredSessions();
            
            return {
                success: true,
                token: token,
                sessionId: sessionId,
                user: {
                    id: user.id,
                    username: user.username,
                    realName: user.real_name,
                    role: user.role,
                    classId: user.class_id,
                    currentPoints: user.current_points,
                    maxPoints: user.max_points
                },
                sessionInfo: {
                    expiresAt: expiresAt,
                    activeSessions: activeSessions.length + 1,
                    maxSessions: security.max_concurrent_sessions
                }
            };
            
        } catch (error) {
            console.error('Secure login error:', error);
            return { success: false, error: '登录失败，请稍后重试' };
        }
    }

    // 登出
    async logout(sessionId, userId) {
        try {
            const [result] = await this.pool.query(`
                UPDATE login_sessions 
                SET is_active = FALSE 
                WHERE id = ? AND user_id = ?
            `, [sessionId, userId]);
            
            if (result.affectedRows > 0) {
                // 更新登录历史
                await this.pool.query(`
                    UPDATE login_history 
                    SET logout_time = NOW() 
                    WHERE user_id = ? AND logout_time IS NULL 
                    ORDER BY login_time DESC LIMIT 1
                `, [userId]);
                
                return { success: true };
            }
            
            return { success: false, error: '会话不存在' };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, error: '登出失败' };
        }
    }

    // 强制下线指定会话
    async forceLogoutSession(sessionId, userId) {
        try {
            const [sessions] = await this.pool.query(
                'SELECT user_id, is_active FROM login_sessions WHERE id = ?',
                [sessionId]
            );
            
            if (sessions.length === 0) {
                return { success: false, error: '会话不存在' };
            }
            
            // 只能强制下线自己的会话
            if (sessions[0].user_id !== userId) {
                return { success: false, error: '无权操作' };
            }
            
            // 即使会话已经是不活跃的，也执行更新（确保状态正确）并返回成功
            await this.pool.query(
                'UPDATE login_sessions SET is_active = FALSE WHERE id = ?',
                [sessionId]
            );
            
            return { success: true, message: '已强制下线该设备' };
        } catch (error) {
            console.error('Force logout error:', error);
            return { success: false, error: '操作失败' };
        }
    }

    // 下线所有其他设备
    async logoutOtherDevices(userId, currentSessionId) {
        try {
            const [result] = await this.pool.query(`
                UPDATE login_sessions 
                SET is_active = FALSE 
                WHERE user_id = ? AND id != ? AND is_active = TRUE
            `, [userId, currentSessionId]);
            
            return { 
                success: true, 
                logoutCount: result.affectedRows,
                message: `已下线 ${result.affectedRows} 个其他设备`
            };
        } catch (error) {
            console.error('Logout other devices error:', error);
            return { success: false, error: '操作失败' };
        }
    }

    // 获取用户活跃会话列表
    async getUserSessions(userId) {
        try {
            const [sessions] = await this.pool.query(`
                SELECT 
                    id,
                    device_info,
                    ip_address,
                    created_at,
                    last_active_at,
                    expires_at
                FROM login_sessions 
                WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()
                ORDER BY last_active_at DESC
            `, [userId]);
            
            return { success: true, sessions };
        } catch (error) {
            console.error('Get sessions error:', error);
            return { success: false, sessions: [], error: '获取会话列表失败' };
        }
    }

    // 记录失败登录
    async recordFailedLogin(username, ipAddress, userAgent, reason) {
        try {
            // 尝试找到用户ID
            const [users] = await this.pool.query(
                'SELECT id FROM profiles WHERE username = ?',
                [username]
            );
            
            const userId = users.length > 0 ? users[0].id : null;
            
            await this.pool.query(`
                INSERT INTO login_history (
                    user_id, login_time, ip_address, user_agent, login_status, failure_reason
                ) VALUES (?, NOW(), ?, ?, 'failed', ?)
            `, [userId, ipAddress, userAgent, reason]);
            
            // 检查是否连续失败多次（可选的安全措施）
            await this.checkBruteForce(userId, ipAddress);
            
        } catch (error) {
            console.error('Record failed login error:', error);
        }
    }

    // 检查暴力破解
    async checkBruteForce(userId, ipAddress) {
        try {
            const [failures] = await this.pool.query(`
                SELECT COUNT(*) as count 
                FROM login_history 
                WHERE (user_id = ? OR ip_address = ?) 
                AND login_status = 'failed' 
                AND login_time > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            `, [userId, ipAddress]);
            
            if (failures[0].count >= 5) {
                console.warn(`⚠️ 检测到可能的暴力破解: IP=${ipAddress}, 用户ID=${userId}, 失败次数=${failures[0].count}`);
                // 可以选择记录到安全日志或发送告警
            }
            
        } catch (error) {
            console.error('Check brute force error:', error);
        }
    }

    // 清理过期会话
    async cleanExpiredSessions() {
        try {
            const [result] = await this.pool.query(`
                DELETE FROM login_sessions 
                WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
            `);
            
            if (result.affectedRows > 0) {
                console.log(`🧹 清理了 ${result.affectedRows} 个过期会话`);
            }
            
        } catch (error) {
            console.error('Clean expired sessions error:', error);
        }
    }

    // 获取登录历史
    async getLoginHistory(userId, limit = 20) {
        try {
            const [history] = await this.pool.query(`
                SELECT 
                    id,
                    login_time,
                    logout_time,
                    device_info,
                    ip_address,
                    login_status,
                    failure_reason
                FROM login_history 
                WHERE user_id = ?
                ORDER BY login_time DESC
                LIMIT ?
            `, [userId, limit]);
            
            return { success: true, history };
        } catch (error) {
            console.error('Get login history error:', error);
            return { success: false, history: [], error: '获取登录历史失败' };
        }
    }

    // 获取安全统计
    async getSecurityStats(userId) {
        try {
            const [activeSessions] = await this.pool.query(`
                SELECT COUNT(*) as count FROM login_sessions 
                WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW()
            `, [userId]);
            
            const [loginHistory] = await this.pool.query(`
                SELECT COUNT(*) as count FROM login_history 
                WHERE user_id = ? AND login_time > DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [userId]);
            
            const [failedLogins] = await this.pool.query(`
                SELECT COUNT(*) as count FROM login_history 
                WHERE user_id = ? AND login_status = 'failed' 
                AND login_time > DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [userId]);
            
            return {
                success: true,
                stats: {
                    activeSessions: activeSessions[0].count,
                    totalLogins: loginHistory[0].count,
                    failedLogins: failedLogins[0].count
                }
            };
        } catch (error) {
            console.error('Get security stats error:', error);
            return { success: false, stats: null };
        }
    }
}

module.exports = SecureAuth;
