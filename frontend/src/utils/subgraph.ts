// Subgraph query utilities for IAO APIs

const IAO_SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cm8plie9y1pjh01yea3kubv4c/subgraphs/IAO/0.0.1/gn";

export interface IAOTokenEntry {
  id: string; // Token address
  apiUrl: string;
  builder: string;
  name: string;
  symbol: string;
  subscriptionFee: string;
  subscriptionTokenAmount: string;
  paymentToken: string;
  subscriptionCount?: string; // Usage count
}

export async function querySubgraph<T>(query: string): Promise<T> {
  const response = await fetch(IAO_SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph query failed: ${response.status}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`Subgraph errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

export async function getAllAPIs(): Promise<IAOTokenEntry[]> {
  const query = `
    {
      iaotokens(first: 100, orderBy: subscriptionCount, orderDirection: desc) {
        id
        apiUrl
        builder
        name
        symbol
        subscriptionFee
        subscriptionTokenAmount
        paymentToken
        subscriptionCount
      }
    }
  `;

  const data = await querySubgraph<{ iaotokens: IAOTokenEntry[] }>(query);
  return data.iaotokens || [];
}

export async function getAPIByAddress(tokenAddress: string): Promise<IAOTokenEntry | null> {
  const addressLower = tokenAddress.toLowerCase();
  const query = `
    {
      iaotoken(id: "${addressLower}") {
        id
        apiUrl
        builder
        name
        symbol
        subscriptionFee
        subscriptionTokenAmount
        paymentToken
        subscriptionCount
      }
    }
  `;

  const data = await querySubgraph<{ iaotoken: IAOTokenEntry | null }>(query);
  return data.iaotoken;
}

export async function getTrendingAPIs(limit: number = 10): Promise<IAOTokenEntry[]> {
  const query = `
    {
      iaotokens(first: ${limit}, orderBy: subscriptionCount, orderDirection: desc) {
        id
        apiUrl
        builder
        name
        symbol
        subscriptionFee
        subscriptionTokenAmount
        paymentToken
        subscriptionCount
      }
    }
  `;

  const data = await querySubgraph<{ iaotokens: IAOTokenEntry[] }>(query);
  return data.iaotokens || [];
}

