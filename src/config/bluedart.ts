/**
 * Blue Dart API configuration and HTTP client
 */

type AuthType = 'none' | 'basic' | 'bearer' | 'apikey';

export interface BlueDartConfig {
  apiBaseUrl: string;
  authType: AuthType;
  apiKey?: string;
  apiSecret?: string;
  username?: string;
  password?: string;
  accountCode?: string;
  customerCode?: string;
  timeoutMs: number;
  maxRetries: number;
  trackingUrlTemplate?: string;
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

export interface BlueDartRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

const parseAuthType = (value?: string): AuthType => {
  if (!value) return 'none';
  const normalized = value.toLowerCase();
  if (normalized === 'basic' || normalized === 'bearer' || normalized === 'apikey') {
    return normalized;
  }
  return 'none';
};

const sanitizeBaseUrl = (value?: string): string => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

export const getBlueDartConfig = (): BlueDartConfig => {
  const timeoutMs = Number(process.env.BLUEDART_TIMEOUT_MS || 15000);
  const maxRetries = Number(process.env.BLUEDART_MAX_RETRIES || 1);

  return {
    apiBaseUrl: sanitizeBaseUrl(process.env.BLUEDART_API_BASE_URL),
    authType: parseAuthType(process.env.BLUEDART_AUTH_TYPE),
    apiKey: process.env.BLUEDART_API_KEY,
    apiSecret: process.env.BLUEDART_API_SECRET,
    username: process.env.BLUEDART_USERNAME,
    password: process.env.BLUEDART_PASSWORD,
    accountCode: process.env.BLUEDART_ACCOUNT_CODE,
    customerCode: process.env.BLUEDART_CUSTOMER_CODE,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 1,
    trackingUrlTemplate: process.env.BLUEDART_TRACKING_URL_TEMPLATE,
    endpointOverrides: {
      serviceability: process.env.BLUEDART_ENDPOINT_SERVICEABILITY,
      createShipment: process.env.BLUEDART_ENDPOINT_CREATE_SHIPMENT,
      generateLabel: process.env.BLUEDART_ENDPOINT_GENERATE_LABEL,
      requestPickup: process.env.BLUEDART_ENDPOINT_REQUEST_PICKUP,
      track: process.env.BLUEDART_ENDPOINT_TRACK,
      cancelShipment: process.env.BLUEDART_ENDPOINT_CANCEL_SHIPMENT,
      returnPickup: process.env.BLUEDART_ENDPOINT_RETURN_PICKUP,
      pickupLocations: process.env.BLUEDART_ENDPOINT_PICKUP_LOCATIONS,
    },
  };
};

export const isBlueDartConfigured = (): boolean => {
  const config = getBlueDartConfig();
  if (!config.apiBaseUrl) {
    return false;
  }

  if (config.authType === 'basic') {
    return !!(config.username && config.password);
  }

  if (config.authType === 'bearer' || config.authType === 'apikey') {
    return !!config.apiKey;
  }

  return true;
};

const buildAuthHeaders = (config: BlueDartConfig): Record<string, string> => {
  if (config.authType === 'basic' && config.username && config.password) {
    const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  if (config.authType === 'bearer' && config.apiKey) {
    return { Authorization: `Bearer ${config.apiKey}` };
  }

  if (config.authType === 'apikey' && config.apiKey) {
    return {
      'x-api-key': config.apiKey,
      ...(config.apiSecret ? { 'x-api-secret': config.apiSecret } : {}),
    };
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

export const bluedartRequest = async <T = any>(
  endpoint: string,
  options: BlueDartRequestOptions = {}
): Promise<T> => {
  const config = getBlueDartConfig();
  if (!config.apiBaseUrl) {
    throw new Error('Blue Dart API base URL is not configured');
  }

  const method = options.method || 'GET';
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config),
    ...(config.accountCode ? { 'x-account-code': config.accountCode } : {}),
    ...(config.customerCode ? { 'x-customer-code': config.customerCode } : {}),
    ...(options.idempotencyKey ? { 'x-idempotency-key': options.idempotencyKey } : {}),
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
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const data = await parseResponse(response);
      clearTimeout(timeout);

      if (!response.ok) {
        const message = data?.message || data?.error || response.statusText;
        throw new Error(`Blue Dart API error: ${response.status} - ${message}`);
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

  throw lastError || new Error('Blue Dart request failed');
};

export const BLUEDART_DEFAULT_ENDPOINTS = {
  SERVICEABILITY: '/serviceability',
  CREATE_SHIPMENT: '/shipments',
  GENERATE_LABEL: '/shipments/label',
  REQUEST_PICKUP: '/pickups',
  TRACK: '/tracking',
  CANCEL_SHIPMENT: '/shipments/cancel',
  RETURN_PICKUP: '/returns/pickup',
  PICKUP_LOCATIONS: '/pickups/locations',
};

export const getBlueDartEndpoint = (key: keyof typeof BLUEDART_DEFAULT_ENDPOINTS): string => {
  const config = getBlueDartConfig();
  const overrideMap: Record<keyof typeof BLUEDART_DEFAULT_ENDPOINTS, string | undefined> = {
    SERVICEABILITY: config.endpointOverrides.serviceability,
    CREATE_SHIPMENT: config.endpointOverrides.createShipment,
    GENERATE_LABEL: config.endpointOverrides.generateLabel,
    REQUEST_PICKUP: config.endpointOverrides.requestPickup,
    TRACK: config.endpointOverrides.track,
    CANCEL_SHIPMENT: config.endpointOverrides.cancelShipment,
    RETURN_PICKUP: config.endpointOverrides.returnPickup,
    PICKUP_LOCATIONS: config.endpointOverrides.pickupLocations,
  };

  return overrideMap[key] || BLUEDART_DEFAULT_ENDPOINTS[key];
};
