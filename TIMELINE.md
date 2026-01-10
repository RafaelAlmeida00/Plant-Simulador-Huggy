# TIMELINE.md - Tracking Edits by IA Model

> This document provides Claude with essential context about the tracking befores edits.

---

## Structure

ID PROBLEM RESOLVE 0++
1) Date | hh:mm:ss
2) Main problem
3) Details about what you thought to discover the origin of the problem and what is the default behavior intend
4) Source Problem: File | path | function | line(s)
5) Flow until the problem
6) Details about what you thought to solve the problem at its source.
7) Add or Edit for resolve problem: File | Path | Function
8) New flow with the problem resolve

---

## ID 001 - OEE and MTTR/MTBF Calculation Implementation
1) 2026-01-09 | ~08:15:00
2) **Main problem**: `calculateOEE()` and `calculateMTTRMTBF()` methods in SimulationFlow were incomplete/stub implementations
3) **Analysis**:
   - The methods existed but had incomplete code with syntax errors
   - OEE calculation needed to iterate lines, aggregate to shops
   - Production time for shops = average of lines' production times
   - Station production time = same as their line's production time
   - MTTR/MTBF needed to aggregate from station → line → shop
4) **Source Problem**: `src/app/SimulationFlow.ts` | `calculateOEE()` lines 913-953 | `calculateMTTRMTBF()` line 955-956
5) **Flow before**:
   - `SimulationFlow.execute()` called `calculateOEE()` and `calculateMTTRMTBF()`
   - Both methods were stubs/incomplete, not producing valid calculations
6) **Solution approach**:
   - For OEE: Iterate all lines, get `productionTimeMinutes` from each line, calculate shop average, use OEEFactory methods
   - For MTTR/MTBF: Calculate per station first, aggregate to line using MTTRMTBFFactory, then aggregate lines to shop
   - Added proper imports for `MTTRMTBFCalculationInput`, `MTTRMTBFData`, `OEEData`, `IShop`
7) **Files edited**:
   - `src/app/SimulationFlow.ts` | Line 8 (imports) | Lines 913-1033 (`calculateOEE` and `calculateMTTRMTBF`)
8) **New flow**:
   ```
   SimulationFlow.execute()
          │
          ├──► calculateOEE()
          │       ├──► For each Line: oeeFactory.calculateLineOEE(input, isDynamic=true)
          │       └──► For each Shop: oeeFactory.calculateShopOEE(input, isDynamic=true)
          │
          └──► calculateMTTRMTBF()
                  ├──► For each Station: mttrmtbfFactory.calculateStationMTTRMTBF(input)
                  ├──► For each Line: mttrmtbfFactory.calculateLineMTTRMTBF(stationData)
                  └──► For each Shop: mttrmtbfFactory.calculateShopMTTRMTBF(lineData)
   ```

---

## ID 002 - CARS_STATE WebSocket Emission Fix
1) 2026-01-09 | ~09:00:00
2) **Main problem**: `CARS_STATE` was not being emitted every 10 seconds via WebSocket as expected
3) **Analysis**:
   - The `emitCars()` method in SimulationEventEmitter was sharing `lastBufferEmit` variable with `emitAllBuffers()`
   - When `emitAllBuffers()` was called, it updated `lastBufferEmit`, causing `emitCars()` to skip emission
   - No dedicated `CARS_EMIT_INTERVAL` config existed in flowPlant
   - The throttling logic was conflating buffer and cars emissions
4) **Source Problem**: `src/app/SimulationEventEmitter.ts` | `emitCars()` lines 53-63 | using `lastBufferEmit` instead of own variable
5) **Flow before**:
   ```
   emitCars() checks (now - lastBufferEmit >= BUFFER_EMIT_INTERVAL)
                          ↑
   emitAllBuffers() also uses lastBufferEmit
                          ↓
   Both methods share same throttle timestamp → cars emission skipped
   ```
