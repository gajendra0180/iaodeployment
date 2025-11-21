# IAO Launchpad Frontend Setup

## Quick Start

1. **Install frontend dependencies:**
   ```bash
   cd frontend
   npm install
   ```

2. **Set up environment variables (optional):**
   ```bash
   cp .env.example .env.local
   ```
   
   Then edit `.env.local` if needed:
   - `VITE_API_BASE_URL` - Backend API URL (default: http://localhost:3000)
   
   **Note:** No private key needed! Users sign payment transactions directly with their wallets.

3. **Development mode:**
   ```bash
   # Terminal 1: Start backend
   cd ..
   npm run dev
   
   # Terminal 2: Start frontend dev server
   cd frontend
   npm run dev
   ```
   
   Frontend will run on http://localhost:5173

4. **Production build:**
   ```bash
   cd frontend
   npm run build
   ```
   
   This builds the frontend to `../public` directory, which the Express server will serve.

## Environment Variables

- `VITE_API_BASE_URL` - Backend API base URL (default: http://localhost:3000)

## Payment Flow

When users make API calls:
1. They connect their wallet using the Connect Wallet button
2. Click "Pay & Test API" - a wallet popup appears
3. User signs the USDC transfer transaction in their wallet
4. After transaction confirmation, the API call is made
5. The x402 middleware automatically verifies the on-chain payment

## Security

✅ **Secure by design**: Users sign transactions directly with their wallets. No private keys are stored or exposed in the frontend.

