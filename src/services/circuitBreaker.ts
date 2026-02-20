/**
 * Circuit Breaker Service for Builder Endpoints
 *
 * Prevents cascading failures when builder endpoints are unavailable.
 * Implements the circuit breaker pattern with three states:
 *
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail fast without calling builder
 * - HALF_OPEN: Testing state, allows one request through to test recovery
 *
 * State transitions:
 * - CLOSED → OPEN: After consecutiveFailureThreshold failures
 * - OPEN → HALF_OPEN: After openTimeoutMs passes
 * - HALF_OPEN → CLOSED: On successful request
 * - HALF_OPEN → OPEN: On failed request
 */

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number;
  lastSuccess: number;
  lastStateChange: number;
}

interface CircuitBreakerConfig {
  // Number of consecutive failures before opening circuit
  consecutiveFailureThreshold: number;
  // Time in ms to wait before transitioning from OPEN to HALF_OPEN
  openTimeoutMs: number;
  // Number of consecutive successes needed to close circuit from HALF_OPEN
  successThresholdInHalfOpen: number;
}

// Default configuration
const defaultConfig: CircuitBreakerConfig = {
  consecutiveFailureThreshold: parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5'),
  openTimeoutMs: parseInt(process.env.CIRCUIT_OPEN_TIMEOUT_MS || '30000'), // 30 seconds
  successThresholdInHalfOpen: parseInt(process.env.CIRCUIT_SUCCESS_THRESHOLD || '1'),
};

// In-memory storage of circuit breakers (one per builder URL)
const circuits = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a builder URL
 */
function getCircuit(builderUrl: string): CircuitBreaker {
  let circuit = circuits.get(builderUrl);
  if (!circuit) {
    circuit = {
      state: CircuitState.CLOSED,
      failures: 0,
      successes: 0,
      lastFailure: 0,
      lastSuccess: 0,
      lastStateChange: Date.now(),
    };
    circuits.set(builderUrl, circuit);
  }
  return circuit;
}

/**
 * Normalize builder URL for consistent keying
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Use host + pathname as key (ignore query params)
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Check if a request to the builder should be allowed
 * Returns true if the circuit allows the request, false if it should fail fast
 */
export function canCallBuilder(
  builderUrl: string,
  config: Partial<CircuitBreakerConfig> = {}
): boolean {
  const mergedConfig = { ...defaultConfig, ...config };
  const normalizedUrl = normalizeUrl(builderUrl);
  const circuit = getCircuit(normalizedUrl);
  const now = Date.now();

  switch (circuit.state) {
    case CircuitState.CLOSED:
      // Circuit is closed, allow request
      return true;

    case CircuitState.OPEN:
      // Check if timeout has passed to transition to HALF_OPEN
      if (now - circuit.lastFailure > mergedConfig.openTimeoutMs) {
        console.log(`🔄 Circuit breaker for ${normalizedUrl}: OPEN → HALF_OPEN (timeout passed)`);
        circuit.state = CircuitState.HALF_OPEN;
        circuit.successes = 0;
        circuit.lastStateChange = now;
        return true;
      }
      // Circuit is still open, fail fast
      console.log(`🚫 Circuit breaker OPEN for ${normalizedUrl} - failing fast`);
      return false;

    case CircuitState.HALF_OPEN:
      // Allow one request through to test recovery
      return true;

    default:
      return true;
  }
}

/**
 * Record the result of a builder call
 * Updates circuit state based on success/failure
 */
