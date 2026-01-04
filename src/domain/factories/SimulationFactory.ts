
import { FlowPlant } from "../config/flowPlant";
import { SimulationClock } from "../../app/SimulationClock";
import { ISimulationClock, SimulationCallbacks } from "../../utils/shared";


export class SimulationFactory {

  public static create(callbacks?: SimulationCallbacks): SimulationClock {
    const speedFactor = FlowPlant.typeSpeedFactor ?? 1;    
    return new SimulationClock(speedFactor, callbacks);
  }
}
