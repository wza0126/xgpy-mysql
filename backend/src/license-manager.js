const crypto = require('crypto');
const http = require('http');
const https = require('https');

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

  formatCode(code) {
    const parts = [];
    for (let i = 0; i < code.length; i += 4) {
      parts.push(code.substring(i, i + 4));
    }
    return parts.join('-').toUpperCase();
  }

  async getLicenseRecord() {
    const [rows] = await this.pool.query(
      'SELECT * FROM system_license WHERE id = 1'
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
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
    const record = await this.getLicenseRecord();
    const isInTrial = this.isInTrialPeriod(now);
    const isFreeOpenDay = this.isFreeOpenDay(now);

    // 未激活时：以全局试用期为唯一有效标准
    if (!record || !record.is_activated) {
      const trialExpiresAt = TRIAL_END_DATE;
      const trialValid = isInTrial && now < trialExpiresAt;
      return {
        machineCode: record ? (record.machine_code || null) : null,
        licenseCode: record ? (record.license_code || null) : null,
        isActivated: false,
        activatedAt: record ? (record.activated_at || null) : null,
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

    // 已激活时：以授权码到期时间为准，忽略全局试用期
    const machineCode = record.machine_code || null;
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
      machineCode,
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
      allowed: status.isValid,
      status,
    };
  }

  async activateLicense(licenseCode) {
    if (!licenseCode) {
      return { success: false, error: '请输入授权码' };
    }

    const cleanCode = licenseCode.trim().toUpperCase().replace(/-/g, '');
    const record = await this.getLicenseRecord();

    if (!record || !record.machine_code || record.machine_code === 'PENDING') {
      return { success: false, error: '尚未获取机器码，请先刷新' };
    }

    let decoded;
    try {
      decoded = this.decryptLicenseData(cleanCode);
    } catch {
      return { success: false, error: '授权码格式无效，请检查后重试' };
    }

    const localMachineCode = record.machine_code.replace(/-/g, '');
    if (decoded.machineCode !== localMachineCode) {
      return { success: false, error: '授权码与本机不匹配，请检查机器码是否正确' };
    }

    const { now } = await this.getAuthoritativeTime();
    const codedExpiresAt = new Date(decoded.expireTimestamp);

    if (codedExpiresAt <= now) {
      return { success: false, error: '此授权码已过期，无法激活' };
    }

    await this.pool.query(
      `UPDATE system_license 
       SET license_code = ?, is_activated = TRUE, activated_at = NOW(), expires_at = ? 
       WHERE id = 1`,
      [cleanCode, codedExpiresAt]
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
