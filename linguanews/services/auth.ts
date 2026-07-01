import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY = '@linguanews/auth';

export interface AuthState {
  token: string;
  userId: string;
  email: string;
  name: string;
}

function decodeJwtPayload(token: string): { userId: string; email: string; name: string } | null {
  try {
    // JWT payload is base64url-encoded — convert to standard base64 before decoding
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export async function getAuthState(): Promise<AuthState | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export async function saveAuthState(token: string): Promise<void> {
  const payload = decodeJwtPayload(token);
  if (!payload?.userId) throw new Error('Invalid token');
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify({
    token,
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
  } satisfies AuthState));
}

export async function clearAuthState(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
}
