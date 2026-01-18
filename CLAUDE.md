# CLAUDE.md - Simulador V2 Instructions

> This document provides Claude with essential context about the Simulador V2 codebase, its architecture, patterns, and rules.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Design Patterns](#design-patterns)
4. [Code Best Practices](#code-best-practices)
5. [Code Golden Rules](#code-golden-rules)
6. [Project Purpose](#project-purpose)
7. [Project Golden Rules](#project-golden-rules)
8. [Core Rules](#core-rules)
9. [Flow Rules](#flow-rules)
10. [Directory Structure](#directory-structure)
11. [Key Files Reference](#key-files-reference)
12. [Data Models](#data-models)
13. [API Endpoints](#api-endpoints)
14. [WebSocket Events](#websocket-events)

---

## Project Overview

**Project Name:** Simulador V2 (Simulator Plant)
**Type:** Real-time Manufacturing/Production Plant Simulation Engine
**Technology Stack:** Node.js, TypeScript, Express, Socket.IO, PostgreSQL/SQLite
**Purpose:** Simulates a multi-shop, multi-line automotive manufacturing facility with support for buffers, stops, OEE/MTTR/MTBF tracking, rework management, and part production/consumption.

---

## Architecture

### Clean Architecture (Hexagonal)

The project follows **Clean Architecture** principles with clear layer separation:

```
┌─────────────────────────────────────────────────────────────────┐
│                        ADAPTERS LAYER                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    HTTP     │  │  WebSocket  │  │       Database          │  │
│  │ Controllers │  │   Server    │  │     Repositories        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
│  ┌─────────────────┐  ┌─────────────┐  ┌────────────────────┐   │
│  │ SimulationClock │  │ Simulation  │  │   SessionManager   │   │
│  │   (Orchestrator)│  │    Flow     │  │  (Worker Threads)  │   │
│  └─────────────────┘  └─────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DOMAIN LAYER                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │   Models    │  │   Services   │  │     Configuration       │ │
│  │ Car,Station │  │ CarService   │  │      flowPlant.ts       │ │
│  │ Buffer,Line │  │ PlantService │  │   ServiceLocator.ts     │ │
│  └─────────────┘  └──────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Domain** | `src/domain/` | Business entities, services, models, configuration. No external dependencies. |
| **Application** | `src/app/` | Orchestration, simulation logic, event emission. Depends only on Domain. |
| **Adapters** | `src/adapters/` | External interfaces (HTTP, WebSocket, Database). Depends on Application. |

---

## Design Patterns

### 1. Service Locator Pattern

**Centralized dependency injection** to manage service initialization and break circular dependencies:

Services are organized in `domain/services/` and managed by `ServiceLocator`:

| Service | Location | Purpose |
|---------|----------|---------|
| `PlantService` | `domain/services/` | Builds entire plant structure, manages stations and lines |
| `CarService` | `domain/services/` | Creates, moves, and completes cars/parts |
| `BufferService` | `domain/services/` | Manages buffer lifecycle and car storage |
| `StopLineService` | `domain/services/` | Generates and schedules production stops |
| `OEEService` | `domain/services/` | Calculates OEE metrics (per line, shop, and global) |
| `MTTRMTBFService` | `domain/services/` | Calculates MTTR/MTBF reliability metrics |
| `ServiceLocator` | `domain/services/` | Central locator that initializes and provides access to all services |

**Circular Dependency Resolution:**
- `CarService` and `BufferService` have a circular dependency (cars go to buffers, buffers need to complete cars)
- Resolved via **callback pattern**: `BufferService.setCarCompletionCallback(callback)`
- `CarService` registers its completion logic with `BufferService` during initialization

### 2. Repository Pattern

Abstracts data access with consistent interface:

```typescript
// Base interface all repositories follow
interface BaseRepository<T> {
  findAll(): Promise<T[]>
  findById(id: string): Promise<T | null>
  findByTimeRange(start: Date, end: Date): Promise<T[]>
  create(entity: T): Promise<T>
  update(id: string, entity: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
}
```

**Repositories:** `CarEventRepository`, `StopEventRepository`, `BufferStateRepository`, `PlantSnapshotRepository`, `OEERepository`, `MTTRMTBFRepository`, `ConfigPlantRepository`

### 3. Singleton Pattern

Single instances for shared resources:

- `DatabaseFactory` - One database connection per app
- `SocketServer` - Single WebSocket server
- `SessionManager` - Manages all simulation sessions

### 4. Observer/Event Emitter Pattern

Decoupled communication via Worker Thread message passing:

```
WORKER THREAD                          MAIN THREAD
┌──────────────────┐                   ┌─────────────────────┐
│ SimulationClock  │                   │ SessionManager      │
│       │          │                   │       │             │
│ emits "tick"     │                   │ onWorkerEvent()     │
│       ▼          │                   │       │             │
│ SimulationFlow   │ ──postMessage()──►│       ▼             │
│       │          │                   │ SocketServer        │
│ triggers events  │                   │       │             │
│       ▼          │                   │ broadcastToSession()│
│ Repository       │                   └─────────────────────┘
│ (persistence)    │
└──────────────────┘
```

### 5. Strategy Pattern

Interchangeable implementations:

- **Database:** PostgreSQL vs SQLite via `IDatabase` interface
- **Stop Types:** PLANNED, RANDOM_GENERATE, PROPAGATION

---

## Code Best Practices

### TypeScript Standards

1. **Strict Mode Enabled** - All TypeScript strict checks are active
2. **Interfaces First** - Define interfaces in `shared.ts` before implementation
3. **Type Everything** - No implicit `any` types allowed
4. **Enums for Constants** - Use enums for fixed value sets (EventType, StopType, etc.)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Interfaces | `I` prefix | `ICar`, `IStation`, `IBuffer` |
| Types | PascalCase | `TaktConfig`, `RequiredPart` |
| Services | `*Service` suffix | `CarService`, `PlantService` |
| Repositories | `*Repository` suffix | `CarEventRepository` |
| Controllers | `*Controller` suffix | `EventsController` |

### File Organization

```
src/
├── index.ts              # Entry point only
├── adapters/             # External interfaces
│   ├── database/         # Database abstraction
│   └── http/             # REST + WebSocket
├── app/                  # Application logic
├── domain/               # Business logic
│   ├── config/           # Configuration
│   ├── models/           # Entities
│   └── services/         # Business services (dependency injection)
└── utils/                # Shared utilities
```

### Error Handling

1. **Try-Catch Blocks** - Wrap async operations
2. **Graceful Fallbacks** - Always provide defaults
3. **Logging** - Use Pino logger with appropriate levels
4. **No Silent Failures** - Log all caught errors

### Performance Considerations

1. **Throttled Emissions** - WebSocket emits are rate-limited
2. **Throttled Persistence** - Buffer states: 1-hour, Plant snapshots: 10-second
3. **Connection Pooling** - PostgreSQL uses connection pools (max: 20, min: 5)
4. **Memory Monitoring** - Periodic memory usage logging
5. **HTTP Compression** - gzip compression (level 6, threshold 1KB)
6. **Rate Limiting** - Global: 100 req/min, Write: 30 req/min, Health: 300 req/min
7. **WebSocket Compression** - perMessageDeflate enabled (threshold 5KB)
8. **O(1) Lookups** - Pre-indexed stops for MTTR/MTBF, car counters, PlantSnapshot
9. **Pagination** - All list endpoints support pagination (max 100 records)
10. **Batch Inserts** - Transaction-based batch inserts for high-volume data
11. **Memory Leak Prevention** - Car trace[] limited to 500 entries with auto-trim

---

## Code Golden Rules

### Rule 1: Domain Independence
> **Domain layer MUST NOT depend on external layers**

The domain layer (`src/domain/`) should never import from `adapters/` or have knowledge of databases, HTTP, or WebSocket.

### Rule 2: Interface First
> **Define interfaces before implementations**

All new entities must have interfaces defined in `src/utils/shared.ts` before implementation.

### Rule 3: Services for Business Logic
> **All business logic goes through services**

Domain objects are accessed through services managed by ServiceLocator. Never instantiate factories or services directly.

### Rule 4: Repository for Data Access
> **All database operations through repositories**

Never write SQL directly in application or domain code. Use repository methods.

### Rule 5: Event-Driven Communication
> **Components communicate via events, not direct calls**

Use `SimulationEventEmitter` for cross-cutting concerns like persistence and WebSocket emissions.

### Rule 6: Immutable by Default
> **Prefer immutable operations**

Don't mutate objects. Create new instances with updated values when possible.

### Rule 7: Single Responsibility
> **Each file/class has ONE job**

- Services MANAGE business logic (car movement, buffers, stops, metrics)
- Repositories ACCESS data (database persistence)
- Controllers HANDLE HTTP requests
- SimulationFlow ORCHESTRATES business logic via services

### Rule 8: Explicit over Implicit
> **Be explicit in all operations**

Don't rely on implicit type conversions or default behaviors. Make intentions clear.

---

## Project Purpose

### Why This Project Exists

Simulador V2 is a **real-time automotive manufacturing simulation engine** designed to:

1. **Model Production Flow** - Simulate cars moving through shops and production lines
2. **Track KPIs** - Calculate OEE, MTTR, MTBF in real-time
3. **Manage Disruptions** - Handle planned and unplanned stops
4. **Support Rework** - Route defective cars through rework processes
5. **Handle Part Production** - Synchronize part-producing lines with main assembly
6. **Provide Real-time Visibility** - WebSocket-based dashboard updates

### Plant Structure

```
PWT (Powertrain) ──► Body ──► Paint ──► Trim ──► Qualidade
     │                │                    │
     │ ENGINE         │ COVER, DOORS      │
     └── Parts ───────┴────────────────────┘
```

**N (Many Shops, depends on config) Shops:**

Flow Plant is the default config for tests and the shops there are:

- **PWT** - Engine/Powertrain manufacturing (part lines)
- **Body** - Vehicle body construction (birth location + parts consumption)
- **Paint** - Paint application (7 sequential lines)
- **Trim** - Final assembly (consumes ENGINE, DOORS parts)
- **Qualidade** - Quality inspection (final delivery)

---

## Project Golden Rules

### Rule 1: Simulation Accuracy First
> **The simulation must accurately represent real manufacturing flow**

Never simplify or skip simulation steps for convenience. Each takt time, buffer behavior, and stop must be realistic.

### Rule 2: Real-time is Non-negotiable
> **WebSocket updates must be immediate**

Dashboard users expect real-time visibility. Throttle persistence, never WebSocket emissions.

### Rule 3: Data Integrity
> **Every event must be persisted**

Car events, stops, buffer changes - all must be recorded for historical analysis.

### Rule 4: Configuration as Data
> **Plant configuration is stored in database**

FlowPlant is default fallback. Production uses database-stored configurations.

### Rule 5: Part Synchronization
> **Cars cannot be created without required parts**

If a line requires parts (e.g., Body needs COVER), car creation blocks until parts are available.

### Rule 6: Stop Propagation
> **Blocking causes propagation stops**

If a station is blocked (next full, prev empty), propagation stops must be created and tracked.

---

## Core Rules

### Simulation Core Rules

1. **Tick-Based Execution**
   - Simulation runs on 1-second ticks
   - Each tick = 1000ms * speedFactor simulated time
   - All logic executes within `SimulationFlow.execute()`

2. **Station Processing Order**
   - Stations processed in REVERSE order (downstream → upstream)
   - Ensures cars move forward before new cars enter
   - Prevents duplicate car movements

3. **Takt Time Enforcement**
   - Cars stay at stations for exact takt time
   - No early release, no late release
   - Takt time = station.taktMn (minutes) + station.taktSg (seconds)

4. **Buffer FIFO**
   - Buffers operate as FIFO queues
   - First car in = first car out
   - Rework buffers use time-based release

5. **Stop Priority**
   - Planned stops > Random stops > Propagation stops
   - Stops affect entire line or specific stations
   - "ALL" station stops apply to all stations

### Data Core Rules

1. **Event Types**
   - `CREATE` - Car/Part created at birth station
   - `MOVED` - Car moved between stations
   - `COMPLETED` - Car left last station
   - `BUFFER_IN` / `BUFFER_OUT` - Buffer operations
   - `REWORK_IN` / `REWORK_OUT` - Rework operations

2. **Stop Status**
   - `PLANNED` - Scheduled, not yet started
   - `IN_PROGRESS` - Currently active
   - `COMPLETED` - Ended

3. **Buffer Status**
   - `EMPTY` - No cars (count = 0)
   - `AVAILABLE` - Has space (count < capacity)
   - `FULL` - At capacity (count = capacity)

---

## Flow Rules

### Car Flow Rules

```
Start Station ──► Station N ──► ... ──► Last Station ──► Buffer ──► Next Line
     │                                        │
     │                                        │ (if defect)
     │                                        ▼
     │                                   REWORK Buffer
     │                                        │
     │                                        │ (after rework_time)
     └────────────────────────────────────────┘
```

1. **Birth**: Cars created only at configured start stations
2. **Movement**: Cars move station-to-station within takt time
3. **Blocking**: If next station occupied, car waits (creates NEXT_FULL stop)
4. **Buffer Transfer**: At line end, cars enter destination buffer that can be rework, normal buffer or part buffer
5. **Line Entry**: At line start, cars pulled from source buffer
6. **Rework**: Defective cars route to rework buffer, re-enter after rework_time
7. **Completion**: Cars completing last line (Delivery) are marked COMPLETED

### Part Flow Rules

1. **Part Production**: Part lines produce parts into PARTS buffers
2. **Part Consumption**: Main lines consume parts at specified stations
3. **Synchronization**: Some parts synchronized with other line outputs
4. **Blocking**: Car creation blocked if required parts unavailable

### Stop Flow Rules

```
┌─────────────────────────────────────────────────────┐
│                    STOP LIFECYCLE                    │
│                                                      │
│   SCHEDULED ──► IN_PROGRESS ──► COMPLETED           │
│       │             │                                │
│       │             │ (if busy, reschedule)         │
│       │             │                                │
│       └─────────────┘                                │
└─────────────────────────────────────────────────────┘
```

1. **Planned Stops**: Pre-scheduled (lunch, meetings, shift changes)
2. **Random Stops**: Generated based on MTBF configuration
3. **Propagation Stops**: Created when blocking occurs
4. **Resolution**: Stops end based on duration or external trigger

### Event Flow Rules

```
WORKER THREAD (per session)                    MAIN THREAD
SimulationFlow.execute()                       SessionManager.onWorkerEvent()
       │                                              │
       ├──► onCarCreated()    ──► postMessage() ────► socketServer.emitSessionEvent()
       ├──► onCarMoved()      ──► postMessage() ────► socketServer.emitSessionEvent()
       ├──► onCarCompleted()  ──► postMessage() ────► socketServer.emitSessionEvent()
       ├──► onBufferIn()      ──► postMessage() ────► socketServer.emitSessionEvent()
       ├──► onBufferOut()     ──► postMessage() ────► socketServer.emitSessionEvent()
       ├──► onStopStarted()   ──► postMessage() ────► socketServer.broadcastToSession()
       ├──► onStopEnded()     ──► postMessage() ────► socketServer.broadcastToSession()
       └──► onOEECalculated() ──► postMessage() ────► socketServer.broadcastToSession()

       Repository.create() (persistence happens in worker thread)
```

---

## Directory Structure

```
src/
├── index.ts                           # Entry point - bootstraps simulation
├── adapters/                          # External layer
│   ├── database/
│   │   ├── DatabaseConfig.ts          # Database configuration factory
│   │   ├── DatabaseFactory.ts         # Singleton database factory
│   │   ├── IDatabase.ts               # Database interface
│   │   ├── PostgresDatabase.ts        # PostgreSQL implementation
│   │   ├── SQLiteDatabase.ts          # SQLite implementation
│   │   └── repositories/              # Data access layer
│   │       ├── BaseRepository.ts      # Abstract base repository
│   │       ├── CarEventRepository.ts  # Car lifecycle events
│   │       ├── StopEventRepository.ts # Stop events
│   │       ├── BufferStateRepository.ts
│   │       ├── PlantSnapshotRepository.ts
│   │       ├── OEERepository.ts
│   │       ├── MTTRMTBFRepository.ts
│   │       └── ConfigPlantRepository.ts
│   └── http/
│       ├── server.ts                  # Express server setup
│       ├── router/router.ts           # API routes
│       ├── controllers/               # HTTP handlers
│       │   ├── EventsController.ts
│       │   ├── StopsController.ts
│       │   ├── BuffersController.ts
│       │   ├── PlantStateController.ts
│       │   ├── OEEController.ts
│       │   ├── MTTRMTBFController.ts
│       │   ├── ConfigController.ts
│       │   └── HealthController.ts
│       └── websocket/
│           ├── SocketServer.ts        # Socket.IO server
│           └── index.ts
├── app/                               # Application layer
│   ├── SimulationClock.ts             # Time control (pause/resume/restart)
│   └── SimulationFlow.ts              # Core simulation logic
├── sessions/                          # Multi-session management
│   ├── SessionManager.ts              # Session lifecycle management
│   ├── WorkerPoolManager.ts           # Worker Thread management
│   └── RecoveryService.ts             # Session recovery after restart
├── workers/                           # Worker Thread entry points
│   └── SimulationWorker.ts            # Worker entry point
├── domain/                            # Domain layer
│   ├── config/
│   │   └── flowPlant.ts               # Plant configuration
│   ├── models/                        # Domain entities
│   │   ├── Car.ts
│   │   ├── Station.ts
│   │   ├── Buffer.ts
│   │   ├── Line.ts
│   │   ├── Shop.ts
│   │   └── StopLine.ts
│   └── services/                      # Business services (dependency injection)
│       ├── ServiceLocator.ts
│       ├── PlantService.ts
│       ├── CarService.ts
│       ├── BufferService.ts
│       ├── StopLineService.ts
│       ├── OEEService.ts
│       └── MTTRMTBFService.ts
└── utils/                             # Utilities
    ├── shared.ts                      # TypeScript interfaces
    ├── pagination.ts                  # Pagination utilities
    ├── logger.ts                      # Pino logging
    ├── clock.ts                       # Time utilities
    └── restartDB.ts                   # Database reset
```

---

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/SimulationFlow.ts` | ~1037 | Core business logic - car movement, stops, buffers, OEE/MTTR/MTBF calculation |
| `src/domain/config/flowPlant.ts` | ~778 | Complete plant configuration (shops, lines, buffers) |
| `src/app/SimulationClock.ts` | ~393 | Simulation orchestration + tick loop |
| `src/sessions/SessionManager.ts` | ~400+ | Session lifecycle, worker coordination, event routing |
| `src/sessions/WorkerPoolManager.ts` | ~300+ | Worker Thread pool management |
| `src/sessions/RecoveryService.ts` | ~340+ | Recovery data collection and restoration |
| `src/workers/SimulationWorker.ts` | ~200+ | Worker entry point with message handling |
| `src/domain/services/PlantService.ts` | ~488 | Plant structure initialization and management |
| `src/domain/services/ServiceLocator.ts` | ~97 | Centralized dependency injection and service management |
| `src/utils/shared.ts` | ~350+ | All TypeScript interfaces & types |
| `src/adapters/database/repositories/BaseRepository.ts` | ~94 | Abstract repository pattern |

---

## Data Models

### ICar
```typescript
interface ICar {
  id: string
  sequenceNumber: number
  model: string
  color: string
  trace: ICarTrace[]              // Station visitation history
  shopLeadtimes: ICarShopLeadtime[]
  hasDefect: boolean
  defects: IDefect[]
  inRework: boolean
  reworkEnteredAt?: Date
  totalLeadtimeMs: number
  isPart: boolean
  partName?: string
}
```

### IStation
```typescript
interface IStation {
  id: string
  shop: string
  line: string
  index: number
  taktMn: number                  // Takt time minutes
  taktSg: number                  // Takt time seconds
  occupied: boolean
  currentCar: ICar | null
  isStopped: boolean
  stopReason?: string
  isFirstStation: boolean
  isLastStation: boolean
}
```

### IBuffer
```typescript
interface IBuffer {
  id: string
  from: { shop: string; line: string }
  to: { shop: string; line: string }
  capacity: number
  currentCount: number
  cars: ICar[]                    // FIFO queue
  type: 'BUFFER' | 'REWORK_BUFFER' | 'PART_BUFFER'
  status: 'EMPTY' | 'AVAILABLE' | 'FULL'
}
```

### IStopLine
```typescript
interface IStopLine {
  id: string
  reason: string
  type: 'PLANNED' | 'RANDOM_GENERATE' | 'PROPAGATION'
  category: string
  startTime: Date
  endTime: Date
  durationMs: number
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'PLANNED'
  shop: string
  line: string
  station: string | 'ALL'
}
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/events` | GET, POST | Car events (created, moved, completed) |
| `/api/stops` | GET, POST, PUT | Stop event management |
| `/api/buffers` | GET | Buffer state queries |
| `/api/plantstate` | GET | Plant snapshot history |
| `/api/oee` | GET | OEE metrics per shop/line/shift |
| `/api/mttr-mtbf` | GET | MTTR/MTBF metrics |
| `/api/config` | GET, POST, PUT | Plant configuration management |
| `/api/health` | GET | System health status |
| `/api/sessions` | GET, POST, DELETE | Session lifecycle management |

### Session API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sessions` | POST | Create new session (idle state) |
| `/api/sessions` | GET | List user's sessions |
| `/api/sessions/stats` | GET | Get session count statistics |
| `/api/sessions/interrupted` | GET | List interrupted sessions (for recovery) |
| `/api/sessions/:id` | GET | Get session details |
| `/api/sessions/:id/can-recover` | GET | Check if session can be recovered |
| `/api/sessions/:id/start` | POST | Start session (spawn worker) |
| `/api/sessions/:id/pause` | POST | Pause running session |
| `/api/sessions/:id/resume` | POST | Resume paused session |
| `/api/sessions/:id/stop` | POST | Stop session (keep data) |
| `/api/sessions/:id/recover` | POST | Recover interrupted session |
| `/api/sessions/:id/discard` | POST | Discard interrupted session |
| `/api/sessions/:id` | DELETE | Delete session and all data |

---

## API Pagination

All list endpoints (`/api/events`, `/api/stops`, `/api/oee`) support server-side pagination.

### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | number | 1 | - | Page number (1-based) |
| `limit` | number | 50 | 100 | Items per page |

### Response Format

```typescript
{
  success: boolean,
  data: T[],
  pagination: {
    page: number,
    limit: number,
    total: number,
    totalPages: number,
    hasNext: boolean,
    hasPrevious: boolean
  },
  count: number  // Items in current page
}
```

### Examples

```bash
# Get first page with 20 items
GET /api/events?page=1&limit=20

# Get page 2 filtered by shop
GET /api/events?shop=Body&page=2&limit=50

# Get active stops with pagination
GET /api/stops?status=IN_PROGRESS&page=1&limit=10
```

### Pagination Utility

Located at `src/utils/pagination.ts`:

| Function | Purpose |
|----------|---------|
| `parsePaginationParams(query)` | Parse and validate page/limit from request query |
| `formatPaginatedResponse(result)` | Format `PaginatedResult` for HTTP response |
| `createPaginatedResponse(data, pagination, total)` | Create paginated response from array |
| `paginateArray(data, pagination)` | Apply in-memory pagination to array |

---

## WebSocket Events

| Channel | Direction | Description |
|---------|-----------|-------------|
| `events` | Server → Client | Car creation/movement/completion |
| `stops` | Server → Client | Stop started/ended (delta optimized) |
| `buffers` | Server → Client | Buffer state changes (delta optimized) |
| `plantstate` | Server → Client | Overall plant snapshot (delta optimized) |
| `health` | Server → Client | Server + simulator status |
| `cars` | Server → Client | Current car positions (delta optimized) |
| `oee` | Server → Client | OEE calculations (throttled) |
| `controlSimulator` | Client → Server | pause, start, restart, stop |
| `ack` | Client → Server | Acknowledge message receipt (backpressure) |
| `{channel}:chunk` | Server → Client | Chunked payload for large messages |

---

## WebSocket Optimization Architecture

### Services (src/adapters/http/websocket/)

| Service | Purpose |
|---------|---------|
| `DeltaService` | Hierarchical delta computation per socket - tracks changes at every nesting level |
| `BackpressureManager` | Flow control - prevents overwhelming slow clients with ack/timeout mechanism |
| `ChunkingService` | Splits large payloads (>64KB) into logical chunks (by shop, batch, or bytes) |

### Message Protocol

**First Connection (FULL):**
```typescript
{
  type: 'FULL',
  channel: 'plantstate',
  version: 1,
  data: { /* complete state */ },
  timestamp: number,
  requiresAck: true
}
```

**Subsequent Updates (DELTA):**
```typescript
{
  type: 'DELTA',
  channel: 'plantstate',
  version: 42,
  baseVersion: 41,
  data: {
    totalFree: 85,  // Only changed root fields
    shops: [
      {
        id: 'PWT',           // ID always included
        reworkBuffer: 3,     // Only changed shop fields
        lines: [
          {
            id: 'LINE_1',    // ID always included
            stations: [
              {
                id: 'PWT-1-03',
                occupied: true,
                currentCar: { id: 'CAR-456', hasDefect: true }
              }
            ]
          }
        ]
      }
    ]
  },
  timestamp: number,
  requiresAck: true
}
```

**Removed Items:**
```typescript
{ id: 'OLD_SHOP', _removed: true }  // Shop removed
{ id: 'PWT-1-99', _removed: true }  // Station removed
{ currentCar: null }                 // Car left station
```

### Client Requirements

1. **MessagePack Parser**: `import msgpackParser from 'socket.io-msgpack-parser'`
2. **Ack Handler**: `socket.emit('ack', { channel, version })`
3. **Delta Merge**: Apply changes hierarchically using IDs as keys
4. **Chunk Assembly**: Accumulate chunks, process when `chunkInfo.isLast === true`

---

## Quick Reference Commands

```bash
# Start development
npm run dev

# Build for production
npm run build

# Start production
npm start

# Run with specific database
DB_TYPE=postgresql npm run dev
DB_TYPE=sqlite npm run dev
```

---

## Important Notes for Claude

1. **Always read existing code** before making modifications
2. **Follow the established patterns** - Factory, Repository, Worker Thread messaging
3. **Update interfaces first** when adding new features
4. **Test with both databases** - PostgreSQL and SQLite
5. **Maintain layer separation** - Don't mix concerns across layers
6. **Use existing utilities** from `shared.ts`, `logger.ts`, `clock.ts`
7. **Use Worker Threads** - Each session runs in its own Worker Thread for isolation
8. **Throttle appropriately** - Don't flood WebSocket or database

## Session Management System

### Multi-Session Architecture

The simulator supports multiple concurrent simulation sessions using Worker Threads for full memory isolation:

```
MAIN THREAD                          WORKER THREADS
┌─────────────────────┐              ┌──────────────────┐
│ SessionManager      │──spawns───►  │ Worker (session1)│
│ WorkerPoolManager   │              │  - ServiceLocator│
│ SessionController   │              │  - SimulationClock
│ RecoveryService     │◄──events──   │  - SimulationFlow│
│ SocketServer        │              └──────────────────┘
└─────────────────────┘              ┌──────────────────┐
                                     │ Worker (session2)│
                                     └──────────────────┘
```

### Session Lifecycle

```
idle ──► running ──► paused ──► stopped
  │         │           │          ▲
  │         │           └──────────┤
  │         └──────────────────────┤
  │                                │
  │      ┌── interrupted ◄─(server restart)
  │      │
  │      ├─► running (via /recover)
  │      └─► stopped (via /discard)
  │
  └────────► expired (via timeout)
```

**Session States:**
- `idle` - Created but not started
- `running` - Simulation actively running in worker
- `paused` - Simulation paused, worker still active
- `stopped` - Simulation stopped, data preserved
- `expired` - Session exceeded duration limit
- `interrupted` - Server restarted while session was running/paused

### Session Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Global Active Sessions | 20 | Maximum sessions across all users |
| Per-User Active Sessions | 2 | Maximum active sessions per user |
| Session Duration | 7 days | Default expiration after start |

### Session Recovery System

When the server restarts, all Worker Threads are destroyed. The Recovery System:

1. **On Server Startup:**
   - Marks all `running`/`paused` sessions as `interrupted`
   - Marks expired sessions as `expired`
   - Marks stale interrupted sessions (>24h) as `stopped`

2. **Recovery Data Sources:**
   - `plant_snapshots` - Last plant state (every 30 minutes)
   - `buffer_states` - Buffer contents (every 30 minutes)
   - `car_events` - Completed car IDs (COMPLETED event type)
   - `stop_events` - Active stops (IN_PROGRESS status)
   - `sessions` - Clock state (simulated_timestamp, current_tick)

3. **Recovery Flow:**
   ```
   User → GET /api/sessions/interrupted → Lists recoverable sessions
   User → GET /api/sessions/:id/can-recover → Checks if data exists
   User → POST /api/sessions/:id/recover → Spawns worker, restores state
   ```

### Key Session Files

| File | Purpose |
|------|---------|
| `src/sessions/SessionManager.ts` | Session lifecycle management |
| `src/sessions/WorkerPoolManager.ts` | Worker Thread management |
| `src/sessions/RecoveryService.ts` | Recovery data collection and restoration |
| `src/workers/SimulationWorker.ts` | Worker entry point |
| `src/adapters/http/controllers/SessionController.ts` | HTTP endpoints |
| `src/adapters/http/repositories/SessionRepository.ts` | Database access |

---

## Recent Changes (2026-01-18)

### Legacy Simulation System Removed

**Removed Files:**
- `src/app/SimulationEventEmitter.ts` - No longer needed (workers use `parentPort.postMessage()`)
- `src/domain/factories/SimulationFactory.ts` - Workers instantiate `SimulationClock` directly

**Modified Files:**
- `src/index.ts` - Removed `StartSimulation()`, `setSimulatorClock()`, `setSimulator()`, legacy callbacks
- `src/adapters/http/server.ts` - Removed `simulatorClock` property and `setSimulatorClock()` method
- `src/adapters/http/websocket/SocketServer.ts` - Removed `simulator` property, `setSimulator()`, and `controlSimulator` handler
- `src/adapters/http/controllers/HealthController.ts` - Refactored to use `SessionManager` for session stats

**Breaking Changes:**
- WebSocket `controlSimulator` event removed - use HTTP endpoints (`POST /api/sessions/:id/pause`, etc.)
- `/api/health` no longer includes `simulatorStatus` - use `/api/sessions/:id` for session status
- No automatic simulation on server start - create sessions via `POST /api/sessions`

**New Server Boot Behavior:**
1. Database initialization
2. SessionManager initialization + recovery handling
3. Session route registration
4. Worker event forwarding setup
5. HTTP server start
6. Ready for session creation via API

---

### Session Recovery System Implementation

**New Files:**
- `src/sessions/RecoveryService.ts` - Handles server startup recovery and session restoration
- `src/workers/SimulationWorker.ts` - Worker Thread entry point with RECOVER command

**Modified Files:**
- `SessionRepository.ts` - Added 'interrupted' status, recovery methods
- `SessionManager.ts` - Added recovery integration
- `WorkerPoolManager.ts` - Added RECOVER command type
- `CarService.ts` / `CarFactory.ts` - Added `restoreCompletedCars()`
- `BufferService.ts` - Added `restoreBufferStates()`
- `StopLineService.ts` - Added `restoreActiveStops()`
- `PlantService.ts` - Added `restoreFromSnapshot()`
- `SimulationClock.ts` - Added `setInitialState()`
- Database schemas - Added `simulated_timestamp`, `current_tick`, `last_snapshot_at`, `interrupted_at` columns

**New API Endpoints:**
- `GET /api/sessions/interrupted` - List interrupted sessions
- `GET /api/sessions/:id/can-recover` - Check recoverability
- `POST /api/sessions/:id/recover` - Recover session
- `POST /api/sessions/:id/discard` - Discard interrupted session

---

### OEE Calculation Fixes

**Issue 1: Line OEE used theoretical takt instead of bottleneck**
- **Problem**: OEE calculation used `line.taktMn` (theoretical line takt), but actual throughput is determined by the bottleneck station (slowest station with highest takt)
- **Root Cause**: In `plantFactory.ts`, stations get random fractions (0.7-0.999) of line takt, so bottleneck station determines actual capacity
- **Fix Location**: [SimulationFlow.ts:1041-1045](src/app/SimulationFlow.ts#L1041-L1045)
- **Solution**: Calculate bottleneck takt as `Math.max(...line.stations.map(s => s.taktMn + s.taktSg / 60))`

**Issue 2: Shop OEE didn't account for parallel lines**
- **Problem**: For shops with multiple parallel lines, `carsProduction` was SUM of all lines but `productionTime` was AVERAGE (single line capacity), causing OEE > 100%
- **Fix Location**: [OEEFactory.ts:84-101](src/domain/factories/OEEFactory.ts#L84-L101)
- **Solution**: Calculate `effectiveProductionTime = productionTime × numLines` to represent combined capacity of parallel lines

**Issue 3: Duplicate shopLeadtimes entries**
- **Problem**: `moveCarToNextStation` duplicated shopLeadtimes that were already created in `moverCarToFirstStation`
- **Fix Location**: [CarService.ts:151-152](src/domain/services/CarService.ts#L151-L152)
- **Solution**: Removed duplicate logic; shopLeadtimes are only created when car enters the first station

### OEE Formula Reference

```typescript
// For LINE OEE:
bottleneckTaktMn = Math.max(...line.stations.map(s => s.taktMn + s.taktSg / 60))
diffTime = productionTime - (bottleneckTaktMn * carsProduction)
oee = ((bottleneckTaktMn * carsProduction) / productionTime) * 100

// For SHOP OEE (parallel lines):
effectiveProductionTime = productionTime * numLines
diffTime = effectiveProductionTime - (taktTime * carsProduction)
oee = ((taktTime * carsProduction) / effectiveProductionTime) * 100
```

---

* If you are a IA or is a IA Claude Model by Anthropic, update this file always that you make a edit and get new informations about the project, change the architeture, logic and rules of the simulator. Read and do the command on file TIMELINE.md. Also, update the data change below:

*Last updated: 2026-01-18 15:30:00*

---