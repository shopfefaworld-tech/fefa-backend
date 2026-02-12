/**
 * Delhivery API configuration and HTTP client
 *
 * This mirrors the structure of the Blue Dart config but is tailored
 * to Delhivery's \"Last Mile\" APIs.
 *
 * NOTE: The exact endpoints and auth scheme can be overridden entirely
 * via environment variables so you can align this with the latest
 * Delhivery documentation.
 */

type AuthType = 'none' | 'token';

export interface DelhiveryConfig {
  apiBaseUrl: string;
  authType: AuthType;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
  trackingUrlTemplate?: string;
  pickupLocationName?: string;
  endpointOverrides: {
    serviceability?: string;
    createShipment?: string;
    generateLabel?: string;
    requestPickup?: string;
    track?: string;
    cancelShipment?: string;
    returnPickup?: string;
    pickupLocations?: string;
  };
}

export interface DelhiveryRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  /**
   * Optional raw string body. When provided, the caller is responsible
   * for setting the appropriate Content-Type header.
   */
  rawBody?: string;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

const parseAuthType = (value?: string): AuthType => {
  if (!value) return 'token';
  const normalized = value.toLowerCase();
  if (normalized === 'token') {
    return 'token';
  }
  return 'none';
};

const sanitizeBaseUrl = (value?: string): string => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

export const getDelhiveryConfig = (): DelhiveryConfig => {
  const timeoutMs = Number(process.env.DELHIVERY_TIMEOUT_MS || 15000);
  const maxRetries = Number(process.env.DELHIVERY_MAX_RETRIES || 1);

  return {
    apiBaseUrl: sanitizeBaseUrl(process.env.DELHIVERY_API_BASE_URL),
    authType: parseAuthType(process.env.DELHIVERY_AUTH_TYPE),
    apiKey: process.env.DELHIVERY_API_KEY,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 1,
    trackingUrlTemplate: process.env.DELHIVERY_TRACKING_URL_TEMPLATE,
    pickupLocationName: process.env.DELHIVERY_PICKUP_LOCATION_NAME,
    endpointOverrides: {
      serviceability: process.env.DELHIVERY_ENDPOINT_SERVICEABILITY,
      createShipment: process.env.DELHIVERY_ENDPOINT_CREATE_SHIPMENT,
      generateLabel: process.env.DELHIVERY_ENDPOINT_GENERATE_LABEL,
      requestPickup: process.env.DELHIVERY_ENDPOINT_REQUEST_PICKUP,
      track: process.env.DELHIVERY_ENDPOINT_TRACK,
      cancelShipment: process.env.DELHIVERY_ENDPOINT_CANCEL_SHIPMENT,
      returnPickup: process.env.DELHIVERY_ENDPOINT_RETURN_PICKUP,
      pickupLocations: process.env.DELHIVERY_ENDPOINT_PICKUP_LOCATIONS,
    },
  };
};

export const isDelhiveryConfigured = (): boolean => {
  const config = getDelhiveryConfig();
  if (!config.apiBaseUrl) {
    return false;
  }

  if (config.authType === 'token') {
    if (!config.apiKey) {
      return false;
    }
    if (!config.pickupLocationName) {
      return false;
    }
  }

  return true;
};

const buildAuthHeaders = (config: DelhiveryConfig): Record<string, string> => {
  // Per Delhivery docs: Authorization: Token <API_TOKEN>
  if (config.authType === 'token' && config.apiKey) {
    return { Authorization: `Token ${config.apiKey}` };
  }

  return {};
};

const buildUrl = (
  baseUrl: string,
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): string => {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${baseUrl}${normalizedEndpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
};

const parseResponse = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export const delhiveryRequest = async <T = any>(
  endpoint: string,
  options: DelhiveryRequestOptions = {}
): Promise<T> => {
  const config = getDelhiveryConfig();
  if (!config.apiBaseUrl) {
    throw new Error('Delhivery API base URL is not configured');
  }

  const method = options.method || 'GET';
  const requestHeaders: Record<string, string> = {
    ...(options.rawBody ? {} : { 'Content-Type': 'application/json' }),
    ...buildAuthHeaders(config),
    ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    ...(options.headers || {}),
  };

  const url = buildUrl(config.apiBaseUrl, endpoint, options.params);

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= config.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
        signal: controller.signal,
      });

      const data = await parseResponse(response);
      clearTimeout(timeout);

      if (!response.ok) {
        const message = data?.message || data?.error || response.statusText;
        throw new Error(`Delhivery API error: ${response.status} - ${message}`);
      }

      return data as T;
    } catch (error: any) {
      clearTimeout(timeout);
      lastError = error;
      const isLastAttempt = attempt > config.maxRetries;
      if (isLastAttempt) {
        break;
      }
    }
  }

  throw lastError || new Error('Delhivery request failed');
};

export const DELHIVERY_DEFAULT_ENDPOINTS = {
  SERVICEABILITY: '/serviceability',
  CREATE_SHIPMENT: '/api/cmu/create.json',
  GENERATE_LABEL: '/shipments/label',
  REQUEST_PICKUP: '/pickups',
  TRACK: '/tracking',
  CANCEL_SHIPMENT: '/shipments/cancel',
  RETURN_PICKUP: '/returns/pickup',
  PICKUP_LOCATIONS: '/pickups/locations',
};

export const getDelhiveryEndpoint = (key: keyof typeof DELHIVERY_DEFAULT_ENDPOINTS): string => {
  const config = getDelhiveryConfig();
  const overrideMap: Record<keyof typeof DELHIVERY_DEFAULT_ENDPOINTS, string | undefined> = {
    SERVICEABILITY: config.endpointOverrides.serviceability,
    CREATE_SHIPMENT: config.endpointOverrides.createShipment,
    GENERATE_LABEL: config.endpointOverrides.generateLabel,
    REQUEST_PICKUP: config.endpointOverrides.requestPickup,
    TRACK: config.endpointOverrides.track,
    CANCEL_SHIPMENT: config.endpointOverrides.cancelShipment,
    RETURN_PICKUP: config.endpointOverrides.returnPickup,
    PICKUP_LOCATIONS: config.endpointOverrides.pickupLocations,
  };

  return overrideMap[key] || DELHIVERY_DEFAULT_ENDPOINTS[key];
};

