import { IAOTokenEntry } from "../utils/subgraph";
import "./APICard.css";

interface APICardProps {
  api: IAOTokenEntry;
  onViewDetails: (tokenAddress: string) => void;
  onTryAPI: (tokenAddress: string) => void;
  variant?: "grid" | "list";
}

const formatFee = (fee: string) => {
  try {
    const feeNum = BigInt(fee);
    const usdcAmount = Number(feeNum) / 1e6;
    return {
      label: `$${usdcAmount.toFixed(2)}`,
      value: usdcAmount,
    };
  } catch {
    return { label: "$0.00", value: 0 };
  }
};

const formatTokenAmount = (amount: string) => {
  const amountNum = Number(BigInt(amount)) / 1e18;
  if (amountNum >= 1_000_000) {
    return `${(amountNum / 1_000_000).toFixed(1)}M`;
  }
  if (amountNum >= 1_000) {
    return `${(amountNum / 1_000).toFixed(1)}K`;
  }
  return amountNum.toFixed(0);
};

const tierLabels = (price: number) => {
  if (price < 0.05) return { label: "Starter", className: "starter" };
  if (price < 0.5) return { label: "Growth", className: "growth" };
  return { label: "Pro", className: "pro" };
};

export function APICard({ api, onViewDetails, onTryAPI, variant = "grid" }: APICardProps) {
  const fee = formatFee(api.subscriptionFee);
  const usageCount = api.subscriptionCount ? parseInt(api.subscriptionCount) : 0;
  const isTrending = usageCount > 10;
  const tier = tierLabels(fee.value);
  const builderShort = `${api.builder.slice(0, 6)}...${api.builder.slice(-4)}`;

  return (
    <div className={`api-card ${isTrending ? "trending" : ""} ${variant}`}>
      {isTrending && <div className="trending-badge">🔥 Trending</div>}
      <div className="api-card-header">
        <div>
          <div className="api-meta">
            <span className={`tier-pill ${tier.className}`}>{tier.label}</span>
            <span className="builder-pill">by {builderShort}</span>
          </div>
          <h3>{api.name}</h3>
        </div>
        <span className="api-symbol">{api.symbol}</span>
      </div>
      <div className="api-card-body">
        <div className="api-stats">
          <div className="stat">
            <span className="stat-label">Price</span>
            <span className="stat-value">{fee.label}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Tokens</span>
            <span className="stat-value">🪙 {formatTokenAmount(api.subscriptionTokenAmount)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Usage</span>
            <span className="stat-value">{usageCount}</span>
          </div>
        </div>
        <div className="api-address">
          <small>{api.id.slice(0, 6)}...{api.id.slice(-4)}</small>
        </div>
      </div>
      <div className="api-card-actions">
        <button className="btn btn-secondary" onClick={() => onViewDetails(api.id)}>
          View Details
        </button>
        <button className="btn btn-primary" onClick={() => onTryAPI(api.id)}>
          Try API
        </button>
      </div>
    </div>
  );
}

