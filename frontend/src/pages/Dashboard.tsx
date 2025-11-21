import { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getAllAPIs, IAOTokenEntry } from "../utils/subgraph";
import "./Dashboard.css";

export function Dashboard() {
  const account = useActiveAccount();
  const [myAPIs, setMyAPIs] = useState<IAOTokenEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (account) {
      loadMyAPIs();
    }
  }, [account]);

  const loadMyAPIs = async () => {
    try {
      setLoading(true);
      const allAPIs = await getAllAPIs();
      // Filter APIs created by current user (builder address matches)
      if (account) {
        const userAPIs = allAPIs.filter(
          (api) => api.builder.toLowerCase() === account.address.toLowerCase()
        );
        setMyAPIs(userAPIs);
      }
    } catch (error) {
      console.error("Failed to load APIs:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatFee = (fee: string) => {
    const feeNum = BigInt(fee);
    const usdcAmount = Number(feeNum) / 1e6;
    return `$${usdcAmount.toFixed(2)}`;
  };

  if (!account) {
    return (
      <div className="dashboard-page">
        <div className="connect-prompt">
          <h2>👋 Connect Your Wallet</h2>
          <p>Please connect your wallet to view your dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>👤 My Dashboard</h1>
        <p>Manage your APIs and view your activity</p>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-section">
          <h2>📊 My APIs</h2>
          {loading ? (
            <div className="loading-state">Loading your APIs...</div>
          ) : myAPIs.length === 0 ? (
            <div className="empty-state">
              <p>You haven't submitted any APIs yet.</p>
              <a href="/submit" className="btn btn-primary">
                Submit Your First API
              </a>
            </div>
          ) : (
            <div className="api-list">
              {myAPIs.map((api) => (
                <div key={api.id} className="api-item">
                  <div className="api-item-header">
                    <h3>{api.name}</h3>
                    <span className="api-symbol">{api.symbol}</span>
                  </div>
                  <div className="api-item-details">
                    <div className="detail">
                      <span className="detail-label">Token Address:</span>
                      <span className="detail-value">{api.id}</span>
                    </div>
                    <div className="detail">
                      <span className="detail-label">Price:</span>
                      <span className="detail-value">{formatFee(api.subscriptionFee)}</span>
                    </div>
                    <div className="detail">
                      <span className="detail-label">Usage Count:</span>
                      <span className="detail-value">{api.subscriptionCount || "0"}</span>
                    </div>
                    <div className="detail">
                      <span className="detail-label">Endpoint:</span>
                      <span className="detail-value">{api.apiUrl}</span>
                    </div>
                  </div>
                  <div className="api-item-actions">
                    <a href={`/api/${api.id}`} className="btn btn-secondary">
                      View Details
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-section">
          <h2>💰 Wallet Info</h2>
          <div className="wallet-info-card">
            <div className="info-row">
              <span className="info-label">Address:</span>
              <span className="info-value">{account.address}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Network:</span>
              <span className="info-value">Base Mainnet</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

