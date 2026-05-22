// SC1240SDK.swift
// BSS Parking Smart Lock SC1240 — iOS/macOS Swift SDK
// =====================================================
// Provides full BLE integration using CoreBluetooth framework.
// Conforms to Combine publisher pattern for reactive event handling.
//
// Usage:
//   let sdk = SC1240SDK(peripheralUUID: uuid)
//   sdk.eventPublisher
//       .receive(on: DispatchQueue.main)
//       .sink { event in ... }
//   sdk.connect()
//   sdk.raiseLock()

import Foundation
import CoreBluetooth
import Combine

// MARK: - Protocol Constants

public enum SC1240Const {
    public static let preamble: UInt32 = 0x12345678
    public static let header:   UInt16 = 0xEB90
    public static let frameLen: Int    = 12
    public static let telemetryLen: Int = 16
    public static let bleServiceUUID     = CBUUID(string: "FFE0")
    public static let bleCharacteristic  = CBUUID(string: "FFE1")
    public static let defaultTimeoutSecs: TimeInterval = 3.0
    public static let otaChunkSize: Int  = 128
}

// MARK: - Command Opcodes

public enum SC1240Command: UInt16 {
    case resetDevice = 0x0233
    case raiseLock   = 0x0234
    case lowerLock   = 0x0235
    case getStatus   = 0x0236
    case otaBegin    = 0x0240
    case otaChunk    = 0x0241
    case otaCommit   = 0x0242
    case otaAbort    = 0x0243

    /// Build the canonical 12-byte command frame
    public var frame: Data {
        var buf = Data(repeating: 0, count: 12)
        buf.writeUInt32BE(SC1240Const.preamble, at: 0)
        buf.writeUInt16BE(SC1240Const.header, at: 4)
        buf.writeUInt32BE(0xFFFFFFFF, at: 6)
        buf.writeUInt16BE(self.rawValue, at: 10)
        return buf
    }
}

// MARK: - Error Codes

public struct SC1240ErrorFlags: OptionSet {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }

    public static let geomagFail   = SC1240ErrorFlags(rawValue: 0x01)
    public static let radarFail    = SC1240ErrorFlags(rawValue: 0x02)
    public static let angleFail    = SC1240ErrorFlags(rawValue: 0x04)
    public static let probeFail    = SC1240ErrorFlags(rawValue: 0x08)
    public static let obstacleHit  = SC1240ErrorFlags(rawValue: 0x10)
    public static let shakingAlarm = SC1240ErrorFlags(rawValue: 0x20)
    public static let liftTimeout  = SC1240ErrorFlags(rawValue: 0x40)
    public static let baffleJammed = SC1240ErrorFlags(rawValue: 0x80)

    public var descriptions: [(code: String, message: String, severity: String)] {
        var result: [(code: String, message: String, severity: String)] = []
        if contains(.baffleJammed)  { result.append(("ERROR_80", "Baffle Jammed — mechanical obstruction detected. Manual intervention required.", "critical")) }
        if contains(.liftTimeout)   { result.append(("ERROR_40", "Lifting Timeout — motor failed to complete raise cycle.", "critical")) }
        if contains(.shakingAlarm)  { result.append(("ERROR_20", "Shaking Alarm — possible fare evasion or vandalism.", "warning")) }
        if contains(.obstacleHit)   { result.append(("ERROR_10", "Obstacle During Raise — auto-bounce protection activated.", "warning")) }
        if contains(.probeFail)     { result.append(("ERROR_08", "Probe Communication Failure — check sensor bus wiring.", "error")) }
        if contains(.angleFail)     { result.append(("ERROR_04", "Angle Sensor Failure — obstacle protection degraded.", "error")) }
        if contains(.radarFail)     { result.append(("ERROR_02", "Microwave Radar Failure — detection accuracy reduced.", "error")) }
        if contains(.geomagFail)    { result.append(("ERROR_01", "Geomagnetic Sensor Failure — immediate service required.", "critical")) }
        return result
    }
}

// MARK: - Lock State

public enum SC1240LockState: UInt8 {
    case lowered  = 0x00
    case raising  = 0x01
    case raised   = 0x02
    case lowering = 0x03
    case fault    = 0xFF
    case unknown  = 0xFE
}

