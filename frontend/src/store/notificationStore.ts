import { create } from 'zustand';
import { backendClient } from '../api/backendClient';
import { API_CONFIG } from '../api/config';
import { useAuth } from '../hooks/useAuth';

export interface Notification {
  id: number;
  teacher_id: number;
  title: string;
  content: string;
  notification_type: 'all' | 'class' | 'student';
  target_class_id: number | null;
  target_student_ids: number[] | null;
  has_point_reward: boolean;
  point_reward_amount: number;
  point_reward_reason: string;
  has_point_penalty: boolean;
  point_penalty_amount: number;
  point_penalty_reason: string;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  is_read?: boolean;
  read_at?: string | null;
  point_change?: number;
  point_change_reason?: string;
  teacher_name?: string;
  target_name?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  showNotificationCenter: boolean;
  showNotificationPopup: Notification | null;
  fetchNotifications: (studentId: number | string) => Promise<void>;
  fetchUnreadCount: (studentId: number | string) => Promise<void>;
  markAsRead: (notificationId: number, studentId: number | string) => Promise<void>;
  markAllAsRead: (studentId: number | string) => Promise<void>;
  setShowNotificationCenter: (show: boolean) => void;
  setShowNotificationPopup: (notification: Notification | null) => void;
  clearPopup: () => void;
  checkForNewNotifications: (studentId: number | string) => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  showNotificationCenter: false,
  showNotificationPopup: null,

  fetchNotifications: async (studentId: number | string) => {
    try {
      set({ isLoading: true });
      
      const response = await fetch(`${API_CONFIG.apiUrl}/api/notifications/student/${studentId}`);
      
      // 检查是否是HTML响应
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }
      
      const result = await response.json();
      
      if (!result.error) {
        set({ notifications: result.data });
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchUnreadCount: async (studentId: number | string) => {
    try {
      const response = await fetch(`${API_CONFIG.apiUrl}/api/notifications/student/${studentId}/unread-count`);
      
      // 检查是否是HTML响应
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }
      
      const result = await response.json();
      
      if (!result.error) {
        set({ unreadCount: result.data.count });
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  },

  markAsRead: async (notificationId: number, studentId: number | string) => {
    try {
      const response = await fetch(`${API_CONFIG.apiUrl}/api/notifications/recipient/${notificationId}/read`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      });

      // 检查是否是HTML响应
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }

      const result = await response.json();
      
      if (!result.error) {
        // 更新本地状态
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === notificationId ? { ...n, is_read: true } : n
          ),
          unreadCount: Math.max(0, state.unreadCount - 1),
        }));
      }
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  },

  markAllAsRead: async (studentId: number | string) => {
    try {
      const response = await fetch(`${API_CONFIG.apiUrl}/api/notifications/student/${studentId}/read-all`, {
        method: 'PUT',
      });

      // 检查是否是HTML响应
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/html')) {
        console.error('Server returned HTML instead of JSON');
        return;
      }

      const result = await response.json();
      
      if (!result.error) {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
          unreadCount: 0,
        }));
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  },

  setShowNotificationCenter: (show: boolean) => set({ showNotificationCenter: show }),

  setShowNotificationPopup: (notification: Notification | null) => 
    set({ showNotificationPopup: notification }),

  clearPopup: () => set({ showNotificationPopup: null }),

  checkForNewNotifications: async (studentId: number | string) => {
    try {
      // 获取当前通知数
      const oldCount = get().unreadCount;
      const oldNotifications = get().notifications;
      
      // 获取最新的未读计数和通知列表
      await get().fetchUnreadCount(studentId);
      await get().fetchNotifications(studentId);
      
      const newCount = get().unreadCount;
      const newNotifications = get().notifications;
      
      // 如果有新通知，显示弹窗
      if (newCount > oldCount && newNotifications.length > 0) {
        const latestNotification = newNotifications[0];
        if (!latestNotification.is_read) {
          set({ showNotificationPopup: latestNotification });
          
          // 5秒后自动隐藏弹窗
          setTimeout(() => {
            if (get().showNotificationPopup?.id === latestNotification.id) {
              set({ showNotificationPopup: null });
            }
          }, 5000);
        }
      }
    } catch (error) {
      console.error('Failed to check for new notifications:', error);
    }
  },
}));