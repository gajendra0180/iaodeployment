# Builder API JWT Authentication

The IAO Proxy service authenticates requests to builder endpoints using JWT (JSON Web Tokens) with a shared secret phrase.

## How It Works

1. When a user makes a paid API request through the proxy, the proxy generates a JWT token
2. The token is sent in the `X-IAO-Auth` header to your builder endpoint
3. Your builder endpoint verifies the token using the shared secret phrase

## JWT Token Structure

The JWT token contains the following claims:

- `iss` (issuer): `"iao-proxy"` - Identifies the IAO Proxy service
- `aud` (audience): Your builder endpoint URL
- `tokenAddress`: The IAO token address (lowercase)
- `iat` (issued at): Unix timestamp when token was issued
- `jti` (JWT ID): Unique request identifier (prevents replay attacks)
- `exp` (expiration): Token expires 5 minutes after issuance

## Implementation Examples

### Node.js/Express

```javascript
const jwt = require('jsonwebtoken');

// Middleware to verify JWT
function verifyIAOAuth(req, res, next) {
  const token = req.headers['x-iao-auth'];
  const secretPhrase = process.env.BUILDER_SECRET_PHRASE; // Same secret as proxy

  if (!token) {
    return res.status(401).json({ error: 'Missing X-IAO-Auth header' });
  }

  try {
    const decoded = jwt.verify(token, secretPhrase, {
      algorithms: ['HS256'],
      issuer: 'iao-proxy',
      audience: req.originalUrl, // Or your endpoint URL
    });

    // Attach decoded token to request for use in route handlers
    req.iaoAuth = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ 
      error: 'Invalid or expired token',
      message: error.message 
    });
  }
}

// Use middleware
app.get('/your-endpoint', verifyIAOAuth, (req, res) => {
  // Access token data
  const tokenAddress = req.iaoAuth.tokenAddress;
  // ... your logic
});
```

### Python/Flask

```python
import jwt
from functools import wraps
from flask import request, jsonify

BUILDER_SECRET_PHRASE = os.environ.get('BUILDER_SECRET_PHRASE')

def verify_iao_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('X-IAO-Auth')
        
        if not token:
            return jsonify({'error': 'Missing X-IAO-Auth header'}), 401
        
        try:
            decoded = jwt.decode(
                token,
                BUILDER_SECRET_PHRASE,
                algorithms=['HS256'],
                issuer='iao-proxy',
                audience=request.url
            )
            request.iao_auth = decoded
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError as e:
            return jsonify({'error': 'Invalid token', 'message': str(e)}), 401
        
        return f(*args, **kwargs)
    return decorated_function

@app.route('/your-endpoint')
@verify_iao_auth
def your_endpoint():
    token_address = request.iao_auth['tokenAddress']
    # ... your logic
```

### Go

```go
package main

import (
    "github.com/golang-jwt/jwt/v5"
    "net/http"
)

var builderSecretPhrase = os.Getenv("BUILDER_SECRET_PHRASE")

func verifyIAOAuth(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        tokenString := r.Header.Get("X-IAO-Auth")
        if tokenString == "" {
            http.Error(w, "Missing X-IAO-Auth header", http.StatusUnauthorized)
            return
        }

        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
            }
            return []byte(builderSecretPhrase), nil
        })

        if err != nil || !token.Valid {
            http.Error(w, "Invalid token", http.StatusUnauthorized)
            return
        }

        claims, ok := token.Claims.(jwt.MapClaims)
        if !ok {
            http.Error(w, "Invalid token claims", http.StatusUnauthorized)
            return
        }

        // Verify issuer
        if claims["iss"] != "iao-proxy" {
            http.Error(w, "Invalid issuer", http.StatusUnauthorized)
            return
        }

        // Store claims in context or proceed
        next(w, r)
    }
}
```

## Environment Variable

Set the same secret phrase on both the proxy and your builder server:

```bash
BUILDER_SECRET_PHRASE=your-secret-phrase-here
```

**Important:** 
- Use a strong, random secret phrase (at least 32 characters)
- Share this securely with builders (use secure channels, not email)
- Never commit the secret phrase to version control
- Consider using different secrets for different environments (dev/staging/prod)

## Security Best Practices

1. **Always verify the token** - Don't trust requests without valid JWT
2. **Check expiration** - Tokens expire after 5 minutes
3. **Verify audience** - Ensure the token is meant for your endpoint
4. **Check issuer** - Verify `iss` claim is `"iao-proxy"`
5. **Use HTTPS** - Always use HTTPS in production to protect the token in transit
6. **Rate limiting** - Implement rate limiting on your endpoints
7. **Logging** - Log authentication failures for security monitoring

## Testing

You can test JWT verification using the `jwt.io` debugger or by decoding the token:

```bash
# Decode token (without verification)
echo "YOUR_JWT_TOKEN" | cut -d. -f2 | base64 -d | jq

# Or use jwt-cli
jwt decode YOUR_JWT_TOKEN
```

## Troubleshooting

### Token Expired
- Tokens expire after 5 minutes
- This is intentional to prevent replay attacks
- If you need longer expiration, contact the proxy maintainers

### Invalid Signature
- Ensure you're using the same `BUILDER_SECRET_PHRASE` as the proxy
- Check for typos or extra whitespace in the secret phrase

### Missing Header
- Ensure your server reads the `X-IAO-Auth` header (case-insensitive)
- Some frameworks may normalize headers differently

## Support

If you encounter issues with JWT authentication, check:
1. The token is present in the `X-IAO-Auth` header
2. The secret phrase matches on both sides
3. The token hasn't expired
4. Your server's clock is synchronized (for expiration checks)

