# pl2303-webusb

Prolific PL2303 user-space USB to serial adapter driver for [WebUSB](https://wicg.github.io/webusb/), working in the
browser. Note that WebUSB [is experimental](https://developer.mozilla.org/en-US/docs/Web/API/USB#browser_compatibility)
at the time of writing and only working in Chromium-based browsers.

**Note that the code of this repository is _just working_ at this time. Use this code at your own risk!**

## Usage

```javascript
import Pl2303WebUsbSerial from 'pl2303-webusb';
import { debounce } from '';

const VENDOR_ID = 1367;
const PRODUCT_ID = 8200

const NUMBER_OF_BYTES_TO_READ = 64;
const READ_DEBOUNCE_DELAY_IN_MILLIS = 100;

let usbDevice;

// Invoke this function when the user clicked on a button to connect to the USB device. Due to security limitations of
// WebUSB, it's required to request the device within the event handler.
// E.g. <button onclick="handleConnectButtonClick">Connect to USB device</button>
const handleConnectButtonClick = async () => {
    const device = await navigator.usb.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
    usbDevice = new Pl2303WebUsbSerial(device);
    await usbDevice.connect();
    await readUntilSilent();
};

// This function is used to (trivially) batch-process read bytes. To do so, the USB device is read, and the received
// bytes are stored in a local buffer. A function is debounced inovked to consume the buffer. After the wait 
// (here: 100 ms) the consume function is executed, the buffer is processed and emptied.
// Reading from the USB device is done in a loop.
const readUntilSilent = async () => {
  let buffer = new Blob();
  
  const debouncedConsumeBuffer = debounce(async () => {
    const array = await buffer.arrayBuffer();
    console.log(`debounced transfer in: ${new TextDecoder().decode(array)}`);
    buffer = new Blob();
  }, READ_DEBOUNCE_DELAY_IN_MILLIS);

  while (usbDevice) {
    try {
      const readout = await usbDevice.read(NUMBER_OF_BYTES_TO_READ);
      buffer = new Blob([buffer, readout.data.buffer]);
      debouncedConsumeBuffer();
    } catch (error) {
      console.debug(`Readout error: ${error}`, error);
    }
  }
}
```

## Improvements

Feel free to fork this repository, open issues or submit pull requests.
