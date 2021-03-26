/*
 * Copyright for portions of usbserial are held by Andreas Gal (2017) as part
 * of pl2303. Based on pl2303 by Tidepool Project (2018). Copyright of additional
 * changes are held by Folleon GmbH.
 *
 * Prolific PL2303 user-space USB driver for WebUSB.
 *
 * SPDX-License-Identifier: MIT
 */

export default class Pl2303WebUsbSerial {
  device;

  constructor(device) {
    this.device = device;
  }

  async connect(configuration = 1, baudRate = 9600) {
    await this.device.open();
    await this.device.selectConfiguration(configuration);
    await this.device.claimInterface(
      this.device.configuration.interfaces[0].interfaceNumber
    );

    await this.vendorRead(0x8484, 0);
    await this.vendorWrite(0x0404, 0);
    await this.vendorRead(0x8484, 0);
    await this.vendorRead(0x8383, 0);
    await this.vendorRead(0x8484, 0);
    await this.vendorWrite(0x0404, 1);
    await this.vendorRead(0x8484, 0);
    await this.vendorRead(0x8383, 0);
    await this.vendorWrite(0, 1);
    await this.vendorWrite(1, 0);
    await this.vendorWrite(2, 0x44);
    await this.setBaudRate(baudRate);
    await this.vendorWrite(0x0, 0x0); // no flow control
    await this.vendorWrite(8, 0); // reset upstream data pipes
    await this.vendorWrite(9, 0);
  }

  async setBaudRate(baudRate) {
    const currentConfiguration = await this.device.controlTransferIn(
      {
        recipient: "interface",
        requestType: "class",
        request: 0x21, // get configuration command
        value: 0,
        index: 0,
      },
      7 // read 7 bytes
    );

    const baudRateConfiguration = new DataView(
      currentConfiguration.data.buffer
    );
    baudRateConfiguration.setInt32(0, baudRate, true); // baud rate, little-endian
    baudRateConfiguration.setInt8(4, 0); // 1 stop bit
    baudRateConfiguration.setInt8(5, 0); // no parity
    baudRateConfiguration.setInt8(6, 8); // 8 bit characters

    await this.device.controlTransferOut(
      {
        recipient: "interface",
        requestType: "class",
        request: 0x20, // configuration command
        value: 0,
        index: 0,
      },
      baudRateConfiguration.buffer
    );
  }

  async vendorRead(value, index) {
    return this.device.controlTransferIn(
      {
        requestType: "vendor",
        recipient: "device",
        request: 0x01,
        value,
        index,
      },
      1
    );
  }

  async vendorWrite(value, index) {
    return this.device.controlTransferOut({
      requestType: "vendor",
      recipient: "device",
      request: 0x01,
      value,
      index,
    });
  }

  async read(numberOfBytes, endpointNumber = 3) {
    return this.device.transferIn(endpointNumber, numberOfBytes);
  }

  async send(dataAsBytes, endpointNumber = 2) {
    return this.device.transferOut(endpointNumber, dataAsBytes);
  }

  async close() {
    return this.device.close();
  }
}
