const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const LICENSE_SECRET = 'xgpy_2024_license_salt_!@#$';
const TRIAL_END_DATE = new Date('2027-06-01T00:00:00');
const EXPIRING_SOON_DAYS = 30;
const NETWORK_TIME_CACHE_TTL = 60000;
const NETWORK_TIME_FAILURE_CACHE_TTL = 5 * 60 * 1000; // 外网校时失败的负缓存时长（内网环境避免周期性阻塞）
const MACHINE_CODE_CACHE_TTL = 5 * 60 * 1000; // 机器码缓存：硬件信息稳定，5 分钟内不重复查询（wmic 很慢）
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
  CREATIVE: 'creative',
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
    this._machineCodeCache = null;
    this._machineCodeCacheTime = 0;
  }

  _execPromise(cmd) {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(''); return; }
        resolve(stdout.trim());
      });
    });
  }

  _extractAllValues(wmicOutput, keyName) {
    if (!wmicOutput) return [];
    const regex = new RegExp(`^${keyName}=(.+)$`, 'gim');
    const values = [];
    let match;
    while ((match = regex.exec(wmicOutput)) !== null) {
      const v = match[1].trim();
      if (v) values.push(v);
    }
    return values.sort();
  }

  _hashMachineCode(raw) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
    return this.formatCode(hash);
  }

  async getCurrentMachineCode() {
    // 机码缓存：避免每个授权请求都派生子进程执行 4 条 wmic（CPU/BIOS/网卡/磁盘），显著影响接口耗时
    const now = Date.now();
    if (this._machineCodeCache && (now - this._machineCodeCacheTime) < MACHINE_CODE_CACHE_TTL) {
      return { ...this._machineCodeCache };
    }

    const [cpuId, biosSerial, macAddr, diskSerial] = await Promise.all([
      this._execPromise('wmic cpu get processorid /value'),
      this._execPromise('wmic bios get serialnumber /value'),
      this._execPromise('wmic nic where "NetEnabled=true" get MACAddress /value'),
      this._execPromise('wmic diskdrive get serialnumber /value'),
    ]);

    // 算法 A（原始/兼容）：只取第一个匹配项，与已激活记录中绑定的 hash 保持一致
    const cpuA = (cpuId.match(/ProcessorId=(.+)/i) || [])[1] || 'UNKNOWN_CPU';
    const biosA = (biosSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_BIOS';
    const macA = (macAddr.match(/MACAddress=(.+)/i) || [])[1] || 'UNKNOWN_MAC';
    const diskA = (diskSerial.match(/SerialNumber=(.+)/i) || [])[1] || 'UNKNOWN_DISK';
    const rawA = `${cpuA.trim()}|${biosA.trim()}|${macA.trim()}|${diskA.trim()}`;

    // 算法 B（稳定）：取全部值后排序拼接，避免多网卡/多磁盘 WMI 枚举顺序波动导致同一台机器结果变化
    const cpusB = this._extractAllValues(cpuId, 'ProcessorId');
    const biosesB = this._extractAllValues(biosSerial, 'SerialNumber');
    const macsB = this._extractAllValues(macAddr, 'MACAddress');
    const disksB = this._extractAllValues(diskSerial, 'SerialNumber');
    const cpuB = cpusB.length > 0 ? cpusB.join(',') : 'UNKNOWN_CPU';
    const biosB = biosesB.length > 0 ? biosesB.join(',') : 'UNKNOWN_BIOS';
    const macB = macsB.length > 0 ? macsB.join(',') : 'UNKNOWN_MAC';
    const diskB = disksB.length > 0 ? disksB.join(',') : 'UNKNOWN_DISK';
    const rawB = `${cpuB}|${biosB}|${macB}|${diskB}`;

    const machineCodeA = this._hashMachineCode(rawA);
    const machineCodeB = this._hashMachineCode(rawB);

    const result = {
      machineCode: machineCodeB,
      raw: rawB,
      machineCodeLegacy: machineCodeA,
    };
    this._machineCodeCache = result;
    this._machineCodeCacheTime = Date.now();
    return { ...result };
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

    // 成功校时缓存 60s；若上次外网校时失败（内网/断网），5 分钟内直接用服务器时间，
    // 避免每 60 秒就有请求被多个外网地址串行超时阻塞（每个 3s，最多 ~9s）
    const networkTimeFresh = this._cachedNetworkTime
      && (now - this._networkTimeCacheTime) < NETWORK_TIME_CACHE_TTL;
    const networkFailureHold = !this._cachedNetworkTime
      && this._networkTimeCacheTime > 0
      && (now - this._networkTimeCacheTime) < NETWORK_TIME_FAILURE_CACHE_TTL;

    if (networkTimeFresh) {
      const drift = Math.abs(this._cachedNetworkTime.getTime() - serverTime.getTime());
      if (drift > MAX_TIME_DRIFT_MS) {
        return { now: serverTime, source: 'server', tamperDetected: true };
      }
      const earlierTime = this._cachedNetworkTime.getTime() < serverTime.getTime()
        ? this._cachedNetworkTime : serverTime;
      return { now: new Date(earlierTime), source: 'authoritative', tamperDetected: false };
    }

    if (networkFailureHold) {
      return { now: serverTime, source: 'server', tamperDetected: false };
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

    // 计算当前机器码（双算法：稳定算法B + 兼容算法A）
    let currentMachineCode = null;       // 算法B：排序拼接，稳定，对外暴露
    let currentMachineCodeLegacy = null; // 算法A：仅取第一个，兼容历史激活记录
    try {
      const mc = await this.getCurrentMachineCode();
      currentMachineCode = mc.machineCode;
      currentMachineCodeLegacy = mc.machineCodeLegacy;
    } catch (e) {
      console.error('[License] 获取机器码失败:', e.message);
    }

    let record = null;

    // 1. 优先用算法B（稳定）查询
    if (currentMachineCode) {
      record = await this.getLicenseRecord(currentMachineCode);
    }

    // 2. 算法B没命中，用算法A（兼容历史激活）查询——多网卡/多磁盘WMI枚举顺序波动时，历史激活记录绑定的是当时A的值
    if (!record && currentMachineCodeLegacy && currentMachineCodeLegacy !== currentMachineCode) {
      record = await this.getLicenseRecord(currentMachineCodeLegacy);
    }

    // 3. 仍没命中，fallback 到 id=1 的 legacy 行
    if (!record) {
      const legacyRecord = await this.getLicenseRecord();
      if (legacyRecord && legacyRecord.machine_code) {
        const cleanLegacyMC = legacyRecord.machine_code.replace(/-/g, '');
        const cleanStableMC = currentMachineCode ? currentMachineCode.replace(/-/g, '') : '';
        const cleanLegacyAlgoMC = currentMachineCodeLegacy ? currentMachineCodeLegacy.replace(/-/g, '') : '';

        // 3a. 严格匹配：算法B或算法A任一与 legacy 行 machine_code 一致 → 直接复用
        // 说明：算法B内部已对多网卡/多磁盘WMI枚举值做排序拼接，同一台机器的结果稳定；
        //      若因网卡/磁盘硬件增减导致机器码变化，属于合理的重新激活触发条件，
        //      不应放宽为「全表只有1条激活就信任id=1」——否则多机共库场景下
        //      未激活的第二台服务器可直接绕过授权继承第一台的激活状态。
        if (cleanLegacyMC === cleanStableMC || cleanLegacyMC === cleanLegacyAlgoMC) {
          record = legacyRecord;
        }
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

    // 计算当前机器码（双算法）
    let currentMachineCode;       // 算法B（稳定）
    let currentMachineCodeLegacy; // 算法A（兼容）
    try {
      const mc = await this.getCurrentMachineCode();
      currentMachineCode = mc.machineCode;
      currentMachineCodeLegacy = mc.machineCodeLegacy;
    } catch (e) {
      return { success: false, error: '获取机器码失败: ' + e.message };
    }

    const cleanStableMC = currentMachineCode.replace(/-/g, '');
    const cleanLegacyMC = currentMachineCodeLegacy ? currentMachineCodeLegacy.replace(/-/g, '') : '';

    // 先用算法B查询/插入
    let record = await this.getLicenseRecord(currentMachineCode);

    // 算法B没命中，再查算法A对应的行（可能历史上用算法A激活到了独立行）
    if (!record && currentMachineCodeLegacy && currentMachineCodeLegacy !== currentMachineCode) {
      record = await this.getLicenseRecord(currentMachineCodeLegacy);
    }

    // 都没命中：用算法B（稳定）插入新行作为这台机器的永久绑定行
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

    // 双算法校验：授权码绑定的机器码只要匹配当前算法B或算法A的clean hash即可
    // 兼容用户可能用页面显示的稳定机器码（B）或旧版算法（A）生成的授权码
    const decodedMC = decoded.machineCode;
    if (decodedMC !== cleanStableMC && decodedMC !== cleanLegacyMC) {
      return { success: false, error: '授权码与当前服务器不匹配，请使用当前服务器的机器码生成授权码' };
    }

    const { now } = await this.getAuthoritativeTime();
    const codedExpiresAt = new Date(decoded.expireTimestamp);

    if (codedExpiresAt <= now) {
      return { success: false, error: '此授权码已过期，无法激活' };
    }

    // 如果命中的是算法A的历史行，先把 license 更新到算法B的稳定行，避免后续 WMI 枚举波动再丢激活
    let targetMachineCode = currentMachineCode; // 目标：始终写入算法B的稳定行
    if (record.machine_code !== currentMachineCode) {
      // 先确保算法B的行存在
      await this.pool.query(
        'INSERT IGNORE INTO system_license (machine_code) VALUES (?)',
        [currentMachineCode]
      );
    }

    // 更新算法B的稳定行（永久绑定，不受 WMI 枚举顺序影响）
    await this.pool.query(
      `UPDATE system_license 
       SET license_code = ?, is_activated = TRUE, activated_at = NOW(), expires_at = ?,
           machine_code = ?
       WHERE machine_code = ?`,
      [cleanCode, codedExpiresAt, currentMachineCode, currentMachineCode]
    );

    // 如果之前的算法A行存在且是激活的，清空其激活标志避免双行混淆（仅当其不是同一行时）
    if (currentMachineCodeLegacy && currentMachineCodeLegacy !== currentMachineCode) {
      await this.pool.query(
        `UPDATE system_license 
         SET is_activated = FALSE, license_code = NULL, activated_at = NULL, expires_at = NULL
         WHERE machine_code = ? AND is_activated = TRUE`,
        [currentMachineCodeLegacy]
      );
    }

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
