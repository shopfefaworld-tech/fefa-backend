/**
 * Shiprocket API Configuration
 * 
 * Shiprocket is a shipping aggregator that provides access to multiple courier services.
 * This configuration handles authentication and provides the base API client.
 * 
 * Required Environment Variables:
 * - SHIPROCKET_EMAIL: Your Shiprocket account email
 * - SHIPROCKET_PASSWORD: Your Shiprocket account password
 * 
 * API Documentation: https://apidocs.shiprocket.in/
 */

const SHIPROCKET_API_BASE = 'https://apiv2.shiprocket.in/v1/external';

// Token cache with expiry
interface TokenCache {
  token: string;
  expiresAt: number; // Unix timestamp
}

let tokenCache: TokenCache | null = null;

/**
 * Get Shiprocket API credentials from environment
 */
const getCredentials = () => {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Shiprocket credentials not configured. Please set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in environment variables.'
    );
  }

  return { email, password };
};

/**
 * Authenticate with Shiprocket and get access token
 * Token is valid for 10 days, but we refresh after 9 days to be safe
 */
export const authenticateShiprocket = async (): Promise<string> => {
  // Check if we have a valid cached token
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const { email, password } = getCredentials();

  try {
    const response = await fetch(`${SHIPROCKET_API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData: any = await response.json().catch(() => ({} as any));
      throw new Error(
        `Shiprocket authentication failed: ${response.status} - ${errorData.message || response.statusText}`
      );
    }

    const data: any = await response.json();

    if (!data.token) {
      throw new Error('Shiprocket authentication response missing token');
    }

    // Cache the token with 9 day expiry (token valid for 10 days)
    tokenCache = {
      token: data.token,
      expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000, // 9 days in ms
    };

    console.log('[Shiprocket] Authentication successful, token cached');
    return data.token;
  } catch (error: any) {
    console.error('[Shiprocket] Authentication error:', error.message);
    throw error;
  }
};

/**
 * Clear cached token (useful for forcing re-authentication)
 */
export const clearShiprocketToken = () => {
  tokenCache = null;
  console.log('[Shiprocket] Token cache cleared');
};

/**
 * Make authenticated request to Shiprocket API
 */
export const shiprocketRequest = async <T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    params?: Record<string, string | number>;
  } = {}
): Promise<T> => {
  const { method = 'GET', body, params } = options;

  // Get or refresh token
  const token = await authenticateShiprocket();

  // Build URL with query params
  let url = `${SHIPROCKET_API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data: any = await response.json().catch(() => ({} as any));

    // Handle authentication errors - clear cache and retry once
    if (response.status === 401) {
      console.log('[Shiprocket] Token expired, refreshing...');
      clearShiprocketToken();
      
      // Retry with fresh token
      const newToken = await authenticateShiprocket();
      const retryResponse = await fetch(url, {
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${newToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const retryData: any = await retryResponse.json().catch(() => ({} as any));

      if (!retryResponse.ok) {
        throw new Error(
          `Shiprocket API error: ${retryResponse.status} - ${retryData.message || retryResponse.statusText}`
        );
      }

      return retryData as T;
    }

    if (!response.ok) {
      throw new Error(
        `Shiprocket API error: ${response.status} - ${data.message || response.statusText}`
      );
    }

    return data as T;
  } catch (error: any) {
    console.error(`[Shiprocket] API request failed: ${endpoint}`, error.message);
    throw error;
  }
};

/**
 * Check if Shiprocket is configured
 */
export const isShiprocketConfigured = (): boolean => {
  return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
};

/**
 * Shiprocket API endpoints
 */
export const SHIPROCKET_ENDPOINTS = {
  // Orders
  CREATE_ORDER: '/orders/create/adhoc',
  CREATE_ORDER_FROM_CHANNEL: '/orders/create',
  GET_ORDER: '/orders/show',
  CANCEL_ORDER: '/orders/cancel',
  
  // Shipments
  CREATE_SHIPMENT: '/shipments/create/forward-shipment',
  GENERATE_AWB: '/courier/assign/awb',
  REQUEST_PICKUP: '/courier/generate/pickup',
  CANCEL_SHIPMENT: '/orders/cancel/shipment/awbs',
  
  // Tracking
  TRACK_SHIPMENT: '/courier/track/shipment',
  TRACK_AWB: '/courier/track/awb',
  
  // Couriers
  GET_COURIERS: '/courier/serviceability',
  CHECK_SERVICEABILITY: '/courier/serviceability',
  
  // Pickup Locations
  GET_PICKUP_LOCATIONS: '/settings/company/pickup',
  
  // Returns
  CREATE_RETURN: '/orders/create/return',
  
  // Labels & Manifests
  GENERATE_LABEL: '/courier/generate/label',
  GENERATE_MANIFEST: '/manifests/generate',
  PRINT_MANIFEST: '/manifests/print',
  
  // NDR (Non-Delivery Reports)
  GET_NDR: '/ndr',
  UPDATE_NDR: '/ndr',
};

export default {
  authenticate: authenticateShiprocket,
  request: shiprocketRequest,
  clearToken: clearShiprocketToken,
  isConfigured: isShiprocketConfigured,
  ENDPOINTS: SHIPROCKET_ENDPOINTS,
  API_BASE: SHIPROCKET_API_BASE,
};
