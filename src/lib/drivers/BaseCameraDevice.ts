/**
 * BaseCameraDevice - Shared base class for Camera and Doorbell devices
 *
 * Contains all functionality common to both device types:
 * - Quiet time toggle (onoff capability, inverted)
 * - Detection event triggers (person, animal, vehicle, package)
 * - Face detection triggers
 * - Capability mapping for alarms
 * - WebRTC live video streaming
 * - Snapshot image for dashboard widgets
 *
 * Subclasses provide:
 * - getTriggerPrefix(): Flow trigger ID prefix ('' for camera, 'doorbell_' for doorbell)
 * - onInitCamera(): Device-specific capability setup after base init
 *
 * Note: The 'doorbell_pressed' trigger ID is the same for both camera and doorbell
 * (not prefixed for doorbell), so it's hardcoded rather than using the prefix.
 */

import { Readable } from 'stream';
import { StarlingDevice } from './StarlingDevice';
import { Device, CameraDevice } from '../api/types';

/**
 * Type for the app instance to access triggerFaceDetected
 */
interface StarlingHomeHubApp {
  triggerFaceDetected(personName: string, cameraId: string, cameraName: string, hubId: string): void;
}

/**
 * Homey Video interface for WebRTC (not fully typed in SDK)
 */
interface VideoWebRTC {
  registerOfferListener(
    handler: (offerSdp: string) => Promise<{ answerSdp: string; streamId?: string }>
  ): void;
  registerKeepAliveListener(handler: (streamId: string) => Promise<void>): void;
}

/**
 * Homey Videos Manager interface (not fully typed in SDK)
 */
interface VideosManager {
  createVideoWebRTC(options?: { dataChannel?: boolean }): Promise<VideoWebRTC>;
}

/**
 * Homey Image interface (not fully typed in SDK)
 */
interface HomeyImage {
  setStream(source: (stream: NodeJS.WritableStream) => Promise<void>): void;
  update(): Promise<void>;
}

/**
 * Homey Images Manager interface (not fully typed in SDK)
 */
interface ImagesManager {
  createImage(): Promise<HomeyImage>;
}

abstract class BaseCameraDevice extends StarlingDevice {
  /**
   * Get the flow trigger ID prefix for this device type.
   * Camera returns '' (e.g. 'person_detected'), doorbell returns 'doorbell_' (e.g. 'doorbell_person_detected').
   */
  protected abstract getTriggerPrefix(): string;

  /**
   * Called after base camera init to add device-specific capabilities.
   * Override in subclasses for doorbell-specific setup, etc.
   */
  protected async onInitCamera(_device: CameraDevice): Promise<void> {
    // Default: no extra setup
  }

