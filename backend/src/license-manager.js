const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const LICENSE_SECRET = 'xgpy_2024_license_salt_!@#$';
const TRIAL_END_DATE = new Date('2027-06-01T00:00:00');
const EXPIRING_SOON_DAYS = 30;
const NETWORK_TIME_CACHE_TTL = 60000;
const MAX_TIME_DRIFT_MS = 5 * 60 * 1000;
const DEFAULT_MONTHS = 13;

const ENCRYPTION_KEY = crypto.createHash('sha256').update(LICENSE_SECRET + '_aes_key').digest();
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

const FEATURES = {
  APP_MANAGER: 'app_manager',
  AI: 'ai',
  PET: 'pet',
  PRIZES: 'prizes',
  ANALYTICS: 'analytics',
  ROLL_CALL: 'roll_call',
  TASK_MANAGER: 'task_manager',
  PROXY_NET: 'proxy_net',
  GAME: 'game',
};

const TIME_API_URLS = [
  'https://worldtimeapi.org/api/timezone/Asia/Shanghai',
  'https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp',
  'http://worldtimeapi.org/api/timezone/Asia/Shanghai',
];

class LicenseManager {
  constructor(pool) {
    this.pool = pool;
    this._cachedNetworkTime = null;
    this._networkTimeCacheTime = 0;
  }

