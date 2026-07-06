import { Platform } from 'react-native';
import Purchases, { PurchasesPackage } from 'react-native-purchases';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUE_CAT_API_KEY_IOS ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUE_CAT_API_KEY_ANDROID ?? '';

let configured = false;

// appUserID MUST be the same Google `sub` used as user_id everywhere else —
// otherwise the RevenueCat webhook's app_user_id won't match any user_credits
// row on the backend, and purchases will silently credit nobody.
export function initPurchases(userId: string): void {
  const apiKey = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  if (!apiKey) return;

  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userId });
    configured = true;
  } else {
    void Purchases.logIn(userId);
  }
}

export async function getCreditPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<void> {
  await Purchases.purchasePackage(pkg);
}

export async function restorePurchases(): Promise<void> {
  await Purchases.restorePurchases();
}