// MARK: - Telemetry

public struct SC1240Telemetry {
    public let lockState:       SC1240LockState
    public let errorFlags:      SC1240ErrorFlags
    public let sensorMode:      UInt8
    public let batteryPercent:  UInt8
    public let solarCharging:   Bool
    public let vehicleDetected: Bool
    public let baffleAngleDeg:  Float   // 0.1° resolution
    public let timestamp:       Date

    public var isBatteryLow:      Bool { batteryPercent <= 20 }
    public var isBatteryCritical: Bool { batteryPercent <= 10 }
    public var hasError:          Bool { errorFlags.rawValue != 0 }
}

// MARK: - SDK Events

public enum SC1240Event {
    case connected
    case disconnected(reason: String)
    case telemetry(SC1240Telemetry)
    case vehicleDetected(baffleAngle: Float, battery: UInt8)
    case vehicleDeparted
    case lockRaised(baffleAngle: Float)
    case lockLowered
    case error(code: String, message: String, severity: String, telemetry: SC1240Telemetry)
    case batteryLow(percent: UInt8)
    case solarCharging
    case otaProgress(percent: Int)
    case otaComplete
    case otaFailed(reason: String)
}

// MARK: - Battery Status

public struct SC1240BatteryStatus {
    public let percent:          UInt8
    public let solarCharging:    Bool
    public let isLow:            Bool
    public let isCritical:       Bool
    public var statusLabel:      String {
        if isCritical     { return "CRITICAL" }
        if isLow          { return "LOW" }
        if solarCharging  { return "CHARGING" }
        return "OK"
    }
}

// MARK: - SDK Errors

public enum SC1240SDKError: LocalizedError {
    case notConnected
    case timeout(command: SC1240Command)
    case checksumMismatch(expected: UInt8, actual: UInt8)
    case blePermissionDenied
    case deviceNotFound(uuid: UUID)
    case otaInProgress
    case batteryTooLow(percent: UInt8)
    case invalidFrame(reason: String)

    public var errorDescription: String? {
        switch self {
        case .notConnected:             return "Device not connected."
        case .timeout(let cmd):        return "Command timeout: \(cmd)"
        case .checksumMismatch(let e, let a): return "Checksum mismatch: expected 0x\(String(e, radix: 16)), got 0x\(String(a, radix: 16))"
        case .blePermissionDenied:     return "Bluetooth permission denied."
        case .deviceNotFound(let u):   return "Device not found: \(u)"
        case .otaInProgress:           return "OTA update in progress — commands blocked."
        case .batteryTooLow(let p):    return "Battery too low for OTA (\(p)%). Need ≥ 25%."
        case .invalidFrame(let r):     return "Invalid frame: \(r)"
        }
    }
}

// MARK: - Main SDK Class

@available(iOS 13.0, macOS 10.15, *)
public final class SC1240SDK: NSObject {

    // MARK: Public

    /// Combine publisher for all device events
    public let eventPublisher: AnyPublisher<SC1240Event, Never>

    public private(set) var isConnected: Bool = false
    public private(set) var lastTelemetry: SC1240Telemetry?

    // MARK: Private

    private let peripheralUUID:  UUID
    private let eventSubject    = PassthroughSubject<SC1240Event, Never>()
    private var centralManager: CBCentralManager!
    private var peripheral:     CBPeripheral?
    private var txCharacteristic: CBCharacteristic?

    private var rxBuffer        = Data()
    private var pendingCommand:  SC1240Command?
    private var commandContinuation: CheckedContinuation<SC1240Telemetry, Error>?
    private var commandTimer:    DispatchWorkItem?
    private var otaLocked       = false

    private var previousTelemetry: SC1240Telemetry?

    // MARK: Init

