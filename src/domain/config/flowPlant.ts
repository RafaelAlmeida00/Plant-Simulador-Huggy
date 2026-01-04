import { IFlowPlant } from "../../utils/shared";

/**
 * ============================================================================
 * CONFIGURAÇÃO DA PLANTA DE PRODUÇÃO (FlowPlant)
 * ============================================================================
 * 
 * Este arquivo define toda a estrutura da planta de produção, incluindo:
 * - Shops (áreas da fábrica)
 * - Linhas de produção (normais e de peças)
 * - Buffers entre linhas
 * - Rotas de fluxo de carros
 * - Paradas planejadas
 * 
 * ============================================================================
 * TIPOS DE LINHAS:
 * ============================================================================
 * 
 * 1. LINHAS NORMAIS (Car Lines):
 *    - Produzem ou processam CARROS
 *    - TÊM routes: definem para onde o carro vai quando sai da linha
 *    - TÊM buffers: buffers entre esta linha e a próxima
 *    - PODEM ter requiredParts: peças que precisam consumir para operar
 *    - Exemplo: BodyMain, MetalLine, Paint_In, Trim_A, etc.
 * 
 * 2. LINHAS DE PEÇAS (Part Lines):
 *    - Produzem PEÇAS que serão consumidas por outras linhas
 *    - TÊM partType: define o tipo de peça produzida (ex: "COVER", "DOORS")
 *    - NÃO TÊM routes: peças vão APENAS para o Part Buffer correspondente
 *    - TÊM buffers: aponta para a linha que consumirá as peças (informativo)
 *    - O Part Buffer é criado automaticamente: {Shop}-PARTS-{partType}
 *    - PODEM ter createWith: sincroniza criação de peças com outra linha
 *    - Exemplo: CoverHemming, DoorLine, CylinderHead, ShortLine, etc.
 * 
 * ============================================================================
 * CONSUMO DE PEÇAS:
 * ============================================================================
 * 
 * Para uma linha consumir peças, ela precisa:
 * 1. requiredParts: array com { partType: "TIPO", consumeStation: "s1" }
 * 2. partConsumptionStation: estação onde o consumo acontece (default: "s1")
 * 
 * O carro SÓ pode ser criado/avançar se existir peça do mesmo modelo no buffer.
 * Se não houver peça, ocorre parada LACK-{partType}.
 * 
 * ============================================================================
 * IMPORTANTE - REGRAS DE CONFIGURAÇÃO:
 * ============================================================================
 * 
 * ❌ ERRADO: Part Line Final com routes (peças seguirão fluxo de carro)
 *    { partType: "COVER", routes: [{ fromStation: "s17", to: [...] }] }
 * 
 * ✅ CORRETO: Part Line Final sem routes (peças vão apenas para Part Buffer)
 *    { partType: "COVER", buffers: [{ to: { shop: "Body", line: "MetalLine" }, capacity: 20 }] }
 * 
 *  * ❌ ERRADO: Part Line de nascimento ou intermedia sem routes (peças seguirão fluxo de carro)
 *    { partType: "COVER", buffers: [{ to: { shop: "Body", line: "MetalLine" }, capacity: 20 }] }
 * 
 * ✅ CORRETO: Part Line de nascimento ou intermedia sem routes com routes (peças vão apenas para Part Buffer)
 *    { partType: "COVER", routes: [{ fromStation: "s17", to: [...] }] }

*   TODA LINE CAR NORMAL TEM ROUTER E BUFFER 
 * ============================================================================
 */

