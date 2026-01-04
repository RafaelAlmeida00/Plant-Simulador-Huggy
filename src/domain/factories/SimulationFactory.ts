
import { SimulationClock } from "../../app/SimulationClock";
import { ISimulationClock, SimulationCallbacks } from "../../utils/shared";
import { getActiveFlowPlant } from "./plantFactory";


export class SimulationFactory {

  public static create(callbacks?: SimulationCallbacks): SimulationClock {
    const config = getActiveFlowPlant();
    const speedFactor = config.typeSpeedFactor ?? 1;    
    return new SimulationClock(speedFactor, callbacks);
  }
}
