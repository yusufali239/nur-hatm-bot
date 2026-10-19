/**
 * Telegram WebApp Haptic Feedback & User Identity Helper
 * Delivers native iOS tactile feel on every tap, selection, and completion.
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        };
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.('#0A0A0F');
      tg.setBackgroundColor?.('#0A0A0F');
    } catch {
      // Ignore in browser mode
    }
  }
}

export function triggerHaptic(
  type: 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light'
): void {
  const haptic = window.Telegram?.WebApp?.HapticFeedback;
  try {
    if (haptic) {
      if (type === 'selection') {
        haptic.selectionChanged();
      } else if (type === 'success' || type === 'warning' || type === 'error') {
        haptic.notificationOccurred(type);
      } else {
        haptic.impactOccurred(type);
      }
      return;
    }
    // Fallback subtle vibration on mobile browsers outside Telegram
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(type === 'heavy' || type === 'success' ? 18 : 8);
    }
  } catch {
    // Ignore if blocked by browser policy
  }
}

export interface TelegramIdentity {
  id: number;
  name: string;
  username: string | null;
}

export function getTelegramUserIdentity(): TelegramIdentity {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (tgUser && tgUser.id) {
    const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();
    return {
      id: tgUser.id,
      name: fullName || tgUser.username || `Муслим #${tgUser.id}`,
      username: tgUser.username || null,
    };
  }

  // Persistent local identity for browser testing / demo
  const saved = localStorage.getItem('nur_hatm_demo_user');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fallback below
    }
  }

  const defaultIdentity: TelegramIdentity = {
    id: 777000,
    name: 'Сардорбек (Сиз)',
    username: 'sardor_qori',
  };
  localStorage.setItem('nur_hatm_demo_user', JSON.stringify(defaultIdentity));
  return defaultIdentity;
}
