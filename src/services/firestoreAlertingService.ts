/**
 * Firestore Alerting Service (replaces DynamoDB Alerting Service)
 * Handles threshold-based alerting and webhook notifications
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';
import type { Firestore } from '@google-cloud/firestore';

// Firestore client singleton
let firestoreClient: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestoreClient) {
    firestoreClient = getFirestoreClient();
  }
  return firestoreClient;
}

/**
 * Alert types
 */
export type AlertType = 'success_rate' | 'latency' | 'error_spike' | 'builder_down';

/**
 * Alert severity levels
 */
export type AlertSeverity = 'warning' | 'critical';

/**
 * Alert thresholds configuration
 */
export interface AlertThresholds {
  minSuccessRate: number;
  maxLatencyP95Ms: number;
  maxErrorRatePerMin: number;
  minCallsForAlert: number;
  warningSuccessRate: number;
  criticalSuccessRate: number;
  warningLatencyMs: number;
  criticalLatencyMs: number;
}

/**
 * Default alert thresholds
 */
const defaultThresholds: AlertThresholds = {
  minSuccessRate: parseFloat(process.env.ALERT_MIN_SUCCESS_RATE || '0.95'),
  maxLatencyP95Ms: parseInt(process.env.ALERT_MAX_LATENCY_P95_MS || '5000'),
  maxErrorRatePerMin: parseInt(process.env.ALERT_MAX_ERROR_RATE_PER_MIN || '10'),
  minCallsForAlert: parseInt(process.env.ALERT_MIN_CALLS || '10'),
  warningSuccessRate: parseFloat(process.env.ALERT_WARNING_SUCCESS_RATE || '0.95'),
  criticalSuccessRate: parseFloat(process.env.ALERT_CRITICAL_SUCCESS_RATE || '0.80'),
  warningLatencyMs: parseInt(process.env.ALERT_WARNING_LATENCY_MS || '5000'),
  criticalLatencyMs: parseInt(process.env.ALERT_CRITICAL_LATENCY_MS || '10000'),
};

/**
 * Alert entry
 */
export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  tokenAddress: string;
  apiSlug?: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  notifiedAt?: string;
}

/**
 * Webhook configuration for a token
 */
export interface WebhookConfig {
  tokenAddress: string;
  webhookUrl: string;
  events: string[];
  createdAt: string;
  active: boolean;
}

/**
 * Metrics data for checking thresholds
 */
export interface MetricsData {
  successRate: number;
  totalCalls: number;
  failedCalls: number;
  p95Latency: number;
  avgLatency: number;
  errorsPerMinute: number;
}

class AlertingService {
  private thresholds: AlertThresholds;
  private alertsCollection: string;
  private webhooksCollection: string;

  constructor(thresholds: Partial<AlertThresholds> = {}) {
    this.thresholds = { ...defaultThresholds, ...thresholds };
    this.alertsCollection = Collections.ALERTS;
    this.webhooksCollection = Collections.WEBHOOKS;
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(tokenAddress: string, apiSlug: string | undefined, type: AlertType): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = apiSlug || 'server';
    return `${tokenAddress.toLowerCase()}#${slug}#${type}#${timestamp}`;
  }

  /**
   * Get severity based on metric value and thresholds
   */
  private getSeverity(type: AlertType, value: number): AlertSeverity {
    switch (type) {
      case 'success_rate':
        return value < this.thresholds.criticalSuccessRate ? 'critical' : 'warning';
      case 'latency':
        return value > this.thresholds.criticalLatencyMs ? 'critical' : 'warning';
      case 'error_spike':
        return value > this.thresholds.maxErrorRatePerMin * 5 ? 'critical' : 'warning';
      case 'builder_down':
        return 'critical';
      default:
        return 'warning';
    }
  }