6) **Solution approach**:
   - Added `CARS_EMIT_INTERVAL: number` to `IFlowPlant` interface in shared.ts
   - Added `CARS_EMIT_INTERVAL: 10000` to flowPlant.ts configuration
   - Added separate `lastCarsEmit` variable in SimulationEventEmitter
   - Updated `emitCars()` to use `lastCarsEmit` and `CARS_EMIT_INTERVAL`
7) **Files edited**:
   - `src/utils/shared.ts` | Line 216 (added CARS_EMIT_INTERVAL to IFlowPlant interface)
   - `src/domain/config/flowPlant.ts` | Line 76 (added CARS_EMIT_INTERVAL: 10000)
   - `src/app/SimulationEventEmitter.ts` | Line 29 (added lastCarsEmit) | Lines 53-62 (fixed emitCars method)
8) **New flow**:
   ```
   emitCars() checks (now - lastCarsEmit >= CARS_EMIT_INTERVAL)
                          ↓
   Independent throttle variable → cars emitted every 10 seconds

   emitAllBuffers() checks (now - lastBufferEmit >= BUFFER_EMIT_INTERVAL)
                          ↓
   Independent throttle variable → buffers emitted every 5 seconds
   ```

---

## ID 003 - Planned Stops (Lunch, etc.) Not Starting/Ending
1) 2026-01-10 | ~10:00:00
2) **Main problem**: Planned stops like lunch were not starting or ending - the code was skipping them entirely
3) **Analysis**:
   - `shouldStartStop()` used exact equality comparison: `stop.startTime >= timestamp && stop.startTime <= timestamp`
   - This is logically equivalent to `stop.startTime === timestamp`, which practically NEVER succeeds
   - With speedFactor = 50, timestamp advances 50000ms per tick, easily skipping the exact moment
   - `shouldEndStop()` didn't verify if the stop was actually IN_PROGRESS before ending
   - No tracking of previous timestamp to detect range crossing
4) **Source Problem**: `src/app/SimulationFlow.ts` | `shouldStartStop()` lines 71-74 | `shouldEndStop()` lines 67-69
5) **Flow before**:
   ```
   shouldStartStop() checks: stop.startTime === timestamp
                          ↓
   With speedFactor high, timestamp jumps over the exact startTime
                          ↓
   Condition NEVER true → stop never starts
   ```
6) **Solution approach**:
   - Added `prevSimulatedTimestamp` variable to track previous tick's timestamp
   - Changed `shouldStartStop()` to check: status === "PLANNED" AND startTime <= currentTimestamp AND startTime > prevTimestamp
   - Changed `shouldEndStop()` to check: status === "IN_PROGRESS" AND endTime <= currentTimestamp
   - Store `prevSimulatedTimestamp` at the end of each `execute()` call
7) **Files edited**:
   - `src/app/SimulationFlow.ts` | Lines 22-24 (added tracking variables) | Lines 67-111 (rewrote shouldEndStop and shouldStartStop) | Line 58 (store prevTimestamp)
8) **New flow**:
   ```
   shouldStartStop() checks:
     1. stop.status === "PLANNED" (not yet started)
     2. stop.startTime <= currentTimestamp (time has come)
     3. stop.startTime > prevTimestamp (wasn't processed before)
                          ↓
   Range-based check → works with any speedFactor

   shouldEndStop() checks:
     1. stop.status === "IN_PROGRESS" (was started)
     2. stop.endTime <= currentTimestamp (time to end)
                          ↓
   Status-aware check → correctly ends only active stops
   ```

---

## ID 004 - checkProductionDayEnd Exact Timestamp Comparison
1) 2026-01-10 | ~10:30:00
2) **Main problem**: `checkProductionDayEnd()` used exact `==` comparison for shift start/end times, failing with speedFactor high
3) **Analysis**:
   - Used `new Date().setHours(0,0,0,0)` which returns LOCAL timestamp, but simulatedTimestamp uses UTC
   - Used `==` for exact comparison: `timestamp == (todayTimestamp + hours + minutes)`
   - With speedFactor = 50, the timestamp easily jumps over the exact shift boundaries
   - No prevention of duplicate processing when timestamp is in range