  /**
   * Register capability listeners
   */
  protected registerCapabilityListeners(): void {
    // Quiet time toggle (only writable capability)
    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', async (value: boolean) => {
        // Invert: Homey onoff=true means camera active, quietTime=false
        await this.setPropertyOptimistic('quietTime', !value, 'onoff', value);
      });
    }
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const camera = device as CameraDevice;
    const prefix = this.getTriggerPrefix();

    // Detection triggers (fire on rising edge only)
    this.triggerOnRisingEdge('personDetected', camera.personDetected, `${prefix}person_detected`);
    this.triggerOnRisingEdge('animalDetected', camera.animalDetected, `${prefix}animal_detected`);
    this.triggerOnRisingEdge('vehicleDetected', camera.vehicleDetected, `${prefix}vehicle_detected`);
    // doorbell_pressed is the same trigger ID for both camera and doorbell drivers
    this.triggerOnRisingEdge('doorbellPushed', camera.doorbellPushed, 'doorbell_pressed');
    this.triggerOnRisingEdge('packageDelivered', camera.packageDelivered, `${prefix}package_delivered`);
    this.triggerOnRisingEdge('packageRetrieved', camera.packageRetrieved, `${prefix}package_retrieved`);

    // Face detection triggers (per-person)
    if (camera.faceDetected) {
      for (const [personName, detected] of Object.entries(camera.faceDetected)) {
        const stateKey = `faceDetected:${personName}`;
        const change = this.checkStateChange(stateKey, detected);
        if (change && change.newValue === true) {
          const app = this.homey.app as unknown as StarlingHomeHubApp;
          app.triggerFaceDetected(personName, camera.id, camera.name, this.hubId);
        }
        this.updatePreviousState(stateKey, detected);
      }
    }
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const camera = device as CameraDevice;

    // Quiet time → onoff (inverted: quiet=true means camera "off" in terms of notifications)
    if (camera.quietTime !== undefined && this.hasCapability('onoff')) {
      await this.safeSetCapabilityValue('onoff', !camera.quietTime);
    }

    // Motion detection
    if (camera.motionDetected !== undefined && this.hasCapability('alarm_motion')) {
      await this.safeSetCapabilityValue('alarm_motion', camera.motionDetected);
    }

    // Person detection
    if (camera.personDetected !== undefined && this.hasCapability('alarm_person_detected')) {
      await this.safeSetCapabilityValue('alarm_person_detected', camera.personDetected);
    }

    // Animal detection
    if (camera.animalDetected !== undefined && this.hasCapability('alarm_animal_detected')) {
      await this.safeSetCapabilityValue('alarm_animal_detected', camera.animalDetected);
    }

    // Vehicle detection
    if (camera.vehicleDetected !== undefined && this.hasCapability('alarm_vehicle_detected')) {
      await this.safeSetCapabilityValue('alarm_vehicle_detected', camera.vehicleDetected);
    }

    // Doorbell button
    if (camera.doorbellPushed !== undefined && this.hasCapability('alarm_generic')) {
      await this.safeSetCapabilityValue('alarm_generic', camera.doorbellPushed);
    }
  }

  /**
   * Called when the device is initialized
   */
  async onInit(): Promise<void> {
    // Call base class first to set up starlingId, hubConnection, etc.
    await super.onInit();

    // Now we can access the Starling device data
    const device = this.getStarlingDevice() as CameraDevice | undefined;

    if (device) {
      // Add motion detection capability
      await this.ensureCapability('alarm_motion');

      // Add person detection if supported
      if (device.personDetected !== undefined) {
        await this.ensureCapability('alarm_person_detected');
      }

      // Device-specific capability setup (e.g. doorbell always adds alarm_generic)
      await this.onInitCamera(device);

      // Set up WebRTC video streaming if camera supports it
      if (device.supportsWebRtcStreaming || device.supportsStreaming) {
        await this.setupWebRTCVideo();
      } else {
        this.log('WebRTC streaming not supported by this device');
      }

      // Set up snapshot image for dashboard widgets
      await this.setupSnapshotImage();
    }
  }

  /**
   * Set up WebRTC video streaming for compatible cameras
   *
   * This enables live video streaming in the Homey app for 2021+ Nest cameras.
   * The flow is:
   * 1. User opens camera stream in Homey app
   * 2. Homey creates SDP offer and calls our offerListener
   * 3. We forward offer to Starling Hub /devices/{id}/stream
   * 4. Starling returns SDP answer + streamId
   * 5. We return answer to Homey, which establishes WebRTC connection
   * 6. Every ~60s, Homey calls keepAliveListener to extend the stream
   */
  private async setupWebRTCVideo(): Promise<void> {
    try {
      // Access the videos manager (not fully typed in SDK)
      const videos = this.homey as unknown as { videos: VideosManager };

      if (!videos.videos?.createVideoWebRTC) {
        this.log('VideoWebRTC not available on this Homey platform');
        return;
      }

      // Create WebRTC video instance
      // Nest cameras REQUIRE a data channel - the SDP must have audio, video, AND application m= lines
      const video = await videos.videos.createVideoWebRTC({
        dataChannel: true,
      });

      // Register offer listener - called when user opens camera stream
      video.registerOfferListener(async (offerSdp: string) => {
        this.log('WebRTC offer received, forwarding to Starling Hub');

        const connection = this.hubConnection;
        if (!connection) {
          throw new Error('Hub connection not available');
        }

        const store = this.getStore() as { starlingId: string };
        const client = connection.getClient();

        // Forward SDP offer to Starling Hub
        try {
          const result = await client.startStream(store.starlingId, offerSdp);

          this.log(`WebRTC stream started: ${result.streamId}`);

          return {
            answerSdp: result.answer,
            streamId: result.streamId,
          };
        } catch (error) {
          this.error('WebRTC stream start failed:', error);
          throw error;
        }
      });

      // Register keep-alive listener - called every ~60s while stream is active
      video.registerKeepAliveListener(async (streamId: string) => {
        this.log(`Extending WebRTC stream: ${streamId}`);

        const connection = this.hubConnection;
        if (!connection) {
          throw new Error('Hub connection not available');
        }

        const store = this.getStore() as { starlingId: string };
        const client = connection.getClient();

        await client.extendStream(store.starlingId, streamId);
      });

      // Register the video stream with this device
      const deviceWithVideo = this as unknown as {
        setCameraVideo(id: string, title: string, video: unknown): Promise<void>;
      };
      await deviceWithVideo.setCameraVideo('main', this.getName(), video);

      this.log('WebRTC video streaming enabled');
    } catch (error) {
      this.error('Failed to set up WebRTC video:', error);
    }
  }

  /**
   * Set up snapshot image for dashboard widgets
   *
   * This enables snapshot images in Homey dashboards for cameras.
   * The snapshot is fetched from the Starling Hub API on-demand.
   * Note: Starling API rate limits snapshots to 1 per 10 seconds per camera.
   */
  private async setupSnapshotImage(): Promise<void> {
    try {
      // Access the images manager (not fully typed in SDK)
      const homeyWithImages = this.homey as unknown as { images: ImagesManager };

      if (!homeyWithImages.images?.createImage) {
        this.log('Image manager not available on this Homey platform');
        return;
      }

      // Create image instance
      const image = await homeyWithImages.images.createImage();

      // Set up stream to fetch snapshot from Starling Hub
      image.setStream(async (stream: NodeJS.WritableStream) => {
        const connection = this.hubConnection;
        if (!connection) {
          throw new Error('Hub connection not available');
        }

        const store = this.getStore() as { starlingId: string };

        try {
          // Fetch snapshot from Starling Hub (rate limited to 1 per 10 seconds)
          const snapshotBuffer = await connection.getSnapshot(store.starlingId);

          // Convert Buffer to readable stream and pipe to output
          const readable = Readable.from(snapshotBuffer);
          readable.pipe(stream);
        } catch (error) {
          this.error('Failed to fetch snapshot:', error);
          throw error;
        }
      });

      // Associate image with this device for dashboard widgets
      const sdkImage = image as unknown as Parameters<typeof this.setCameraImage>[2];
      await this.setCameraImage('snapshot', 'Snapshot', sdkImage);

      this.log('Snapshot image enabled for dashboard');
    } catch (error) {
      this.error('Failed to set up snapshot image:', error);
    }
  }
}

export { BaseCameraDevice };