export const FlowPlant: any = {

  typeSpeedFactor: 1,
  stationTaktMinFraction: 0.7,
  stationTaktMaxFraction: 0.999,
  stationstartProduction: [
    // Body - onde o carro nasce
    { shop: "Body", line: "BodyMain", station: "s1" },
    // PWT Part Lines - linhas de peças do Powertrain
    { shop: "PWT", line: "ShortLine", station: "s1" },
    { shop: "PWT", line: "CylinderHead", station: "s1" },
    // Body Part Lines - linhas de peças do Body
    { shop: "Body", line: "EngComp", station: "s1" },
    { shop: "Body", line: "FrontFloor", station: "s1" },
    { shop: "Body", line: "RearFloor", station: "s1" },
    { shop: "Body", line: "BodySideRH", station: "s1" },
    { shop: "Body", line: "BodySideLH", station: "s1" },
    { shop: "Body", line: "CoverHemming", station: "s1" },
    // Trim Part Lines
    { shop: "Trim", line: "DoorLine", station: "s1" }
  ],
  shifts: [
    { id: "TURNO_1", start: "07:00", end: "16:48" },
    { id: "TURNO_2", start: "17:00", end: "23:48" }
  ],
  plannedStops: [
    {
      id: "LUNCH_BODY",
      name: "Almoço Body",
      type: "LUNCH",
      reason: "LUNCH",
      affectsShops: ["Body"],
      startTime: "12:00",
      durationMn: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "LUNCH_PWT",
      name: "Almoço PWT",
      type: "LUNCH",
      reason: "LUNCH",
      affectsShops: ["PWT"],
      startTime: "12:00",
      durationMn: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "LUNCH_PAINT",
      name: "Almoço Paint",
      type: "LUNCH",
      reason: "LUNCH",
      affectsShops: ["Paint"],
      startTime: "11:30",
      durationMn: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "LUNCH_TRIM",
      name: "Almoço Trim",
      type: "LUNCH",
      reason: "LUNCH",
      affectsShops: ["Trim"],
      startTime: "11:00",
      durationMn: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "LUNCH_QUALIDADE",
      name: "Almoço Qualidade",
      type: "LUNCH",
      reason: "LUNCH",
      affectsShops: ["Qualidade"],
      startTime: "11:00",
      durationMn: 60,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "MEETING_TUESDAY",
      name: "Reunião Terça",
      type: "MEETING",
      reason: "MEETING",
      startTime: "09:00",
      durationMn: 40,
      daysOfWeek: [2]
    },
    {
      id: "SHIFT_CHANGE",
      name: "Troca de Turno",
      type: "SHIFT_CHANGE",
      reason: "SHIFT_CHANGE",
      startTime: "16:48",
      durationMn: 12,
      daysOfWeek: [1, 2, 3, 4, 5, 6]
    },
    {
      id: "NIGHT_STOP",
      name: "Parada Noturna",
      type: "NIGHT_STOP",
      reason: "NIGHT_STOP",
      startTime: "23:48",
      durationMn: 432,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6]
    }
  ],

  DPHU: 5,
  Rework_Time: 60,
  targetJPH: 28,
  oeeTargets: {
    PWT: 0.85,
    Body: 0.85,
    Paint: 0.85,
    Trim: 0.85,
    Qualidade: 0.95
  },

  shops: {

    // =========================================================================
    // SHOP: PWT (POWERTRAIN) - Linhas de peças (motores)
    // =========================================================================
    PWT: {
      bufferCapacity: 5000,
      reworkBuffer: 1000,
      lines: {
        // =====================================================================
        // PART LINES (Linhas de Peças) - NÃO têm routes, peças vão para Part Buffer
        // =====================================================================
        
        // CylinderHead - produz peças CYLINDER_HEAD consumidas pela ShortLine
        "CylinderHead": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "CYLINDER_HEAD",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "PWT", line: "ShortLine" }, capacity: 30 }
          ]
          // NÃO tem routes - peças vão automaticamente para PWT-PARTS-CYLINDER_HEAD
        },

        // ShortLine - produz peças ENGINE, consome CYLINDER_HEAD na s6
        "ShortLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "ENGINE",  // Esta é uma Part Line
          requiredParts: [
            { partType: "CYLINDER_HEAD", consumeStation: "s6" }
          ],
          buffers: [
            { to: { shop: "PWT", line: "BareLine" }, capacity: 1 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "PWT", line: "BareLine", station: "s1" }]
            }
          ]
        },

        // BareLine - processa peças ENGINE (10 stations)
        "BareLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "ENGINE",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "PWT", line: "MainLine" }, capacity: 1 }
          ],
          routes: [
            {
              fromStation: "s10",
              to: [{ shop: "PWT", line: "MainLine", station: "s1" }]
            }
          ]
        },

        // MainLine - processa peças ENGINE (15 stations)
        "MainLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15"],
          takt: { jph: 28, leadtime: 15 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "ENGINE",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "PWT", line: "FTB" }, capacity: 1 }
          ],
          routes: [
            {
              fromStation: "s15",
              to: [{ shop: "PWT", line: "FTB", station: "s1" }]
            }
          ]
        },

        // FTB - Final Test Bench (última linha de ENGINE antes de ir para Trim_B)
        "FTB": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4"],
          takt: { jph: 28, leadtime: 4 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "ENGINE",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Trim", line: "Trim_B" }, capacity: 5000 }
          ]
          // NÃO tem routes - peças vão automaticamente para Trim-PARTS-ENGINE
        }
      },
      name: "PWT"
    },

    // =========================================================================
    // SHOP: BODY - Construção da carroceria
    // =========================================================================
    Body: {
      bufferCapacity: 100,
      reworkBuffer: 30,
      lines: {
        // =====================================================================
        // PART LINES (Linhas de Peças) - NÃO têm routes, peças vão para Part Buffer
        // =====================================================================

        // EngComp - produz peças ENGINE_COMPARTMENT consumidas pela BodyMain
        "EngComp": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "ENGINE_COMPARTMENT",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "BodyMain" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-ENGINE_COMPARTMENT
        },

        // FrontFloor - produz peças FRONT_FLOOR consumidas pela BodyMain
        "FrontFloor": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "FRONT_FLOOR",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "BodyMain" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-FRONT_FLOOR
        },

        // RearFloor - produz peças REAR_FLOOR consumidas pela BodyMain
        "RearFloor": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "REAR_FLOOR",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "BodyMain" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-REAR_FLOOR
        },

        // BodySideRH - produz peças BODY_SIDE_RH consumidas pela BodyMain
        "BodySideRH": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12"],
          takt: { jph: 28, leadtime: 12 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "BODY_SIDE_RH",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "BodyMain" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-BODY_SIDE_RH
        },

        // BodySideLH - produz peças BODY_SIDE_LH consumidas pela BodyMain
        "BodySideLH": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12"],
          takt: { jph: 28, leadtime: 12 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "BODY_SIDE_LH",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "BodyMain" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-BODY_SIDE_LH
        },

        // CoverHemming - produz peças COVER consumidas pela MetalLine
        "CoverHemming": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14", "s15", "s16", "s17"],
          takt: { jph: 28, leadtime: 17 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "COVER",  // Esta é uma Part Line
          buffers: [
            { to: { shop: "Body", line: "MetalLine" }, capacity: 20 }
          ]
          // NÃO tem routes - peças vão automaticamente para Body-PARTS-COVER
        },

        // =====================================================================
        // CAR LINES (Linhas Normais) - TÊM routes para definir fluxo de carros
        // =====================================================================

        // BodyMain - Linha principal onde o carro NASCE e consome peças na s1
        "BodyMain": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          requiredParts: [
            { partType: "ENGINE_COMPARTMENT", consumeStation: "s1" },
            { partType: "FRONT_FLOOR", consumeStation: "s1" },
            { partType: "REAR_FLOOR", consumeStation: "s1" },
            { partType: "BODY_SIDE_RH", consumeStation: "s1" },
            { partType: "BODY_SIDE_LH", consumeStation: "s1" }
          ],
          partConsumptionStation: "s1",
          buffers: [
            { to: { shop: "Body", line: "MetalLine" }, capacity: 20 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Body", line: "MetalLine", station: "s1" }]
            }
          ]
        },

        // MetalLine - Consome COVER na s1, última linha antes da pintura
        "MetalLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          requiredParts: [
            { partType: "COVER", consumeStation: "s1" }
          ],
          partConsumptionStation: "s1",
          buffers: [
            { to: { shop: "Paint", line: "Paint_In" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "Paint", line: "Paint_In", station: "s1" }]
            }
          ]
        }
      },
      name: "Body"
    },

    // =========================================================================
    // SHOP: PAINT - Pintura
    // =========================================================================
    Paint: {
      bufferCapacity: 300,
      reworkBuffer: 100,
      lines: {
        "Paint_In": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5"],
          takt: { jph: 28, leadtime: 5 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "PT_ED" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s5",
              to: [{ shop: "Paint", line: "PT_ED", station: "s1" }]
            }
          ]
        },

        "PT_ED": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "Sealer" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Paint", line: "Sealer", station: "s1" }]
            }
          ]
        },

        "Sealer": {
          MTTR: 3,
          MTBF: 120,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "ED_Sanding" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s10",
              to: [{ shop: "Paint", line: "ED_Sanding", station: "s1" }]
            }
          ]
        },

        "ED_Sanding": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "Top_Coat" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Paint", line: "Top_Coat", station: "s1" }]
            }
          ]
        },

        "Top_Coat": {
          MTTR: 3,
          MTBF: 120,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "Finish" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Paint", line: "Finish", station: "s1" }]
            }
          ]
        },

        "Finish": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Paint", line: "Paint_Out" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Paint", line: "Paint_Out", station: "s1" }]
            }
          ]
        },

        "Paint_Out": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Trim", line: "Trim_A" }, capacity: 30 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Trim", line: "Trim_A", station: "s1" }]
            }
          ]
        }
      },
      name: "Paint"
    },

    // =========================================================================
    // SHOP: TRIM - Montagem final
    // =========================================================================
    Trim: {
      bufferCapacity: 60,
      reworkBuffer: 30,
      lines: {
        // =====================================================================
        // PART LINES (Linhas de Peças) - NÃO têm routes, peças vão para Part Buffer
        // =====================================================================

        // DoorLine - produz peças DOORS consumidas pela C3 (createWith = sincroniza com Paint_Out)
        "DoorLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13"],
          takt: { jph: 28, leadtime: 13 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          partType: "DOORS",  // Esta é uma Part Line
          createWith: { line: "Paint_Out", station: "s1" },  // Sincroniza criação com saída de Paint_Out
          buffers: [
            { to: { shop: "Trim", line: "C3" }, capacity: 50 }
          ]
          // NÃO tem routes - peças vão automaticamente para Trim-PARTS-DOORS
        },

        // =====================================================================
        // CAR LINES (Linhas Normais) - TÊM routes para definir fluxo de carros
        // =====================================================================

        "Trim_A": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5"],
          takt: { jph: 28, leadtime: 5 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Trim", line: "Trim_B" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s5",
              to: [{ shop: "Trim", line: "Trim_B", station: "s1" }]
            }
          ]
        },

        "Trim_B": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          requiredParts: [
            { partType: "ENGINE", consumeStation: "s1" }
          ],
          buffers: [
            { to: { shop: "Trim", line: "C1_C2" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Trim", line: "C1_C2", station: "s1" }]
            }
          ]
        },

        "C1_C2": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"],
          takt: { jph: 28, leadtime: 10 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Trim", line: "C3" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s10",
              to: [{ shop: "Trim", line: "C3", station: "s1" }]
            }
          ]
        },

        // C3 - Consome DOORS na s1
        "C3": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          requiredParts: [
            { partType: "DOORS", consumeStation: "s1" }
          ],
          partConsumptionStation: "s1",
          buffers: [
            { to: { shop: "Trim", line: "C4" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Trim", line: "C4", station: "s1" }]
            }
          ]
        },

        "C4": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
          takt: { jph: 28, leadtime: 8 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "CSLine" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s8",
              to: [{ shop: "Qualidade", line: "CSLine", station: "s1" }]
            }
          ]
        }
      },
      name: "Trim"
    },

    // =========================================================================
    // SHOP: QUALIDADE - Inspeção e testes finais
    // =========================================================================
    Qualidade: {
      bufferCapacity: 50,
      reworkBuffer: 20,
      lines: {
        // CSLine - Customer Satisfaction Line
        "CSLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "TesterLine" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "Qualidade", line: "TesterLine", station: "s1" }]
            }
          ]
        },

        // TesterLine - Linha de testes
        "TesterLine": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "UnderCover" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "Qualidade", line: "UnderCover", station: "s1" }]
            }
          ]
        },

        // UnderCover - 1 station
        "UnderCover": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1"],
          takt: { jph: 28, leadtime: 1 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "ITS" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s1",
              to: [{ shop: "Qualidade", line: "ITS", station: "s1" }]
            }
          ]
        },

        // ITS - Inspection Test System
        "ITS": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "Shower" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "Qualidade", line: "Shower", station: "s1" }]
            }
          ]
        },

        // Shower - Teste de água
        "Shower": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1", "s2", "s3", "s4", "s5", "s6"],
          takt: { jph: 28, leadtime: 6 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [
            { to: { shop: "Qualidade", line: "Delivery" }, capacity: 6 }
          ],
          routes: [
            {
              fromStation: "s6",
              to: [{ shop: "Qualidade", line: "Delivery", station: "s1" }]
            }
          ]
        },

        // Delivery - Entrega final (1 station, completa o carro)
        "Delivery": {
          MTTR: Math.random() * 10 + 2,
          MTBF: Math.random() * 100 + 20,
          stations: ["s1"],
          takt: { jph: 28, leadtime: 1 / 28, shiftStart: "07:00", shiftEnd: "23:48" },
          buffers: [],
          routes: []  // Última linha - carro completo
        }
      },
      name: "Qualidade"
    }
  }
};