4) **Source Problem**: `src/app/SimulationFlow.ts` | `checkProductionDayEnd()` lines 1087-1104 (original)
5) **Flow before**:
   ```
   checkProductionDayEnd() compares: timestamp == exactShiftTime
                          ↓
   With speedFactor high, timestamp jumps over exactShiftTime
                          ↓
   Shift end/start never detected → OEE not calculated, stops not reset
   ```
6) **Solution approach**:
   - Use UTC-based timestamp extraction from simulatedTimestamp
   - Implement `isTimestampInRange()` helper to check if target is in (prevTimestamp, currentTimestamp]
   - Add `processedShiftEnds` and `processedShiftStarts` Sets to prevent duplicate processing
   - Add `cleanOldTrackingEntries()` to prevent memory leak (removes entries older than 2 days)
7) **Files edited**:
   - `src/app/SimulationFlow.ts` | Lines 23-24 (tracking Sets) | Lines 1087-1125 (rewrote checkProductionDayEnd) | Lines 1094-1101 (isTimestampInRange) | Lines 1103-1125 (cleanOldTrackingEntries)
8) **New flow**:
   ```
   checkProductionDayEnd():
     1. Extract UTC date from simulatedTimestamp
     2. Calculate shift timestamps using UTC
     3. Create unique keys for line+day+shift
     4. Check if shiftEnd is in range (prevTimestamp, currentTimestamp]
     5. If in range AND not processed → process and mark as processed
     6. Same for shiftStart
     7. Clean old tracking entries
                          ↓
   Range-based check with duplicate prevention → works with any speedFactor
   ```

---

## ID 005 - Part Consumption Model Mismatch (REVERTED)
1) 2026-01-10 | ~11:00:00
2) **Main problem**: Original issue was cars getting stuck at stations requiring parts
3) **Analysis**: The fallback mechanism of consuming ANY part was INCORRECT - it's inadmissible to consume parts of different models than required
4) **REVERTED**: The fallback code was removed. The correct behavior is:
   - Cars MUST wait for parts of the EXACT model
   - `consumeAnyPart()` and `hasAnyPart()` methods were removed from BufferFactory
   - Part consumption remains strict: only consume parts matching the car's model

---

## ID 006 - Planned Stops (Lunch, etc.) Not Starting/Ending - REAL FIX
1) 2026-01-10 | ~14:00:00
2) **Main problem**: Planned stops like lunch were NEVER starting, and even if they did, they would never properly end
3) **Analysis - Three distinct bugs identified**:

   **Bug A: shouldRescheduleStop() always returns true**
   - `shouldRescheduleStop()` checked if ANY station is occupied, isFirstCar, or isStopped
   - During normal production, there are ALWAYS occupied stations
   - At simulation start, ALL stations have `isFirstCar = true`
   - Result: Planned stops were ALWAYS rescheduled and NEVER started

   **Bug B: PLANNED stops should not be reschedulable**
   - `startScheduledStop()` called `shouldRescheduleStop()` for ALL stops
   - But PLANNED stops (lunch, meetings) MUST start at scheduled time regardless of station state
   - Only RANDOM_GENERATE stops should be reschedulable

   **Bug C: endScheduledStop() didn't clear individual stations for "ALL" stops**
   - When ending a stop with `station === "ALL"`, only `clearStopStation("ALL")` was called
   - But "ALL" is not a real station ID - actual station IDs are like "Body-BodyMain-s1"
   - Individual stations' `isStopped` flags were NEVER cleared → stations stayed stopped forever

4) **Source Problem**: `src/app/SimulationFlow.ts` | Multiple locations:
   - `shouldRescheduleStop()` lines 125-128
   - `startScheduledStop()` lines 101-123
   - `endScheduledStop()` lines 88-103

5) **Flow before**:
   ```
   Planned stop scheduled for 12:00 (lunch)
                          ↓
   At 12:00, shouldStartStop() returns true
                          ↓
   startScheduledStop() calls shouldRescheduleStop()
                          ↓
   shouldRescheduleStop() returns true (stations are occupied)
                          ↓
   Stop is rescheduled to 14:00, then 16:00, etc.
                          ↓
   Lunch NEVER starts!

   Even if stop somehow starts:
                          ↓
   endScheduledStop() calls clearStopStation("ALL")
                          ↓
   "ALL" is not a valid station ID → nothing is cleared
                          ↓
   All stations in line remain stopped FOREVER
   ```

