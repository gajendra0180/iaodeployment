// Wallet-based payment hook using user's connected wallet
import { useState } from "react";
import { useActiveAccount, useActiveWallet } from "thirdweb/react";
import { getContract, prepareContractCall, sendTransaction, waitForReceipt } from "thirdweb";
import { base } from "thirdweb/chains";
import { facilitator } from "@coinbase/x402";
import { thirdwebClient } from "../lib/thirdwebClient";

// USDC on Base mainnet
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// EIP-3009 TransferWithAuthorization ABI
const USDC_ABI = [
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function useWalletPayment() {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Make a payment-protected API call using user's wallet
   * The user will be prompted to sign a transaction
   */
  const makePaymentRequest = async (
    apiUrl: string,
    amount: bigint, // Amount in smallest unit (e.g., wei for USDC with 6 decimals)
    receiverAddress: string
  ): Promise<Response> => {
    if (!account || !wallet) {
      throw new Error("Please connect your wallet first");
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Get USDC contract
      const usdcContract = getContract({
        client: thirdwebClient,
        chain: base,
        address: USDC_ADDRESS,
        abi: USDC_ABI,
      });

      // Generate nonce and validity window
      const nonce = crypto.randomUUID();
      const validAfter = Math.floor(Date.now() / 1000);
      const validBefore = validAfter + 3600; // 1 hour validity

      // Prepare the transferWithAuthorization call
      // Note: This is a simplified version. In production, you'd need to:
      // 1. Generate the EIP-3009 signature off-chain
      // 2. Have user sign the authorization message
      // 3. Submit the signed authorization to the contract
      
      // For now, we'll use a direct transfer approach with user approval
      // The x402 middleware will handle the payment verification
      
      // Make the API request - the x402 middleware will handle payment
      // We need to include payment headers that the middleware expects
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "X-Payment-User": account.address,
          "X-Payment-Amount": amount.toString(),
          "X-Payment-Token": USDC_ADDRESS,
        },
      });

      // If payment is required, the middleware will return a payment request
      if (response.status === 402) {
        const paymentRequest = await response.json();
        
        // User needs to sign and submit payment
        // This would trigger a wallet popup for the user to sign
        throw new Error("Payment required. Please sign the transaction in your wallet.");
      }

      return response;
    } catch (err: any) {
      setError(err.message || "Payment failed");
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    account,
    wallet,
    makePaymentRequest,
    isProcessing,
    error,
    isReady: !!account && !!wallet,
  };
}

