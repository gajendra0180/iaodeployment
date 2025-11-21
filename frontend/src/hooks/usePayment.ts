// Reusable payment hook for x402-fetch integration
import { useState, useEffect } from "react";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

export function usePayment() {
  const [cdpAccount, setCdpAccount] = useState<any>(null);
  const [fetchWithPayment, setFetchWithPayment] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializePaymentWallet = async () => {
      try {
        // @ts-ignore - Vite env variable
        const walletSecret = import.meta.env.VITE_CDP_WALLET_SECRET;

        if (!walletSecret || walletSecret.trim() === '') {
          const errorMsg = "Missing VITE_CDP_WALLET_SECRET environment variable. Please create a .env.local file in the frontend directory with VITE_CDP_WALLET_SECRET=0x...";
          setError(errorMsg);
          setIsInitialized(false);
          console.warn("⚠️ Payment wallet not initialized:", errorMsg);
          return;
        }

        // Validate private key format
        if (!/^0x[a-fA-F0-9]{64}$/i.test(walletSecret.trim())) {
          throw new Error("Invalid private key format. Must be 0x followed by 64 hex characters");
        }

        // Create viem account from private key
        const viemAccount = privateKeyToAccount(walletSecret.trim() as `0x${string}`);
        setCdpAccount(viemAccount);

        // Create payment-enabled fetch function
        const paymentFetch = wrapFetchWithPayment(fetch, viemAccount);
        setFetchWithPayment(() => paymentFetch);

        setIsInitialized(true);
        setError(null);
        console.log("✅ Payment wallet initialized successfully");
      } catch (err: any) {
        const errorMsg = err.message || "Failed to initialize payment wallet";
        setError(errorMsg);
        setIsInitialized(false);
        console.error("❌ Payment wallet initialization error:", err);
      }
    };

    initializePaymentWallet();
  }, []);

  return {
    cdpAccount,
    fetchWithPayment,
    error,
    isInitialized,
  };
}