6) **Solution approach**:
   - **Bug A Fix**: Remove `isFirstCar` from `shouldRescheduleStop()` check - it only means no car has entered yet
   - **Bug B Fix**: Only call `shouldRescheduleStop()` for `RANDOM_GENERATE` stops, not `PLANNED` stops
   - **Bug C Fix**: In `endScheduledStop()` for "ALL" stops, iterate all stations and call `clearStopStation()` for each
   - Also added `notifyStopStarted()` call for ALL-station stops (was missing)

7) **Files edited**:
   - `src/app/SimulationFlow.ts` | Lines 88-129 (rewrote endScheduledStop, startScheduledStop, shouldRescheduleStop)

8) **New flow**:
   ```
   Planned stop scheduled for 12:00 (lunch)
                          ↓
   At 12:00, shouldStartStop() returns true
                          ↓
   startScheduledStop() checks stop.type
                          ↓
   stop.type === "PLANNED" → skip shouldRescheduleStop()
                          ↓
   activeStopsInManyStation() activates stop on all stations
                          ↓
   notifyStopStarted() emits event
                          ↓
   Lunch STARTS correctly at 12:00!

   At 13:00 (stop end time):
                          ↓
   shouldEndStop() returns true
                          ↓
   endScheduledStop() for "ALL" stop:
     1. endStop() updates stop status
     2. For each station in line: clearStopStation(station.id)
                          ↓
   All stations have isStopped = false
                          ↓
   Lunch ENDS correctly, stations resume!
   ```

---

## ID 007 - Removed Incorrect Fallback Part Consumption Code
1) 2026-01-10 | ~14:30:00
2) **Main problem**: Previously added fallback code allowed consuming parts of wrong model
3) **Analysis**:
   - ID 005 added `consumeAnyPart()` and `hasAnyPart()` to BufferFactory
   - This was WRONG - it's inadmissible to consume parts of different models
   - The real issue was not about part consumption but about planned stops blocking everything
4) **Source Problem**: `src/domain/factories/BufferFactory.ts` | Lines 195-221 (the fallback methods)
5) **Solution**: Remove the fallback methods completely
6) **Files edited**:
   - `src/domain/factories/BufferFactory.ts` | Removed `consumeAnyPart()` and `hasAnyPart()` methods
7) **Correct behavior**:
   - Cars MUST wait for parts of the EXACT matching model
   - If no matching parts are available, car waits (this is correct behavior)
   - Part lines and car lines should naturally synchronize because they use the same sequence-based model selection

---

## ID 008 - Fallback to Rework for Missing Parts (Model Desync)
1) 2026-01-10 | ~16:00:00
2) **Main problem**: Cars getting stuck indefinitely at stations requiring parts when buffer is FULL but has no parts of the required model
3) **Analysis**:
   - Car ~40 (model P19) was getting stuck at MetalLine-s1
   - Buffer Body-PARTS-COVER was FULL but had NO P19 parts
   - Root cause: Model desynchronization between part lines and car lines
   - Part lines use `getPlannedModel()` based on sequence
   - Car lines with `requiredParts` use `approvedModels[0]` (first model with all parts available)
   - Over time, the models diverge causing permanent blockage
4) **Source Problem**: `src/app/SimulationFlow.ts` | `checkAndConsumeRequiredParts()` lines 295-321
5) **Flow before**:
   ```
   Car at MetalLine-s1 (model P19)
                          ↓
   checkAndConsumeRequiredParts() checks buffer
                          ↓
   Buffer FULL but no P19 parts
                          ↓
   hasEnoughParts = false
                          ↓
   Car waits FOREVER (line blocked)
   ```