export function recordBuilderResult(
  builderUrl: string,
  success: boolean,
  config: Partial<CircuitBreakerConfig> = {}
): void {
  const mergedConfig = { ...defaultConfig, ...config };
  const normalizedUrl = normalizeUrl(builderUrl);
  const circuit = getCircuit(normalizedUrl);
  const now = Date.now();

  if (success) {
    circuit.lastSuccess = now;
    circuit.successes++;
    circuit.failures = 0; // Reset consecutive failures

    if (circuit.state === CircuitState.HALF_OPEN) {
      if (circuit.successes >= mergedConfig.successThresholdInHalfOpen) {
        console.log(`✅ Circuit breaker for ${normalizedUrl}: HALF_OPEN → CLOSED (recovered)`);
        circuit.state = CircuitState.CLOSED;
        circuit.lastStateChange = now;
      }
    }
  } else {
    circuit.lastFailure = now;
    circuit.failures++;
    circuit.successes = 0; // Reset consecutive successes

    if (circuit.state === CircuitState.CLOSED) {
      if (circuit.failures >= mergedConfig.consecutiveFailureThreshold) {
        console.log(`⚠️ Circuit breaker for ${normalizedUrl}: CLOSED → OPEN (${circuit.failures} failures)`);
        circuit.state = CircuitState.OPEN;
        circuit.lastStateChange = now;
      }
    } else if (circuit.state === CircuitState.HALF_OPEN) {
      console.log(`❌ Circuit breaker for ${normalizedUrl}: HALF_OPEN → OPEN (test failed)`);
      circuit.state = CircuitState.OPEN;
      circuit.lastStateChange = now;
    }
  }
}

/**
 * Get the current state of a circuit breaker
 */
export function getCircuitState(builderUrl: string): CircuitBreaker | undefined {
  const normalizedUrl = normalizeUrl(builderUrl);
  return circuits.get(normalizedUrl);
}

/**
 * Get all circuit breakers and their states
 */
export function getAllCircuits(): Map<string, CircuitBreaker> {
  return new Map(circuits);
}

/**
 * Reset a circuit breaker to CLOSED state
 * Useful for manual recovery or testing
 */
export function resetCircuit(builderUrl: string): void {
  const normalizedUrl = normalizeUrl(builderUrl);
  const circuit = getCircuit(normalizedUrl);
  circuit.state = CircuitState.CLOSED;
  circuit.failures = 0;
  circuit.successes = 0;
  circuit.lastStateChange = Date.now();
  console.log(`🔄 Circuit breaker for ${normalizedUrl} manually reset to CLOSED`);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuits(): void {
  circuits.clear();
  console.log('🔄 All circuit breakers reset');
}

/**
 * Get circuit breaker statistics
 */
export function getCircuitStats(): {
  total: number;
  open: number;
  halfOpen: number;
  closed: number;
} {
  let open = 0;
  let halfOpen = 0;
  let closed = 0;

  circuits.forEach((circuit) => {
    switch (circuit.state) {
      case CircuitState.OPEN:
        open++;
        break;
      case CircuitState.HALF_OPEN:
        halfOpen++;
        break;
      case CircuitState.CLOSED:
        closed++;
        break;
    }
  });

  return {
    total: circuits.size,
    open,
    halfOpen,
    closed,
  };
}

/**
 * Wrapper function to execute a call with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  builderUrl: string,
  fn: () => Promise<T>,
  config: Partial<CircuitBreakerConfig> = {}
): Promise<T> {
  if (!canCallBuilder(builderUrl, config)) {
    throw new CircuitBreakerOpenError(builderUrl);
  }

  try {
    const result = await fn();
    recordBuilderResult(builderUrl, true, config);
    return result;
  } catch (error) {
    recordBuilderResult(builderUrl, false, config);
    throw error;
  }
}

/**
 * Custom error for when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  public readonly builderUrl: string;
  public readonly circuitState: CircuitState;

  constructor(builderUrl: string) {
    super(`Circuit breaker is open for: ${builderUrl}`);
    this.name = 'CircuitBreakerOpenError';
    this.builderUrl = builderUrl;
    this.circuitState = CircuitState.OPEN;
  }
}

export default {
  canCallBuilder,
  recordBuilderResult,
  getCircuitState,
  getAllCircuits,
  resetCircuit,
  resetAllCircuits,
  getCircuitStats,
  withCircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
};
