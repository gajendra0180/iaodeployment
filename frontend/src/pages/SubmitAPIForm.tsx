import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAccount, useActiveWalletChain, useSendTransaction } from "thirdweb/react";
import { getContract, prepareContractCall } from "thirdweb";
import { base } from "thirdweb/chains";
import { parseUnits } from "viem";
import { TOKEN_FACTORY_ADDRESS, TOKEN_FACTORY_ABI } from "../contracts/tokenFactory";
import { thirdwebClient } from "../lib/thirdwebClient";
import "./SubmitAPIForm.css";

// USDC on Base mainnet
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function SubmitAPIForm() {
  const navigate = useNavigate();
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const { mutate: sendTransaction, isPending: isTransactionPending } = useSendTransaction();

  const [formData, setFormData] = useState({
    name: "",
    symbol: "",
    apiUrl: "",
    subscriptionFee: "",
    subscriptionTokenAmount: "",
    description: "",
  });

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError("API name is required");
      return false;
    }
    if (!formData.symbol.trim()) {
      setError("API symbol is required");
      return false;
    }
    if (!formData.apiUrl.trim()) {
      setError("API endpoint URL is required");
      return false;
    }
    try {
      new URL(formData.apiUrl);
    } catch {
      setError("Invalid API endpoint URL");
      return false;
    }
    if (!formData.subscriptionFee || parseFloat(formData.subscriptionFee) <= 0) {
      setError("Subscription fee must be greater than 0");
      return false;
    }
    if (!formData.subscriptionTokenAmount || parseFloat(formData.subscriptionTokenAmount) <= 0) {
      setError("Token amount per subscription must be greater than 0");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!account) {
      setError("Please connect your wallet first");
      return;
    }

    if (!validateForm()) {
      return;
    }

    if (!chain || chain.id !== base.id) {
      setError("Please switch your wallet to Base mainnet before submitting.");
      return;
    }

    try {
      setError(null);
      setSuccess(false);

      // Convert subscription fee to smallest unit (USDC has 6 decimals)
      const subscriptionFeeWei = parseUnits(formData.subscriptionFee, 6);
      
      // Convert token amount to smallest unit (assuming 18 decimals for API tokens)
      const tokenAmountWei = parseUnits(formData.subscriptionTokenAmount, 18);

      const tokenFactoryContract = getContract({
        client: thirdwebClient,
        chain: base,
        address: TOKEN_FACTORY_ADDRESS,
        abi: TOKEN_FACTORY_ABI,
      });

      // Prepare contract call with tuple parameter
      // The function expects a single tuple parameter with all fields
      const transaction = prepareContractCall({
        contract: tokenFactoryContract,
        method: "createToken",
        params: [
          {
            name: formData.name,
            symbol: formData.symbol,
            apiURL: formData.apiUrl,
            builder: account.address, // Builder is the user submitting the API
            paymentToken: USDC_ADDRESS,
            subscriptionFee: subscriptionFeeWei,
            subscriptionTokenAmount: tokenAmountWei,
          },
        ],
      });

      // Send transaction
      sendTransaction(transaction, {
        onSuccess: (result) => {
          setTxHash(result.transactionHash);
          setSuccess(true);
          // Wait a bit then redirect to discover page
          setTimeout(() => {
            navigate("/");
          }, 3000);
        },
        onError: (err: any) => {
          setError(err.message || "Transaction failed");
        },
      });
    } catch (err: any) {
      setError(err.message || "Failed to submit API");
      console.error("Submit error:", err);
    }
  };

  if (!account) {
    return (
      <div className="submit-page">
        <div className="connect-prompt">
          <h2>👋 Connect Your Wallet</h2>
          <p>Please connect your wallet to submit an API</p>
        </div>
      </div>
    );
  }

  return (
    <div className="submit-page">
      <div className="submit-header">
        <h1>➕ Submit Your API</h1>
        <p>Create your API token and list it on the IAO Launchpad</p>
        <div className="network-warning">
          ⚠️ Requires Base mainnet. Switch networks in your wallet before submitting.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="submit-form">
        <div className="form-section">
          <h3>Basic Information</h3>
          <div className="form-group">
            <label htmlFor="name">API Name *</label>
            <input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="My Awesome API"
              required
              className="input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="symbol">API Symbol *</label>
            <input
              id="symbol"
              name="symbol"
              type="text"
              value={formData.symbol}
              onChange={handleInputChange}
              placeholder="MYAPI"
              required
              maxLength={10}
              className="input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="apiUrl">API Endpoint URL *</label>
            <input
              id="apiUrl"
              name="apiUrl"
              type="url"
              value={formData.apiUrl}
              onChange={handleInputChange}
              placeholder="https://api.example.com/endpoint"
              required
              className="input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description (optional)</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Describe what your API does..."
              rows={4}
              className="input textarea"
            />
          </div>
        </div>

        <div className="form-section">
          <h3>Pricing & Rewards</h3>
          <div className="form-group">
            <label htmlFor="subscriptionFee">Subscription Fee (USDC) *</label>
            <input
              id="subscriptionFee"
              name="subscriptionFee"
              type="number"
              step="0.01"
              min="0.01"
              value={formData.subscriptionFee}
              onChange={handleInputChange}
              placeholder="0.01"
              required
              className="input"
            />
            <small>Amount users pay per API call (in USDC)</small>
          </div>

          <div className="form-group">
            <label htmlFor="subscriptionTokenAmount">Tokens Per Subscription *</label>
            <input
              id="subscriptionTokenAmount"
              name="subscriptionTokenAmount"
              type="number"
              step="1"
              min="1"
              value={formData.subscriptionTokenAmount}
              onChange={handleInputChange}
              placeholder="1000"
              required
              className="input"
            />
            <small>Number of API tokens users earn per subscription</small>
          </div>
        </div>

        {error && (
          <div className="error-box">
            <strong>❌ Error:</strong> {error}
          </div>
        )}

        {success && (
          <div className="success-box">
            <strong>✅ Success!</strong> Your API has been submitted.
            {txHash && (
              <p>
                Transaction:{" "}
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {txHash.slice(0, 10)}...{txHash.slice(-8)}
                </a>
              </p>
            )}
            <p>Redirecting to launchpad...</p>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-large"
          disabled={isTransactionPending || success}
        >
          {isTransactionPending
            ? "Submitting Transaction..."
            : success
            ? "Submitted!"
            : "🚀 Submit API"}
        </button>

        <div className="form-info">
          <p>
            <strong>Note:</strong> Submitting an API will create a new token contract and register it
            on the IAO Launchpad. This requires a transaction on Base mainnet.
          </p>
          <p>
            <strong>Payment Token:</strong> USDC on Base ({USDC_ADDRESS})
          </p>
        </div>
      </form>
    </div>
  );
}