  _execPromise(cmd) {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(''); return; }
        resolve(stdout.trim());
      });
    });
  }

  async getCurrentMachineCode() {
    const [cpuId, biosSerial, macAddr, diskSerial] = await Promise.all([
      this._execPromise('wmic cpu get processorid /value'),
      this._execPromise('wmic bios get serialnumber /value'),
      this._execPromise('wmic nic where "NetEnabled=true" get MACAddress /value'),
      this._execPromise('wmic diskdrive get serialnumber /value'),
    ]);

    const cpu = (cpuId.match(/ProcessorId=(.+)/i) || [])[1] || 'UNKNOWN_CPU';
    const bios = (biosSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_BIOS';
    const mac = (macAddr.match(/MACAddress=(.+)/i) || [])[1] || 'UNKNOWN_MAC';
    const disk = (diskSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_DISK';

    const raw = `${cpu.trim()}|${bios.trim()}|${mac.trim()}|${disk.trim()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
    const machineCode = this.formatCode(hash);
    return { machineCode, raw };
  }

  formatCode(code) {
    const parts = [];
    for (let i = 0; i < code.length; i += 4) {
      parts.push(code.substring(i, i + 4));
    }
    return parts.join('-').toUpperCase();
  }

  async getLicenseRecord(machineCode) {
    if (!machineCode) {
      const [rows] = await this.pool.query(
        'SELECT * FROM system_license WHERE id = 1'
      );
      return rows.length > 0 ? rows[0] : null;
    }
    const [rows] = await this.pool.query(
      'SELECT * FROM system_license WHERE machine_code = ?',
      [machineCode]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  _fetchUrl(url) {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  async _fetchNetworkTime() {
    for (const url of TIME_API_URLS) {
      try {
        const body = await this._fetchUrl(url);
        if (!body) continue;

        let timestamp = null;
        if (url.includes('worldtimeapi')) {
          const parsed = JSON.parse(body);
          if (parsed && parsed.unixtime) {
            timestamp = parsed.unixtime * 1000;
          } else if (parsed && parsed.datetime) {
            timestamp = new Date(parsed.datetime).getTime();
          }
        } else if (url.includes('taobao')) {
          const parsed = JSON.parse(body);
          const t = parsed?.data?.t;
          if (t) {
            timestamp = parseInt(t);
          }
        }

        if (timestamp && !isNaN(timestamp)) {
          return new Date(timestamp);
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async getAuthoritativeTime() {
    const serverTime = new Date();
    const now = Date.now();

    if (this._cachedNetworkTime && (now - this._networkTimeCacheTime) < NETWORK_TIME_CACHE_TTL) {
      const drift = Math.abs(this._cachedNetworkTime.getTime() - serverTime.getTime());
      if (drift > MAX_TIME_DRIFT_MS) {
        return { now: serverTime, source: 'server', tamperDetected: true };
      }
      const earlierTime = this._cachedNetworkTime.getTime() < serverTime.getTime()
        ? this._cachedNetworkTime : serverTime;
      return { now: new Date(earlierTime), source: 'authoritative', tamperDetected: false };
    }

    const networkTime = await this._fetchNetworkTime();
    this._cachedNetworkTime = networkTime;
    this._networkTimeCacheTime = Date.now();

    if (networkTime) {
      const drift = Math.abs(networkTime.getTime() - serverTime.getTime());
      if (drift > MAX_TIME_DRIFT_MS) {
        console.warn(`[License] 时间偏差过大: 服务器时间=${serverTime.toISOString()}, 网络时间=${networkTime.toISOString()}, 偏差=${Math.round(drift/1000)}秒`);
        const earlierTime = networkTime.getTime() < serverTime.getTime()
          ? networkTime : serverTime;
        return { now: new Date(earlierTime), source: 'authoritative', tamperDetected: true };
      }
      const earlierTime = networkTime.getTime() < serverTime.getTime()
        ? networkTime : serverTime;
      return { now: new Date(earlierTime), source: 'authoritative', tamperDetected: false };
    }

    return { now: serverTime, source: 'server', tamperDetected: false };
  }

  encryptLicenseData(machineCode, expireTimestamp) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    const plaintext = `${machineCode}|${expireTimestamp}`;
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return Buffer.concat([iv, encrypted]).toString('hex').toUpperCase();
  }

  decryptLicenseData(encoded) {
    const data = Buffer.from(encoded, 'hex');
    const iv = data.slice(0, IV_LENGTH);
    const encrypted = data.slice(IV_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const parts = decrypted.toString('utf8').split('|');
    return { machineCode: parts[0], expireTimestamp: parseInt(parts[1], 10) };
  }

  isInTrialPeriod(now = new Date()) {
    return now < TRIAL_END_DATE;
  }

  isFreeOpenDay(now = new Date()) {
    const dayOfWeek = now.getDay();
    return dayOfWeek === 3;
  }

  async getLicenseStatus() {
    const { now, tamperDetected } = await this.getAuthoritativeTime();
    const isInTrial = this.isInTrialPeriod(now);
    const isFreeOpenDay = this.isFreeOpenDay(now);

    // 计算当前机器码，按机器码查询授权记录
    let currentMachineCode = null;
    try {
      const mc = await this.getCurrentMachineCode();
      currentMachineCode = mc.machineCode;
    } catch (e) {
      console.error('[License] 获取机器码失败:', e.message);
    }

    let record = null;
    if (currentMachineCode) {
      record = await this.getLicenseRecord(currentMachineCode);
    }

    // 如果当前机器码没查到，查 id=1 看是否是同一台机器（兼容老数据迁移）
    if (!record) {
      const legacyRecord = await this.getLicenseRecord();
      if (legacyRecord && legacyRecord.machine_code) {
        const cleanLegacyMC = legacyRecord.machine_code.replace(/-/g, '');
        const cleanCurrentMC = currentMachineCode ? currentMachineCode.replace(/-/g, '') : '';
        if (cleanLegacyMC === cleanCurrentMC) {
          // 机器码一致，可以复用 id=1 的激活记录
          record = legacyRecord;
        }
        // 机器码不一致则不用，保持 record=null
      }
    }

    // 未激活或未查到记录：以全局试用期为唯一有效标准
    if (!record || !record.is_activated) {
      const trialExpiresAt = TRIAL_END_DATE;
      const trialValid = isInTrial && now < trialExpiresAt;
      return {
        machineCode: currentMachineCode,
        licenseCode: null,
        isActivated: false,
        activatedAt: null,
        expiresAt: trialExpiresAt.toISOString(),
        isInTrial,
        isValid: trialValid,
        isFreeOpenDay,
        daysRemaining: trialValid
          ? Math.ceil((trialExpiresAt - now) / (1000 * 60 * 60 * 24))
          : 0,
        isExpiringSoon: trialValid && this._isExpiringSoon(trialExpiresAt, now),
        tamperDetected,
      };
    }

    // 已激活时：以授权码到期时间为准
    const isActivated = true;
    const expiresAt = record.expires_at
      ? new Date(record.expires_at)
      : null;

    const isValid = expiresAt ? now < expiresAt : false;
    const daysRemaining = expiresAt
      ? Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)))
      : 0;
    const isExpiringSoon = isValid && expiresAt && this._isExpiringSoon(expiresAt, now);

    return {
      machineCode: currentMachineCode,
      licenseCode: record.license_code || null,
      isActivated,
      activatedAt: record.activated_at || null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      isInTrial: false,
      isValid,
      isFreeOpenDay,
      daysRemaining,
      isExpiringSoon,
      tamperDetected,
    };
  }

  _isExpiringSoon(expiresAt, now = new Date()) {
    const diffMs = expiresAt - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= EXPIRING_SOON_DAYS && diffDays > 0;
  }

  async checkFeatureLicense(feature) {
    const status = await this.getLicenseStatus();
    return {
      allowed: status.isValid || status.isFreeOpenDay,
      status,
    };
  }

  async activateLicense(licenseCode) {
    if (!licenseCode) {
      return { success: false, error: '请输入授权码' };
    }

    const cleanCode = licenseCode.trim().toUpperCase().replace(/-/g, '');

    // 计算当前机器码
    let currentMachineCode;
    try {
      const mc = await this.getCurrentMachineCode();
      currentMachineCode = mc.machineCode;
    } catch (e) {
      return { success: false, error: '获取机器码失败: ' + e.message };
    }

    // 用当前机器码找记录，没有则先插入一行
    let record = await this.getLicenseRecord(currentMachineCode);
    if (!record) {
      await this.pool.query(
        'INSERT IGNORE INTO system_license (machine_code) VALUES (?)',
        [currentMachineCode]
      );
      record = await this.getLicenseRecord(currentMachineCode);
    }

    if (!record || !record.machine_code || record.machine_code === 'PENDING') {
      return { success: false, error: '机器码无效，请先刷新' };
    }

    let decoded;
    try {
      decoded = this.decryptLicenseData(cleanCode);
    } catch {
      return { success: false, error: '授权码格式无效，请检查后重试' };
    }

    // 用当前实时计算的机器码校验
    const cleanCurrentMC = currentMachineCode.replace(/-/g, '');
    if (decoded.machineCode !== cleanCurrentMC) {
      return { success: false, error: '授权码与当前服务器不匹配，请使用当前服务器的机器码生成授权码' };
    }

    const { now } = await this.getAuthoritativeTime();
    const codedExpiresAt = new Date(decoded.expireTimestamp);

    if (codedExpiresAt <= now) {
      return { success: false, error: '此授权码已过期，无法激活' };
    }

    // 更新当前机器码对应的行（不再固定 id=1）
    await this.pool.query(
      `UPDATE system_license 
       SET license_code = ?, is_activated = TRUE, activated_at = NOW(), expires_at = ?,
           machine_code = ?  -- 同步写入当前机器码，确保绑定正确
       WHERE machine_code = ?`,
      [cleanCode, codedExpiresAt, currentMachineCode, currentMachineCode]
    );

    const newStatus = await this.getLicenseStatus();

    return {
      success: true,
      message: '系统授权成功！有效期至 ' + codedExpiresAt.toLocaleDateString('zh-CN'),
      newExpiresAt: codedExpiresAt.toISOString(),
      status: newStatus,
    };
  }

  generateLicenseCode(machineCode, months = DEFAULT_MONTHS) {
    const clean = machineCode.trim().toUpperCase().replace(/-/g, '');
    if (clean.length !== 32) {
      throw new Error('机器码格式不正确');
    }

    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + months);

    const encrypted = this.encryptLicenseData(clean, expireDate.getTime());
    return this.formatCode(encrypted);
  }
}

module.exports = { LicenseManager, FEATURES, TRIAL_END_DATE, EXPIRING_SOON_DAYS };
