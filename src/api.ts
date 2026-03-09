/**
 * Web API endpoints for Starling Home Hub settings page
 *
 * These endpoints are called from the settings/index.html page
 * via Homey.api() to manage hub configurations.
 */

import { HubManager, HubConfig, HubStatus } from './lib/hub';
import { StarlingClient } from './lib/api';
import { StatusResponse } from './lib/api/types';
import { HubDiscovery, DiscoveredHub } from './lib/discovery';
import { getLogger } from './lib/utils';

/**
 * Homey instance interface for API handlers
 */
interface HomeyInstance {
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  app: {
    getHubManager(): HubManager;
    getHubDiscovery(): HubDiscovery;
    manifest?: {
      id: string;
      version: string;
      sdk: number;
      platforms?: string[];
    };
  };
}

/**
 * API request context provided by Homey
 */
interface ApiContext {
  homey: HomeyInstance;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

/**
 * Response for hub list
 */
interface HubListResponse {
  hubs: HubStatus[];
}

/**
 * Request body for adding/updating a hub
 */
interface HubRequest {
  name: string;
  host: string;
  apiKey: string;
  useHttps?: boolean;
  port?: number;
  pollIntervalMs?: number;
}

/**
 * Response for test connection
 */
interface TestConnectionResponse {
  success: boolean;
  status?: StatusResponse;
  error?: string;
}

/**
 * Global settings request/response
 */
interface GlobalSettingsResponse {
  debugMode: boolean;
  defaultPollIntervalMs: number;
  gracePeriodMs: number;
}

/**
 * Diagnostics response
 */
interface DiagnosticsResponse {
  hubs: Array<{
    id: string;
    name: string;
    state: string;
    isOnline: boolean;
    lastPoll: string | null;
    lastError: string | null;
    apiVersion: string | null;
    deviceCount: number;
    permissions: {
      read: boolean;
      write: boolean;
      camera: boolean;
    } | null;
  }>;
}

/**
 * Discovery scan response
 */
interface DiscoveryScanResponse {
  hubs: DiscoveredHub[];
  isScanning: boolean;
}

/**
 * Comprehensive diagnostics export response
 */
interface DiagnosticsExportResponse {
  exportedAt: string;
  app: {
    id: string;
    version: string;
    sdk: number;
    platform: string;
  };
  settings: {
    debugMode: boolean;
    defaultPollIntervalMs: number;
    gracePeriodMs: number;
  };
  hubs: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    useHttps: boolean;
    pollIntervalMs: number;
    state: string;
    isOnline: boolean;
    lastPoll: string | null;
    lastError: string | null;
    gracePeriodStarted: string | null;
    apiVersion: string | null;
    permissions: {
      read: boolean;
      write: boolean;
      camera: boolean;
    } | null;
    devices: Array<{
      id: string;
      name: string;
      category: string;
      model: string;
      roomName: string;
      structureName: string;
      isOnline: boolean;
      batteryLevel?: number;
    }>;
  }>;
  summary: {
    totalHubs: number;
    onlineHubs: number;
    offlineHubs: number;
    totalDevices: number;
    devicesByCategory: Record<string, number>;
  };
}

/**
 * Map permissions to a safe serializable format
 */
function mapPermissions(
  permissions: { read?: boolean; write?: boolean; camera?: boolean } | null | undefined
): { read: boolean; write: boolean; camera: boolean } | null {
  if (!permissions) return null;
  return {
    read: permissions.read ?? false,
    write: permissions.write ?? false,
    camera: permissions.camera ?? false,
  };
}

// ============================================================
// Test Endpoints
// ============================================================

/**
 * GET /ping - Simple test endpoint
 */
function ping(): { pong: boolean; timestamp: string } {
  return { pong: true, timestamp: new Date().toISOString() };
}

// ============================================================
// Hub Management Endpoints
// ============================================================

/**
 * GET /hubs - List all hub configurations with status
 */
function getHubs({ homey }: ApiContext): HubListResponse {
  const hubManager = homey.app.getHubManager();
  const statuses = hubManager.getAllHubStatuses();
  return { hubs: statuses };
}

/**
 * POST /hubs - Add a new hub
 */
