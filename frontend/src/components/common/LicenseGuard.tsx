import React, { useState, useEffect } from 'react';
import { API_CONFIG } from '../../api/config';

const API_BASE = API_CONFIG.apiUrl;

interface LicenseStatus {
  isValid: boolean;
  isInTrial: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number;
  expiresAt: string | null;
}

interface LicenseGuardProps {
  children: React.ReactNode;
  featureName: string;
  featureIcon: string;
}

export function LicenseGuard({ children, featureName, featureIcon }: LicenseGuardProps) {
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/license/status`);
        const result = await res.json();
        if (result.data) {
          setLicenseStatus(result.data);
        }
      } catch (error) {
        console.error('获取授权状态失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">
          <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>
          加载中...
        </div>
      </div>
    );
  }

  if (licenseStatus?.isValid) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <i className={`fa-solid ${featureIcon} text-4xl text-gray-400`}></i>
      </div>
      <h3 className="text-xl font-bold text-gray-800 mb-2">{featureName}</h3>
      <div className="max-w-md text-center mb-6">
        <p className="text-gray-600 mb-2">
          {licenseStatus?.isInTrial 
            ? '试用期已结束' 
            : '该功能需要授权后才能使用'}
        </p>
        <p className="text-sm text-gray-500">
          请联系吴志安老师（QQ：1026913）获取授权码，
          在「系统配置 → 系统授权」中激活后即可使用。
        </p>
      </div>
      <div className="flex gap-3">
        <div className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm">
          <i className="fa-solid fa-shield-halved mr-1"></i>
          授权功能
        </div>
        <div className="px-4 py-2 bg-amber-50 text-amber-600 rounded-lg text-sm">
          <i className="fa-solid fa-gift mr-1"></i>
          激活即享一年
        </div>
      </div>
    </div>
  );
}
