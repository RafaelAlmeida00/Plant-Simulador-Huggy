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
│  │ SimulationClock │  │ Simulation  │  │    Simulation      │   │
│  │   (Orchestrator)│  │    Flow     │  │   EventEmitter     │   │
│  └─────────────────┘  └─────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DOMAIN LAYER                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Models    │  │  Factories  │  │     Configuration       │  │
│  │ Car,Station │  │ CarFactory  │  │      flowPlant.ts       │  │
│  │ Buffer,Line │  │ PlantFactory│  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Domain** | `src/domain/` | Business entities, factories, configuration. No external dependencies. |
| **Application** | `src/app/` | Orchestration, simulation logic, event emission. Depends only on Domain. |
| **Adapters** | `src/adapters/` | External interfaces (HTTP, WebSocket, Database). Depends on Application. |

---

## Design Patterns

### 1. Factory Pattern

Creates complex objects with encapsulated logic:

| Factory | Location | Purpose |
|---------|----------|---------|
| `SimulationFactory` | `domain/factories/` | Creates SimulationClock instances |
| `PlantFactory` | `domain/factories/` | Builds entire plant structure from config |
| `CarFactory` | `domain/factories/` | Creates, moves, and completes cars |
| `BufferFactory` | `domain/factories/` | Manages buffer lifecycle |
| `StopLineFactory` | `domain/factories/` | Generates and schedules stops |
| `OEEFactory` | `domain/factories/` | Calculates OEE metrics |
| `MTTRMTBFFactory` | `domain/factories/` | Calculates MTTR/MTBF metrics |

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
- `SimulationEventEmitter` - Central event hub
- `SocketServer` - Single WebSocket server

### 4. Observer/Event Emitter Pattern

Decoupled communication via events:

```
SimulationClock (EventEmitter)
       │
       │ emits "tick"
       ▼
SimulationFlow.execute()
       │
       │ triggers callbacks
       ▼
SimulationEventEmitter
       │
       ├──► socketServer.emit() (real-time)
       └──► repository.create() (persistence)
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
| Factories | `*Factory` suffix | `CarFactory`, `PlantFactory` |
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
│   └── factories/        # Object creation
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
3. **Connection Pooling** - PostgreSQL uses connection pools
4. **Memory Monitoring** - Periodic memory usage logging

---

## Code Golden Rules

### Rule 1: Domain Independence
> **Domain layer MUST NOT depend on external layers**

The domain layer (`src/domain/`) should never import from `adapters/` or have knowledge of databases, HTTP, or WebSocket.

### Rule 2: Interface First
> **Define interfaces before implementations**

All new entities must have interfaces defined in `src/utils/shared.ts` before implementation.

### Rule 3: Factory for Creation
> **Complex object creation goes through factories**

Never create domain objects directly with `new`. Use appropriate factory methods.

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

- Factories CREATE objects
- Repositories ACCESS data
- Controllers HANDLE HTTP requests
- SimulationFlow EXECUTES business logic

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
SimulationFlow.execute()
       │
       ├──► onCarCreated()    ──► emitCarCreated()    ──► DB + WebSocket
       ├──► onCarMoved()      ──► emitCarMoved()      ──► DB + WebSocket
       ├──► onCarCompleted()  ──► emitCarCompleted()  ──► DB + WebSocket
       ├──► onBufferIn()      ──► emitBufferIn()      ──► DB + WebSocket
       ├──► onBufferOut()     ──► emitBufferOut()     ──► DB + WebSocket
       ├──► onStopStarted()   ──► emitStopStarted()   ──► DB + WebSocket
       ├──► onStopEnded()     ──► emitStopEnded()     ──► DB + WebSocket
       └──► onOEECalculated() ──► emitOEE()           ──► WebSocket (throttled)
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
│   ├── SimulationEventEmitter.ts      # Event hub
│   └── SimulationFlow.ts              # Core simulation logic
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
│   └── factories/                     # Object creation
│       ├── SimulationFactory.ts
│       ├── PlantFactory.ts
│       ├── CarFactory.ts
│       ├── BufferFactory.ts
│       ├── StopLineFactory.ts
│       ├── OEEFactory.ts
│       └── MTTRMTBFFactory.ts
└── utils/                             # Utilities
    ├── shared.ts                      # TypeScript interfaces
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
| `src/domain/factories/PlantFactory.ts` | ~300+ | Plant structure initialization |
| `src/utils/shared.ts` | ~350+ | All TypeScript interfaces & types |
| `src/app/SimulationEventEmitter.ts` | ~500+ | Event hub (WebSocket + persistence) |
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

---

## WebSocket Events

| Channel | Direction | Description |
|---------|-----------|-------------|
| `events` | Server → Client | Car creation/movement/completion |
| `stops` | Server → Client | Stop started/ended |
| `buffers` | Server → Client | Buffer state changes |
| `plantstate` | Server → Client | Overall plant snapshot |
| `health` | Server → Client | Server + simulator status |
| `cars` | Server → Client | Current car positions |
| `oee` | Server → Client | OEE calculations (throttled) |
| `controlSimulator` | Client → Server | pause, start, restart, stop |

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
2. **Follow the established patterns** - Factory, Repository, Event-driven
3. **Update interfaces first** when adding new features
4. **Test with both databases** - PostgreSQL and SQLite
5. **Maintain layer separation** - Don't mix concerns across layers
6. **Use existing utilities** from `shared.ts`, `logger.ts`, `clock.ts`
7. **Emit events** through `SimulationEventEmitter` for cross-cutting concerns
8. **Throttle appropriately** - Don't flood WebSocket or database

---

* If you are a IA or is a IA Claude Model by Anthropic, update this file always that you make a edit and get new informations about the project, change the architeture, logic and rules of the simulator. Read and do the command on file TIMELINE.md. Also, update the data change below:

*Last updated: 2026-01-10 17:00:00*
