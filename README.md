# Starling Home Hub for Homey

Integrate your Google Home/Nest devices with Homey using the [Starling Home Hub](https://www.starlinghome.io/).

The Starling Home Hub is a local bridge that exposes Google Home devices via a REST API, enabling integration with home automation platforms like Homey without relying on cloud services.

## Features

- **Local Control** - All communication happens on your local network
- **21 Device Types** - Comprehensive support for Google Home/Nest devices
- **Auto-Discovery** - Automatically discovers Starling Hubs on your network via mDNS
- **Multi-Hub Support** - Connect multiple Starling Hubs to a single Homey
- **Flow Integration** - Full support for Homey Flows with triggers, conditions, and actions
- **Live Camera Streaming** - View camera feeds directly in the Homey dashboard

## Supported Devices

| Category | Device Types |
|----------|--------------|
| **Lighting** | Lights, Switches, Outlets |
| **Climate** | Thermostats, Fans, Heater/Coolers, Humidifiers, Purifiers, Diffusers |
| **Security** | Cameras, Doorbells, Locks, Smoke/CO Detectors |
| **Sensors** | Temperature, Humidity, Motion, Contact sensors |
| **Other** | Blinds/Shades, Garage Doors, Valves, Robot Vacuums, Kettles, Home/Away |

## Requirements

- **Homey Pro** (2019 or later) or **Homey Bridge** with Homey v12.4.0 or higher
- **Starling Home Hub** (purchased separately from [starlinghome.io](https://www.starlinghome.io/))
- Google Home/Nest devices linked to your Starling Hub

## Installation

1. Install the app from the Homey App Store
2. Open the app settings to configure your Starling Hub connection

## Configuration

### Adding a Starling Hub

1. Go to **Homey App Settings** → **Starling Home Hub**
2. Click **Add Hub**
3. The app will auto-discover hubs on your network, or you can enter the IP address manually
4. Enter your Starling Hub API key (found in the Starling Home Hub web interface)
5. Click **Save**

### Adding Devices

1. Go to **Devices** → **Add Device** → **Starling Home Hub**
2. Select the device type you want to add (Light, Thermostat, Camera, etc.)
3. Choose from the list of discovered devices
4. Assign to a zone and click **Add**

## Polling & Event Detection

This app polls the Starling Hub API to detect device state changes. The Starling Hub API is state-based (not event-based), meaning it reports current device states rather than pushing events.

### Default Polling Interval

The default polling interval is **5 seconds**. This interval was chosen because:

- **Ephemeral events** (doorbell presses, motion/person detection) are only present in the Starling Hub API for approximately 5 seconds before clearing
- A 5-second interval provides ~85% capture rate for these short-lived events
- Longer intervals risk missing doorbell presses and detection events entirely

### Trade-offs

| Interval | Event Capture | Network Load | Best For |
|----------|---------------|--------------|----------|
| 3 seconds | ~95% | Higher | Doorbell-critical setups |
| **5 seconds** | ~85% | Moderate | **Recommended default** |
| 10 seconds | ~50% | Lower | Slow-changing devices only |
| 15+ seconds | <40% | Minimal | Energy monitoring, not events |

### Limitations

- The Starling Hub API does not support webhooks or push notifications
- Very brief events (<2 seconds) may occasionally be missed between polls
- For time-critical automations (e.g., doorbell → unlock door), consider the inherent polling latency

## Flow Cards

### Triggers
- Device state changes (on/off, temperature, motion, etc.)
- Camera person/animal/vehicle/package detection
- Doorbell pressed
- Smoke/CO detected
- Lock state changes
- Garage door opened/closed

### Conditions
- Device is on/off
- Temperature above/below threshold
- Motion detected
- Person detected
- Home/Away mode

### Actions
- Turn devices on/off
- Set temperature/brightness/color
- Lock/unlock doors
- Open/close garage doors
- Start/stop robot vacuum
- Set Home/Away mode

## Troubleshooting

### Hub not discovered
- Ensure your Starling Hub is on the same network as Homey
- Check that mDNS/Bonjour is not blocked on your network
- Try entering the hub IP address manually

### Devices not responding
- Verify the hub is online in the app settings
- Check that the API key is correct
- Ensure the device is online in the Google Home app

### Camera streaming not working
- Camera streaming requires Homey Pro with local network access
- Some camera features may require a Nest Aware subscription

## Privacy & Security

- All communication is local - no cloud services required
- API keys are stored securely on your Homey
- No data is sent to external servers

## Support

- **Issues:** [GitHub Issues](https://github.com/AppsAtMe/homey-starling-dev/issues)
- **Starling Hub Support:** [starlinghome.io/support](https://www.starlinghome.io/support)

## License

This project is licensed under the Apache-2.0 License.

## Acknowledgments

- [Starling Home](https://www.starlinghome.io/) for creating the Starling Home Hub
- [Athom](https://homey.app/) for the Homey platform
