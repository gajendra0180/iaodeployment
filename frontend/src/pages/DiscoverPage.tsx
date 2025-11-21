import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getAllAPIs, IAOTokenEntry } from "../utils/subgraph";
import { APICard } from "../components/APICard";
import "./DiscoverPage.css";

type SortOption = "trending" | "newest" | "price-low" | "price-high";
type PriceTier = "all" | "starter" | "growth" | "pro";
type ViewMode = "grid" | "list";

const PRICE_TIER_META: Record<Exclude<PriceTier, "all">, { label: string; description: string; min: number; max: number }> = {
  starter: {
    label: "Starter",
    description: "< $0.05",
    min: 0,
    max: 0.05,
  },
  growth: {
    label: "Growth",
    description: "$0.05 - $0.5",
    min: 0.05,
    max: 0.5,
  },
  pro: {
    label: "Pro",
    description: ">$0.5",
    min: 0.5,
    max: Number.POSITIVE_INFINITY,
  },
};

const formatUSDC = (fee: string) => {
  try {
    const feeBig = BigInt(fee);
    return Number(feeBig) / 1e6;
  } catch {
    return 0;
  }
};

const getPriceTier = (price: number): Exclude<PriceTier, "all"> => {
  if (price < PRICE_TIER_META.starter.max) return "starter";
  if (price < PRICE_TIER_META.growth.max) return "growth";
  return "pro";
};

const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const formatCurrencyDisplay = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatTokenReward = (amount: string) => {
  try {
    const tokens = Number(BigInt(amount)) / 1e18;
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return tokens.toFixed(0);
  } catch {
    return "0";
  }
};

