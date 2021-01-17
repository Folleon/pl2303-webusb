/*
 * Copyright for portions of usbserial are held by Andreas Gal (2017) as part
 * of pl2303. Based on pl2303 by Tidepool Project (2018). Copyright of additional
 * changes are held by Folleon GmbH.
 *
 * Prolific PL2303 user-space USB driver for WebUSB.
 *
 * SPDX-License-Identifier: MIT
 */

import assert from "assert";
import EventEmitter from "eventemitter3";

function findDevices(vendorId, productId) {
  return navigator.usb.requestDevice({ filters: [{ vendorId, productId }] });
}

const LIBUSB_TRANSFER_TYPE_BULK = 0x02;
const LIBUSB_TRANSFER_TYPE_INTERRUPT = 0x03;

const BAUD_RATES = [
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
function findEndpoint(iface, transferType, direction) {
  const endpoints = iface.endpoints.filter(
    (it) => it.transferType === transferType && it.direction === direction
  );
  assert(endpoints.length === 1);
  return endpoints[0];
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

function setBaudRate(device, baudRate) {
  assert(baudRate <= 115200);
  // find the nearest supported bitrate
  const list = BAUD_RATES.slice().sort(
    (a, b) => Math.abs(a - baudRate) - Math.abs(b - baudRate)
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

export default class UsbSerial extends EventEmitter {
  constructor(options) {
    super();
    const port = options.port || 0;
    const bitrate = options.baudRate || 9600;
    const vendorId = options.vendorId || 0x067b;
    const productId = options.productId || 0x2303;
    const devices = findDevices(vendorId, productId);
    assert(devices.length > port);
    this.device = devices[port];
    assert(this.device.deviceClass !== 0x02);
    // assert(descriptor.bMaxPacketSize0 === 0x40); // HX type
    // this.device.timeout = 100;
    this.device.open();
    assert(this.device.interfaces.length === 1);
    [this.iface] = this.device.interfaces;
    this.iface.claim();
    const interfaceEndpoint = findEndpoint(
      this.iface,
      LIBUSB_TRANSFER_TYPE_INTERRUPT,
      "in"
    );
    interfaceEndpoint.on("data", (data) => {
      this.emit("status", data);
    });
    interfaceEndpoint.on("error", (err) => {
      this.emit("error", err);
    });
    interfaceEndpoint.startPoll();
    const inEndpoint = findEndpoint(
      this.iface,
      LIBUSB_TRANSFER_TYPE_BULK,
      "in"
    );

    inEndpoint.on("data", (data) => {
      this.emit("data", data);
    });

    inEndpoint.on("error", (err) => {
      this.emit("error", err);
    });

    const outEndpoint = findEndpoint(
      this.iface,
      LIBUSB_TRANSFER_TYPE_BULK,
      "out"
    );

    outEndpoint.on("error", (err) => {
      this.emit("error", err);
    });

    this.outEndpoint = outEndpoint;
    vendorRead(this.device, 0x8484, 0)
      .then(() => vendorWrite(this.device, 0x0404, 0))
      .then(() => vendorRead(this.device, 0x8484, 0))
      .then(() => vendorRead(this.device, 0x8383, 0))
      .then(() => vendorRead(this.device, 0x8484, 0))
      .then(() => vendorWrite(this.device, 0x0404, 1))
      .then(() => vendorRead(this.device, 0x8484, 0))
      .then(() => vendorRead(this.device, 0x8383, 0))
      .then(() => vendorWrite(this.device, 0, 1))
      .then(() => vendorWrite(this.device, 1, 0))
      .then(() => vendorWrite(this.device, 2, 0x44))
      .then(() => setBaudRate(this.device, bitrate))
      .then(() => inEndpoint.startPoll())
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
    this.outEndpoint.transfer(data);
  }
}