    public init(peripheralUUID: UUID) {
        self.peripheralUUID = peripheralUUID
        eventPublisher = eventSubject.eraseToAnyPublisher()
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: .global(qos: .userInitiated))
    }

    // MARK: - Connection

    public func connect() {
        guard centralManager.state == .poweredOn else {
            print("[SC1240] BLE not powered on — waiting...")
            return
        }
        centralManager.scanForPeripherals(withServices: [SC1240Const.bleServiceUUID], options: nil)
    }

    public func disconnect() {
        if let p = peripheral { centralManager.cancelPeripheralConnection(p) }
    }

    // MARK: - Commands

    /// Soft-reset the device
    @discardableResult
    public func resetDevice() async throws -> SC1240Telemetry {
        return try await sendCommand(.resetDevice)
    }

    /// Raise the parking baffle
    @discardableResult
    public func raiseLock() async throws -> SC1240Telemetry {
        return try await sendCommand(.raiseLock)
    }

    /// Lower the parking baffle
    @discardableResult
    public func lowerLock() async throws -> SC1240Telemetry {
        return try await sendCommand(.lowerLock)
    }

    /// Request full telemetry snapshot
    public func getStatus() async throws -> SC1240Telemetry {
        return try await sendCommand(.getStatus)
    }

    // MARK: - Power

    /// Get current battery and solar charging status
    public func getBatteryStatus() async throws -> SC1240BatteryStatus {
        let t = try await getStatus()
        return SC1240BatteryStatus(
            percent:       t.batteryPercent,
            solarCharging: t.solarCharging,
            isLow:         t.isBatteryLow,
            isCritical:    t.isBatteryCritical
        )
    }

    // MARK: - OTA

    /// Perform OTA firmware update via BLE
    public func updateFirmware(_ image: Data, onProgress: ((Int) -> Void)? = nil) async throws {
        guard !otaLocked else { throw SC1240SDKError.otaInProgress }

        // Battery safety gate
        let bat = try await getBatteryStatus()
        guard bat.percent >= 25 else { throw SC1240SDKError.batteryTooLow(percent: bat.percent) }

        otaLocked = true
        defer { otaLocked = false }

        let totalChunks = Int(ceil(Double(image.count) / Double(SC1240Const.otaChunkSize)))
        let imageCrc32  = SC1240CRC.crc32(image)

        // Begin OTA
        let beginFrame = buildOtaBeginFrame(totalChunks: totalChunks,
                                             imageSize: image.count,
                                             crc32: imageCrc32)
        try write(beginFrame)
        try await Task.sleep(nanoseconds: 500_000_000) // 500ms for erase

        // Stream chunks
        for i in 0..<totalChunks {
            let offset  = i * SC1240Const.otaChunkSize
            let end     = min(offset + SC1240Const.otaChunkSize, image.count)
            var chunk   = Data(image[offset..<end])
            if chunk.count < SC1240Const.otaChunkSize {
                chunk.append(Data(repeating: 0, count: SC1240Const.otaChunkSize - chunk.count))
            }
            let chunkCrc16 = SC1240CRC.crc16(chunk)
            let frame = buildChunkFrame(index: i, total: totalChunks,
                                         data: chunk, crc16: chunkCrc16)
            try write(frame)

            let pct = Int(((i + 1) * 100) / totalChunks)
            onProgress?(pct)
            eventSubject.send(.otaProgress(percent: pct))
            try await Task.sleep(nanoseconds: 50_000_000) // 50ms pacing
        }

        // Commit
        try write(SC1240Command.otaCommit.frame)
        try await Task.sleep(nanoseconds: 200_000_000)
        eventSubject.send(.otaComplete)
    }

    // MARK: - Internal

    private func sendCommand(_ cmd: SC1240Command) async throws -> SC1240Telemetry {
        guard isConnected, let char = txCharacteristic else { throw SC1240SDKError.notConnected }
        guard !otaLocked else { throw SC1240SDKError.otaInProgress }

        return try await withCheckedThrowingContinuation { continuation in
            self.pendingCommand        = cmd
            self.commandContinuation   = continuation

            let timer = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.commandContinuation?.resume(throwing: SC1240SDKError.timeout(command: cmd))
                self.commandContinuation = nil
            }
            self.commandTimer = timer
            DispatchQueue.global().asyncAfter(deadline: .now() + SC1240Const.defaultTimeoutSecs, execute: timer)

            peripheral?.writeValue(cmd.frame, for: char, type: .withResponse)
        }
    }

    private func write(_ data: Data) throws {
        guard let char = txCharacteristic else { throw SC1240SDKError.notConnected }
        peripheral?.writeValue(data, for: char, type: .withResponse)
    }

    private func feedRx(_ data: Data) {
        rxBuffer.append(data)
        tryParseFrame()
    }

    private func tryParseFrame() {
        while rxBuffer.count >= SC1240Const.telemetryLen {
            let preamble = rxBuffer.readUInt32BE(at: 0)
            if preamble == SC1240Const.preamble {
                let raw = rxBuffer.prefix(SC1240Const.telemetryLen)
                rxBuffer.removeFirst(SC1240Const.telemetryLen)
                if let t = parseTelemetry(Data(raw)) {
                    handleTelemetry(t)
                }
            } else {
                rxBuffer.removeFirst(1)
            }
        }
    }

    private func parseTelemetry(_ raw: Data) -> SC1240Telemetry? {
        guard raw.count >= SC1240Const.telemetryLen else { return nil }
        guard raw.readUInt32BE(at: 0) == SC1240Const.preamble else { return nil }
        guard raw.readUInt16BE(at: 4) == SC1240Const.header   else { return nil }

        // Validate XOR checksum
        var chk: UInt8 = 0
        for i in 4..<(SC1240Const.telemetryLen - 1) { chk ^= raw[i] }
        guard chk == raw[SC1240Const.telemetryLen - 1] else { return nil }

        let angleRaw = raw.readUInt16BE(at: 12)
        return SC1240Telemetry(
            lockState:       SC1240LockState(rawValue: raw[6]) ?? .unknown,
            errorFlags:      SC1240ErrorFlags(rawValue: raw[7]),
            sensorMode:      raw[8],
            batteryPercent:  raw[9],
            solarCharging:   raw[10] == 1,
            vehicleDetected: raw[11] == 1,
            baffleAngleDeg:  Float(angleRaw) / 10.0,
            timestamp:       Date()
        )
    }

    private func handleTelemetry(_ t: SC1240Telemetry) {
        let prev = previousTelemetry

        // Resolve pending command
        commandTimer?.cancel()
        commandContinuation?.resume(returning: t)
        commandContinuation = nil

        eventSubject.send(.telemetry(t))

        // Delta detection
        if prev == nil || t.vehicleDetected != prev?.vehicleDetected {
            if t.vehicleDetected {
                eventSubject.send(.vehicleDetected(baffleAngle: t.baffleAngleDeg, battery: t.batteryPercent))
            } else if prev != nil {
                eventSubject.send(.vehicleDeparted)
            }
        }

        if let p = prev, t.lockState != p.lockState {
            if t.lockState == .raised  { eventSubject.send(.lockRaised(baffleAngle: t.baffleAngleDeg)) }
            if t.lockState == .lowered { eventSubject.send(.lockLowered) }
        }

        // Error bit delta
        let prevErr = prev?.errorFlags ?? SC1240ErrorFlags(rawValue: 0)
        let newBits = SC1240ErrorFlags(rawValue: t.errorFlags.rawValue & ~prevErr.rawValue)
        for (code, msg, severity) in newBits.descriptions {
            eventSubject.send(.error(code: code, message: msg, severity: severity, telemetry: t))
        }

        // Battery low
        if (prev?.batteryPercent ?? 100) > 20 && t.batteryPercent <= 20 {
            eventSubject.send(.batteryLow(percent: t.batteryPercent))
        }

        // Solar
        if prev?.solarCharging == false && t.solarCharging {
            eventSubject.send(.solarCharging)
        }

        previousTelemetry = t
        lastTelemetry     = t
    }

    // MARK: OTA Frame Builders

    private func buildOtaBeginFrame(totalChunks: Int, imageSize: Int, crc32: UInt32) -> Data {
        var buf = Data(repeating: 0, count: 24)
        buf.writeUInt32BE(SC1240Const.preamble, at: 0)
        buf.writeUInt16BE(SC1240Const.header, at: 4)
        buf.writeUInt16BE(0x0240, at: 6)
        buf.writeUInt32BE(UInt32(totalChunks), at: 8)
        buf.writeUInt32BE(UInt32(imageSize), at: 12)
        buf.writeUInt32BE(crc32, at: 16)
        var chk: UInt8 = 0
        for i in 4..<23 { chk ^= buf[i] }
        buf[23] = chk
        return buf
    }

    private func buildChunkFrame(index: Int, total: Int, data: Data, crc16: UInt16) -> Data {
        var buf = Data(repeating: 0, count: 146)
        buf.writeUInt32BE(SC1240Const.preamble, at: 0)
        buf.writeUInt16BE(SC1240Const.header, at: 4)
        buf.writeUInt16BE(0x0241, at: 6)
        buf.writeUInt32BE(UInt32(index), at: 8)
        buf.writeUInt32BE(UInt32(total), at: 12)
        buf.replaceSubrange(16..<144, with: data)
        buf.writeUInt16BE(crc16, at: 144)
        return buf
    }
}