  /**
   * Create an alert object
   */
  private createAlert(
    tokenAddress: string,
    apiSlug: string | undefined,
    type: AlertType,
    value: number,
    threshold: number,
    message: string
  ): Alert {
    return {
      id: this.generateAlertId(tokenAddress, apiSlug, type),
      type,
      severity: this.getSeverity(type, value),
      tokenAddress: tokenAddress.toLowerCase(),
      apiSlug,
      message,
      value,
      threshold,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
  }

  /**
   * Check metrics against thresholds and generate alerts
   */
  async checkMetrics(
    tokenAddress: string,
    apiSlug: string | undefined,
    metrics: MetricsData
  ): Promise<Alert[]> {
    const alerts: Alert[] = [];

    if (metrics.totalCalls < this.thresholds.minCallsForAlert) {
      return alerts;
    }

    if (metrics.successRate < this.thresholds.minSuccessRate) {
      alerts.push(
        this.createAlert(
          tokenAddress,
          apiSlug,
          'success_rate',
          metrics.successRate,
          this.thresholds.minSuccessRate,
          `Success rate dropped to ${(metrics.successRate * 100).toFixed(1)}% (threshold: ${(this.thresholds.minSuccessRate * 100).toFixed(0)}%)`
        )
      );
    }

    if (metrics.p95Latency > this.thresholds.maxLatencyP95Ms) {
      alerts.push(
        this.createAlert(
          tokenAddress,
          apiSlug,
          'latency',
          metrics.p95Latency,
          this.thresholds.maxLatencyP95Ms,
          `P95 latency spiked to ${metrics.p95Latency}ms (threshold: ${this.thresholds.maxLatencyP95Ms}ms)`
        )
      );
    }

    if (metrics.errorsPerMinute > this.thresholds.maxErrorRatePerMin) {
      alerts.push(
        this.createAlert(
          tokenAddress,
          apiSlug,
          'error_spike',
          metrics.errorsPerMinute,
          this.thresholds.maxErrorRatePerMin,
          `Error rate spiked to ${metrics.errorsPerMinute.toFixed(1)}/min (threshold: ${this.thresholds.maxErrorRatePerMin}/min)`
        )
      );
    }

    return alerts;
  }

  /**
   * Create a builder down alert
   */
  createBuilderDownAlert(
    tokenAddress: string,
    apiSlug: string | undefined,
    failureCount: number
  ): Alert {
    return this.createAlert(
      tokenAddress,
      apiSlug,
      'builder_down',
      failureCount,
      5,
      `Builder endpoint unreachable after ${failureCount} consecutive failures`
    );
  }

  /**
   * Save alert to Firestore
   */
  async saveAlert(alert: Alert): Promise<void> {
    try {
      await getFirestore()
        .collection(this.alertsCollection)
        .doc(alert.id)
        .set(alert);
      console.log(`🚨 Alert saved: ${alert.type} - ${alert.message}`);
    } catch (error) {
      console.error(`❌ Failed to save alert:`, error);
      throw error;
    }
  }

  /**
   * Get an alert by ID
   */
  async getAlert(alertId: string): Promise<Alert | null> {
    try {
      const doc = await getFirestore()
        .collection(this.alertsCollection)
        .doc(alertId)
        .get();

      if (!doc.exists) {
        return null;
      }
      return doc.data() as Alert;
    } catch (error) {
      console.error(`❌ Failed to get alert:`, error);
      return null;
    }
  }

  /**
   * Check if a similar active alert exists (for deduplication)
   */
  async getActiveAlert(
    tokenAddress: string,
    apiSlug: string | undefined,
    type: AlertType
  ): Promise<Alert | null> {
    try {
      const snapshot = await getFirestore()
        .collection(this.alertsCollection)
        .where('tokenAddress', '==', tokenAddress.toLowerCase())
        .where('type', '==', type)
        .where('resolved', '==', false)
        .get();

      const alerts = snapshot.docs.map(doc => doc.data() as Alert);
      return alerts.find((a) => {
        if (apiSlug) {
          return a.apiSlug === apiSlug;
        }
        return !a.apiSlug;
      }) || null;
    } catch (error) {
      console.error(`❌ Failed to check active alert:`, error);
      return null;
    }
  }

  /**
   * Get all active (unresolved) alerts
   */
  async getActiveAlerts(): Promise<Alert[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.alertsCollection)
        .where('resolved', '==', false)
        .get();

      return snapshot.docs.map(doc => doc.data() as Alert);
    } catch (error) {
      console.error(`❌ Failed to get active alerts:`, error);
      return [];
    }
  }

  /**
   * Get alerts for a specific token
   */
  async getAlertsByToken(tokenAddress: string): Promise<Alert[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.alertsCollection)
        .where('tokenAddress', '==', tokenAddress.toLowerCase())
        .get();

      return snapshot.docs.map(doc => doc.data() as Alert);
    } catch (error) {
      console.error(`❌ Failed to get alerts by token:`, error);
      return [];
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    try {
      await getFirestore()
        .collection(this.alertsCollection)
        .doc(alertId)
        .update({
          resolved: true,
          resolvedAt: new Date().toISOString(),
        });
      console.log(`✅ Alert resolved: ${alertId}`);
    } catch (error) {
      console.error(`❌ Failed to resolve alert:`, error);
      throw error;
    }
  }

  /**
   * Dispatch alert via webhooks
   */
  async dispatchAlert(alert: Alert): Promise<void> {
    await this.saveAlert(alert);

    const webhooks = await this.getWebhooksForToken(alert.tokenAddress);

    await Promise.allSettled(
      webhooks.map((wh) => this.sendWebhook(wh.webhookUrl, alert, wh.events))
    );

    this.logAlert(alert);
  }

  /**
   * Get webhook configurations for a token
   */
  async getWebhooksForToken(tokenAddress: string): Promise<WebhookConfig[]> {
    try {
      const snapshot = await getFirestore()
        .collection(this.webhooksCollection)
        .where('tokenAddress', '==', tokenAddress.toLowerCase())
        .where('active', '==', true)
        .get();

      return snapshot.docs.map(doc => doc.data() as WebhookConfig);
    } catch (error) {
      console.error(`❌ Failed to get webhooks:`, error);
      return [];
    }
  }

  /**
   * Configure a webhook for a token
   */
  async configureWebhook(
    tokenAddress: string,
    webhookUrl: string,
    events: string[] = ['all']
  ): Promise<void> {
    const config: WebhookConfig = {
      tokenAddress: tokenAddress.toLowerCase(),
      webhookUrl,
      events,
      createdAt: new Date().toISOString(),
      active: true,
    };

    try {
      const docId = `${tokenAddress.toLowerCase()}_${Buffer.from(webhookUrl).toString('base64').slice(0, 20)}`;
      await getFirestore()
        .collection(this.webhooksCollection)
        .doc(docId)
        .set(config);
      console.log(`✅ Webhook configured for ${tokenAddress}`);
    } catch (error) {
      console.error(`❌ Failed to configure webhook:`, error);
      throw error;
    }
  }

  /**
   * Remove a webhook configuration
   */
  async removeWebhook(tokenAddress: string, webhookUrl: string): Promise<void> {
    try {
      const docId = `${tokenAddress.toLowerCase()}_${Buffer.from(webhookUrl).toString('base64').slice(0, 20)}`;
      await getFirestore()
        .collection(this.webhooksCollection)
        .doc(docId)
        .delete();
      console.log(`✅ Webhook removed for ${tokenAddress}`);
    } catch (error) {
      console.error(`❌ Failed to remove webhook:`, error);
      throw error;
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    url: string,
    alert: Alert,
    events: string[]
  ): Promise<void> {
    if (!events.includes('all') && !events.includes(alert.type)) {
      return;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'APIX-AlertService/1.0',
        },
        body: JSON.stringify({
          type: 'apix_alert',
          alert: {
            id: alert.id,
            type: alert.type,
            severity: alert.severity,
            tokenAddress: alert.tokenAddress,
            apiSlug: alert.apiSlug,
            message: alert.message,
            value: alert.value,
            threshold: alert.threshold,
            timestamp: alert.timestamp,
          },
        }),
      });

      if (!response.ok) {
        console.warn(`⚠️ Webhook returned ${response.status}: ${url}`);
      } else {
        console.log(`✅ Webhook delivered: ${url}`);
      }
    } catch (error) {
      console.error(`❌ Webhook delivery failed: ${url}`, error);
    }
  }

  /**
   * Log alert to console
   */
  private logAlert(alert: Alert): void {
    const emoji = alert.severity === 'critical' ? '🔴' : '🟡';
    console.log(
      `${emoji} [ALERT] ${alert.severity.toUpperCase()}: ${alert.message} ` +
        `(token: ${alert.tokenAddress}, api: ${alert.apiSlug || 'all'})`
    );
  }

  /**
   * Get current thresholds
   */
  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update thresholds
   */
  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }
}

// Export singleton instance
export const alertingService = new AlertingService();

export default {
  AlertingService,
  alertingService,
};