async function addHub({ homey, body }: ApiContext): Promise<HubStatus> {
  const hubManager = homey.app.getHubManager();
  const request = body as HubRequest;

  // Validate required fields
  if (!request.name || !request.host || !request.apiKey) {
    throw new Error('Missing required fields: name, host, apiKey');
  }

  // Determine protocol and port
  const useHttps = request.useHttps ?? false;
  const port = request.port ?? (useHttps ? 3443 : 3080);

  // Generate unique ID
  const id = `hub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const config: HubConfig = {
    id,
    name: request.name.trim(),
    host: request.host.trim(),
    port,
    useHttps,
    apiKey: request.apiKey.trim(),
    pollIntervalMs: request.pollIntervalMs,
  };

  // Add the hub (this will connect and start polling)
  const connection = await hubManager.addHub(config);

  return connection.getStatus();
}

/**
 * PUT /hubs/:id - Update a hub configuration
 */
async function updateHub({ homey, params, body }: ApiContext): Promise<HubStatus> {
  const hubManager = homey.app.getHubManager();
  const hubId = params.id;
  const request = body as Partial<HubRequest>;

  const connection = hubManager.getHub(hubId);
  if (!connection) {
    throw new Error(`Hub ${hubId} not found`);
  }

  // Build updates object
  const updates: Partial<HubConfig> = {};

  if (request.name !== undefined) {
    updates.name = request.name.trim();
  }
  if (request.host !== undefined) {
    updates.host = request.host.trim();
  }
  if (request.apiKey !== undefined) {
    const trimmedApiKey = request.apiKey.trim();
    if (trimmedApiKey) {
      updates.apiKey = trimmedApiKey;
    }
  }
  if (request.useHttps !== undefined) {
    updates.useHttps = request.useHttps;
    updates.port = request.useHttps ? 3443 : 3080;
  }
  if (request.port !== undefined) {
    updates.port = request.port;
  }
  if (request.pollIntervalMs !== undefined) {
    updates.pollIntervalMs = request.pollIntervalMs;
  }

  const updatedConnection = await hubManager.updateHub(hubId, updates);

  return updatedConnection.getStatus();
}

/**
 * DELETE /hubs/:id - Remove a hub
 */
async function deleteHub({ homey, params }: ApiContext): Promise<{ success: boolean }> {
  const hubManager = homey.app.getHubManager();
  const hubId = params.id;

  await hubManager.removeHub(hubId);

  return { success: true };
}

/**
 * POST /hubs/:id/test - Test connection to a hub
 */
async function testHub({ homey, params, body }: ApiContext): Promise<TestConnectionResponse> {
  const hubManager = homey.app.getHubManager();
  const hubId = params.id;
  const request = (body ?? {}) as Partial<HubRequest>;

  const connection = hubManager.getHub(hubId);
  if (!connection) {
    throw new Error(`Hub ${hubId} not found`);
  }

  try {
    const config = connection.getConfig();
    const host = request.host?.trim() || config.host;
    const apiKey = request.apiKey?.trim() || config.apiKey;
    const useHttps = request.useHttps ?? config.useHttps;
    const port = request.port ?? (request.useHttps !== undefined ? (useHttps ? 3443 : 3080) : config.port);
    const client = new StarlingClient({
      host,
      port,
      apiKey,
      useHttps,
    });

    const status = await client.getStatus();

    return {
      success: true,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /hubs/test - Test connection to a new hub (before adding)
 */
async function testNewHub({ body }: ApiContext): Promise<TestConnectionResponse> {
  const request = body as HubRequest;

  if (!request.host || !request.apiKey) {
    throw new Error('Missing required fields: host, apiKey');
  }

  const useHttps = request.useHttps ?? false;
  const port = request.port ?? (useHttps ? 3443 : 3080);

  try {
    const client = new StarlingClient({
      host: request.host.trim(),
      port,
      apiKey: request.apiKey.trim(),
      useHttps,
    });

    const status = await client.getStatus();

    return {
      success: true,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// Global Settings Endpoints
// ============================================================

/**
 * GET /settings - Get global settings
 */
function getSettings({ homey }: ApiContext): GlobalSettingsResponse {
  const hubManager = homey.app.getHubManager();
  const settings = hubManager.getSettings();

  return {
    debugMode: settings.debugMode,
    defaultPollIntervalMs: settings.defaultPollIntervalMs,
    gracePeriodMs: settings.gracePeriodMs,
  };
}

/**
 * PUT /settings - Update global settings
 */
async function updateSettings({ homey, body }: ApiContext): Promise<GlobalSettingsResponse> {
  const hubManager = homey.app.getHubManager();
  const request = body as Partial<GlobalSettingsResponse>;

  const updates: Partial<GlobalSettingsResponse> = {};

  if (request.debugMode !== undefined) {
    updates.debugMode = request.debugMode;
    // Also update via Homey settings for app.ts listener
    homey.settings.set('debugMode', request.debugMode);
  }
  if (request.defaultPollIntervalMs !== undefined) {
    updates.defaultPollIntervalMs = request.defaultPollIntervalMs;
  }
  if (request.gracePeriodMs !== undefined) {
    updates.gracePeriodMs = request.gracePeriodMs;
  }

  await hubManager.updateSettings(updates);

  const settings = hubManager.getSettings();
  return {
    debugMode: settings.debugMode,
    defaultPollIntervalMs: settings.defaultPollIntervalMs,
    gracePeriodMs: settings.gracePeriodMs,
  };
}

// ============================================================
// Diagnostics Endpoint
// ============================================================

/**
 * GET /diagnostics - Get diagnostic information
 */
function getDiagnostics({ homey }: ApiContext): DiagnosticsResponse {
  const hubManager = homey.app.getHubManager();
  const statuses = hubManager.getAllHubStatuses();

  return {
    hubs: statuses.map((status) => ({
      id: status.config.id,
      name: status.config.name,
      state: status.state,
      isOnline: status.isOnline,
      lastPoll: status.lastPoll?.toISOString() ?? null,
      lastError: status.lastError,
      apiVersion: status.apiVersion,
      deviceCount: status.deviceCount,
      permissions: mapPermissions(status.permissions),
    })),
  };
}

/**
 * GET /diagnostics/export - Export comprehensive diagnostics for support
 *
 * Returns a complete snapshot of the app state including:
 * - App info and version
 * - All hub configurations (API keys omitted for security)
 * - All device inventories
 * - Current settings
 * - Summary statistics
 */
function exportDiagnostics({ homey }: ApiContext): DiagnosticsExportResponse {
  const hubManager = homey.app.getHubManager();
  const statuses = hubManager.getAllHubStatuses();
  const settings = hubManager.getSettings();
  const manifest = homey.app.manifest;
  const platform = manifest?.platforms?.[0] ?? 'local';

  // Build device category counts
  const devicesByCategory: Record<string, number> = {};
  let totalDevices = 0;

  // Build hub data with devices
  const hubsData = statuses.map((status) => {
    const hub = hubManager.getHub(status.config.id);
    const devices = hub?.getCachedDevices() ?? [];

    // Count devices by category
    for (const device of devices) {
      devicesByCategory[device.category] = (devicesByCategory[device.category] ?? 0) + 1;
      totalDevices++;
    }

    return {
      id: status.config.id,
      name: status.config.name,
      host: status.config.host,
      port: status.config.port,
      useHttps: status.config.useHttps,
      pollIntervalMs: status.config.pollIntervalMs ?? settings.defaultPollIntervalMs,
      state: status.state,
      isOnline: status.isOnline,
      lastPoll: status.lastPoll?.toISOString() ?? null,
      lastError: status.lastError,
      gracePeriodStarted: status.gracePeriodStarted?.toISOString() ?? null,
      apiVersion: status.apiVersion,
      permissions: mapPermissions(status.permissions),
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        category: device.category,
        model: device.model,
        roomName: device.roomName,
        structureName: device.structureName,
        isOnline: device.isOnline,
        batteryLevel: device.batteryLevel,
      })),
    };
  });

  const onlineHubs = statuses.filter((s) => s.isOnline).length;

  return {
    exportedAt: new Date().toISOString(),
    app: {
      id: manifest?.id ?? 'com.eyecatch.googlenest.starling',
      version: manifest?.version ?? '2.0.0',
      sdk: manifest?.sdk ?? 3,
      platform,
    },
    settings: {
      debugMode: settings.debugMode,
      defaultPollIntervalMs: settings.defaultPollIntervalMs,
      gracePeriodMs: settings.gracePeriodMs,
    },
    hubs: hubsData,
    summary: {
      totalHubs: statuses.length,
      onlineHubs,
      offlineHubs: statuses.length - onlineHubs,
      totalDevices,
      devicesByCategory,
    },
  };
}

// ============================================================
// Discovery Endpoints
// ============================================================

/**
 * POST /discovery/scan - Start a discovery scan for Starling Hubs
 */
async function startDiscoveryScan({ homey }: ApiContext): Promise<DiscoveryScanResponse> {
  const logger = getLogger();
  logger.debug('[Discovery API] Starting scan...');
  const hubDiscovery = homey.app.getHubDiscovery();

  // Start scan (this will run for ~5 seconds)
  const hubs = await hubDiscovery.startScan();
  logger.debug(`[Discovery API] Scan complete, found ${hubs.length} hubs`);

  return {
    hubs,
    isScanning: hubDiscovery.isScanningInProgress(),
  };
}

/**
 * GET /discovery/results - Get current discovery results
 */
function getDiscoveryResults({ homey }: ApiContext): DiscoveryScanResponse {
  const hubDiscovery = homey.app.getHubDiscovery();

  return {
    hubs: hubDiscovery.getDiscoveredHubs(),
    isScanning: hubDiscovery.isScanningInProgress(),
  };
}

// ============================================================
// Export all handlers
// ============================================================

const api = {
  ping,
  getHubs,
  addHub,
  updateHub,
  deleteHub,
  testHub,
  testNewHub,
  getSettings,
  updateSettings,
  getDiagnostics,
  exportDiagnostics,
  startDiscoveryScan,
  getDiscoveryResults,
};

module.exports = api;