// MARK: - CBCentralManagerDelegate

@available(iOS 13.0, macOS 10.15, *)
extension SC1240SDK: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn { print("[SC1240] BLE powered on") }
    }

    public func centralManager(_ central: CBCentralManager,
                                didDiscover peripheral: CBPeripheral,
                                advertisementData: [String: Any],
                                rssi RSSI: NSNumber) {
        if peripheral.identifier == peripheralUUID {
            self.peripheral = peripheral
            central.stopScan()
            central.connect(peripheral, options: nil)
        }
    }

    public func centralManager(_ central: CBCentralManager,
                                didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([SC1240Const.bleServiceUUID])
    }

    public func centralManager(_ central: CBCentralManager,
                                didDisconnectPeripheral peripheral: CBPeripheral,
                                error: Error?) {
        isConnected = false
        eventSubject.send(.disconnected(reason: error?.localizedDescription ?? "User disconnected"))
    }
}

// MARK: - CBPeripheralDelegate

@available(iOS 13.0, macOS 10.15, *)
extension SC1240SDK: CBPeripheralDelegate {
    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverServices error: Error?) {
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics([SC1240Const.bleCharacteristic], for: service)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didDiscoverCharacteristicsFor service: CBService,
                           error: Error?) {
        for char in service.characteristics ?? [] where char.uuid == SC1240Const.bleCharacteristic {
            self.txCharacteristic = char
            peripheral.setNotifyValue(true, for: char)
            isConnected = true
            eventSubject.send(.connected)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral,
                           didUpdateValueFor characteristic: CBCharacteristic,
                           error: Error?) {
        if let data = characteristic.value { feedRx(data) }
    }
}

