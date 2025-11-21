// x402 payment hook using user's connected wallet to sign payment proofs
import { useState } from "react";
import { useActiveAccount, useActiveWallet } from "thirdweb/react";
import { base } from "thirdweb/chains";

// USDC on Base mainnet
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function useX402Payment() {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Make a payment-protected API call
   * Flow: Get 402 -> Sign EIP-3009 authorization -> Facilitator processes payment -> Send authorization in X-PAYMENT header
   */
  const callAPIWithPayment = async (
    apiUrl: string,
    subscriptionFee: bigint,
    receiverAddress: string
  ): Promise<any> => {
    if (!account || !wallet) {
      throw new Error("Please connect your wallet first");
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Step 1: Make initial API request (will return 402 if payment required)
      console.log("Making initial API request...");
      const initialResponse = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Step 2: If payment is required (402 status), handle payment flow
      if (initialResponse.status === 402) {
        console.log("Payment required. Signing authorization for facilitator...");
        
        // Get payment details from 402 response
        const paymentInfo = await initialResponse.json().catch(() => ({}));
        console.log("Payment info from 402 response:", paymentInfo);
        const paymentRequirements = paymentInfo?.accepts?.[0];
        const scheme = paymentRequirements?.scheme ?? "exact";
        const network = paymentRequirements?.network ?? "base";
        const payTo = (paymentRequirements?.payTo ?? receiverAddress) as `0x${string}`;
        const paymentAsset = (paymentRequirements?.asset ?? USDC_ADDRESS) as `0x${string}`;
        const amountValue = paymentRequirements?.maxAmountRequired ?? subscriptionFee.toString();
        const x402Version = paymentInfo?.x402Version ?? 1;

        // Step 3: Generate EIP-3009 authorization parameters
        const validAfter = Math.floor(Date.now() / 1000);
        const validBefore = validAfter + 3600; // 1 hour validity
        // Generate random nonce (bytes32)
        const nonceArray = new Uint8Array(32);
        crypto.getRandomValues(nonceArray);
        const nonceBytes32 = `0x${Array.from(nonceArray).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

        // Step 4: User signs the EIP-3009 authorization (facilitator will use this)
        const domain = {
          name: "USD Coin",
          version: "2",
          chainId: base.id,
          verifyingContract: paymentAsset,
        };

        const types = {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        };

        const message = {
          from: account.address as `0x${string}`,
          to: payTo,
          value: amountValue,
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: nonceBytes32,
        };

        // Request signature from user's wallet
        console.log("Requesting user to sign payment authorization...");
        
        // Get wallet provider
        let provider: any = null;
        
        if (typeof window !== 'undefined' && (window as any).ethereum) {
          provider = (window as any).ethereum;
        } else if (wallet) {
          try {
            if ((wallet as any).getAccount) {
              provider = await (wallet as any).getAccount();
            } else if ((wallet as any).provider) {
              provider = (wallet as any).provider;
            } else if ((wallet as any).getProvider) {
              provider = await (wallet as any).getProvider();
            }
          } catch (err) {
            console.error("Error getting wallet provider:", err);
          }
        }

        if (!provider || typeof provider.request !== 'function') {
          throw new Error("Unable to access wallet provider for signing. Please make sure your wallet is connected.");
        }

        // Sign typed data
        const typedData = {
          domain,
          types,
          primaryType: "TransferWithAuthorization",
          message,
        };
        
        const signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [
            account.address,
            JSON.stringify(typedData),
          ],
        }) as string;

        console.log("Authorization signed. Facilitator will process payment...");

        // Step 5: Create payment proof from the signed authorization (x402 exact/evm format)
        const paymentProof = {
          x402Version,
          scheme,
          network,
          payload: {
            signature,
            authorization: {
              from: account.address,
              to: payTo,
              value: amountValue,
              validAfter: validAfter.toString(),
              validBefore: validBefore.toString(),
              nonce: nonceBytes32,
            },
          },
        };

        // Step 6: Wait a moment for facilitator to process payment, then retry with X-PAYMENT header
        // The facilitator uses the authorization we just signed to process the payment on-chain
        console.log("Waiting for facilitator to process payment...");
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for facilitator

        // Step 7: Retry API call with X-PAYMENT header containing the authorization
        const paymentProofJson = JSON.stringify(paymentProof);
        const paymentProofBase64 = btoa(unescape(encodeURIComponent(paymentProofJson)));
        
        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": paymentProofBase64,
          },
        });

        if (!response.ok) {
          let errorMessage = "Payment verification failed";
          try {
            const errorData = await response.json();
            if (typeof errorData === 'string') {
              errorMessage = errorData;
            } else if (errorData && typeof errorData === 'object') {
              errorMessage = errorData.error || errorData.message || errorData.toString() || JSON.stringify(errorData);
            }
          } catch (e) {
            errorMessage = `Payment verification failed (Status: ${response.status})`;
          }
          throw new Error(errorMessage);
        }

        return await response.json();
      }

      // If no payment required, return the response
      if (!initialResponse.ok) {
        let errorMessage = "API request failed";
        try {
          const errorData = await initialResponse.json();
          if (typeof errorData === 'string') {
            errorMessage = errorData;
          } else if (errorData && typeof errorData === 'object') {
            errorMessage = errorData.error || errorData.message || errorData.toString() || JSON.stringify(errorData);
          }
        } catch (e) {
          errorMessage = `API request failed (Status: ${initialResponse.status})`;
        }
        throw new Error(errorMessage);
      }

      return await initialResponse.json();
    } catch (err: any) {
      let errorMsg = "Failed to process payment";
      if (err) {
        if (typeof err === 'string') {
          errorMsg = err;
        } else if (err.message) {
          errorMsg = err.message;
        } else if (err.error) {
          errorMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
        } else if (typeof err === 'object') {
          errorMsg = JSON.stringify(err);
        } else {
          errorMsg = String(err);
        }
      }
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    account,
    wallet,
    callAPIWithPayment,
    isProcessing,
    error,
    isReady: !!account && !!wallet,
  };
}