export function DiscoverPage() {
  const navigate = useNavigate();
  const [apis, setApis] = useState<IAOTokenEntry[]>([]);
  const [filteredApis, setFilteredApis] = useState<IAOTokenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("trending");
  const [priceFilter, setPriceFilter] = useState<PriceTier>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    loadAPIs();
  }, []);

  useEffect(() => {
    filterAndSortAPIs();
  }, [apis, searchQuery, sortBy, priceFilter]);

  const heroStats = useMemo(() => {
    if (!apis.length) {
      return {
        totalApis: 0,
        totalSubscriptions: 0,
        totalVolume: 0,
        avgPrice: 0,
      };
    }

    const totals = apis.reduce(
      (acc, api) => {
        const subscriptions = Number(api.subscriptionCount || "0");
        const price = formatUSDC(api.subscriptionFee);
        acc.totalSubscriptions += subscriptions;
        acc.totalVolume += subscriptions * price;
        acc.totalPrice += price;
        return acc;
      },
      { totalSubscriptions: 0, totalVolume: 0, totalPrice: 0 }
    );

    return {
      totalApis: apis.length,
      totalSubscriptions: totals.totalSubscriptions,
      totalVolume: totals.totalVolume,
      avgPrice: totals.totalPrice / apis.length,
    };
  }, [apis]);

  const featuredApi = filteredApis[0] || null;
  const remainingApis = featuredApi ? filteredApis.slice(1) : filteredApis;

  const loadAPIs = async () => {
    try {
      setLoading(true);
      const allAPIs = await getAllAPIs();
      setApis(allAPIs);
    } catch (error) {
      console.error("Failed to load APIs:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortAPIs = () => {
    let filtered = [...apis];

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (api) =>
          api.name.toLowerCase().includes(query) ||
          api.symbol.toLowerCase().includes(query) ||
          api.id.toLowerCase().includes(query)
      );
    }

    if (priceFilter !== "all") {
      const tier = PRICE_TIER_META[priceFilter];
      filtered = filtered.filter((api) => {
        const price = formatUSDC(api.subscriptionFee);
        return price >= tier.min && price <= tier.max;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "trending":
          const aCount = parseInt(a.subscriptionCount || "0");
          const bCount = parseInt(b.subscriptionCount || "0");
          return bCount - aCount;
        case "newest":
          // Assuming newer APIs have higher addresses or we track creation time
          return b.id.localeCompare(a.id);
        case "price-low":
          return formatUSDC(a.subscriptionFee) - formatUSDC(b.subscriptionFee);
        case "price-high":
          return formatUSDC(b.subscriptionFee) - formatUSDC(a.subscriptionFee);
        default:
          return 0;
      }
    });

    setFilteredApis(filtered);
  };

  const handleViewDetails = (tokenAddress: string) => {
    navigate(`/api/${tokenAddress}`);
  };

  const handleTryAPI = (tokenAddress: string) => {
    navigate(`/api/${tokenAddress}?try=true`);
  };

  if (loading) {
    return (
      <div className="discover-page">
        <div className="discover-loading">
          <div className="loading-hero shimmer" />
          <div className="loading-stats">
            {[...Array(4)].map((_, idx) => (
              <div key={idx} className="stat-skeleton shimmer" />
            ))}
          </div>
          <div className="loading-grid">
            {[...Array(6)].map((_, idx) => (
              <div key={idx} className="card-skeleton shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="discover-page">
      <section className="discover-hero">
        <div className="hero-content">
          <p className="eyebrow">Initial API Offering · Powered by x402</p>
          <h1>Discover, pay, and earn with the next wave of on-chain APIs.</h1>
          <p className="hero-subtitle">
            Developers list metered endpoints, testers pay via Coinbase CDP, and everyone earns IAO tokens for real usage.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary hero-btn" onClick={() => navigate("/submit")}>
              ➕ List your API
            </button>
            <button
              className="btn btn-secondary hero-btn"
              onClick={() => navigate("/api/0x4966baf06bfc7a9b566662bb52cfa718a2f60ee9")}
            >
              Explore sample API
            </button>
          </div>
        </div>
        <div className="hero-panel">
          <div className="hero-panel-content">
            <p className="panel-label">Live payment flow</p>
            <h3>Pay-per-call secured by facilitator</h3>
            <ul>
              <li>🔐 Wallet-signed USDC authorization</li>
              <li>⚡ Facilitator settles instantly</li>
              <li>🪙 Subgraph mints API tokens on success</li>
            </ul>
            <p className="panel-footnote">No custodial keys. Users sign each transaction.</p>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <div className="stat-card">
          <p className="stat-label">APIs live</p>
          <h3>{heroStats.totalApis}</h3>
          <span className="stat-hint">Listed via token factory</span>
        </div>
        <div className="stat-card">
          <p className="stat-label">Total subscriptions</p>
          <h3>{formatCompactNumber(heroStats.totalSubscriptions)}</h3>
          <span className="stat-hint">Usage tracked on subgraph</span>
        </div>
        <div className="stat-card">
          <p className="stat-label">Cumulative volume</p>
          <h3>{formatCurrencyDisplay(heroStats.totalVolume)}</h3>
          <span className="stat-hint">Settled in USDC via Coinbase CDP</span>
        </div>
        <div className="stat-card">
          <p className="stat-label">Average ticket</p>
          <h3>{formatCurrencyDisplay(heroStats.avgPrice)}</h3>
          <span className="stat-hint">Per API call</span>
        </div>
      </section>

      <section className="discover-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="🔍 Search APIs by name, symbol, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="toolbar-actions">
          <div className="sort-controls">
            <label>Sort by:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="sort-select">
              <option value="trending">🔥 Trending</option>
              <option value="newest">🆕 Newest</option>
              <option value="price-low">💰 Price: Low to High</option>
              <option value="price-high">💰 Price: High to Low</option>
            </select>
          </div>

          <div className="view-toggle">
            <button
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              ⬚
            </button>
            <button
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              aria-label="List view"
            >
              ☰
            </button>
          </div>
        </div>
      </section>

      <div className="price-pills">
        {(["all", "starter", "growth", "pro"] as PriceTier[]).map((tier) => (
          <button
            key={tier}
            className={`pill ${priceFilter === tier ? "active" : ""}`}
            onClick={() => setPriceFilter(tier)}
          >
            {tier === "all"
              ? "All tiers"
              : `${PRICE_TIER_META[tier].label} · ${PRICE_TIER_META[tier].description}`}
          </button>
        ))}
      </div>

      {featuredApi && (
        <section className="featured-section">
          <div className="featured-card">
            <div className="featured-content">
              <p className="eyebrow">Featured API</p>
              <h2>{featuredApi.name}</h2>
              <p className="featured-symbol">{featuredApi.symbol}</p>
              <div className="featured-stats">
                <div>
                  <span>Price</span>
                  <strong>{formatCurrencyDisplay(formatUSDC(featuredApi.subscriptionFee))}</strong>
                </div>
                <div>
                  <span>Tokens earned</span>
                  <strong>
                    {formatTokenReward(featuredApi.subscriptionTokenAmount)} {featuredApi.symbol}
                  </strong>
                </div>
                <div>
                  <span>Usage</span>
                  <strong>{featuredApi.subscriptionCount || "0"}</strong>
                </div>
              </div>
              <div className="featured-actions">
                <button className="btn btn-primary" onClick={() => handleTryAPI(featuredApi.id)}>
                  💳 Pay & Test
                </button>
                <button className="btn ghost" onClick={() => handleViewDetails(featuredApi.id)}>
                  View details
                </button>
              </div>
            </div>
            <div className="featured-meta">
              <p><strong>Builder:</strong> {featuredApi.builder}</p>
              <p><strong>Endpoint:</strong> {featuredApi.apiUrl}</p>
              <p><strong>Token:</strong> {featuredApi.id}</p>
            </div>
          </div>
        </section>
      )}

      {remainingApis.length === 0 ? (
        <div className="empty-state">
          <p>
            {searchQuery || priceFilter !== "all"
              ? "No APIs match your current search & filters."
              : "No APIs available yet."}
          </p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => navigate("/submit")}>
              Be the first to submit!
            </button>
            {(searchQuery || priceFilter !== "all") && (
              <button
                className="btn ghost"
                onClick={() => {
                  setSearchQuery("");
                  setPriceFilter("all");
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className={`api-section ${viewMode === "list" ? "list-mode" : ""}`}>
          <div className={viewMode === "list" ? "api-list" : "api-grid"}>
            {remainingApis.map((api) => (
              <APICard
                key={api.id}
                api={api}
                onViewDetails={handleViewDetails}
                onTryAPI={handleTryAPI}
                variant={viewMode}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

