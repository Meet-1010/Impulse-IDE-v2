/**
 * Modules, sensors and actuators people wire to Arduino-compatible boards:
 * how they connect, their supply and logic voltage, I2C addresses, the
 * library to use, and the mistakes that make them "not work". Addresses are
 * 7-bit, as Wire and I2C scanners print them.
 */

const COMPONENTS = [
  // ── Displays ──────────────────────────────────────────────────────────────
  {
    id: 'ssd1306', names: ['SSD1306', 'OLED 128x64', 'OLED 128x32', '0.96 inch OLED', '0.91 inch OLED'],
    interface: 'I2C (most modules) or SPI', voltage: '3.3–5 V modules (onboard regulator)', i2c: ['0x3C', '0x3D'],
    library: 'Adafruit SSD1306 + Adafruit GFX, or U8g2',
    notes: [
      'display.begin(SSD1306_SWITCHCAPVCC, 0x3C) returns false when it can\'t allocate its 1 KB frame buffer (128×64): on an Uno that is half the RAM, so check the return value and trim other RAM use.',
      'Call display.display() after drawing; nothing appears until then.',
      'A 1.3" OLED is usually an SH1106, not an SSD1306 (see SH1106).',
    ],
  },
  {
    id: 'sh1106', names: ['SH1106', '1.3 inch OLED'], interface: 'I2C or SPI', voltage: '3.3–5 V modules', i2c: ['0x3C'],
    library: 'U8g2 (U8G2_SH1106_128X64_NONAME_F_HW_I2C) or Adafruit SH110X',
    notes: ['Driving it with the SSD1306 library shows a shifted image with a stripe of noise: use an SH1106 driver.'],
  },
  {
    id: 'lcd-i2c', names: ['LCD 16x2 I2C', 'LCD 20x4 I2C', 'LCD1602 I2C', 'LCD2004', 'PCF8574 LCD backpack', 'LiquidCrystal I2C'],
    interface: 'I2C (PCF8574 backpack)', voltage: '5 V (backlight and contrast need 5 V)', i2c: ['0x27 (PCF8574T)', '0x3F (PCF8574AT)'],
    library: 'LiquidCrystal I2C (Frank de Brabander) or hd44780',
    notes: [
      'Blank screen or only blocks: turn the contrast potentiometer on the backpack.',
      'Wrong address is the most common fault: run an I2C scanner (0x27 vs 0x3F).',
      'The backpack runs from 5 V and its pull-ups hold SDA/SCL at 5 V, which 3.3 V-only boards (ESP32, RP2040, SAMD) must not see: use an I2C level shifter, or remove the backpack\'s pull-up resistors and pull up to 3.3 V instead.',
    ],
  },
  {
    id: 'lcd-parallel', names: ['LCD 16x2', 'HD44780', 'LCD1602 parallel'], interface: '4-bit parallel (RS, E, D4–D7)', voltage: '5 V',
    library: 'LiquidCrystal (built in)',
    notes: ['Needs a 10 kΩ potentiometer on V0 for contrast and RW tied to GND. LiquidCrystal lcd(rs, en, d4, d5, d6, d7).'],
  },
  {
    id: 'ili9341', names: ['ILI9341', 'TFT 2.4', 'TFT 2.8', 'TFT 3.2', 'ST7789', 'ST7735', 'TFT display'],
    interface: 'SPI (+ DC, RST, CS; touch adds XPT2046 on SPI)', voltage: '3.3 V logic; many modules have a 5 V→3.3 V regulator for power only',
    library: 'TFT_eSPI (fastest on ESP32/RP2040; configure User_Setup.h) or Adafruit ILI9341/ST7789 + GFX',
    notes: ['On 5 V Arduinos the data lines need level shifting or series resistors. A white screen usually means wrong pins or driver in the library setup.'],
  },
  {
    id: 'epaper', names: ['e-paper', 'e-ink', 'Waveshare e-paper', 'GDEW', 'GDEY'], interface: 'SPI + DC, RST, BUSY', voltage: '3.3 V',
    library: 'GxEPD2 (pick the exact panel class)',
    notes: ['A full refresh takes seconds and flashes; partial refresh only on panels that support it. The wrong panel class gives garbage or no update.'],
  },
  {
    id: 'max7219', names: ['MAX7219', 'LED matrix 8x8', 'dot matrix', '7-segment MAX7219'], interface: 'SPI-like (DIN, CS, CLK)', voltage: '5 V',
    library: 'MD_Parola + MD_MAX72XX (scrolling text) or LedControl',
    notes: ['Set the hardware type in MD_MAX72XX (FC16_HW for most cheap modules) or the text appears mirrored or rotated.'],
  },
  {
    id: 'tm1637', names: ['TM1637', '4-digit 7-segment display'], interface: '2-wire CLK/DIO (not I2C)', voltage: '3.3–5 V',
    library: 'TM1637Display (Avishay Orpaz)',
    notes: ['Any two digital pins work; it does not use the I2C pins or an address.'],
  },
  {
    id: 'seven-segment', names: ['7-segment display', 'seven segment'], interface: '8 GPIO pins (or a 74HC595)', voltage: 'any',
    library: 'SevSeg',
    notes: ['Common anode vs common cathode inverts the logic. One resistor per segment (220–330 Ω at 5 V).'],
  },
  // ── Environment sensors ───────────────────────────────────────────────────
  {
    id: 'dht', names: ['DHT11', 'DHT22', 'AM2302', 'temperature humidity sensor'], interface: 'proprietary 1-wire', voltage: '3.3–5 V',
    library: 'DHT sensor library (Adafruit) + Adafruit Unified Sensor',
    notes: [
      'Needs a 4.7–10 kΩ pull-up on DATA (3-pin modules include it).',
      'Read no more often than once per second (DHT11) or every two seconds (DHT22); faster reads return NaN.',
      'readTemperature() returns NaN on a failed read: check isnan() before using it.',
    ],
  },
  {
    id: 'ds18b20', names: ['DS18B20', 'Dallas temperature', '1-Wire temperature', 'waterproof temperature probe'], interface: '1-Wire', voltage: '3.0–5.5 V',
    library: 'OneWire + DallasTemperature',
    notes: [
      'Needs a 4.7 kΩ pull-up from DQ to VCC (bare sensors and probes don\'t have one).',
      '-127 °C means the sensor isn\'t found (wiring or missing pull-up); 85 °C is the power-on value read before a conversion finished.',
      'A 12-bit conversion takes 750 ms. Several sensors share one pin, each with its own 64-bit address.',
    ],
  },
  {
    id: 'bme280', names: ['BME280', 'BMP280', 'BME680', 'pressure sensor', 'barometer'], interface: 'I2C or SPI', voltage: '3.3 V chip; many modules add a regulator', i2c: ['0x76 (SDO to GND)', '0x77 (SDO to VCC)'],
    library: 'Adafruit BME280 / Adafruit BMP280 / Adafruit BME680 (or BSEC for the BME680 air-quality index)',
    notes: ['A BMP280 has no humidity: chip ID 0x58 (BMP280) vs 0x60 (BME280); a "BME280" that won\'t initialise with the BME280 library is often a BMP280.', 'begin(0x76) vs begin(0x77): try both.'],
  },
  {
    id: 'bmp180', names: ['BMP180', 'BMP085'], interface: 'I2C', voltage: '3.3 V (modules regulate)', i2c: ['0x77'], library: 'Adafruit BMP085 Library', notes: [],
  },
  {
    id: 'aht20', names: ['AHT20', 'AHT10', 'AHT21'], interface: 'I2C', voltage: '2.2–5.5 V', i2c: ['0x38'], library: 'Adafruit AHTX0', notes: [],
  },
  {
    id: 'sht3x', names: ['SHT31', 'SHT30', 'SHT35', 'SHT40', 'SHT41', 'SHT45'], interface: 'I2C', voltage: '2.4–5.5 V (SHT3x), 1.08–3.6 V (SHT4x)', i2c: ['0x44', '0x45'],
    library: 'Adafruit SHT31 / Adafruit SHT4x', notes: ['SHT4x is a 3.3 V part: check the module has a regulator before using 5 V.'],
  },
  {
    id: 'scd4x', names: ['SCD40', 'SCD41', 'CO2 sensor', 'SCD30'], interface: 'I2C', voltage: '2.4–5.5 V', i2c: ['0x62 (SCD4x)', '0x61 (SCD30)'],
    library: 'Sensirion I2C SCD4x', notes: ['Needs a few seconds per measurement and periodic fresh-air calibration.'],
  },
  {
    id: 'mq-gas', names: ['MQ-2', 'MQ-135', 'MQ-7', 'MQ-3', 'gas sensor', 'smoke sensor'], interface: 'analog (AO) + digital threshold (DO)', voltage: '5 V heater (~150 mA)',
    library: 'none needed (analogRead), MQUnifiedsensor for ppm estimates',
    notes: ['Readings are relative, not calibrated ppm. Needs a burn-in (24 h+) and minutes of warm-up. The heater draws ~150 mA: don\'t power several from a board pin. AO can exceed 3.3 V: divide it on 3.3 V boards.'],
  },
  {
    id: 'soil-moisture', names: ['soil moisture sensor', 'capacitive soil moisture', 'YL-69', 'FC-28'], interface: 'analog', voltage: '3.3–5 V',
    notes: ['Resistive probes (YL-69/FC-28) corrode within weeks if powered all the time: power them from a pin only while reading. Capacitive v1.2 probes last; calibrate dry and wet values.'],
  },
  {
    id: 'ldr', names: ['LDR', 'photoresistor', 'light dependent resistor'], interface: 'analog (voltage divider)', voltage: 'any',
    notes: ['Pair it with a 10 kΩ resistor as a divider into an analog pin. For lux values use a BH1750.'],
  },
  {
    id: 'bh1750', names: ['BH1750', 'GY-302', 'light sensor lux'], interface: 'I2C', voltage: '3.3–5 V modules', i2c: ['0x23 (ADDR low)', '0x5C (ADDR high)'], library: 'BH1750 (Christopher Laws)', notes: [],
  },
  // ── Motion, distance, position ────────────────────────────────────────────
  {
    id: 'hc-sr04', names: ['HC-SR04', 'ultrasonic sensor', 'distance sensor ultrasonic'], interface: 'TRIG (10 µs pulse) + ECHO (pulse width)', voltage: '5 V',
    library: 'none needed (pulseIn) or NewPing',
    notes: [
      'distance cm ≈ echo µs / 58. Use pulseIn(echo, HIGH, 30000) with a timeout so a missed echo doesn\'t block for a second.',
      'ECHO outputs 5 V: on 3.3 V boards (ESP32, RP2040…) use a divider (e.g. 1 kΩ / 2 kΩ) or the HC-SR04P / RCWL-1601, which run at 3.3 V.',
      'Range about 2–400 cm; soft or angled surfaces return no echo.',
    ],
  },
  {
    id: 'vl53l0x', names: ['VL53L0X', 'VL53L1X', 'time of flight', 'ToF sensor', 'laser distance'], interface: 'I2C + XSHUT', voltage: '2.6–5 V modules', i2c: ['0x29'],
    library: 'Adafruit VL53L0X / Pololu VL53L1X',
    notes: ['Several on one bus: hold all but one in reset with XSHUT and give each a new address in turn.'],
  },
  {
    id: 'pir', names: ['PIR', 'HC-SR501', 'AM312', 'motion sensor'], interface: 'digital output', voltage: 'HC-SR501: 5–20 V supply, 3.3 V output; AM312: 2.7–12 V',
    notes: ['Needs about a minute to settle after power-up. On the HC-SR501 the two potentiometers set delay and sensitivity, and the jumper selects single or repeat trigger.'],
  },
  {
    id: 'mpu6050', names: ['MPU6050', 'MPU-6050', 'GY-521', 'accelerometer gyroscope', 'IMU'], interface: 'I2C (+ INT)', voltage: '3.3 V chip; GY-521 has a regulator', i2c: ['0x68 (AD0 low)', '0x69 (AD0 high)'],
    library: 'Adafruit MPU6050, or MPU6050 by Electronic Cats (DMP)',
    notes: ['A value of 0x70/0x72 from WHO_AM_I means a clone (MPU6500/MPU9250 family): some libraries refuse it; MPU6050_light or the Electronic Cats library may still work.'],
  },
  {
    id: 'adxl345', names: ['ADXL345', 'GY-291'], interface: 'I2C or SPI', voltage: '2.0–3.6 V (modules regulate)', i2c: ['0x53 (SDO low)', '0x1D (SDO high)'], library: 'Adafruit ADXL345', notes: [],
  },
  {
    id: 'lis3dh', names: ['LIS3DH'], interface: 'I2C or SPI', voltage: '1.7–3.6 V', i2c: ['0x18', '0x19'], library: 'Adafruit LIS3DH', notes: [],
  },
  {
    id: 'compass', names: ['HMC5883L', 'QMC5883L', 'GY-273', 'compass', 'magnetometer'], interface: 'I2C', voltage: '3.3–5 V modules', i2c: ['0x1E (HMC5883L)', '0x0D (QMC5883L)'],
    library: 'QMC5883LCompass or Adafruit HMC5883 Unified',
    notes: ['Most cheap "HMC5883L" boards carry a QMC5883L (address 0x0D) and need the QMC library. Calibrate for hard-iron offsets.'],
  },
  {
    id: 'rotary-encoder', names: ['rotary encoder', 'KY-040', 'EC11'], interface: 'CLK (A), DT (B), SW (button)', voltage: '3.3–5 V',
    library: 'Encoder (Paul Stoffregen) or RotaryEncoder',
    notes: ['Read A/B on interrupt-capable pins for fast turns; use INPUT_PULLUP if the module has no resistors; debounce or use a state-table decoder.'],
  },
  {
    id: 'joystick', names: ['joystick module', 'KY-023', 'thumb joystick'], interface: '2 analog + 1 digital', voltage: '3.3–5 V (VRx/VRy follow the supply)',
    notes: ['The button (SW) needs INPUT_PULLUP. Centre reads about half scale; add a dead zone.'],
  },
  {
    id: 'keypad', names: ['keypad 4x4', 'keypad 4x3', 'membrane keypad', 'matrix keypad'], interface: 'rows and columns (7–8 GPIO)', voltage: 'any',
    library: 'Keypad (Mark Stanley, Alexander Brevig)', notes: ['Row/column order on the ribbon varies: if keys are swapped, swap the pin arrays.'],
  },
  {
    id: 'button', names: ['push button', 'tactile switch', 'button'], interface: 'digital', voltage: 'any',
    notes: ['Wire it between the pin and GND with pinMode(pin, INPUT_PULLUP): it reads LOW when pressed. Debounce (20–50 ms).'],
  },
  {
    id: 'potentiometer', names: ['potentiometer', 'pot', 'trimmer'], interface: 'analog', voltage: 'connect the ends to GND and the board\'s ADC reference voltage',
    notes: ['On 3.3 V boards connect the end to 3.3 V, not 5 V. 10 kΩ is a good value.'],
  },
  // ── Actuators ─────────────────────────────────────────────────────────────
  {
    id: 'servo', names: ['servo', 'SG90', 'MG90S', 'MG996R', 'micro servo'], interface: 'PWM pulse (500–2500 µs, 50 Hz)', voltage: '4.8–6 V supply',
    library: 'Servo (AVR, SAMD, Renesas, RP2040), ESP32Servo on ESP32',
    notes: [
      'Power servos from a separate 5–6 V supply (SG90 stalls at ~650 mA, MG996R at ~2.5 A) with a common ground; powering them from the board\'s 5 V pin causes resets.',
      'On the Uno the Servo library disables PWM on pins 9 and 10. For many servos use a PCA9685 board.',
    ],
  },
  {
    id: 'pca9685', names: ['PCA9685', '16 channel servo driver', 'PWM driver'], interface: 'I2C', voltage: 'logic 3.3–5 V; servos on V+ (separate)', i2c: ['0x40 (default, A0–A5 add up to 0x7F)', '0x70 (all-call)'],
    library: 'Adafruit PWM Servo Driver', notes: ['setPWMFreq(50) for servos. Servo power goes to the screw terminal, not the logic VCC.'],
  },
  {
    id: 'stepper-28byj48', names: ['28BYJ-48', 'ULN2003', 'small stepper motor'], interface: '4 GPIO through a ULN2003 driver', voltage: '5 V motor (12 V version exists)',
    library: 'AccelStepper (HALF4WIRE) or Stepper',
    notes: ['2048 full steps per output revolution (gearbox ~1:64). With the Stepper library pass the pins in the order IN1, IN3, IN2, IN4 or it only buzzes. Max ~15 rpm.'],
  },
  {
    id: 'stepper-driver', names: ['A4988', 'DRV8825', 'TMC2208', 'TMC2209', 'NEMA 17', 'stepper driver'], interface: 'STEP + DIR (+ EN, MS1–MS3)', voltage: 'motor 8–35 V (A4988) / 8.2–45 V (DRV8825); logic 3.3–5 V',
    library: 'AccelStepper (DRIVER mode), TMCStepper for UART setup of TMC22xx',
    notes: [
      'Set the current limit with the Vref potentiometer before connecting the motor.',
      'Put a 100 µF capacitor across VMOT and GND, and never connect or disconnect the motor while powered (it destroys the driver).',
      'Microstepping pins multiply steps per revolution (200 full steps for a 1.8° NEMA 17).',
    ],
  },
  {
    id: 'dc-motor-driver', names: ['L298N', 'L293D', 'TB6612FNG', 'DRV8833', 'motor driver', 'H-bridge'], interface: 'IN1/IN2 per motor + EN (PWM)', voltage: 'motor supply per driver; logic 3.3–5 V',
    library: 'none needed (digitalWrite + analogWrite on EN)',
    notes: [
      'L298N loses about 2 V and gets hot; TB6612FNG or DRV8833 are far more efficient for small motors.',
      'Remove the ENA/ENB jumpers to control speed with PWM. The L298N\'s 5 V regulator jumper only works with a motor supply up to 12 V.',
      'Share ground between the driver and the board.',
    ],
  },
  {
    id: 'relay', names: ['relay module', 'relay', 'SRD-05VDC'], interface: 'digital IN', voltage: 'coil 5 V (or 12 V) module',
    notes: [
      'Most modules are active-LOW: LOW energises the relay. Set the pin HIGH before pinMode(OUTPUT) to avoid a click at boot.',
      '5 V modules may not switch reliably from 3.3 V logic; optocoupled modules can be powered from JD-VCC separately.',
      'Mains voltage is dangerous: use enclosed, rated modules and never touch the switched side.',
    ],
  },
  {
    id: 'buzzer', names: ['buzzer', 'piezo', 'active buzzer', 'passive buzzer'], interface: 'digital / tone()', voltage: '3.3–5 V',
    notes: ['Active buzzers beep on HIGH; passive ones need tone(pin, frequency). On the Uno, tone() takes Timer2 (no PWM on 3 and 11). On ESP32 core 2.x use ledcWriteTone or core 3.x tone().'],
  },
  {
    id: 'neopixel', names: ['WS2812B', 'WS2812', 'NeoPixel', 'SK6812', 'addressable LED strip', 'RGB LED strip'], interface: 'single data line', voltage: '5 V (strip power)',
    library: 'Adafruit NeoPixel or FastLED',
    notes: [
      'Each LED draws up to ~60 mA at full white: 60 LEDs can need 3.6 A. Power the strip directly, not through the board, and limit brightness.',
      'Put a 300–500 Ω resistor in the data line and a 1000 µF capacitor across the strip supply.',
      'From a 3.3 V board the data signal is marginal for 5 V strips: a 74AHCT125 level shifter (or powering the first LED slightly lower) makes it reliable.',
      'Call strip.show() after setting colours.',
    ],
  },
  {
    id: 'shift-register', names: ['74HC595', 'shift register'], interface: 'DS/SER, SHCP/SRCLK, STCP/RCLK (+ OE, MR)', voltage: '2–6 V',
    library: 'none needed (shiftOut) or ShiftRegister74HC595',
    notes: ['Tie OE to GND and MR to VCC. Latch (RCLK) LOW, shiftOut, then latch HIGH. Daisy-chain through Q7\'.'],
  },
  {
    id: 'led', names: ['LED'], interface: 'digital or PWM', voltage: 'forward voltage ~2 V red/yellow, ~3 V blue/white/green',
    notes: ['Always use a series resistor (220–330 Ω at 5 V, ~100 Ω at 3.3 V). The long leg is the anode (+).'],
  },
  // ── Communication and storage ─────────────────────────────────────────────
  {
    id: 'nrf24l01', names: ['nRF24L01', 'NRF24', '2.4 GHz radio'], interface: 'SPI + CE, CSN', voltage: '1.9–3.6 V ONLY (pins are 5 V tolerant)',
    library: 'RF24 (TMRh20)',
    notes: ['Powering it from 5 V destroys it. Add a 10 µF capacitor across VCC/GND at the module; the PA+LNA version needs a strong 3.3 V supply (an adapter board helps).'],
  },
  {
    id: 'mfrc522', names: ['MFRC522', 'RC522', 'RFID reader', 'RFID-RC522'], interface: 'SPI (+ RST)', voltage: '3.3 V supply',
    library: 'MFRC522 (miguelbalboa)',
    notes: ['Power from 3.3 V, never 5 V. Reads MIFARE Classic 13.56 MHz cards and tags; the UID read is not a secure authentication.'],
  },
  {
    id: 'pn532', names: ['PN532', 'NFC module'], interface: 'I2C, SPI or UART (DIP switches)', voltage: '3.3–5 V modules', i2c: ['0x24'],
    library: 'Adafruit PN532', notes: ['Set the mode switches to match the interface used.'],
  },
  {
    id: 'hc05', names: ['HC-05', 'HC-06', 'Bluetooth module classic'], interface: 'UART', voltage: '3.6–6 V supply; RX pin is 3.3 V logic',
    notes: ['Divide the Arduino TX (5 V) down to the module\'s RX. HC-06 defaults to 9600 baud; HC-05 AT mode is 38400 (hold the KEY/EN button at power-up). Classic Bluetooth: iPhones can\'t use it (BLE only).'],
  },
  {
    id: 'gps', names: ['NEO-6M', 'NEO-M8N', 'GPS module', 'GY-NEO6MV2'], interface: 'UART (NMEA)', voltage: '3.3–5 V modules, 3.3 V logic',
    library: 'TinyGPSPlus',
    notes: ['9600 baud by default. A cold start outdoors takes a minute or more; indoors it may never fix. Feed every byte to gps.encode() in loop.'],
  },
  {
    id: 'sim800', names: ['SIM800L', 'SIM800', 'GSM module'], interface: 'UART (AT commands)', voltage: '3.4–4.4 V with 2 A peaks',
    notes: ['Not 5 V and not 3.3 V: a Li-ion cell or a 4 V buck converter rated for 2 A bursts. Most "it keeps resetting" problems are the supply. 2G networks are shut down in many countries.'],
  },
  {
    id: 'sd-card', names: ['SD card module', 'micro SD module', 'SD card'], interface: 'SPI', voltage: 'card is 3.3 V; modules with a regulator + level shifter take 5 V',
    library: 'SD (built in) or SdFat',
    notes: ['FAT16/FAT32 only (format cards ≤32 GB as FAT32). Pass the CS pin to SD.begin(cs). Bare adapters without level shifting are 3.3 V only. Short wires.'],
  },
  {
    id: 'eeprom-i2c', names: ['AT24C32', 'AT24C256', '24LC256', 'I2C EEPROM'], interface: 'I2C', voltage: '1.8–5.5 V', i2c: ['0x50–0x57'],
    library: 'none needed (Wire) or SparkFun External EEPROM', notes: ['Writes are page-based (32/64 bytes) and need ~5 ms each.'],
  },
  {
    id: 'rtc', names: ['DS3231', 'DS1307', 'RTC', 'real time clock'], interface: 'I2C', voltage: 'DS3231 2.3–5.5 V; DS1307 5 V', i2c: ['0x68 (+ 0x57 for the EEPROM on ZS-042 boards)'],
    library: 'RTClib (Adafruit)',
    notes: ['DS3231 is temperature-compensated and accurate; the DS1307 drifts minutes per month and needs 5 V. Some ZS-042 boards charge a non-rechargeable CR2032: remove the charging resistor/diode.'],
  },
  {
    id: 'ethernet-w5500', names: ['W5500', 'W5100', 'Ethernet module', 'Ethernet shield'], interface: 'SPI', voltage: '3.3 V (shields regulate)',
    library: 'Ethernet (built in)', notes: ['Call Ethernet.init(csPin) when CS isn\'t pin 10.'],
  },
  {
    id: 'can', names: ['MCP2515', 'CAN bus module', 'TJA1050', 'SN65HVD230'], interface: 'SPI (MCP2515) or built-in TWAI on ESP32 + transceiver', voltage: 'MCP2515 module 5 V; SN65HVD230 3.3 V',
    library: 'mcp_can or autowp arduino-mcp2515; ESP32: ESP32-TWAI-CAN or the core TWAI driver',
    notes: ['Set the crystal frequency in code (8 MHz on most cheap boards). The bus needs 120 Ω termination at both ends.'],
  },
  {
    id: 'rs485', names: ['MAX485', 'RS485', 'Modbus'], interface: 'UART + DE/RE', voltage: '5 V (MAX485); MAX3485 for 3.3 V',
    library: 'ModbusMaster for Modbus RTU', notes: ['Tie DE and RE together to one pin: HIGH to send, LOW to receive.'],
  },
  // ── Measurement ──────────────────────────────────────────────────────────
  {
    id: 'hx711', names: ['HX711', 'load cell amplifier', 'load cell', 'scale'], interface: 'DT + SCK (2 GPIO)', voltage: '2.6–5.5 V',
    library: 'HX711 (Bogdan Necula) or HX711_ADC',
    notes: ['Calibrate with a known weight (set_scale), tare at startup. Keep wires short and away from motors; readings drift with temperature.'],
  },
  {
    id: 'ads1115', names: ['ADS1115', 'ADS1015', 'external ADC'], interface: 'I2C', voltage: '2.0–5.5 V', i2c: ['0x48', '0x49', '0x4A', '0x4B (ADDR pin)'],
    library: 'Adafruit ADS1X15', notes: ['Inputs must stay between GND and VDD + 0.3 V whatever the gain setting.'],
  },
  {
    id: 'ina219', names: ['INA219', 'INA226', 'current sensor I2C'], interface: 'I2C', voltage: '3–5.5 V', i2c: ['0x40–0x4F'],
    library: 'Adafruit INA219', notes: ['High-side sensing: the load current flows through VIN+ → VIN−; the default shunt is 0.1 Ω (3.2 A max).'],
  },
  {
    id: 'acs712', names: ['ACS712', 'current sensor'], interface: 'analog', voltage: '5 V',
    notes: ['Output is 2.5 V at zero current (5 V supply); 185/100/66 mV per amp for 5/20/30 A versions. On 3.3 V boards divide the output.'],
  },
  {
    id: 'thermocouple', names: ['MAX6675', 'MAX31855', 'thermocouple', 'K-type'], interface: 'SPI (read-only)', voltage: '3.0–5.5 V (MAX6675)',
    library: 'max6675 (Adafruit) / Adafruit MAX31855', notes: ['Read at most every ~250 ms. Thermocouple polarity matters.'],
  },
  {
    id: 'pulse-oximeter', names: ['MAX30102', 'MAX30100', 'pulse oximeter', 'heart rate sensor'], interface: 'I2C', voltage: '3.3 V logic (some modules 1.8 V pull-ups)', i2c: ['0x57'],
    library: 'SparkFun MAX3010x', notes: ['Some purple modules pull I2C up to 1.8 V and fail on 5 V boards. Not a medical device.'],
  },
  {
    id: 'mlx90614', names: ['MLX90614', 'IR thermometer', 'contactless temperature'], interface: 'I2C (SMBus)', voltage: '3.3 V or 5 V versions', i2c: ['0x5A'], library: 'Adafruit MLX90614', notes: [],
  },
  // ── I/O expansion, audio ─────────────────────────────────────────────────
  {
    id: 'io-expander', names: ['PCF8574', 'MCP23017', 'I/O expander', 'GPIO expander'], interface: 'I2C', voltage: '2.5–5.5 V (PCF8574), 1.8–5.5 V (MCP23017)',
    i2c: ['0x20–0x27 (PCF8574, MCP23017)', '0x38–0x3F (PCF8574A)'], library: 'Adafruit MCP23017 / PCF8574 (Rob Tillaart)',
    notes: ['PCF8574 outputs are weak HIGH (quasi-bidirectional): sink current, don\'t source it.'],
  },
  {
    id: 'i2s-audio', names: ['MAX98357A', 'INMP441', 'I2S amplifier', 'I2S microphone', 'PCM5102'], interface: 'I2S (BCLK, LRCLK/WS, DIN/DOUT)', voltage: '3.3 V logic',
    library: 'ESP32 I2S (core), ESP8266Audio / arduino-audio-tools',
    notes: ['Needs a board with I2S (ESP32, RP2040 via PIO, SAMD51). Not available on the Uno.'],
  },
  {
    id: 'ir-receiver', names: ['IR receiver', 'VS1838B', 'TSOP38238', 'IR remote', 'KY-022'], interface: 'digital (demodulated 38 kHz)', voltage: '2.7–5.5 V',
    library: 'IRremote (v4: IrReceiver.begin(pin); IrReceiver.decode(); IrReceiver.decodedIRData; IrReceiver.resume())',
    notes: ['Examples written for IRremote 2.x (IRrecv irrecv(pin); decode(&results)) no longer compile with 4.x: rewrite to the IrReceiver API.'],
  },
  {
    id: 'mosfet', names: ['MOSFET', 'IRLZ44N', 'IRF520', 'transistor switch', 'TIP120', '2N2222'], interface: 'gate/base from a GPIO', voltage: 'load side as rated',
    notes: ['Use a logic-level MOSFET (IRLZ44N, AO3400) from 3.3/5 V pins; the IRF520/IRFZ44N need ~10 V on the gate to switch fully. Add a 100–220 Ω gate resistor and a 10 kΩ pull-down, and a flyback diode across motors, relays and solenoids.'],
  },
];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Components matching a query (name, part number, I2C address, or kind), best first. */
function findComponents(query, limit = 4) {
  const q = norm(query);
  if (!q) return [];
  const addr = /^0x([0-9a-f]{2})$/i.exec(String(query).trim());
  const scored = [];
  for (const c of COMPONENTS) {
    let score = 0;
    for (const name of [c.id, ...c.names]) {
      const n = norm(name);
      if (n === q) score = Math.max(score, 100);
      else if (n.includes(q) || q.includes(n)) score = Math.max(score, 60 + Math.min(n.length, q.length));
    }
    if (addr && (c.i2c || []).some((a) => a.toLowerCase().includes(`0x${addr[1].toLowerCase()}`))) score = Math.max(score, 90);
    if (!score && norm(c.interface).includes(q)) score = 10;
    if (score) scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, c]) => c);
}

function componentText(c) {
  const lines = [`# ${c.names[0]}${c.names.length > 1 ? ` (${c.names.slice(1, 5).join(', ')})` : ''}`, `- Interface: ${c.interface}`, `- Voltage: ${c.voltage}`];
  if (c.i2c?.length) lines.push(`- I2C address: ${c.i2c.join(' or ')}`);
  if (c.library) lines.push(`- Library: ${c.library}`);
  for (const n of c.notes || []) lines.push(`- ${n}`);
  return lines.join('\n');
}

module.exports = { COMPONENTS, findComponents, componentText };
