// Probe: Nano Every (Serial1 on 0/1, no old timer registers used).
#include <Arduino.h>
#include <Wire.h>
#include <Servo.h>
Servo s;
void setup() { Serial.begin(115200); Serial1.begin(9600); Wire.begin(); s.attach(9); pinMode(LED_BUILTIN, OUTPUT); }
void loop() { s.write(analogRead(A0) / 6); digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(200); }
