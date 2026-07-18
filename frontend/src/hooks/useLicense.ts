import { useState, useEffect, useCallback } from 'react';
import { API_CONFIG } from '../api/config';

const API_BASE = API_CONFIG.apiUrl;

export type LicenseFeature = 'app_manager' | 'ai' | 'pet' | 'prizes';

export interface LicenseStatus {
  machineCode: string | null;
  licenseCode: string | null;
  isActivated: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  isInTrial: boolean;
  isValid: boolean;
  daysRemaining: number;
  isExpiringSoon: boolean;
}

export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/license/status`);
      const result = await res.json();
      if (result.data) {
        setStatus(result.data);
        setError(null);
      } else {
        setError(result.error || '获取授权状态失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取授权状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const canUseFeature = useCallback((feature: LicenseFeature): boolean => {
    if (!status) return false;
    return status.isValid;
  }, [status]);

  const activateLicense = useCallback(async (licenseCode: string) => {
    try {
      const token = localStorage.getItem('xgpy_token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const res = await fetch(`${API_BASE}/api/license/activate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ licenseCode })
      });
      const result = await res.json();
      if (result.data?.success) {
        await fetchStatus();
        return { success: true, message: result.data.message };
      } else {
        return { success: false, error: result.error || '激活失败' };
      }
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : '激活失败' 
      };
    }
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    fetchStatus,
    canUseFeature,
    activateLicense,
  };
}
