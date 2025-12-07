import jwt from 'jsonwebtoken';

/**
 * Generate JWT token for builder API authentication
 * 
 * @param tokenAddress - IAO token address
 * @param builderEndpoint - Builder's API endpoint URL
 * @param secretPhrase - Shared secret phrase for signing
 * @param expiresIn - Token expiration time (default: 5 minutes)
 * @returns JWT token string
 */
export function generateBuilderJWT(
  tokenAddress: string,
  builderEndpoint: string,
  secretPhrase: string,
  expiresIn: string = '5m'
): string {
  const payload = {
    // Issuer: IAO Proxy service
    iss: 'iao-proxy',
    // Audience: Builder endpoint
    aud: builderEndpoint,
    // Token address
    tokenAddress: tokenAddress.toLowerCase(),
    // Issued at timestamp
    iat: Math.floor(Date.now() / 1000),
    // Unique request ID (prevents replay attacks)
    jti: `${tokenAddress.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  };

  // Sign token with secret phrase using HS256 algorithm
  const token = jwt.sign(payload, secretPhrase, {
    algorithm: 'HS256',
    expiresIn,
  });

  return token;
}

/**
 * Verify JWT token (for builder's use)
 * This is a helper function that builders can use to verify tokens
 * 
 * @param token - JWT token string
 * @param secretPhrase - Shared secret phrase
 * @param expectedAudience - Expected audience (builder endpoint URL)
 * @returns Decoded token payload or null if invalid
 */
export function verifyBuilderJWT(
  token: string,
  secretPhrase: string,
  expectedAudience?: string
): jwt.JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secretPhrase, {
      algorithms: ['HS256'],
      issuer: 'iao-proxy',
      ...(expectedAudience && { audience: expectedAudience }),
    }) as jwt.JwtPayload;

    return decoded;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