// MARK: - CRC Utilities

public struct SC1240CRC {
    public static func crc16(_ data: Data) -> UInt16 {
        var crc: UInt16 = 0xFFFF
        for byte in data {
            crc ^= UInt16(byte) << 8
            for _ in 0..<8 {
                crc = (crc & 0x8000) != 0 ? (crc << 1) ^ 0x1021 : crc << 1
            }
        }
        return crc
    }

    public static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        let table = buildTable()
        for byte in data { crc = (crc >> 8) ^ table[Int((crc ^ UInt32(byte)) & 0xFF)] }
        return crc ^ 0xFFFFFFFF
    }

    private static func buildTable() -> [UInt32] {
        (0..<256).map { i -> UInt32 in
            var c = UInt32(i)
            for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
            return c
        }
    }
}

// MARK: - Data Extensions

extension Data {
    func readUInt32BE(at offset: Int) -> UInt32 {
        UInt32(self[offset]) << 24 | UInt32(self[offset+1]) << 16
              | UInt32(self[offset+2]) << 8 | UInt32(self[offset+3])
    }
    func readUInt16BE(at offset: Int) -> UInt16 {
        UInt16(self[offset]) << 8 | UInt16(self[offset+1])
    }
    mutating func writeUInt32BE(_ val: UInt32, at offset: Int) {
        self[offset]   = UInt8((val >> 24) & 0xFF)
        self[offset+1] = UInt8((val >> 16) & 0xFF)
        self[offset+2] = UInt8((val >>  8) & 0xFF)
        self[offset+3] = UInt8( val        & 0xFF)
    }
    mutating func writeUInt16BE(_ val: UInt16, at offset: Int) {
        self[offset]   = UInt8((val >> 8) & 0xFF)
        self[offset+1] = UInt8( val       & 0xFF)
    }
}