6) **Solution approach**:
   - Added fallback mechanism in `checkAndConsumeRequiredParts()`
   - When buffer is FULL AND has no parts of the required model:
     1. Send car to shop's rework buffer
     2. Mark car as defect with reason "MISSING_PARTS"
     3. Set `inRework = true` and `reworkEnteredAt`
     4. Car will be pulled from rework after `Rework_Time` (default 60min)
   - This simulates "offline assembly" of the missing part
   - Prevents line blockage while maintaining model integrity
7) **Files edited**:
   - `src/app/SimulationFlow.ts`:
     - Lines 306-317: Modified `checkAndConsumeRequiredParts()` to call fallback
     - Lines 347-367: Added `shouldSendToReworkForMissingParts()`
     - Lines 369-425: Added `sendCarToReworkForMissingParts()`
8) **New flow**:
   ```
   Car at MetalLine-s1 (model P19)
                          ↓
   checkAndConsumeRequiredParts() checks buffer
                          ↓
   Buffer FULL but no P19 parts
                          ↓
   shouldSendToReworkForMissingParts() → TRUE
                          ↓
   sendCarToReworkForMissingParts():
     - car.hasDefect = true
     - car.inRework = true
     - car.reworkEnteredAt = timestamp
     - Move to Body-REWORK buffer
     - Station freed for next car
                          ↓
   After Rework_Time (60min):
     - shouldPullFromRework() → TRUE
     - Car pulled to Paint_In-s1
     - Production continues
   ```

---

## ID 009 - OEE WebSocket Payload Sending Full Objects Instead of Identifiers
1) 2026-01-10 | ~17:00:00
2) **Main problem**: OEE dynamic data emitted via WebSocket contained full `IShop` and `ILine` objects with all stations, cars, etc.
3) **Analysis**:
   - `OEEData` interface defined `shop: IShop | 'ALL'` and `line: ILine | 'ALL'`
   - When `OEEFactory.calculateLineOEE()` and `calculateShopOEE()` returned data, they included full objects
   - When serialized to WebSocket, the entire object tree was sent (thousands of bytes per OEE update)
   - Payload included `_linesArray`, all `stations`, all `currentCar` data, etc.
   - This caused unnecessary bandwidth usage and made the data hard to parse on the client
4) **Source Problem**:
   - `src/utils/shared.ts` | `OEEData` interface lines 296-306
   - `src/domain/factories/OEEFactory.ts` | Lines 48-49, 89-90 (returning full objects)
   - `src/app/SimulationEventEmitter.ts` | `emitOEE()` method - no transformation before emit
5) **Flow before**:
   ```
   OEEFactory.calculateLineOEE()
                          ↓
   Returns OEEData with shop: IShop, line: ILine (full objects)
                          ↓
   SimulationEventEmitter.emitOEE()
                          ↓
   socketServer.emitOEE(oeeData) - serializes full objects
                          ↓
   Client receives JSON with thousands of bytes of nested data
   ```
6) **Solution approach**:
   - Created new interface `OEEDataEmit` with string identifiers instead of full objects
   - Added `transformOEEDataForEmit()` method in SimulationEventEmitter
   - Transform extracts `shop.name` and `line.id` before emitting via WebSocket
   - Original `OEEData` interface preserved for internal use and database persistence
7) **Files edited**:
   - `src/utils/shared.ts` | Lines 308-319 (added `OEEDataEmit` interface)
   - `src/app/SimulationEventEmitter.ts` | Lines 4, 402-444 (import + transformation logic)
8) **New flow**:
   ```
   OEEFactory.calculateLineOEE()
                          ↓
   Returns OEEData with shop: IShop, line: ILine (full objects)
                          ↓
   SimulationEventEmitter.emitOEE()
                          ↓
   transformOEEDataForEmit() converts to OEEDataEmit:
     - shop: IShop → shop: string (shop.name)
     - line: ILine → line: string (line.id)
                          ↓
   socketServer.emitOEE(oeeDataEmit) - serializes lightweight data
                          ↓
   Client receives clean JSON: { date, shop: "PWT", line: "PWT-CylinderHead", oee, jph, ... }
   ```

---