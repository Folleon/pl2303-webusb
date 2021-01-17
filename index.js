/*
 * Copyright for portions of usbserial are held by Andreas Gal (2017) as part
 * of pl2303. Based on pl2303 by Tidepool Project (2018). Copyright of additional
 * changes are held by Folleon GmbH.
 *
 * Prolific PL2303 user-space USB driver for WebUSB.
 *
 * SPDX-License-Identifier: MIT
 */

const assert = require("assert");
const usb = require("usb");
const EventEmitter = require("events");

function findDevices(vid, pid) {
  return usb
    .getDeviceList()
    .filter(
      (device) =>
        device.deviceDescriptor.idVendor === vid &&
        device.deviceDescriptor.idProduct === pid
    );
}

const SupportedBaudrates = [
  75,
  150,
  300,
  600,
  1200,
  1800,
  2400,
  3600,
  4800,
  7200,
  9600,
  14400,
  19200,
  28800,
  38400,
  57600,
  115200,
  230400,
  460800,
  614400,
  921600,
  1228800,
  2457600,
  3000000,
  6000000,
];

// find an endpoint of the given transfer type and direction
function findEp(iface, transferType, direction) {
  const eps = iface.endpoints.filter(
    (e) => e.transferType === transferType && e.direction === direction
  );
  assert(eps.length === 1);
  return eps[0];
}

function controlTransfer(
  device,
  requestType,
  request,
  value,
  index,
  dataOrLength
) {
  return new Promise((resolve, reject) => {
    device.controlTransfer(
      requestType,
      request,
      value,
      index,
      dataOrLength,
      (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      }
    );
  });
}

function vendorRead(device, value, index) {
  return controlTransfer(device, 0xc0, 0x01, value, index, 1).then(
    (buffer) => buffer[0]
  );
}

function vendorWrite(device, value, index) {
  return controlTransfer(device, 0x40, 0x01, value, index, Buffer.alloc(0));
}

function setBaudrate(device, baud) {
  assert(baud <= 115200);
  // find the nearest supported bitrate
  const list = SupportedBaudrates.slice().sort(
    (a, b) => Math.abs(a - baud) - Math.abs(b - baud)
  );
  const newBaud = list[0];
  return controlTransfer(device, 0xa1, 0x21, 0, 0, 7)
    .then((data) => {
      const parameters = data;
      parameters.writeInt32LE(newBaud, 0);
      parameters[4] = 0; // 1 stop bit
      parameters[5] = 0; // no parity
      parameters[6] = 8; // 8 bit characters
      return controlTransfer(device, 0x21, 0x20, 0, 0, parameters);
    })
    .then(() => vendorWrite(device, 0x0, 0x0)) // no flow control
    .then(() => vendorWrite(device, 8, 0)) // reset upstream data pipes
    .then(() => vendorWrite(device, 9, 0));
}

class UsbSerial extends EventEmitter {
  constructor(opts) {
    super();
    const port = opts.port || 0;
    const bitrate = opts.baudRate || 9600;
    const devices = findDevices(0x067b, 0x2303);
    assert(devices.length > port);
    const device = devices[port];
    const descriptor = device.deviceDescriptor;
    this.device = device;
    assert(descriptor.bDeviceClass !== 0x02);
    assert(descriptor.bMaxPacketSize0 === 0x40); // HX type
    device.timeout = 100;
    device.open();
    assert(device.interfaces.length === 1);
    [this.iface] = device.interfaces;
    this.iface.claim();
    const intEp = findEp(this.iface, usb.LIBUSB_TRANSFER_TYPE_INTERRUPT, "in");
    intEp.on("data", (data) => {
      this.emit("status", data);
    });
    intEp.on("error", (err) => {
      this.emit("error", err);
    });
    intEp.startPoll();
    const inEp = findEp(this.iface, usb.LIBUSB_TRANSFER_TYPE_BULK, "in");
    inEp.on("data", (data) => {
      this.emit("data", data);
    });
    inEp.on("error", (err) => {
      this.emit("error", err);
    });
    const outEp = findEp(this.iface, usb.LIBUSB_TRANSFER_TYPE_BULK, "out");
    outEp.on("error", (err) => {
      this.emit("error", err);
    });
    this.outEp = outEp;
    vendorRead(device, 0x8484, 0)
      .then(() => vendorWrite(device, 0x0404, 0))
      .then(() => vendorRead(device, 0x8484, 0))
      .then(() => vendorRead(device, 0x8383, 0))
      .then(() => vendorRead(device, 0x8484, 0))
      .then(() => vendorWrite(device, 0x0404, 1))
      .then(() => vendorRead(device, 0x8484, 0))
      .then(() => vendorRead(device, 0x8383, 0))
      .then(() => vendorWrite(device, 0, 1))
      .then(() => vendorWrite(device, 1, 0))
      .then(() => vendorWrite(device, 2, 0x44))
      .then(() => setBaudrate(device, bitrate))
      .then(() => inEp.startPoll())
      .then(() => this.emit("ready"))
      .catch((err) => this.emit("error", err));
  }

  close(cb) {
    this.removeAllListeners();
    this.iface.release(true, () => {
      this.device.close();
      return cb();
    });
  }

  send(data) {
    assert(data instanceof Buffer);
    this.outEp.transfer(data);
  }
}

module.exports = UsbSerial;
