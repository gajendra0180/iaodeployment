# Frontend Setup Instructions

## 1. Install Dependencies

```bash
cd frontend
npm install
```

## 2. Create Environment File (Optional)

Create a `.env.local` file in the `frontend` directory if you need to customize the API URL:

```bash
cd frontend
cat > .env.local << 'ENVEOF'
# API Base URL (backend server)
# Default: http://localhost:3000
VITE_API_BASE_URL=http://localhost:3000
ENVEOF
```

**Note:** No private key needed! Users will sign payment transactions directly with their connected wallets.

## 3. Run Development Server

```bash
# Terminal 1: Start backend
cd ..
npm run dev

# Terminal 2: Start frontend dev server
cd frontend
npm run dev
```

Frontend will be available at http://localhost:5173

## 4. Build for Production

```bash
cd frontend
npm run build
```

This builds the frontend to `../public` directory, which the Express server will serve.

## Troubleshooting

### Payment Flow

When users click "Pay & Test API":
1. They'll be prompted to connect their wallet (if not already connected)
2. A wallet popup will appear asking them to sign a USDC transfer transaction
3. After signing and transaction confirmation, the API call will be made
4. The x402 middleware verifies the on-chain payment automatically

### Security

✅ **Secure by design:** Users sign transactions directly with their wallets. No private keys are stored or exposed.
