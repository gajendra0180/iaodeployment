# Thirdweb x402 Facilitator Setup Guide

This guide explains how to configure the Thirdweb facilitator for payment processing on IAO API endpoints.

## What is the Thirdweb Facilitator?

The Thirdweb facilitator is a service that verifies and processes x402 payments on behalf of your API. When users call `/api/:address`, the facilitator:
1. Verifies the payment proof from the user
2. Settles the payment on-chain
3. Allows your API to proceed with the request

## Step-by-Step Setup

### 1. Get Your Thirdweb Secret Key

1. Go to [Thirdweb Portal](https://portal.thirdweb.com)
2. Sign in or create an account
3. Navigate to **Settings** → **API Keys**
4. Click **Create API Key**
5. Give it a name (e.g., "IAO API Facilitator")
6. Copy the **Secret Key** (starts with something like `sk_...`)

### 2. Get Your Server Wallet Address

You need a wallet address that will receive payments. You have two options:

#### Option A: Use Thirdweb's Managed Wallet
1. In your Thirdweb project dashboard
2. Go to **Wallets** or **Settings**
3. Find your **Server Wallet** address
4. Copy the address

#### Option B: Use Your Own Wallet
- Use any wallet address you control on Base network
- Make sure you have the private key/seed phrase saved securely
- This address will receive all payments from API calls

### 3. Configure Environment Variables

Create a `.env` file in the `iaodeployment` directory (or add to your existing one):

```bash
# Thirdweb x402 Facilitator
THIRDWEB_SECRET_KEY=sk_your_secret_key_here
THIRDWEB_SERVER_WALLET_ADDRESS=0xYourWalletAddressHere
```

**Important:** 
- Never commit your `.env` file to git
- Keep your secret key secure
- The wallet address should be on Base network

### 4. Verify Configuration

After setting the environment variables, restart your server. You should see:

```
✅ Thirdweb facilitator initialized for /api/* endpoints
```

If you see a warning instead, check:
- Environment variables are set correctly
- Secret key is valid (starts with `sk_`)
- Wallet address is a valid Ethereum address (42 characters, starts with `0x`)

## Testing the Setup

1. Start your backend server:
   ```bash
   cd iaodeployment
   yarn dev
   ```

2. Check the console output - you should see:
   ```
   ✅ Thirdweb facilitator initialized for /api/* endpoints
   ```

3. Try calling an API endpoint with payment - it should now verify payments correctly.

## Troubleshooting

### "Thirdweb credentials not found"
- Make sure `.env` file exists in `iaodeployment` directory
- Check that variable names are exactly: `THIRDWEB_SECRET_KEY` and `THIRDWEB_SERVER_WALLET_ADDRESS`
- Restart the server after adding environment variables

### "Failed to initialize Thirdweb facilitator"
- Verify your secret key is correct (copy-paste from portal)
- Check that wallet address is valid (42 characters, starts with `0x`)
- Ensure you're using a Base network wallet address

### Payments not being verified
- Check that the facilitator is initialized (look for ✅ message)
- Verify the payment token (USDC) is configured correctly
- Check that users are sending proper payment proofs in `X-PAYMENT` header

## Additional Resources

- [Thirdweb x402 Documentation](https://portal.thirdweb.com/x402/facilitator)
- [Thirdweb Portal](https://portal.thirdweb.com)
- [x402 Protocol Docs](https://x402.org)

