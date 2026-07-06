import { create } from 'zustand';
import type { PurchasesPackage } from 'react-native-purchases';
import { apiGetCreditBalance, apiGetCreditPacks, CreditPack } from '../services/api';
import { getCreditPackages, purchasePackage } from '../services/purchases';

interface CreditStore {
  balanceUsd: number | null;
  loaded: boolean;
  offerings: PurchasesPackage[];
  paywallVisible: boolean;
  purchasingProductId: string | null;
  loadBalance: () => Promise<void>;
  loadOfferings: () => Promise<void>;
  purchase: (pkg: PurchasesPackage) => Promise<void>;
  showPaywall: () => void;
  hidePaywall: () => void;
}

export const useCreditStore = create<CreditStore>((set, get) => ({
  balanceUsd: null,
  loaded: false,
  offerings: [],
  paywallVisible: false,
  purchasingProductId: null,

  loadBalance: async () => {
    const balance = await apiGetCreditBalance();
    set({ balanceUsd: balance, loaded: true });
  },

  loadOfferings: async () => {
    const [packs, packages] = await Promise.all([apiGetCreditPacks(), getCreditPackages()]);
    // Only offer packages our backend actually knows how to credit —
    // otherwise a purchase could succeed in the store but silently not
    // credit the account.
    const knownProductIds = new Set(packs.map((p: CreditPack) => p.productId));
    const offerings = packages.filter((pkg) => knownProductIds.has(pkg.product.identifier));
    set({ offerings });
  },

  purchase: async (pkg: PurchasesPackage) => {
    set({ purchasingProductId: pkg.product.identifier });
    try {
      await purchasePackage(pkg);
      // Real crediting happens via the RevenueCat webhook, asynchronously
      // relative to this purchase call completing — poll briefly rather than
      // trusting the client-side purchase result to bump the balance.
      const startBalance = get().balanceUsd ?? 0;
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const balance = await apiGetCreditBalance();
        set({ balanceUsd: balance });
        if (balance > startBalance) {
          if (get().paywallVisible) set({ paywallVisible: false });
          break;
        }
      }
    } finally {
      set({ purchasingProductId: null });
    }
  },

  showPaywall: () => set({ paywallVisible: true }),
  hidePaywall: () => set({ paywallVisible: false }),
}));
